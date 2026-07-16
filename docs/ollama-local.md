# Local Ollama for FounderLab Chat

FounderLab's Local Ollama option is intentionally separate from cloud AI. The
browser calls the Ollama service on the same Mac at `http://localhost:11434`:

```
FounderLab browser → localhost:11434/api/tags and /api/chat → Ollama
```

The AI inference request never goes through the FounderLab API, Vercel,
Upstash, or a cloud provider. No Ollama key or Vercel environment variable is
required. FounderLab persists the selected model name in browser local storage
on that device only; it never persists a credential. Chat history itself still
uses FounderLab's normal workspace persistence and sync behavior.

## User setup on macOS

1. Install and open [Ollama](https://ollama.com), then download one local model:

   ```sh
   ollama pull gemma3
   ```

2. Open FounderLab **Settings → AI Provider → Local Ollama**. FounderLab
   performs a real, readable `GET /api/tags`; select one of the returned models
   and run **Test connection**. A successful state requires a real
   `POST /api/chat` response from that selected model.

3. In a hosted FounderLab Preview or Production page, the browser may ask for
   permission to reach a local application. Allow FounderLab to reach the
   loopback service on this Mac, then choose **Refresh** in Settings. This is a
   browser local-network permission separate from CORS; FounderLab declares the
   target as loopback and never sends the local request through Vercel or a
   cloud provider.

   No FounderLab or Vercel environment variable is needed for Local Ollama.

If detection cannot read `/api/tags`, FounderLab reports the scoped local
connection state without pretending that an opaque `no-cors` request proves a
working integration.

## Product boundaries

- Local Ollama is supported for **AI Chat** in this phase.
- Builder and YouTube AI remain cloud-only and are not sent to Ollama.
- Cloud providers keep their existing authenticated FounderLab API route and
  server-side keys. The server rejects an Ollama request defensively, because a
  Vercel function's `localhost` is not the user's Mac.
