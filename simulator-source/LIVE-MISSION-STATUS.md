# Live Mission simulator integration — NOT deployed

Target: existing Base44 app 6acfedb5dd6666c1c77ecaa1, https://mobility-lab-flow.base44.app/.

src/App.jsx and src/components/Layout.jsx in this directory are the prepared four-mission integration source copied from federation-portal main's integrations/mobility-live-mission on 2026-10-16. PR #19 is merged. These are NOT a verified export of the current Base44 app and must be diff-applied against fresh Base44 source, preserving concurrent edits. This directory remains a partial source archive, not a deployable complete app. GitHub changes here do not automatically update Base44.

Four missions: service, sharing (pooling + cargo together), city, control. Before/After panels use existing engine, touchpoint and sharingRoutes modules. Settings are shared with the Federation mission host. Federation runtime host components remain required; do not delete them or revert Runtime.

Pending: latest Base44 source reconciliation, full simulator build, financial checks, all four mission E2E, viewport and linked settings verification, Base44 save and Publish. Existing validation of prior integration is not proof of deployed simulator behavior.

CLI authentication attempt was blocked by execution-environment network policy on app.base44.com:443. Browser tab attachment also timed out. No Base44 save or publish is claimed.

Base44 AI chat/generation/fix prohibited. Existing simulator only; no second application. Do not increase browser tabs.

## Source hardening and public verification — 2026-10-18

- Read-only public verification found only city/service Demo links. Both `/demo/sharing` and `/demo/control` retained their URLs but embedded `mission=city`. Four-mission publication is therefore still incomplete.
- The prepared App now keeps the Federation iframe URL stable during locale changes. Both ordinary settings updates and recurring workspace handshakes include the current `ja`/`en` language. The paired Federation listener must validate the simulator parent origin, source window, channel and mode, then apply an allowed language even when the settings revision is unchanged.
- The prepared Layout now uses a bounded flex viewport for Demo pages. It gives the mission the space remaining beneath the actual mobile/desktop navigation instead of assuming a 75px header. Ordinary simulator pages keep their scrolling layout.
- Six isolated archived-source checks pass: both JSX files transpile; each of four mission workspaces preserves its iframe, settings and reported progress across a language switch; handshake language stays current; forged source/origin/mode messages are ignored; the Demo layout and four navigation links are present. The same tests against the prior archived App/Layout fail all five behavior checks, confirming that the regression suite detects these defects.
- These checks use isolated components and a simulated message peer. They do not execute the absent simulation engines, prove full-app bundling, or validate real-browser geometry or deployed behavior. Run from this directory with `npm ci --prefix tests` followed by `npm test --prefix tests`.
- Base44 editor inspection requires sign-in. No fresh export, Base44 source save, financial execution, four-mission E2E or Publish is claimed. Apply only after reconciling against a fresh export of the existing app; keep Planning, regional selection and sharing/cargo changes intact.

