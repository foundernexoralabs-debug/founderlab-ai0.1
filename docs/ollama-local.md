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

3. A locally served FounderLab page (`localhost`) is allowed by Ollama's normal
   loopback CORS policy. A hosted FounderLab site has a different browser origin
   and must be explicitly approved by the local Ollama server. On macOS, use
   the exact origin shown in Settings—not a wildcard—then quit and relaunch the
   Ollama app:

   ```sh
   launchctl setenv OLLAMA_ORIGINS "https://your-founderlab-origin.example"
   ```

   For a Vercel Preview, the preview origin changes with the deployment; add
   the exact Preview origin currently being tested. Use the stable production
   FounderLab origin for Production. A wildcard `OLLAMA_ORIGINS` setting is
   intentionally not recommended because it lets any website make browser
   requests to the local Ollama service.

If detection cannot read `/api/tags`, the browser cannot reliably distinguish a
stopped service from an origin that Ollama has not approved. FounderLab reports
this honestly as **Ollama is not available** and offers the scoped setup help;
it never uses an opaque `no-cors` request as fake evidence of a connection.

## Product boundaries

- Local Ollama is supported for **AI Chat** in this phase.
- Builder and YouTube AI remain cloud-only and are not sent to Ollama.
- Cloud providers keep their existing authenticated FounderLab API route and
  server-side keys. The server rejects an Ollama request defensively, because a
  Vercel function's `localhost` is not the user's Mac.
