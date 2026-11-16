import { requireUser } from "@/lib/session";
import { getAnalytics } from "@/lib/analytics-query";
import { PLATFORM_ORDER, PLATFORMS } from "@/lib/platforms/catalog";
import { PageHeader } from "@/components/ui/misc";
import { AnalyticsView } from "./analytics-view";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await requireUser();
  const days = [7, 30, 90].includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 30;
  const data = await getAnalytics(user.id, days);
  const support = PLATFORM_ORDER.filter((p) => PLATFORMS[p].status === "available").map((p) => ({
    platform: p,
    name: PLATFORMS[p].name,
    analytics: PLATFORMS[p].analytics,
  }));
  return (
    <>
      <PageHeader title="Analytics" description="Numbers come from each platform's API where it shares them. They refresh every 6 hours." />
      <AnalyticsView data={data} support={support} />
    </>
  );
}
