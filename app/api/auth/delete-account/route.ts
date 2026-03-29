import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clearAuthCookie } from "@/server/auth/http";
import {
  AuthError,
  deleteAccountWithConfirmation,
  getAuthContextFromRequest,
} from "@/server/auth/service";

const bodySchema = z.object({
  confirm_input: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContextFromRequest(request);
    if (!auth) {
      return NextResponse.json(
        { error: "Authentication required", code: "auth_required" },
        { status: 401 },
      );
    }

    const payload = bodySchema.parse(await request.json());
    await deleteAccountWithConfirmation({
      auth,
      confirmInput: payload.confirm_input,
    });

    const response = NextResponse.json({ ok: true });
    return clearAuthCookie(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid request payload" },
        { status: 400 },
      );
    }
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
