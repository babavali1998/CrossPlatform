"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import type { SerializedPost } from "@/lib/posts";
import { PLATFORMS } from "@/lib/platforms/catalog";
import { api, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Panel, PageHeader } from "@/components/ui/misc";
import { PlatformIcon } from "@/components/platform-icon";
import { PostStatusBadge, TargetStatusBadge } from "@/components/status";

type Log = { id: string; targetId: string; level: string; message: string; createdAt: string };

const IN_FLIGHT = ["QUEUED", "PUBLISHING"];

export function PostResults({ initial }: { initial: SerializedPost }) {
  const router = useRouter();
  const [post, setPost] = useState(initial);
  const [logs, setLogs] = useState<Log[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const live = IN_FLIGHT.includes(post.status) || post.targets.some((t) => IN_FLIGHT.includes(t.status));

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const data = await api<{ post: SerializedPost; logs: Log[] }>(`/api/posts/${post.id}`);
        if (stop) return;
        setPost(data.post);
        setLogs(data.logs);
      } catch {
        /* keep polling */
      }
    };
    void load();
    if (!live) return;
    const t = setInterval(load, 2500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [post.id, live]);

  const failed = post.targets.filter((t) => t.status === "FAILED");
  const unknown = failed.filter((t) => t.lastErrorCode === "OUTCOME_UNKNOWN");
  const done = post.targets.filter((t) => t.status === "PUBLISHED").length;

  const retry = async (opts: { force?: boolean; targetIds?: string[] } = {}) => {
    setRetrying(true);
    try {
      const r = await api<{ retried: number; skippedUnknown: number }>(`/api/posts/${post.id}/actions`, {
        method: "POST",
        json: { action: "retry", ...opts },
      });
      toast.success(`Retrying ${r.retried} ${r.retried === 1 ? "platform" : "platforms"}`);
      setPost((p) => ({ ...p, status: "PUBLISHING", targets: p.targets.map((t) => (t.status === "FAILED" && (opts.force || t.lastErrorCode !== "OUTCOME_UNKNOWN") && (!opts.targetIds || opts.targetIds.includes(t.id)) ? { ...t, status: "QUEUED" } : t)) }));
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRetrying(false);
    }
  };

  const title =
    post.status === "PUBLISHED"
      ? `Published to ${done} ${done === 1 ? "platform" : "platforms"}`
      : post.status === "PARTIAL"
        ? `Published to ${done} of ${post.targets.length} platforms`
        : post.status === "FAILED"
          ? "Publishing failed"
          : post.status === "SCHEDULED"
            ? "Scheduled"
            : post.status === "DRAFT"
              ? "Draft"
              : "Publishing…";

  return (
    <>
      <PageHeader
        title={title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <PostStatusBadge status={post.status} />
            {post.scheduledAt && post.status === "SCHEDULED" && <span>Goes out {new Date(post.scheduledAt).toLocaleString()}</span>}
            {post.publishedAt && <span>{new Date(post.publishedAt).toLocaleString()}</span>}
            {post.recurrence !== "NONE" && <span>Repeats {post.recurrence.toLowerCase()}</span>}
          </span>
        }
        actions={
          <>
            {failed.length - unknown.length > 0 && (
              <Button variant="primary" onClick={() => retry()} disabled={retrying}>
                {retrying ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Retry failed ({failed.length - unknown.length})
              </Button>
            )}
            {["DRAFT", "SCHEDULED"].includes(post.status) && (
              <Button asChild>
                <Link href={`/compose?post=${post.id}`}>Edit</Link>
              </Button>
            )}
            <Button asChild variant="ghost">
              <Link href="/compose">New post</Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <ul className="space-y-2.5">
          {post.targets.map((t) => (
            <li key={t.id}>
              <Panel className={cn("p-4", t.status === "FAILED" && "border-bad/40")}>
                <div className="flex flex-wrap items-center gap-3">
                  <PlatformIcon platform={t.account.platform} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{PLATFORMS[t.account.platform].name}</p>
                    <p className="truncate text-[13px] text-slate">@{t.account.username}</p>
                  </div>
                  {IN_FLIGHT.includes(t.status) && <Loader2 className="size-4 animate-spin text-signal" aria-hidden />}
                  <TargetStatusBadge status={t.status} />
                  {t.externalUrl && (
                    <Button asChild size="sm" variant="secondary">
                      <a href={t.externalUrl} target="_blank" rel="noreferrer">
                        View post <ExternalLink />
                      </a>
                    </Button>
                  )}
                </div>
                {t.status === "FAILED" && t.lastError && (
                  <div className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">
                    <p>{t.lastError}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {t.lastErrorCode === "OUTCOME_UNKNOWN" ? (
                        <Button size="sm" variant="danger" onClick={() => retry({ force: true, targetIds: [t.id] })} disabled={retrying}>
                          It’s not there, retry anyway
                        </Button>
                      ) : (
                        t.account.status === "ACTIVE" && (
                          <Button size="sm" variant="danger" onClick={() => retry({ targetIds: [t.id] })} disabled={retrying}>
                            Retry {PLATFORMS[t.account.platform].name}
                          </Button>
                        )
                      )}
                      {t.account.status !== "ACTIVE" && (
                        <Button asChild size="sm" variant="danger">
                          <a href={`/api/connect/${t.account.platform.toLowerCase()}`}>Reconnect account</a>
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                {t.attempts > 1 && <p className="mt-2 text-xs text-muted">{t.attempts} attempts</p>}
              </Panel>
            </li>
          ))}
        </ul>

        <aside className="space-y-3">
          <Panel className="p-4">
            <h2 className="text-[15px] font-semibold">Original post</h2>
            <p className="mt-2 whitespace-pre-wrap break-words text-[14px] text-slate">{post.baseText || "(no text)"}</p>
            {post.media.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {post.media.map((m) =>
                  m.kind === "VIDEO" ? (
                    <video key={m.id} src={`/api/media/${m.id}`} className="aspect-square rounded-md object-cover" muted />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={m.id} src={`/api/media/${m.id}`} alt="" className="aspect-square rounded-md object-cover" />
                  ),
                )}
              </div>
            )}
          </Panel>
          <Panel className="p-4">
            <button className="text-[15px] font-semibold" onClick={() => setShowLogs(!showLogs)} aria-expanded={showLogs}>
              Publishing log ({logs.length})
            </button>
            {showLogs && (
              <ol className="mt-2 max-h-80 space-y-1.5 overflow-auto text-xs">
                {logs.map((l) => {
                  const t = post.targets.find((x) => x.id === l.targetId);
                  return (
                    <li key={l.id} className={cn(l.level === "error" ? "text-bad" : l.level === "warn" ? "text-warn" : "text-slate")}>
                      <span className="tabular-nums text-muted">{new Date(l.createdAt).toLocaleTimeString()}</span>{" "}
                      {t && <span className="font-medium">{PLATFORMS[t.account.platform].name}:</span>} {l.message}
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}
