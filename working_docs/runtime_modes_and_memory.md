# Runtime Modes & Memory Troubleshooting

## Available npm Scripts

| Script | Command | When to Use |
|---|---|---|
| `npm run dev` | `next dev` (Turbopack) | Fast iteration on UI/features. Turbopack compiles quickly but uses more memory over time. |
| `npm run dev:stable` | `next dev --webpack` | Long interview sessions or manual QA. Webpack uses less peak memory than Turbopack. |
| `npm run start:prodlike` | `next build && next start` | Most stable for extended chat testing. No dev-mode overhead at all. |
| `npm run build` | `next build` | Production build only. |
| `npm start` | `next start` | Serve an already-built production bundle. |

## Recommended Mode by Scenario

- **Editing code / developing features** → `npm run dev`
- **Running a long interview (20+ minutes) during development** → `npm run dev:stable`
- **Demo, staging, or extended QA** → `npm run start:prodlike`
- **Production deployment** → `npm run build` then `npm start`

## Memory Architecture

Node.js is started with `--max-old-space-size=4096` (4 GB heap limit) and `--expose-gc` (allows explicit garbage collection).

Heavy server-side packages (`pg`, `ai`, `@ai-sdk/*`, `@langchain/langgraph`) are externalized via `serverExternalPackages` in `next.config.mjs` so the dev bundler does not re-bundle them into each route.

After each request, `globalThis.gc()` is called (if available) to encourage timely garbage collection.

## Memory Monitoring

A lightweight endpoint is available at `/api/debug-mem` (kept in production for operational checks):

```
GET /api/debug-mem              → heap, RSS, heap limit, uptime, PID
GET /api/debug-mem?sid=<id>     → same + detailed state sizes for that session
```

### Healthy Indicators

- RSS stays below 2.5 GB in `dev:stable` over 30+ minutes.
- Heap used stays below 500 MB in `start:prodlike` over 30+ minutes.
- State size (`stateKB` from `/api/debug-mem?sid=...`) grows slowly and stays under ~200 KB even at turn 40+.

### Warning Signs

- RSS climbs steadily past 3 GB → switch to `dev:stable` or `start:prodlike`.
- `⚠ Server is approaching the used memory threshold, restarting...` → this is the Next.js dev server restarting due to RSS pressure. Not a crash — switch runtime mode.

## Troubleshooting Checklist

1. **Is this `npm run dev` (Turbopack)?** Turbopack uses significant baseline memory. Switch to `dev:stable` or `start:prodlike` for long sessions.
2. **Were files edited while the server was running?** Each file edit triggers a recompilation in dev mode, adding to RSS. Avoid editing files during long chat stress tests.
3. **Check `/api/debug-mem`** — is heap growing unboundedly, or is RSS high but heap stable? If heap is stable, the issue is bundler overhead, not application code.
4. **Check `/api/debug-mem?sid=<session_id>`** — is `stateKB` or `previewProjectionKB` growing beyond 200 KB? If so, investigate state accumulation in `preview_revision_log` or `pending_conflicts`.
5. **Restart the dev server** — in development, a restart clears all bundler caches. This is normal and expected.
