# Mystery Trips — Product Spec

## What it does

A user enters their home airport, travel dates, and number of travelers. The system
returns exactly **three trip packages**, each a single all-in price:

| Slot | Rule |
|---|---|
| **Budget Getaway** | Cheapest reasonable round-trip flight from the user's home airport, anywhere. Paired with a 3-star hotel. Add a rental car *only if* the destination's public transit is bad. |
| **Beach Escape** | Must be warm and have a beach. Cheapest such option. 3-star hotel within ~5 minutes' walk (~450m) of the beach. No rental car by default. |
| **Exotic Adventure** | Cheapest option that's genuinely novel/fun. Drawn from a curated shortlist. |

Each package includes an AI-generated day-by-day itinerary. The user picks one package,
checks out with a card, and can log back in later to see purchase history.

**Pricing**: `(flight + hotel + rental car if any) × (1 + assembly fee)`.
Assembly fee is 5–10% (default 8%) — our entire margin.

## Out of scope (this build)

Mobile app, standalone marketing site, browsing destinations directly, multiple
hotel/flight options per package, loyalty/saved searches/price alerts.
