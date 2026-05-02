import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

export const INTERNAL_REVIEW_COOKIE_NAME = "askmore_internal_review";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function configuredPassword(): string {
  return process.env.INTERNAL_REVIEW_PASSWORD?.trim() ?? "";
}

function cookieTokenForPassword(password: string): string {
  return digest(`askmore-internal-review:${password}`);
}

export function isInternalReviewEnabled(): boolean {
  return configuredPassword().length > 0;
}

export function isValidInternalReviewPassword(password: string): boolean {
  const expected = configuredPassword();
  if (!expected) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function buildInternalReviewCookieValue(): string | null {
  const password = configuredPassword();
  if (!password) return null;
  return cookieTokenForPassword(password);
}

export async function hasInternalReviewAccess(): Promise<boolean> {
  const expected = buildInternalReviewCookieValue();
  if (!expected) return false;
  const cookieStore = await cookies();
  const actual = cookieStore.get(INTERNAL_REVIEW_COOKIE_NAME)?.value ?? "";
  if (!actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function requireInternalReviewAuthOrRedirect(nextPath = "/internal/feedback"): Promise<void> {
  const allowed = await hasInternalReviewAccess();
  if (allowed) return;
  const encodedNext = encodeURIComponent(nextPath);
  redirect(`/internal/login?next=${encodedNext}`);
}

export function applyInternalReviewCookie(response: NextResponse): NextResponse {
  const value = buildInternalReviewCookieValue();
  if (!value) {
    return response;
  }
  response.cookies.set(INTERNAL_REVIEW_COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}

export function clearInternalReviewCookie(response: NextResponse): NextResponse {
  response.cookies.set(INTERNAL_REVIEW_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
