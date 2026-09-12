import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { googleConfigured } from "@/lib/env";

/**
 * Google OAuth single sign-on, per the spec's "3-second unified signup".
 *
 * Database sessions (not JWT) because the role flag has to be revocable the
 * instant Stripe demotes an account. A JWT would keep asserting isTrainer=true
 * until it expired, which on a platform holding escrowed money is not
 * acceptable - a suspended trainer could keep taking bookings.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: googleConfigured
    ? [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID!,
          clientSecret: process.env.AUTH_GOOGLE_SECRET!,
          allowDangerousEmailAccountLinking: false,
        }),
      ]
    : [],
  pages: { signIn: "/signin" },
  callbacks: {
    async session({ session, user }) {
      // Read the role from the database on every request rather than trusting
      // anything cached in the session row.
      const fresh = await prisma.user.findUnique({
        where: { id: user.id },
        select: { isTrainer: true, username: true, stripeAccountId: true },
      });
      session.user.id = user.id;
      session.user.isTrainer = fresh?.isTrainer ?? false;
      session.user.username = fresh?.username ?? null;
      session.user.hasStripeAccount = Boolean(fresh?.stripeAccountId);
      return session;
    },
  },
});
