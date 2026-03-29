import { NextRequest, NextResponse } from "next/server";
import { clearAuthCookie } from "@/server/auth/http";
import { revokeSessionByRequest } from "@/server/auth/service";

export async function POST(request: NextRequest) {
  try {
    await revokeSessionByRequest(request);
    const response = NextResponse.json({ ok: true });
    return clearAuthCookie(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
