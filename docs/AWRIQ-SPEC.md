# AWRIQ — Remote Project Maintenance & AI Engineering Platform

> **مواصفة هندسية كاملة (Single Specification Document)**
> نسخة 1.0 — مدخل الشكل "قريب من OpenCode عبر المتصفح، بهوية AWRIQ"
>
> هذه الوثيقة هي المرجع الوحيد لبناء وتطوير AWRIQ. أي قرار معماري لا يظهر هنا يُضاف إليها قبل التنفيذ.

---

## 1. الملخص التنفيذي (Vision)

AWRIQ ليس نظام إدارة مدارس. AWRIQ هو **منصة صيانة وإدارة مشاريع برمجية عن بُعد**، يملك فيها المستخدم مشاريعه، ويتصل بها عبر GitHub + Vercel + Supabase، ويعمل عليها **AI Coding Agent حقيقي** (وليس chatbot):

- يقرأ ملفات المشروع ويفهم بنيته.
- يتعامل مع GitHub (clone / read / edit / diff / commit / push).
- يقرأ أخطاء Vercel والـdeployment ولوغاتها.
- يتفاعل مع Supabase عند الحاجة.
- يعدّل الملفات، يشغّل الاختبارات والأوامر المسموحة.
- يعرض التغييرات (git diff) ويرفعها فقط **بعد موافقة المستخدم**.
- يسجّل كل عملية في سجل كامل، ويتيح التراجع.

قاعدة أولى: **لا يعتمد AWRIQ على أي نموذج مدفوع ليعمل** — المزودات المجانية أولاً، مع Fallback تلقائي بينها.

أنظمة المدارس والمعاهد (مثل Orion IMS) تصبح **مشاريع يديرها AWRIQ**، وليست وظيفته الأساسية.

---

## 2. الموقف: تغيير من التطبيق الحالي (لا إعادة بناء من الصفر)

التطبيق الحالي (Vercel: `awriq-awriq1.vercel.app`، Supabase: `qkedsdzwepgscxzvqphu`) مبني بأحرف RTL على:
- React + Vite + TypeScript، متوجه بالعربية، نشر stateless على Vercel مع `vercel.json` (SPA rewrites).
- Supabase schema قائم على "معهد/مدرسة" (institutions, heartbeats, notifications...) **ممزوج بالتسارع ببنية AI agent مكتملة إلى حد كبير**.

**الموجود فعلاً ويُبني عليه (لا يُعاد كتابته):**

| كيان | الوضع الحالي |
|---|---|
| `projects` | موجود، لكن `institution_id NOT NULL` — يجب فك الارتباط إجبارياً |
| `access_tokens` + `token_scopes` | موجود، للمشاريع — يتحول إلى طبقة توكنات المزودات |
| `agent_sessions/tasks/runs/commands/file_changes/approvals/logs` | موجود — قلب سجل الوكيل |
| `deployment_records` | موجود |
| `security_events` | موجود |
| `roles/user_roles/permissions/role_permissions` | موجود — يُوسَّع بدور "owner/viewer" |
| Pages: `Projects`, `AgentRoom`, `Connections`, `AccessTokens`, `ActivityLog`, `Security` | موجودة — إعادة تأطير واجهة |
| `user_has_role(text[])` SECURITY DEFINER helper | موجود — يُعاد استخدامه |

**غير موجود ويُبنى من الصفر:**
- `ai_providers` + `ai_models` (طبقة المزودات المجانية + fallback).
- `project_integrations` (ربط المشروع بمزوّدات GitHub/Vercel/Supabase مع `enabled` و`scopes` و`auth_method`).
- `agent_messages` (المحادثة في غرفة المشروع، مرتبطة بالوكيل).
- فك ارتباط `institution_id` عن كل جداول الوكيل (يصبح اختيارياً: "عميل/سياق" وليس شرطاً).
- التشفير والخادم الوسيط للأسرار (Edge Functions) — الأسرار لا تمر أبداً عبر المتصفح.

---

## 3. العمارة

```
                          المتصفح (React SPA على Vercel)
                                    │         HTTPS
                    ┌───────────────┴───────────────┐
                    │        supabase-js            │
                    │  (auth + RLS + Realtime)      │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │        Supabase               │
                    │   Postgres + RLS + Realtime   │
                    └───────────────┬───────────────┘
                                    │
        ┌───────────────┬───────────▼──────────────┬──────────────────┐
        │               │                          │                  │
┌───────▼──────┐ ┌──────▼───────┐ ┌───────────────▼────────────┐ ┌─────▼───────────┐
│ AI Gateway   │ │ Vercel API   │ │ GitHub API                │ │ Supabase API   │
│ (Edge Func)  │ │ deployments  │ │ clone/read/diff/commit    │ │ (التنفيذ عبر   │
│ providers +  │ │ logs/status  │ │ +push عبر توكن project    │ │ service token) │
│ fallback     │ │              │ │scoped                     │ │                │
└──────┬───────┘ └──────────────┘ └───────────────────────────┘ └────────────────┘
       │
       ▼
┌─────────────────┐
│  AWRIQ Agent    │  (أوركسترا: يوكل أدوات حقيقية على Filesystem/Git
│  Executor       │   مع approval gates بدون webhooks خارجية لازمة)
└─────────────────┘
```

**ارتباط GitHub/Vercel/Supabase مع AWRIQ نفسه:**
- AWRIQ يُدار من داخل AWRIQ: مستودع AWRIQ مدفوعاً كأي مشروع من قائمة "المشاريع".
- إصلاح "المواصفة → تنفيذ" يتبع نفس دورة العمل على مشروع AWRIQ (أي أن البناء الحالي تتم ادارته عبر المنصة نفسها لاحقاً).

**قرار معماري: أين يعيش Executor؟**
- الخيار الأول: **Supabase Edge Functions (Deno)** — قريب من قاعدة البيانات، يدير الـRealtime للتقدم المباشر، والصلاحيات عبر RLS.
- الخيار الثاني: **Vercel Functions (Node)** — أقرب للمشاريع المستضافة على Vercel.
- المواصفة: **واجهة مجردة واحدة** (`Toolbelt` interface) بحيث يمكن نقل المنفّذ بين الاثنين دون تغيير المنطق. البداية: Edge Functions.

---

## 4. قاعدة البيانات — النموذج الجديد

### 4.1 فك الارتباط عن المؤسسات
- كل الجداول المشتركة مع الوكيل: `projects`, `access_tokens`, `agent_*`, `deployment_records`, `security_events`.
- `institution_id` يصبح `nullable` مع `ON DELETE SET NULL`.
- ميراث واحد اختياري: `organizations` (يُمثّل عميلاً/سياقاً اختيارياً)، و`projects.organization_id` اختياري.

### 4.2 الجداول الجديدة

**`ai_providers`**
| عمود | نوع | ملاحظات |
|---|---|---|
| id | uuid PK | |
| code | text UNIQUE | `bigpickle`, `mimo`, `nemotron` |
| name | text | اسم العرض |
| base_url | text | نقطة OpenAI-compatible API |
| auth_method | text | `none` / `api_key` / `bearer` |
| is_free | boolean | يُفلتر أولاً |
| priority | int | ترتيب الـfallback (الدنيا = أسبق) |
| is_enabled | boolean | |
| config | jsonb | وضع/توجيه خاص بالمزود |

**`ai_models`**
| عمود | نوع | ملاحظات |
|---|---|---|
| id | uuid PK | |
| provider_id | FK ai_providers | |
| model_id | text | معرف النموذج لدى المزود |
| name | text | عرض |
| context_window | int | |
| supports_tools | boolean | للوكيل المستقبلي |
| is_default | boolean | لكل مزود نموذج افتراضي |
| is_enabled | boolean | |

**`project_integrations`**
| عمود | نوع | ملاحظات |
|---|---|---|
| id | uuid PK | |
| project_id | FK projects | |
| kind | text | `github` / `vercel` / `supabase` / `ai` |
| provider_ref | text | اسم المستودع/المشروع عند الطرف |
| scopes | jsonb | الصلاحيات المصرّحة |
| auth_method | text | `env`, `token` |
| token_enc | text | تشفير envelope (انظر §6) — **لا نص صريح** |
| is_connected | boolean | |
| last_checked_at | timestamptz | |
| health | jsonb | |

**`agent_messages`**
| عمود | نوع | ملاحظات |
|---|---|---|
| id | uuid PK | |
| session_id | FK agent_sessions | |
| sender | text | `user` / `agent` / `system` |
| content | text | |
| attachments | jsonb | file paths / diff refs / command ids |
| role_meta | jsonb | اختيار النموذج، الحالة |
| created_at | timestamptz | |

### 4.3 تدفّق البيانات (data flow)
1. المستخدم يضيف مشروعاً (`projects`) + Integrations (`project_integrations`) — الخادم يخزّن الأسرار مشفّرة.
2. يفتح غرفة (session) ويختار النموذج (افتراضي: أفضل مجاني متاح).
3. `agent_messages`: رسائل user/agent — رسالة المستخدم تنشئ Task → Runs → Commands/FileChanges/Approvals/Logs.
4. كل خطوة تنعكس على الجبهة عبر **Supabase Realtime** (channel لكل session).
5. أي عملية حساسة تُنشئ `agent_approvals` بحالة pending، والعروض في الواجهة، والمستخدم يقرر approve/reject.

### 4.4 RLS
- كل قراءة/كتابة للوكيل عبر `user_has_role` المجمّع موجود؛ يُضاف:
  - `project_integrations`: owner/admin للمشروع فقط (SELECT)؛ INSERT/UPDATE/DELETE: `super_admin` أو `central_admin`.
  - `ai_providers/ai_models`: قراءة لكل authenticated، إدارة للإدمن.
  - `agent_messages`: قراءة لأعضاء المشروع (`project_roles` أو resolve عبر owner roles)، إدراج من يملك session.
  - **قاعدة: أسرار التشفير تُقرأ وتُفكّ فقط داخل Edge Function، وليس عبر REST.**

---

## 5. طبقة المزودات — Free-First مع Fallback

### 5.1 المبدأ
"إذا لم يتوفر نموذج — **لا تتوقف الغرفة**؛ انتقل للمجاني التالي."

### 5.2 ترتيب الـfallback
1. `ai_providers` الفعّالة المرتبة بـ`priority` (المجانية أولاً دائماً).
2. لكل مزود، نشغّل طلب `ping` (تكلفة منخفضة أو نموذج tiny) بفواصل زمنية قصيرة عند بدء session لإحتساب "النموذج النشط".
3. فشل متكرر (خطأ auth / rate-limit / مهلة) → تمديد إلى المزود التالي تلقائياً + إغلاق رسالة `system` توضح التبديل.
4. لا يوجد مجاني فعّال → إشارة صريحة في الواجهة "أضف مزوداً مجانياً لتشغيل الغرفة" (بدون تعطّل).

### 5.3 المزودات الابتدائية (تُعبَّأ في seed)
| code | model مثال | ملاحظات |
|---|---|---|
| `opencode-zen` | `big-pickle` (افتراضي), `mimo-v2.5-free`, `ling-3.0-flash-free`, `nemotron-3-ultra-free` | OpenAI-compatible عبر `https://opencode.ai/zen/v1` |
| `opencode-go` | نماذج خطة Go المجانية | بديل (اختباري) |

> **نتيجة تحقق فعلي (2026-09-24):** الـfree tier لدى Zen **لا يقبل الاستدعاء من خادم خارجي مجهول**:
> - `GET /zen/v1/models` متاح بلا مصادقة (يحتاج User-Agent عادي، وإلا Cloudflare 403).
> - `POST /zen/v1/chat/completions` مع `Authorization: Bearer public` (المعروض كـ `allowAnonymous`) يعيد:
>   `FreeTierError: "OpenCode's free tier can only be used from within OpenCode"`.
> - معناه: تَجاهل أي ادعاء بأن "public token يكفي" — الكود الحقيقي في `handler.ts` يحوّل `public` إلى `undefined` ويقبل مجهولاً فقط إذا `modelInfo.allowAnonymous`، ومن ثم يرفض المصبّ.
>
> **قرار التصميم:** لا نعدّ "public = يشغّل فوراً". يبقى `public` خط المحاولة الأول في سلسلة fallback، وعند `FreeTierError` أو 401/429 ننتقل تلقائياً لمزود مجاني تالٍ أو لمزود **bring-your-own-key** (أي endpoint OpenAI-compatible مجاني مثل Groq/OpenRouter/GLHF free tiers). يبقى المبدأ: **تعمل الغرفة بمجرد توفر أي مزود مجاني فعّال، دون نماذج مدفوعة**. ملء `apiKey` في `project_integrations(kind='ai').token_enc` أو في `ai_providers.config` اختياري ويمر عبر الخادم فقط.

### 5.4 بنية الكود
```
src/
  lib/ai/
    types.ts            // AIProvider, AIModel, ChatMessage, StreamChunk
    gateway.ts          // resolveProvider(fallback chain) -> active provider
    providers/
      openaiCompatible.ts  // adapter واحد OpenAPI-compatible (90% الحالات)
      registry.ts       // map: code -> adapter
```
**قاعدة:** لا يُستدعى أي نموذج خارج `gateway.ts`. الواجهة: `streamChat(messages, {onChunk, onSwitch})`.

---

## 6. الأمان — التوكنات والموافقات والسجل

### 6.1 تخزين الأسرار — لا نص صريح أبداً
- المتصفح لا يرى أبداً توكن GitHub/Supabase/Vercel ولا مفاتيح التشفير.
- Edge Function واحدة (`v1/secret`) تفكّ `token_enc` بفك envelope (AES-256-GCM؛ مفتاح البيانات `DEK` مشفّر بمفتاح رئيسي `KEK` في متغير بيئة الفانكشن).
- يتم حقن السر في وقت الاتصال فقط داخل الفانكشن، ولا يُسجَّل حتى في logs.
- GitHub: **Fine-grained PAT** مقيد بالمستودعات والصلاحيات. Supabase: **Scoped PAT** بمشاريع محددة.
- `access_tokens`: يبقى للأغراض التشغيلية (revoke/rotate) ويُكمَّل بـ`project_integrations` للآلية.

### 6.2 نموذج الموافقات (Approval Gates)
قائمة العمليات **الدائما محظورة بدون موافقة** (تصنيف في `agent_approvals.action_type` و`risk_level`):

| عمل | risk |
|---|---|
| git push / commit مع push | عالية |
| حذف ملفات | عالية |
| تعديل ملفات خارج جذر المشروع | حرجة |
| أوامر تشغيل (run) غير القائمة البيضاء | متوسط |
| deploy إلى production | حرجة |
| كتابة قاعدة بيانات | حرجة |
| تغيير إعدادات | متوسط |

- قائمة بيضاء لكل مشروع (`project_integrations.scopes` + إعدادات allow-list للأوامر).
- جلسة `read_only` و`analyze` لا تقدر أبداً على تنفيذ عمليات كتابة حتى لو وافق المستخدم.
- **Timeout**: طلب موافقة بلا رد خلال 10 دقائق = `expired` (آمن افتراضياً).

### 6.3 السجل الكامل والتراجع
- `agent_logs` + `agent_approvals` + `agent_runs.actions` = تاريخ غير قابل للمسح من قبل non-admin.
- التراجع: قبل `git push` نسجّل sha الحالي؛ زر "Rollback" يعمل `git revert <sha>` ويعيد النشر (يسجَّل في `deployment_records.rollback_id`).

---

## 7. أوركسترا الوكيل (AWRIQ Agent Executor)

### 7.1 دورة جلسة الوكيل
1. `agent_sessions` بوضع `analyze`/`fix_with_approval`/`full_development`. (يُحذف `emergency` أو يشترط مشرفاً ثانياً.)
2. عند رسالة مستخدم: `agent_tasks` (pending) → `agent_runs` (running).
3. الوكيل يبني رد الفعل عبر `gateway.streamChat` + أدوات حقيقية.
4. كل أداة تسجّل: نجاح/فشل، ملف، أمر، وقت.
5. نهاية الركض: جمع `agent_file_changes` → `git diff` → عرض الانسقاف إلى الواجهة → موافقة → push → (اختيارياً) deploy → تحقق صحّة.

### 7.2 قائمة الأدوات (Toolbelt) — الإصدار M1
| أداة | قراءة | تنفيذ | ملاحظات |
|---|---|---|---|
| `fs.read` / `fs.list` / `fs.glob` | ✅ | — | |
| `grep` (ripgrep) | ✅ | — | |
| `git.status` / `git.diff` / `git.log` | ✅ | — | |
| `git.checkout` (فرع العمل) | — | ✅ | قائمة بيضاء |
| `fs.write` (ملفات مؤقتة staging) | — | ✅ | يتطلب موافقة لتطبيق |
| `shell.run` | — | ✅ | allow-list أوامر (test/build/lint) |
| `run-tests` | — | ✅ | تحديد بالأمر المسموح |
| `vercel.listDeployments` / `vercel.logs` / `vercel.deploy` | قراءة عادية | deploy يتطلب موافقة | |
| `supabase.query` | قراءات | كتابة = موافقة | |
| `github.createPR` | — | موافقة | |

**قيد بالغ الأهمية:** لا شيء يُنفذ خارج جذر متقلب `tmp/<project>` المستنسَخ، إلا ما في القائمة البيضاء.

### 7.3 تحديث فوري للواجهة
Realtime Channel باسم `agent:<session_id>`: push أحداث أداة/تقدم/حالة/طلب موافقة. الواجهة تعرضها كتيار من "أنشطة" بأسلوب الشجرة:

```
Inspecting authentication...
├── login.php
├── auth.php
└── session.php
[View changes] [Run tests]
```

---

## 8. الواجهة — مساحة عمل المشروع (UX)

### 8.1 هرم التنقل
```
القائمة الرئيسية
├── المشاريع (Projects)            ← الوجهة الأولى بعد الدخول
├── غرفة الوكيل (جلسة مفتوحة)      ← قلب النظام
├── السجل والنشاط (ActivityLog)
├── الأمان والموافقات (Security)
├── التوكنات (AccessTokens)
└── الإعدادات (Settings)
```
(تُزال صفحات الحوكمة المدرسية من القائمة الأولى، وتُنقل تحت "مشروع ما" عند التبويب إن لزم.)

### 8.2 صفحة المشاريع (Reviews)
بطاقات: الاسم، وصف، 4 حالة Integrations (GitHub ✓ / Vercel ✓ / Supabase ✓ / AI ✓)، آخر نشاط، حالة health. زر "فتح غرفة".

### 8.3 غرفة المشروع (`/projects/:id/room`) — مكوّنات OpenCode-like
- **شريط سفلي علوي**: رابط للمشروع المرتبط، مؤشر التوكن المفعّل، شارة `mode`.
- **الشجرة (Tree)**: هيكل ملفات قابل للطي، نقرة = معاينة قراءة فقط.
- **المحادثة (Chat)**: `agent_messages`؛ اختيار النموذج من dropdown حي (مزوّدات مجانية أولاً).
- **الديف (Diff view)**: `agent_file_changes` بلون إضافة/حذف في RTL.
- **الطرفية (Terminal)**: `agent_commands` output بحالة exit_code.
- **قائمة الموافقات**: pending approvals بكل التفاصيل + أزرار موافقة/رفض/انتهاء.
- **سجل/لوغات**: tab للـ`agent_logs` لكل session.
- **نشر**: حالة آخر deploys + زر تحقق.

### 8.4 تجربة جوال
اللوحة الحالية تتحول لعمود واحد: المكونات في `tabs` (Chat / Files / Diff / Terminal) بدل الأعمدة. `sidebar` يوضع تحت النقرة وعبر `.sidebar-open`.

---

## 9. نموذج الصلاحيات

- **رولات جديدة**: `owner` (كل شيء على مشروه)، `viewer` (قراءة الصحّة والسجل والموافقات دون تنفيذ).
- ربط `project_id` بالرولات: جدول `project_members` (user, project, role) جديد + `project_roles` في RLS.
- `super_admin` يبقى على مستوى المنصة.
- عمليات deploy/push تتطلب `owner` أو الموافقة الصريحة (لا يقبلها `developer` إلا بمصارفة).

---

## 10. خطة الترحيل من التطبيق الحالي

### 10.1 قاعدة البيانات (مigrations تسلسلية، غير مدمرة)
1. `projects.institution_id` → nullable + `organizations` opt-in.
2. `ai_providers` + `ai_models` + seeds المجانية.
3. `project_integrations` + تشفير + `project_members` + `agent_messages`.
4. هامة: نقل seed لأسرار المزودات في Edge Functions (vault/env) وليس SQL.
5. RLS جديدة + فهرسة.

### 10.2 الكود
1. `src/lib/ai/*` (جديد).
2. Edge Functions: `secret`, `gateway-proxy` (First M1).
3. Route: ترتيب صفوف `projects` في App.tsx وتقليل دالة `institutions`.
4. تحويل `AgentRoomPage` إلى الغرفة الكاملة (M2).

### 10.3 النشر
- يبقى نفس Vercel + نفس Supabase؛ `vercel.json` يبقى للحفاظ على SPA rewrites.
- ملاحظة مهمة: **`vite build` يمسح `dist`** — لذلك `vercel.json` مصدره `src/` (أو نسخة في `dist/` تُولَّد في script build). يُحفظ في جذر المشروع ويُنسخ بعد كل build.

---

## 11. مراحل التنفيذ (Roadmap)

| Milestone | المحتوى | قبول (Acceptance) |
|---|---|---|
| **M0** | spec (هذه الوثيقة) | موافقة المستخدم على §4-§8 |
| **M1** | schema freedoms + `ai_providers`/`models`/`integrations` + Edge Functions `secret`/`gateway` + `src/lib/ai` walk | الاتصال القابل للعرض بمزود مجاني فعلي من المتصفح (ping) |
| **M2** | غرفة كاملة: chat + شجرة + أدوات قراءة + command allow-list + نشر قواعد البيانات فعلياً | مهمة "افحص/اشرح" تُنفّذ أدوات قراءة حقيقية على مستودع حقيقي |
| **M3** | أدوات كتابة + approval gates + diff view + git commit/push + verify | دورة إصلاح كاملة بموافقة وend-to-end على مشروع حقيقي |
| **M4** | deploy إلى Vercel عبر integration + قراءة logs + rollback | إصلاح + نشر من الغرفة والتحقق من الحالة |
| **M5** | تراجع/سجل/تقارير، جوال، صلابة الإنتاج، تجربة على AWRIQ نفسه | استخدام المكاني الذاتي (dogfooding) للبناء الحالي |

---

## 12. قرارات مفتوحة (تُحسم قبل M1)

1. **نقطة تنفيذ الوكيل النهائية**: Edge Functions (Deno) أم Vercel Functions (Node)؟
2. **الـendpoint الحقيقي للـInference المجانية** — مُتحقَّق منه فعلياً: `https://opencode.ai/zen/v1/chat/completions` (OpenAI-compatible)، والنماذج المجانية `big-pickle`, `mimo-v2.5-free`, `ling-3.0-flash-free`, `nemotron-3-ultra-free`. `Bearer public` لا يكفي خارج عميل OpenCode (FreeTierError) → fallback إجباري لمزود BYOK مجاني.
3. هل نبدأ بتوكن `apiKey` مخزّن في env الخاص بـAWRIQ كـ"مزود داخلي" لإثبات التدفق قبل فتح ربط المزود الخارجي؟
4. تركيبة allow-list لأوامر القشرة لكل مشروع (ميلاد أول): `npm test`, `npm run build`, `npm run lint`.
5. هل يُقبل `git push` مباشر أم يُفرض **PR** على المشاريع غير الـowner؟ (اتجاه: push مباشر للمشاريع الخاصة، PR للمشاركات).

---

*ملاحظة قانونية تجسيدية: هذه وثيقة داخل مستودع AWRIQ نفسه؛ لذا أي تحديث مستقبلي يمر عبر نفس دورة "غرفة المشروع" المذكورة في §7، مع سجلّ الموافقات كاملاً.*