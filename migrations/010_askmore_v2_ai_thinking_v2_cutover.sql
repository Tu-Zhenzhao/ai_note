-- Hard cut to AI Thinking v2.
-- 1) Remove legacy insight runs.
delete from askmore_v2_insight_runs
where coalesce(result_jsonb ->> 'version', 'insight.v1') <> 'ai_thinking.v2';

-- 2) Remove legacy session pointers and reset latest AI Thinking cache.
update askmore_v2_sessions
set state_jsonb = jsonb_set(
  jsonb_set(
    (state_jsonb - 'latest_professional_insight' - 'insight_meta'),
    '{latest_ai_thinking}',
    'null'::jsonb,
    true
  ),
  '{ai_thinking_meta}',
  'null'::jsonb,
  true
);
