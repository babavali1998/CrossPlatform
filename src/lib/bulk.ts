import Papa from "papaparse";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { fromZonedTime } from "date-fns-tz";
import type { SocialAccount } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { putObjectBytes } from "@/lib/storage";
import { PLATFORMS } from "@/lib/platforms/catalog";
import { validateForPlatform } from "@/lib/platforms/validate";

/**
 * CSV columns (header row required):
 *   text          post text (required)
 *   accounts      "all", or ";"-separated platforms or @usernames: "instagram;x" or "@mybiz;linkedin"
 *   scheduled_at  ISO 8601 with offset, or "YYYY-MM-DD HH:mm" in your timezone. Empty = save as draft
 *   media_url     optional https URL of one image/video to attach
 *   ig_format     optional FEED | REEL | STORY
 */
export type BulkRow = {
  row: number;
  text: string;
  accountIds: string[];
  scheduledAt: string | null;
  mediaUrl: string | null;
  igFormat: string;
  errors: string[];
};

const MAX_ROWS = 200;

export function parseBulkCsv(csv: string, accounts: SocialAccount[], timezone: string): BulkRow[] {
  const parsed = Papa.parse<Record<string, string>>(csv.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const rows = parsed.data.slice(0, MAX_ROWS);
  return rows.map((r, i) => {
    const errors: string[] = [];
    const text = (r.text || "").trim();
    if (!text && !r.media_url) errors.push("Missing text");

    const wanted = (r.accounts || "all")
      .split(/[;,]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const active = accounts.filter((a) => a.status === "ACTIVE");
    const picked = new Set<string>();
    for (const w of wanted) {
      if (w === "all") active.forEach((a) => picked.add(a.id));
      else if (w.startsWith("@")) {
        const a = active.find((x) => x.username.toLowerCase() === w.slice(1));
        if (a) picked.add(a.id);
        else errors.push(`No connected account ${w}`);
      } else {
        const matches = active.filter((x) => x.platform.toLowerCase() === w || PLATFORMS[x.platform].name.toLowerCase() === w);
        if (matches.length) matches.forEach((a) => picked.add(a.id));
        else errors.push(`No connected ${w} account`);
      }
    }
    if (!picked.size) errors.push("No accounts selected");

    let scheduledAt: string | null = null;
    const raw = (r.scheduled_at || "").trim();
    if (raw) {
      const d = /[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? new Date(raw) : fromZonedTime(raw.replace(" ", "T"), timezone);
      if (Number.isNaN(d.getTime())) errors.push(`Can't read date "${raw}"`);
      else if (d.getTime() < Date.now()) errors.push("Scheduled time is in the past");
      else scheduledAt = d.toISOString();
    }

    const mediaUrl = (r.media_url || "").trim() || null;
    if (mediaUrl && !/^https:\/\//i.test(mediaUrl)) errors.push("media_url must start with https://");

    const igFormat = (r.ig_format || "FEED").trim().toUpperCase();
    if (!["FEED", "REEL", "STORY"].includes(igFormat)) errors.push("ig_format must be FEED, REEL or STORY");

    // Text-only checks now; media is checked after download.
    if (!mediaUrl) {
      for (const id of picked) {
        const a = accounts.find((x) => x.id === id)!;
        const v = validateForPlatform(a.platform, text, [], { accountSettings: a.settings as Record<string, unknown> });
        v.errors.forEach((e) => errors.push(`${PLATFORMS[a.platform].name}: ${e}`));
      }
    }

    return { row: i + 2, text, accountIds: [...picked], scheduledAt, mediaUrl, igFormat, errors };
  });
}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const l = ip.toLowerCase();
    return l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:127.") || l === "::";
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

const MEDIA_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

/** Downloads a remote file into storage. Refuses private network addresses (SSRF). */
export async function importMediaFromUrl(userId: string, url: string) {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("Only https URLs are allowed");
  const addrs = await lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("URL points to a private address");

  const res = await fetch(u, { redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const type = (res.headers.get("content-type") || "").split(";")[0].trim();
  const ext = MEDIA_TYPES[type];
  if (!ext) throw new Error(`Unsupported file type ${type || "unknown"}`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > 300 * 1024 * 1024) throw new Error("File is larger than 300 MB");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > 300 * 1024 * 1024) throw new Error("File is larger than 300 MB");

  let width: number | undefined;
  let height: number | undefined;
  if (type.startsWith("image/")) {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(bytes).metadata();
    width = meta.width;
    height = meta.height;
  }

  const key = `u/${userId}/${randomUUID()}.${ext}`;
  await putObjectBytes(key, bytes, type);
  return db.mediaAsset.create({
    data: {
      userId,
      key,
      kind: type.startsWith("video/") ? "VIDEO" : "IMAGE",
      mimeType: type,
      sizeBytes: bytes.length,
      width,
      height,
      originalName: u.pathname.split("/").pop() || "media",
      uploaded: true,
    },
  });
}
