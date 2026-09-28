/*
# Migration: add Pollinations as a free, browser-friendly fallback provider.

## Why
- `opencode-zen` with `Bearer public` is rejected outside the OpenCode client
  (FreeTierError, HTTP 403 without `access-control-allow-origin`), so direct
  browser fetch fails with `Failed to fetch`.
- `pollinations.ai` (text.pollinations.ai/openai) is OpenAI-compatible, free
  (no API key), and returns `access-control-allow-origin: *`, so it works
  directly from the AWRIQ browser origin with SSE streaming.

Status: free-first fallback follow-up (see docs/AWRIQ-SPEC.md, §5.3).
*/

INSERT INTO ai_providers (code, name, base_url, auth_method, is_free, priority, config) VALUES
  ('pollinations', 'Pollinations AI', 'https://text.pollinations.ai/openai', 'none', true, 20,
   '{"openai_compatible": true}'::jsonb)
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
  ('openai-fast', 'OpenAI Fast (Pollinations)', 128000, false, true, true, 0, 0)
) AS m(model_id, name, context_window, supports_tools, is_default, is_enabled, cost_input_usd, cost_output_usd)
WHERE p.code = 'pollinations'
ON CONFLICT (provider_id, model_id) DO NOTHING;
