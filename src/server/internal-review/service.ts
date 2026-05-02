import { dbQuery } from "@/server/repo/db";
import { AskmoreV2Message, AskmoreV2Session, AskmoreV2SessionFeedback } from "@/server/askmore_v2/types";

export type InternalReviewOverview = {
  total_users: number;
  active_users_last_7d: number;
  total_sessions: number;
  sessions_with_feedback: number;
  negative_feedback_count: number;
};

export type InternalReviewUserListItem = {
  id: string;
  email: string;
  display_name: string | null;
  workspace_name: string | null;
  created_at: string;
  last_login_at: string | null;
  session_count: number;
  avg_satisfaction_score: number | null;
  feedback_count: number;
  negative_feedback_count: number;
  latest_activity_at: string | null;
};

export type InternalReviewUserDetail = {
  id: string;
  email: string;
  display_name: string | null;
  workspace_name: string | null;
  created_at: string;
  last_login_at: string | null;
};

export type InternalReviewSessionListItem = {
  id: string;
  status: AskmoreV2Session["status"];
  turn_count: number;
  created_at: string;
  updated_at: string;
  current_question_id: string | null;
  helpful: boolean | null;
  satisfaction_score: number | null;
  issue_text: string | null;
};

export type InternalReviewSessionDetail = {
  session: AskmoreV2Session;
  messages: AskmoreV2Message[];
  feedback: AskmoreV2SessionFeedback | null;
};

function normalizeSearch(search?: string): string | null {
  const trimmed = search?.trim();
  return trimmed ? `%${trimmed.toLowerCase()}%` : null;
}

export async function getInternalReviewOverview(): Promise<InternalReviewOverview> {
  const result = await dbQuery<InternalReviewOverview>(
    `select
       (select count(*)::int from auth_users) as total_users,
       (select count(*)::int from auth_users where coalesce(last_login_at, created_at) >= now() - interval '7 days') as active_users_last_7d,
       (select count(*)::int from askmore_v2_sessions) as total_sessions,
       (select count(*)::int from askmore_v2_session_feedback) as sessions_with_feedback,
       (
         select count(*)::int
         from askmore_v2_session_feedback
         where helpful = false or coalesce(satisfaction_score, 5) <= 2
       ) as negative_feedback_count`,
  );
  return result.rows[0] ?? {
    total_users: 0,
    active_users_last_7d: 0,
    total_sessions: 0,
    sessions_with_feedback: 0,
    negative_feedback_count: 0,
  };
}

export async function listInternalReviewUsers(params?: {
  search?: string;
  limit?: number;
}): Promise<InternalReviewUserListItem[]> {
  const limit = Math.max(1, Math.min(params?.limit ?? 80, 200));
  const search = normalizeSearch(params?.search);
  const result = await dbQuery<InternalReviewUserListItem>(
    `select
       u.id,
       u.email,
       u.display_name,
       w.name as workspace_name,
       u.created_at,
       u.last_login_at,
       count(distinct s.id)::int as session_count,
       round(avg(f.satisfaction_score)::numeric, 1)::float8 as avg_satisfaction_score,
       count(f.id)::int as feedback_count,
       count(*) filter (
         where f.id is not null
           and (f.helpful = false or coalesce(f.satisfaction_score, 5) <= 2)
       )::int as negative_feedback_count,
       max(coalesce(f.updated_at, s.updated_at)) as latest_activity_at
     from auth_users u
     left join auth_workspaces w on w.owner_user_id = u.id
     left join askmore_v2_sessions s on s.created_by_user_id = u.id
     left join askmore_v2_session_feedback f on f.session_id = s.id
     where ($1::text is null
       or lower(u.email) like $1
       or lower(coalesce(u.display_name, '')) like $1
       or lower(coalesce(w.name, '')) like $1)
     group by u.id, u.email, u.display_name, w.name, u.created_at, u.last_login_at
     order by coalesce(max(s.updated_at), u.last_login_at, u.created_at) desc
     limit $2`,
    [search, limit],
  );
  return result.rows;
}

export async function getInternalReviewUser(userId: string): Promise<InternalReviewUserDetail | null> {
  const result = await dbQuery<InternalReviewUserDetail>(
    `select
       u.id,
       u.email,
       u.display_name,
       w.name as workspace_name,
       u.created_at,
       u.last_login_at
     from auth_users u
     left join auth_workspaces w on w.owner_user_id = u.id
     where u.id = $1
     limit 1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function listInternalReviewSessionsForUser(userId: string, limit = 40): Promise<InternalReviewSessionListItem[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  const result = await dbQuery<InternalReviewSessionListItem>(
    `select
       s.id,
       s.status,
       s.turn_count,
       s.created_at,
       s.updated_at,
       s.state_jsonb->'session'->>'current_question_id' as current_question_id,
       f.helpful,
       f.satisfaction_score,
       f.issue_text
     from askmore_v2_sessions s
     left join askmore_v2_session_feedback f on f.session_id = s.id
     where s.created_by_user_id = $1
     order by s.updated_at desc
     limit $2`,
    [userId, boundedLimit],
  );
  return result.rows;
}

export async function getInternalReviewSessionDetail(sessionId: string): Promise<InternalReviewSessionDetail | null> {
  const sessionResult = await dbQuery<AskmoreV2Session>(
    `select *
     from askmore_v2_sessions
     where id = $1
     limit 1`,
    [sessionId],
  );
  const session = sessionResult.rows[0] ?? null;
  if (!session) return null;

  const [messagesResult, feedbackResult] = await Promise.all([
    dbQuery<AskmoreV2Message>(
      `select *
       from askmore_v2_messages
       where session_id = $1
       order by created_at asc`,
      [sessionId],
    ),
    dbQuery<AskmoreV2SessionFeedback>(
      `select *
       from askmore_v2_session_feedback
       where session_id = $1
       limit 1`,
      [sessionId],
    ),
  ]);

  return {
    session,
    messages: messagesResult.rows,
    feedback: feedbackResult.rows[0] ?? null,
  };
}
