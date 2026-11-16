import NextAuth, { type NextAuthConfig } from "next-auth";
import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";

/**
 * Sign-in to the CrossPlatform app itself. Social networks are connected
 * separately from the Accounts page; their passwords are never collected.
 */
const providers: Provider[] = [];

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) providers.push(Google);
if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) providers.push(GitHub);

// Local-development sign-in with no OAuth provider configured. Disabled in
// production regardless of the flag.
export const devLoginEnabled =
  process.env.ALLOW_DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";

if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Local dev login",
      credentials: { email: { label: "Email", type: "email" } },
      async authorize(creds) {
        const email = String(creds?.email || "").trim().toLowerCase();
        if (!email || !email.includes("@")) return null;
        const user = await db.user.upsert({
          where: { email },
          update: {},
          create: { email, name: email.split("@")[0] },
        });
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  );
}

const allowed = (process.env.ALLOWED_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(db),
  providers,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  callbacks: {
    signIn({ user }) {
      if (allowed.length === 0) return true;
      return !!user.email && allowed.includes(user.email.toLowerCase());
    },
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid && session.user) session.user.id = token.uid as string;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export const availableLoginProviders = {
  google: !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
  github: !!(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET),
  dev: devLoginEnabled,
};
