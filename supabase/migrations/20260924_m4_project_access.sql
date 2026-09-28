/*
# AWRIQ Platform Migration M4 - Project Access (Project-Scoped Agent Tokens)

## Purpose
Deliver the AWRIQ Project Access layer on top of the existing schema (Reuse First):

1. `projects`: add `slug` (unique), `status`, `repository_type` for project-level
   identity/lifecycle used by the Project Access API.
2. `access_tokens`: add `profile` (READ_ONLY / DEVELOPER / FULL_AGENT) and
   `permissions` (canonical permission codes). Legacy `scopes` column is kept and
   still honoured for backward compatibility.
3. `agent_sessions`: add `lifecycle` (active/expired/revoked/closed), `agent_client`
   (e.g. `awriq-cli` / `opencode`) and `last_activity_at`.
4. `agent_approvals`: accept `denied` as an alias of `rejected` (aligns with the
   Phase 14 requirement: pending/approved/denied/expired) without breaking the
   existing `rejected` status used by the frontend.
5. `audit_logs`: add `project_id` + `token_id` so every Project Access action is
   traceable to project + credential.
6. `project_snapshots`: snapshot foundation (git-state metadata for files that live
   on a remote repository; foundation for future restore).

Non-destructive: no DROP/TRUNCATE of existing data. All statements idempotent.

Status: M4 (see docs/AWRIQ-SPEC.md)
*/

-- ============================================
-- 1. PROJECTS: identity + lifecycle
-- ============================================
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS repository_type text NOT NULL DEFAULT 'github';

-- backfill unique slugs (destructive only for the freshly-added empty column)
DO $$
DECLARE
  r record;
  base text;
  candidate text;
  i int;
BEGIN
  FOR r IN SELECT id, name FROM projects WHERE slug IS NULL OR slug = '' LOOP
    base := lower(regexp_replace(regexp_replace(r.name, '[^a-zA-Z0-9]+', '-', 'g'), '^-+|-+$', '', 'g'));
    IF base = '' THEN base := 'project'; END IF;
    IF EXISTS (SELECT 1 FROM projects WHERE slug = base AND id <> r.id) THEN
      i := 2;
      WHILE EXISTS (SELECT 1 FROM projects WHERE slug = base || '-' || i AND id <> r.id) LOOP
        i := i + 1;
      END LOOP;
      candidate := base || '-' || i;
    ELSE
      candidate := base;
    END IF;
    UPDATE projects SET slug = candidate WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE projects ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS projects_slug_key ON projects(slug);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_status_check') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_status_check CHECK (status IN ('active', 'archived', 'disabled'));
  END IF;
END $$;

-- ============================================
-- 2. ACCESS TOKENS: profile + canonical permissions
-- ============================================
ALTER TABLE access_tokens
  ADD COLUMN IF NOT EXISTS profile text NOT NULL DEFAULT 'READ_ONLY',
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'access_tokens_profile_check') THEN
    ALTER TABLE access_tokens DROP CONSTRAINT access_tokens_profile_check;
  END IF;
  ALTER TABLE access_tokens ADD CONSTRAINT access_tokens_profile_check
    CHECK (profile IN ('READ_ONLY', 'DEVELOPER', 'FULL_AGENT'));
END $$;

-- ============================================
-- 3. AGENT SESSIONS: lifecycle (work status preserved as-is)
-- ============================================
ALTER TABLE agent_sessions
  ADD COLUMN IF NOT EXISTS lifecycle text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS agent_client text,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_sessions_lifecycle_check') THEN
    ALTER TABLE agent_sessions DROP CONSTRAINT agent_sessions_lifecycle_check;
  END IF;
  ALTER TABLE agent_sessions ADD CONSTRAINT agent_sessions_lifecycle_check
    CHECK (lifecycle IN ('active', 'expired', 'revoked', 'closed'));
END $$;

-- ============================================
-- 4. AGENT_APPROVALS: extend status with 'denied' (keeps 'rejected' working)
-- ============================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_approvals_status_check') THEN
    ALTER TABLE agent_approvals DROP CONSTRAINT agent_approvals_status_check;
  END IF;
  ALTER TABLE agent_approvals ADD CONSTRAINT agent_approvals_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'denied', 'expired'));
END $$;

-- refresh the review policy (M3) so 'denied' can be recorded by reviewers
DROP POLICY IF EXISTS "agent_approvals_review" ON agent_approvals;
CREATE POLICY "agent_approvals_review" ON agent_approvals FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM agent_sessions s WHERE s.id = session_id AND s.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM agent_sessions s WHERE s.id = session_id AND public.user_can_manage_project(s.project_id))
  )
  WITH CHECK (
    status IN ('pending', 'approved', 'rejected', 'denied', 'expired')
    AND reviewed_by IS NOT DISTINCT FROM auth.uid()
  );

-- ============================================
-- 5. AUDIT_LOGS: project + token traceability
-- ============================================
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS token_id uuid REFERENCES access_tokens(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_project_id ON audit_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_token_id ON audit_logs(token_id);

-- ============================================
-- 6. PROJECT_SNAPSHOTS: snapshot foundation
-- ============================================
CREATE TABLE IF NOT EXISTS project_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id uuid REFERENCES agent_sessions(id) ON DELETE SET NULL,
  snapshot_id text NOT NULL,
  label text NOT NULL,
  branch text,
  commit_sha text,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'restored', 'failed')),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, snapshot_id)
);

CREATE INDEX IF NOT EXISTS idx_project_snapshots_project_id ON project_snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_project_snapshots_session_id ON project_snapshots(session_id);

ALTER TABLE project_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_snapshots_select_scoped" ON project_snapshots;
CREATE POLICY "project_snapshots_select_scoped" ON project_snapshots FOR SELECT
  TO authenticated USING (
    public.user_can_manage_project(project_id)
    OR public.user_is_project_member(project_id)
    OR EXISTS (SELECT 1 FROM agent_sessions s WHERE s.id = session_id AND s.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "project_snapshots_insert_manage" ON project_snapshots;
CREATE POLICY "project_snapshots_insert_manage" ON project_snapshots FOR INSERT
  TO authenticated WITH CHECK (public.user_can_manage_project(project_id));

DROP POLICY IF EXISTS "project_snapshots_delete_manage" ON project_snapshots;
CREATE POLICY "project_snapshots_delete_manage" ON project_snapshots FOR DELETE
  TO authenticated USING (public.user_can_manage_project(project_id));

DROP POLICY IF EXISTS "project_snapshots_update_manage" ON project_snapshots;
CREATE POLICY "project_snapshots_update_manage" ON project_snapshots FOR UPDATE
  TO authenticated USING (public.user_can_manage_project(project_id))
  WITH CHECK (public.user_can_manage_project(project_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON project_snapshots TO authenticated;

-- ============================================
-- 7. GRANTS (paranoia: keep bridging grants explicit)
-- ============================================
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;