-- M6: AI provider secrets vault.
--
-- لماذا: بنية AIProvidersPage الحالية تخزّن `config.api_key` داخل ai_providers
-- وتصل للواجهة (ai_providers_select_authenticated) فتكشف المفاتيح لأي مستخدم.
-- M6 ينقل مفاتيح المزوّدات (BYOK) إلى جدول مقفول RLS (لا سياسات: service role فقط)
-- والمفتاح يشفر AES-256-GCM بمفتاح PAX_MASTER_KEY (سر دالة edge) + provider_id.
--
-- لا تُنشأ أي سياسات SELECT/INSERT/UPDATE/DELETE للمستخدمين؛ حتى السوبر-أدمن
-- لا يرى السر-الخام عبر SQL؛ الواجهة تمر دائمًا عبر دالة ai-proxy.

CREATE TABLE IF NOT EXISTS ai_provider_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  encrypted_secret text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_provider_secrets_scope_key UNIQUE (provider_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_secrets_provider ON ai_provider_secrets(provider_id);

ALTER TABLE ai_provider_secrets ENABLE ROW LEVEL SECURITY;

-- لا سياسات RLS: الوصول فقط عبر role/service key (دالة ai-proxy) أو مالك الجدول.