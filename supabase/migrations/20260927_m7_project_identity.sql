/*
# AWRIQ Migration M7 - Project Identity (Personal Control Center)

## Purpose
Make `projects` the heart of AWRIQ as a personal project-maintenance control center:

1. `project_type`: flexible taxonomy (institution / other / program / software) so
   AWRIQ is not tied to schools — Orion, AWRIQ, Orvyn and future projects coexist.
2. GitHub/Vercel/Supabase identity columns on the project row (parsed from URL,
   or set directly) — the single source of truth for integrations.
3. `local_path`, `last_agent_session_at`, `last_activity_at` for workspace + recency.

Backward compatible: no drops of data; all columns added with IF NOT EXISTS; existing
projects backfilled from `institution_id` / `repository_url`.
*/

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS project_type text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS github_repo text,
  ADD COLUMN IF NOT EXISTS github_branch text NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS vercel_project text,
  ADD COLUMN IF NOT EXISTS supabase_project text,
  ADD COLUMN IF NOT EXISTS local_path text,
  ADD COLUMN IF NOT EXISTS last_agent_session_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_project_type_check') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_project_type_check
      CHECK (project_type IN ('institution', 'other', 'program', 'software'));
  END IF;
END $$;

-- backfill project_type from the existing institution binding
UPDATE projects
   SET project_type = CASE WHEN institution_id IS NULL THEN 'other' ELSE 'institution' END
 WHERE project_type = 'other' OR project_type IS NULL;

-- backfill github_repo from a supplied repository_url (owner/repo extracted)
UPDATE projects
   SET github_repo = NULLIF(
         regexp_replace(
           regexp_replace(repository_url, '^https?://(www\.)?github\.com/', '', 'g'),
           '(\.git)?/?$', '', 'g'),
         '')
 WHERE github_repo IS NULL
   AND repository_url IS NOT NULL
   AND repository_url <> '';

UPDATE projects SET updated_at = now() WHERE updated_at = updated_at;

CREATE INDEX IF NOT EXISTS idx_projects_type ON projects(project_type);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);