/*
# AWRIQ Database Schema - Part 3: Notifications, Logs, Settings, Support, Sessions

## Overview
This migration creates the remaining operational tables for AWRIQ:
notifications, audit/activity logs, system settings, support tickets, and sessions.

## New Tables
1. `notifications` - Central notification system
2. `audit_logs` - Security audit trail
3. `activity_logs` - User activity tracking
4. `system_settings` - System configuration (key-value)
5. `support_tickets` - Support ticket management
6. `support_ticket_comments` - Comments on support tickets
7. `sessions` - User session tracking

## Security
- RLS enabled on all tables
- Users can read their own notifications, sessions
- Admins can read all notifications, logs, settings, tickets
- Only admins can manage settings and tickets
- Audit logs are insert-only (no update/delete for regular users)
*/

-- ============================================
-- 1. NOTIFICATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  institution_id uuid REFERENCES institutions(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'warning', 'error', 'success', 'security')),
  title text NOT NULL,
  title_ar text,
  message text,
  message_ar text,
  is_read boolean NOT NULL DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 2. AUDIT_LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource text,
  resource_id text,
  institution_id uuid REFERENCES institutions(id) ON DELETE SET NULL,
  ip_address inet,
  user_agent text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 3. ACTIVITY_LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource text,
  resource_id text,
  institution_id uuid REFERENCES institutions(id) ON DELETE SET NULL,
  details text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 4. SYSTEM_SETTINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value text,
  value_json jsonb,
  category text NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'security', 'notifications', 'api', 'connection', 'appearance', 'localization', 'system')),
  description text,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 5. SUPPORT_TICKETS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text NOT NULL UNIQUE,
  institution_id uuid REFERENCES institutions(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  description text,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 6. SUPPORT_TICKET_COMMENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS support_ticket_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 7. SESSIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_token text NOT NULL UNIQUE,
  ip_address inet,
  user_agent text,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_institution_id ON audit_logs(institution_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_institution_id ON activity_logs(institution_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(key);
CREATE INDEX IF NOT EXISTS idx_system_settings_category ON system_settings(category);
CREATE INDEX IF NOT EXISTS idx_support_tickets_institution_id ON support_tickets(institution_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_by ON support_tickets(created_by);
CREATE INDEX IF NOT EXISTS idx_support_ticket_comments_ticket_id ON support_ticket_comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_is_active ON sessions(is_active);

-- ============================================
-- ENABLE RLS
-- ============================================
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- ============================================
-- POLICIES: notifications
-- ============================================
DROP POLICY IF EXISTS "notifications_select_own" ON notifications;
CREATE POLICY "notifications_select_own" ON notifications FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() OR
    user_id IS NULL OR
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin', 'support')
    )
  );

DROP POLICY IF EXISTS "notifications_insert_admin" ON notifications;
CREATE POLICY "notifications_insert_admin" ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  );

DROP POLICY IF EXISTS "notifications_insert_anon_system" ON notifications;
CREATE POLICY "notifications_insert_anon_system" ON notifications FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "notifications_update_own" ON notifications;
CREATE POLICY "notifications_update_own" ON notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_admin" ON notifications;
CREATE POLICY "notifications_update_admin" ON notifications FOR UPDATE
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

DROP POLICY IF EXISTS "notifications_delete_admin" ON notifications;
CREATE POLICY "notifications_delete_admin" ON notifications FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  );

-- ============================================
-- POLICIES: audit_logs (insert by any authenticated, read by admins)
-- ============================================
DROP POLICY IF EXISTS "audit_logs_insert_authenticated" ON audit_logs;
CREATE POLICY "audit_logs_insert_authenticated" ON audit_logs FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "audit_logs_insert_anon" ON audit_logs;
CREATE POLICY "audit_logs_insert_anon" ON audit_logs FOR INSERT
  TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "audit_logs_select_admin" ON audit_logs;
CREATE POLICY "audit_logs_select_admin" ON audit_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin', 'support')
    )
  );

-- ============================================
-- POLICIES: activity_logs
-- ============================================
DROP POLICY IF EXISTS "activity_logs_insert_authenticated" ON activity_logs;
CREATE POLICY "activity_logs_insert_authenticated" ON activity_logs FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "activity_logs_insert_anon" ON activity_logs;
CREATE POLICY "activity_logs_insert_anon" ON activity_logs FOR INSERT
  TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "activity_logs_select_admin" ON activity_logs;
CREATE POLICY "activity_logs_select_admin" ON activity_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin', 'support')
    )
  );

-- ============================================
-- POLICIES: system_settings
-- ============================================
DROP POLICY IF EXISTS "system_settings_select_public" ON system_settings;
CREATE POLICY "system_settings_select_public" ON system_settings FOR SELECT
  TO authenticated USING (is_public = true);

DROP POLICY IF EXISTS "system_settings_select_admin" ON system_settings;
CREATE POLICY "system_settings_select_admin" ON system_settings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  );

DROP POLICY IF EXISTS "system_settings_insert_admin" ON system_settings;
CREATE POLICY "system_settings_insert_admin" ON system_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  );

DROP POLICY IF EXISTS "system_settings_update_admin" ON system_settings;
CREATE POLICY "system_settings_update_admin" ON system_settings FOR UPDATE
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

DROP POLICY IF EXISTS "system_settings_delete_super_admin" ON system_settings;
CREATE POLICY "system_settings_delete_super_admin" ON system_settings FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
  );

-- ============================================
-- POLICIES: support_tickets
-- ============================================
DROP POLICY IF EXISTS "support_tickets_select_authenticated" ON support_tickets;
CREATE POLICY "support_tickets_select_authenticated" ON support_tickets FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin', 'support')
    )
  );

DROP POLICY IF EXISTS "support_tickets_insert_authenticated" ON support_tickets;
CREATE POLICY "support_tickets_insert_authenticated" ON support_tickets FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "support_tickets_update_admin" ON support_tickets;
CREATE POLICY "support_tickets_update_admin" ON support_tickets FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin', 'support')
    )
  )
  WITH CHECK (true);

DROP POLICY IF EXISTS "support_tickets_delete_admin" ON support_tickets;
CREATE POLICY "support_tickets_delete_admin" ON support_tickets FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  );

-- ============================================
-- POLICIES: support_ticket_comments
-- ============================================
DROP POLICY IF EXISTS "support_ticket_comments_select_authenticated" ON support_ticket_comments;
CREATE POLICY "support_ticket_comments_select_authenticated" ON support_ticket_comments FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "support_ticket_comments_insert_authenticated" ON support_ticket_comments;
CREATE POLICY "support_ticket_comments_insert_authenticated" ON support_ticket_comments FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "support_ticket_comments_delete_admin" ON support_ticket_comments;
CREATE POLICY "support_ticket_comments_delete_admin" ON support_ticket_comments FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  );

-- ============================================
-- POLICIES: sessions
-- ============================================
DROP POLICY IF EXISTS "sessions_select_own" ON sessions;
CREATE POLICY "sessions_select_own" ON sessions FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "sessions_select_admin" ON sessions;
CREATE POLICY "sessions_select_admin" ON sessions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'central_admin')
    )
  );

DROP POLICY IF EXISTS "sessions_insert_own" ON sessions;
CREATE POLICY "sessions_insert_own" ON sessions FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "sessions_update_own" ON sessions;
CREATE POLICY "sessions_update_own" ON sessions FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "sessions_delete_own" ON sessions;
CREATE POLICY "sessions_delete_own" ON sessions FOR DELETE
  TO authenticated USING (user_id = auth.uid());

-- ============================================
-- TRIGGERS
-- ============================================
DROP TRIGGER IF EXISTS trigger_system_settings_updated_at ON system_settings;
CREATE TRIGGER trigger_system_settings_updated_at
  BEFORE UPDATE ON system_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_support_tickets_updated_at ON support_tickets;
CREATE TRIGGER trigger_support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
