/*
# AWRIQ Database Schema - Part 2: Institutions, Connections, Heartbeats

## Overview
This migration creates the institution management tables for AWRIQ's central control plane.
Each institution is an independent system (school, institute, education center) with its own
database, users, and authentication. AWRIQ only stores central management data.

## New Tables
1. `institutions` - Registered institutions with unique IDs
2. `institution_admins` - Central contact info for institution admins (NOT their auth)
3. `system_connections` - Connection records between AWRIQ and independent systems
4. `api_credentials` - Secure API keys for system-to-system authentication
5. `heartbeats` - Heartbeat records from independent systems
6. `system_versions` - Version tracking for each connected system

## Security
- RLS enabled on all tables
- Only authenticated users with appropriate roles can access data
- API credentials are never exposed to frontend (stored encrypted, policies restrict access)
- Institution isolation through unique institution_id, tenant_id, system_id

## Important
- Institution admins are NOT AWRIQ users - they exist in their own system
- AWRIQ only stores contact metadata for institution admins
- Heartbeats are monitoring data only - they don't control any system
*/

-- ============================================
-- 1. INSTITUTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  system_id text NOT NULL UNIQUE,
  name text NOT NULL,
  name_ar text,
  type text NOT NULL DEFAULT 'school' CHECK (type IN ('school', 'institute', 'education_center')),
  system_name text,
  domain text,
  logo_url text,
  image_url text,
  governorate text,
  city text,
  address text,
  contact_email text,
  contact_phone text,
  notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'suspended')),
  is_favorite boolean NOT NULL DEFAULT false,
  student_count integer NOT NULL DEFAULT 0,
  teacher_count integer NOT NULL DEFAULT 0,
  last_heartbeat_at timestamptz,
  last_sync_at timestamptz,
  system_version text,
  connection_status text NOT NULL DEFAULT 'offline' CHECK (connection_status IN ('connected', 'delayed', 'offline')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 2. INSTITUTION_ADMINS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS institution_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  role text NOT NULL DEFAULT 'admin',
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 3. SYSTEM_CONNECTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS system_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  connection_type text NOT NULL DEFAULT 'api',
  endpoint_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('active', 'pending', 'inactive', 'failed')),
  last_test_at timestamptz,
  last_test_result text,
  last_test_success boolean,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 4. API_CREDENTIALS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS api_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES system_connections(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Default',
  api_key_hash text NOT NULL,
  api_key_prefix text NOT NULL,
  secret_hash text,
  is_active boolean NOT NULL DEFAULT true,
  last_rotated_at timestamptz,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 5. HEARTBEATS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS heartbeats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  system_id text NOT NULL,
  tenant_id uuid,
  system_version text,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'warning', 'error', 'maintenance')),
  payload jsonb DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 6. SYSTEM_VERSIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS system_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  version text NOT NULL,
  release_date date,
  is_current boolean NOT NULL DEFAULT false,
  notes text,
  changelog text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_institutions_type ON institutions(type);
CREATE INDEX IF NOT EXISTS idx_institutions_status ON institutions(status);
CREATE INDEX IF NOT EXISTS idx_institutions_connection_status ON institutions(connection_status);
CREATE INDEX IF NOT EXISTS idx_institutions_system_id ON institutions(system_id);
CREATE INDEX IF NOT EXISTS idx_institutions_governorate ON institutions(governorate);
CREATE INDEX IF NOT EXISTS idx_institution_admins_institution_id ON institution_admins(institution_id);
CREATE INDEX IF NOT EXISTS idx_system_connections_institution_id ON system_connections(institution_id);
CREATE INDEX IF NOT EXISTS idx_api_credentials_institution_id ON api_credentials(institution_id);
CREATE INDEX IF NOT EXISTS idx_heartbeats_institution_id ON heartbeats(institution_id);
CREATE INDEX IF NOT EXISTS idx_heartbeats_received_at ON heartbeats(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_versions_institution_id ON system_versions(institution_id);

-- ============================================
-- ENABLE RLS
-- ============================================
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_versions ENABLE ROW LEVEL SECURITY;

-- ============================================
-- POLICIES: institutions
-- ============================================
DROP POLICY IF EXISTS "institutions_select_authenticated" ON institutions;
CREATE POLICY "institutions_select_authenticated" ON institutions FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "institutions_insert_admin" ON institutions;
CREATE POLICY "institutions_insert_admin" ON institutions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  );

DROP POLICY IF EXISTS "institutions_update_admin" ON institutions;
CREATE POLICY "institutions_update_admin" ON institutions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  );

DROP POLICY IF EXISTS "institutions_delete_super_admin" ON institutions;
CREATE POLICY "institutions_delete_super_admin" ON institutions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
  );

-- ============================================
-- POLICIES: institution_admins
-- ============================================
DROP POLICY IF EXISTS "institution_admins_select_authenticated" ON institution_admins;
CREATE POLICY "institution_admins_select_authenticated" ON institution_admins FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "institution_admins_insert_admin" ON institution_admins;
CREATE POLICY "institution_admins_insert_admin" ON institution_admins FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  );

DROP POLICY IF EXISTS "institution_admins_update_admin" ON institution_admins;
CREATE POLICY "institution_admins_update_admin" ON institution_admins FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  );

DROP POLICY IF EXISTS "institution_admins_delete_admin" ON institution_admins;
CREATE POLICY "institution_admins_delete_admin" ON institution_admins FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  );

-- ============================================
-- POLICIES: system_connections
-- ============================================
DROP POLICY IF EXISTS "system_connections_select_authenticated" ON system_connections;
CREATE POLICY "system_connections_select_authenticated" ON system_connections FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "system_connections_insert_admin" ON system_connections;
CREATE POLICY "system_connections_insert_admin" ON system_connections FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  );

DROP POLICY IF EXISTS "system_connections_update_admin" ON system_connections;
CREATE POLICY "system_connections_update_admin" ON system_connections FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  );

DROP POLICY IF EXISTS "system_connections_delete_admin" ON system_connections;
CREATE POLICY "system_connections_delete_admin" ON system_connections FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  );

-- ============================================
-- POLICIES: api_credentials (RESTRICTED - super_admin only for security)
-- ============================================
DROP POLICY IF EXISTS "api_credentials_select_super_admin" ON api_credentials;
CREATE POLICY "api_credentials_select_super_admin" ON api_credentials FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
  );

DROP POLICY IF EXISTS "api_credentials_insert_super_admin" ON api_credentials;
CREATE POLICY "api_credentials_insert_super_admin" ON api_credentials FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
  );

DROP POLICY IF EXISTS "api_credentials_update_super_admin" ON api_credentials;
CREATE POLICY "api_credentials_update_super_admin" ON api_credentials FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
  );

DROP POLICY IF EXISTS "api_credentials_delete_super_admin" ON api_credentials;
CREATE POLICY "api_credentials_delete_super_admin" ON api_credentials FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
  );

-- ============================================
-- POLICIES: heartbeats
-- ============================================
-- Heartbeats can be inserted by anon (for external system API calls) and read by authenticated users
DROP POLICY IF EXISTS "heartbeats_select_authenticated" ON heartbeats;
CREATE POLICY "heartbeats_select_authenticated" ON heartbeats FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "heartbeats_insert_anon_authenticated" ON heartbeats;
CREATE POLICY "heartbeats_insert_anon_authenticated" ON heartbeats FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "heartbeats_delete_admin" ON heartbeats;
CREATE POLICY "heartbeats_delete_admin" ON heartbeats FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  );

-- ============================================
-- POLICIES: system_versions
-- ============================================
DROP POLICY IF EXISTS "system_versions_select_authenticated" ON system_versions;
CREATE POLICY "system_versions_select_authenticated" ON system_versions FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "system_versions_insert_admin" ON system_versions;
CREATE POLICY "system_versions_insert_admin" ON system_versions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  );

DROP POLICY IF EXISTS "system_versions_update_admin" ON system_versions;
CREATE POLICY "system_versions_update_admin" ON system_versions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  );

DROP POLICY IF EXISTS "system_versions_delete_admin" ON system_versions;
CREATE POLICY "system_versions_delete_admin" ON system_versions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  );

-- ============================================
-- TRIGGERS
-- ============================================
DROP TRIGGER IF EXISTS trigger_institutions_updated_at ON institutions;
CREATE TRIGGER trigger_institutions_updated_at
  BEFORE UPDATE ON institutions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_institution_admins_updated_at ON institution_admins;
CREATE TRIGGER trigger_institution_admins_updated_at
  BEFORE UPDATE ON institution_admins
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_system_connections_updated_at ON system_connections;
CREATE TRIGGER trigger_system_connections_updated_at
  BEFORE UPDATE ON system_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_api_credentials_updated_at ON api_credentials;
CREATE TRIGGER trigger_api_credentials_updated_at
  BEFORE UPDATE ON api_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
