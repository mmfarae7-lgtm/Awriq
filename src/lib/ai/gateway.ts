import { supabase } from '../supabase'
import type { AiToolDef, AIModel, AIProvider, ChatMessage, StreamChunk } from './types'
import { getAdapter } from './providers/registry'

export interface GatewayResolve {
  provider: AIProvider
  model: AIModel
  source: 'db'
}

export interface StreamStatus {
  attempts: number
  lastError?: string
  switchedFrom?: string
  switchedTo?: string
}

/**
 * AI Gateway - free-first with automatic fallback.
 * Resolves enabled providers ordered by priority (free first),
 * tries the public free key first, and on any failure moves to the next
 * provider/model automatically.
 */
export class AIGateway {
  private providers: AIProvider[] = []
  private models: AIModel[] = []

  async loadFromDb(): Promise<void> {
    const [providers, models] = await Promise.all([
      supabase
        .from('ai_providers')
        .select('*')
        .eq('is_enabled', true)
        .order('priority', { ascending: true }),
      supabase.from('ai_models').select('*'),
    ])
    this.providers = (providers.data ?? []) as AIProvider[]
    this.models = (models.data ?? []) as AIModel[]
  }

  setCatalog(providers: AIProvider[], models: AIModel[]): void {
    this.providers = providers
    this.models = models
  }

  /** Resolve the best free candidate: default model of highest-priority enabled provider. */
  resolveDefault(): GatewayResolve | undefined {
    for (const provider of this.providers.filter((p) => p.is_enabled)) {
      const candidates = this.models
        .filter((m) => m.provider_id === provider.id && m.is_enabled)
        .sort((a, b) => Number(b.is_default) - Number(a.is_default))
      if (candidates.length > 0) {
        return { provider, model: candidates[0], source: 'db' }
      }
    }
    return undefined
  }

  /**
   * Stream a chat turn. Tries providers in priority order; on failure falls
   * back to the next candidate and reports the switch.
   */
  getProviders(): AIProvider[] {
    return this.providers
  }

  getModels(): AIModel[] {
    return this.models
  }

  async streamChat(options: {
    messages: ChatMessage[]
    onChunk: (chunk: StreamChunk) => void
    onStatus?: (status: StreamStatus) => void
    preferModelId?: string
    projectKey?: string
    signal?: AbortSignal
    tools?: AiToolDef[]
    toolChoice?: unknown
    maxOutputTokens?: number
  }): Promise<{ ok: boolean; usedProvider?: string; usedModel?: string; error?: string; provider?: AIProvider; model?: AIModel }> {
    const { messages, onChunk, onStatus, preferModelId, projectKey, signal, tools, toolChoice, maxOutputTokens } = options

    // Pick at most one model per provider: the preferred, else the default.
    const candidates: Array<{ provider: AIProvider; model: AIModel }> = []
    for (const provider of this.providers.filter((p) => p.is_enabled)) {
      const models = this.models.filter((m) => m.provider_id === provider.id && m.is_enabled)
      const preferred = preferModelId ? models.find((m) => m.model_id === preferModelId) : undefined
      if (preferred) {
        candidates.push({ provider, model: preferred })
        continue
      }
      const defaults = models.filter((m) => m.is_default)
      const model = defaults[0] ?? models[0]
      if (model) candidates.push({ provider, model })
    }

    let attempt = 0
    const failures: string[] = []
    for (const { provider, model } of candidates) {
      attempt += 1
      try {
        if (signal?.aborted) throw new Error('Aborted')
        const adapter = getAdapter('openai-compatible')
        if (!adapter) throw new Error('No adapter available')
        let failed: string | undefined
        await adapter.streamChat({
          provider,
          model,
          messages,
          apiKey: projectKey,
          signal,
          tools,
          toolChoice,
          maxOutputTokens,
          onChunk: (chunk) => {
            if (chunk.error) failed = chunk.error
            onChunk(chunk)
          },
        })
        if (failed) throw new Error(failed)
        onStatus?.({ attempts: attempt, switchedTo: provider.code })
        return { ok: true, usedProvider: provider.code, usedModel: model.model_id, provider, model }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          onStatus?.({ attempts: attempt, lastError: 'Aborted', switchedFrom: provider.code })
          throw err
        }
        const msg = err instanceof Error ? err.message : String(err)
        failures.push(`[${provider.code}/${model.model_id}] ${msg}`)
        onStatus?.({ attempts: attempt, lastError: msg, switchedFrom: provider.code })
      }
    }

    const allFailed = failures.length > 0 ? failures.join('; ') : 'All AI providers failed.'
    onChunk({ text: '', done: true, error: allFailed })
    onStatus?.({ attempts: attempt, lastError: allFailed })
    return { ok: false, error: allFailed }
  }
}

export const aiGateway = new AIGateway()