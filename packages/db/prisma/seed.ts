import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, ProfileStatus } from "@prisma/client";

const prisma = new PrismaClient();

type AirportSeed = { code: string; lat?: number; lng?: number };

function loadAirportCoords(): Map<string, { lat: number; lng: number }> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const file = path.join(root, "apps/web/data/airports.json");
  try {
    const list = JSON.parse(readFileSync(file, "utf8")) as AirportSeed[];
    const map = new Map<string, { lat: number; lng: number }>();
    for (const a of list) {
      if (a.lat != null && a.lng != null) {
        map.set(a.code.toUpperCase(), { lat: a.lat, lng: a.lng });
      }
    }
    return map;
  } catch {
    console.warn("airports.json missing — seed will omit airportLat/Lng");
    return new Map();
  }
}

type SeedDestination = {
  city: string;
  country: string;
  airportCode: string;
  isBeach?: boolean;
  isExoticShortlist?: boolean;
  hasGoodPublicTransit?: boolean;
  /** Primary vibe tags — matching reads these. */
  vibeTags?: string[];
  avgTempByMonthC?: number[];
  notes?: string;
  /** Primary stay-area center (migrated from beachLat/beachLng or downtown approx). */
  stayArea: {
    name: string;
    lat: number;
    lng: number;
    blurb: string;
  };
  activities?: Array<{
    name: string;
    description: string;
    category?: string;
  }>;
};

function vibesFor(d: SeedDestination): string[] {
  if (d.vibeTags?.length) return d.vibeTags;
  const tags = new Set<string>(["URBAN"]);
  if (d.isBeach) tags.add("BEACH");
  if (d.isExoticShortlist) tags.add("EXOTIC");
  return [...tags];
}

/**
 * Existing curated set — seeded APPROVED with StayArea so local matching works
 * before the LLM profile pipeline re-researches them. The ~150 North American
 * metro list lands in a later seed pass as DRAFT rows.
 */
const destinations: SeedDestination[] = [
  {
    city: "Austin",
    country: "United States",
    airportCode: "AUS",
    hasGoodPublicTransit: false,
    notes: "Live music, BBQ, and Hill Country day trips.",
    vibeTags: ["URBAN", "NIGHTLIFE", "FOODIE", "ARTS_CULTURE"],
    stayArea: {
      name: "South Congress",
      lat: 30.2505,
      lng: -97.749,
      blurb:
        "Walkable stretch of indie shops, tacos, and live music just south of downtown — the classic Austin base.",
    },
    activities: [
      {
        name: "South Congress Avenue stroll",
        description: "Browse boutiques and grab a breakfast taco before the day heats up.",
        category: "sight",
      },
      {
        name: "Barton Springs Pool",
        description: "Cool off in spring-fed water under the oaks at Zilker Park.",
        category: "activity",
      },
    ],
  },
  {
    city: "Denver",
    country: "United States",
    airportCode: "DEN",
    hasGoodPublicTransit: true,
    notes: "Rocky Mountain day trips and craft beer scene.",
    vibeTags: ["URBAN", "MOUNTAIN", "NATURE", "FOODIE"],
    stayArea: {
      name: "LoDo / Union Station",
      lat: 39.7539,
      lng: -105.0005,
      blurb:
        "Warehouse lofts around Union Station put you on the rail line for downtown eats and mountain day trips.",
    },
  },
  {
    city: "Chicago",
    country: "United States",
    airportCode: "ORD",
    hasGoodPublicTransit: true,
    notes: "Architecture, deep-dish, and lakefront walks.",
    vibeTags: ["URBAN", "FOODIE", "ARTS_CULTURE", "HISTORIC"],
    stayArea: {
      name: "River North",
      lat: 41.8925,
      lng: -87.634,
      blurb:
        "Galleries, restaurants, and riverwalk access with the Loop and Magnificent Mile a short walk away.",
    },
  },
  {
    city: "Mexico City",
    country: "Mexico",
    airportCode: "MEX",
    hasGoodPublicTransit: true,
    isExoticShortlist: true,
    notes: "World-class food, museums, and neighborhoods.",
    vibeTags: ["URBAN", "FOODIE", "EXOTIC", "ARTS_CULTURE", "HISTORIC"],
    stayArea: {
      name: "Roma Norte",
      lat: 19.4194,
      lng: -99.1626,
      blurb:
        "Tree-lined streets packed with cafés, galleries, and some of the city's best restaurants.",
    },
  },
  {
    city: "Montreal",
    country: "Canada",
    airportCode: "YUL",
    hasGoodPublicTransit: true,
    notes: "French-Canadian culture, bagels, and festivals.",
    vibeTags: ["URBAN", "FOODIE", "HISTORIC", "ARTS_CULTURE"],
    stayArea: {
      name: "Old Montreal",
      lat: 45.5048,
      lng: -73.5535,
      blurb:
        "Cobblestone streets, waterfront promenades, and European cafés in the historic core.",
    },
  },
  {
    city: "Las Vegas",
    country: "United States",
    airportCode: "LAS",
    hasGoodPublicTransit: false,
    notes: "Neon nights and nearby Red Rock hiking.",
    vibeTags: ["URBAN", "NIGHTLIFE", "ADVENTURE", "NATURE"],
    stayArea: {
      name: "Las Vegas Strip",
      lat: 36.1147,
      lng: -115.1728,
      blurb:
        "The neon corridor of resorts, shows, and restaurants — the classic Vegas tourist base.",
    },
  },
  {
    city: "Cancún",
    country: "Mexico",
    airportCode: "CUN",
    isBeach: true,
    hasGoodPublicTransit: false,
    avgTempByMonthC: [24, 25, 26, 28, 29, 30, 30, 30, 29, 28, 26, 25],
    notes: "Caribbean turquoise water and resort strip.",
    vibeTags: ["BEACH", "NIGHTLIFE", "FAMILY_FRIENDLY", "ROMANTIC"],
    stayArea: {
      name: "Zona Hotelera",
      lat: 21.1325,
      lng: -86.7469,
      blurb:
        "Beachfront hotel zone with Caribbean water steps from your door and nightlife nearby.",
    },
  },
  {
    city: "Miami",
    country: "United States",
    airportCode: "MIA",
    isBeach: true,
    hasGoodPublicTransit: false,
    avgTempByMonthC: [20, 21, 22, 24, 26, 28, 29, 29, 28, 26, 23, 21],
    notes: "South Beach Art Deco and Cuban food.",
    vibeTags: ["BEACH", "URBAN", "NIGHTLIFE", "FOODIE"],
    stayArea: {
      name: "South Beach",
      lat: 25.7907,
      lng: -80.13,
      blurb:
        "Art Deco hotels, Ocean Drive, and the beach a block away — Miami's postcard neighborhood.",
    },
  },
  {
    city: "San Juan",
    country: "Puerto Rico",
    airportCode: "SJU",
    isBeach: true,
    isExoticShortlist: true,
    hasGoodPublicTransit: false,
    avgTempByMonthC: [25, 25, 26, 27, 28, 28, 29, 29, 29, 28, 27, 26],
    notes: "Old San Juan plus Condado beach days.",
    vibeTags: ["BEACH", "HISTORIC", "FOODIE", "EXOTIC"],
    stayArea: {
      name: "Condado",
      lat: 18.4575,
      lng: -66.0725,
      blurb:
        "Beach hotels between Old San Juan and Isla Verde — walkable and lively without being remote.",
    },
  },
  {
    city: "Honolulu",
    country: "United States",
    airportCode: "HNL",
    isBeach: true,
    isExoticShortlist: true,
    hasGoodPublicTransit: true,
    avgTempByMonthC: [23, 23, 24, 24, 25, 26, 27, 27, 27, 26, 25, 24],
    notes: "Waikiki shoreline and Diamond Head hike.",
    vibeTags: ["BEACH", "NATURE", "ADVENTURE", "EXOTIC", "FAMILY_FRIENDLY"],
    stayArea: {
      name: "Waikiki",
      lat: 21.2766,
      lng: -157.8274,
      blurb:
        "Iconic beachfront with Diamond Head views, boardwalk energy, and easy transit into Honolulu.",
    },
  },
  {
    city: "Lisbon",
    country: "Portugal",
    airportCode: "LIS",
    isBeach: true,
    isExoticShortlist: true,
    hasGoodPublicTransit: true,
    avgTempByMonthC: [12, 13, 14, 15, 18, 21, 23, 23, 22, 18, 15, 13],
    notes: "Cascais and Costa da Caparica day beaches.",
    vibeTags: ["BEACH", "HISTORIC", "FOODIE", "EXOTIC", "ROMANTIC"],
    stayArea: {
      name: "Cascais",
      lat: 38.6979,
      lng: -9.4215,
      blurb:
        "Coastal town west of Lisbon with beaches, seafood, and an easy train into the city.",
    },
  },
  {
    city: "Reykjavík",
    country: "Iceland",
    airportCode: "KEF",
    isExoticShortlist: true,
    hasGoodPublicTransit: false,
    notes: "Geothermal pools, waterfalls, and lava fields.",
    vibeTags: ["NATURE", "ADVENTURE", "EXOTIC", "WELLNESS"],
    stayArea: {
      name: "Downtown Reykjavík",
      lat: 64.1466,
      lng: -21.9426,
      blurb:
        "Compact downtown for museums, hot dogs, and tour pickups to the Golden Circle and Blue Lagoon.",
    },
  },
  {
    city: "Tokyo",
    country: "Japan",
    airportCode: "NRT",
    isExoticShortlist: true,
    hasGoodPublicTransit: true,
    notes: "Neon alleys, temples, and train culture.",
    vibeTags: ["URBAN", "FOODIE", "EXOTIC", "ARTS_CULTURE", "NIGHTLIFE"],
    stayArea: {
      name: "Shinjuku",
      lat: 35.6938,
      lng: 139.7034,
      blurb:
        "Transit hub with neon nights, endless ramen, and rail access to the rest of Tokyo.",
    },
  },
  {
    city: "Marrakech",
    country: "Morocco",
    airportCode: "RAK",
    isExoticShortlist: true,
    hasGoodPublicTransit: false,
    notes: "Souks, riads, and Atlas Mountain day trips.",
    vibeTags: ["HISTORIC", "EXOTIC", "FOODIE", "ADVENTURE"],
    stayArea: {
      name: "Medina",
      lat: 31.6295,
      lng: -7.9811,
      blurb:
        "Riads inside the ancient walls — souks, squares, and rooftop dinners a short walk away.",
    },
  },
  {
    city: "Cape Town",
    country: "South Africa",
    airportCode: "CPT",
    isBeach: true,
    isExoticShortlist: true,
    hasGoodPublicTransit: false,
    avgTempByMonthC: [22, 22, 21, 18, 16, 14, 13, 14, 15, 17, 19, 21],
    notes: "Table Mountain, winelands, and Camps Bay.",
    vibeTags: ["BEACH", "NATURE", "ADVENTURE", "EXOTIC", "FOODIE"],
    stayArea: {
      name: "Camps Bay",
      lat: -33.951,
      lng: 18.377,
      blurb:
        "Palm-lined beach under the Twelve Apostles — sunset walks and Table Mountain nearby.",
    },
  },
];

async function main() {
  console.log("Seeding destinations…");

  await prisma.order.deleteMany();
  await prisma.destinationPackage.deleteMany();
  await prisma.tripSearch.deleteMany();
  await prisma.slotMatchCache.deleteMany();
  await prisma.destinationActivity.deleteMany();
  await prisma.stayArea.deleteMany();
  await prisma.discoveryWaitlist.deleteMany();
  await prisma.destination.deleteMany();

  const airportCoords = loadAirportCoords();
  const now = new Date();
  for (const d of destinations) {
    const vibeTags = vibesFor(d);
    const coords = airportCoords.get(d.airportCode.toUpperCase());
    await prisma.destination.create({
      data: {
        city: d.city,
        country: d.country,
        airportCode: d.airportCode,
        isBeach: d.isBeach ?? vibeTags.includes("BEACH"),
        isExoticShortlist:
          d.isExoticShortlist ?? vibeTags.includes("EXOTIC"),
        hasGoodPublicTransit: d.hasGoodPublicTransit ?? true,
        vibeTags,
        airportLat: coords?.lat,
        airportLng: coords?.lng,
        avgTempByMonthC: d.avgTempByMonthC ?? undefined,
        notes: d.notes,
        profileStatus: ProfileStatus.APPROVED,
        profiledAt: now,
        reviewedAt: now,
        reviewedBy: "seed",
        stayAreas: {
          create: {
            name: d.stayArea.name,
            lat: d.stayArea.lat,
            lng: d.stayArea.lng,
            blurb: d.stayArea.blurb,
            isPrimary: true,
            activities: {
              create: (d.activities ?? []).map((a) => ({
                name: a.name,
                description: a.description,
                category: a.category,
              })),
            },
          },
        },
      },
    });
  }

  console.log(`Seeded ${destinations.length} APPROVED destinations with StayAreas.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
