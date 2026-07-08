# FounderLab AI

A premium AI workspace for founders, builders, and creators. Chat, Notes, Tasks, YouTube AI, Code AI, and Website Builder — all in one app.

## AI Providers

FounderLab AI supports four providers. Switch between them in **Settings → AI Provider** with no code changes.

| Provider | Type | Free tier | Key env var |
|---|---|---|---|
| **Anthropic Claude** | Cloud | No | `ANTHROPIC_API_KEY` |
| **Groq** | Cloud (fast inference) | Yes | `GROQ_API_KEY` |
| **Google Gemini** | Cloud | Yes | `GEMINI_API_KEY` |
| **Ollama** | Local (your machine) | Always free | None |

All cloud API keys are **server-side only** — they are read from `process.env` inside Vercel serverless functions and are never sent to the browser.

---

## Environment Variables

### Setup

```bash
cp .env.example .env.local
```

Then open `.env.local` and fill in your keys:

```env
# Supabase — required for auth and cloud sync
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...

# AI Providers — add keys for whichever providers you want to use
ANTHROPIC_API_KEY=sk-ant-api03-...
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AIza...
OPENAI_API_KEY=sk-...   # reserved for future use
```

> **VITE_ prefix rule:** Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` use the `VITE_` prefix (safe public values). Never prefix AI API keys with `VITE_` — doing so would expose them in the browser bundle.

### Where to paste your keys

**Local development:** Open `.env.local` in the project root and paste your values there.

**Vercel deployment:** Go to your Vercel project → Settings → Environment Variables and add each key individually. Never commit `.env.local` — it is in `.gitignore`.

---

## Local Development

```bash
# Install dependencies
npm install

# Start dev server (Vite + Vercel serverless functions)
npx vercel dev

# Or start Vite only (AI calls to /api/ai will fail without Vercel CLI)
npm run dev

# Build for production
npm run build
```

> **Vercel CLI for local AI:** To test AI providers locally, run `npx vercel dev` instead of `npm run dev`. This starts both the Vite frontend and the `/api/ai` serverless function with your `.env.local` keys loaded.

---

## Ollama Setup

Ollama runs 100% locally — free forever, fully private.

### 1. Install Ollama

```bash
# macOS
brew install ollama

# Or download from https://ollama.com
```

### 2. Pull a model

```bash
ollama pull llama3.2           # 2GB — recommended starting point
ollama pull llama3.2:1b        # 1GB — fastest, smallest
ollama pull mistral            # 4GB — excellent quality
ollama pull gemma2:2b          # 1.6GB — great for coding
```

### 3. Start with CORS enabled (web app only)

When using the **web app** (not the desktop app), your browser blocks cross-origin requests to localhost unless Ollama allows them:

```bash
# macOS / Linux
OLLAMA_ORIGINS=* ollama serve

# Windows (Command Prompt)
set OLLAMA_ORIGINS=* && ollama serve

# Windows (PowerShell)
$env:OLLAMA_ORIGINS="*"; ollama serve

# macOS menu bar app
launchctl setenv OLLAMA_ORIGINS "*"
# Then quit and reopen Ollama
```

### 4. Connect in the app

Open **Settings → AI Provider → Local Ollama** → click **Detect models** → select a model → **Save & Apply**.

> **Desktop app:** If you downloaded the macOS `.app`, CORS is handled automatically via Electron IPC. No terminal commands needed.

---

## Groq Setup

Groq provides ultra-fast inference (often 10-20× faster than standard cloud providers) with a generous free tier.

1. Sign up at https://console.groq.com
2. Create an API key
3. Add `GROQ_API_KEY=gsk_...` to `.env.local`
4. In Vercel: add `GROQ_API_KEY` as an environment variable
5. In the app: **Settings → AI Provider → Groq** → select a model → **Test Connection** → **Save**

**Available models:**
- `llama-3.3-70b-versatile` — best quality (default)
- `llama-3.1-8b-instant` — fastest
- `mixtral-8x7b-32768` — long context
- `gemma2-9b-it` — Google's Gemma 2

---

## Gemini Setup

Google Gemini has a generous free tier (60 requests/minute on Gemini 1.5 Flash).

1. Go to https://aistudio.google.com/app/apikey
2. Create an API key
3. Add `GEMINI_API_KEY=AIza...` to `.env.local`
4. In Vercel: add `GEMINI_API_KEY` as an environment variable
5. In the app: **Settings → AI Provider → Google Gemini** → select a model → **Test Connection** → **Save**

**Available models:**
- `gemini-2.0-flash-exp` — latest, fastest (default)
- `gemini-1.5-pro` — most capable
- `gemini-1.5-flash` — fast, free tier

---

## Deployment Instructions

### Vercel (recommended)

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

Or use the GitHub Actions workflow already in `.github/workflows/vercel-deploy.yml` — push to `main` and it deploys automatically.

**Required Vercel environment variables:**

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Your Supabase anonymous key |
| `ANTHROPIC_API_KEY` | If using Anthropic | Claude API key |
| `GROQ_API_KEY` | If using Groq | Groq API key |
| `GEMINI_API_KEY` | If using Gemini | Google AI API key |

### Supabase Schema

Run this SQL in your Supabase SQL Editor before first use:

```sql
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text, role text, goal text,
  onboarded boolean default false,
  created_at timestamp default now()
);
create table public.user_data (
  id bigserial primary key,
  user_id uuid references auth.users on delete cascade,
  key text not null, value jsonb,
  created_at timestamp default now(),
  unique(user_id, key)
);
create table public.usage_events (
  id bigserial primary key,
  user_id uuid references auth.users on delete cascade,
  event text, page text,
  created_at timestamp default now()
);
create table public.fl_feedback (
  id bigserial primary key,
  user_id uuid references auth.users on delete cascade,
  email text, type text, description text,
  status text default 'open',
  created_at timestamp default now()
);
-- Enable row-level security
alter table public.profiles enable row level security;
alter table public.user_data enable row level security;
alter table public.usage_events enable row level security;
alter table public.fl_feedback enable row level security;
-- Policies
create policy "Users manage own profile" on public.profiles for all using (auth.uid() = id);
create policy "Users manage own data" on public.user_data for all using (auth.uid() = user_id);
create policy "Users log own events" on public.usage_events for all using (auth.uid() = user_id);
create policy "Users manage own feedback" on public.fl_feedback for all using (auth.uid() = user_id);
```

---

## Troubleshooting

### "AI error: ANTHROPIC_API_KEY is not configured on the server"
Add `ANTHROPIC_API_KEY` to your Vercel environment variables (not `.env.local` — that's local only). Redeploy after adding.

### "AI error: GROQ_API_KEY is not configured on the server"
Same as above but for `GROQ_API_KEY`.

### Ollama: "Cannot reach Ollama"
- Make sure Ollama is running: `ollama serve`
- Start with CORS enabled: `OLLAMA_ORIGINS=* ollama serve`
- Verify the URL in Settings matches where Ollama is running (default: `http://localhost:11434`)

### "Setup Required" screen on load
`VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing from the Vercel environment. Add both and redeploy.

### Ollama works locally but not after deploy
This is expected — a cloud server cannot reach your local machine's `localhost:11434`. Use the web app in your browser (same machine as Ollama), or use the macOS desktop app.

---

## Architecture

```
src/App.jsx          — Single-file React app (inline styles, no CSS files)
api/ai.js            — Unified serverless handler (Anthropic + Groq + Gemini + Ollama)
api/package.json     — CommonJS marker for Vercel serverless
.env.local           — Your real keys (gitignored, never committed)
.env.example         — Template with empty values (committed)
```

### Provider routing

```
User selects provider in Settings
    ↓
ai(messages, system, max)   ← all features call this
    ↓ ollama?
    → ollamaChat()  →  browser fetch to localhost:11434 (or Electron IPC)
    ↓ cloud provider?
    → POST /api/ai  →  Vercel serverless  →  reads process.env  →  provider API
```
✅ Added free Groq + Gemini AI support.
