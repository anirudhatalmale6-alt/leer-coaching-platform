import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  MAX_PORTFOLIO_LINKS,
  isCategory,
  normaliseBio,
  normaliseInstagram,
  normalisePortfolioLinks,
  normaliseUsername,
  normaliseYouTube,
  parsePriceToCents,
} from "./profile";

/**
 * Reading and writing the trainer profile.
 *
 * Separated from the route handler so the validation order, the uniqueness
 * race, and the portfolio rewrite all live in one place rather than being
 * re-implemented by whatever touches profiles next.
 */

export type ProfileInput = {
  username?: string;
  bio?: string;
  category?: string;
  instagram?: string;
  youtube?: string;
  avatarKey?: string | null;
  price?: string;
  coachingEnabled?: boolean;
  portfolio?: string[];
};

export type SaveResult =
  | { ok: true }
  | { ok: false; errors: Record<string, string>; status: number };

/**
 * Validate everything BEFORE writing anything.
 *
 * A field-by-field "validate then save" loop would leave a half-updated
 * profile behind when the fourth field fails - the trainer sees an error and
 * three of their changes silently stuck.
 */
export async function saveProfile(userId: string, input: ProfileInput): Promise<SaveResult> {
  const errors: Record<string, string> = {};
  const data: Prisma.UserUpdateInput = {};

  if (input.username !== undefined) {
    const check = normaliseUsername(input.username);
    if (!check.ok) errors.username = check.reason;
    else data.username = check.value;
  }

  if (input.bio !== undefined) {
    const check = normaliseBio(input.bio);
    if (!check.ok) errors.bio = check.reason;
    else data.bio = check.value || null;
  }

  if (input.category !== undefined) {
    const value = input.category.trim();
    if (!value) data.category = null;
    else if (!isCategory(value)) errors.category = "Pick one of the listed categories.";
    else data.category = value;
  }

  if (input.instagram !== undefined) {
    const check = normaliseInstagram(input.instagram);
    if (!check.ok) errors.instagram = check.reason;
    else data.instagram = check.value || null;
  }

  if (input.youtube !== undefined) {
    const check = normaliseYouTube(input.youtube);
    if (!check.ok) errors.youtube = check.reason;
    else data.youtube = check.value || null;
  }

  if (input.avatarKey !== undefined) {
    if (input.avatarKey === null || input.avatarKey === "") {
      data.avatarKey = null;
    } else if (!input.avatarKey.startsWith(`avatars/${userId}/`)) {
      // The key comes back from the browser after a direct-to-R2 upload, so it
      // is attacker-controlled. Without this, a trainer could point their
      // avatar at any object in the bucket - including somebody's coaching clip.
      errors.avatarKey = "That image does not belong to you.";
    } else {
      data.avatarKey = input.avatarKey;
    }
  }

  if (input.price !== undefined) {
    const check = parsePriceToCents(input.price);
    if (!check.ok) errors.price = check.reason;
    else data.coachingPriceCents = check.value;
  }

  if (input.coachingEnabled !== undefined) {
    data.coachingEnabled = input.coachingEnabled;
  }

  let portfolio: string[] | null = null;
  if (input.portfolio !== undefined) {
    if (input.portfolio.length > MAX_PORTFOLIO_LINKS * 2) {
      errors.portfolio = `Up to ${MAX_PORTFOLIO_LINKS} links.`;
    } else {
      const check = normalisePortfolioLinks(input.portfolio);
      if (!check.ok) errors.portfolio = check.reason;
      else portfolio = check.value;
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors, status: 422 };

  try {
    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) {
        await tx.user.update({ where: { id: userId }, data });
      }
      if (portfolio) {
        // Replace wholesale rather than diffing: the list is at most five rows,
        // the order is part of the value, and a diff here would be more code
        // than it saves.
        await tx.portfolioLink.deleteMany({ where: { userId } });
        if (portfolio.length) {
          await tx.portfolioLink.createMany({
            data: portfolio.map((url, position) => ({ userId, url, position })),
          });
        }
      }
    });
  } catch (err) {
    // The username unique index is the real arbiter, not the availability check
    // the browser made a moment ago - two people can claim the same handle in
    // the same second and only the database can settle it.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      String(err.meta?.target ?? "").includes("username")
    ) {
      return { ok: false, errors: { username: "That name is already taken." }, status: 409 };
    }
    throw err;
  }

  return { ok: true };
}

/** Is this handle free? Used by the live check next to the username field. */
export async function isUsernameAvailable(username: string, forUserId: string): Promise<boolean> {
  const check = normaliseUsername(username);
  if (!check.ok) return false;
  const existing = await prisma.user.findUnique({
    where: { username: check.value },
    select: { id: true },
  });
  return !existing || existing.id === forUserId;
}

/** Everything the public page renders, in one query. */
export async function getPublicProfile(username: string) {
  return prisma.user.findUnique({
    where: { username: username.toLowerCase() },
    select: {
      id: true,
      name: true,
      image: true,
      username: true,
      bio: true,
      category: true,
      instagram: true,
      youtube: true,
      avatarKey: true,
      isTrainer: true,
      coachingEnabled: true,
      coachingPriceCents: true,
      stripeTransfersStatus: true,
      trainerActiveAt: true,
      portfolioLinks: { orderBy: { position: "asc" }, select: { url: true } },
    },
  });
}
