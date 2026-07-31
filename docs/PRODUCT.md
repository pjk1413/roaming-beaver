# Mystery Trips — Product Spec

## What it does

A user enters their home airport, travel dates, and number of travelers. The system
returns **three trip packages** (one per category). Matching streams each card as soon
as that slot’s cheapest city is ready. “Show 3 more” re-queries the next-cheapest
city per category (excluding cities already shown), up to two reshuffles.

| Slot | Rule |
|---|---|
| **Budget Getaway** | Cheapest reasonable round-trip from home + 3★ hotel. Rental car only if transit is poor. |
| **Beach Escape** | Warm beach city; 3★ hotel within ~5 minutes' walk of the beach. |
| **Exotic Adventure** | Cheapest from a curated exotic shortlist. |

Each package gets an AI day-by-day itinerary on the trip detail page (not during search).
The user picks one package, checks out with a card, and can log back in later for history.

**Pricing**: `(flight + hotel + rental car if any) × (1 + assembly fee)`.
Assembly fee is 5–10% (default 8%) — our entire margin.

## Out of scope (this build)

Mobile app, standalone marketing site, browsing destinations directly,
loyalty/saved searches/price alerts.
