import OpenAI from "openai";
import type { Platform } from "@/generated/prisma/client";
import { PLATFORMS, textLimitFor } from "@/lib/platforms/catalog";
import { HttpError } from "@/lib/api";

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new HttpError(503, "AI is off: set OPENAI_API_KEY on the server.");
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}
const model = () => process.env.OPENAI_MODEL || "gpt-4.1-mini";

const STYLE: Record<string, string> = {
  INSTAGRAM:
    "Visual-first caption: a strong first line (it shows before 'more'), short paragraphs, a light call to action, then 5-12 relevant hashtags on a final line. Emoji are fine in moderation.",
  THREADS: "Conversational and direct, like talking to followers. 1-3 short paragraphs. At most 1-2 hashtags, or none.",
  X: "Concise and punchy. One idea. Keep any link. 0-2 hashtags only if they add reach.",
  LINKEDIN:
    "Professional storytelling: a hook line, short paragraphs with line breaks, a concrete takeaway, and an optional question at the end. 3-5 hashtags at the end.",
  FACEBOOK: "Warm and community-oriented, invites comments.",
  TIKTOK: "Very short caption for a video, 3-6 video-focused hashtags.",
  YOUTUBE: "Description that front-loads keywords.",
  PINTEREST: "Keyword-rich, descriptive.",
  BLUESKY: "Conversational, under 300 characters.",
};

// Keeps generated posts sounding like a person wrote them.
const HUMAN_VOICE = `Write like a real person posting, not like an AI or a marketing department.
Avoid: em dashes, "delve", "game-changer", "unlock", "elevate", "in today's fast-paced world", "excited to share" openers unless the user wrote it, rhetorical "Here's the thing", lists of three adjectives, and generic hype.
Keep the user's facts, names, links, and @mentions exactly. Do not invent claims, numbers, or features. Match the user's language.`;

export type Adaptation = { platform: Platform; text: string; notes?: string };

export async function adaptPost(args: {
  text: string;
  targets: Array<{ platform: Platform; settings?: Record<string, unknown> | null; format?: string }>;
  tone?: string;
  mediaSummary?: string;
}): Promise<Adaptation[]> {
  const platforms = [...new Map(args.targets.map((t) => [t.platform, t])).values()];
  const spec = platforms.map((t) => ({
    platform: t.platform,
    name: PLATFORMS[t.platform].name,
    maxCharacters: textLimitFor(t.platform, t.settings),
    style: STYLE[t.platform],
    format: t.format,
  }));

  const ask = async (only: typeof spec, extra = "") => {
    const res = await openai().chat.completions.create({
      model: model(),
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: `You adapt one social media post for several platforms. ${HUMAN_VOICE}
Stay well under each platform's maxCharacters (aim for 90% or less). ${extra}`,
        },
        {
          role: "user",
          content: JSON.stringify({
            originalPost: args.text,
            tone: args.tone || "same as the original",
            attachedMedia: args.mediaSummary || "none",
            platforms: only,
          }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "adaptations",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["posts"],
            properties: {
              posts: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["platform", "text", "notes"],
                  properties: {
                    platform: { type: "string", enum: only.map((s) => s.platform) },
                    text: { type: "string" },
                    notes: { type: "string", description: "One short line on what you changed, or empty." },
                  },
                },
              },
            },
          },
        },
      },
    });
    const content = res.choices[0]?.message?.content;
    if (!content) throw new HttpError(502, "The AI returned an empty response.");
    return (JSON.parse(content) as { posts: Adaptation[] }).posts;
  };

  const first = await ask(spec);
  const result = new Map(first.map((p) => [p.platform, p]));

  // One repair pass for anything that came back too long.
  const tooLong = spec.filter((s) => {
    const p = result.get(s.platform);
    return !p || PLATFORMS[s.platform].capabilities.countText(p.text) > s.maxCharacters;
  });
  if (tooLong.length) {
    const fixed = await ask(tooLong, "Previous versions were too long. Be much shorter this time.");
    for (const p of fixed) result.set(p.platform, p);
  }

  return spec.map((s) => {
    const p = result.get(s.platform);
    return { platform: s.platform, text: p?.text ?? args.text, notes: p?.notes || undefined };
  });
}

/** Free-form assistant: rewrite, shorten, add hashtags, brainstorm hooks... */
export async function assist(args: { instruction: string; text: string; platform?: Platform }): Promise<string> {
  const limit = args.platform ? `It is for ${PLATFORMS[args.platform].name} (max ${PLATFORMS[args.platform].capabilities.textLimit} characters).` : "";
  const res = await openai().chat.completions.create({
    model: model(),
    temperature: 0.8,
    messages: [
      {
        role: "system",
        content: `You help a creator write social media posts. ${HUMAN_VOICE} ${limit}
Reply with only the requested text, no preamble.`,
      },
      { role: "user", content: `Instruction: ${args.instruction}\n\nCurrent text:\n${args.text || "(empty)"}` },
    ],
  });
  return res.choices[0]?.message?.content?.trim() ?? "";
}
