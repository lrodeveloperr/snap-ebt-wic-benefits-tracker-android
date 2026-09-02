# Logic Engine Review Checklist

Reviewed against the canonical `app.html` source and the Android-embedded copy generated in `src/appHtml.ts`.

## State and persistence

- [x] Critical writes update in-memory state only after durable commit succeeds.
- [x] Concurrent writes use the revision captured when each operation begins; stale writes are rejected instead of overwriting newer state.
- [x] Checkout has a single in-flight guard and carries its starting revision through the final commit.
- [x] Privacy and program-jurisdiction changes wait for a successful commit before the UI advances.
- [x] Reminder permission state survives canonicalization, legacy migration, persistence, and Android reconciliation.
- [x] History imports atomically merge useful suggestions without erasing shopping recents; later undo/delete never erase the user's learned suggestion cache.
- [x] Draft writes remain recoverable and surface storage failure without discarding the visible draft.

## Onboarding and navigation

- [x] Legal acceptance is required and versioned.
- [x] Benefit selection is explicit; card and budget management remain continuous Home actions rather than one-time onboarding fields.
- [x] Shopping is gated until a usable funding source or Cash budget exists.
- [x] Home, Shop, and History routes preserve in-progress baskets and do not silently complete transactions.

## Grocery entry and barcode flow

- [x] SNAP, Cash, or WIC is chosen before scanning or manual entry.
- [x] Every scan path returns matched, new, invalid, cancelled, or unavailable feedback.
- [x] Unknown valid UPC/GTIN values enter the explicit local-learning flow; the app does not claim a universal bundled product lookup.
- [x] New barcode mappings are learned only in the same successful commit that adds the item.
- [x] A known barcode cannot overwrite the unit selected by a non-dollar WIC inventory line.
- [x] Store and grocery suggestions remain closed until typing and prioritize prefix/contiguous matches.
- [x] Changing quantity units clears the old quantity so it cannot be reinterpreted silently.
- [x] Changing unit-price versus line-total mode clears the old price so it cannot be reinterpreted silently.
- [x] Numeric fields use the shared keypad and strict locale-aware parsing.

## Checkout and ledgers

- [x] Checkout recomputes its plan from the current basket, balances, benefit availability, and transaction date.
- [x] SNAP, WIC, split, and Cash totals are validated before any ledger mutation.
- [x] Insufficient or retired sources block checkout without changing input state.
- [x] Cash is applied to the current or matching archived budget period only.
- [x] WIC quantity conversion, brand constraints, expiry, start date, and partial remainder rules are enforced.
- [x] Add & Next blocks every invalid candidate item immediately instead of deferring non-balance errors to checkout.
- [x] Partial non-dollar WIC purchases retain Cash/SNAP remainder choices in both entry and History correction.
- [x] A successful checkout deducts each source once and creates one History transaction.

## History, correction, and void

- [x] Voids restore SNAP, WIC, and Cash atomically and cannot be applied twice.
- [x] Corrections reverse the original allocation before validating the replacement.
- [x] A missing historical Cash period blocks correction instead of silently leaving Cash charged.
- [x] Removing the final Cash allocation clears the transaction's Cash-period link.
- [x] Imported History remains immutable through both correction entry points.
- [x] WIC reversal cannot restore more than the allowance's recorded starting quantity.
- [x] Recorded program jurisdiction and transaction provenance survive later settings changes.

## Budgets, reminders, saved baskets, and localization

- [x] Long-idle weekly, biweekly, monthly, and custom budgets advance directly to the active period.
- [x] A long-idle positive remainder creates one rollover decision, not one prompt per missed period.
- [x] Cash amount-only edits preserve the current period; timing edits create a new archived period.
- [x] New WIC periods close overlapping or no-expiry inventory before adding replacement inventory.
- [x] Future WIC expiry dates participate in native reminder opt-in and reconciliation.
- [x] Saved baskets can be created independently, loaded without retained funding, merged, replaced, and undone safely.
- [x] Basket replacement undo is visible on both Saved Baskets and Shop.
- [x] English and Puerto Rican Spanish message keys and grocery catalogs have full parity.
- [x] Every grocery catalog entry has a valid shopping category and no removed nutrition-tagging fields.
- [x] Android bridge copy, scanner formats, reminder plumbing, and embedded HTML digest are verified.

## Automated proof

- [x] 67 core regression tests pass.
- [x] TypeScript typecheck passes.
- [x] Canonical/embedded Android source verification passes.
- [x] Native Android manifest and Gradle verification passes for the generated QA build configuration.
