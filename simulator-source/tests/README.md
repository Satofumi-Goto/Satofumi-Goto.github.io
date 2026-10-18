# Isolated Live Mission source checks

From `simulator-source`:

```sh
npm ci --prefix tests
npm test --prefix tests
```

The archive is not a complete Base44 application. These tests transpile the
archived JSX and mount the actual workspace/layout component bodies with
isolated dependencies and a simulated message peer. They check iframe identity,
linked settings, reported progress, locale handshakes, origin/source/mode
rejection and the layout's flex-sizing contract. They do not render the browser
layout, run the business engines or replace whole-app and published E2E checks.

Before applying these files to Base44, export the current existing application,
reconcile its changes and verify the paired Federation language listener. The
listener must accept only the existing simulator parent origin and source,
matching mission mode and `ja`/`en` locale. A locale update is independent of the
settings revision and must not navigate the mission iframe.
