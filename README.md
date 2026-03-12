# AI Content Strategist Interviewer (V2)

Next.js + LangGraph + Postgres JSONB/pgvector interview engine with a planner-and-tools runtime, chat-book memory, and checkpoint-gated generation flow for LinkedIn content.

## Stack

- Next.js (App Router)
- Vercel AI SDK
- LangGraph.js
- Postgres + JSONB (with in-memory fallback for local/demo)

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

If `DATABASE_URL` is not set, the app uses in-memory persistence for demo purposes.

## API Endpoints

- `POST /api/interview/message`
- `POST /api/interview/preview/approve`
- `POST /api/interview/preview/edit`
- `POST /api/interview/generate-brief`
- `POST /api/interview/generate-content`
- `POST /api/interview/handoff`
- `GET /api/interview/session/{id}/trace` (admin token required via `x-admin-token` or `Authorization: Bearer ...`)

## Tests

```bash
npm test
```

Covers completion rules, follow-up strategy behavior, preview/generation gating.
