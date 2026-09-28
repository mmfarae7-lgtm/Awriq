/*
# AWRIQ Platform Migration M1 - Remote Project Maintenance Platform

## Purpose
Transform AWRIQ from an institution-management backend into a Remote Project
Maintenance & AI Engineering Platform. This migration:

1. Decouples the AI-agent tables from the school/institution model
   (`institution_id` becomes nullable everywhere; introduces an optional
   `organizations` client/context concept).
2. Adds the AI provider layer (`ai_providers`, `ai_models`) seeded with the
   free OpenCode Zen models (OpenAI-compatible endpoint, no API key required -
   uses the literal `public` bearer token for the free tier).
3. Adds `project_integrations` (encrypted tokens for GitHub/Vercel/Supabase).
4. Adds `project_members` (project-scoped roles: owner/viewer).
5. Adds `agent_messages` (chat transcript per agent session).
6. Adds the `user_can_manage_project(uuid)` helper (SECURITY DEFINER) and a
   `user_is_project_member(uuid)` helper to keep RLS recursion-free.

Status: M1 (see docs/AWRIQ-SPEC.md)
*/

-- ============================================
-- 0. ORGANIZATIONS (optional client/context)
-- ============================================
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_ar text,
  description text,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 1. DECOUPLE institution_id FROM PROJECT DOMAIN
-- ============================================
-- Projects become standalone entities. Organizations are optional context.
ALTER TABLE projects
  ALTER COLUMN institution_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;

ALTER TABLE access_tokens
  ALTER COLUMN institution_id DROP NOT NULL;

ALTER TABLE agent_sessions
  ALTER COLUMN institution_id DROP NOT NULL;

ALTER TABLE deployment_records
  ALTER COLUMN institution_id DROP NOT NULL;

ALTER TABLE security_events
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;

-- ============================================
-- 2. AI PROVIDERS + MODELS
-- ============================================
CREATE TABLE IF NOT EXISTS ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  base_url text NOT NULL,
  auth_method text NOT NULL DEFAULT 'bearer' CHECK (auth_method IN ('none', 'api_key', 'bearer')),
  is_free boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  is_enabled boolean NOT NULL DEFAULT true,
  config jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
  model_id text NOT NULL,
  name text NOT NULL,
  context_window integer,
  supports_tools boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT true,
  cost_input_usd numeric(10,6) NOT NULL DEFAULT 0,
  cost_output_usd numeric(10,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_models_provider_id ON ai_models(provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_providers_priority ON ai_providers(priority);

-- ============================================
-- 3. PROJECT INTEGRATIONS (GitHub / Vercel / Supabase / AI)
-- ============================================
CREATE TABLE IF NOT EXISTS project_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('github', 'vercel', 'supabase', 'ai')),
  provider_ref text,
  scopes jsonb DEFAULT '{}'::jsonb,
  auth_method text NOT NULL DEFAULT 'token' CHECK (auth_method IN ('token', 'env', 'public')),
  token_enc text,
  token_prefix text,
  is_connected boolean NOT NULL DEFAULT false,
  last_checked_at timestamptz,
  health jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_project_integrations_project_id ON project_integrations(project_id);

-- ============================================
-- 4. PROJECT MEMBERS (project-scoped roles)
-- ============================================
CREATE TABLE IF NOT EXISTS project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id);

-- ============================================
-- 5. AGENT MESSAGES (chat transcript)
-- ============================================
CREATE TABLE IF NOT EXISTS agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  sender text NOT NULL CHECK (sender IN ('user', 'agent', 'system')),
  content text NOT NULL,
  attachments jsonb DEFAULT '[]'::jsonb,
  role_meta jsonb DEFAULT '{}'::jsonb,
  model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_session_id ON agent_messages(session_id);

-- ============================================
-- 6. RLS HELPERS (SECURITY DEFINER - recursion-proof)
-- ============================================
CREATE OR REPLACE FUNCTION public.user_is_project_member(target_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = target_project AND pm.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.user_can_manage_project(target_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT (
    public.user_has_role(ARRAY['super_admin', 'central_admin', 'developer'])
    OR EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = target_project
        AND pm.user_id = auth.uid()
        AND pm.role = 'owner'
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_is_project_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_manage_project(uuid) TO authenticated;

-- ============================================
-- 7. ENABLE RLS
-- ============================================
ALTER TABLE ai_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 8. POLICIES
-- ============================================
-- organizations: owner or platform admin can see/manage
DROP POLICY IF EXISTS "organizations_select_member_admin" ON organizations;
CREATE POLICY "organizations_select_member_admin" ON organizations FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "organizations_manage_owner_admin" ON organizations;
CREATE POLICY "organizations_manage_owner_admin" ON organizations FOR ALL
  TO authenticated
  USING (owner_user_id = auth.uid() OR public.user_has_role(ARRAY['super_admin']))
  WITH CHECK (owner_user_id = auth.uid() OR public.user_has_role(ARRAY['super_admin']));

-- ai_providers: anyone authenticated reads; only super_admin manages
DROP POLICY IF EXISTS "ai_providers_select_authenticated" ON ai_providers;
CREATE POLICY "ai_providers_select_authenticated" ON ai_providers FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "ai_providers_manage_super_admin" ON ai_providers;
CREATE POLICY "ai_providers_manage_super_admin" ON ai_providers FOR ALL
  TO authenticated
  USING (public.user_has_role(ARRAY['super_admin']))
  WITH CHECK (public.user_has_role(ARRAY['super_admin']));

-- ai_models: authenticated reads; super_admin manages
DROP POLICY IF EXISTS "ai_models_select_authenticated" ON ai_models;
CREATE POLICY "ai_models_select_authenticated" ON ai_models FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "ai_models_manage_super_admin" ON ai_models;
CREATE POLICY "ai_models_manage_super_admin" ON ai_models FOR ALL
  TO authenticated
  USING (public.user_has_role(ARRAY['super_admin']))
  WITH CHECK (public.user_has_role(ARRAY['super_admin']));

-- project_integrations: project managers on the project; owner/super_admin
DROP POLICY IF EXISTS "project_integrations_select_manage" ON project_integrations;
CREATE POLICY "project_integrations_select_manage" ON project_integrations FOR SELECT
  TO authenticated USING (
    public.user_can_manage_project(project_id)
    OR public.user_is_project_member(project_id)
  );

DROP POLICY IF EXISTS "project_integrations_insert_manage" ON project_integrations;
CREATE POLICY "project_integrations_insert_manage" ON project_integrations FOR INSERT
  TO authenticated WITH CHECK (public.user_can_manage_project(project_id));

DROP POLICY IF EXISTS "project_integrations_update_manage" ON project_integrations;
CREATE POLICY "project_integrations_update_manage" ON project_integrations FOR UPDATE
  TO authenticated USING (public.user_can_manage_project(project_id))
  WITH CHECK (public.user_can_manage_project(project_id));

DROP POLICY IF EXISTS "project_integrations_delete_manage" ON project_integrations;
CREATE POLICY "project_integrations_delete_manage" ON project_integrations FOR DELETE
  TO authenticated USING (public.user_can_manage_project(project_id));

-- project_members
DROP POLICY IF EXISTS "project_members_select" ON project_members;
CREATE POLICY "project_members_select" ON project_members FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR public.user_can_manage_project(project_id)
  );

DROP POLICY IF EXISTS "project_members_manage" ON project_members;
CREATE POLICY "project_members_manage" ON project_members FOR ALL
  TO authenticated
  USING (public.user_can_manage_project(project_id))
  WITH CHECK (public.user_can_manage_project(project_id));

-- agent_messages: session owner or platform admin / project manager
DROP POLICY IF EXISTS "agent_messages_select" ON agent_messages;
CREATE POLICY "agent_messages_select" ON agent_messages FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM agent_sessions s
      WHERE s.id = session_id
        AND (s.user_id = auth.uid() OR public.user_can_manage_project(s.project_id) OR public.user_has_role(ARRAY['super_admin', 'central_admin', 'developer']))
    )
  );

DROP POLICY IF EXISTS "agent_messages_insert" ON agent_messages;
CREATE POLICY "agent_messages_insert" ON agent_messages FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM agent_sessions s
      WHERE s.id = session_id AND s.user_id = auth.uid()
    )
  );

-- ============================================
-- 9. SEED: FREE AI PROVIDERS (OpenCode Zen, OpenAI-compatible)
-- ============================================
-- Free tier requires no API key; the gateway sends the literal "public"
-- bearer token. Models list source: https://opencode.ai/zen/v1/models
INSERT INTO ai_providers (code, name, base_url, auth_method, is_free, priority, config) VALUES
  ('opencode-zen', 'OpenCode Zen', 'https://opencode.ai/zen/v1', 'bearer', true, 10,
   '{"public_key": "public", "openai_compatible": true}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  base_url = EXCLUDED.base_url,
  auth_method = EXCLUDED.auth_method,
  is_free = EXCLUDED.is_free,
  priority = EXCLUDED.priority,
  config = EXCLUDED.config;

INSERT INTO ai_models (provider_id, model_id, name, context_window, supports_tools, is_default, is_enabled, cost_input_usd, cost_output_usd)
SELECT p.id, m.model_id, m.name, m.context_window, m.supports_tools, m.is_default, m.is_enabled, m.cost_input_usd, m.cost_output_usd
FROM ai_providers p
CROSS JOIN (VALUES
  ('big-pickle',          'Big Pickle',                 128000, true,  true,  true, 0, 0),
  ('mimo-v2.5-free',      'MiMo-V2.5 Free',             128000, false, false, true, 0, 0),
  ('ling-3.0-flash-free', 'Ling 3.0 Flash Free',        128000, false, false, true, 0, 0),
  ('nemotron-3-ultra-free','Nemotron 3 Ultra Free',     128000, false, false, true, 0, 0)
) AS m(model_id, name, context_window, supports_tools, is_default, is_enabled, cost_input_usd, cost_output_usd)
WHERE p.code = 'opencode-zen'
ON CONFLICT (provider_id, model_id) DO NOTHING;

-- ============================================
-- 10. TRIGGERS
-- ============================================
DROP TRIGGER IF EXISTS trigger_organizations_updated_at ON organizations;
CREATE TRIGGER trigger_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_ai_providers_updated_at ON ai_providers;
CREATE TRIGGER trigger_ai_providers_updated_at
  BEFORE UPDATE ON ai_providers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_project_integrations_updated_at ON project_integrations;
CREATE TRIGGER trigger_project_integrations_updated_at
  BEFORE UPDATE ON project_integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();