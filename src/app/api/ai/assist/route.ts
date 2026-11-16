import { z } from "zod";
import { withUser } from "@/lib/api";
import { assist } from "@/lib/ai";

const schema = z.object({
  instruction: z.string().min(1).max(1000),
  text: z.string().max(10_000).default(""),
  platform: z.enum(["THREADS", "INSTAGRAM", "X", "LINKEDIN", "FACEBOOK", "TIKTOK", "YOUTUBE", "PINTEREST", "BLUESKY"]).optional(),
});

export const POST = withUser(async (_userId, req) => {
  const body = schema.parse(await req.json());
  return { text: await assist(body) };
});
