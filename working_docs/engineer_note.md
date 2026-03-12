# Engineer Implementation Notes — AI Strategist

These notes translate the **architecture document** into practical engineering guidance. The goal is to help developers understand how to implement the agent system without over‑engineering or introducing unnecessary frameworks.

The core rule:

> The AI agent orchestrates the workflow, but the backend owns deterministic truth.

---

# 1. Core Runtime Loop

Every turn should follow the same execution loop.

```
User message
   ↓
AI Agent receives message
   ↓
Planner Step (classify intent)
   ↓
Route to Task Module
   ↓
Task module may call tools
   ↓
Checklist / state update (if allowed)
   ↓
Compose assistant response
   ↓
Return response + UI interaction payload
```

The agent should **never directly mutate durable state**.
State mutations must go through backend tools.

---

# 2. Suggested Project Structure

Example folder structure for the backend:

```
/backend

  /agent
    agent_runtime.ts
    planner.ts
    agent_prompt.md

  /tasks
    answer_question.ts
    help_about_question.ts
    discussion.ts

  /tools
    checklist_reader.ts
    checklist_updater.ts
    history_reader.ts

    interaction_confirm_section.ts
    interaction_select_option.ts

  /state
    checklist_schema.ts
    workflow_state.ts

  /models
    model_router.ts

  /api
    interview_message.ts
```

This keeps the system modular and easy to reason about.

---

# 3. Planner Step Implementation

The planner should be lightweight.

Its only responsibility is:

```
classify user turn into one of:

1. answer_question
2. ask_for_help
3. other_discussion
```

Do **not** embed complex business logic in the planner.

The planner only routes execution.

Example result:

```ts
{
  task_type: "answer_question"
}
```

---

# 4. Task Modules

Each task module should behave like a mini controller.

Example:

### answer_question.ts

Responsibilities:

- read checklist state
- identify target field
- update answer
- check section completion
- trigger confirmation interaction if needed

### help_about_question.ts

Responsibilities:

- read checklist + history
- generate suggestions
- activate option selection interaction

### discussion.ts

Responsibilities:

- answer questions
- clarify meaning
- explain strategy
- **do not update checklist state**

---

# 5. Tools Layer

Tools should be small, deterministic functions.

Example tools:

### Checklist Reader

```
getChecklistState(session_id)
```

### Checklist Updater

```
updateChecklistAnswer(session_id, question_id, answer)
```

### Confirmation Interaction

```
openConfirmSectionInteraction(section_id)
```

### Option Selection Interaction

```
openOptionSelection(options)
```

These tools return structured payloads used by the frontend.

---

# 6. Interaction Module Contract

Every UI interaction should follow the same format.

Example:

```
{
  interaction_module: {
    type: "confirm_section",
    payload: {
      section_id: "section_1",
      answers: [...]
    }
  }
}
```

Possible interaction types:

```
confirm_section
select_help_option
checkpoint_review
none
```

Frontend should render UI strictly based on this payload.

---

# 7. Model Routing

Model routing should be centralized.

Example policy:

```
Primary: GPT or Gemini
Secondary: the other provider
Fallback: DeepSeek
```

Routing layer responsibilities:

- retry on failure
- handle timeout
- log model usage

Example interface:

```
runModel(prompt, options)
```

---

# 8. AGENT Prompt

The agent prompt (AGENT.md) must define:

- the three task types
- when checklist updates are allowed
- how to ask follow‑up questions
- how to behave in discussion mode
- how to activate interaction modules

Treat this file as **the behavior contract for the AI agent**.

---

# 9. Key Stability Rules

Engineers should enforce the following rules:

1. The planner must run every turn.
2. State mutation must go through tools.
3. The checklist remains the durable truth.
4. Interaction modules control UI behavior.
5. The agent cannot skip sections automatically.

---

# 10. Future Extensions

Possible future improvements:

- checkpoint review module
- contradiction detection tool
- strategy synthesis module
- export / report generator

These should be implemented as **additional task modules or tools**, not by modifying the core planner.

---

# Summary

This architecture intentionally separates:

- AI reasoning
- deterministic state
- UI interaction

This separation is what keeps the system stable while still allowing the AI to behave naturally.


