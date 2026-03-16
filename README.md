# AI Content Strategist Interviewer (SuperV1)

Next.js + Postgres interview system for checklist-driven intake and content strategy planning.

## Architecture Status

- Chat runtime is hard-cutover to SuperV1.
- Authoritative chat APIs are `POST /api/conversations/start` and `POST /api/turn`.
- SuperV1 is Postgres-only for runtime operations (no memory fallback in app runtime).
- Legacy `/api/interview/*` endpoints remain for legacy non-chat flows.

## SuperV1 Runtime Design

SuperV1 follows a deterministic turn controller pattern:

1. Acquire per-conversation lock.
2. Load conversation/template/answers/turn context.
3. Classify intent (`answer_question`, `ask_for_help`, `other_discussion`).
4. Extract structured facts (only for `answer_question`).
5. Validate extraction (`confidence >= 0.75`, evidence required, editable fields only).
6. Apply updates through checklist state service.
7. Plan next question (max 1 question per turn).
8. Compose response and persist turn + audit events.
9. Return canonical turn result (`reply`, `state`, `next_question`, `intent`, `planner_result`).

Reference docs:
- [`working_docs/new_architecture.md`](./working_docs/new_architecture.md)
- [`working_docs/superv1_rollout_checklist.md`](./working_docs/superv1_rollout_checklist.md)

## Data Model

SuperV1 normalized tables (migration `002_superv1_schema.sql`):

- `conversations`
- `checklist_templates`
- `checklist_answers`
- `turns`
- `extraction_events`
- `planner_events`

Legacy `interview_*` tables are kept for compatibility and non-chat legacy routes.

## API Surface

SuperV1 chat + session APIs:

- `GET /api/conversations` list sessions
- `POST /api/conversations/start` create a conversation and initial state
- `POST /api/turn` process one user turn
- `GET /api/conversations/{id}/state` read current structured state
- `GET /api/conversations/{id}/turns` read conversation turns
- `POST /api/conversations/delete` delete conversation data
- `GET /api/conversations/{id}/audit` admin-only audit trail

Audit auth:

- Header `x-admin-token: <INTERVIEW_TRACE_ADMIN_KEY>`, or
- Header `Authorization: Bearer <INTERVIEW_TRACE_ADMIN_KEY>`

Legacy compatibility endpoints (still present):

- `POST /api/interview/message`
- `POST /api/interview/preview/approve`
- `POST /api/interview/preview/edit`
- `POST /api/interview/generate-brief`
- `POST /api/interview/generate-content`
- `POST /api/interview/handoff`
- `GET /api/interview/session/{id}/trace` (admin token)

## Environment Variables

Copy `.env.example` to `.env.local` and set:

```bash
OPENAI_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
DEEPSEEK_API_KEY=
DATABASE_URL=postgres://postgres:postgres@localhost:5432/interviewer
MODEL_PRIMARY=gemini-3.1-flash-lite-preview
MODEL_FALLBACK=deepseek-chat
INTERVIEW_TRACE_ADMIN_KEY=
AGENT_TRACE_VERBOSE=false
NEXT_PUBLIC_SHOW_CONTEXT_USAGE=
```

Notes:

- `DATABASE_URL` is required for SuperV1 runtime and migrations.
- `AGENT_TRACE_VERBOSE=true` enables step-by-step runtime movement logs.
- `NEXT_PUBLIC_SHOW_CONTEXT_USAGE` controls the bottom-right context usage strip:
  - default behavior: visible in non-production, hidden in production
  - set `1`/`true` to force show
  - set `0`/`false` to force hide
- Errors are always logged even when verbose trace is off.

## Local Setup

```bash
npm install
npm run migrate
npm run dev
```

Open `http://localhost:3000`.

Migration runner loads `DATABASE_URL` from process env, `.env.local`, or `.env`.

## Database / Runtime Failure Codes

SuperV1 normalizes DB/runtime errors into actionable codes:

- `SUPERV1_DATABASE_URL_MISSING`
- `SUPERV1_DB_UNREACHABLE`
- `SUPERV1_DB_AUTH_FAILED`
- `SUPERV1_SCHEMA_MISSING`
- `SUPERV1_RUNTIME_ERROR`

Routes fail fast on DB/connectivity/schema issues:

- `POST /api/conversations/start`
- `POST /api/turn`
- `GET /api/conversations`
- `POST /api/conversations/delete`

## Testing

```bash
npm test
npm run build
```

Test suite covers SuperV1 turn flow, API contracts, lock serialization, DB preflight/error mapping, and preview state mapping.
