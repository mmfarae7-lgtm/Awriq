import { describe, expect, it } from 'vitest'
import { normalPath, globToRegExp, SECRET_PATTERNS } from '../ai/agentTools'

describe('normalPath', () => {
  it('passes through clean relative paths', () => {
    expect(normalPath('src/lib/github.ts')).toBe('src/lib/github.ts')
    expect(normalPath('package.json')).toBe('package.json')
  })

  it('strips a single leading /', () => {
    expect(normalPath('/src/app.ts')).toBe('src/app.ts')
  })

  it('rejects traversal, dot segments, empties and absolute-with-..', () => {
    expect(normalPath('../secret')).toBe('')
    expect(normalPath('foo/../../etc/passwd')).toBe('')
    expect(normalPath('./x')).toBe('')
    expect(normalPath('a//b')).toBe('')
    expect(normalPath('')).toBe('')
    expect(normalPath('   ')).toBe('')
    expect(normalPath('/')).toBe('')
  })

  it('normalizes backslashes', () => {
    expect(normalPath('src\\lib\\x.ts')).toBe('src/lib/x.ts')
  })

  it('trims trailing slashes but keeps the rest', () => {
    expect(normalPath('src/lib/')).toBe('src/lib')
  })
})

describe('globToRegExp', () => {
  it('matches simple and ** globs', () => {
    expect(globToRegExp('*.ts').test('a.ts')).toBe(true)
    expect(globToRegExp('*.ts').test('a.tsx')).toBe(false)
    expect(globToRegExp('**/*.test.ts').test('src/a.test.ts')).toBe(true)
    expect(globToRegExp('*.ts').test('src/a.ts')).toBe(false)
    expect(globToRegExp('?og.png').test('dog.png')).toBe(true)
  })
})

describe('SECRET_PATTERNS', () => {
  it('recognizes representative secrets and masks nothing (regex only check)', () => {
    const txt = 'const t = "ghp_abcd1234ABCD5678XYZ90000111122223333abcd";'
    const hit = SECRET_PATTERNS.some(([, re]) => re.test(txt))
    expect(hit).toBe(true)
  })

  it('does not match plain text', () => {
    const txt = 'export const x = 42; // no secrets here'
    const hit = SECRET_PATTERNS.some(([, re]) => re.test(txt))
    expect(hit).toBe(false)
  })
})