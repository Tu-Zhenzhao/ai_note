AI Strategist Backend Architecture Doc

Checklist-Driven Conversational Intake Runtime

1. Goal

The AI Strategist is a chatbot that collects structured information from users through a checklist-driven conversation. Its purpose is not general open-ended chatting; its purpose is to reliably gather complete, accurate, structured answers while maintaining a smooth conversational experience.

The system should:
	•	identify whether the user is answering checklist questions, asking for help, or doing something else
	•	extract usable facts from the user’s reply without changing meaning
	•	update checklist state deterministically
	•	track section progress and unanswered items
	•	ask the next best question naturally
	•	remain stable even across long, messy conversations

The core design principle is:

The backend runtime controls the workflow. The models do bounded reasoning tasks.

That is the main lesson borrowed from OpenClaw’s runtime architecture, where the loop, context, prompt assembly, and allowed actions are controlled by the system rather than left entirely to the model.  ￼

⸻

2. Core Design Principles

2.1 Runtime-owned workflow

Do not let a conversational model decide the overall checklist workflow. The runtime should determine:
	•	current section
	•	unanswered questions
	•	completion status
	•	whether clarification is needed
	•	which next question(s) to ask

This mirrors OpenClaw’s architecture, where the runtime owns the loop and context assembly instead of letting the model operate as a free-form chatbot.  ￼

2.2 Structured state outside the model

Chat history is not the source of truth. The real state must live in structured records in the database.

2.3 Small, specialized model tasks

Split the intelligence layer into narrow roles:
	•	intent classifier
	•	extractor
	•	response composer

Do not use one giant “do everything” agent.

2.4 Per-turn context assembly

Each turn should rebuild only the context needed for that turn. OpenClaw explicitly rebuilds a custom, OpenClaw-owned system prompt each run and injects only the relevant working context.  ￼

2.5 Serialized turn execution

One conversation should only have one authoritative turn update happening at a time. OpenClaw’s per-session serialized agent loop is a major reason it avoids race conditions and state drift.  ￼

⸻

3. High-Level Architecture

flowchart TD
    A[User Message] --> B[Turn Controller]
    B --> C[Acquire Conversation Lock]
    C --> D[Load Checklist State + Relevant History]
    D --> E[Intent Classifier]

    E -->|answer_question| F[Build Extraction Packet]
    E -->|ask_for_help| H[Help Workflow]
    E -->|other_discussion| I[Other Workflow]

    F --> G[Extraction Agent]
    G --> J[Extraction Validator]
    J --> K[Checklist State Service]
    K --> L[Question Planner]
    L --> M[Response Composer]
    M --> N[Persist Turn + State + Logs]
    N --> O[Return Assistant Reply]

    H --> N
    I --> N


⸻

4. Runtime Flow

4.1 Turn lifecycle

Each user message should be processed by one main orchestrator: TurnController.

The runtime flow is:
	1.	receive message
	2.	acquire conversation lock
	3.	load structured state
	4.	classify intent
	5.	route to the correct workflow
	6.	if checklist-answer workflow:
	•	build extraction packet
	•	run extraction
	•	validate result
	•	update checklist state
	•	compute next questions
	•	compose reply
	7.	persist everything
	8.	release lock
	9.	return reply

This is directly analogous to the kind of “real agent loop” OpenClaw documents: intake, context assembly, model inference, action/tool execution, streaming/final response, and persistence.  ￼

4.2 Why this shape matters

This structure prevents the classic failure modes:
	•	skipping checklist items
	•	asking the wrong follow-up
	•	moving sections too early
	•	state mismatch between chat and DB
	•	overlapping updates when multiple messages arrive close together

⸻

5. Main Components

5.1 Turn Controller

Responsibility

The authoritative orchestrator for one user turn.

Input
	•	conversation_id
	•	user_message
	•	optional metadata

Output
	•	final assistant message
	•	updated checklist state
	•	audit logs

Responsibilities
	•	acquire lock
	•	load runtime context
	•	call intent classifier
	•	route workflow
	•	persist updates
	•	return response

Suggested interface

interface TurnController {
  handleUserTurn(input: {
    conversationId: string;
    userMessage: string;
    messageId?: string;
    timestamp?: string;
  }): Promise<TurnResult>;
}


⸻

5.2 Checklist State Service

Responsibility

The deterministic state engine.

It should handle
	•	load checklist template
	•	load answers
	•	determine active section
	•	determine open questions
	•	mark fields filled
	•	mark fields needing clarification
	•	detect section completion
	•	move to next section
	•	compute completion stats

Important rule

This service should be pure business logic, with as little model dependence as possible.

⸻

5.3 Intent Classifier

Responsibility

Classify the latest user turn into one of a few workflow categories.

Initial categories
	•	answer_question
	•	ask_for_help
	•	other_discussion

Input
	•	latest user message
	•	minimal recent context
	•	current section metadata

Output example

{
  "intent": "answer_question",
  "confidence": 0.95,
  "reason": "User provided business details relevant to open checklist items."
}

Design note

This should be a small, cheap, strict classification call. It should not decide workflow beyond labeling the turn.

⸻

5.4 Extraction Service

Responsibility

Extract structured facts from the user’s reply.

Input
	•	latest user message
	•	recent relevant turns
	•	only the open checklist questions for the current section
	•	field definitions
	•	extraction rules

Output example

{
  "filled_items": [
    {
      "question_id": "target_customer",
      "value": "small retail businesses with inconsistent inventory tracking",
      "confidence": 0.92,
      "evidence": "We are mainly targeting small retail stores that don't track inventory well."
    }
  ],
  "ambiguous_items": [
    {
      "question_id": "budget",
      "reason": "User said budget is limited but gave no concrete number."
    }
  ],
  "notes": []
}

Critical rule

The extractor should not choose the next question and should not decide workflow transitions.

⸻

5.5 Extraction Validator

Responsibility

Validate model extraction before state update.

Validation checks
	•	question id exists
	•	field is currently editable
	•	output type matches schema
	•	confidence passes threshold
	•	value is not empty/noise
	•	evidence exists
	•	no forbidden mutation to locked answers

Why this matters

This is similar in spirit to OpenClaw’s filtered tool surface and policy enforcement: the runtime constrains what the model is allowed to do.  ￼

⸻

5.6 Question Planner

Responsibility

Choose the next question(s) deterministically based on checklist state.

Inputs
	•	active section
	•	unanswered required questions
	•	ambiguous fields
	•	recently asked questions
	•	section policy

Outputs
	•	next question ids
	•	question ordering
	•	whether to ask one or two questions
	•	whether clarification is required first

Important note

This should be mainly code-driven. You may later add a lightweight model to improve grouping, but state progression should remain deterministic.

⸻

5.7 Response Composer

Responsibility

Turn the current state and planned next questions into natural language.

Inputs
	•	accepted extracted facts
	•	section progress
	•	next question(s)
	•	tone/UX instructions

Output

A polished conversational response to the user.

Example

Got it — your main users are small retail businesses, and the core issue is dead stock visibility.
To finish this section, I still need two things: how success will be measured, and what data sources you already have available.

Important boundary

The response composer should not mutate checklist state.

⸻

5.8 Audit Log Service

Responsibility

Persist traceable records for debugging and QA.

Store
	•	raw user input
	•	intent classification result
	•	extraction payload
	•	accepted/rejected updates
	•	planner result
	•	final assistant message

This becomes extremely important when asking:
“Why did the agent ask this next question?”

⸻

6. Detailed Checklist-Answer Workflow

sequenceDiagram
    participant U as User
    participant TC as Turn Controller
    participant CS as Checklist State Service
    participant IC as Intent Classifier
    participant EX as Extraction Agent
    participant VA as Validator
    participant QP as Question Planner
    participant RC as Response Composer
    participant DB as Database

    U->>TC: User message
    TC->>DB: Acquire conversation lock
    TC->>CS: Load current checklist state
    TC->>IC: Classify latest message
    IC-->>TC: answer_question

    TC->>EX: Extract facts from targeted context
    EX-->>TC: Structured candidate updates
    TC->>VA: Validate extraction
    VA-->>TC: Accepted + rejected updates

    TC->>CS: Apply accepted updates
    CS-->>TC: New state + open questions
    TC->>QP: Choose next question(s)
    QP-->>TC: Next-question plan
    TC->>RC: Compose user reply
    RC-->>TC: Final assistant response

    TC->>DB: Persist turn, state, logs
    TC-->>U: Assistant reply


⸻

7. Backend Data Model

7.1 conversations

conversations (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL,
  active_section_id TEXT,
  current_question_id TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
)

7.2 checklist_templates

checklist_templates (
  id UUID PRIMARY KEY,
  template_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  question_description TEXT,
  field_type TEXT NOT NULL,
  is_required BOOLEAN NOT NULL,
  display_order INT NOT NULL
)

7.3 checklist_answers

checklist_answers (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL,
  question_id TEXT NOT NULL,
  value_json JSONB,
  status TEXT NOT NULL,
  confidence FLOAT,
  evidence_text TEXT,
  source_turn_id UUID,
  updated_at TIMESTAMP NOT NULL
)

Suggested status values:
	•	empty
	•	filled
	•	needs_clarification
	•	confirmed

7.4 turns

turns (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL,
  role TEXT NOT NULL,
  message_text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
)

7.5 extraction_events

extraction_events (
  id UUID PRIMARY KEY,
  turn_id UUID NOT NULL,
  raw_extraction_json JSONB NOT NULL,
  accepted_updates_json JSONB NOT NULL,
  rejected_updates_json JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL
)

7.6 planner_events

planner_events (
  id UUID PRIMARY KEY,
  turn_id UUID NOT NULL,
  planner_result_json JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL
)


⸻

8. Checklist Structure Model

You should think of the checklist as a structured workflow, not just a list of strings.

Suggested conceptual model

type ChecklistTemplate = {
  templateId: string;
  sections: ChecklistSection[];
};

type ChecklistSection = {
  sectionId: string;
  title: string;
  order: number;
  questions: ChecklistQuestion[];
};

type ChecklistQuestion = {
  questionId: string;
  questionText: string;
  description?: string;
  fieldType: "text" | "number" | "boolean" | "select" | "multi_select";
  required: boolean;
  clarifyingHint?: string;
};


⸻

9. Context Assembly Per Turn

This is one of the most important parts.

OpenClaw works well partly because it rebuilds a runtime-owned prompt and context package every run rather than depending on a vague accumulated chat state. It also injects user-editable workspace files and runtime metadata into context each run.  ￼

For your system, each turn should assemble a targeted context packet.

9.1 Context packet for intent classification

Keep it small:
	•	latest user message
	•	previous assistant question
	•	current section title
	•	maybe 1–2 recent turns

9.2 Context packet for extraction

Include:
	•	latest user message
	•	small recent turn window
	•	current section id
	•	only still-open questions in current section
	•	field definitions
	•	extraction rules

Do not include the entire checklist if not needed.

9.3 Context packet for response composition

Include:
	•	newly accepted facts
	•	section progress summary
	•	exact next question(s) chosen by planner
	•	response style instructions

⸻

10. Prompt Contracts

10.1 Intent classifier prompt contract

Purpose

Classify the user turn, not solve the conversation.

Output

Strict JSON.

{
  "intent": "answer_question",
  "confidence": 0.96,
  "reason": "The user is directly answering questions about their target users and pain points."
}

Rules
	•	choose only from allowed intents
	•	no prose outside JSON
	•	use latest message as primary evidence
	•	use recent context only to disambiguate

⸻

10.2 Extractor prompt contract

Purpose

Extract facts without changing meaning.

Output schema

{
  "filled_items": [
    {
      "question_id": "string",
      "value": "any",
      "confidence": 0.0,
      "evidence": "string"
    }
  ],
  "ambiguous_items": [
    {
      "question_id": "string",
      "reason": "string"
    }
  ],
  "possible_items": [
    {
      "question_id": "string",
      "value": "any",
      "reason": "string"
    }
  ]
}

Rules
	•	only use user-provided information
	•	do not invent
	•	do not strengthen vague claims
	•	preserve original meaning
	•	fill only allowed question ids
	•	attach evidence for every fill
	•	return ambiguous_items instead of guessing

⸻

10.3 Response composer prompt contract

Purpose

Explain progress naturally and ask the next question(s).

Input
	•	accepted facts
	•	progress summary
	•	exact next question list
	•	tone rules

Rules
	•	do not modify state
	•	do not introduce new checklist logic
	•	do not skip planner-selected questions
	•	keep response concise and natural

⸻

11. State Machine

Your system has a simple hidden workflow state machine.

stateDiagram-v2
    [*] --> WaitingForUser
    WaitingForUser --> ClassifyingIntent
    ClassifyingIntent --> Extracting : answer_question
    ClassifyingIntent --> HelpFlow : ask_for_help
    ClassifyingIntent --> OtherFlow : other_discussion

    Extracting --> Validating
    Validating --> UpdatingState
    UpdatingState --> PlanningNextQuestion
    PlanningNextQuestion --> ComposingReply
    ComposingReply --> WaitingForUser

    HelpFlow --> WaitingForUser
    OtherFlow --> WaitingForUser


⸻

12. Turn Controller Pseudocode

async function handleUserTurn(input: {
  conversationId: string;
  userMessage: string;
}): Promise<TurnResult> {
  await lockConversation(input.conversationId);

  try {
    const state = await checklistStateService.loadConversationState(input.conversationId);
    const recentTurns = await turnRepo.getRecentTurns(input.conversationId, 6);

    const intentResult = await intentService.classify({
      userMessage: input.userMessage,
      recentTurns,
      activeSection: state.activeSection
    });

    if (intentResult.intent === "ask_for_help") {
      return await helpWorkflow.handle({ input, state, recentTurns });
    }

    if (intentResult.intent === "other_discussion") {
      return await otherWorkflow.handle({ input, state, recentTurns });
    }

    const openQuestions = checklistStateService.getOpenQuestionsForActiveSection(state);

    const extractionPacket = {
      userMessage: input.userMessage,
      recentTurns,
      activeSection: state.activeSection,
      openQuestions
    };

    const extractionResult = await extractionService.extract(extractionPacket);

    const validated = extractionValidator.validate({
      extractionResult,
      state,
      openQuestions
    });

    const updatedState = await checklistStateService.applyUpdates({
      conversationId: input.conversationId,
      acceptedUpdates: validated.acceptedUpdates
    });

    const nextPlan = questionPlanner.plan({
      state: updatedState,
      recentTurns,
      validatedExtraction: validated
    });

    const reply = await responseService.compose({
      acceptedUpdates: validated.acceptedUpdates,
      rejectedUpdates: validated.rejectedUpdates,
      state: updatedState,
      nextPlan
    });

    await auditLogService.persistTurn({
      conversationId: input.conversationId,
      userMessage: input.userMessage,
      intentResult,
      extractionResult,
      validated,
      nextPlan,
      assistantReply: reply
    });

    return {
      reply,
      state: updatedState
    };
  } finally {
    await unlockConversation(input.conversationId);
  }
}


⸻

13. Reliability Rules

13.1 One authoritative update path

All checklist mutations must go through ChecklistStateService.

13.2 Never trust raw extraction blindly

Always validate before writing to DB.

13.3 Ask at most 1–2 questions per turn in v1

This improves completion quality and reduces confusion.

13.4 Use recent context, not full transcript

Long transcripts can dilute extraction quality.

13.5 Distinguish unknown from ambiguous
	•	unknown: user has not provided it
	•	ambiguous: user said something related but not enough to fill safely

13.6 Track evidence

Every filled field should have a quoted evidence snippet or linked source turn.

13.7 Session locking is required

This is especially important if the frontend can send fast consecutive messages. OpenClaw’s serialized run model is one of the key reasons its runtime stays consistent.  ￼

⸻

14. Suggested API Endpoints

POST /api/turn

Main entrypoint.

Request

{
  "conversationId": "uuid",
  "userMessage": "We mainly work with small retail stores..."
}

Response

{
  "reply": "Got it — your main users are small retail stores...",
  "state": {
    "activeSectionId": "customer_profile",
    "completion": 0.42
  }
}

GET /api/conversations/:id/state

Returns structured checklist state for the frontend preview panel.

GET /api/conversations/:id/turns

Returns chat history.

GET /api/conversations/:id/audit

Internal/debug route for developers/admins.

⸻

15. Suggested Frontend-Backend Separation

Backend owns
	•	workflow
	•	checklist state
	•	extraction
	•	validation
	•	next question planning

Frontend owns
	•	chat UI
	•	checklist preview
	•	progress display
	•	typing/loading states
	•	optional user edit/confirm controls

This separation keeps the frontend simple and prevents business logic from leaking into the UI.

⸻

16. Recommended v1 Implementation Strategy

Phase 1: Core happy path

Build only:
	•	answer_question
	•	ask_for_help stub
	•	other_discussion stub
	•	one checklist template
	•	one active section at a time
	•	one or two follow-up questions per turn

Phase 2: Clarification handling

Add:
	•	needs_clarification state
	•	targeted clarification questions
	•	answer confirmation UI if needed

Phase 3: Better planning

Add:
	•	grouped question generation
	•	priority-based question ranking
	•	optional adaptive ordering

Phase 4: Advanced features

Add:
	•	user corrections to extracted fields
	•	confidence-sensitive confirmations
	•	multi-section jumping
	•	richer analytics

⸻

17. What Not to Do

Do not:
	•	let the answer model control section transitions
	•	let the extractor generate the next workflow state
	•	use chat history as the only memory
	•	dump the full checklist into every prompt
	•	combine classification, extraction, planning, and response into one model call
	•	skip audit logging

Those are exactly the kinds of mistakes that make agents feel inconsistent over time.

⸻

18. Final Recommended Architecture Summary

The right mental model

Your system is not “a chatbot with a checklist.”

It is:

a checklist runtime with a conversational interface

That is the correct architecture.

The user speaks in natural language, but the backend is really running a structured stateful intake engine.

OpenClaw’s runtime is useful here not because your product should copy its full feature set, but because it demonstrates the reliability benefits of a system that owns the loop, rebuilds context each run, injects working instructions, and keeps execution serialized and bounded.  ￼

⸻

19. Compact System Diagram for Engineers

flowchart LR
    subgraph Frontend
        A[Chat UI]
        B[Checklist Preview]
        C[Progress UI]
    end

    subgraph Backend Runtime
        D[Turn Controller]
        E[Intent Service]
        F[Extraction Service]
        G[Extraction Validator]
        H[Checklist State Service]
        I[Question Planner]
        J[Response Service]
        K[Audit Log Service]
    end

    subgraph Data Layer
        L[(Conversations)]
        M[(Checklist Answers)]
        N[(Turns)]
        O[(Audit / Extraction Events)]
    end

    A --> D
    D --> E
    D --> F
    F --> G
    G --> H
    H --> I
    I --> J
    J --> D
    D --> K

    H --> L
    H --> M
    D --> N
    K --> O

    H --> B
    H --> C


⸻

20. Short engineering handoff

For engineers, I would say:
	1.	Build a TurnController as the only turn entrypoint.
	2.	Put checklist truth in the database, not in chat history.
	3.	Split model work into classifier, extractor, and response composer.
	4.	Keep checklist progression deterministic in code.
	5.	Lock each conversation during turn processing.
	6.	Log every extraction and planner decision.
	7.	Ask at most two next questions per reply in v1.

