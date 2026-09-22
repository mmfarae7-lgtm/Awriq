/*
# AWRIQ AI Developer Room Schema

## New Tables
1. `projects` - Projects linked to institutions for AI agent access
2. `access_tokens` - Scoped access tokens for project access
3. `token_scopes` - Many-to-many token scopes
4. `agent_sessions` - AI agent work sessions
5. `agent_tasks` - Tasks assigned to the agent
6. `agent_runs` - Individual agent execution runs
7. `agent_commands` - Commands executed by the agent
8. `agent_file_changes` - File modifications by the agent
9. `agent_approvals` - Approval requests for dangerous operations
10. `agent_logs` - Agent activity logs
11. `deployment_records` - Deployment tracking
12. `security_events` - Security event tracking
*/

-- ============================================
-- 1. PROJECTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  repository_url text,
  environment text NOT NULL DEFAULT 'development' CHECK (environment IN ('development', 'staging', 'production')),
  root_path text DEFAULT '/',
  agent_status text NOT NULL DEFAULT 'disconnected' CHECK (agent_status IN ('connected', 'disconnected', 'connecting', 'error')),
  last_agent_connection_at timestamptz,
  last_agent_run_at timestamptz,
  last_deployment_at timestamptz,
  build_status text,
  test_status text,
  health_status text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_institution_id ON projects(institution_id);
CREATE INDEX IF NOT EXISTS idx_projects_environment ON projects(environment);

-- ============================================
-- 2. ACCESS_TOKENS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  environment text NOT NULL DEFAULT 'development',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired', 'rotated')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz,
  last_used_at timestamptz,
  last_ip inet,
  rotated_from uuid REFERENCES access_tokens(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_tokens_project_id ON access_tokens(project_id);
CREATE INDEX IF NOT EXISTS idx_access_tokens_institution_id ON access_tokens(institution_id);
CREATE INDEX IF NOT EXISTS idx_access_tokens_status ON access_tokens(status);
CREATE INDEX IF NOT EXISTS idx_access_tokens_token_hash ON access_tokens(token_hash);

-- ============================================
-- 3. AGENT_SESSIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS agent_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token_id uuid REFERENCES access_tokens(id) ON DELETE SET NULL,
  mode text NOT NULL DEFAULT 'read_only' CHECK (mode IN ('read_only', 'analyze', 'fix_with_approval', 'full_development', 'emergency')),
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'connecting', 'analyzing', 'working', 'testing', 'waiting_approval', 'deploying', 'completed', 'failed', 'stopped')),
  permissions jsonb DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_id ON agent_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_project_id ON agent_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);

-- ============================================
-- 4. AGENT_TASKS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS agent_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'analyzing', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_session_id ON agent_tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_project_id ON agent_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);

-- ============================================
-- 5. AGENT_RUNS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  task_id uuid REFERENCES agent_tasks(id) ON DELETE SET NULL,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'stopped')),
  actions jsonb DEFAULT '[]'::jsonb,
  commands jsonb DEFAULT '[]'::jsonb,
  files_changed jsonb DEFAULT '[]'::jsonb,
  tests_run boolean DEFAULT false,
  tests_passed boolean,
  result text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_session_id ON agent_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_project_id ON agent_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);

-- ============================================
-- 6. AGENT_COMMANDS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS agent_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES agent_runs(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  command text NOT NULL,
  working_dir text,
  output text,
  exit_code integer,
  duration_ms integer,
  is_approved boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_commands_run_id ON agent_commands(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_commands_session_id ON agent_commands(session_id);

-- ============================================
-- 7. AGENT_FILE_CHANGES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS agent_file_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES agent_runs(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  change_type text NOT NULL CHECK (change_type IN ('create', 'modify', 'delete')),
  diff text,
  old_content text,
  new_content text,
  is_approved boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_file_changes_run_id ON agent_file_changes(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_file_changes_session_id ON agent_file_changes(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_file_changes_project_id ON agent_file_changes(project_id);

-- ============================================
-- 8. AGENT_APPROVALS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS agent_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  run_id uuid REFERENCES agent_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN ('file_delete', 'file_modify', 'command_execute', 'deploy', 'database_write', 'config_change', 'git_push', 'git_reset')),
  description text NOT NULL,
  risk_level text NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  files_affected jsonb DEFAULT '[]'::jsonb,
  commands jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_approvals_session_id ON agent_approvals(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_status ON agent_approvals(status);

-- ============================================
-- 9. AGENT_LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS agent_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES agent_sessions(id) ON DELETE CASCADE,
  run_id uuid REFERENCES agent_runs(id) ON DELETE CASCADE,
  level text NOT NULL DEFAULT 'info' CHECK (level IN ('debug', 'info', 'warning', 'error', 'critical')),
  message text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_logs_session_id ON agent_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_level ON agent_logs(level);
CREATE INDEX IF NOT EXISTS idx_agent_logs_created_at ON agent_logs(created_at DESC);

-- ============================================
-- 10. DEPLOYMENT_RECORDS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS deployment_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  version text,
  previous_version text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'deploying', 'successful', 'failed', 'rolled_back')),
  environment text NOT NULL DEFAULT 'production',
  health_check_passed boolean,
  health_check_details jsonb,
  rollback_id uuid REFERENCES deployment_records(id) ON DELETE SET NULL,
  rollback_reason text,
  deployed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deployed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deployment_records_project_id ON deployment_records(project_id);
CREATE INDEX IF NOT EXISTS idx_deployment_records_status ON deployment_records(status);

-- ============================================
-- 11. SECURITY_EVENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  institution_id uuid REFERENCES institutions(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  description text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  ip_address inet,
  is_resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity);
CREATE INDEX IF NOT EXISTS idx_security_events_institution_id ON security_events(institution_id);
CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at DESC);

-- ============================================
-- ENABLE RLS ON ALL NEW TABLES
-- ============================================
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_file_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;

-- ============================================
-- POLICIES: projects (authenticated can read, admins can manage)
-- ============================================
DROP POLICY IF EXISTS "projects_select_authenticated" ON projects;
CREATE POLICY "projects_select_authenticated" ON projects FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "projects_insert_admin" ON projects;
CREATE POLICY "projects_insert_admin" ON projects FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin', 'developer'))
  );

DROP POLICY IF EXISTS "projects_update_admin" ON projects;
CREATE POLICY "projects_update_admin" ON projects FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin', 'developer'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin', 'developer'))
  );

DROP POLICY IF EXISTS "projects_delete_super_admin" ON projects;
CREATE POLICY "projects_delete_super_admin" ON projects FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name = 'super_admin')
  );

-- ============================================
-- POLICIES: access_tokens (admin only)
-- ============================================
DROP POLICY IF EXISTS "access_tokens_select_admin" ON access_tokens;
CREATE POLICY "access_tokens_select_admin" ON access_tokens FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin', 'developer'))
  );

DROP POLICY IF EXISTS "access_tokens_insert_admin" ON access_tokens;
CREATE POLICY "access_tokens_insert_admin" ON access_tokens FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin', 'developer'))
  );

DROP POLICY IF EXISTS "access_tokens_update_admin" ON access_tokens;
CREATE POLICY "access_tokens_update_admin" ON access_tokens FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin', 'developer'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin', 'developer'))
  );

DROP POLICY IF EXISTS "access_tokens_delete_admin" ON access_tokens;
CREATE POLICY "access_tokens_delete_admin" ON access_tokens FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin'))
  );

-- ============================================
-- POLICIES: agent_sessions, agent_tasks, agent_runs, etc. (authenticated)
-- ============================================
-- Agent sessions: user owns their sessions, admins see all
DROP POLICY IF EXISTS "agent_sessions_select_own_admin" ON agent_sessions;
CREATE POLICY "agent_sessions_select_own_admin" ON agent_sessions FOR SELECT
  TO authenticated USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin', 'developer'))
  );

DROP POLICY IF EXISTS "agent_sessions_insert_own" ON agent_sessions;
CREATE POLICY "agent_sessions_insert_own" ON agent_sessions FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "agent_sessions_update_own" ON agent_sessions;
CREATE POLICY "agent_sessions_update_own" ON agent_sessions FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Agent tasks, runs, commands, file_changes, approvals, logs: authenticated can read, insert
DROP POLICY IF EXISTS "agent_tasks_select_authenticated" ON agent_tasks;
CREATE POLICY "agent_tasks_select_authenticated" ON agent_tasks FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "agent_tasks_insert_authenticated" ON agent_tasks;
CREATE POLICY "agent_tasks_insert_authenticated" ON agent_tasks FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "agent_tasks_update_authenticated" ON agent_tasks;
CREATE POLICY "agent_tasks_update_authenticated" ON agent_tasks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "agent_runs_select_authenticated" ON agent_runs;
CREATE POLICY "agent_runs_select_authenticated" ON agent_runs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "agent_runs_insert_authenticated" ON agent_runs;
CREATE POLICY "agent_runs_insert_authenticated" ON agent_runs FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "agent_runs_update_authenticated" ON agent_runs;
CREATE POLICY "agent_runs_update_authenticated" ON agent_runs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "agent_commands_select_authenticated" ON agent_commands;
CREATE POLICY "agent_commands_select_authenticated" ON agent_commands FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "agent_commands_insert_authenticated" ON agent_commands;
CREATE POLICY "agent_commands_insert_authenticated" ON agent_commands FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "agent_file_changes_select_authenticated" ON agent_file_changes;
CREATE POLICY "agent_file_changes_select_authenticated" ON agent_file_changes FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "agent_file_changes_insert_authenticated" ON agent_file_changes;
CREATE POLICY "agent_file_changes_insert_authenticated" ON agent_file_changes FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "agent_approvals_select_authenticated" ON agent_approvals;
CREATE POLICY "agent_approvals_select_authenticated" ON agent_approvals FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "agent_approvals_insert_authenticated" ON agent_approvals;
CREATE POLICY "agent_approvals_insert_authenticated" ON agent_approvals FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "agent_approvals_update_authenticated" ON agent_approvals;
CREATE POLICY "agent_approvals_update_authenticated" ON agent_approvals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "agent_logs_select_authenticated" ON agent_logs;
CREATE POLICY "agent_logs_select_authenticated" ON agent_logs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "agent_logs_insert_authenticated" ON agent_logs;
CREATE POLICY "agent_logs_insert_authenticated" ON agent_logs FOR INSERT TO authenticated WITH CHECK (true);

-- Deployment records
DROP POLICY IF EXISTS "deployment_records_select_authenticated" ON deployment_records;
CREATE POLICY "deployment_records_select_authenticated" ON deployment_records FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "deployment_records_insert_admin" ON deployment_records;
CREATE POLICY "deployment_records_insert_admin" ON deployment_records FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin', 'developer'))
  );
DROP POLICY IF EXISTS "deployment_records_update_admin" ON deployment_records;
CREATE POLICY "deployment_records_update_admin" ON deployment_records FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin', 'developer'))
  ) WITH CHECK (true);

-- Security events
DROP POLICY IF EXISTS "security_events_select_admin" ON security_events;
CREATE POLICY "security_events_select_admin" ON security_events FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "security_events_insert_authenticated" ON security_events;
CREATE POLICY "security_events_insert_authenticated" ON security_events FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "security_events_update_admin" ON security_events;
CREATE POLICY "security_events_update_admin" ON security_events FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin'))
  ) WITH CHECK (true);

-- ============================================
-- TRIGGERS
-- ============================================
DROP TRIGGER IF EXISTS trigger_projects_updated_at ON projects;
CREATE TRIGGER trigger_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_access_tokens_updated_at ON access_tokens;
CREATE TRIGGER trigger_access_tokens_updated_at BEFORE UPDATE ON access_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_agent_tasks_updated_at ON agent_tasks;
CREATE TRIGGER trigger_agent_tasks_updated_at BEFORE UPDATE ON agent_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SEED: Orion Project + Developer Role
-- ============================================
INSERT INTO roles (name, name_ar, description, is_system_role) VALUES
  ('developer', 'مطور / مشغل تقني', 'صلاحيات تطوير وتشغيل الأنظمة المرتبطة', true)
ON CONFLICT (name) DO NOTHING;

-- Give developer role relevant permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'developer' AND p.code IN (
  'institutions.view', 'connections.view', 'connections.test', 'heartbeats.view',
  'reports.view', 'notifications.view', 'support.view', 'support.create',
  'audit.view', 'activity.view', 'settings.view'
)
ON CONFLICT DO NOTHING;

-- Create Orion project
INSERT INTO projects (institution_id, name, description, environment, agent_status, build_status, test_status, health_status)
SELECT id, 'Orion Institute Management System', 'نظام إدارة معهد Orion المستقل', 'production', 'disconnected', 'unknown', 'unknown', 'unknown'
FROM institutions WHERE system_id = 'ORION-INS-000001'
ON CONFLICT DO NOTHING;

-- ============================================
-- SEED: Demo security events
-- ============================================
INSERT INTO security_events (event_type, severity, institution_id, description, is_resolved)
SELECT 'token_expired', 'low', id, 'Access token approaching expiration', false
FROM institutions WHERE system_id = 'ORION-INS-000001'
ON CONFLICT DO NOTHING;

INSERT INTO security_events (event_type, severity, description, is_resolved)
VALUES
  ('failed_login', 'medium', 'Multiple failed login attempts detected', true),
  ('unauthorized_access', 'high', 'Unauthorized API access attempt blocked', false);
