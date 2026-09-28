export type AIAuthMethod = 'none' | 'api_key' | 'bearer'

export interface AIProvider {
  id: string
  code: string
  name: string
  base_url: string
  auth_method: AIAuthMethod
  is_free: boolean
  priority: number
  is_enabled: boolean
  config: Record<string, unknown>
}

export interface AIModel {
  id: string
  provider_id: string
  model_id: string
  name: string
  context_window: number | null
  supports_tools: boolean
  is_default: boolean
  is_enabled: boolean
  cost_input_usd: number
  cost_output_usd: number
}

/** A function call the model requested (OpenAI shape: arguments is a JSON string). */
export interface AiToolCall {
  id: string
  type?: 'function'
  function: { name: string; arguments: string }
  /** Provider-specific extras to replay on continuation (e.g. Gemini thought_signature). */
  extra_content?: Record<string, unknown>
}

export interface AiToolFunction {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface AiToolDef {
  type: 'function'
  function: AiToolFunction
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: AiToolCall[]
}

export interface ProviderAdapterOptions {
  provider: AIProvider
  model: AIModel
  messages: ChatMessage[]
  apiKey?: string
  signal?: AbortSignal
  tools?: AiToolDef[]
  toolChoice?: unknown
  maxOutputTokens?: number
}

export interface PendingToolCall {
  id: string
  name: string
}

export interface StreamChunk {
  text: string
  done?: boolean
  error?: string
  pendingTool?: PendingToolCall
  toolCalls?: AiToolCall[]
  finishedReason?: string
  interrupted?: boolean
}

export interface ProviderAdapter {
  code: string
  streamChat(options: ProviderAdapterOptions & { onChunk: (chunk: StreamChunk) => void }): Promise<void>
}