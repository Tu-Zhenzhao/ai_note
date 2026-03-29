import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { applyAuthCookie } from "@/server/auth/http";
import { AuthError, loginWithPassword } from "@/server/auth/service";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const payload = bodySchema.parse(await request.json());
    const result = await loginWithPassword({
      email: payload.email,
      password: payload.password,
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
