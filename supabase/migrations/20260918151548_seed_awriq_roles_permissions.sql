/*
# AWRIQ Seed Data: Roles, Permissions, Role-Permission Mappings

## Overview
This migration seeds the initial roles and permissions for the AWRIQ system.

## Roles Created
1. super_admin - Full system access (Super Admin / مدير عام)
2. central_admin - Institution and user management (Central Admin / مدير مركزي)
3. support - Read access to connection/status/support (Support / دعم فني)
4. viewer - Read-only access (Viewer / مشاهد)

## Permissions Created
Permissions across categories: institutions, users, connections, reports, notifications, settings, support, audit

## Role-Permission Mappings
- super_admin: ALL permissions
- central_admin: All except super-admin-only operations
- support: Read access + support ticket management
- viewer: Read-only access
*/

-- ============================================
-- 1. SEED ROLES
-- ============================================
INSERT INTO roles (name, name_ar, description, is_system_role) VALUES
  ('super_admin', 'مدير عام', 'صلاحيات كاملة على النظام', true),
  ('central_admin', 'مدير مركزي', 'إدارة المؤسسات والأنظمة والمستخدمين', true),
  ('support', 'دعم فني', 'الوصول لمعلومات الاتصال والحالة والدعم', true),
  ('viewer', 'مشاهد', 'قراءة البيانات المسموح بها فقط', true)
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- 2. SEED PERMISSIONS
-- ============================================
INSERT INTO permissions (code, name, name_ar, category) VALUES
  -- Institutions
  ('institutions.view', 'View Institutions', 'عرض المؤسسات', 'institutions'),
  ('institutions.create', 'Create Institution', 'إنشاء مؤسسة', 'institutions'),
  ('institutions.edit', 'Edit Institution', 'تعديل مؤسسة', 'institutions'),
  ('institutions.delete', 'Delete Institution', 'حذف مؤسسة', 'institutions'),
  ('institutions.disable', 'Disable Institution', 'تعطيل مؤسسة', 'institutions'),
  ('institutions.enable', 'Enable Institution', 'تفعيل مؤسسة', 'institutions'),
  -- Users
  ('users.view', 'View Users', 'عرض المستخدمين', 'users'),
  ('users.create', 'Create User', 'إنشاء مستخدم', 'users'),
  ('users.edit', 'Edit User', 'تعديل مستخدم', 'users'),
  ('users.delete', 'Delete User', 'حذف مستخدم', 'users'),
  ('users.assign_roles', 'Assign Roles', 'تعيين الأدوار', 'users'),
  -- Connections
  ('connections.view', 'View Connections', 'عرض الربط', 'connections'),
  ('connections.manage', 'Manage Connections', 'إدارة الربط', 'connections'),
  ('connections.test', 'Test Connection', 'اختبار الاتصال', 'connections'),
  ('credentials.view', 'View Credentials', 'عرض بيانات الاعتماد', 'connections'),
  ('credentials.create', 'Create Credential', 'إنشاء بيانات اعتماد', 'connections'),
  ('credentials.rotate', 'Rotate Credential', 'تدوير بيانات الاعتماد', 'connections'),
  ('credentials.revoke', 'Revoke Credential', 'إبطال بيانات الاعتماد', 'connections'),
  -- Heartbeats
  ('heartbeats.view', 'View Heartbeats', 'عرض نبضات النظام', 'connections'),
  -- Reports
  ('reports.view', 'View Reports', 'عرض التقارير', 'reports'),
  ('reports.export', 'Export Reports', 'تصدير التقارير', 'reports'),
  -- Notifications
  ('notifications.view', 'View Notifications', 'عرض الإشعارات', 'notifications'),
  ('notifications.manage', 'Manage Notifications', 'إدارة الإشعارات', 'notifications'),
  -- Settings
  ('settings.view', 'View Settings', 'عرض الإعدادات', 'settings'),
  ('settings.manage', 'Manage Settings', 'إدارة الإعدادات', 'settings'),
  -- Support
  ('support.view', 'View Support Tickets', 'عرض تذاكر الدعم', 'support'),
  ('support.create', 'Create Support Ticket', 'إنشاء تذكرة دعم', 'support'),
  ('support.manage', 'Manage Support Tickets', 'إدارة تذاكر الدعم', 'support'),
  -- Audit
  ('audit.view', 'View Audit Logs', 'عرض سجل التدقيق', 'audit'),
  ('activity.view', 'View Activity Logs', 'عرض سجل النشاط', 'audit')
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- 3. ASSIGN PERMISSIONS TO ROLES
-- ============================================

-- super_admin gets ALL permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;

-- central_admin gets all except credentials.view, credentials.rotate, credentials.revoke, users.delete
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'central_admin'
  AND p.code NOT IN ('credentials.view', 'credentials.rotate', 'credentials.revoke', 'users.delete')
ON CONFLICT DO NOTHING;

-- support gets read access + support management
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'support'
  AND p.code IN (
    'institutions.view', 'users.view', 'connections.view', 'connections.test',
    'heartbeats.view', 'reports.view', 'notifications.view',
    'support.view', 'support.create', 'support.manage',
    'audit.view', 'activity.view', 'settings.view'
  )
ON CONFLICT DO NOTHING;

-- viewer gets read-only access
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'viewer'
  AND p.code IN (
    'institutions.view', 'users.view', 'connections.view', 'heartbeats.view',
    'reports.view', 'notifications.view', 'support.view',
    'audit.view', 'activity.view', 'settings.view'
  )
ON CONFLICT DO NOTHING;
