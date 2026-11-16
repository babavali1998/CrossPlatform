import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { currentUserId } from "@/lib/session";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Handler<Ctx> = (userId: string, req: Request, ctx: Ctx) => Promise<Response | unknown>;

/** Wraps a route handler with auth and consistent JSON error handling. */
export function withUser<Ctx = unknown>(handler: Handler<Ctx>) {
  return async (req: Request, ctx: Ctx) => {
    try {
      const userId = await currentUserId();
      if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
      const result = await handler(userId, req, ctx);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) {
        const extra = "issues" in err ? { issues: (err as { issues: unknown }).issues } : {};
        return NextResponse.json({ error: err.message, ...extra }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return NextResponse.json({ error: "Invalid request", issues: err.issues }, { status: 400 });
      }
      console.error("[api]", err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  };
}
