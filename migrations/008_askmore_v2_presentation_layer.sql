alter table askmore_v2_turn_events
  add column if not exists event_channel text not null default 'visible';

drop index if exists idx_askmore_v2_turn_events_session_turn_order;
create index if not exists idx_askmore_v2_turn_events_session_turn_order
  on askmore_v2_turn_events(session_id, turn_id, event_channel, event_order asc);

drop index if exists idx_askmore_v2_turn_events_session_created;
create index if not exists idx_askmore_v2_turn_events_session_created
  on askmore_v2_turn_events(session_id, event_channel, created_at asc);
