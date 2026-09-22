/*
# Create Super Admin User

1. Purpose
- Create an authenticated user with email admin@awriq.app and password admin@123
- Assign the super_admin role to this user
- Create a user_profiles entry

2. Changes
- Insert into auth.users (Supabase auth table)
- Insert into user_profiles
- Insert into user_roles linking to super_admin role

3. Security
- This is a one-time bootstrap of the system administrator
- The user will be able to sign in with email/password
*/

-- Delete existing user if any (for idempotency)
DELETE FROM auth.users WHERE email = 'admin@awriq.app';

-- Create auth user with password
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'admin@awriq.app',
  crypt('admin@123', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"role": "super_admin"}'::jsonb,
  '{"full_name": "مدير عام النظام"}'::jsonb,
  '',
  '',
  '',
  ''
);

-- Create user profile
INSERT INTO user_profiles (user_id, full_name, is_active)
SELECT id, 'مدير عام النظام', true
FROM auth.users
WHERE email = 'admin@awriq.app'
ON CONFLICT (user_id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  is_active = true;

-- Assign super_admin role
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM auth.users u, roles r
WHERE u.email = 'admin@awriq.app' AND r.name = 'super_admin'
ON CONFLICT (user_id, role_id) DO NOTHING;
