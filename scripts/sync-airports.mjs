#!/usr/bin/env node
/**
 * Sync passenger airports from OurAirports (same source AirportDB uses).
 * AirportDB itself only exposes ICAO lookup — not city/IATA search — so we
 * build a local searchable index from the open CSV.
 *
 * Usage: node scripts/sync-airports.mjs
 */
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CSV_URL =
  "https://davidmegginson.github.io/ourairports-data/airports.csv";
const OUT = path.join(ROOT, "apps/web/data/airports.json");
const TMP = path.join(ROOT, "apps/web/data/.airports.csv.tmp");

function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ",") {
      fields.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

async function main() {
  await mkdir(path.dirname(OUT), { recursive: true });
  console.log("Downloading OurAirports CSV…");
  const res = await fetch(CSV_URL);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status}`);
  }
  await pipeline(res.body, createWriteStream(TMP));

  const rl = createInterface({ input: createReadStream(TMP), crlfDelay: Infinity });
  let header = null;
  const idx = {};
  /** @type {Map<string, object>} */
  const byCode = new Map();
  const typeRank = { large_airport: 0, medium_airport: 1 };

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line).map((h) => h.replace(/^"|"$/g, ""));
      header.forEach((h, i) => {
        idx[h] = i;
      });
      continue;
    }
    const row = parseCsvLine(line);
    const type = row[idx.type];
    const iata = (row[idx.iata_code] || "").trim().toUpperCase();
    const icao = (row[idx.icao_code] || row[idx.ident] || "")
      .trim()
      .toUpperCase();
    const name = (row[idx.name] || "").trim();
    const city = (row[idx.municipality] || "").trim();
    const country = (row[idx.iso_country] || "").trim();
    const scheduled = row[idx.scheduled_service];

    if (!iata || iata.length !== 3) continue;
    const isSized = type === "large_airport" || type === "medium_airport";
    if (!isSized && scheduled !== "yes") continue;
    if (!city && !name) continue;

    const airport = {
      code: iata,
      city: city || name,
      name,
      country,
      ...(icao.length === 4 ? { icao } : {}),
      _rank: typeRank[type] ?? 2,
    };

    const prev = byCode.get(iata);
    if (!prev || airport._rank < prev._rank) {
      byCode.set(iata, airport);
    }
  }

  const list = [...byCode.values()]
    .map(({ _rank, ...rest }) => rest)
    .sort(
      (a, b) => a.city.localeCompare(b.city) || a.code.localeCompare(b.code),
    );

  await writeFile(OUT, JSON.stringify(list));
  console.log(`Wrote ${list.length} airports → ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
