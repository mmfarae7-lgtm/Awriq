/*
# AWRIQ Platform Migration M4d - Project Access UI support policies

Project managers/owners (and members) can view/close agent sessions of their
projects and view the project audit logs. Append-only: existing policies kept.

Status: M4d (see docs/AWRIQ-SPEC.md)
*/

DROP POLICY IF EXISTS "agent_sessions_select_managed" ON agent_sessions;
CREATE POLICY "agent_sessions_select_managed" ON agent_sessions FOR SELECT
  TO authenticated USING (
    public.user_can_manage_project(project_id)
    OR public.user_is_project_member(project_id)
  );

DROP POLICY IF EXISTS "agent_sessions_update_managed" ON agent_sessions;
CREATE POLICY "agent_sessions_update_managed" ON agent_sessions FOR UPDATE
  TO authenticated USING (
    public.user_can_manage_project(project_id)
    OR public.user_is_project_member(project_id)
  ) WITH CHECK (
    public.user_can_manage_project(project_id)
    OR public.user_is_project_member(project_id)
  );

DROP POLICY IF EXISTS "audit_logs_select_project_scoped" ON audit_logs;
CREATE POLICY "audit_logs_select_project_scoped" ON audit_logs FOR SELECT
  TO authenticated USING (
    project_id IS NOT NULL AND (
      public.user_can_manage_project(project_id)
      OR public.user_is_project_member(project_id)
    )
  );