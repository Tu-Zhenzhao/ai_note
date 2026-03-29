import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { applyAuthCookie } from "@/server/auth/http";
import { AuthError, signupWithPassword } from "@/server/auth/service";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  invite_code: z.string().min(1),
  display_name: z.string().min(1).max(80).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const payload = bodySchema.parse(await request.json());
    const result = await signupWithPassword({
      email: payload.email,
      password: payload.password,
      inviteCode: payload.invite_code,
      displayName: payload.display_name,
      request,
    });
    const response = NextResponse.json({ auth: result.auth });
    return applyAuthCookie(response, result.sessionToken);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request payload" }, { status: 400 });
    }
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
