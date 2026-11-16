import Link from "next/link";
import type { SerializedPost } from "@/lib/posts";
import { PlatformIcon } from "@/components/platform-icon";
import { PostStatusBadge } from "@/components/status";

export function PostList({ posts, timeField }: { posts: SerializedPost[]; timeField: "scheduledAt" | "publishedAt" | "updatedAt" }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
      {posts.map((p) => {
        const href = ["DRAFT", "SCHEDULED"].includes(p.status) ? `/compose?post=${p.id}` : `/posts/${p.id}`;
        const t = p[timeField] ?? p.updatedAt;
        const failed = p.targets.filter((x) => x.status === "FAILED").length;
        return (
          <li key={p.id}>
            <Link href={href} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 hover:bg-paper md:flex-nowrap">
              <time className="w-36 shrink-0 text-[13px] tabular-nums text-slate" dateTime={t}>
                {new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </time>
              <p className="min-w-0 flex-1 truncate">
                {p.baseText || <span className="text-muted">(media only)</span>}
                {p.media.length > 0 && <span className="text-muted"> ({p.media.length} {p.media.length === 1 ? "file" : "files"})</span>}
              </p>
              <span className="flex shrink-0 -space-x-1.5">
                {p.targets.map((x) => (
                  <PlatformIcon key={x.id} platform={x.account.platform} className="size-6 rounded-md ring-2 ring-surface" />
                ))}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {p.recurrence !== "NONE" && <span className="text-xs text-muted">Repeats {p.recurrence.toLowerCase()}</span>}
                {failed > 0 && p.status === "PARTIAL" && <span className="text-xs text-bad">{failed} failed</span>}
                <PostStatusBadge status={p.status} />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
