import { describe, expect, it } from 'vitest'
import { buildLineDiff, diffStats, type DiffLine } from '../diff'

describe('buildLineDiff', () => {
  it('returns context for identical content', () => {
    const out = buildLineDiff('a\nb', 'a\nb')
    expect(out).toEqual([
      { type: 'ctx', text: 'a' },
      { type: 'ctx', text: 'b' },
    ])
  })

  it('marks an added and a removed line on a replacement', () => {
    const out = buildLineDiff('before\nafter', 'before\nchanged')
    const types = out.map((l) => l.type)
    expect(types).toContain('add')
    expect(types).toContain('rem')
    expect(types).toContain('ctx')
    const stats = diffStats(out)
    expect(stats.added).toBe(1)
    expect(stats.removed).toBe(1)
  })

  it('treats empty input as no lines', () => {
    expect(buildLineDiff(null, null)).toEqual([])
    expect(buildLineDiff(undefined, '')).toEqual([])
  })

  it('surfaces a fully-added file', () => {
    const out = buildLineDiff('', 'x\ny\nz')
    const stats = diffStats(out)
    expect(stats.added).toBe(3)
    expect(stats.removed).toBe(0)
    expect(out.every((l) => l.type === 'add')).toBe(true)
  })

  it('reports removal-only content', () => {
    const out = buildLineDiff('keep\nsell\n', 'keep\n')
    const stats = diffStats(out)
    expect(stats.removed).toBe(1)
    expect(stats.added).toBe(0)
  })

  it('keeps order stable: ctx lines never reorder (regression)', () => {
    const out = buildLineDiff('one\ntwo\nthree', 'one\nTWO\nthree')
    const texts = out.map((l) => l.text)
    expect(texts[0]).toBe('one')
    expect(texts[texts.length - 1]).toBe('three')
    const line: DiffLine = out[0]
    expect(line.type).toBe('ctx')
  })
})