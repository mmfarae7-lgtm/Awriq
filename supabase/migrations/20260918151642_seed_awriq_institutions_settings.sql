/*
# AWRIQ Seed Data: Orion Institution + Demo Institutions + System Settings

## Overview
This migration seeds:
1. Orion Institute as the first real registered institution in AWRIQ
2. Demo institutions for UI development (clearly marked as demo)
3. Default system settings
4. Default notifications for demo purposes

## Orion Institute
- Name: معهد Orion
- Type: Institute
- System: Orion Institute Management System
- System ID: ORION-INS-000001
- Website: https://orionaden.infinityfreeapp.com
- Status: Active, Connected
*/

-- ============================================
-- 1. SEED ORION INSTITUTE
-- ============================================
INSERT INTO institutions (
  institution_id, tenant_id, system_id, name, name_ar, type, system_name, domain,
  governorate, city, address, contact_email, contact_phone, notes,
  status, connection_status, system_version, student_count, teacher_count
) VALUES (
  gen_random_uuid(), gen_random_uuid(), 'ORION-INS-000001',
  'Orion Institute', 'معهد Orion', 'institute',
  'Orion Institute Management System', 'https://orionaden.infinityfreeapp.com',
  'عدن', 'عدن', 'عدن، اليمن',
  'admin@orionaden.infinityfreeapp.com', '+967-2-000-0000',
  'First registered institution in AWRIQ. Independent system with its own database, users, and authentication.',
  'active', 'connected', '1.0.0', 320, 24
) ON CONFLICT (system_id) DO NOTHING;

-- ============================================
-- 2. SEED ORION ADMIN
-- ============================================
INSERT INTO institution_admins (institution_id, name, email, phone, role, is_primary)
SELECT id, 'Orion Admin', 'admin@orionaden.infinityfreeapp.com', '+967-2-000-0000', 'admin', true
FROM institutions WHERE system_id = 'ORION-INS-000001'
ON CONFLICT DO NOTHING;

-- ============================================
-- 3. SEED ORION CONNECTION
-- ============================================
INSERT INTO system_connections (institution_id, connection_type, endpoint_url, status, last_test_at, last_test_success)
SELECT id, 'api', 'https://orionaden.infinityfreeapp.com', 'active', now(), true
FROM institutions WHERE system_id = 'ORION-INS-000001'
ON CONFLICT DO NOTHING;

-- ============================================
-- 4. SEED ORION HEARTBEAT
-- ============================================
INSERT INTO heartbeats (institution_id, system_id, system_version, status, payload)
SELECT id, 'ORION-INS-000001', '1.0.0', 'ok', '{"message": "System operational"}'::jsonb
FROM institutions WHERE system_id = 'ORION-INS-000001';

-- Update last_heartbeat for Orion
UPDATE institutions
SET last_heartbeat_at = now(), last_sync_at = now()
WHERE system_id = 'ORION-INS-000001';

-- ============================================
-- 5. SEED ORION SYSTEM VERSION
-- ============================================
INSERT INTO system_versions (institution_id, version, is_current, notes)
SELECT id, '1.0.0', true, 'Initial registered version'
FROM institutions WHERE system_id = 'ORION-INS-000001'
ON CONFLICT DO NOTHING;

-- ============================================
-- 6. SEED DEMO INSTITUTIONS
-- ============================================
INSERT INTO institutions (institution_id, tenant_id, system_id, name, name_ar, type, system_name, domain, governorate, city, address, contact_email, contact_phone, notes, status, connection_status, system_version, student_count, teacher_count)
VALUES
  (gen_random_uuid(), gen_random_uuid(), 'SCH-HIKMA-000001', 'Al-Hikma School', 'مدرسة الحكمة الأهلية', 'school', 'Hikma School System', 'https://hikma-school.example.com', 'صنعاء', 'صنعاء', 'صنعاء، اليمن', 'info@hikma.edu', '+967-1-111-1111', 'Demo institution', 'active', 'connected', '2.1.0', 450, 32),
  (gen_random_uuid(), gen_random_uuid(), 'SCH-NOOR-000002', 'Al-Noor Modern School', 'مدرسة النور الحديثة', 'school', 'Noor School System', 'https://noor-school.example.com', 'تعز', 'تعز', 'تعز، اليمن', 'info@noor.edu', '+967-4-222-2222', 'Demo institution', 'active', 'delayed', '2.0.5', 380, 28),
  (gen_random_uuid(), gen_random_uuid(), 'SCH-SALAM-000003', 'Al-Salam Private School', 'مدرسة السلام الخاصة', 'school', 'Salam School System', 'https://salam-school.example.com', 'الحديدة', 'الحديدة', 'الحديدة، اليمن', 'info@salam.edu', '+967-3-333-3333', 'Demo institution', 'active', 'connected', '1.9.0', 290, 21),
  (gen_random_uuid(), gen_random_uuid(), 'SCH-AMAL-000004', 'Al-Amal International School', 'مدرسة الأمل الدولية', 'school', 'Amal International System', 'https://amal-school.example.com', 'صنعاء', 'صنعاء', 'صنعاء، اليمن', 'info@amal.edu', '+967-1-444-4444', 'Demo institution', 'active', 'offline', '2.1.0', 520, 38),
  (gen_random_uuid(), gen_random_uuid(), 'SCH-NAHDA-000005', 'Al-Nahda School', 'مدرسة النهضة الأهلية', 'school', 'Nahda School System', 'https://nahda-school.example.com', 'إب', 'إب', 'إب، اليمن', 'info@nahda.edu', '+967-5-555-5555', 'Demo institution', 'active', 'connected', '2.0.0', 310, 24),
  (gen_random_uuid(), gen_random_uuid(), 'SCH-IBDA-000006', 'Al-Ibdaa Private School', 'مدرسة الإبداع الخاصة', 'school', 'Ibdaa School System', 'https://ibdaa-school.example.com', 'عدن', 'عدن', 'عدن، اليمن', 'info@ibdaa.edu', '+967-2-666-6666', 'Demo institution', 'disabled', 'offline', '1.8.0', 180, 15),
  (gen_random_uuid(), gen_random_uuid(), 'SCH-MAY22-000007', '22 May School', 'مدرسة 22 مايو', 'school', '22 May School System', 'https://may22-school.example.com', 'ذمار', 'ذمار', 'ذمار، اليمن', 'info@may22.edu', '+967-6-777-7777', 'Demo institution', 'active', 'connected', '2.1.0', 210, 18),
  (gen_random_uuid(), gen_random_uuid(), 'SCH-MUSTAQBAL-000008', 'Al-Mustaqbal School', 'مدرسة المستقبل', 'school', 'Mustaqbal School System', 'https://mustaqbal-school.example.com', 'حضرموت', 'المكلا', 'المكلا، اليمن', 'info@mustaqbal.edu', '+967-7-888-8888', 'Demo institution', 'active', 'delayed', '2.0.5', 340, 26)
ON CONFLICT (system_id) DO NOTHING;

-- ============================================
-- 7. SEED DEMO HEARTBEATS
-- ============================================
INSERT INTO heartbeats (institution_id, system_id, system_version, status)
SELECT id, system_id, system_version,
  CASE WHEN connection_status = 'connected' THEN 'ok'
       WHEN connection_status = 'delayed' THEN 'warning'
       ELSE 'error' END
FROM institutions WHERE system_id LIKE 'SCH-%';

-- Update last_heartbeat for demo institutions
UPDATE institutions
SET last_heartbeat_at = CASE
  WHEN connection_status = 'connected' THEN now() - interval '5 minutes'
  WHEN connection_status = 'delayed' THEN now() - interval '30 minutes'
  ELSE now() - interval '3 hours'
END
WHERE system_id LIKE 'SCH-%';

-- ============================================
-- 8. SEED SYSTEM SETTINGS
-- ============================================
INSERT INTO system_settings (key, value, category, description, is_public) VALUES
  ('system_name', 'AWRIQ', 'general', 'System name', true),
  ('system_name_ar', 'أوراق', 'general', 'System name (Arabic)', true),
  ('system_description', 'Central Education Systems Management Platform', 'general', 'System description', true),
  ('heartbeat_interval_seconds', '300', 'connection', 'Expected heartbeat interval in seconds', true),
  ('heartbeat_delayed_threshold_minutes', '15', 'connection', 'Minutes before a system is marked delayed', true),
  ('heartbeat_offline_threshold_minutes', '60', 'connection', 'Minutes before a system is marked offline', true),
  ('default_language', 'ar', 'localization', 'Default system language', true),
  ('default_theme', 'light', 'appearance', 'Default theme', true),
  ('items_per_page', '8', 'general', 'Default items per page in lists', true),
  ('max_login_attempts', '5', 'security', 'Maximum login attempts before lockout', false),
  ('session_timeout_minutes', '60', 'security', 'Session timeout in minutes', false),
  ('enable_2fa', 'false', 'security', 'Enable two-factor authentication', false),
  ('enable_sso', 'false', 'security', 'Enable single sign-on', false),
  ('enable_email_notifications', 'true', 'notifications', 'Enable email notifications', true),
  ('enable_system_offline_alerts', 'true', 'notifications', 'Alert when systems go offline', true)
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- 9. SEED DEMO NOTIFICATIONS
-- ============================================
INSERT INTO notifications (type, title, title_ar, message, message_ar, is_read, institution_id) VALUES
  ('error', 'System Offline', 'نظام غير متصل', 'Al-Amal International School system has gone offline', 'نظام مدرسة الأمل الدولية غير متصل', false, (SELECT id FROM institutions WHERE system_id = 'SCH-AMAL-000004')),
  ('warning', 'System Delayed', 'نظام متأخر', 'Al-Noor Modern School heartbeat is delayed', 'نبض نظام مدرسة النور الحديثة متأخر', false, (SELECT id FROM institutions WHERE system_id = 'SCH-NOOR-000002')),
  ('success', 'New Institution Registered', 'مؤسسة جديدة مسجلة', 'Orion Institute has been successfully registered', 'تم تسجيل معهد Orion بنجاح', false, (SELECT id FROM institutions WHERE system_id = 'ORION-INS-000001')),
  ('warning', 'System Delayed', 'نظام متأخر', 'Al-Mustaqbal School heartbeat is delayed', 'نبض نظام مدرسة المستقبل متأخر', true, (SELECT id FROM institutions WHERE system_id = 'SCH-MUSTAQBAL-000008')),
  ('info', 'Version Update Available', 'تحديث إصدار متاح', 'New version 2.2.0 available for several systems', 'إصدار جديد 2.2.0 متاح لعدة أنظمة', false, NULL),
  ('security', 'Security Event', 'حدث أمني', 'Multiple failed login attempts detected', 'تم رصد محاولات دخول فاشلة متعددة', true, NULL)
ON CONFLICT DO NOTHING;

-- ============================================
-- 10. SEED DEMO ACTIVITY LOGS
-- ============================================
INSERT INTO activity_logs (action, resource, resource_id, institution_id, details)
SELECT 'connection_test', 'system_connection', sc.id::text, i.id, 'Connection test successful'
FROM system_connections sc
JOIN institutions i ON i.id = sc.institution_id
WHERE i.system_id = 'ORION-INS-000001';

INSERT INTO activity_logs (action, resource, resource_id, institution_id, details)
SELECT 'institution_registered', 'institution', i.system_id, i.id, 'Institution registered in AWRIQ'
FROM institutions i;

INSERT INTO activity_logs (action, resource, details)
VALUES
  ('login', 'auth', 'User logged in'),
  ('system_status_check', 'system', 'System status checked'),
  ('report_generated', 'report', 'Central report generated');
