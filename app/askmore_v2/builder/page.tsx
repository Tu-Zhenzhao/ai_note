import { AskmoreV2BuilderApp } from "@/components/askmore-v2-builder-app";
import { requirePageAuthOrRedirect } from "@/server/auth/page-auth";

export default async function AskmoreV2BuilderPage() {
  await requirePageAuthOrRedirect("/login");
  return <AskmoreV2BuilderApp />;
}
