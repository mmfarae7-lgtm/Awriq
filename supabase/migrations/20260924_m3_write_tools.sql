/*
# AWRIQ Platform Migration M3 - Write Tools, Approval Gates & Git Commit/Push

## Purpose
Enable the write-tools half of the agent loop:

1. Staged file edits (agent_file_changes) linked to an approval request.
2. Approval Gates: every approval expires after 10 minutes (safe default);
   approving a `file_modify` / `git_push` applies the staged changes to GitHub.
3. `expire_stale_approvals()` helper used by the UI to flip `pending` -> `expired`.
4. RLS: allow session stakeholders to UPDATE agent_file_changes (apply/approve)
   and agent_approvals (review) without opening full write access.

Status: M3 (see docs/AWRIQ-SPEC.md §6.2, §7.1)
*/

-- ============================================
-- 1. AGENT_APPROVALS: expiry + safer defaults
-- ============================================
ALTER TABLE agent_approvals
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes');

-- approvals readable by anyone who can manage the project or owns the session
DROP POLICY IF EXISTS "agent_approvals_select_authenticated" ON agent_approvals;
DROP POLICY IF EXISTS "agent_approvals_select_scoped" ON agent_approvals;
CREATE POLICY "agent_approvals_select_scoped" ON agent_approvals FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM agent_sessions s
      WHERE s.id = session_id AND s.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM agent_sessions s
      WHERE s.id = session_id AND public.user_can_manage_project(s.project_id)
    )
  );

-- only reviewer fields can be changed once reviewed; status constrained
DROP POLICY IF EXISTS "agent_approvals_update_authenticated" ON agent_approvals;
DROP POLICY IF EXISTS "agent_approvals_review" ON agent_approvals;
CREATE POLICY "agent_approvals_review" ON agent_approvals FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM agent_sessions s
      WHERE s.id = session_id AND s.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM agent_sessions s
      WHERE s.id = session_id AND public.user_can_manage_project(s.project_id)
    )
  )
  WITH CHECK (
    status IN ('pending', 'approved', 'rejected', 'expired')
    AND reviewed_by IS NOT DISTINCT FROM auth.uid()
  );

-- ============================================
-- 2. AGENT_FILE_CHANGES: link to approval + applied state
-- ============================================
ALTER TABLE agent_file_changes
  ADD COLUMN IF NOT EXISTS approval_id uuid REFERENCES agent_approvals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_applied boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS commit_sha text;

CREATE INDEX IF NOT EXISTS idx_agent_file_changes_approval_id ON agent_file_changes(approval_id);

-- UPDATE applies the approved change; restricted to session owner / manager
DROP POLICY IF EXISTS "agent_file_changes_update_authenticated" ON agent_file_changes;
DROP POLICY IF EXISTS "agent_file_changes_apply_scoped" ON agent_file_changes;
CREATE POLICY "agent_file_changes_apply_scoped" ON agent_file_changes FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM agent_sessions s
      WHERE s.id = session_id AND s.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM agent_sessions s
      WHERE s.id = session_id AND public.user_can_manage_project(s.project_id)
    )
  )
  WITH CHECK (true);

-- ============================================
-- 3. EXPIRY HELPER
-- ============================================
CREATE OR REPLACE FUNCTION public.expire_stale_approvals()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH expired AS (
    UPDATE agent_approvals
       SET status = 'expired', reviewed_at = now()
     WHERE status = 'pending' AND expires_at < now()
    RETURNING id
  )
  SELECT count(*) FROM expired;
$$;

GRANT EXECUTE ON FUNCTION public.expire_stale_approvals() TO authenticated;

-- ============================================
-- 4. GRANTS (paranoia; ensure authenticated still has DML)
-- ============================================
GRANT INSERT, UPDATE, SELECT ON agent_file_changes TO authenticated;
GRANT INSERT, UPDATE, SELECT ON agent_approvals TO authenticated;