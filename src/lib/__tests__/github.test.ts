import { describe, expect, it } from 'vitest'
import { parseGithubUrl } from '../github'

describe('parseGithubUrl', () => {
  it('parses a plain repo URL', () => {
    expect(parseGithubUrl('https://github.com/mmfarae7-lgtm/orion_aden')).toEqual({
      owner: 'mmfarae7-lgtm',
      repo: 'orion_aden',
      branch: 'HEAD',
    })
  })

  it('parses an ssh git URL', () => {
    expect(parseGithubUrl('git@github.com:mmfarae7-lgtm/Awriq.git')).toEqual({
      owner: 'mmfarae7-lgtm',
      repo: 'Awriq',
      branch: 'HEAD',
    })
  })

  it('extracts the branch from /tree/', () => {
    expect(parseGithubUrl('https://github.com/mmfarae7-lgtm/Awriq/tree/dev/src')).toEqual({
      owner: 'mmfarae7-lgtm',
      repo: 'Awriq',
      branch: 'dev',
    })
  })

  it('parses a URL pointing at a blob path (branch stays HEAD)', () => {
    const res = parseGithubUrl('https://github.com/mmfarae7-lgtm/Awriq/blob/main/package.json')
    expect(res).not.toBeNull()
    expect(res!.repo).toBe('Awriq')
  })

  it('handles a trailing .git suffix', () => {
    expect(parseGithubUrl('https://github.com/mmfarae7-lgtm/orion_aden.git')).toMatchObject({ repo: 'orion_aden' })
  })

  it('rejects non-GitHub urls and garbage', () => {
    expect(parseGithubUrl('https://gitlab.com/foo/bar')).toBeNull()
    expect(parseGithubUrl('npm run build')).toBeNull()
    expect(parseGithubUrl('')).toBeNull()
    expect(parseGithubUrl('  ')).toBeNull()
  })
})