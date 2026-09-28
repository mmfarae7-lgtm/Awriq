// AWRIQ Project Access API - server-side gateway for project-scoped agent tokens
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ALLOWED_ORIGINS = [
  "https://awriq-awriq1.vercel.app",
  "http://localhost:5173",
];

const MAX_FILE_READ_BYTES = 1_000_000;
const MAX_FILE_WRITE_CHARS = 512_000;
const MAX_COMMAND_CHARS = 2000;

// ---------------------------------------------------------------------------
// Profiles + canonical permission model
// ---------------------------------------------------------------------------
const PROFILE_PERMISSIONS: Record<string, string[]> = {
  READ_ONLY: [
    "files.read", "files.find", "git.read", "logs.read",
    "snapshots.list", "commands.read", "provider.read", "deploy.read",
    "sessions.create", "sessions.list", "sessions.close", "tokens.read",
  ],
  DEVELOPER: [
    "files.read", "files.find", "files.write", "files.create", "files.delete", "files.rename",
    "git.read", "git.write", "logs.read", "datastore.read", "deploy.read",
    "snapshots.create", "snapshots.list", "commands.read", "commands.execute", "commands.interact",
    "provider.read", "sessions.create", "sessions.list", "sessions.close", "tokens.read", "tokens.rotate",
  ],
  FULL_AGENT: [
    "files.read", "files.find", "files.write", "files.create", "files.delete", "files.rename",
    "git.read", "git.write", "logs.read",
    "datastore.read", "datastore.write", "deploy.read", "deploy.trigger",
    "snapshots.create", "snapshots.restore", "snapshots.list",
    "commands.read", "commands.execute", "commands.interact",
    "provider.read", "sessions.create", "sessions.list", "sessions.close",
    "tokens.read", "tokens.rotate", "approval.respond", "project.settings", "deployment.execute",
  ],
};

// Legacy scope strings -> canonical permissions (backward compatibility)
const LEGACY_TO_CANONICAL: Record<string, string[]> = {
  "file:read": ["files.read", "files.find"],
  "file:write": ["files.write"],
  "file:create": ["files.create"],
  "file:delete": ["files.delete"],
  "terminal:read": ["commands.read"],
  "terminal:execute": ["commands.execute", "commands.interact"],
  "logs:read": ["logs.read"],
  "git:read": ["git.read"],
  "git:write": ["git.write"],
  "project:read": ["project.settings", "sessions.list", "tokens.read"],
  "project:write": ["project.settings"],
  "agent:execute": ["sessions.create", "commands.execute", "commands.interact", "files.read", "files.find"],
  "deploy:execute": ["snapshots.create", "deploy.trigger", "deploy.read", "deployment.execute"],
  "database:read": ["datastore.read", "logs.read"],
  "database:write": ["datastore.read", "datastore.write"],
};

function effectivePermissions(token: any): string[] {
  if (Array.isArray(token.permissions) && token.permissions.length) return token.permissions as string[];
  if (Array.isArray(token.scopes) && token.scopes.length) {
    const set = new Set<string>();
    for (const s of token.scopes) {
      for (const p of LEGACY_TO_CANONICAL[s] ?? []) set.add(p);
    }
    if (set.size) return [...set];
  }
  return PROFILE_PERMISSIONS[token.profile] ?? [];
}

// ---------------------------------------------------------------------------
// Path security (Phase 8): canonicalization + traversal defense + deny list
// ---------------------------------------------------------------------------
const DENY_BASENAMES: RegExp[] = [
  /^\.env($|\.)/i,
  /^\.npmrc$/i,
  /^\.yarnrc$/i,
  /^\.netrc$/i,
  /^\.gitconfig$/i,
  /^\.git-credentials?$/i,
  /^\.git$/i,
  /^\.aws$/i,
  /^\.ssh$/i,
  /^id_rsa/i,
  /^id_dsa/i,
  /^id_ecdsa/i,
  /^id_ed25519/i,
  /credential/i,
  /secret/i,
  /service-account/i,
  /private[_-]?key/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.pkcs8$/i,
  /\.der$/i,
  /\.dump$/i,
  /\.dmp$/i,
  /\.sql\.gz$/i,
  /\.tar\.gz$/i,
];

function canonicalizePath(input: unknown, rootPath?: string | null) {
  if (typeof input !== "string" || !input.trim()) {
    return { ok: false as const, code: "PATH_INVALID", message: "path is required" };
  }
  const path = input.trim();
  if (path.length > 2000) return { ok: false as const, code: "PATH_INVALID", message: "path is too long" };
  if (path.includes("\\")) return { ok: false as const, code: "PATH_INVALID", message: "backslashes are not allowed" };
  if (path.includes("\0") || path.includes(":")) return { ok: false as const, code: "PATH_INVALID", message: "path contains invalid characters" };
  if (path.startsWith("/") || path.startsWith("~")) return { ok: false as const, code: "PATH_INVALID", message: "absolute paths are not allowed" };

  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") return { ok: false as const, code: "PATH_ESCAPE", message: "path traversal is not allowed" };
    out.push(seg);
  }
  if (!out.length) return { ok: false as const, code: "PATH_INVALID", message: "empty path" };
  const canonical = out.join("/");

  const scope = (rootPath || "/").trim().replace(/^\/+|\/+$/g, "");
  if (scope && scope !== "/" && !(canonical === scope || canonical.startsWith(scope + "/"))) {
    return { ok: false as const, code: "PATH_OUTSIDE_SCOPE", message: "path is outside the allowed project root" };
  }
  for (const item of out) {
    if (DENY_BASENAMES.some((rx) => rx.test(item))) {
      return { ok: false as const, code: "PATH_FORBIDDEN", message: `access to sensitive path is not allowed (${item})` };
    }
  }
  return { ok: true as const, path: canonical };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function ipFrom(req: Request): string | undefined {
  const xff = req.headers.get("x-forwarded-for");
  const candidate = xff ? xff.split(",")[0].trim() : undefined;
  if (candidate && /^[0-9a-fA-F.:]+$/.test(candidate) && !candidate.includes(" ")) return candidate;
  return undefined;
}

function json(body: unknown, status = 200, req?: Request): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const origin = req?.headers.get("origin") || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function err(code: string, message: string, status = 400, req?: Request): Response {
  return json({ ok: false, error: { code, message } }, status, req);
}

// ---------------------------------------------------------------------------
// Auditing + security events
// ---------------------------------------------------------------------------
async function audit(ctx: any, action: string, resource: string, resourceId: string | null, result: string, details: string, metadata: Record<string, unknown> = {}) {
  await supabase.from("audit_logs").insert({
    action,
    resource,
    resource_id: resourceId,
    institution_id: ctx.project.institution_id ?? null,
    project_id: ctx.project.id,
    token_id: ctx.token.id,
    user_id: ctx.token.created_by ?? null,
    ip_address: ctx.ip,
    user_agent: ctx.agent_client,
    metadata: { via: "project-access", token_prefix: ctx.token.token_prefix, result, ...metadata },
  });
}

async function securityEvent(req: Request, eventType: string, severity: string, description: string, metadata: Record<string, unknown> = {}) {
  const ip = ipFrom(req);
  const row: Record<string, unknown> = {
    event_type: eventType,
    severity,
    description,
    metadata: { via: "project-access", ...metadata },
  };
  if (ip) row.ip_address = ip;
  await supabase.from("security_events").insert(row);
}

// ---------------------------------------------------------------------------
// Authentication (Phase 4/5): token lookup by SHA-256 hash only
// ---------------------------------------------------------------------------
async function authenticate(req: Request) {
  const authz = req.headers.get("authorization") || "";
  if (!authz.startsWith("Bearer ")) {
    return { error: { status: 401, code: "TOKEN_MISSING", message: "Bearer token required" } } as const;
  }
  const raw = authz.slice(7).trim();
  if (!raw) {
    return { error: { status: 401, code: "TOKEN_MISSING", message: "Bearer token required" } } as const;
  }
  const hash = await sha256Hex(raw);
  const { data, error } = await supabase
    .from("access_tokens")
    .select(`*, projects(*)`)
    .eq("token_hash", hash)
    .maybeSingle();
  if (error || !data) {
    await securityEvent(req, "token_auth_failed", "high", "Project access token rejected", {
      token_prefix: raw.slice(0, 12) + "...",
      reason: "unknown_token",
    });
    return { error: { status: 401, code: "TOKEN_INVALID", message: "Invalid or unknown token" } } as const;
  }
  const token = data as any;
  const project = token.projects as any;

  if (token.status !== "active") {
    const reason = token.status === "expired" ? "token_expired" : "token_not_active";
    await securityEvent(req, "token_auth_failed", "high", "Non-active token used", {
      token_prefix: token.token_prefix,
      status: token.status,
      reason,
    });
    return { error: { status: 401, code: reason === "token_expired" ? "TOKEN_EXPIRED" : "TOKEN_REVOKED", message: "Token is not active" } } as const;
  }
  if (token.expires_at !== null && new Date(token.expires_at).getTime() < Date.now()) {
    await supabase.from("access_tokens").update({ status: "expired" }).eq("id", token.id);
    await securityEvent(req, "token_auth_failed", "high", "Expired token rejected", { token_prefix: token.token_prefix });
    return { error: { status: 401, code: "TOKEN_EXPIRED", message: "Token has expired" } } as const;
  }
  if (!project || !project.is_active || project.status === "disabled") {
    await securityEvent(req, "token_auth_failed", "high", "Token for disabled project rejected", { project: project?.id });
    return { error: { status: 403, code: "PROJECT_DISABLED", message: "Project is disabled" } } as const;
  }
  if (project.status && project.status !== "active") {
    await securityEvent(req, "token_auth_failed", "high", "Project status not active", { project: project.id, status: project.status });
    return { error: { status: 403, code: "PROJECT_DISABLED", message: "Project is not active" } } as const;
  }

  const ip = ipFrom(req);
  await supabase.from("access_tokens").update({
    last_used_at: new Date().toISOString(),
    ...(ip ? { last_ip: ip } : {}),
  }).eq("id", token.id);

  const ctx = {
    token,
    project,
    perms: effectivePermissions(token),
    ip,
    agent_client: req.headers.get("x-agent-client") || "unknown",
    sessionId: req.headers.get("x-session-id") || null,
  };
  if (ctx.sessionId) {
    const { data: sess } = await supabase.from("agent_sessions")
      .select("id, project_id")
      .eq("id", ctx.sessionId).maybeSingle();
    if (sess && sess.project_id === project.id) {
      await supabase.from("agent_sessions")
        .update({ last_activity_at: new Date().toISOString() })
        .eq("id", sess.id);
    }
  }
  return { ctx } as const;
}

function permit(ctx: any, perm: string, req: Request) {
  if (!ctx.perms.includes(perm)) {
    return err("PERMISSION_DENIED", `Missing permission: ${perm}`, 403, req);
  }
  return null;
}

async function getSessionInProject(ctx: any, sessionId: string) {
  const { data, error } = await supabase
    .from("agent_sessions")
    .select("id, project_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.project_id !== ctx.project.id) return null;
  return data;
}

// ---------------------------------------------------------------------------
// GitHub read helpers (raw.githubusercontent + contents API)
// ---------------------------------------------------------------------------
function parseRepo(url: string | null | undefined) {
  if (!url) return null;
  const m = url.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}

function ghHeaders(token?: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "awriq-project-access",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

// Reads use the project's stored GitHub credentials automatically, so the agent
// never needs to supply its own GitHub token. Agent-supplied X-Git-Token wins.
async function storedGitToken(ctx: any, req: Request): Promise<string | null> {
  const override = req.headers.get("x-git-token");
  if (override) return override;
  try {
    const creds = await getProjectCredentials(ctx.project.id);
    if (creds?.github_token) return decryptSecret(ctx.project.id, creds.github_token);
  } catch { /* stored token unavailable; anonymous read may still work */ }
  return null;
}

async function githubContent(owner: string, repo: string, path: string, ref: string | null, token?: string | null) {
  let url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  if (ref) url += `?ref=${encodeURIComponent(ref)}`;
  const res = await fetch(url, { headers: ghHeaders(token) });
  if (res.status === 404) return { error: "NOT_FOUND" } as const;
  if (res.status === 401 || res.status === 403) return { error: "GIT_FORBIDDEN" } as const;
  if (!res.ok) return { error: "GIT_ERROR", detail: `GitHub ${res.status}` } as const;
  return { data: await res.json() } as const;
}

function b64decode(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------------------
// Secret storage (Phase 26+): AES-256-GCM at rest with PAX_MASTER_KEY
// ---------------------------------------------------------------------------
function b64FromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64FromString(s: string): string {
  const bytes = new TextEncoder().encode(s);
  return b64FromBytes(bytes);
}

async function secretKey(projectId: string): Promise<CryptoKey> {
  const data = new TextEncoder().encode(`${Deno.env.get("PAX_MASTER_KEY") ?? ""}:${projectId}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return crypto.subtle.importKey("raw", new Uint8Array(digest), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptSecret(projectId: string, plaintext: string) {
  if (!Deno.env.get("PAX_MASTER_KEY")) {
    return { ok: false as const, code: "SECRETS_UNCONFIGURED", message: "PAX_MASTER_KEY secret is not configured" };
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await secretKey(projectId);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return { ok: true as const, value: `enc:v1:${b64FromBytes(iv)}:${b64FromBytes(new Uint8Array(ct))}` };
}

async function decryptSecret(projectId: string, value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (!value.startsWith("enc:v1:")) return value;
  const parts = value.split(":");
  if (parts.length < 4) return null;
  try {
    const iv = Uint8Array.from(atob(parts[2]), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(parts[3]), (c) => c.charCodeAt(0));
    const key = await secretKey(projectId);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

function maskSecret(v: string | null | undefined): { set: boolean; masked: string | null } {
  if (!v) return { set: false, masked: null };
  if (v.length <= 6) return { set: true, masked: "••••" };
  return { set: true, masked: `${v.slice(0, 2)}•••${v.slice(-3)}` };
}

async function getProjectCredentials(projectId: string) {
  const { data, error } = await supabase
    .from("project_credentials")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data as any | null;
}

async function credsMasked(row: any) {
  const github = maskSecret(row?.github_token);
  const vercel = maskSecret(row?.vercel_token);
  const service = maskSecret(row?.supabase_service_key);
  return {
    has_github: github.set,
    github_token_masked: github.masked,
    has_vercel: vercel.set,
    vercel_token_masked: vercel.masked,
    vercel_project_id: row?.vercel_project_id ?? null,
    supabase_project_ref: row?.supabase_project_ref ?? null,
    supabase_url: row?.supabase_url ?? null,
    has_supabase_anon: !!(row?.supabase_anon_key && row.supabase_anon_key.length),
    has_supabase_service: service.set,
    datastore_write_enabled: !!row?.datastore_write_enabled,
    auto_deploy: !!row?.auto_deploy,
  };
}

// ---------------------------------------------------------------------------
// Admin (AWRIQ staff) auth: Bearer JWT from the AWRIQ frontend session
// ---------------------------------------------------------------------------
async function adminAuth(req: Request) {
  const authz = req.headers.get("authorization") || "";
  const raw = authz.startsWith("Bearer eyJ") ? authz.slice(7).trim() : null;
  if (!raw) return { admin: null } as const;
  const { data, error } = await supabase.auth.getUser(raw);
  if (error || !data.user) {
    await securityEvent(req, "admin_auth_failed", "high", "Admin JWT rejected", { reason: error?.message });
    return { admin: null } as const;
  }
  return { admin: data.user } as const;
}

async function canManageProject(userId: string, projectId: string): Promise<boolean> {
  if (!userId || !projectId) return false;
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId);
  const names = (roleRows ?? []).map((r: any) => r?.roles?.name);
  if (names.some((n) => ["super_admin", "central_admin", "developer"].includes(n))) return true;
  const { data: member } = await supabase.from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("role", "owner")
    .maybeSingle();
  return member !== null;
}

async function auditAdmin(req: Request, ctx: any, action: string, resource: string, resourceId: string | null, result: string, details: string, metadata: Record<string, unknown> = {}) {
  await supabase.from("audit_logs").insert({
    action,
    resource,
    resource_id: resourceId,
    institution_id: ctx.project.institution_id ?? null,
    project_id: ctx.project.id,
    token_id: null,
    user_id: ctx.token.created_by ?? null,
    ip_address: ctx.ip,
    user_agent: ctx.agent_client,
    metadata: { via: "project-access", actor: "admin", result, ...metadata },
  });
}

// ---------------------------------------------------------------------------
// Datastore proxy: target Supabase via PostgREST with the target anon key so the
// target's OWN RLS governs every read/write. Service key never leaves AWRIQ.
// ---------------------------------------------------------------------------
const FORBIDDEN_DATASTORE = /^(pg_|information_schema|auth\.|auth_users|storage\.|vault\.|realtime\.|metrics\.)/i;
const TABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]{0,127}$/;
const OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "cs", "cd"]);

async function datastoreTarget(projectId: string) {
  const creds = await getProjectCredentials(projectId);
  const url = creds?.supabase_url?.trim();
  const key = creds?.supabase_anon_key?.trim();
  if (!url || !key) {
    return { ok: false as const, code: "DATASTORE_UNCONFIGURED", message: "Target Supabase (url + anon key) is not configured for this project" };
  }
  return { ok: true as const, url: url.replace(/\/+$/, ""), key };
}

function dsHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };
}

function checkDsTable(table: unknown) {
  if (typeof table !== "string" || !TABLE_NAME_RE.test(table)) {
    return { ok: false as const, code: "TABLE_INVALID", message: "Invalid table name" };
  }
  if (FORBIDDEN_DATASTORE.test(table)) {
    return { ok: false as const, code: "TABLE_FORBIDDEN", message: "Table is not accessible via the gateway" };
  }
  return { ok: true as const };
}

async function dsResError(res: Response) {
  try {
    const j = await res.json();
    return `${res.status} ${j.message ?? j.code ?? res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

async function datastoreTables(req: Request, ctx: any) {
  const target = await datastoreTarget(ctx.project.id);
  if (!target.ok) return err(target.code, target.message, 409, req);
  let res: Response;
  try {
    res = await fetch(`${target.url}/rest/v1/`, { headers: dsHeaders(target.key) });
  } catch (e) {
    return err("DATASTORE_ERROR", e instanceof Error ? e.message : "net error", 502, req);
  }
  let note = res.ok
    ? null
    : "Target does not allow table listing with the anon key; use datastore/query with a specific table.";
  let tables: string[] = [];
  if (res.ok) {
    try {
      const doc = await res.json();
      tables = Object.keys(doc).filter((k) => k !== "openapi" && k !== "info").sort();
    } catch {
      note ||= "Target returned an unreadable OpenAPI document";
    }
  }
  await audit(ctx, "datastore.tables", "datastore", ctx.project.id, "success", "Listed target tables", { count: tables.length, note: note ?? undefined });
  return json({ ok: true, data: { tables, note } }, 200, req);
}

async function datastoreQuery(req: Request, ctx: any, body: any) {
  const target = await datastoreTarget(ctx.project.id);
  if (!target.ok) return err(target.code, target.message, 409, req);
  const t = checkDsTable(body.table);
  if (!t.ok) return err(t.code, t.message, 400, req);
  const select = typeof body.select === "string" && body.select.trim() ? body.select.trim() : "*";
  const limit = Math.max(1, Math.min(500, Number(body.limit) || 100));
  const offset = Math.max(0, Number(body.offset) || 0);
  const params = new URLSearchParams();
  params.set("select", select);
  params.set("limit", String(limit));
  if (offset) params.set("offset", String(offset));
  const order = typeof body.order === "string" && body.order.trim() ? body.order.trim() : null;
  if (order) params.set("order", order);
  if (Array.isArray(body.filters)) {
    for (const f of body.filters) {
      if (!f || typeof f !== "object") continue;
      const col = typeof f.column === "string" ? f.column : null;
      const op = typeof f.operator === "string" && OPS.has(f.operator) ? f.operator : null;
      const val = f.value;
      if (!col || !op) continue;
      if (op === "in" && Array.isArray(val)) params.append(col, `in.(${val.map(encodeURIComponent).join(",")})`);
      else params.append(col, `${op}.${String(val)}`);
    }
  }
  const query = params.toString();
  let res: Response;
  try {
    res = await fetch(`${target.url}/rest/v1/${body.table}?${query}`, { headers: dsHeaders(target.key) });
  } catch (e) {
    return err("DATASTORE_ERROR", e instanceof Error ? e.message : "net error", 502, req);
  }
  if (!res.ok) return err("DATASTORE_ERROR", await dsResError(res), 502, req);
  const rows = await res.json().catch(() => []);
  await audit(ctx, "datastore.read", "datastore", ctx.project.id, "success", `Datastore query on ${body.table}`, { table: body.table, rows: Array.isArray(rows) ? rows.length : 0 });
  return json({ ok: true, data: { table: body.table, count: Array.isArray(rows) ? rows.length : 0, rows: Array.isArray(rows) ? rows : [] } }, 200, req);
}

async function datastoreWrite(req: Request, ctx: any, route: string, body: any) {
  const creds = await getProjectCredentials(ctx.project.id);
  if (!creds?.datastore_write_enabled) {
    return err("DATASTORE_WRITE_DISABLED", "Datastore writes are disabled for this project", 403, req);
  }
  const target = await datastoreTarget(ctx.project.id);
  if (!target.ok) return err(target.code, target.message, 409, req);
  const t = checkDsTable(body.table);
  if (!t.ok) return err(t.code, t.message, 400, req);
  const filters = Array.isArray(body.filters) ? body.filters : [];
  const paramBuilder = new URLSearchParams();
  for (const f of filters) {
    if (!f || typeof f !== "object") continue;
    const col = typeof f.column === "string" ? f.column : null;
    const op = typeof f.operator === "string" && OPS.has(f.operator) ? f.operator : "eq";
    if (!col) continue;
    paramBuilder.append(col, `${op}.${String(f.value)}`);
  }
  const qs = paramBuilder.toString();
  let res: Response;
  try {
    if (route === "datastore/insert") {
      const rows = Array.isArray(body.rows) ? body.rows.slice(0, 100) : [];
      if (!rows.length) return err("BAD_REQUEST", "rows is required", 400, req);
      res = await fetch(`${target.url}/rest/v1/${body.table}`, {
        method: "POST", headers: { ...dsHeaders(target.key), Prefer: "return=representation" },
        body: JSON.stringify(rows),
      });
    } else if (route === "datastore/update") {
      if (!qs) return err("BAD_REQUEST", "filters are required for update", 400, req);
      const changes = body.changes && typeof body.changes === "object" ? body.changes : null;
      if (!changes) return err("BAD_REQUEST", "changes is required", 400, req);
      res = await fetch(`${target.url}/rest/v1/${body.table}?${qs}`, {
        method: "PATCH", headers: { ...dsHeaders(target.key), Prefer: "return=representation" },
        body: JSON.stringify(changes),
      });
    } else {
      if (!qs) return err("BAD_REQUEST", "filters are required for delete", 400, req);
      res = await fetch(`${target.url}/rest/v1/${body.table}?${qs}`, {
        method: "DELETE", headers: dsHeaders(target.key),
      });
    }
  } catch (e) {
    return err("DATASTORE_ERROR", e instanceof Error ? e.message : "net error", 502, req);
  }
  if (!res.ok) return err("DATASTORE_ERROR", await dsResError(res), 502, req);
  const out = await res.json().catch(() => null);
  await audit(ctx, `datastore.${route === "datastore/insert" ? "insert" : route === "datastore/update" ? "update" : "delete"}`, "datastore", ctx.project.id, "success", `Datastore write on ${body.table}`, { table: body.table });
  return json({ ok: true, data: { table: body.table, result: out ?? { applied: true } } }, 200, req);
}

// ---------------------------------------------------------------------------
// Deployments (Vercel) + deployment_records
// ---------------------------------------------------------------------------
async function doDeploy(req: Request, ctx: any, projectId: string): Promise<{ deployment: any; error?: Response }> {
  const creds = await getProjectCredentials(projectId);
  let provider = "vercel";
  let status = "queued";
  let uid: string | null = null;
  let extUrl: string | null = null;
  let message = "Deployment queued";
  if (creds?.vercel_token && creds?.vercel_project_id) {
    const token = await decryptSecret(projectId, creds.vercel_token);
    if (!token) return { deployment: null, error: err("SECRETS_UNCONFIGURED", "Vercel token could not be decrypted", 500, req) };
    try {
      const find = await fetch(
        `https://api.vercel.com/v13/deployments?projectId=${encodeURIComponent(creds.vercel_project_id)}&target=production&limit=1`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const found = await find.json();
      const latest = Array.isArray(found.deployments) ? found.deployments[0] : null;
      if (latest?.uid) {
        const rd = await fetch(`https://api.vercel.com/v13/deployments/${latest.uid}/redeploy`, {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        const rj = await rd.json().catch(() => ({}));
        if (rd.ok) {
          uid = rj.uid ?? latest.uid;
          extUrl = rj.url ? `https://${rj.url}` : latest.url ? `https://${latest.url}` : null;
          status = "building";
          message = "Vercel redeploy triggered";
        } else {
          status = "error";
          message = `Vercel redeploy failed: ${rj.error?.code ?? rd.status}`;
        }
      } else {
        status = "queued";
        message = "Vercel: no previous deployment to redeploy; a push will trigger the build";
      }
    } catch (e) {
      status = "error";
      message = `Vercel error: ${e instanceof Error ? e.message : "unknown"}`;
    }
  } else {
    provider = "external";
    status = "queued";
    message = "Push-ready; deployment is handled outside AWRIQ (hosting provider)";
  }
  const { data, error } = await supabase.from("deployment_records").insert({
    project_id: projectId,
    institution_id: ctx.project.institution_id ?? null,
    provider,
    status,
    deployment_uid: uid,
    external_url: extUrl,
    message,
    session_id: ctx.sessionId ?? null,
    approval_id: ctx.approvalId ?? null,
    deployed_by: ctx.token.created_by ?? null,
  }).select("*").single();
  if (error) return { deployment: null, error: err("DB_ERROR", error.message, 500, req) };
  await audit(ctx, "deploy.triggered", "deployment_record", data.id, "success", `Deployment started (${provider}/${status})`, { provider, message });
  return { deployment: data };
}

async function listDeployments(req: Request, ctx: any) {
  const { data, error } = await supabase.from("deployment_records")
    .select("*")
    .eq("project_id", ctx.project.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return err("DB_ERROR", error.message, 500, req);
  return json({ ok: true, data: { deployments: data ?? [] } }, 200, req);
}

// ---------------------------------------------------------------------------
// Git apply: commit approved file changes to GitHub using stored PAT
// ---------------------------------------------------------------------------
async function gitApplyChanges(req: Request, ctx: any, body: any) {
  const repo = parseRepo(ctx.project.repository_url);
  if (!repo) return err("GIT_UNCONFIGURED", "Project has no GitHub repository", 400, req);
  const creds = await getProjectCredentials(ctx.project.id);
  if (!creds?.github_token) return err("GIT_UNCONFIGURED", "No stored GitHub credentials for this project", 409, req);
  const ghToken = await decryptSecret(ctx.project.id, creds.github_token);
  if (!ghToken) return err("GIT_UNCONFIGURED", "Stored GitHub credentials could not be decrypted", 409, req);

  const approvalIds = Array.isArray(body.approval_ids) ? body.approval_ids.filter((x: unknown) => typeof x === "string") : [];
  if (!approvalIds.length) return err("BAD_REQUEST", "approval_ids is required", 400, req);

  const { data: mySessions } = await supabase.from("agent_sessions").select("id").eq("token_id", ctx.token.id);
  const sessionIds = (mySessions ?? []).map((s: any) => s.id);
  if (!sessionIds.length) return err("SESSION_INVALID", "No sessions belong to this token", 403, req);

  const { data: approvals, error: apprLoadErr } = await supabase.from("agent_approvals")
    .select("id, action_type, status, session_id")
    .in("id", approvalIds)
    .in("session_id", sessionIds)
    .in("status", ["approved"]);
  if (apprLoadErr) return err("DB_ERROR", apprLoadErr.message, 500, req);
  const foundIds = new Set((approvals ?? []).map((a: any) => a.id));
  const missing = approvalIds.filter((id: string) => !foundIds.has(id));
  if (missing.length) return err("APPROVAL_REQUIRED", `Approvals are not owned or not approved: ${missing.join(",")}`, 403, req);

  const branch = typeof body.branch === "string" && body.branch.trim() ? body.branch.trim() : "main";
  const baseMessage = typeof body.message === "string" && body.message.trim() ? body.message.trim().slice(0, 200) : "AWRIQ: approved changes";

  const committed: any[] = [];
  const failures: any[] = [];
  for (const appr of approvals ?? []) {
    const { data: changes } = await supabase.from("agent_file_changes")
      .select("id, file_path, change_type, new_content")
      .eq("approval_id", appr.id);
    for (const ch of changes ?? []) {
      const cw = canonicalizePath(ch.file_path, ctx.project.root_path);
      if (!cw.ok) { failures.push({ path: ch.file_path, error: cw.code }); continue; }
      const cur = await githubContent(repo.owner, repo.repo, cw.path, branch, ghToken);
      const sha = "data" in cur ? ((cur.data as any).sha ?? null) : null;
      const msg = `${baseMessage} — ${ch.change_type} ${cw.path}`;
      try {
        if (ch.change_type === "delete") {
          if (!sha) { failures.push({ path: cw.path, error: "FILE_NOT_FOUND" }); continue; }
          const res = await fetch(
            `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${encodeURIComponent(cw.path)}`,
            { method: "DELETE", headers: ghHeaders(ghToken), body: JSON.stringify({ message: msg, sha, branch }) },
          );
          if (!res.ok) throw new Error(`GitHub DELETE ${res.status}: ${((await res.json().catch(() => ({ message: "" }))) as any).message}`);
          committed.push({ path: cw.path, change_type: "delete", sha });
        } else {
          const payload: any = { message: msg, content: b64FromString(ch.new_content ?? ""), branch };
          if (sha) payload.sha = sha;
          const res = await fetch(
            `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${encodeURIComponent(cw.path)}`,
            { method: "PUT", headers: ghHeaders(ghToken), body: JSON.stringify(payload) },
          );
          if (!res.ok) throw new Error(`GitHub PUT ${res.status}: ${((await res.json().catch(() => ({ message: "" }))) as any).message}`);
          const rd = await res.json();
          committed.push({ path: cw.path, change_type: ch.change_type, sha: rd?.content?.sha ?? sha });
        }
        await supabase.from("agent_file_changes").update({ is_approved: true }).eq("id", ch.id);
      } catch (e) {
        failures.push({ path: cw.path, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  const okCount = committed.length;
  await audit(ctx, "git.apply", "git", ctx.project.id, failures.length ? "partial" : "success",
    `Applied ${okCount} approved change(s), ${failures.length} failed`, { branch, files: committed.map((c) => c.path) });

  if (failures.length && !okCount) {
    await securityEvent(req, "git_apply_failure", "high", "Approved changes failed to commit", { project: ctx.project.id, failures });
    return err("GIT_APPLY_FAILED", JSON.stringify(failures).slice(0, 500), 409, req);
  }

  let deployment: any = null;
  if (okCount > 0 && creds.auto_deploy) {
    const d = await doDeploy(req, ctx, ctx.project.id);
    if (!d.error) deployment = d.deployment;
  }

  return json({ ok: true, data: { applied: okCount, failed: failures.length, branch, committed, failures, deployment } }, 200, req);
}

// ---------------------------------------------------------------------------
// Admin handler (AWRIQ staff, JWT from frontend session)
// ---------------------------------------------------------------------------
async function handleAdmin(req: Request, route: string): Promise<Response> {
  const { admin } = await adminAuth(req);
  if (!admin) return err("AUTH_INVALID", "Valid AWRIQ admin session required", 401, req);
  const method = req.method;
  const query = new URL(req.url).searchParams;
  let projectId = method === "GET" ? query.get("project_id") : null;
  let body: any = {};
  if (method !== "GET") {
    body = await req.json().catch(() => ({}));
    projectId = body.project_id;
  }
  if (!projectId || typeof projectId !== "string") return err("BAD_REQUEST", "project_id is required", 400, req);
  const manage = await canManageProject(admin.id, projectId);
  if (!manage) {
    await securityEvent(req, "project_denied_admin", "critical", "Admin lacks manage access to project", { project: projectId });
    return err("PROJECT_ACCESS_DENIED", "No manager access to this project", 403, req);
  }
  const { data: projRow } = await supabase.from("projects").select("id, institution_id").eq("id", projectId).maybeSingle();
  if (!projRow) return err("NOT_FOUND", "Project not found", 404, req);
  const ctx: any = {
    project: { id: projectId, institution_id: projRow.institution_id },
    token: { id: null, created_by: admin.id, token_prefix: "admin" },
    ip: ipFrom(req),
    agent_client: "awriq-admin",
    sessionId: null,
    approvalId: null,
  };

  if (route === "credentials" && method === "GET") {
    const row = await getProjectCredentials(projectId);
    return json({ ok: true, data: { credentials: await credsMasked(row) } }, 200, req);
  }
  if (route === "credentials" && method === "POST") {
    const row = await getProjectCredentials(projectId);
    const patch: any = {};
    for (const [k, v] of Object.entries(body)) {
      if (!["github_token", "vercel_token", "vercel_project_id", "supabase_project_ref", "supabase_url", "supabase_anon_key", "supabase_service_key", "datastore_write_enabled", "auto_deploy"].includes(k)) continue;
      if (["github_token", "vercel_token", "supabase_service_key"].includes(k)) {
        if (v === "" || v === null) patch[k] = null;
        else if (typeof v === "string") {
          const enc = await encryptSecret(projectId, v);
          if (!enc.ok) return err(enc.code, enc.message, 500, req);
          patch[k] = enc.value;
        }
      } else if (typeof v === "boolean") patch[k] = v;
      else if (typeof v === "string") patch[k] = v;
    }
    patch.updated_by = admin.id;
    const { error } = row?.project_id
      ? await supabase.from("project_credentials").update({ ...patch, updated_at: new Date().toISOString() }).eq("project_id", projectId)
      : await supabase.from("project_credentials").insert({ project_id: projectId, ...patch });
    if (error) return err("DB_ERROR", error.message, 500, req);
    await auditAdmin(req, ctx, "credentials.updated", "project_credentials", projectId, "success", "Project credentials updated", { fields: Object.keys(patch) });
    return json({ ok: true, data: { credentials: await credsMasked({ ...(row ?? {}), ...patch }) } }, 200, req);
  }
  if (route === "deploys" && method === "POST") {
    const d = await doDeploy(req, ctx, projectId);
    if (d.error) return d.error;
    return json({ ok: true, data: { deployment: d.deployment } }, 201, req);
  }
  if (route === "deploys" && method === "GET") return listDeployments(req, ctx);
  if (route === "datastore/tables") return datastoreTables(req, ctx);
  if (route === "datastore/query" && method === "POST") return datastoreQuery(req, ctx, body);
  if (["datastore/insert", "datastore/update", "datastore/delete"].includes(route) && method === "POST") return datastoreWrite(req, ctx, route, body);
  return err("NOT_FOUND", `Unknown admin route: /${route}`, 404, req);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin") || "";
    if (!ALLOWED_ORIGINS.includes(origin)) return err("CORS_ORIGIN_FORBIDDEN", "Origin not allowed", 403, req);
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Agent-Client, X-Session-Id, X-Git-Token",
        "Vary": "Origin",
      },
    });
  }

  const { pathname } = new URL(req.url);
  let segs = pathname.split("/").filter(Boolean);
  if (segs[0] === "project-access") segs = segs.slice(1);
  const route = segs.join("/");

  // Admin staff requests (AWRIQ JWT session) are handled separately
  if ((req.headers.get("authorization") || "").startsWith("Bearer eyJ")) {
    try {
      return await handleAdmin(req, route);
    } catch (e) {
      return err("INTERNAL_ERROR", e instanceof Error ? e.message : "Internal error", 500, req);
    }
  }

  const auth = await authenticate(req);
  if ("error" in auth) return err(auth.error.code, auth.error.message, auth.error.status, req);
  const ctx = auth.ctx;

  // Project isolation guard: any client-supplied project must match the token's project
  if (req.method !== "GET") {
    try {
      const body = await req.json().catch(() => ({}));
      if (body.project_id && body.project_id !== ctx.project.id) {
        await securityEvent(req, "project_isolation_violation", "critical",
          "Client supplied a different project_id than the token scope", {
          supplied: body.project_id,
          expected: ctx.project.id,
          token_prefix: ctx.token.token_prefix,
        });
        return err("PROJECT_ACCESS_DENIED", "Access to this project is not allowed for this token", 403, req);
      }
      ctx.body = body;
    } catch {
      return err("BAD_REQUEST", "Invalid JSON body", 400, req);
    }
  }

  try {
    if (route === "" || route === "me") {
      return json({
        ok: true,
        data: {
          project: { id: ctx.project.id, slug: ctx.project.slug, name: ctx.project.name, repository_url: ctx.project.repository_url, root_path: ctx.project.root_path },
          token: { id: ctx.token.id, name: ctx.token.name, profile: ctx.token.profile, prefix: ctx.token.token_prefix, expires_at: ctx.token.expires_at, permissions: ctx.perms },
        },
      }, 200, req);
    }

    // ---- Sessions ----
    if (route === "sessions" && req.method === "POST") {
      const denied = permit(ctx, "sessions.create", req); if (denied) return denied;
      const b = ctx.body;
      const mode = typeof b.mode === "string" ? b.mode : "read_only";
      const now = new Date().toISOString();
      const { data, error } = await supabase.from("agent_sessions").insert({
        project_id: ctx.project.id,
        institution_id: ctx.project.institution_id ?? null,
        token_id: ctx.token.id,
        user_id: ctx.token.created_by ?? null,
        mode,
        status: "idle",
        permissions: ctx.perms,
        lifecycle: "active",
        agent_client: ctx.agent_client,
        started_at: now,
        last_activity_at: now,
        created_at: now,
      }).select("id, mode, status, lifecycle, started_at, agent_client").single();
      if (error) return err("DB_ERROR", error.message, 500, req);
      await audit(ctx, "session.created", "agent_session", data.id, "success", `Agent session created (${mode})`);
      return json({ ok: true, data: { session: data } }, 201, req);
    }

    if (route === "sessions" && req.method === "GET") {
      const denied = permit(ctx, "sessions.list", req); if (denied) return denied;
      const { data, error } = await supabase.from("agent_sessions")
        .select("id, mode, status, lifecycle, agent_client, started_at, ended_at, last_activity_at, created_at")
        .eq("project_id", ctx.project.id)
        .order("started_at", { ascending: false })
        .limit(100);
      if (error) return err("DB_ERROR", error.message, 500, req);
      return json({ ok: true, data: { sessions: data } }, 200, req);
    }

    if (route.startsWith("sessions/") && route.endsWith("/close") && req.method === "POST") {
      const denied = permit(ctx, "sessions.close", req); if (denied) return denied;
      const id = route.split("/")[1];
      const sess = await getSessionInProject(ctx, id);
      if (!sess) return err("PROJECT_ACCESS_DENIED", "Session not found in this project", 403, req);
      const { error } = await supabase.from("agent_sessions").update({
        status: "stopped", lifecycle: "closed", ended_at: new Date().toISOString(), last_activity_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) return err("DB_ERROR", error.message, 500, req);
      await audit(ctx, "session.closed", "agent_session", id, "success", "Agent session closed");
      return json({ ok: true, data: { session_id: id, status: "closed" } }, 200, req);
    }

    // ---- Approvals ----
    if (route === "approvals" && req.method === "GET") {
      const denied = permit(ctx, "commands.read", req); if (denied) return denied;
      const status = new URL(req.url).searchParams.get("status") || "pending";
      const { data: mySessions, error: sessErr } = await supabase
        .from("agent_sessions")
        .select("id")
        .eq("token_id", ctx.token.id);
      if (sessErr) return err("DB_ERROR", sessErr.message, 500, req);
      const sessionIds = (mySessions ?? []).map((s: any) => s.id);
      if (!sessionIds.length) return json({ ok: true, data: { approvals: [] } }, 200, req);
      let q = supabase.from("agent_approvals")
        .select("id, action_type, description, risk_level, status, commands, files_affected, expires_at, created_at")
        .in("session_id", sessionIds)
        .order("created_at", { ascending: false })
        .limit(100);
      if (status && status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) return err("DB_ERROR", error.message, 500, req);
      return json({ ok: true, data: { approvals: data } }, 200, req);
    }

    // ---- Commands (Phase 13/14: authorization + audit only; execution is local after approval) ----
    if (route === "commands" && req.method === "POST") {
      const denied = permit(ctx, "commands.execute", req); if (denied) return denied;
      const b = ctx.body;
      if (typeof b.command !== "string" || !b.command.trim()) return err("BAD_REQUEST", "command is required", 400, req);
      if (b.command.length > MAX_COMMAND_CHARS) return err("BAD_REQUEST", "command is too long", 400, req);
      const sess = await getSessionInProject(ctx, String(b.session_id || ""));
      if (!sess) return err("SESSION_INVALID", "Session not found in this project", 403, req);

      const workingDir = typeof b.working_dir === "string" && b.working_dir ? b.working_dir : null;
      if (workingDir) {
        const cw = canonicalizePath(workingDir, ctx.project.root_path);
        if (!cw.ok) {
          await securityEvent(req, "command_path_forbidden", "critical", `Invalid command working_dir: ${cw.code}`, { project: ctx.project.id });
          return err(cw.code, cw.message, 403, req);
        }
      }

      const dangerous =
        /(rm\s+-[a-z]*r|git\s+push\s.*(--force|-f\b)|git\s+reset\s+--hard|git\s+checkout\s+\.|drop\s+table|drop\s+database|sudo|mkfs|chmod\s+777|\|\s*(sh|bash)\b)/i
          .test(b.command);
      const riskLevel = dangerous ? "critical" : "medium";

      const { data: cmdData, error: cmdErr } = await supabase.from("agent_commands").insert({
        session_id: sess.id,
        command: b.command,
        working_dir: workingDir,
        is_approved: false,
      }).select("id").single();
      if (cmdErr) return err("DB_ERROR", cmdErr.message, 500, req);

      const { data: apprData, error: apprErr } = await supabase.from("agent_approvals").insert({
        session_id: sess.id,
        user_id: ctx.token.created_by ?? null,
        action_type: "command_execute",
        description: typeof b.reason === "string" && b.reason ? b.reason : b.command.slice(0, 160),
        risk_level: riskLevel,
        commands: [b.command],
        status: "pending",
      }).select("id, action_type, description, risk_level, status, expires_at").single();
      if (apprErr) return err("DB_ERROR", apprErr.message, 500, req);

      await supabase.from("agent_sessions").update({ status: "waiting_approval", last_activity_at: new Date().toISOString() }).eq("id", sess.id);
      await audit(ctx, "command.requested", "agent_command", cmdData.id, "pending",
        `Command requires approval (${riskLevel})`, { command: b.command.slice(0, 200) });
      return json({ ok: true, data: { command_id: cmdData.id, approval: apprData } }, 201, req);
    }

    // ---- Files (Phase 7-9) ----
    if (route === "tree" && req.method === "GET") {
      const denied = permit(ctx, "files.read", req); if (denied) return denied;
      const params = new URL(req.url).searchParams;
      const cw = canonicalizePath(params.get("path") || "", ctx.project.root_path);
      if (!cw.ok) {
        await securityEvent(req, "path_forbidden", "high", `Invalid tree path: ${cw.code}`, { project: ctx.project.id });
        return err(cw.code, cw.message, 403, req);
      }
      const repo = parseRepo(ctx.project.repository_url);
      if (!repo) return err("GIT_UNCONFIGURED", "Project has no GitHub repository", 400, req);
      const ref = params.get("ref");
      const token = await storedGitToken(ctx, req);
      const g = await githubContent(repo.owner, repo.repo, cw.path, ref, token);
      if ("error" in g) return err(g.error, `GitHub: ${g.detail ?? "not found"}`, g.error === "NOT_FOUND" ? 404 : 502, req);
      const entries = Array.isArray(g.data)
        ? g.data.map((e: any) => ({ name: e.name, path: e.path, type: e.type, size: e.size ?? null }))
        : [{ name: g.data.name, path: g.data.path, type: g.data.type, size: g.data.size }];
      return json({ ok: true, data: { path: cw.path, entries } }, 200, req);
    }

    if (route === "file" && req.method === "GET") {
      const denied = permit(ctx, "files.read", req); if (denied) return denied;
      const params = new URL(req.url).searchParams;
      const cw = canonicalizePath(params.get("path") || "", ctx.project.root_path);
      if (!cw.ok) {
        await securityEvent(req, "path_forbidden", "high", `Invalid file path: ${cw.code}`, { project: ctx.project.id });
        return err(cw.code, cw.message, 403, req);
      }
      const repo = parseRepo(ctx.project.repository_url);
      if (!repo) return err("GIT_UNCONFIGURED", "Project has no GitHub repository", 400, req);
      const ref = params.get("ref");
      const token = await storedGitToken(ctx, req);
      const g = await githubContent(repo.owner, repo.repo, cw.path, ref, token);
      if ("error" in g) return err(g.error, `GitHub: ${g.detail ?? "not found"}`, g.error === "NOT_FOUND" ? 404 : 502, req);
      if (Array.isArray(g.data)) return err("NOT_FOUND", "Path is a directory", 400, req);
      if ((g.data.size ?? 0) > MAX_FILE_READ_BYTES) return err("FILE_TOO_LARGE", "File exceeds read size limit", 413, req);
      const content = g.data.encoding === "base64" ? b64decode(g.data.content) : (g.data.content || "");
      await audit(ctx, "file.read", "file", cw.path, "success", "File read via gateway", { sha: g.data.sha });
      return json({ ok: true, data: { path: cw.path, sha: g.data.sha, size: g.data.size, content } }, 200, req);
    }

    if (route === "files/write" && req.method === "POST") {
      const denied = permit(ctx, "files.write", req); if (denied) return denied;
      const b = ctx.body;
      if (typeof b.content !== "string") return err("BAD_REQUEST", "content is required", 400, req);
      if (b.content.length > MAX_FILE_WRITE_CHARS) return err("BAD_REQUEST", "content exceeds write limit", 413, req);
      const cw = canonicalizePath(b.path, ctx.project.root_path);
      if (!cw.ok) {
        await securityEvent(req, "path_forbidden", "critical", `Write blocked: ${cw.code}`, { project: ctx.project.id });
        return err(cw.code, cw.message, 403, req);
      }
      const sess = await getSessionInProject(ctx, String(b.session_id || ""));
      if (!sess) return err("SESSION_INVALID", "Session not found in this project", 403, req);
      const changeType = b.change_type === "create" ? "create" : "modify";
      const files = [{ path: cw.path, change_type: changeType }];
      const { data: apprData, error: apprErr } = await supabase.from("agent_approvals").insert({
        session_id: sess.id,
        user_id: ctx.token.created_by ?? null,
        action_type: "file_modify",
        description: `${changeType} ${cw.path}`,
        risk_level: "medium",
        files_affected: files,
        status: "pending",
      }).select("id").single();
      if (apprErr) return err("DB_ERROR", apprErr.message, 500, req);
      const { data: fcData, error: fcErr } = await supabase.from("agent_file_changes").insert({
        session_id: sess.id,
        project_id: ctx.project.id,
        file_path: cw.path,
        change_type: changeType,
        new_content: b.content,
        is_approved: false,
        approval_id: apprData.id,
      }).select("id").single();
      if (fcErr) return err("DB_ERROR", fcErr.message, 500, req);
      await supabase.from("agent_sessions").update({ status: "waiting_approval", last_activity_at: new Date().toISOString() }).eq("id", sess.id);
      await audit(ctx, "file.change_requested", "file", cw.path, "pending", `${changeType} staged for approval`, { approval_id: apprData.id });
      return json({ ok: true, data: { change_id: fcData.id, approval_id: apprData.id, status: "pending" } }, 201, req);
    }

    if (route === "files/delete" && req.method === "POST") {
      const denied = permit(ctx, "files.delete", req); if (denied) return denied;
      const b = ctx.body;
      const cw = canonicalizePath(b.path, ctx.project.root_path);
      if (!cw.ok) {
        await securityEvent(req, "path_forbidden", "critical", `Delete blocked: ${cw.code}`, { project: ctx.project.id });
        return err(cw.code, cw.message, 403, req);
      }
      const sess = await getSessionInProject(ctx, String(b.session_id || ""));
      if (!sess) return err("SESSION_INVALID", "Session not found in this project", 403, req);
      const files = [{ path: cw.path, change_type: "delete" }];
      const { data: apprData, error: apprErr } = await supabase.from("agent_approvals").insert({
        session_id: sess.id,
        user_id: ctx.token.created_by ?? null,
        action_type: "file_delete",
        description: `delete ${cw.path}`,
        risk_level: "high",
        files_affected: files,
        status: "pending",
      }).select("id").single();
      if (apprErr) return err("DB_ERROR", apprErr.message, 500, req);
      const { data: fcData, error: fcErr } = await supabase.from("agent_file_changes").insert({
        session_id: sess.id,
        project_id: ctx.project.id,
        file_path: cw.path,
        change_type: "delete",
        is_approved: false,
        approval_id: apprData.id,
      }).select("id").single();
      if (fcErr) return err("DB_ERROR", fcErr.message, 500, req);
      await supabase.from("agent_sessions").update({ status: "waiting_approval", last_activity_at: new Date().toISOString() }).eq("id", sess.id);
      await audit(ctx, "file.delete_requested", "file", cw.path, "pending", "Delete staged for approval", { approval_id: apprData.id });
      return json({ ok: true, data: { change_id: fcData.id, approval_id: apprData.id, status: "pending" } }, 201, req);
    }

    // ---- Snapshots (Phase 15/16) ----
    if (route === "snapshots" && req.method === "POST") {
      const denied = permit(ctx, "snapshots.create", req); if (denied) return denied;
      const b = ctx.body;
      const label = typeof b.label === "string" && b.label.trim() ? b.label.slice(0, 200) : `snapshot-${Date.now()}`;
      const branch = typeof b.branch === "string" ? b.branch : null;
      const commitSha = typeof b.commit_sha === "string" ? b.commit_sha : null;
      const meta = b.metadata && typeof b.metadata === "object" ? b.metadata : {};
      const sess = b.session_id ? await getSessionInProject(ctx, String(b.session_id)) : null;
      const snapshotId = `snap_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const { data, error } = await supabase.from("project_snapshots").insert({
        project_id: ctx.project.id,
        session_id: sess?.id ?? null,
        snapshot_id: snapshotId,
        label,
        branch,
        commit_sha: commitSha,
        status: "created",
        metadata: { ...meta, record_type: "git_state", via: "project-access" },
        created_by: ctx.token.created_by ?? null,
      }).select("id, snapshot_id, label, branch, commit_sha, status, created_at").single();
      if (error) return err("DB_ERROR", error.message, 500, req);
      await audit(ctx, "snapshot.created", "project_snapshot", snapshotId, "success", `Snapshot created: ${label}`);
      return json({ ok: true, data: { snapshot: data } }, 201, req);
    }

    if (route === "snapshots" && req.method === "GET") {
      const denied = permit(ctx, "snapshots.list", req); if (denied) return denied;
      const { data, error } = await supabase.from("project_snapshots")
        .select("id, snapshot_id, label, branch, commit_sha, status, created_at")
        .eq("project_id", ctx.project.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return err("DB_ERROR", error.message, 500, req);
      return json({ ok: true, data: { snapshots: data } }, 200, req);
    }

    // ---- Logs (Phase 12) ----
    if (route === "logs" && req.method === "GET") {
      const denied = permit(ctx, "logs.read", req); if (denied) return denied;
      const { data, error } = await supabase.from("audit_logs")
        .select("id, action, resource, resource_id, created_at, metadata")
        .eq("project_id", ctx.project.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return err("DB_ERROR", error.message, 500, req);
      return json({ ok: true, data: { logs: data } }, 200, req);
    }

    // ---- Credentials status (masked, no secrets ever returned) ----
    if (route === "credentials/status" && req.method === "GET") {
      const denied = permit(ctx, "tokens.read", req); if (denied) return denied;
      const row = await getProjectCredentials(ctx.project.id);
      return json({ ok: true, data: { credentials: await credsMasked(row) } }, 200, req);
    }

    // ---- Git apply: commit approved file changes to GitHub ----
    if (route === "changes/apply" && req.method === "POST") {
      const denied = permit(ctx, "git.write", req); if (denied) return denied;
      return gitApplyChanges(req, ctx, ctx.body);
    }

    // ---- Datastore (target Supabase via PostgREST) ----
    if (route === "datastore/tables" && req.method === "GET") {
      const denied = permit(ctx, "datastore.read", req); if (denied) return denied;
      return datastoreTables(req, ctx);
    }
    if (route === "datastore/query" && req.method === "POST") {
      const denied = permit(ctx, "datastore.read", req); if (denied) return denied;
      return datastoreQuery(req, ctx, ctx.body);
    }
    if (["datastore/insert", "datastore/update", "datastore/delete"].includes(route) && req.method === "POST") {
      const denied = permit(ctx, "datastore.write", req); if (denied) return denied;
      return datastoreWrite(req, ctx, route, ctx.body);
    }

    // ---- Deployments ----
    if (route === "deploys" && req.method === "POST") {
      const denied = permit(ctx, "deploy.trigger", req); if (denied) return denied;
      const d = await doDeploy(req, ctx, ctx.project.id);
      if (d.error) return d.error;
      return json({ ok: true, data: { deployment: d.deployment } }, 201, req);
    }
    if (route === "deploys" && req.method === "GET") {
      const denied = permit(ctx, "deploy.read", req); if (denied) return denied;
      return listDeployments(req, ctx);
    }

    return err("NOT_FOUND", `Unknown route: /${route}`, 404, req);
  } catch (e) {
    return err("INTERNAL_ERROR", e instanceof Error ? e.message : "Internal error", 500, req);
  }
});