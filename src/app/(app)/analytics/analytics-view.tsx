"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { Platform } from "@/generated/prisma/browser";
import type { AnalyticsData } from "@/lib/analytics-query";
import { PLATFORMS } from "@/lib/platforms/catalog";
import { api, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Panel } from "@/components/ui/misc";
import { PlatformIcon } from "@/components/platform-icon";

const nf = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

type Support = { platform: Platform; name: string; analytics: "supported" | "opt-in" | "unsupported" };

export function AnalyticsView({ data, support }: { data: AnalyticsData; support: Support[] }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api("/api/analytics", { method: "POST" });
      toast.success("Refresh started. Numbers update in a minute or two.");
      setTimeout(() => router.refresh(), 45_000);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const setDays = (d: number) => {
    router.push(`/analytics?days=${d}`);
  };

  const t = data.total;
  const stats = [
    { label: "Views", value: t.views },
    { label: "Reach", value: t.reach },
    { label: "Likes", value: t.likes },
    { label: "Comments", value: t.comments },
    { label: "Shares", value: t.shares },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="inline-flex rounded-lg border border-line-strong p-0.5">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              role="tab"
              aria-selected={data.days === d}
              onClick={() => setDays(d)}
              className={cn("rounded-md px-3 py-1.5 text-sm", data.days === d ? "bg-ink text-surface" : "text-slate hover:text-ink")}
            >
              {d} days
            </button>
          ))}
        </div>
        <span className="text-[13px] text-muted">
          {data.lastSyncedAt ? `Last updated ${new Date(data.lastSyncedAt).toLocaleString()}` : "Not synced yet"}
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={cn(refreshing && "animate-spin")} /> Refresh now
        </Button>
      </div>

      {t.posts === 0 ? (
        <EmptyState
          title="No published posts in this period"
          body="Analytics appear here after you publish and the next sync runs."
          action={
            <Button asChild variant="primary">
              <Link href="/compose">Create post</Link>
            </Button>
          }
        />
      ) : (
        <>
          <Panel className="grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
            <div className="col-span-2 px-5 py-4 sm:col-span-3 lg:col-span-1">
              <p className="text-[13px] text-slate">Engagement rate</p>
              <p className="font-display text-[34px] font-semibold leading-tight">{pct(t.engagementRate)}</p>
              <p className="text-xs text-muted">across {t.posts} platform posts</p>
            </div>
            {stats.map((s) => (
              <div key={s.label} className="px-5 py-4">
                <p className="text-[13px] text-slate">{s.label}</p>
                <p className="text-[22px] font-semibold tabular-nums">{nf.format(s.value)}</p>
              </div>
            ))}
          </Panel>

          <section>
            <h2 className="mb-2 text-[17px] font-semibold">By platform</h2>
            <Panel className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b border-line text-[13px] text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Platform</th>
                    <th className="px-4 py-2 text-right font-medium">Posts</th>
                    <th className="px-4 py-2 text-right font-medium">Views</th>
                    <th className="px-4 py-2 text-right font-medium">Likes</th>
                    <th className="px-4 py-2 text-right font-medium">Comments</th>
                    <th className="px-4 py-2 text-right font-medium">Shares</th>
                    <th className="px-4 py-2 text-right font-medium">Engagement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line tabular-nums">
                  {data.platforms.map((p) => (
                    <tr key={p.platform}>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2">
                          <PlatformIcon platform={p.platform} className="size-6" /> {PLATFORMS[p.platform].name}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">{p.posts}</td>
                      <td className="px-4 py-2.5 text-right">{nf.format(p.views)}</td>
                      <td className="px-4 py-2.5 text-right">{nf.format(p.likes)}</td>
                      <td className="px-4 py-2.5 text-right">{nf.format(p.comments)}</td>
                      <td className="px-4 py-2.5 text-right">{nf.format(p.shares)}</td>
                      <td className="px-4 py-2.5 text-right">{pct(p.engagementRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </section>

          {data.best.length > 0 && (
            <section>
              <h2 className="mb-2 text-[17px] font-semibold">Best-performing posts</h2>
              <ol className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
                {data.best.map((b, i) => (
                  <li key={b.targetId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="w-5 text-right tabular-nums text-muted">{i + 1}</span>
                    <PlatformIcon platform={b.platform} className="size-6" />
                    <Link href={`/posts/${b.postId}`} className="min-w-0 flex-1 truncate hover:underline">
                      {b.text || "(media only)"}
                    </Link>
                    <span className="text-[13px] tabular-nums text-slate">
                      {nf.format(b.interactions ?? 0)} interactions{b.views ? `, ${nf.format(b.views)} views` : ""}
                    </span>
                    {b.url && (
                      <a href={b.url} target="_blank" rel="noreferrer" className="text-slate hover:text-ink" aria-label="Open on platform">
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}

      {data.followers.length > 0 && (
        <section>
          <h2 className="mb-2 text-[17px] font-semibold">Followers</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {data.followers.map((f) => (
              <Panel key={f.accountId} className="p-4">
                <div className="flex items-center gap-2.5">
                  <PlatformIcon platform={f.platform} className="size-7" />
                  <div className="flex-1">
                    <p className="font-medium">@{f.username}</p>
                    <p className="text-[13px] text-slate tabular-nums">
                      {nf.format(f.current)} followers
                      <span className={cn("ml-1.5", f.change > 0 ? "text-ok" : f.change < 0 ? "text-bad" : "text-muted")}>
                        {f.change > 0 ? "+" : ""}
                        {f.change} in {data.days} days
                      </span>
                    </p>
                  </div>
                </div>
                {f.series.length > 1 && (
                  <div className="mt-3 h-28">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={f.series.map((s) => ({ ...s, label: new Date(s.at).toLocaleDateString() }))}>
                        <CartesianGrid stroke="var(--line)" vertical={false} />
                        <XAxis dataKey="label" hide />
                        <YAxis width={44} tick={{ fontSize: 11, fill: "var(--muted)" }} domain={["dataMin", "dataMax"]} tickFormatter={(v) => nf.format(v)} />
                        <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }} />
                        <Line type="monotone" dataKey="followers" stroke={PLATFORMS[f.platform].color === "#000000" || PLATFORMS[f.platform].color === "#111111" ? "var(--ink)" : PLATFORMS[f.platform].color} strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Panel>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-[15px] font-semibold">What each platform shares</h2>
        <ul className="flex flex-wrap gap-2 text-[13px]">
          {support.map((s) => (
            <li key={s.platform} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1">
              <PlatformIcon platform={s.platform} plain />
              {s.name}
              <Badge tone={s.analytics === "supported" ? "ok" : s.analytics === "opt-in" ? "warn" : "neutral"}>
                {s.analytics === "supported" ? "Post metrics and followers" : s.analytics === "opt-in" ? "Off by default (paid reads)" : "Not available"}
              </Badge>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
