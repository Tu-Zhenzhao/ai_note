import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/server/auth/api-auth";
import { markAuthOnboardingCompleted } from "@/server/auth/service";

export async function POST(request: NextRequest) {
  try {
    const { auth, unauthorizedResponse } = await requireApiAuth(request);
    if (unauthorizedResponse || !auth) {
      return unauthorizedResponse ?? NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    await markAuthOnboardingCompleted(auth);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
