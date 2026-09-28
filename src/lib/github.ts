export interface GithubRepoRef {
  owner: string
  repo: string
  branch: string
}

export interface GithubTreeItem {
  path: string
  type: 'blob' | 'tree'
  size?: number
}

const API = 'https://api.github.com'

/** Parse a GitHub URL into owner/repo/branch. Returns null if not a GitHub URL. */
export function parseGithubUrl(url: string): GithubRepoRef | null {
  if (!url) return null
  url = url.trim()
  const m = url.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?]|$)/)
  if (!m) return null
  const owner = m[1]
  const repo = m[2]
  const branchMatch = url.match(/\/tree\/([^/#?]+)/)
  const branch = branchMatch?.[1] ?? 'HEAD'
  return { owner, repo, branch }
}

/** List the full committed file tree of a GitHub repo (recursive). */
export async function listGithubTree(ref: GithubRepoRef, token?: string): Promise<GithubTreeItem[]> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'AWRIQ-Agent/1.0',
  }
  if (token) headers.authorization = `Bearer ${token}`

  const tryBranches = ref.branch === 'HEAD' ? ['HEAD', 'main', 'master'] : [ref.branch]

  for (const branch of tryBranches) {
    const url = `${API}/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
    const res = await fetch(url, { headers })
    if (!res.ok) continue
    const data = await res.json()
    const items = (data.tree ?? []) as Array<{ path: string; type: string; size?: number }>
    return items
      .filter((i) => i.type === 'blob' || i.type === 'tree')
      .map((i) => ({ path: i.path, type: i.type as 'blob' | 'tree', size: i.size }))
  }
  throw new Error('تعذر الوصول للمستودع (تحقق من الرابط أو الصلاحية)')
}

/** Read a single file from a GitHub repo via raw content. Returns null if missing. */
export async function readGithubFile(ref: GithubRepoRef, path: string, _token?: string): Promise<string | null> {
  const headers: Record<string, string> = { 'user-agent': 'AWRIQ-Agent/1.0' }
  const tryBranches = ref.branch === 'HEAD' ? ['HEAD', 'main', 'master'] : [ref.branch]
  for (const branch of tryBranches) {
    const url = `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`
    const res = await fetch(url, { headers })
    if (!res.ok) continue
    return await res.text()
  }
  return null
}

const SENSITIVE_HINT = /(\.env|\.secret|credential|secret|private[-_]?key|password|\bpasswd\b)/i

/** Redact obvious secrets from file previews that should not reach the browser. */
export function shouldShowPlain(path: string): boolean {
  return !SENSITIVE_HINT.test(path)
}

const GITHUB_MEDIA = 'application/vnd.github+json'

async function githubJson<T>(url: string, init?: RequestInit & { auth?: string }): Promise<T> {
  const headers: Record<string, string> = {
    accept: GITHUB_MEDIA,
    'user-agent': 'AWRIQ-Agent/1.0',
    'content-type': 'application/json',
  }
  if (init?.auth) headers.authorization = `Bearer ${init.auth}`
  if (init?.headers) {
    const h = init.headers as Record<string, string>
    if (h['x-github-api-version']) headers['x-github-api-version'] = h['x-github-api-version']
  }
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } })
  if (!res.ok) {
    let msg = `HTTP ${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      msg = body?.message || body?.error?.message || msg
    } catch { /* keep default */ }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

interface GithubRefObj {
  ref: string
  object: { sha: string; type: string; url: string }
}

interface GithubCommitObj {
  sha: string
  tree: { sha: string }
}

interface GithubBlob { sha: string }
interface GithubTree { sha: string; tree: Array<{ path: string; type: string; mode: string; sha: string | null }> }

function api(repoRef: GithubRepoRef): string {
  return `${API}/repos/${repoRef.owner}/${repoRef.repo}`
}

async function resolveBranchSha(repoRef: GithubRepoRef, token?: string): Promise<{ branch: string; sha: string }> {
  const auth = token
  const candidates = repoRef.branch === 'HEAD' ? ['main', 'master'] : [repoRef.branch]
  for (const branch of candidates) {
    const ref = await githubJson<GithubRefObj>(`${api(repoRef)}/git/ref/heads/${encodeURIComponent(branch)}`, { auth }).catch(() => null)
    if (ref?.object?.sha) return { branch, sha: ref.object.sha }
  }
  throw new Error('تعذر تحديد فرع العمل (main/main).')
}

async function getTreeSha(repoRef: GithubRepoRef, commitSha: string, token?: string): Promise<string> {
  const auth = token
  const commit = await githubJson<GithubCommitObj>(`${api(repoRef)}/git/commits/${commitSha}`, { auth })
  return commit.tree.sha
}

async function createBlob(repoRef: GithubRepoRef, content: string, token?: string): Promise<string> {
  const auth = token
  const blob = await githubJson<GithubBlob>(`${api(repoRef)}/git/blobs`, {
    method: 'POST',
    auth,
    body: JSON.stringify({ content: btoa(unescape(encodeURIComponent(content))), encoding: 'base64' }),
  })
  return blob.sha
}

async function createTree(
  repoRef: GithubRepoRef,
  baseTree: string,
  deletions: string[],
  updates: Array<{ path: string; sha: string }>,
  token?: string,
): Promise<string> {
  const auth = token
  const entries: Array<{ path: string; mode: string; type: string; sha: string | null }> = [
    ...updates.map(u => ({ path: u.path, mode: '100644', type: 'blob', sha: u.sha })),
    ...deletions.map(p => ({ path: p, mode: '100644', type: 'blob', sha: null })),
  ]
  const tree = await githubJson<GithubTree>(`${api(repoRef)}/git/trees`, {
    method: 'POST',
    auth,
    body: JSON.stringify({ base_tree: baseTree, tree: entries }),
  })
  return tree.sha
}

async function createCommit(
  repoRef: GithubRepoRef,
  message: string,
  treeSha: string,
  parentSha: string,
  token?: string,
): Promise<string> {
  const auth = token
  const commit = await githubJson<GithubCommitObj>(`${api(repoRef)}/git/commits`, {
    method: 'POST',
    auth,
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  })
  return commit.sha
}

async function updateRef(repoRef: GithubRepoRef, branch: string, commitSha: string, token?: string): Promise<void> {
  const auth = token
  await githubJson(`${api(repoRef)}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    auth,
    body: JSON.stringify({ sha: commitSha, force: false }),
  })
}

export interface GithubWritePatch {
  path: string
  content: string
}

export interface GithubWriteResult {
  branch: string
  commitSha: string
  treeSha: string
}

/**
 * Commit (and push) a set of file changes to the default branch using the Git
 * Data API. Requires a token with `contents:write` scope. Creates one commit
 * containing all patches atomically (blob -> tree -> commit -> ref update).
 */
export async function commitGithubFiles(
  repoRef: GithubRepoRef,
  token: string,
  patches: GithubWritePatch[],
  message: string,
): Promise<GithubWriteResult> {
  if (!token) throw new Error('لا يوجد توكن GitHub — اضبطه في تبويب Git.')
  if (patches.length === 0) throw new Error('لا توجد تغييرات للالتزام.')

  const { branch, sha: headCommit } = await resolveBranchSha(repoRef, token)
  const baseTree = await getTreeSha(repoRef, headCommit, token)

  const updates: Array<{ path: string; sha: string }> = []
  for (const patch of patches) {
    const blobSha = await createBlob(repoRef, patch.content, token)
    updates.push({ path: patch.path, sha: blobSha })
  }

  const treeSha = await createTree(repoRef, baseTree, [], updates, token)
  const commitSha = await createCommit(repoRef, message, treeSha, headCommit, token)
  await updateRef(repoRef, branch, commitSha, token)

  return { branch, commitSha, treeSha }
}

/** Shorthand: read the current base64 sha of a path via Contents API (for single-file updates). */
export async function getFileGitSha(repoRef: GithubRepoRef, path: string, token?: string): Promise<string | null> {
  const auth = token
  const data = await githubJson<{ sha?: string }>(`${api(repoRef)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, { auth }).catch(() => null)
  return data?.sha ?? null
}

export interface AwriqDispatchResult {
  accepted: boolean
  statusCode: number
  message: string
}

/** Dispatch a GitHub Actions workflow (workflow_dispatch). Requires a token with `workflow` scope. */
export async function dispatchAwriqWorkflow(
  repoRef: GithubRepoRef,
  token: string,
  workflowPath: string,
  inputs: Record<string, string>,
): Promise<AwriqDispatchResult> {
  const ref = repoRef.branch === 'HEAD' ? 'main' : repoRef.branch
  const name = workflowPath.replace(/^\.github\/workflows\//, '')
  const url = `${api(repoRef)}/actions/workflows/${encodeURIComponent(name)}/dispatches`
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'AWRIQ-Agent/1.0' },
    body: JSON.stringify({ ref, inputs }),
  })
  if (res.ok) return { accepted: true, statusCode: res.status, message: 'أُطلقت المهمة بنجاح (قبلت البوابة 204 — ستظهر في سجل النشر).' }
  let msg = `HTTP ${res.status}`
  try { const b = await res.json(); msg = b?.message || msg } catch { /* no body */ }
  return { accepted: false, statusCode: res.status, message: msg }
}

export async function latestWorkflowRun(
  repoRef: GithubRepoRef,
  token: string,
  workflowPath: string,
): Promise<{ id: number; html_url: string; status: string } | null> {
  const name = workflowPath.replace(/^\.github\/workflows\//, '')
  const url = `${api(repoRef)}/actions/workflows/${encodeURIComponent(name)}/runs?per_page=1`
  const data = await githubJson<{ workflow_runs: Array<{ id: number; html_url: string; status: string }> }>(url, { auth: token }).catch(() => null)
  const run = data?.workflow_runs?.[0]
  return run ? { id: run.id, html_url: run.html_url, status: run.status } : null
}