# SuperV1 Rollout Checklist

## Default mode
- SuperV1 is the default chat runtime path.
- Legacy `/api/interview/*` remains available only for non-chat legacy endpoints.

## Backend readiness
- `DATABASE_URL` is required.
- Apply migrations in order:
  - `001_initial_schema.sql`
  - `002_superv1_schema.sql`
- Verify new endpoints are reachable:
  - `POST /api/conversations/start`
  - `POST /api/turn`
  - `GET /api/conversations/:id/state`
  - `GET /api/conversations/:id/turns`
  - `GET /api/conversations/:id/audit`
- Set `INTERVIEW_TRACE_ADMIN_KEY` for audit endpoint access.

## Validation checks
- `npm test` passes.
- `npm run build` passes.
- Concurrent turn test confirms serialized updates.

## Cutover
- Chat transport uses SuperV1 routes only.
- On DB failure, runtime must fail fast with actionable code:
  - `SUPERV1_DB_UNREACHABLE`
  - `SUPERV1_DB_AUTH_FAILED`
  - `SUPERV1_SCHEMA_MISSING`
