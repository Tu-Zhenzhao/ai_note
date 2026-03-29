import { createHash, randomBytes, randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { dbQuery, withDbTransaction } from "@/server/repo/db";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import {
  AUTH_BETA_TEST_INVITE_CODE,
  AUTH_COOKIE_NAME,
  AUTH_SESSION_MAX_AGE_SECONDS,
} from "@/server/auth/constants";

type AuthRole = "owner" | "admin" | "editor" | "viewer";

export interface AuthContext {
  user: {
    id: string;
    email: string;
    display_name: string | null;
    onboarding_completed_at: string | null;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
    role: AuthRole;
  };
  session: {
    id: string;
    expires_at: string;
  };
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertPasswordPolicy(password: string) {
  if (password.length < 8) {
    throw new AuthError("Password must be at least 8 characters.", "password_too_short", 400);
  }
}

function assertInviteCode(inviteCode: string) {
  if (inviteCode.trim() !== AUTH_BETA_TEST_INVITE_CODE) {
    throw new AuthError("Invalid beta test invite code.", "invalid_test_invite_code", 403);
  }
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function nowIso(): string {
  return new Date().toISOString();
}

function expiresAtIso(): string {
  return new Date(Date.now() + AUTH_SESSION_MAX_AGE_SECONDS * 1000).toISOString();
}

async function createSession(params: {
  userId: string;
  workspaceId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ sessionToken: string; sessionId: string; expiresAt: string }> {
  const sessionToken = generateSessionToken();
  const sessionId = randomUUID();
  const createdAt = nowIso();
  const expiresAt = expiresAtIso();
  await dbQuery(
    `insert into auth_sessions
      (id, session_token_hash, user_id, workspace_id, expires_at, revoked_at, ip, user_agent, created_at, updated_at)
     values ($1,$2,$3,$4,$5,null,$6,$7,$8,$9)`,
    [
      sessionId,
      hashSessionToken(sessionToken),
      params.userId,
      params.workspaceId,
      expiresAt,
      params.ip ?? null,
      params.userAgent ?? null,
      createdAt,
      createdAt,
    ],
  );
  return {
    sessionToken,
    sessionId,
    expiresAt,
  };
}

function extractIp(request?: NextRequest): string | null {
  if (!request) return null;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}

function extractUserAgent(request?: NextRequest): string | null {
  if (!request) return null;
  return request.headers.get("user-agent");
}

async function getPrimaryWorkspaceByUserId(userId: string): Promise<{
  id: string;
  name: string;
  slug: string;
  role: AuthRole;
} | null> {
  const result = await dbQuery<{
    id: string;
    name: string;
    slug: string;
    role: AuthRole;
  }>(
    `select w.id, w.name, w.slug, m.role
     from auth_workspace_members m
     join auth_workspaces w on w.id = m.workspace_id
     where m.user_id = $1
     order by
       case m.role
         when 'owner' then 0
         when 'admin' then 1
         when 'editor' then 2
         else 3
       end asc,
       m.created_at asc
     limit 1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function signupWithPassword(params: {
  email: string;
  password: string;
  inviteCode: string;
  displayName?: string;
  request?: NextRequest;
}): Promise<{ auth: AuthContext; sessionToken: string }> {
  const email = normalizeEmail(params.email);
  const displayName = params.displayName?.trim() || null;
  assertPasswordPolicy(params.password);
  assertInviteCode(params.inviteCode);

  const existing = await dbQuery<{ id: string }>(
    `select id from auth_users where email = $1 limit 1`,
    [email],
  );
  if (existing.rows[0]) {
    throw new AuthError("Email already registered.", "email_exists", 409);
  }

  const passwordHash = await hashPassword(params.password);
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const userNow = nowIso();
  const baseSlug = slugify(displayName || email.split("@")[0] || "workspace") || "workspace";
  const workspaceSlug = `${baseSlug}-${workspaceId.slice(0, 6)}`;
  const workspaceName = displayName ? `${displayName} Workspace` : `${email.split("@")[0]} Workspace`;

  await withDbTransaction(async () => {
    await dbQuery(
      `insert into auth_users
        (id, email, password_hash, display_name, status, created_at, updated_at, last_login_at)
       values ($1,$2,$3,$4,'active',$5,$6,null)`,
      [userId, email, passwordHash, displayName, userNow, userNow],
    );
    await dbQuery(
      `insert into auth_workspaces
        (id, owner_user_id, name, slug, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6)`,
      [workspaceId, userId, workspaceName, workspaceSlug, userNow, userNow],
    );
    await dbQuery(
      `insert into auth_workspace_members
        (workspace_id, user_id, role, created_at)
       values ($1,$2,'owner',$3)`,
      [workspaceId, userId, userNow],
    );
  });

  const session = await createSession({
    userId,
    workspaceId,
    ip: extractIp(params.request),
    userAgent: extractUserAgent(params.request),
  });

  const auth: AuthContext = {
    user: {
      id: userId,
      email,
      display_name: displayName,
      onboarding_completed_at: null,
    },
    workspace: {
      id: workspaceId,
      name: workspaceName,
      slug: workspaceSlug,
      role: "owner",
    },
    session: {
      id: session.sessionId,
      expires_at: session.expiresAt,
    },
  };

  return {
    auth,
    sessionToken: session.sessionToken,
  };
}

export async function loginWithPassword(params: {
  email: string;
  password: string;
  request?: NextRequest;
}): Promise<{ auth: AuthContext; sessionToken: string }> {
  const email = normalizeEmail(params.email);
  const userResult = await dbQuery<{
    id: string;
    email: string;
    display_name: string | null;
    onboarding_completed_at: string | null;
    password_hash: string;
    status: "active" | "disabled";
  }>(
    `select id, email, display_name, onboarding_completed_at, password_hash, status
     from auth_users
     where email = $1
     limit 1`,
    [email],
  );
  const user = userResult.rows[0];
  if (!user || user.status !== "active") {
    throw new AuthError("Invalid email or password.", "invalid_credentials", 401);
  }

  const ok = await verifyPassword(params.password, user.password_hash);
  if (!ok) {
    throw new AuthError("Invalid email or password.", "invalid_credentials", 401);
  }

  const workspace = await getPrimaryWorkspaceByUserId(user.id);
  if (!workspace) {
    throw new AuthError("Workspace not found for user.", "workspace_not_found", 403);
  }

  const session = await createSession({
    userId: user.id,
    workspaceId: workspace.id,
    ip: extractIp(params.request),
    userAgent: extractUserAgent(params.request),
  });
  await dbQuery(
    `update auth_users set last_login_at = $2, updated_at = $2 where id = $1`,
    [user.id, nowIso()],
  );

  return {
    auth: {
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        onboarding_completed_at: user.onboarding_completed_at,
      },
      workspace: workspace,
      session: {
        id: session.sessionId,
        expires_at: session.expiresAt,
      },
    },
    sessionToken: session.sessionToken,
  };
}

export async function getAuthContextFromSessionToken(sessionToken: string | null | undefined): Promise<AuthContext | null> {
  if (!sessionToken) return null;
  const tokenHash = hashSessionToken(sessionToken);
  const result = await dbQuery<{
    session_id: string;
    expires_at: string;
    user_id: string;
    email: string;
    display_name: string | null;
    onboarding_completed_at: string | null;
    workspace_id: string;
    workspace_name: string;
    workspace_slug: string;
    role: AuthRole;
  }>(
    `select
       s.id as session_id,
       s.expires_at,
       u.id as user_id,
       u.email,
       u.display_name,
       u.onboarding_completed_at,
       w.id as workspace_id,
       w.name as workspace_name,
       w.slug as workspace_slug,
       m.role
     from auth_sessions s
     join auth_users u on u.id = s.user_id
     join auth_workspaces w on w.id = s.workspace_id
     join auth_workspace_members m on m.workspace_id = w.id and m.user_id = u.id
     where s.session_token_hash = $1
       and s.revoked_at is null
       and s.expires_at > now()
       and u.status = 'active'
     limit 1`,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) return null;

  await dbQuery(
    `update auth_sessions set updated_at = $2 where id = $1`,
    [row.session_id, nowIso()],
  );

  return {
    user: {
      id: row.user_id,
      email: row.email,
      display_name: row.display_name,
      onboarding_completed_at: row.onboarding_completed_at,
    },
    workspace: {
      id: row.workspace_id,
      name: row.workspace_name,
      slug: row.workspace_slug,
      role: row.role,
    },
    session: {
      id: row.session_id,
      expires_at: row.expires_at,
    },
  };
}

export async function getAuthContextFromRequest(request: NextRequest): Promise<AuthContext | null> {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  return getAuthContextFromSessionToken(token);
}

export async function revokeSessionByToken(sessionToken: string | null | undefined): Promise<void> {
  if (!sessionToken) return;
  const tokenHash = hashSessionToken(sessionToken);
  const now = nowIso();
  await dbQuery(
    `update auth_sessions
     set revoked_at = coalesce(revoked_at, $2),
         updated_at = $2
     where session_token_hash = $1`,
    [tokenHash, now],
  );
}

export async function revokeSessionByRequest(request: NextRequest): Promise<void> {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  await revokeSessionByToken(token);
}

export async function markAuthOnboardingCompleted(auth: AuthContext): Promise<void> {
  const now = nowIso();
  await dbQuery(
    `update auth_users
     set onboarding_completed_at = coalesce(onboarding_completed_at, $2),
         updated_at = $2
     where id = $1`,
    [auth.user.id, now],
  );
}

function normalizeConfirmInput(input: string): string {
  return input.trim().toLowerCase();
}

function canConfirmDeletion(input: string, auth: AuthContext): boolean {
  const normalized = normalizeConfirmInput(input);
  if (!normalized) return false;
  const emailLocal = auth.user.email.split("@")[0] ?? "";
  const candidates = [
    auth.user.email,
    auth.user.display_name ?? "",
    emailLocal,
  ]
    .map((item) => normalizeConfirmInput(item))
    .filter(Boolean);
  return candidates.includes(normalized);
}

export async function deleteAccountWithConfirmation(params: {
  auth: AuthContext;
  confirmInput: string;
}): Promise<void> {
  if (!canConfirmDeletion(params.confirmInput, params.auth)) {
    throw new AuthError(
      "Confirmation text must match your account name or email.",
      "delete_account_confirmation_mismatch",
      400,
    );
  }

  if (params.auth.workspace.role !== "owner") {
    throw new AuthError(
      "Only workspace owner can delete this account in beta.",
      "delete_account_requires_owner",
      403,
    );
  }

  const userId = params.auth.user.id;
  const workspaceId = params.auth.workspace.id;

  await withDbTransaction(async () => {
    await dbQuery(
      `delete from auth_sessions
       where user_id = $1 or workspace_id = $2`,
      [userId, workspaceId],
    );

    await dbQuery(
      `delete from askmore_v2_sessions
       where workspace_id = $1`,
      [workspaceId],
    );

    await dbQuery(
      `delete from askmore_v2_flow_versions
       where workspace_id = $1`,
      [workspaceId],
    );

    await dbQuery(
      `delete from auth_workspace_members
       where workspace_id = $1`,
      [workspaceId],
    );

    await dbQuery(
      `delete from auth_workspaces
       where id = $1`,
      [workspaceId],
    );

    const deletedUser = await dbQuery(
      `delete from auth_users
       where id = $1`,
      [userId],
    );
    if ((deletedUser.rowCount ?? 0) === 0) {
      throw new AuthError("Account not found.", "delete_account_not_found", 404);
    }
  });
}
