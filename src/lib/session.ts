import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";

/** For pages: returns the signed-in user or redirects to /login. */
export async function requireUser() {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/login");
  const user = await db.user.findUnique({ where: { id } });
  if (!user) redirect("/login");
  return user;
}

/** For route handlers: returns the user id or null. */
export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
