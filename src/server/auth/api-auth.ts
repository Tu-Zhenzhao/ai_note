import { NextRequest, NextResponse } from "next/server";
import { AuthContext, getAuthContextFromRequest } from "@/server/auth/service";
import { DEFAULT_WORKSPACE_ID } from "@/server/auth/constants";

function buildTestAuthContext(request: NextRequest): AuthContext {
  const workspaceId = request.headers.get("x-askmore-workspace-id")?.trim() || DEFAULT_WORKSPACE_ID;
  const userId = request.headers.get("x-askmore-user-id")?.trim() || "user_test_beta";
  return {
    user: {
      id: userId,
      email: `${userId}@example.test`,
      display_name: "Test User",
    },
    workspace: {
      id: workspaceId,
      name: "Test Workspace",
      slug: workspaceId,
      role: "owner",
    },
    session: {
      id: "sess_test_beta",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  };
}

export async function requireApiAuth(request: NextRequest): Promise<{
  auth: AuthContext | null;
  unauthorizedResponse: NextResponse | null;
}> {
  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") {
    return {
      auth: buildTestAuthContext(request),
      unauthorizedResponse: null,
    };
  }
  const auth = await getAuthContextFromRequest(request);
  if (!auth) {
    return {
      auth: null,
      unauthorizedResponse: NextResponse.json(
        { error: "Authentication required", code: "auth_required" },
        { status: 401 },
      ),
    };
  }
  return {
    auth,
    unauthorizedResponse: null,
  };
}
