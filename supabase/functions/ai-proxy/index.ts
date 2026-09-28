// ai-proxy — وسيط حقن مفاتيح المزوّدات من جهة الخادم.
//
// الوصول: جلسة AWRIQ صالحة (Bearer eyJ…) لمستخدم بـ super_admin فقط.
// يقرأ المزوّد من ai_providers، يستخرج المفتاح من ai_provider_secrets
// (مشفر بـ PAX_MASTER_KEY + provider_id)، يستدعي المزوّد (OpenAI-compatible)
// ويعيد SSE كما هي — فتبقى المفاتيح بعيدة عن المتصفح نهائيًا.

import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://awriq-awriq1.vercel.app",
  "http://localhost:5173",
];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MASTER_KEY = Deno.env.get("PAX_MASTER_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function base64UrlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const b64 = pad + "=".repeat((4 - (pad.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function secretKey(providerId: string): Promise<Uint8Array> {
  const src = new TextEncoder().encode(`${MASTER_KEY}:${providerId}`);
  const digest = await crypto.subtle.digest("SHA-256", src);
  return new Uint8Array(digest);
}

async function decryptSecret(providerId: string, value: string): Promise<string | null> {
  try {
    if (!value.startsWith("enc:v1:")) return null;
    const parts = value.split(":");
    if (parts.length < 4) return null;
    const key = await crypto.subtle.importKey(
      "raw", await secretKey(providerId), "AES-GCM", false, ["decrypt"],
    );
    const iv = base64UrlDecode(parts[2]);
    const ct = base64UrlDecode(parts[3]);
    const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(buf);
  } catch { return null; }
}

function cors(origin: string, extra: Record<string, string> = {}) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
    ...extra,
  };
}

function json(data: unknown, status = 200, origin: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

function err(code: string, message: string, status: number, origin: string): Response {
  return json({ ok: false, error: { code, message } }, status, origin);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  if (req.method === "OPTIONS") {
    if (!ALLOWED_ORIGINS.includes(origin)) return err("CORS_ORIGIN_FORBIDDEN", "Origin not allowed", 403, origin);
    return new Response(null, { status: 204, headers: cors(origin) });
  }

  if (req.method !== "POST") return err("METHOD_NOT_ALLOWED", "POST only", 405, origin);

  // 1) مصادقة أدمن عبر JWT
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer eyJ")) return err("AUTH_INVALID", "Valid AWRIQ admin session required", 401, origin);
  const token = auth.slice(7);
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userErr || !userId) return err("AUTH_INVALID", "Session invalid or expired", 401, origin);

  const { data: roleRows, error: roleErr } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId);
  const isAdmin = !roleErr && (roleRows ?? []).some((r: any) => r?.roles?.name === "super_admin");
  if (!isAdmin) {
    const { data: pem } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", userId)
      .eq("role", "owner")
      .limit(1);
    if (!pem?.length) return err("FORBIDDEN", "super_admin required for server-managed AI providers", 403, origin);
  }

  const body = await req.json().catch(() => ({}));
  const providerId = typeof body.provider_id === "string" ? body.provider_id : "";
  const model = typeof body.model === "string" ? body.model : "";
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const projectId = typeof body.project_id === "string" && body.project_id ? body.project_id : null;
  if (!providerId || !model || !messages.length) return err("BAD_REQUEST", "provider_id, model, messages are required", 400, origin);

  const { data: prov, error: provErr } = await supabase
    .from("ai_providers")
    .select("id, code, name, base_url")
    .eq("id", providerId)
    .maybeSingle();
  if (provErr || !prov) return err("NOT_FOUND", "AI provider not found", 404, origin);
  const base = (prov.base_url ?? "").replace(/\/+$/, "");
  if (!base) return err("PROVIDER_UNCONFIGURED", "Provider has no base_url", 409, origin);

  // 2) استخراج المفتاح من خزانة الأسرار (يفضل نطاق المشروع ثم العام)
  let secretRow: any = null;
  if (projectId) {
    const { data } = await supabase
      .from("ai_provider_secrets")
      .select("encrypted_secret")
      .eq("provider_id", providerId)
      .eq("project_id", projectId)
      .limit(1);
    if (data?.length) secretRow = data[0];
  }
  if (!secretRow) {
    const { data } = await supabase
      .from("ai_provider_secrets")
      .select("encrypted_secret")
      .eq("provider_id", providerId)
      .is("project_id", null)
      .limit(1);
    if (data?.length) secretRow = data[0];
  }
  if (!secretRow) return err("PROVIDER_UNCONFIGURED", "No stored secret for this provider", 409, origin);

  const apiKey = await decryptSecret(providerId, secretRow.encrypted_secret);
  if (!apiKey) return err("PROVIDER_UNCONFIGURED", "Stored secret could not be decrypted", 500, origin);

  // 3) الاتصال بالمزوّد ونقل SSE مباشرة
  const upstreamBody: Record<string, unknown> = { model, messages, stream: true, stream_options: { include_usage: false } };
  const passthrough = ["tools", "tool_choice", "max_tokens", "temperature", "top_p", "response_format", "seed", "stop"] as const;
  for (const k of passthrough) {
    if (body[k] !== undefined) upstreamBody[k] = body[k];
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "AWRIQ-Agent/1.0 (ai-proxy)",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch (e) {
    return err("UPSTREAM_ERROR", e instanceof Error ? e.message : "upstream net error", 502, origin);
  }
  if (!upstream.ok) {
    let msg = `HTTP ${upstream.status}`;
    try {
      const j = await upstream.json();
      msg = j?.error?.message || j?.error?.type || msg;
    } catch { /* */ }
    return err("UPSTREAM_ERROR", msg, 502, origin);
  }
  if (!upstream.body) return err("UPSTREAM_ERROR", "Empty upstream body", 502, origin);

  const reader = upstream.body.getReader();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
      await writer.close();
    } catch (e) {
      try { await writer.abort(e instanceof Error ? e : new Error("stream aborted")); } catch { /* */ }
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      ...cors(origin),
    },
  });
});