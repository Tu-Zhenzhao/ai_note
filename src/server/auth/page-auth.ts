import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE_NAME } from "@/server/auth/constants";
import { AuthContext, getAuthContextFromSessionToken } from "@/server/auth/service";

export async function requirePageAuthOrRedirect(loginPath = "/login"): Promise<AuthContext> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const auth = await getAuthContextFromSessionToken(token);
  if (!auth) {
    redirect(loginPath);
  }
  return auth;
}
