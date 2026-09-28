/*
# M5 — AWRIQ Project-Access Execution (Phase 26–30)

Adds the pieces that let the `project-access` gateway **execute** on a project
without ever handing raw secrets to the agent:
  1. `project_credentials`   — one row per project holding gateway-side secrets
     (GitHub PAT, Vercel token/project, target Supabase ref/URL/keys) with strict
     RLS: only managers / super admins can touch them; the gateway uses service role.
  2. `deployment_records`     — extended (REUSE FIRST) with provider/external_url/
     deployment_uid/session_id/approval_id/message so the gateway can record and
     surface Vercel-style deployments for the Project → Deploy loop.

Design invariants:
  * No DROP/T RUNCATE of user data.
  * No secret is ever returned by the gateway to an agent token.
*/

-- ============================================
-- 1. PROJECT_CREDENTIALS
-- ============================================
CREATE TABLE IF NOT EXISTS public.project_credentials (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  github_token text,               -- encrypted at rest (AES-256-GCM via gateway)
  vercel_token text,               -- encrypted at rest
  vercel_project_id text,          -- not secret
  supabase_project_ref text,       -- not secret (ref only)
  supabase_url text,               -- not secret
  supabase_anon_key text,          -- public key concept
  supabase_service_key text,       -- encrypted at rest; reserved for admin SQL
  datastore_write_enabled boolean NOT NULL DEFAULT false,
  auto_deploy boolean NOT NULL DEFAULT true,  -- commit → deploy trigger
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_credentials_select_manage"
  ON public.project_credentials FOR SELECT
  TO authenticated
  USING (public.user_can_manage_project(project_id));

CREATE POLICY "project_credentials_insert_manage"
  ON public.project_credentials FOR INSERT
  TO authenticated
  WITH CHECK (public.user_can_manage_project(project_id));

CREATE POLICY "project_credentials_update_manage"
  ON public.project_credentials FOR UPDATE
  TO authenticated
  USING (public.user_can_manage_project(project_id))
  WITH CHECK (public.user_can_manage_project(project_id));

CREATE POLICY "project_credentials_delete_manage"
  ON public.project_credentials FOR DELETE
  TO authenticated
  USING (public.user_can_manage_project(project_id));

-- ============================================
-- 2. DEPLOYMENT_RECORDS — extend existing table (REUSE FIRST)
-- ============================================
ALTER TABLE public.deployment_records
  DROP CONSTRAINT IF EXISTS deployment_records_status_check;
ALTER TABLE public.deployment_records
  ADD CONSTRAINT deployment_records_status_check
  CHECK (status IN ('pending', 'queued', 'building', 'deploying', 'ready',
                    'successful', 'error', 'failed', 'canceled', 'rolled_back'));

ALTER TABLE public.deployment_records
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'vercel';

ALTER TABLE public.deployment_records
  ADD COLUMN IF NOT EXISTS external_url text;

ALTER TABLE public.deployment_records
  ADD COLUMN IF NOT EXISTS deployment_uid text;

ALTER TABLE public.deployment_records
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.agent_sessions(id) ON DELETE SET NULL;

ALTER TABLE public.deployment_records
  ADD COLUMN IF NOT EXISTS approval_id uuid REFERENCES public.agent_approvals(id) ON DELETE SET NULL;

ALTER TABLE public.deployment_records
  ADD COLUMN IF NOT EXISTS message text;

CREATE INDEX IF NOT EXISTS idx_deployment_records_provider ON public.deployment_records(provider);
CREATE INDEX IF NOT EXISTS idx_deployment_records_created_at
  ON public.deployment_records(project_id, created_at DESC);

ALTER TABLE public.deployment_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deployment_records_select_manage"
  ON public.deployment_records FOR SELECT
  TO authenticated
  USING (public.user_can_manage_project(project_id));

CREATE POLICY "deployment_records_insert_manage"
  ON public.deployment_records FOR INSERT
  TO authenticated
  WITH CHECK (public.user_can_manage_project(project_id));

CREATE POLICY "deployment_records_update_manage"
  ON public.deployment_records FOR UPDATE
  TO authenticated
  USING (public.user_can_manage_project(project_id))
  WITH CHECK (public.user_can_manage_project(project_id));