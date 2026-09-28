# AWRIQ Project Access

نظام وصول مقيّد بالمشروع (Project-Scoped Access) يسمح لوكيل برمجي (OpenCode حاليًا،
وأي وكيل مستقبلي) بالاتصال بمشروع واحد فقط — لا يمكن لأي Token الوصول لمشروع آخر.

## البنية

```
Agent (OpenCode / CLI)  ->  Edge Function `project-access`  ->  Supabase (Postgres RLS)
                                   (Deno, service-role)           + GitHub (read-only)
```

- **لا يوجد Backend Node مخصص**؛ البوابة `project-access` هي الواجهة الوحيدة بين
  الوكيل وبين بيانات المشروع.
- **التوثيق**: `Authorization: Bearer awriq_prj_...`، ويُخزَّن فقط بصمة
  `SHA-256` في `access_tokens`؛ لا يُخزَّن ولا يُعاد عرضُه أبدًا.
- **العزل**: `project_id` يُشتق من سطر الـToken حصريًا؛ أي `project_id` مخالف في
  الطلب يُرفض بـ `403 PROJECT_ACCESS_DENIED`.

## أنماط الوصول (Profiles)

| النمط | الصلاحيات |
|---|---|
| `READ_ONLY` | قراءة ملفات + سجل + لقطات (قراءة فقط) |
| `DEVELOPER` | + كتابة/حذف/إعادة تسمية ملفات، أوامر، Git write، لقطات (ذات موافقة) |
| `FULL_AGENT` | كل ما سبق + استعادة لقطات، رد على موافقات، إعدادات المشروع |

عناوين الصلاحيات المعيارية (عنقود fiي ص) تُخزّن في `access_tokens.permissions`
ويُحترَم النمط القديم `scopes` للتوافق (خريطة ترجمة في البوابة).

## نقاط النهاية (gateway)

`POST $GATEWAY/...` حيث `$GATEWAY = https://{ref}.functions.supabase.co/project-access`

| المسار | الصلاحية | الوصف |
|---|---|---|
| `GET /me` | — | هوية المشروع + التوكن + الصلاحيات الفعلية |
| `POST /sessions` | sessions.create | فتح جلسة وكيل |
| `GET /sessions` | sessions.list | جلسات التوكن |
| `POST /sessions/:id/close` | sessions.close | إغلاق جلسة |
| `GET /tree?path` | files.read | سرد شجرة (GitHub) |
| `GET /file?path` | files.read | قراءة ملف (GitHub) — مع حماية المسار |
| `POST /files/write` | files.write | تجهيز تعديل → موافقة pending |
| `POST /files/delete` | files.delete | تجهيز حذف → موافقة pending |
| `POST /commands` | commands.execute | طلب أمر → موافقة pending (التنفيذ عند الوكيل المحلي) |
| `GET /approvals?status` | commands.read | موافقات التوكن |
| `POST /snapshots` | snapshots.create | تسجيل لقطة حالة |
| `GET /snapshots` | snapshots.list | لقطات المشروع |
| `GET /logs` | logs.read | سجل تدقيق المشروع |

ملاحظة قراءة الملفات: للريبوهات الخاصة، البوابة تستخدم **تلقائيًا** GitHub PAT
المخزّن في اعتمادات المشروع (لا يُسلَّم للوكيل ولا يتطلب `X-Git-Token`).

### نقاط نهاية طبقة التنفيذ (M5 / PAX-EXEC)

| المسار | الصلاحية | الوصف |
|---|---|---|
| `POST /changes/apply` | git.write | تنفيذ الموافقات المعتمدة: commit + push إلى GitHub بفرع معيّن |
| `GET /credentials/status` | tokens.read | حالة الاعتمادات المشفّرة (مقنّعة) |
| `GET /datastore/tables` | datastore.read | قائمة جداول (best-effort عبر anon) |
| `POST /datastore/query` | datastore.read | استعلام PostgREST مع فلاتر وحد أقصى 500 صف |
| `POST /datastore/insert` · `update` · `delete` | datastore.write | كتابة مقيّدة بعلامة `datastore_write_enabled` |
| `POST /deploys` | deploy.trigger | إطلاق نشر (Vercel redeploy إن وُجدت الاعتمادات، وإلا external/queued) |
| `GET /deploys` | deploy.read | سجل النشر |

## حماية المسارات (أمني)

- Canonicalization لكل مسار؛ يُمنع مطلقًا: `..`, المسارات المطلقة `/`, الفواصل
  العكسية `\`, `\0`, `:` والحرف `~`.
- المسارات خارج `root_path` للمشروع تُرفض (`PATH_OUTSIDE_SCOPE`).
- **قائمة حظر**: `.env*`, `.npmrc`, `.netrc`, `.gitconfig`, `.git`, `.ssh`,
  `.aws`, `id_rsa*`, أسماء تحوي `credential`/`secret`/`service-account`/
  `private-key`, وامتدادات `*.pem *.key *.p12 *.pfx *.pkcs8 *.der`، ولقطات BD
  `*.dump *.dmp *.sql.gz *.tar.gz` → `403 PATH_FORBIDDEN`.

## الموافقات (Approval Gates)

- كل كتابة وحذف وأمر تولّد صف موافقة `pending` تنتهي بعد 10 دقائق
  (`expire_stale_approvals()`).
- الأوامر الخطرة (`rm -rf`, `git push --force`, `git reset --hard`, `sudo`,
  `drop database`, …) تُصنَّف `critical`.
- المراجعة تتم من واجهة **Project Access** (Allow/Deny) وبواسطة مدير المشروع فقط
  (RLS: `user_can_manage_project`).

## التنفيذ المحلي للأوامر

لا توجد أرضية تنفيذ في السحابة؛ البوابة تمنح **التفويض + التدقيق** (`commands.execute`
مع `agent_commands.is_approved=false` ثم موافقة)، والوكيل المحلي (لديه النسخة) ينفّذ
بعد الموافقة. أي أمر يسجَّل في `agent_commands` + `audit_logs`.

## الجلسات واللقطات

- `agent_sessions` مسكّرة بـ `token_id`؛ `user_id` قد يكون مفرّغًا (جلسة Bridge).
- `project_snapshots` تسجّل حالة Git (فرع/commit/ملصق) كنقطة مرجعية لأساس استعادة لاحق.

## الاعتمادات والأسرار (M5)

- جدول `project_credentials` يخزّن أسرار المشروع **مشفّرة AES-256-GCM**
  (`enc:v1:<iv>:<ct>`) بمفتاح `PAX_MASTER_KEY` (سر دالة edge) + معرّف المشروع.
- التشفير داخل الخادم فقط؛ الواجهة ترى قيمًا مقنّعة (`github_token_masked`…)،
  والوكيل لا يصل أبدًا إلى سر خام.
- الأسرار: `github_token` (تطبيق تغييرات Git + قراءة الريوهات الخاصة)،
  `vercel_token` (نشر)، `supabase_url` + `supabase_anon_key` + `supabase_service_key` (بيانات).
- مفاتيح/قيم غير سرّية (Vercel Project ID، Supabase Ref) تُخزَّن نصًّا.
- إفراغ حقل سري في الواجهة **يحذف** السر نهائيًا.
- إدارة الاعتمادات عبر الواجهة تخضع لـ `canManageProject`
  (جدول `user_roles`/`roles` أو `project_members.role='owner'`).

## تطبيق تغييرات Git (git apply)

- `POST /changes/apply {approval_ids, branch, message}` يقرأ الموافقات المعتمدة
  (مسكّرة بجلسات التوكن نفسه) ويطبّقها على GitHub باسم المشروع عبر PAT مخزّن:
  - `create/update` → `PUT .../contents/{path}`، `delete` → `DELETE...`.
  - يرجع `committed[]` (ومساراتها `sha`) و `failures[]`؛ لا تغيير إن لم يكن أي إدراج ناجح.
- القيود المتوارثة للمسار تُطبَّق على كل مسار قبل التطبيق.
- إن كان `auto_deploy=true` ووجد Vercel الاعتمادات، يُطلق النشر تلقائيًا بعد التطبيق.

## البيانات (datastore عبر البوابة)

- تُنفَّذ القراءة بالمفتاح **anon** للهدف عبر PostgREST، فتتحكم RLS لدى الهدف
  نفسها بما يُقرأ؛ جدول `projects` الخاص بـ AWRIQ لا يُسَرَّب.
- الكتابة مشروطة بصلاحية `datastore.write` **وتفعيل** `datastore_write_enabled`
  وإلا `403 DATASTORE_WRITE_DISABLED`.
- جداول محظورة: `pg_*`, `information_schema`, `auth.*`, `storage.*`, `vault.*`,
  `realtime.*`, `metrics.*` → `403 TABLE_FORBIDDEN`.
- `limit` مشدود إلى `1..500`؛ الفلاتر صيغة PostgREST (`col=eq:val`).

## النشر

- `POST /deploys` مع `vercel_token` + `vercel_project_id` يجد أحدث deployment
  إنتاجيًا ويستدعي `redeploy` (تسجَّل `deployment_uid`/`external_url`)؛ وإلا
  `provider=external, status=queued` ويُترك الدفع إلى المستودع هو المشغّل.
- السجل في `deployment_records` (مزوّد/حالة/رسالة/رابط/جلسة/موافقة) قابل للقراءة
  عبر `GET /deploys` (deploy.read) وفي تبويب **النشر** بالواجهة.

## الواجهة الإدارية (تبويبات Project Access)

- **الاعتمادات**: تضمين/تعديل/حذف الأسرار + مفاتيح التفعيل (كتابة البيانات، نشر تلقائي).
- **النشر**: إطلاق نشر يدوي + جدول الحالة والروابط.
- **البيانات**: استعلام جدول (طاولة نتائج) + إدراج JSON.
- الطلبات تُرسل بجلسة AWRIQ الحالية (`Bearer eyJ…`) وتمرر `project_id`؛ التحقق عبر
  `handleAdmin` + `canManageProject` (لا يمر طريق الوكلاء هنا).

## سطر الأوامر (Bridge CLI)

`node scripts/awriq-bridge.mjs <البيئة> <cmd> [flags]` — أوامر إضافية لطبقة التنفيذ:
`creds`, `gitapply --approvals <ids> --message --branch`,
`db-tables`, `db-query --table --filter col=eq:v --limit --order`,
`db-insert --table --rows '[json]'`, `db-update`, `db-delete`,
`deploy`, `deploys`.

## النشر (دورة حياة الدالة)

- تقع دالة `project-access` في `supabase/functions/project-access/index.ts`،
  `verify_jwt=false` (مصادقة Bearer داخلية)، تُنشر عبر Management API
  (`POST /v1/projects/{ref}/functions/deploy?slug=project-access`).
- تطبيق الـmigrations (M4, M4b, M4c, M4d, M5) عبر
  `POST /v1/projects/{ref}/database/migrations`.

## الأمان (سياسات RLS)

الوصول عبر الواجهة يخضع لـRLS:
- `user_can_manage_project` (owner/super_admin) لكافة المهام الإدارية.
- الموافقات: المراجع الذي يملك/يدير الجلسة فقط؛ الحالة ضمن
  `pending/approved/rejected/denied/expired` و `reviewed_by = auth.uid()`.
- `project_snapshots`: مدير/عضو المشروع.
- `audit_logs` و`agent_sessions`: مضاف لهما نطاق المدير/العضو عبر M4d.