import { AskmoreV2InterviewApp } from "@/components/askmore-v2-interview-app";
import { requirePageAuthOrRedirect } from "@/server/auth/page-auth";

export default async function AskmoreV2InterviewPage() {
  await requirePageAuthOrRedirect("/login");
  return <AskmoreV2InterviewApp />;
}
