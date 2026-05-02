import { NextRequest, NextResponse } from "next/server";
import { clearInternalReviewCookie } from "@/server/auth/internal-review";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/internal/login", request.url), { status: 303 });
  return clearInternalReviewCookie(response);
}
