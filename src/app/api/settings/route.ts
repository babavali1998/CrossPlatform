import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, withUser } from "@/lib/api";

const schema = z.object({
  name: z.string().max(100).optional(),
  timezone: z.string().max(64).optional(),
});

export const PATCH = withUser(async (userId, req) => {
  const body = schema.parse(await req.json());
  if (body.timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: body.timezone });
    } catch {
      throw new HttpError(400, "Unknown timezone");
    }
  }
  const user = await db.user.update({ where: { id: userId }, data: body });
  return { user: { name: user.name, timezone: user.timezone } };
});
