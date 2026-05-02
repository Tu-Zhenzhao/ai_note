import { NextRequest, NextResponse } from "next/server";
import { applyInternalReviewCookie, isInternalReviewEnabled, isValidInternalReviewPassword } from "@/server/auth/internal-review";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/internal/feedback");
  const loginUrl = new URL("/internal/login", request.url);

  if (!isInternalReviewEnabled()) {
    loginUrl.searchParams.set("error", "internal_review_disabled");
    return NextResponse.redirect(loginUrl, { status: 303 });
  }

  if (!isValidInternalReviewPassword(password)) {
    loginUrl.searchParams.set("error", "invalid_password");
    loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl, { status: 303 });
  }

  const target = next.startsWith("/internal/") ? next : "/internal/feedback";
  const response = NextResponse.redirect(new URL(target, request.url), { status: 303 });
  return applyInternalReviewCookie(response);
}
