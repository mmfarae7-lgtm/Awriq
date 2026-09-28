export interface DiffLine {
  type: 'add' | 'rem' | 'ctx'
  text: string
}

/**
 * Minimal line diff: computes a colored add/remove/context listing from two
 * strings. Good enough for small-to-medium file previews in the room.
 */
export function buildLineDiff(before: string | null | undefined, after: string | null | undefined): DiffLine[] {
  const a = (before ?? '').split('\n')
  const b = (after ?? '').split('\n')
  if (a.length === 1 && a[0] === '') a.pop()
  if (b.length === 1 && b[0] === '') b.pop()

  const rem: DiffLine[] = []
  const add: DiffLine[] = []
  const out: DiffLine[] = []

  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flushStash()
      out.push({ type: 'ctx', text: a[i] })
      i++
      j++
    } else if (i < a.length && (j >= b.length || a[i] !== b[j]) && j < b.length && a[i + 1] === b[j]) {
      flushStash()
      rem.push({ type: 'rem', text: a[i] })
      i++
    } else if (j < b.length && (i >= a.length || a[i] !== b[j])) {
      add.push({ type: 'add', text: b[j] })
      j++
    } else if (i < a.length) {
      rem.push({ type: 'rem', text: a[i] })
      i++
    }
  }
  flushStash()

  function flushStash() {
    if (rem.length && add.length) {
      out.push(...rem.map(r => ({ type: 'rem' as const, text: r.text })))
      out.push(...add.map(a2 => ({ type: 'add' as const, text: a2.text })))
    } else if (rem.length) {
      out.push(...rem.map(r => ({ type: 'rem' as const, text: r.text })))
    } else if (add.length) {
      out.push(...add.map(a2 => ({ type: 'add' as const, text: a2.text })))
    }
    rem.length = 0
    add.length = 0
  }

  return out
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const l of lines) {
    if (l.type === 'add') added++
    else if (l.type === 'rem') removed++
  }
  return { added, removed }
}