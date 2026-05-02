import Link from "next/link";
import { requireInternalReviewAuthOrRedirect } from "@/server/auth/internal-review";
import {
  getInternalReviewOverview,
  getInternalReviewSessionDetail,
  getInternalReviewUser,
  listInternalReviewSessionsForUser,
  listInternalReviewUsers,
} from "@/server/internal-review/service";

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export default async function InternalFeedbackPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireInternalReviewAuthOrRedirect("/internal/feedback");
  const searchParams = (await props.searchParams) ?? {};
  const q = typeof searchParams.q === "string" ? searchParams.q : "";
  const userParam = typeof searchParams.user === "string" ? searchParams.user : "";
  const sessionParam = typeof searchParams.session === "string" ? searchParams.session : "";

  const [overview, users] = await Promise.all([
    getInternalReviewOverview(),
    listInternalReviewUsers({ search: q, limit: 80 }),
  ]);

  const selectedUserId = userParam || users[0]?.id || "";
  const selectedUser = selectedUserId ? await getInternalReviewUser(selectedUserId) : null;
  const sessions = selectedUserId ? await listInternalReviewSessionsForUser(selectedUserId, 40) : [];
  const selectedSessionId = sessions.some((item) => item.id === sessionParam)
    ? sessionParam
    : (sessions[0]?.id || "");
  const selectedSession = selectedSessionId ? await getInternalReviewSessionDetail(selectedSessionId) : null;

  return (
    <main className="internal-review-page">
      <div className="internal-review-shell">
        <header className="internal-review-header">
          <div>
            <div className="internal-review-kicker">AskMore Internal</div>
            <h1>Beta Feedback Console</h1>
            <p>Review testers, session transcripts, and the structured feedback they left inside the product.</p>
          </div>
          <form action="/api/internal/auth/logout" method="post">
            <button type="submit" className="internal-review-logout">Log out</button>
          </form>
        </header>

        <section className="internal-review-stats">
          <article className="internal-review-stat-card">
            <span>Total Users</span>
            <strong>{overview.total_users}</strong>
          </article>
          <article className="internal-review-stat-card">
            <span>Active Last 7 Days</span>
            <strong>{overview.active_users_last_7d}</strong>
          </article>
          <article className="internal-review-stat-card">
            <span>Sessions</span>
            <strong>{overview.total_sessions}</strong>
          </article>
          <article className="internal-review-stat-card">
            <span>Feedback Captured</span>
            <strong>{overview.sessions_with_feedback}</strong>
          </article>
          <article className="internal-review-stat-card negative">
            <span>Negative Signals</span>
            <strong>{overview.negative_feedback_count}</strong>
          </article>
        </section>

        <section className="internal-review-toolbar">
          <form method="get" className="internal-review-search">
            <input type="text" name="q" defaultValue={q} placeholder="Search by email, display name, workspace" />
            <button type="submit">Search</button>
          </form>
          {selectedUser && (
            <div className="internal-review-selected-user">
              <strong>{selectedUser.display_name || selectedUser.email}</strong>
              <span>{selectedUser.email}</span>
              <span>Workspace: {selectedUser.workspace_name || "—"}</span>
              <span>Joined: {formatDate(selectedUser.created_at)}</span>
              <span>Last login: {formatDate(selectedUser.last_login_at)}</span>
            </div>
          )}
        </section>

        <div className="internal-review-grid">
          <section className="internal-review-panel">
            <div className="internal-review-panel-head">
              <h2>Users</h2>
              <span>{users.length}</span>
            </div>
            <div className="internal-review-list">
              {users.length === 0 && <div className="internal-review-empty">No users matched this search.</div>}
              {users.map((user) => {
                const href = `/internal/feedback?user=${encodeURIComponent(user.id)}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
                return (
                  <Link key={user.id} href={href} className={`internal-review-user-card ${user.id === selectedUserId ? "active" : ""}`}>
                    <div className="internal-review-user-top">
                      <strong>{user.display_name || user.email}</strong>
                      <span>{user.session_count} sessions</span>
                    </div>
                    <div className="internal-review-user-meta">{user.email}</div>
                    <div className="internal-review-user-meta">
                      Avg score: {user.avg_satisfaction_score ?? "—"} · Negative: {user.negative_feedback_count}
                    </div>
                    <div className="internal-review-user-meta">
                      Latest activity: {formatDate(user.latest_activity_at)}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>

          <section className="internal-review-panel">
            <div className="internal-review-panel-head">
              <h2>Sessions</h2>
              <span>{sessions.length}</span>
            </div>
            <div className="internal-review-list">
              {sessions.length === 0 && <div className="internal-review-empty">No AskMore V2 sessions for this user yet.</div>}
              {sessions.map((session) => {
                const href = `/internal/feedback?user=${encodeURIComponent(selectedUserId)}&session=${encodeURIComponent(session.id)}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
                return (
                  <Link key={session.id} href={href} className={`internal-review-session-card ${session.id === selectedSessionId ? "active" : ""}`}>
                    <div className="internal-review-session-top">
                      <strong>{session.id.slice(0, 8)}...</strong>
                      <span>{session.status}</span>
                    </div>
                    <div className="internal-review-user-meta">
                      Updated: {formatDate(session.updated_at)}
                    </div>
                    <div className="internal-review-user-meta">
                      Turns: {session.turn_count} · Current question: {session.current_question_id || "—"}
                    </div>
                    <div className="internal-review-user-meta">
                      Helpful: {session.helpful == null ? "—" : session.helpful ? "Yes" : "No"} · Score: {session.satisfaction_score ?? "—"}
                    </div>
                    {session.issue_text && (
                      <div className="internal-review-session-issue">{session.issue_text}</div>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>

          <section className="internal-review-panel internal-review-detail">
            <div className="internal-review-panel-head">
              <h2>Transcript</h2>
              <span>{selectedSession?.messages.length ?? 0} messages</span>
            </div>
            {!selectedSession && <div className="internal-review-empty">Choose a session to inspect its transcript and feedback.</div>}
            {selectedSession && (
              <>
                <div className="internal-review-feedback-card">
                  <div className="internal-review-feedback-grid">
                    <div>
                      <span className="internal-review-label">Helpful</span>
                      <strong>{selectedSession.feedback?.helpful == null ? "—" : selectedSession.feedback.helpful ? "Yes" : "No"}</strong>
                    </div>
                    <div>
                      <span className="internal-review-label">Score</span>
                      <strong>{selectedSession.feedback?.satisfaction_score ?? "—"}</strong>
                    </div>
                    <div>
                      <span className="internal-review-label">Updated</span>
                      <strong>{formatDate(selectedSession.feedback?.updated_at)}</strong>
                    </div>
                  </div>
                  <div className="internal-review-feedback-copy">
                    <div>
                      <span className="internal-review-label">User Goal</span>
                      <p>{selectedSession.feedback?.goal_text || "No goal text submitted."}</p>
                    </div>
                    <div>
                      <span className="internal-review-label">Problem / Complaint</span>
                      <p>{selectedSession.feedback?.issue_text || "No issue text submitted."}</p>
                    </div>
                  </div>
                </div>
                <div className="internal-review-transcript">
                  {selectedSession.messages.length === 0 && (
                    <div className="internal-review-empty">This session has no stored messages.</div>
                  )}
                  {selectedSession.messages.map((message) => (
                    <article key={message.id} className={`internal-review-message ${message.role === "user" ? "user" : "assistant"}`}>
                      <div className="internal-review-message-role">{message.role}</div>
                      <div className="internal-review-message-body">
                        <pre>{message.message_text}</pre>
                        <time>{formatDate(message.created_at)}</time>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
