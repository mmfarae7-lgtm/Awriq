import type { ProviderAdapter } from '../types'
import { OpenAICompatibleAdapter } from './openaiCompatible'

export const adapters: ProviderAdapter[] = [new OpenAICompatibleAdapter()]

export function getAdapter(code: string): ProviderAdapter | undefined {
  return adapters.find((a) => a.code === code) ?? adapters[0]
}