# Mystery Trips — Product Spec

## What it does

A user enters an **approved** home airport (from the curated destination list),
travel dates, and number of travelers. The system returns **three trip packages**
(one per category). Matching only considers destinations with reviewed profiles
(`profileStatus: APPROVED`). Matching streams each card as soon as that slot’s
cheapest city is ready. “Show 3 more” re-queries the next-cheapest city per
category (excluding cities already shown), up to two reshuffles.

| Slot | Rule |
|---|---|
| **Budget Getaway** | Cheapest **direct** round-trip from home + hotel (3★+). |
| **Beach Escape** | Warm beach city; hotel (3★+) within ~5 minutes' walk of the beach. |
| **Exotic Adventure** | Cheapest from a curated exotic shortlist; hotel 3★+. |

Each package gets an AI day-by-day itinerary on the trip detail page (not during search).
The user picks one package, checks out with a card, and can log back in later for history.

**Pricing**: `(flight + hotel) × (1 + assembly fee)`.
Assembly fee is 5–10% (default 8%) — our entire margin.

## Out of scope (this build)

Mobile app, standalone marketing site, browsing destinations directly,
loyalty/saved searches/price alerts.
