import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { serializeAccount } from "@/lib/accounts";
import { PLATFORM_ORDER, PLATFORMS } from "@/lib/platforms/catalog";
import { isConfigured } from "@/lib/platforms/registry";
import { appUrl } from "@/lib/env";
import { PageHeader } from "@/components/ui/misc";
import { AccountsView } from "./accounts-view";

export const metadata = { title: "Connected accounts" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const accounts = await db.socialAccount.findMany({
    where: { userId: user.id, status: { not: "REVOKED" } },
    orderBy: { createdAt: "asc" },
  });
  const platforms = PLATFORM_ORDER.map((id) => ({
    id,
    name: PLATFORMS[id].name,
    status: PLATFORMS[id].status,
    configured: isConfigured(id),
    envKeys: PLATFORMS[id].envKeys,
    requirements: PLATFORMS[id].requirements,
    limitations: PLATFORMS[id].limitations,
    redirectUri: appUrl(`/api/connect/${id.toLowerCase()}/callback`),
  }));

  return (
    <>
      <PageHeader
        title="Connected accounts"
        description="Connections use each platform's official sign-in. CrossPlatform never sees your passwords, and access tokens are stored encrypted."
      />
      <AccountsView
        accounts={accounts.map(serializeAccount)}
        platforms={platforms}
        flash={{ connected: sp.connected, error: sp.error }}
      />
    </>
  );
}
