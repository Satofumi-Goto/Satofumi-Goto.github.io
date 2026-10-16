# Live Mission simulator integration — NOT deployed

Target: existing Base44 app 6acfedb5dd6666c1c77ecaa1, https://mobility-lab-flow.base44.app/.

src/App.jsx and src/components/Layout.jsx in this directory are the prepared four-mission integration source copied from federation-portal main's integrations/mobility-live-mission on 2026-10-16. PR #19 is merged. These are NOT a verified export of the current Base44 app and must be diff-applied against fresh Base44 source, preserving concurrent edits. This directory remains a partial source archive, not a deployable complete app. GitHub changes here do not automatically update Base44.

Four missions: service, sharing (pooling + cargo together), city, control. Before/After panels use existing engine, touchpoint and sharingRoutes modules. Settings are shared with the Federation mission host. Federation runtime host components remain required; do not delete them or revert Runtime.

Pending: latest Base44 source reconciliation, full simulator build, financial checks, all four mission E2E, viewport and linked settings verification, Base44 save and Publish. Existing validation of prior integration is not proof of deployed simulator behavior.

CLI authentication attempt was blocked by execution-environment network policy on app.base44.com:443. Browser tab attachment also timed out. No Base44 save or publish is claimed.

Base44 AI chat/generation/fix prohibited. Existing simulator only; no second application. Do not increase browser tabs.
