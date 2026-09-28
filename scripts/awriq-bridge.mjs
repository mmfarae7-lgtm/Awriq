#!/usr/bin/env node
/**
 * AWRIQ Bridge CLI — a thin client for the `project-access` gateway.
 *
 * Usage:
 *   AWS_PROJECT_TOKEN=awriq_prj_... node awriq-bridge.mjs me
 *   node awriq-bridge.mjs --token awriq_prj_... session
 *   node awriq-bridge.mjs file --path src/lib/utils.ts
 *   node awriq-bridge.mjs command --cmd "npm test" --reason "unit tests"
 *
 * The token is used ONLY for this project (derived server-side). No master token.
 */
const GATEWAY = process.env.AWRIQ_GATEWAY_URL || "https://qkedsdzwepgscxzvqphu.functions.supabase.co/project-access";

function parseArgs(argv) {
  const out = { flags: {}, pos: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out.flags[k] = v;
    } else {
      out.pos.push(a);
    }
  }
  return out;
}

function tokenFrom(flags) {
  if (flags.token) return flags.token;
  for (const k of ["AWRIQ_PROJECT_TOKEN", "AWS_PROJECT_TOKEN"]) {
    if (process.env[k]) return process.env[k];
  }
  console.error("error: missing token. Pass --token or set AWRIQ_PROJECT_TOKEN");
  process.exit(2);
}

async function call(method, path, { token, session, gitToken, body, query = {} } = {}) {
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== "")).toString();
  const url = GATEWAY + path + (qs ? "?" + qs : "");
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  if (session) headers["X-Session-Id"] = session;
  if (gitToken) headers["X-Git-Token"] = gitToken;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`error ${res.status}:`, data?.error?.code || "failed", data?.error?.message || "");
    process.exit(1);
  }
  return data;
}

const CMD = process.argv[2];
const { flags, pos } = parseArgs(process.argv.slice(3));
const token = tokenFrom(flags);

switch (CMD) {
  case "me": {
    const r = await call("GET", "/me", { token, session: flags.session });
    console.log(JSON.stringify(r.data, null, 2));
    break;
  }
  case "session": {
    const mode = flags.mode || "read_only";
    const r = await call("POST", "/sessions", { token, body: { mode, prompt: flags.prompt } });
    console.log("session_id:", r.data.session.id);
    console.log(JSON.stringify(r.data.session, null, 2));
    break;
  }
  case "close": {
    const id = flags.id || pos[0];
    if (!id) throw new Error("close must set: close --id <session_id>");
    const r = await call("POST", `/sessions/${id}/close`, { token, session: id, body: {} });
    console.log(JSON.stringify(r.data, null, 2));
    break;
  }
  case "tree": {
    const path = flags.path || pos[0] || "";
    const r = await call("GET", "/tree", { token, query: { path, ref: flags.ref }, gitToken: flags.gitToken });
    console.log(JSON.stringify(r.data, null, 2));
    break;
  }
  case "file": {
    const path = flags.path || pos[0];
    if (!path) throw new Error("file must set: file --path <repo-path>");
    const ref = flags.ref;
    const gitToken = flags.gitToken;
    const parsed = ref ? { ref, path } : { path };
    const r = await call("GET", "/file", { token, query: parsed, gitToken });
    const content = r.data.content;
    if (flags.out) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(flags.out, content);
      console.log("written", r.data.path, `(${r.data.size} bytes)`);
    } else {
      console.log(content);
    }
    break;
  }
  case "write": {
    const path = flags.path;
    const content = flags.content ?? (await import("node:fs")).default.readFileSync(flags.file || "/dev/stdin", "utf8");
    if (!path) throw new Error("write must set: --path and --content");
    const r = await call("POST", "/files/write", {
      token, session: flags.session,
      body: { session_id: flags.session, path, content, change_type: flags.type || "modify", message: flags.message },
    });
    console.log(JSON.stringify(r.data, null, 2));
    break;
  }
  case "delete": {
    const path = flags.path;
    if (!path) throw new Error("delete must set: --path");
    const r = await call("POST", "/files/delete", { token, session: flags.session, body: { session_id: flags.session, path } });
    console.log(JSON.stringify(r.data, null, 2));
    break;
  }
  case "command": {
    const cmd = flags.cmd || pos[0];
    if (!cmd) throw new Error("command must set: --cmd");
    const r = await call("POST", "/commands", {
      token, session: flags.session,
      body: { session_id: flags.session, command: cmd, working_dir: flags.dir, reason: flags.reason },
    });
    console.log(JSON.stringify(r.data, null, 2));
    break;
  }
  case "approvals": {
    const r = await call("GET", "/approvals", { token, query: { status: flags.status || "pending" } });
    console.log(JSON.stringify(r.data, null, 2));
    break;
  }
  case "snapshot": {
    const r = await call("POST", "/snapshots", {
      token, session: flags.session,
      body: { session_id: flags.session, label: flags.label || `snapshot-${Date.now()}`, branch: flags.branch, commit_sha: flags.commit },
    });
    console.log(JSON.stringify(r.data, null, 2));
    break;
  }
  case "snapshots": {
    const r = await call("GET", "/snapshots", { token });
    console.log(JSON.stringify(r.data, null, 2));
    break;
  }
  case "logs": {
    const r = await call("GET", "/logs", { token });
    console.log(JSON.stringify(r.data, null, 2));
    break;
  }
  case "creds": {
    const r = await call("GET", "/credentials/status", { token });
    console.log(JSON.stringify(r.data.credentials, null, 2));
    break;
  }
  case "gitapply": {
    if (!flags.approvals) throw new Error("gitapply must set: --approvals <id,id,...>");
    const ids = String(flags.approvals).split(",").map((s) => s.trim()).filter(Boolean);
    const r = await call("POST", "/changes/apply", {
      token, session: flags.session,
      body: { approval_ids: ids, branch: flags.branch || "main", message: flags.message },
    });
    console.log(JSON.stringify(r.data, null, 2));
    break;
  }
  case "db-tables": {
    const r = await call("GET", "/datastore/tables", { token });
    console.log(JSON.stringify(r.data, null, 2));
    break;
  }
  case "db-query": {
    const filters = parseFilters(flags.filter);
    const r = await call("POST", "/datastore/query", {
      token,
      body: { table: flags.table, select: flags.select || "*", filters, order: flags.order, limit: flags.limit ? Number(flags.limit) : 100 },
    });
    console.log(JSON.stringify(r.data, null, 2));
    break;
  }
  case "db-insert": {
    let rows;
    try { rows = JSON.parse(flags.rows); } catch { throw new Error("db-insert must set --rows \"[json]\""); }
    const r = await call("POST", "/datastore/insert", { token, body: { table: flags.table, rows } });
    console.log(JSON.stringify(r.data, null, 2));
    break;
  }
  case "db-update": {
    let changes;
    try { changes = JSON.parse(flags.changes); } catch { throw new Error("db-update must set --changes \"{json}\""); }
    const r = await call("POST", "/datastore/update", { token, body: { table: flags.table, filters: parseFilters(flags.filter), changes } });
    console.log(JSON.stringify(r.data, null, 2));
    break;
  }
  case "db-delete": {
    const r = await call("POST", "/datastore/delete", { token, body: { table: flags.table, filters: parseFilters(flags.filter) } });
    console.log(JSON.stringify(r.data, null, 2));
    break;
  }
  case "deploy": {
    const r = await call("POST", "/deploys", { token, body: {}, session: flags.session });
    console.log(JSON.stringify(r.data, null, 2));
    break;
  }
  case "deploys": {
    const r = await call("GET", "/deploys", { token });
    console.log(JSON.stringify(r.data, null, 2));
    break;
  }
  default:
    console.error(`unknown command: ${CMD}`);
    console.error(`commands: me session close tree file write delete command approvals snapshot snapshots logs creds gitapply db-tables db-query db-insert db-update db-delete deploy deploys`);
    process.exit(2);
}

function parseFilters(filtersRaw) {
  if (!filtersRaw) return [];
  const list = Array.isArray(filtersRaw) ? filtersRaw : [filtersRaw];
  return list.flatMap((f) => String(f).split(",")).filter(Boolean).map((pair) => {
    const m = pair.match(/^([A-Za-z_][A-Za-z0-9_.]*)(?:=([^:]+):)?(.+)$/);
    if (!m) throw new Error(`invalid filter "${pair}" (expected col=op:value)`);
    const op = m[2] || "eq";
    let value = m[3];
    if (/^-?\d+$/.test(value)) value = Number(value);
    else if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (value === "null") value = null;
    return { column: m[1], operator: op, value };
  });
}