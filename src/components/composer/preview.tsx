"use client";

import type { Platform } from "@/generated/prisma/browser";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import type { MediaItem } from "./media-upload";

type Props = {
  platform: Platform;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  text: string;
  media: Pick<MediaItem, "key" | "previewUrl" | "kind">[];
  igFormat?: string;
};

/** An approximation of how the post will look on each platform. */
export function PlatformPreview(p: Props) {
  const avatar = p.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={p.avatarUrl} alt="" className="size-9 rounded-full object-cover" />
  ) : (
    <span className="grid size-9 place-items-center rounded-full bg-line text-sm font-semibold text-slate">
      {p.username.slice(0, 1).toUpperCase()}
    </span>
  );
  const name = p.displayName || p.username;

  if (p.platform === "INSTAGRAM") {
    const story = p.igFormat === "STORY";
    const reel = p.igFormat === "REEL";
    return (
      <div className="overflow-hidden rounded-xl border border-line bg-white text-[#111] dark:bg-black dark:text-white">
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          {avatar}
          <span className="text-[13px] font-semibold">{p.username}</span>
          {(story || reel) && <span className="ml-auto text-xs opacity-60">{story ? "Story" : "Reel"}</span>}
        </div>
        <MediaGrid media={p.media} aspect={story || reel ? "aspect-[9/16] max-h-[420px]" : "aspect-square"} single />
        {!story && (
          <p className="whitespace-pre-wrap break-words px-3 py-2.5 text-[13px] leading-snug">
            <span className="font-semibold">{p.username}</span> {truncate(p.text, 125)}
          </p>
        )}
      </div>
    );
  }

  if (p.platform === "LINKEDIN") {
    return (
      <div className="overflow-hidden rounded-xl border border-line bg-white text-[#1d2226] dark:bg-[#1b1f23] dark:text-white">
        <div className="flex items-center gap-2.5 px-4 pt-3">
          {avatar}
          <div className="leading-tight">
            <p className="text-[14px] font-semibold">{name}</p>
            <p className="text-xs opacity-60">Now</p>
          </div>
        </div>
        <p className="whitespace-pre-wrap break-words px-4 py-3 text-[14px] leading-normal">{truncate(p.text, 210)}</p>
        <MediaGrid media={p.media} />
      </div>
    );
  }

  // Threads and X share a similar layout: avatar column + text.
  return (
    <div className="rounded-xl border border-line bg-white p-3.5 text-[#0f1419] dark:bg-black dark:text-white">
      <div className="flex gap-3">
        {avatar}
        <div className="min-w-0 flex-1">
          <p className="text-[14px]">
            <span className="font-semibold">{p.platform === "X" ? name : p.username}</span>
            {p.platform === "X" && <span className="opacity-55"> @{p.username}</span>}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[14.5px] leading-snug">{p.text}</p>
          {p.media.length > 0 && (
            <div className="mt-2.5 overflow-hidden rounded-xl border border-line">
              <MediaGrid media={p.media} />
            </div>
          )}
        </div>
        <PlatformIcon platform={p.platform} plain className="text-ink" />
      </div>
    </div>
  );
}

function MediaGrid({
  media,
  aspect = "aspect-[16/10]",
  single = false,
}: {
  media: Props["media"];
  aspect?: string;
  single?: boolean;
}) {
  if (!media.length) return null;
  const shown = single ? media.slice(0, 1) : media.slice(0, 4);
  return (
    <div className={cn("relative grid gap-0.5 bg-line", shown.length > 1 && "grid-cols-2")}>
      {shown.map((m) => (
        <div key={m.key} className={cn("overflow-hidden bg-black/5", shown.length === 1 ? aspect : "aspect-square")}>
          {m.kind === "VIDEO" ? (
            <video src={m.previewUrl} className="size-full object-cover" muted playsInline />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.previewUrl} alt="" className="size-full object-cover" />
          )}
        </div>
      ))}
      {single && media.length > 1 && (
        <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">1/{media.length}</span>
      )}
      {!single && media.length > 4 && (
        <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">+{media.length - 4}</span>
      )}
    </div>
  );
}

function truncate(text: string, n: number) {
  const chars = Array.from(text);
  return chars.length > n ? `${chars.slice(0, n).join("")}… more` : text;
}
