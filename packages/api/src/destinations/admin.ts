import { prisma, ProfileStatus } from "@mystery-trips/db";
import { airportCoordsForCode } from "./discover/airports";
import { profileDestination } from "./profile";
import { legacyFlagsFromVibes, normalizeVibeTags } from "./vibes";

export function listPendingReview() {
  return prisma.destination.findMany({
    where: { profileStatus: ProfileStatus.PENDING_REVIEW },
    include: {
      stayAreas: {
        where: { isPrimary: true },
        include: { activities: true },
        take: 1,
      },
    },
    orderBy: { profiledAt: "asc" },
  });
}

export function listDestinationsAdmin(status?: ProfileStatus) {
  return prisma.destination.findMany({
    where: status ? { profileStatus: status } : undefined,
    include: {
      stayAreas: {
        where: { isPrimary: true },
        include: { activities: { take: 8 } },
        take: 1,
      },
    },
    orderBy: [{ profileStatus: "asc" }, { city: "asc" }],
  });
}

/** Full destination profile for admin detail view — every stay area + activity + images. */
export function getDestinationAdmin(id: string) {
  return prisma.destination.findUnique({
    where: { id },
    include: {
      stayAreas: {
        orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
        include: {
          activities: { orderBy: [{ category: "asc" }, { name: "asc" }] },
        },
      },
      images: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });
}

export async function updateDestinationVibeTags(
  id: string,
  rawTags: string[],
) {
  const vibeTags = normalizeVibeTags(rawTags);
  const flags = legacyFlagsFromVibes(vibeTags);
  return prisma.destination.update({
    where: { id },
    data: {
      vibeTags,
      isBeach: flags.isBeach,
      isExoticShortlist: flags.isExoticShortlist,
    },
  });
}

export async function approveDestination(
  id: string,
  reviewedBy: string,
  vibeTags?: string[],
) {
  const vibeData =
    vibeTags !== undefined
      ? (() => {
          const tags = normalizeVibeTags(vibeTags);
          const flags = legacyFlagsFromVibes(tags);
          return {
            vibeTags: tags,
            isBeach: flags.isBeach,
            isExoticShortlist: flags.isExoticShortlist,
          };
        })()
      : {};

  return prisma.destination.update({
    where: { id },
    data: {
      profileStatus: ProfileStatus.APPROVED,
      reviewedAt: new Date(),
      reviewedBy,
      ...vibeData,
    },
  });
}

export async function rejectDestination(
  id: string,
  reviewedBy: string,
) {
  return prisma.destination.update({
    where: { id },
    data: {
      profileStatus: ProfileStatus.REJECTED,
      reviewedAt: new Date(),
      reviewedBy,
    },
  });
}

export async function addDestinationDraft(input: {
  city: string;
  country: string;
  airportCode: string;
  isBeach?: boolean;
  isExoticShortlist?: boolean;
  vibeTags?: string[];
  runProfile?: boolean;
}) {
  const code = input.airportCode.trim().toUpperCase();
  const coords = (() => {
    try {
      return airportCoordsForCode(code);
    } catch {
      return null;
    }
  })();

  const fromFlags = [
    ...(input.isBeach ? ["BEACH"] : []),
    ...(input.isExoticShortlist ? ["EXOTIC"] : []),
  ];
  const vibeTags = normalizeVibeTags([
    ...(input.vibeTags ?? []),
    ...fromFlags,
  ]);
  const flags = legacyFlagsFromVibes(vibeTags);

  const dest = await prisma.destination.create({
    data: {
      city: input.city.trim(),
      country: input.country.trim(),
      airportCode: code,
      airportLat: coords?.lat,
      airportLng: coords?.lng,
      vibeTags,
      isBeach: flags.isBeach,
      isExoticShortlist: flags.isExoticShortlist,
      profileStatus: ProfileStatus.DRAFT,
    },
  });

  if (input.runProfile !== false) {
    return profileDestination(dest.id);
  }
  return dest;
}
