import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      isTrainer: boolean;
      username: string | null;
      hasStripeAccount: boolean;
    } & DefaultSession["user"];
  }
}
