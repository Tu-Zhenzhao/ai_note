# AskMore V3 Runtime 架构收口说明

更新时间：2026-03-25

## 1) Turn 主链路（唯一中心）

- 生产主链路：`SessionRuntimeManager.enqueueTurn()` -> `SessionRun.executeTurn()`
- 对外入口：`POST /api/askmore_v2/interview/turn`
- 串行与一致性：session advisory lock + optimistic version + idempotent commit

## 2) Legacy 大函数地位

- 文件：`src/server/askmore_v2/services/interview-runtime.ts`
- 状态：`legacy`
- 约束：
  - `handleAskmoreV2Turn()` 仅允许测试环境调用；
  - 非测试环境直接抛错，禁止继续作为生产 turn path；
  - 新逻辑禁止进入该函数。

### 迁移与删除计划

1. 将仍依赖 `handleAskmoreV2Turn()` 的测试改为调用 `/interview/turn` 或 `SessionRuntimeManager`。
2. 保留 `start/summary` 能力在 `interview-runtime.ts`，turn 逻辑完全退出该文件。
3. 删除 `handleAskmoreV2TurnLegacy` 导出与旧 turn 相关 helper。
4. 对 `interview-runtime.ts` 拆分：保留 `start/summary` 为独立服务文件。

## 3) Event-first 约束（固定）

- `events` 是事实源（source of truth）。
- `response_blocks` 仅兼容层，由 `eventsToResponseBlocks(events)` 单向派生。
- 禁止新增只存在于 `response_blocks` 的业务信息。
- 前端主渲染必须优先消费 `events`，`response_blocks` 仅兜底。

## 4) 模块归属表（唯一 owner + 调用边界）

| 能力 | 唯一 Owner | 允许调用边界 |
|---|---|---|
| help（解释/示例/回主线） | `HelpAgent` | 只能由 `SessionRun.dispatchTask(intent=ask_for_help)` 触发 |
| micro-confirm 事件发出 | `ClarificationAgent` | 只能由 `ClarificationAgent` emit `micro_confirm` |
| ambiguity -> 澄清交接 | `AnswerQuestionAgent`（检测） + `SessionRun`（handoff 执行） | `AnswerQuestionAgent` 只能返回 `handoff_intent=clarify_meaning`，不得 emit `micro_confirm` |
| repetition policy | `runtime/policies/repetition-policy.ts` | 仅由 task/decision 层读取，不允许在 UI/route 写重复规则 |
| coverage policy | `runtime/policies/coverage-policy.ts` | 仅由 task/decision 层读取，不允许在 agent 内散落硬编码覆盖判定 |
| progression policy | `runtime/policies/progression-policy.ts` | 推进动作必须经过 progression gate |
| commitment lifecycle（create/resolve/expire/get） | `runtime/pending-commitments.ts` | 任何 agent 不得直接手工改 commitment 状态字段 |
| summary emit（understanding/coverage/transition） | 对应 task agent + `actions/generate-understanding-summary.ts` | 事件生成必须经过 `emitVisibleEvent`，最终由 event stream 持久化 |

