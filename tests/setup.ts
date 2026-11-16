import "dotenv/config";
import { vi } from "vitest";

// "server-only" throws outside a React Server Components build.
vi.mock("server-only", () => ({}));

process.env.TOKEN_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
