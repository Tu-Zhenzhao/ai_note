# AI Content Strategist Interviewer (V2)

Next.js + Postgres JSONB/pgvector interview engine with a turn-controller runtime, chat-book memory, and checkpoint-gated generation flow for LinkedIn content.

## Stack

- Next.js (App Router)
- Vercel AI SDK
- SuperV1 turn runtime (`/api/conversations/start` + `/api/turn`)
- Postgres + JSONB

## Required Environment Variables

Copy `.env.example` to `.env.local`:

```bash
OPENAI_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
DEEPSEEK_API_KEY=
DATABASE_URL=postgres://postgres:postgres@localhost:5432/interviewer
MODEL_PRIMARY=gemini-3.1-flash-lite-preview
MODEL_FALLBACK=deepseek-chat
INTERVIEW_TRACE_ADMIN_KEY=
```

## Install and Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Database

Apply SQL from [`sql/schema.sql`](/Users/tuzhenzhao/Documents/Chris_demo/sql/schema.sql) to your Postgres instance.
SuperV1 requires Postgres. `DATABASE_URL` is mandatory.
Run migrations in order: `001_initial_schema.sql` then `002_superv1_schema.sql`.
Or run:

```bash
npm run migrate
```

## API Endpoints

- `POST /api/interview/message`
- `POST /api/interview/preview/approve`
- `POST /api/interview/preview/edit`
- `POST /api/interview/generate-brief`
- `POST /api/interview/generate-content`
- `POST /api/interview/handoff`
- `GET /api/interview/session/{id}/trace` (admin token required via `x-admin-token` or `Authorization: Bearer ...`)
- `POST /api/conversations/start` (SuperV1 parallel entrypoint)
- `POST /api/turn` (SuperV1 turn endpoint)
- `GET /api/conversations/{id}/state` (SuperV1 structured checklist state)
- `GET /api/conversations/{id}/turns` (SuperV1 chat turns)
- `GET /api/conversations/{id}/audit` (SuperV1 admin audit, token required)

## Cleanup Boundary (Current Phase)

- No database schema migration changes.
- No `/api/interview/*` request/response contract changes.
- Legacy runtime modules (LangGraph orchestration + legacy planner runtime path) removed.

## SuperV1 Runtime Requirement

- Chat traffic is hard-cutover to SuperV1.
- `/api/conversations/start` and `/api/turn` fail fast if Postgres is unreachable/auth-failed/schema-missing.

## Tests

```bash
npm test
```

Covers active turn routing, answer-turn state mutation, route contracts, and preview/generation gating.
