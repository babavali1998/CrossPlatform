import { db } from "@/lib/db";
import { withUser } from "@/lib/api";
import { serializeAccount } from "@/lib/accounts";

export const GET = withUser(async (userId) => {
  const accounts = await db.socialAccount.findMany({ where: { userId, status: { not: "REVOKED" } },orderBy: { createdAt: "asc" } });
  return { accounts: accounts.map(serializeAccount) };
});
