import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { HttpError, withUser } from "@/lib/api";
import { publicMediaUrl } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

/** Redirects to a short-lived URL for previewing a media file in the app. */
export const GET = withUser<Ctx>(async (userId, _req, { params }) => {
  const { id } = await params;
  const media = await db.mediaAsset.findFirst({ where: { id, userId } });
  if (!media) throw new HttpError(404, "Media not found");
  return NextResponse.redirect(await publicMediaUrl(media.key, 3600), 302);
});
