// awriq-agent / providers.ts — طبقة المزوّدات (Provider Abstraction).
// العقل = مزوّد (DeepSeek افتراضيًا)؛ التنفيذ = طبقة الأدوات نقية (backend) لا المزوّد.
// المدخل: OpenAI-compatible base + مفتاح سري من الخادم فقط. لا مفتاح في الكود/الواجهة.

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ProviderUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ProviderStep {
  text: string;
  reasoning: string;
  toolCalls: ProviderToolCall[];
  finish: string | null;
  usage: ProviderUsage | null;
}

export type ProviderErrorKind =
  | "auth"      // 401
  | "forbidden" // 403
  | "rate"      // 429
  | "timeout"
  | "connect"
  | "model"     // 400 (bad model / content policy)
  | "upstream"  // 5xx
  | "unknown";

export class ProviderError extends Error {
  kind: ProviderErrorKind;
  constructor(kind: ProviderErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** مكوّن OpenAI-compatible عام: تدفق نص وتدوير Tool Calls وجمع Usage. */
export class OpenAICompatProvider {
  readonly label: string;
  protected base: string;
  protected apiKey: string | null;
  protected model: string;

  constructor(opts: { base: string; apiKey: string | null; model: string; label?: string }) {
    this.base = opts.base.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.label = opts.label ?? opts.model;
  }

  get modelId(): string {
    return this.model;
  }

  async stream(
    messages: ChatMessage[],
    opts: { tools?: ToolDef[]; maxTokens?: number },
  ): Promise<ProviderStep> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (opts.tools && opts.tools.length) body.tools = opts.tools;
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;

    let res: Response;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
      res = await fetch(`${this.base}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "AWRIQ-Agent/1.0 (awriq-agent)",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new ProviderError("timeout", `${this.label} request timed out after 90s`);
      }
      throw new ProviderError("connect", `${this.label} connection failed: ${(e as Error).message}`);
    }
    clearTimeout(timer);

    if (!res.ok) {
      const status = res.status;
      let msg = `HTTP ${status}`;
      try {
        const j = await res.json();
        msg = j?.error?.message || j?.error?.type || msg;
      } catch { /* no body */ }
      if (status === 401) throw new ProviderError("auth", `${this.label} request failed (401 unauthorized).`);
      if (status === 403) throw new ProviderError("forbidden", `${this.label} request failed (403 forbidden).`);
      if (status === 429) throw new ProviderError("rate", `${this.label} rate limited (429).`);
      if (status === 400) throw new ProviderError("model", `${this.label} model error: ${msg}`);
      if (status >= 500) throw new ProviderError("upstream", `${this.label} upstream error (${status}).`);
      throw new ProviderError("model", `${this.label} request failed: ${msg}`);
    }
    if (!res.body) throw new ProviderError("unknown", `${this.label} returned no body`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let reasoning = "";
    let finish: string | null = null;
    let usage: ProviderUsage | null = null;
    const toolAcc: Record<number, { id: string; name: string; args: string }> = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") { finish = "stop"; continue; }
        let parsed: any;
        try { parsed = JSON.parse(payload); } catch { continue; }
        const usageObj = parsed?.usage;
        if (usageObj && typeof usageObj.total_tokens === "number") {
          usage = {
            prompt_tokens: usageObj.prompt_tokens ?? 0,
            completion_tokens: usageObj.completion_tokens ?? 0,
            total_tokens: usageObj.total_tokens ?? 0,
          };
        }
        const choice = parsed?.choices?.[0];
        if (!choice) continue;
        const d = choice.delta ?? {};
        if (typeof d.content === "string") text += d.content;
        else if (typeof d.reasoning_content === "string" && d.reasoning_content.length) reasoning += d.reasoning_content;
        else if (typeof d.reasoning === "string" && d.reasoning.length) reasoning += d.reasoning;
        if (typeof choice.finish_reason === "string" && choice.finish_reason) finish = choice.finish_reason;
        const tcs = d.tool_calls;
        if (!Array.isArray(tcs)) continue;
        for (const tc of tcs) {
          if (!tc) continue;
          const idx = typeof tc.index === "number" ? tc.index : 0;
          const slot = (toolAcc[idx] ??= { id: "", name: "", args: "" });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name = tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
        }
      }
    }

    const toolCalls: ProviderToolCall[] = Object.values(toolAcc)
      .filter((t) => t.id && t.name)
      .map((t) => ({ id: t.id, name: t.name, arguments: t.args }));

    return { text, reasoning, toolCalls, finish, usage };
  }
}

/** مزوّد DeepSeek — العقل الأساسي (المفتاح من الخادم فقط). */
export class DeepSeekProvider extends OpenAICompatProvider {
  constructor(apiKey: string, model: string) {
    super({ base: "https://api.deepseek.com", apiKey, model, label: "DeepSeek" });
  }
}

/** مزوّدات مجانية متبقيات ممكنة لاحقًا (OpenAI/Groq/Together...) بدون إعادة بناء: كلها OpenAI-compatible. */
export function openAICompatProvider(opts: { base: string; apiKey?: string | null; model?: string; label: string }): OpenAICompatProvider {
  return new OpenAICompatProvider({
    base: opts.base,
    apiKey: opts.apiKey ?? null,
    model: opts.model ?? "",
    label: opts.label,
  });
}