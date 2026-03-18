# AskMore (多问AI)

AskMore is an AI strategist that interviews users, collects the right facts in the right order, and turns messy conversation into structured strategic input.

This project is designed for people who do not want to fill out a cold form, do not know how to explain their business in "marketing language," and still need a high-quality strategic brief at the end. Instead of asking users to think like operators, it lets them talk naturally while the system does the discipline in the background.

## Part 1: Product Philosophy, Intentions, and User Value

### What We Are Building

We are building an interview-first AI system for strategic intake.

The core job of the product is simple:

- ask the user the next best question
- understand what was actually said
- convert that answer into structured business knowledge
- detect what is still weak, missing, or unconfirmed
- keep the conversation moving until the strategic picture is complete

This means the chatbot is not just "chatting." It is operating like a disciplined AI strategist with memory, structure, and a clear goal.

### Why This Matters

Most users do not struggle because they have no ideas. They struggle because:

- their information is scattered across their head, notes, and past work
- they answer too broadly or too vaguely
- they do not know which details matter
- they cannot tell when their message is still strategically weak
- normal chatbots sound helpful but often fail to collect decision-grade information

AskMore is designed to solve exactly that problem.

It does not wait passively for perfect input. It actively guides the user through a question list, checks what has been captured, and keeps pressure on missing details that matter for strategy.

### The Design Philosophy

The system is built around a few strong product beliefs:

1. Natural conversation is better than rigid forms.
2. Strategic work still needs structure, even when the interface feels flexible.
3. The AI should not only answer. It should interview, verify, organize, and advance.
4. A good strategist does not ask everything at once. It asks the next most useful question.
5. The final value is not the chat itself. The final value is a reliable strategic understanding of the user.

That is why the product combines a conversational interface with a strict checklist-driven runtime underneath.

### Why This Chatbot Is Different

Many AI products can generate words. Fewer can run a good intake process.

This system is stronger because it is built to do all of the following at once:

- keep the user in a simple chat experience
- map answers into a structured checklist
- distinguish between confirmed facts and weaker inferred facts
- avoid skipping required questions too early
- return to important gaps before moving on
- produce strategic direction only after enough signal has been collected

In practice, this makes the chatbot feel more intelligent because it is not improvising blindly. It is reasoning inside a controlled process.

### Why It Fits This Use Case

This product is especially fit for AI strategy intake because strategy work depends on precise context:

- who the audience is
- what the offer is
- what proof exists
- what positioning angle is credible
- what constraints, risks, and goals matter

If these inputs are weak, any downstream strategy will also be weak.

AskMore is designed to capture these foundations well before trying to generate recommendations. That makes the final output more trustworthy, more specific, and more useful.

### What Users Get

For a non-technical user, the promise is straightforward:

- you can explain your business in plain language
- the system helps you think more clearly as you go
- it remembers what you already said
- it asks follow-up questions when something important is still missing
- it gives you structured outputs instead of leaving you with a long messy transcript

For a team or operator, the product value is also clear:

- more consistent intake quality
- less manual discovery work
- cleaner strategic data
- better handoff into briefing, planning, or content generation

### Core User-Facing Features

- Checklist-driven interview flow instead of freeform chat only
- Structured answer capture with confidence and evidence checks
- Section-by-section progress through required topics
- Help mode for users who need clarification instead of dropping out
- AI-suggested strategic directions after enough information is collected
- Exportable outputs including chat history, answered question sheets, and AI direction reports
- English and Chinese interface support
- Persistent conversation history backed by Postgres

### Why the System Design Is an Advantage

The advantage is not any single prompt. The advantage is the system design.

This project combines:

- a guided conversational interface
- deterministic workflow control
- structured persistence
- explicit validation rules
- controlled model routing
- exportable strategic artifacts

That combination matters because reliable strategic intake is a systems problem, not just a prompting problem.

## Part 2: Technical Reference

### Stack

- Next.js App Router
- TypeScript
- Postgres
- AI SDK integrations for OpenAI, Google, and DeepSeek
- SuperV1 runtime for deterministic interview control

### Main Runtime Behavior

The current production path is the SuperV1 chat runtime.

High-level flow:

1. Start or resume a conversation.
2. Receive a user turn.
3. Classify the turn intent.
4. Extract structured facts from the answer.
5. Validate confidence and evidence.
6. Persist accepted updates in Postgres.
7. Select the next required question.
8. Return a concise strategist-style reply plus updated state.

The system is designed to ask at most one core next question per turn so the conversation stays controlled and usable.

### Main Features in the Current Codebase

- `POST /api/conversations/start` creates a conversation and initial state
- `POST /api/turn` processes the main interview turn flow
- conversation list, turn history, state, deletion, and audit endpoints
- export endpoints for chat history, answered question sheets, and AI direction reports
- bilingual UI support through English and Chinese translations
- admin audit access protected by `INTERVIEW_TRACE_ADMIN_KEY`

### Repository Structure

- [app](/Users/tzz/Documents/chris_chatbot/app) contains the Next.js app routes and UI entrypoints
- [src/components](/Users/tzz/Documents/chris_chatbot/src/components) contains the chat UI and progress/review components
- [src/server](/Users/tzz/Documents/chris_chatbot/src/server) contains the interview runtime, prompts, services, and repositories
- [migrations](/Users/tzz/Documents/chris_chatbot/migrations) contains schema migrations and the migration runner
- [tests](/Users/tzz/Documents/chris_chatbot/tests) contains runtime and API tests
- [render.yaml](/Users/tzz/Documents/chris_chatbot/render.yaml) contains the Render Blueprint

### Environment Variables

Create `.env.local` with the variables below:

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

- `DATABASE_URL` is required for runtime and migrations.
- `INTERVIEW_TRACE_ADMIN_KEY` enables admin audit access.
- `AGENT_TRACE_VERBOSE=true` turns on more detailed runtime tracing.
- `NEXT_PUBLIC_SHOW_CONTEXT_USAGE` controls whether the context usage strip is visible in the UI.

### Local Development

Install dependencies:

```bash
npm install
```

Run migrations:

```bash
npm run migrate
```

Start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Testing and Build

Run tests:

```bash
npm test
```

Run a production build:

```bash
npm run build
```

### Deploying to Render

The repository already includes a Render Blueprint in [render.yaml](/Users/tzz/Documents/chris_chatbot/render.yaml).

Current deployment model:

- one Node web service
- one managed Postgres database
- build command: `npm ci --include=dev && npm run build`
- start command: `npm run migrate && npm start`

Typical Render flow:

1. Connect the GitHub repository to Render with proper repo access.
2. Import the project from the Blueprint.
3. Fill secret environment variables in the Render dashboard.
4. Apply the Blueprint.
5. Confirm the deploy is live.

Important deployment note:

- the current Blueprint provisions a new Render Postgres database
- if you want to keep existing historical data from another database, set `DATABASE_URL` in Render to your external database instead of using the managed Render database

### API Surface

Primary SuperV1 endpoints:

- `GET /api/conversations`
- `POST /api/conversations/start`
- `POST /api/turn`
- `GET /api/conversations/{id}/state`
- `GET /api/conversations/{id}/turns`
- `GET /api/conversations/{id}/exports`
- `GET /api/conversations/{id}/audit`
- `POST /api/conversations/delete`

Legacy compatibility endpoints remain under `/api/interview/*` for older flows.

### Data Model

Core SuperV1 tables:

- `conversations`
- `checklist_templates`
- `checklist_answers`
- `turns`
- `extraction_events`
- `planner_events`

Legacy `interview_*` tables still exist for compatibility.

### Failure Modes the Runtime Normalizes

- `SUPERV1_DATABASE_URL_MISSING`
- `SUPERV1_DB_UNREACHABLE`
- `SUPERV1_DB_AUTH_FAILED`
- `SUPERV1_SCHEMA_MISSING`
- `SUPERV1_RUNTIME_ERROR`

These are used to fail fast when database connectivity or schema readiness is not correct.

### Reference Documents

- [working_docs/new_architecture.md](/Users/tzz/Documents/chris_chatbot/working_docs/new_architecture.md)
- [working_docs/superv1_rollout_checklist.md](/Users/tzz/Documents/chris_chatbot/working_docs/superv1_rollout_checklist.md)
