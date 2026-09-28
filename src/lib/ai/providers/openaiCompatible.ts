import type { AiToolCall, AiToolDef, AIModel, AIProvider, ChatMessage, ProviderAdapter, StreamChunk, PendingToolCall } from '../types'
import { supabase } from '../../supabase'

const AI_PROXY_URL = 'https://qkedsdzwepgscxzvqphu.functions.supabase.co/ai-proxy'

export class OpenAICompatibleAdapter implements ProviderAdapter {
  code = 'openai-compatible'

  async streamChat(options: {
    provider: AIProvider
    model: AIModel
    messages: ChatMessage[]
    apiKey?: string
    signal?: AbortSignal
    tools?: AiToolDef[]
    toolChoice?: unknown
    maxOutputTokens?: number
    onChunk: (chunk: StreamChunk) => void
  }): Promise<void> {
    const { provider, model, messages, apiKey, signal, tools, toolChoice, maxOutputTokens, onChunk } = options

    const base = provider.base_url.replace(/\/+$/, '')
    const config = provider.config || {}

    const serverManaged = config.server_managed === true
    let key: string | undefined
    const payload: Record<string, unknown> = { model: model.model_id, messages, stream: true }
    if (tools && tools.length > 0) payload.tools = tools
    if (toolChoice !== undefined) payload.tool_choice = toolChoice
    if (maxOutputTokens != null) payload.max_tokens = maxOutputTokens
    let url: string
    if (serverManaged) {
      url = `${AI_PROXY_URL}/chat/completions`
      payload.provider_id = provider.id
      if (config.proxy_project_id) payload.project_id = config.proxy_project_id
      const { data } = await supabase.auth.getSession()
      key = data?.session?.access_token ?? undefined
    } else {
      url = `${base}/chat/completions`
      const publicKey = typeof config.public_key === 'string' ? config.public_key : undefined
      const byokKey = typeof config.api_key === 'string' ? config.api_key : undefined
      key = apiKey ?? byokKey ?? publicKey
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'AWRIQ-Agent/1.0-PROBE7 (Mozilla compatible)',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(payload),
      signal,
    })

    if (!res.ok) {
      let message = `HTTP ${res.status} ${res.statusText}`
      try {
        const body = await res.json()
        message = body?.error?.message || body?.error?.type || message
      } catch {
        /* non-json body */
      }
      onChunk({ text: '', done: true, error: message })
      throw new Error(message)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''
    let sawContent = false
    let reasoningFallback = ''
    let sawFinishReason = false
    let sawToolCalls = false
    const toolAcc: Record<number, { id: string; name: string; args: string; announced: boolean; extra?: Record<string, unknown> }> = {}

    const flush = async (): Promise<boolean> => {
      const { done, value } = await reader.read()
      if (done) return false
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') return false
        try {
          const parsed = JSON.parse(payload)
          const choice = parsed?.choices?.[0]
          const d = choice?.delta ?? {}
          const content = d.content ?? null
          if (typeof content === 'string' && content.length > 0) {
            sawContent = true
            onChunk({ text: content })
          } else if (typeof d.reasoning === 'string' && d.reasoning.length > 0) {
            reasoningFallback += d.reasoning
          }
          const tcs = d.tool_calls
          if (Array.isArray(tcs)) {
            sawToolCalls = true
            for (const tc of tcs) {
              if (tc == null) continue
              const idx = typeof tc.index === 'number' ? tc.index : 0
              const slot = (toolAcc[idx] ??= { id: '', name: '', args: '', announced: false })
              const fn = tc.function
              if (tc.id) slot.id = tc.id
              if (fn?.name) slot.name = fn.name
              if (fn?.arguments) slot.args += fn.arguments
              if (tc.extra_content && typeof tc.extra_content === 'object') slot.extra = tc.extra_content
              if (slot.id && slot.name && !slot.announced) {
                slot.announced = true
                const pending: PendingToolCall = { id: slot.id, name: slot.name }
                onChunk({ text: '', pendingTool: pending })
              }
            }
          }
          if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
            sawFinishReason = true
          }
        } catch {
          /* skip malformed chunk */
        }
      }
      return true
    }

    let active = true
    while (active) {
      active = await flush()
    }

    const toolCalls: AiToolCall[] = Object.values(toolAcc)
      .filter((t) => t.id && t.name)
      .map((t) => ({
        id: t.id,
        type: 'function',
        function: { name: t.name, arguments: t.args },
        ...(t.extra ? { extra_content: t.extra } : {}),
      }))

    if (sawFinishReason && toolCalls.length > 0) {
      onChunk({ text: '', toolCalls, finishedReason: 'tool_calls' })
      onChunk({ text: '', done: true })
      return
    }

    if (!sawContent && reasoningFallback.trim() && !toolCalls.length) {
      onChunk({ text: reasoningFallback })
      sawContent = true
    }

    // The reader hit EOF without [DONE] or a finish_reason: the upstream cut
    // mid-stream. Keep whatever arrived but flag it so the caller can retry.
    if (!sawFinishReason && (sawContent || sawToolCalls)) {
      onChunk({ text: '', interrupted: true })
    }
    if (toolCalls.length > 0) {
      onChunk({ text: '', toolCalls })
    }
    onChunk({ text: '', done: true })
  }
}