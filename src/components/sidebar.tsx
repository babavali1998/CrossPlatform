"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  CalendarDays,
  FileText,
  Link2,
  Menu,
  PenSquare,
  Send,
  Settings,
  Sparkles,
  Upload,
  X as Close,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/compose", label: "Create post", icon: PenSquare },
  { href: "/scheduled", label: "Scheduled", icon: CalendarDays, badge: "scheduled" as const },
  { href: "/published", label: "Published", icon: Send },
  { href: "/drafts", label: "Drafts", icon: FileText, badge: "drafts" as const },
  { href: "/bulk", label: "Bulk upload", icon: Upload },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/assistant", label: "AI assistant", icon: Sparkles },
  { href: "/accounts", label: "Connected accounts", icon: Link2, badge: "accounts" as const },
  { href: "/settings", label: "Settings", icon: Settings },
];

type Badges = { drafts: number; scheduled: number; accounts: number };

export function Sidebar({ user, badges }: { user: { name?: string | null; email?: string | null; image?: string | null }; badges: Badges }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 md:hidden">
        <Wordmark />
        <button className="rounded-lg p-2 text-slate" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)}>
          {open ? <Close className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      <aside
        className={cn(
          "border-r border-line bg-surface md:sticky md:top-0 md:flex md:h-dvh md:flex-col",
          open ? "block" : "hidden md:flex",
        )}
      >
        <div className="hidden px-5 pb-4 pt-6 md:block">
          <Wordmark />
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-3 md:py-0" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon, badge }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            const n = badge ? badges[badge] : 0;
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] text-slate transition-colors hover:bg-paper hover:text-ink",
                  active && "bg-signal-soft font-medium text-signal hover:bg-signal-soft hover:text-signal",
                )}
              >
                <Icon className="size-[18px]" />
                <span className="flex-1">{label}</span>
                {n > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-xs tabular-nums",
                      badge === "accounts" ? "bg-warn-soft text-warn" : "bg-line text-slate",
                    )}
                    title={badge === "accounts" ? `${n} account(s) need reconnecting` : undefined}
                  >
                    {n}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line px-5 py-4 text-[13px]">
          <p className="truncate font-medium">{user.name || "Signed in"}</p>
          <p className="truncate text-muted">{user.email}</p>
        </div>
      </aside>
    </>
  );
}

function Wordmark() {
  return (
    <Link href="/compose" className="flex items-center gap-2 font-display text-[17px] font-semibold">
      <span aria-hidden className="grid size-7 place-items-center rounded-lg bg-signal text-white">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M5 12h9M10 6l6 6-6 6" />
          <path d="M19 5v14" />
        </svg>
      </span>
      CrossPlatform
    </Link>
  );
}
