import type { Flight, Hotel } from "@mystery-trips/types";
import { haversineMeters } from "./geo";

/** Soft preferences — tune weights without touching selection logic. */
export const OUTBOUND_IDEAL_HOUR = 8; // 8am
export const RETURN_IDEAL_START = 15; // 3pm
export const RETURN_IDEAL_END = 16; // 4pm
export const FLIGHT_TIME_WEIGHT = 0.15; // max ~15% effective-price penalty

export const HOTEL_IDEAL_METERS = 1500; // walkable core
export const HOTEL_MAX_METERS = 6000; // beyond this, distance stops mattering
export const HOTEL_DISTANCE_WEIGHT = 0.2; // max ~20% effective-price penalty

/** Wall-clock hour from an ISO datetime (supplier local time, not server TZ). */
export function hourOfDay(iso: string): number {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  const d = new Date(iso);
  return d.getHours() + d.getMinutes() / 60;
}

export function outboundTimeScore(hour: number): number {
  if (hour <= OUTBOUND_IDEAL_HOUR) {
    return Math.max(0, 1 - (OUTBOUND_IDEAL_HOUR - hour) * 0.05);
  }
  if (hour <= 12) return 1 - (hour - OUTBOUND_IDEAL_HOUR) * 0.05;
  return Math.max(0, 0.8 - (hour - 12) * 0.15);
}

export function returnTimeScore(hour: number): number {
  if (hour >= RETURN_IDEAL_START && hour <= RETURN_IDEAL_END) return 1;
  if (hour > RETURN_IDEAL_END) {
    return Math.max(0, 1 - (hour - RETURN_IDEAL_END) * 0.08);
  }
  if (hour >= 12) return 1 - (RETURN_IDEAL_START - hour) * 0.06;
  return Math.max(0, 0.5 - (12 - hour) * 0.08);
}

/**
 * Inflate flight price by timing fit. Lower adjusted cents = better pick
 * among offers to the same destination. Does not affect cross-destination
 * ranking (that stays on raw totalCents).
 */
export function flightTimingAdjustedCents(flight: Flight): number {
  const outHour = hourOfDay(flight.outbound[0]!.departAt);
  const retHour = hourOfDay(flight.inbound[0]!.departAt);
  const score = (outboundTimeScore(outHour) + returnTimeScore(retHour)) / 2;
  return Math.round(flight.totalCents * (1 + FLIGHT_TIME_WEIGHT * (1 - score)));
}

export function hotelDistanceScore(distanceMeters: number): number {
  if (distanceMeters <= HOTEL_IDEAL_METERS) return 1;
  if (distanceMeters >= HOTEL_MAX_METERS) return 0;
  return (
    1 -
    (distanceMeters - HOTEL_IDEAL_METERS) /
      (HOTEL_MAX_METERS - HOTEL_IDEAL_METERS)
  );
}

/**
 * Inflate hotel price by distance from city core. Used for Budget / Exotic
 * only — Beach Escape keeps its hard BEACH_WALK_METERS filter.
 */
export function hotelDistanceAdjustedCents(
  hotel: Hotel,
  centerLat: number,
  centerLng: number,
): number {
  const distance = haversineMeters(hotel.lat, hotel.lng, centerLat, centerLng);
  const score = hotelDistanceScore(distance);
  return Math.round(
    hotel.totalCents * (1 + HOTEL_DISTANCE_WEIGHT * (1 - score)),
  );
}
