import { redirect } from "next/navigation";
import { hasInternalReviewAccess, isInternalReviewEnabled } from "@/server/auth/internal-review";

export default async function InternalLoginPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = (await props.searchParams) ?? {};
  const next = typeof searchParams.next === "string" ? searchParams.next : "/internal/feedback";
  const error = typeof searchParams.error === "string" ? searchParams.error : "";
  if (await hasInternalReviewAccess()) {
    redirect(next.startsWith("/internal/") ? next : "/internal/feedback");
  }
  const enabled = isInternalReviewEnabled();
  const errorMessage = error === "invalid_password"
    ? "Password did not match the internal review access key."
    : error === "internal_review_disabled"
      ? "Internal review is disabled. Set INTERNAL_REVIEW_PASSWORD to enable it."
      : "";

  return (
    <main className="internal-login-page">
      <section className="internal-login-card">
        <div className="internal-login-kicker">Internal Review</div>
        <h1>Feedback Console Access</h1>
        <p>
          This page is for private operator review of beta-user sessions, transcripts, and feedback.
        </p>
        {errorMessage && <div className="internal-login-error">{errorMessage}</div>}
        <form action="/api/internal/auth/login" method="post" className="internal-login-form">
          <input type="hidden" name="next" value={next} />
          <label htmlFor="password">Access password</label>
          <input id="password" name="password" type="password" placeholder="Internal review password" disabled={!enabled} />
          <button className="internal-login-submit" type="submit" disabled={!enabled}>
            Enter Review Console
          </button>
        </form>
      </section>
    </main>
  );
}
