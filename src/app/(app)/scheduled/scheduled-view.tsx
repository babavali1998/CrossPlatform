"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { SerializedPost } from "@/lib/posts";
import { PostList } from "@/components/post-list";
import { PlatformIcon } from "@/components/platform-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ScheduledView({ posts }: { posts: SerializedPost[] }) {
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [month, setMonth] = useState(() => startOfMonth(posts[0]?.scheduledAt ? new Date(posts[0].scheduledAt) : new Date()));

  const days = useMemo(
    () => eachDayOfInterval({ start: startOfWeek(startOfMonth(month)), end: endOfWeek(endOfMonth(month)) }),
    [month],
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="tablist" className="inline-flex rounded-lg border border-line-strong p-0.5">
          {(["calendar", "list"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn("rounded-md px-3 py-1.5 text-sm capitalize", view === v ? "bg-ink text-surface" : "text-slate hover:text-ink")}
            >
              {v}
            </button>
          ))}
        </div>
        {view === "calendar" && (
          <div className="ml-auto flex items-center gap-1">
            <Button size="icon" variant="ghost" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
              <ChevronLeft />
            </Button>
            <h2 className="w-40 text-center text-[17px] font-semibold">{format(month, "MMMM yyyy")}</h2>
            <Button size="icon" variant="ghost" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>

      {view === "list" ? (
        <PostList posts={posts} timeField="scheduledAt" />
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
          <div className="grid grid-cols-7 border-b border-line text-center text-[12px] text-muted">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const items = posts.filter((p) => p.scheduledAt && isSameDay(new Date(p.scheduledAt), day));
              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "min-h-28 border-b border-r border-line p-1.5 [&:nth-child(7n)]:border-r-0",
                    !isSameMonth(day, month) && "bg-paper/70",
                  )}
                >
                  <p
                    className={cn(
                      "mb-1 grid size-6 place-items-center rounded-full text-xs tabular-nums",
                      isToday(day) ? "bg-signal text-white" : isSameMonth(day, month) ? "text-slate" : "text-muted",
                    )}
                  >
                    {format(day, "d")}
                  </p>
                  <ul className="space-y-1">
                    {items.map((p) => (
                      <li key={p.id}>
                        <Link
                          href={`/compose?post=${p.id}`}
                          className="block rounded-md bg-signal-soft px-1.5 py-1 text-[12px] leading-tight text-ink hover:ring-1 hover:ring-signal"
                          title={p.baseText}
                        >
                          <span className="flex items-center gap-1">
                            <span className="tabular-nums text-signal">{format(new Date(p.scheduledAt!), "h:mm a")}</span>
                            <span className="ml-auto flex gap-0.5">
                              {p.targets.slice(0, 4).map((t) => (
                                <PlatformIcon key={t.id} platform={t.account.platform} plain className="size-3" />
                              ))}
                            </span>
                          </span>
                          <span className="mt-0.5 line-clamp-2 hidden sm:block">{p.baseText}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
