# JADE Cloud — Setup Guide

These two files wire up cross-device sync for the JADE Debate Tab app
using Vercel Serverless Functions + Supabase as the shared database.

---

## What you're adding

```
api/
  jade-cloud.js   ← main cloud function (sign-in, sync, access links)
  ping.js         ← health check used by the app to detect cloud mode
supabase/
  jade-workspace.sql  ← run once in Supabase SQL Editor
```

---

## Step 1 — Create a Supabase project

1. Go to https://supabase.com and create a free project.
2. Once it's ready, open the **SQL Editor**.
3. Paste the contents of `supabase/jade-workspace.sql` and click **Run**.
4. From **Project Settings → API**, copy:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **service_role** key (under "Project API keys" — use the secret key, not the anon key)

---

## Step 2 — Add files to your GitHub repo

Add `api/jade-cloud.js` and `api/ping.js` to the root of your repo (alongside `index.html`).

Your repo structure should look like:
```
index.html
api/
  jade-cloud.js
  ping.js
supabase/
  jade-workspace.sql
vercel.json
package.json
...
```

---

## Step 3 — Deploy to Vercel

1. Import your GitHub repo at https://vercel.com/new.
2. Framework Preset: **Other**
3. Build command: leave blank
4. Output directory: leave blank
5. Click **Deploy**.

---

## Step 4 — Set environment variables in Vercel

In your Vercel project → **Settings → Environment Variables**, add:

| Variable                  | Value                              |
|---------------------------|------------------------------------|
| `SUPABASE_URL`            | Your Supabase project URL          |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service_role key   |
| `JADE_SESSION_SECRET`     | Any long random string (32+ chars) |
| `JADE_WORKSPACE_ID`       | *(optional)* defaults to `default` |
| `JADE_SUPABASE_TABLE`     | *(optional)* defaults to `jade_workspaces` |

For `JADE_SESSION_SECRET`, generate a strong random value, for example:
```
node -e "console.log(require('crypto').randomBytes(40).toString('hex'))"
```

Then **redeploy** the project (Vercel → Deployments → Redeploy).

---

## Step 5 — Initialize the cloud workspace

1. Open your live Vercel URL.
2. Sign in as the **System Manager** (`joshuaatkins374@gmail.com`).
3. JADE will detect the cloud backend is available and prompt you to initialize.
4. Click **Initialize Cloud Workspace** — this uploads your current local data to Supabase.

After this, all sign-ins, tournament saves, and standings updates sync to Supabase
and are visible from any device.

---

## Migrating existing data

If your data is on a different device or an older local-only version:

1. On the device with your data: **Settings → Download Full Backup**.
2. On the live Vercel site sign-in page: click **Initialize Cloud From Backup**.
3. Upload the backup JSON and sign in as System Manager.

---

## How it works

- The app checks `/api/jade-cloud` (GET) on startup.
- If it gets `{ ok: true }` back, it switches into **cloud mode**.
- All sign-ins, sign-ups, and saves go through the Vercel function.
- The function reads/writes a single JSON blob in the `jade_workspaces` Supabase table.
- Without the env vars, the function returns an error and the app falls back to `localStorage`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| App still shows "local only" | Check Vercel function logs; env vars may not be set |
| "Workspace not initialized" error | Sign in as manager to initialize first |
| Password mismatch on first cloud sign-in | Use the same password you use locally |
| Sign-up returns "send_user_record" | App version mismatch — use the latest `index.html` |
