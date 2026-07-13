# FounderLab frontend architecture

`src/App.jsx` is the application shell. It owns startup, authentication state,
responsive layout, and page selection; it does not own provider, persistence,
voice, toast, navigation, or shared UI implementations.

## Boundaries

- `src/app/` contains app-wide presentation primitives: theme, toast handling,
  and the top-level error boundary.
- `src/features/` contains independently rendered product areas and layout
  components. Auth, dashboard, feedback, and navigation are already isolated.
- `src/components/` contains reusable, feature-neutral UI and content
  components.
- `src/hooks/` contains browser capability integrations such as speech
  recognition and text-to-speech state.
- `src/services/` contains external-system and persistence boundaries:
  Supabase workspace data, AI-provider routing, voice preferences, and
  session-scoped GitHub token handling.
- `src/lib/` contains deterministic utilities and product-generation helpers.

## Safety invariants

- API provider keys remain server-side; the browser submits provider selection
  and prompts only.
- GitHub personal access tokens are memory-only for the active browser
  session. They are never written to local storage.
- Generated-code previews execute in sandboxed iframes.
- Workspace persistence always keeps a local copy and treats cloud sync as a
  non-blocking enhancement.

## Server API security

`/api/ai`, `/api/youtube`, and `/api/tts` share `api/_lib/apiSecurity.js`.
It verifies the Supabase access token from the `Authorization: Bearer` header
by calling Supabase Auth's `/auth/v1/user` endpoint and derives the user ID
only from that verified response. Request bodies never supply an identity.

The shared helper also applies CORS and per-user request protection. Production
origins are configured with `FOUNDERLAB_ALLOWED_ORIGINS` (comma-separated exact
origins) or `FOUNDERLAB_PRODUCTION_ORIGIN`. Vercel preview support is opt-in:
configure either `FOUNDERLAB_VERCEL_PREVIEW_HOST_SUFFIXES` or
`FOUNDERLAB_VERCEL_PREVIEW_HOST_PREFIXES` for domains controlled by the team.
Localhost is accepted only when `NODE_ENV=development`.

Production and Vercel preview traffic requires a durable rate limiter through
`FOUNDERLAB_RATE_LIMITER_URL`. The API POSTs this JSON document, using the
server-only `FOUNDERLAB_RATE_LIMITER_TOKEN` when supplied:

```json
{
  "subject": "verified-supabase-user-id",
  "scope": "ai|youtube|tts",
  "limit": 30,
  "windowSeconds": 60
}
```

The limiter must reply with `{ "allowed": boolean, "retryAfterSeconds": number }`.
If it is absent or unavailable outside local development, FounderLab fails
closed with a normalized 503 response instead of relying on per-instance
serverless memory. In-memory limits are development-only. The only auth bypass
is `FOUNDERLAB_DEV_AUTH_BYPASS=true` with `NODE_ENV=development`; it cannot
activate in production.

All API failures use the internal result shape:

```json
{
  "ok": false,
  "provider": "groq",
  "model": null,
  "error": { "code": "RATE_LIMITED", "message": "…", "retryable": true, "status": 429 }
}
```

Voice is intentionally separate from text models. `src/ai/voiceProviderRegistry.js`
holds ElevenLabs voice/model metadata and `api/voice/elevenlabs.js` is the
server-only adapter. Browser Web Speech remains the fallback when the voice
endpoint does not return audio.

## Deployment configuration

FounderLab has deliberately independent configuration groups:

- **Required for the browser app and authentication:** `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY`. These are Vite browser configuration values and
  must contain the HTTPS Supabase project origin and anon key.
- **Server-side authentication:** `SUPABASE_URL` and `SUPABASE_ANON_KEY` are
  optional aliases. The shared server helper safely falls back to
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, so the two browser values
  are the only Supabase variables that must be configured for a deployment.
- **Required only to protect expensive API calls in production:** an
  allowed-origin configuration (`FOUNDERLAB_ALLOWED_ORIGINS` or
  `FOUNDERLAB_PRODUCTION_ORIGIN`, plus preview controls where needed) and
  `FOUNDERLAB_RATE_LIMITER_URL`. `FOUNDERLAB_RATE_LIMITER_TOKEN` is needed only
  when the configured limiter expects authentication. These controls never
  block sign-in or the core workspace.
- **Optional providers:** `ANTHROPIC_API_KEY`, `GROQ_API_KEY`,
  `GEMINI_API_KEY`, and `ELEVENLABS_API_KEY`. Configure only the providers the
  deployment will use. Authentication and the rest of the workspace never
  depend on `ANTHROPIC_API_KEY`; Local Ollama needs no server key.

Provider availability is queried only after a user is authenticated. The API
returns provider booleans, never provider keys, and the browser keeps a saved
provider only when it remains configured. Otherwise it selects the first
configured provider from the registry.

## Extraction rule

When changing a page in `App.jsx`, move stable page-level code into its
corresponding `src/features/<area>/` module instead of adding new shared
state, browser APIs, or service code to the shell.
