# Portfolio numbers from the simulator

Indices (inputs) are maintained by hand in Federation. Calculated values come from the
simulator's project-finance engine; Federation delivers its output as `simulation-results.json`.

`run.py` rewrites the changed numbers in the English portfolio PDFs: the Toyota / Woven version
at the site root and the version under `/portfolio/` (also linked from `/capabilities/`).
Only digit glyphs are exchanged inside the existing text; a rewrite that would change the number
of characters, a sign, a glyph width or need a glyph missing from the embedded font is refused.
`verify_layout.py` then requires identical page count, character positions and fonts, the planned
text change and no pixel change outside the rewritten digits. If any check fails the previous PDFs
are kept.

- `published-values.json`: the numbers the PDFs currently show.
- `bootstrap-values.json`: the numbers the PDFs showed before this mechanism (2026-10-15D).
- CI (`.github/workflows/portfolio-numbers.yml`): `run.py --check` and the layout gate `gate.sh`.
