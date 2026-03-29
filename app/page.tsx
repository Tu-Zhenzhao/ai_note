import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME } from "@/server/auth/constants";
import { getAuthContextFromSessionToken } from "@/server/auth/service";

export default async function HomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const auth = await getAuthContextFromSessionToken(token);
  if (auth) {
    redirect("/askmore_v2/builder");
  }
  redirect("/login");
}
