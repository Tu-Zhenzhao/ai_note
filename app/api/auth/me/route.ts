import { NextRequest, NextResponse } from "next/server";
import { getAuthContextFromRequest } from "@/server/auth/service";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContextFromRequest(request);
    if (!auth) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }
    return NextResponse.json({ authenticated: true, auth });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
