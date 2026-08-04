# Mediogram Portal — развёртывание

Порядок: Supabase → GitHub-репозиторий → Pages → Edge Function → Resend → пайплайн в боте.
Команды выполняются по одной, сверху вниз.

## Шаг 1. Supabase-проект (браузер, ~3 минуты)

1. https://supabase.com → New project → название `mediogram-portal`, регион EU (Frankfurt), сгенерируйте и сохраните database password.
2. Project Settings → API: скопируйте **Project URL**, **anon public key**, **service_role key** (последний — секрет, никому и никуда кроме GitHub Secrets).
3. Authentication → Sign In / Up → Email: включите **Email**, выключите **Allow new users to sign up** (регистрация закрыта — врачей приглашает админ).
4. Authentication → URL Configuration → Site URL: `https://<ваш-логин>.github.io/mediogram-portal/` и добавьте тот же адрес в Redirect URLs.

## Шаг 2. Схема БД

SQL Editor → New query → вставьте целиком `supabase/migrations/001_init.sql` → Run.
Должно завершиться без ошибок (Success. No rows returned).

## Шаг 3. Локальный запуск и первый админ

```bash
git init && git add -A && git commit -m "Mediogram Portal v1"
```

```bash
cp .env.example .env
# откройте .env и вставьте Project URL и anon key из шага 1
```

```bash
npm install && npm run dev
```

Создайте себе аккаунт: Supabase Dashboard → Authentication → Users → **Invite user** → ваш email. Перейдите по ссылке из письма, затем сделайте себя админом (SQL Editor):

```sql
update profiles set role = 'admin', full_name = 'Nazar' where email = 'ВАШ_EMAIL';
```

Обновите страницу — появится вкладка «Админ».

## Шаг 4. GitHub + Pages

```bash
gh repo create mediogram-portal --public --source=. --push
```

```bash
gh secret set VITE_SUPABASE_URL --body "https://ВАШ-ПРОЕКТ.supabase.co"
```

```bash
gh secret set VITE_SUPABASE_ANON_KEY --body "ВАШ_ANON_KEY"
```

В настройках репо: Settings → Pages → Source: **GitHub Actions**. Затем:

```bash
git push origin main
```

Через минуту портал живёт на `https://<логин>.github.io/mediogram-portal/`.

## Шаг 5. Edge Function (приглашения из админки)

```bash
npm i -g supabase
```

```bash
supabase login
```

```bash
supabase link --project-ref ВАШ_PROJECT_REF
```

```bash
supabase secrets set PORTAL_URL="https://<логин>.github.io/mediogram-portal/"
```

```bash
supabase functions deploy admin-invite
```

(SUPABASE_URL / ANON / SERVICE_ROLE в функциях доступны автоматически.)

## Шаг 6. Resend (рассылка)

1. https://resend.com → создайте аккаунт → Domains → добавьте домен mediogram (или начните с их тестового) → пропишите DNS-записи.
2. API Keys → создайте ключ.

## Шаг 7. Пайплайн в приватном репо бота

Скопируйте в репо `mediogram-lead-radar`:
- `scripts/sync_to_db.mjs` и `scripts/send_digest.mjs` → в `scripts/`
- `.github/workflows/weekly-pipeline.example.yml` → как основу workflow (встройте существующие шаги бота перед Sync)

Секреты бота:

```bash
gh secret set SUPABASE_URL -R Nnnnshsjsjsj/mediogram-lead-radar --body "https://ВАШ-ПРОЕКТ.supabase.co"
```

```bash
gh secret set SUPABASE_SERVICE_ROLE_KEY -R Nnnnshsjsjsj/mediogram-lead-radar --body "SERVICE_ROLE_KEY"
```

```bash
gh secret set RESEND_API_KEY -R Nnnnshsjsjsj/mediogram-lead-radar --body "re_..."
```

```bash
gh secret set PORTAL_URL -R Nnnnshsjsjsj/mediogram-lead-radar --body "https://<логин>.github.io/mediogram-portal/"
```

```bash
gh secret set FROM_EMAIL -R Nnnnshsjsjsj/mediogram-lead-radar --body "Mediogram Radar <radar@ВАШ-ДОМЕН>"
```

```bash
gh secret set SLACK_WEBHOOK_URL -R Nnnnshsjsjsj/mediogram-lead-radar --body "https://hooks.slack.com/..."
```

Тестовый прогон: Actions → Weekly digest → Run workflow. В Slack должно прийти ✅.

## Контракт для бота (улучшение качества описаний)

Скрипт синхронизации работает с текущим `latest.json` как есть (возьмёт `summary` и сам определит категорию). Чтобы описания стали «врачебного» уровня, добавьте в AI-шаг бота генерацию двух полей на каждый lead:

- `title_ru` — заголовок по-русски;
- `summary_ru` — 3 абзаца: суть исследования → методология → почему значимо для практики;
- (опционально) `category` — один из: `arrhythmia | structural | hf | mcs | antithrombotic | antiarrhythmic | devices | other`.

Ничего больше менять не нужно — портал подхватит поля автоматически.
