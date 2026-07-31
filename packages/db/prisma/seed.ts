import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type SeedDestination = {
  city: string;
  country: string;
  airportCode: string;
  isBeach?: boolean;
  isExoticShortlist?: boolean;
  hasGoodPublicTransit?: boolean;
  avgTempByMonthC?: number[];
  beachLat?: number;
  beachLng?: number;
  notes?: string;
};

/** ~15 curated destinations covering budget, beach, and exotic slots */
const destinations: SeedDestination[] = [
  // Budget / general candidates
  {
    city: "Austin",
    country: "United States",
    airportCode: "AUS",
    hasGoodPublicTransit: false,
    notes: "Live music, BBQ, and Hill Country day trips.",
  },
  {
    city: "Denver",
    country: "United States",
    airportCode: "DEN",
    hasGoodPublicTransit: true,
    notes: "Rocky Mountain day trips and craft beer scene.",
  },
  {
    city: "Chicago",
    country: "United States",
    airportCode: "ORD",
    hasGoodPublicTransit: true,
    notes: "Architecture, deep-dish, and lakefront walks.",
  },
  {
    city: "Mexico City",
    country: "Mexico",
    airportCode: "MEX",
    hasGoodPublicTransit: true,
    isExoticShortlist: true,
    notes: "World-class food, museums, and neighborhoods.",
  },
  {
    city: "Montreal",
    country: "Canada",
    airportCode: "YUL",
    hasGoodPublicTransit: true,
    notes: "French-Canadian culture, bagels, and festivals.",
  },
  {
    city: "Las Vegas",
    country: "United States",
    airportCode: "LAS",
    hasGoodPublicTransit: false,
    notes: "Neon nights and nearby Red Rock hiking.",
  },

  // Beach escape candidates (warm months + beach coords)
  {
    city: "Cancún",
    country: "Mexico",
    airportCode: "CUN",
    isBeach: true,
    hasGoodPublicTransit: false,
    avgTempByMonthC: [24, 25, 26, 28, 29, 30, 30, 30, 29, 28, 26, 25],
    beachLat: 21.1325,
    beachLng: -86.7469,
    notes: "Caribbean turquoise water and resort strip.",
  },
  {
    city: "Miami",
    country: "United States",
    airportCode: "MIA",
    isBeach: true,
    hasGoodPublicTransit: false,
    avgTempByMonthC: [20, 21, 22, 24, 26, 28, 29, 29, 28, 26, 23, 21],
    beachLat: 25.7907,
    beachLng: -80.13,
    notes: "South Beach Art Deco and Cuban food.",
  },
  {
    city: "San Juan",
    country: "Puerto Rico",
    airportCode: "SJU",
    isBeach: true,
    isExoticShortlist: true,
    hasGoodPublicTransit: false,
    avgTempByMonthC: [25, 25, 26, 27, 28, 28, 29, 29, 29, 28, 27, 26],
    beachLat: 18.4575,
    beachLng: -66.0725,
    notes: "Old San Juan plus Condado beach days.",
  },
  {
    city: "Honolulu",
    country: "United States",
    airportCode: "HNL",
    isBeach: true,
    isExoticShortlist: true,
    hasGoodPublicTransit: true,
    avgTempByMonthC: [23, 23, 24, 24, 25, 26, 27, 27, 27, 26, 25, 24],
    beachLat: 21.2766,
    beachLng: -157.8274,
    notes: "Waikiki shoreline and Diamond Head hike.",
  },
  {
    city: "Lisbon",
    country: "Portugal",
    airportCode: "LIS",
    isBeach: true,
    isExoticShortlist: true,
    hasGoodPublicTransit: true,
    avgTempByMonthC: [12, 13, 14, 15, 18, 21, 23, 23, 22, 18, 15, 13],
    beachLat: 38.678,
    beachLng: -9.337,
    notes: "Cascais and Costa da Caparica day beaches.",
  },

  // Exotic adventure shortlist
  {
    city: "Reykjavík",
    country: "Iceland",
    airportCode: "KEF",
    isExoticShortlist: true,
    hasGoodPublicTransit: false,
    notes: "Geothermal pools, waterfalls, and lava fields.",
  },
  {
    city: "Tokyo",
    country: "Japan",
    airportCode: "NRT",
    isExoticShortlist: true,
    hasGoodPublicTransit: true,
    notes: "Neon alleys, temples, and train culture.",
  },
  {
    city: "Marrakech",
    country: "Morocco",
    airportCode: "RAK",
    isExoticShortlist: true,
    hasGoodPublicTransit: false,
    notes: "Souks, riads, and Atlas Mountain day trips.",
  },
  {
    city: "Cape Town",
    country: "South Africa",
    airportCode: "CPT",
    isBeach: true,
    isExoticShortlist: true,
    hasGoodPublicTransit: false,
    avgTempByMonthC: [22, 22, 21, 18, 16, 14, 13, 14, 15, 17, 19, 21],
    beachLat: -33.951,
    beachLng: 18.377,
    notes: "Table Mountain, winelands, and Camps Bay.",
  },
];

async function main() {
  console.log("Seeding destinations...");

  await prisma.order.deleteMany();
  await prisma.destinationPackage.deleteMany();
  await prisma.tripSearch.deleteMany();
  await prisma.destination.deleteMany();

  for (const d of destinations) {
    await prisma.destination.create({
      data: {
        city: d.city,
        country: d.country,
        airportCode: d.airportCode,
        isBeach: d.isBeach ?? false,
        isExoticShortlist: d.isExoticShortlist ?? false,
        hasGoodPublicTransit: d.hasGoodPublicTransit ?? true,
        avgTempByMonthC: d.avgTempByMonthC ?? undefined,
        beachLat: d.beachLat,
        beachLng: d.beachLng,
        notes: d.notes,
      },
    });
  }

  console.log(`Seeded ${destinations.length} destinations.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
