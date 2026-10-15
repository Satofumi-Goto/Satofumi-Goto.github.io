# Canonical simulator

The only active simulator is the existing Base44 application `6acfedb5dd6666c1c77ecaa1`, published at https://mobility-lab-flow.base44.app/planning .

This directory records the changed Base44 source files, not a second deployable application or a complete export. Existing dependencies and other pages remain in Base44. GitHub synchronization is manual, not automatic.

`Planning.jsx` integrates regional map replay, bounded goal search, six stress cases, commercial thresholds and JSON evidence into the existing parking comparison. Candidate application updates the same city and parking inputs. Customer channels and passenger/cargo comparisons remain intact. The calculation source is `sharingRoutes.js`; the former regional-demo engine is retired from the portal entry.

Prices and demand are editable hypotheses. Real GSI map backgrounds do not provide real road routing or measured demand. Search covers a bounded grid. Parking and pooling retain their respective existing model scopes; their benefits are not added together.

Validation: JSX transpilation; 16 parking regression checks; 18 sharing regression checks. The two source files must be updated in Base44 together, saved, previewed and published. Changes to public entry points must follow successful publication.

## Completed map and booking integration

The parking-location editor supports pointer dragging, map clicking and keyboard-accessible selects. Two distinct staging nodes and the night service node are persisted in each shared city input. Placements snap to the existing synthetic road graph, never imply actual-road routing. The parking engine uses these locations in forecast allocation, dispatch, idle cruising and night travel. Every outcome now includes the booking ID, release time, origin/destination and terminal status. The replay traces one booking through dispatch/pickup/completion and compares that same booking across all four modes. Completed fares reconcile to aggregate revenue; fixed costs are not allocated as per-booking profit.

Validated: JSX transpilation; all 16 parking and 18 sharing regressions; moving staging changes pickups, moving the night site changes only night-consolidation travel, complete request trace and revenue reconciliation, duplicate staging-node rejection. Browser verified drag from Residential N to Central Station, recalculation, served/unserved booking selection and jump to completion. Base44 publication completed; source files here reflect the saved integration.
