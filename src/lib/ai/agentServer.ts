import { supabase } from '../supabase'
import type { ChatMessage } from './types'

export type AgentServerMode = 'read' | 'plan' | 'edit_approval' | 'edit_auto'

export interface AgentServerSSE {
  provider?: string
  text?: string
  id?: string
  name?: string
  args?: string
  ok?: boolean
  output?: string
  message?: string
  kind?: string
  path?: string
  workflow?: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  costEst?: { $: number; note?: string }
  durationMs?: number
  waitingApproval?: boolean
  truncated?: boolean
}

export interface AgentServerEvents {
  onDelta?: (text: string) => void
  onToolStart?: (id: string, name: string, args: string) => void
  onToolDone?: (id: string, name: string, ok: boolean, output: string, meta?: { errorType?: string | null; statusCode?: number | null; durationMs?: number | null; retried?: boolean }) => void
  onApproval?: (data: any) => void
  onFileChanged?: (path: string, diff?: string) => void
  onCommandDispatched?: (wf: string) => void
  onTerminal?: (data: { command: string; output: string; exitCode: number; status?: string; runUrl?: string }) => void
  onDiff?: (path: string, diff: string, action: string) => void
  onError?: (message: string, kind?: string) => void
  onApprovalResolved?: (data: any) => void
  onRunStart?: (data: any) => void
  onMessageStart?: (data: any) => void
  onCompleted?: (data: any) => void
}

export interface AgentServerResult {
  ok: boolean
  error?: string
  waitingApproval?: boolean
  provider?: string
  text?: string
  usage?: AgentServerSSE['usage']
  costEst?: AgentServerSSE['costEst']
  durationMs?: number
}

const fnUrl = () => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/awriq-agent`

async function authedFetch(body: Record<string, unknown>, signal?: AbortSignal) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('لا جلسة نشطة')
  const res = await fetch(fnUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  })
  return res
}

export async function serverAgentCheck(): Promise<boolean> {
  try {
    const res = await authedFetch({ _health: true })
    return res.ok
  } catch {
    return false
  }
}

export async function runServerAgent(opts: {
  project_id: string
  mode: AgentServerMode
  message: string
  history?: ChatMessage[]
  maxSteps?: number
  signal?: AbortSignal
  onEvent: AgentServerEvents
}): Promise<AgentServerResult> {
  const res = await authedFetch(
    {
      project_id: opts.project_id,
      mode: opts.mode,
      message: opts.message,
      history: opts.history ?? [],
      max_steps: opts.maxSteps,
    },
    opts.signal,
  )
  if (!res.ok) {
    let msg = `الوكيل رجع HTTP ${res.status}`
    try { const b = await res.json(); msg = b?.message ?? b?.error ?? msg } catch { /* ignore */ }
    return { ok: false, error: msg }
  }
  if (!res.body) return { ok: false, error: 'لا قناة بث متاحة' }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const result: AgentServerResult = { ok: false }

  const dispatch = (evType: string, data: AgentServerSSE) => {
    switch (evType) {
      case 'assistant.delta':
        if (data.text) opts.onEvent.onDelta?.(data.text)
        break
      case 'tool.start':
        if (data.id && data.name) opts.onEvent.onToolStart?.(data.id, data.name, data.args ?? '')
        break
      case 'tool.completed':
        if (data.id && data.name) opts.onEvent.onToolDone?.(data.id, data.name, Boolean(data.ok), data.output ?? '', { errorType: (data as any).errorType ?? null, statusCode: (data as any).statusCode ?? null, durationMs: (data as any).durationMs ?? null, retried: Boolean((data as any).retried) })
        break
      case 'approval.required':
        opts.onEvent.onApproval?.(data)
        break
      case 'approval.resolved':
        opts.onEvent.onApprovalResolved?.(data)
        break
      case 'file.changed':
        if (data.path) opts.onEvent.onFileChanged?.(data.path, (data as any).diff)
        break
      case 'command.dispatched':
        if (data.workflow) opts.onEvent.onCommandDispatched?.(data.workflow)
        break
      case 'terminal':
        opts.onEvent.onTerminal?.((data as any) as { command: string; output: string; exitCode: number; status?: string; runUrl?: string })
        break
      case 'run.start':
        opts.onEvent.onRunStart?.(data)
        break
      case 'message.start':
        opts.onEvent.onMessageStart?.(data)
        break
      case 'agent.completed':
        result.ok = true
        result.provider = data.provider
        result.text = data.text
        result.usage = data.usage
        result.costEst = data.costEst
        result.durationMs = data.durationMs
        result.waitingApproval = Boolean(data.waitingApproval)
        opts.onEvent.onCompleted?.(data)
        break
      case 'agent.error':
        result.error = data.message || 'فشل الوكيل'
        opts.onEvent.onError?.(result.error, data.kind)
        break
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 2)
      let evType = 'message'
      const dataLines: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) evType = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (!evType || evType === 'message') continue
      const text = dataLines.join('\n')
      let parsed: AgentServerSSE | null = null
      try { parsed = JSON.parse(text) } catch { continue }
      if (!parsed) continue
      dispatch(evType, parsed)
      if (evType === 'agent.completed' || evType === 'agent.error') {
        return result
      }
    }
  }
  if (!result.error && !result.text) {
    result.error = 'انقطع البث قبل إكمال المهمة (مهلة الخادم أو إغلاق القناة). وحّد السؤال أو أعد تشغيل الغرفة ثم أعد المحاولة.'
    opts.onEvent.onError?.(result.error, 'timeout')
  }
  return result
}

export async function approveServerApproval(opts: { project_id: string; approval_id: string; mode: AgentServerMode; signal?: AbortSignal; onEvent?: AgentServerEvents }): Promise<{ ok: boolean; message?: string }> {
  const res = await authedFetch(
    { project_id: opts.project_id, mode: opts.mode, approve_approval_id: opts.approval_id, message: '' },
    opts.signal,
  )
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const b = await res.json(); msg = b?.message ?? b?.error ?? msg } catch { /* ignore */ }
    return { ok: false, message: msg }
  }
  if (opts.onEvent) {
    let failure: string | null = null
    await consumeSse(res, opts.onEvent, () => {}, false, (m) => { failure = m })
    return { ok: !failure, message: failure ?? 'نُفّذت الموافقة عبر وكيل الخادم' }
  }
  const body = await res.text()
  if (body.includes('"agent.error"')) return { ok: false, message: 'فشل تطبيق الموافقة من الخادم' }
  return { ok: true, message: 'نُفّذت الموافقة عبر وكيل الخادم' }
}

export async function rejectServerApproval(opts: { project_id: string; approval_id: string; signal?: AbortSignal }): Promise<{ ok: boolean; message?: string }> {
  const res = await authedFetch(
    { project_id: opts.project_id, reject_approval_id: opts.approval_id, message: '' },
    opts.signal,
  )
  if (!res.ok) return { ok: false, message: `HTTP ${res.status}` }
  const body = await res.text()
  if (body.includes('"agent.error"')) return { ok: false, message: 'فشل حفظ الرفض' }
  return { ok: true, message: 'رُفض الطلب — لم يُنفَّذ أي تغيير' }
}

async function consumeSse(res: Response, events: AgentServerEvents, onDone: () => void, _unused: boolean, onFailure?: (m: string) => void): Promise<void> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 2)
      let evType = 'message'
      const dataLines: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) evType = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (evType === 'message' || !dataLines.length) continue
      let parsed: any = null
      try { parsed = JSON.parse(dataLines.join('\n')) } catch { continue }
      if (evType === 'assistant.delta' && parsed.text) events.onDelta?.(parsed.text)
      else if (evType === 'tool.start') events.onToolStart?.(parsed.id, parsed.name, parsed.args ?? '')
      else if (evType === 'tool.completed') events.onToolDone?.(parsed.id, parsed.name, Boolean(parsed.ok), parsed.output ?? '', { errorType: parsed.errorType ?? null, statusCode: parsed.statusCode ?? null, durationMs: parsed.durationMs ?? null, retried: Boolean(parsed.retried) })
      else if (evType === 'approval.required') events.onApproval?.(parsed)
      else if (evType === 'approval.resolved') events.onApprovalResolved?.(parsed)
      else if (evType === 'file.changed') { events.onFileChanged?.(parsed.path, parsed.diff); events.onDiff?.(parsed.path, parsed.diff, parsed.action) }
      else if (evType === 'command.dispatched') events.onCommandDispatched?.(parsed.workflow)
      else if (evType === 'terminal') events.onTerminal?.(parsed)
      else if (evType === 'run.start') events.onRunStart?.(parsed)
      else if (evType === 'message.start') events.onMessageStart?.(parsed)
      else if (evType === 'agent.completed') { events.onCompleted?.(parsed); onDone(); return }
      else if (evType === 'agent.error') { onFailure?.(parsed.message ?? 'فشل التطبيق من الخادم'); events.onError?.(parsed.message ?? 'فشل', parsed.kind); onDone(); return }
    }
  }
  onDone()
}