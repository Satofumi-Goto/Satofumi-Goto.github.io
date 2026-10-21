# Portfolio numbers from the simulator

Indices (inputs) are maintained by hand in Federation. Calculated values come from the
simulator's project-finance engine; Federation delivers its output as `simulation-results.json`.

`run.py` rewrites the changed numbers in the English portfolio PDF. There is one copy, at the
site root; the top page, `/portfolio/` and `/capabilities/` all link to it.
Only digit glyphs are exchanged inside the existing text; a rewrite that would change the number
of characters, a sign, a glyph width or need a glyph missing from the embedded font is refused.
`verify_layout.py` then requires identical page count, character positions and fonts, the planned
text change and no pixel change outside the rewritten digits. If any check fails the previous PDFs
are kept.

- `published-values.json`: the numbers the PDFs currently show.
- `bootstrap-values.json`: the numbers the PDFs showed before this mechanism (2026-10-15D).
- CI (`.github/workflows/portfolio-numbers.yml`): `run.py --check` and the layout gate `gate.sh`.

## 運用（2026-10-21 管理者決定）

- **英文ポートフォリオの正本は、ポートフォリオサイト（このリポジトリ）に置く Word とする（2026-10-21 管理者決定・固定）。** PDF はその Word に従う。Word がまだ置かれていない間に PDF を直した場合は、同じ変更を Word に入れてから置く。
- 句の差し替え（`tools/text-revision/pdf_text.py`）：表のセルや段落の句を、元の句の幅（またはその右の空白）に収めて書き直す。必要なら横幅だけ縮める（80% まで）。計画は `tools/text-revision/*-plan.json` に残し、`gate.sh` が再現して `verify_text_layout.py` で検査する（他の文字・画素は不変、新しい句は元の枠の中）。

- 英文ポートフォリオの正本は Word（ドキュメント名「Satofumi Goto_Portfolio」、レジュメ部は含めない）。
- Claude がその Word を書き換え、PDF 化して、サイト直下の
  `Autonomous_Mobility_System_Business_Feasibility.pdf` として掲載する。PDF はこの 1 つだけで、
  トップ・`/portfolio/`・`/capabilities/` の 3 ページともここへリンクする。
- ページ崩れは絶対に起こさない。掲載前の合格条件：
  1. ページ数が 16。
  2. 各ページ末尾の「Satofumi Goto」の上端位置（pt、ページ上端から）が次の値と ±0.5 以内で一致。
     P1 は 29.2（ページ上部）、P2 から P16 は
     819.0, 822.2, 822.0, 820.5, 823.4, 824.2, 825.0, 819.2, 820.3, 818.4, 824.0, 822.6, 824.5, 824.6, 825.8。
  3. 書き換えた箇所以外の文字が、前の版と 1 文字ずつ一致。
- Word から PDF への変換は Word で行う（LibreOffice は同じ文書でも位置が最大 36pt ずれるため使わない）。
  Word のある PC がこのセッションに接続されていればそこで変換する。
- 数字だけの更新（シミュレータの結果の反映）は、従来どおり `run.py` で PDF を直接書き換え、
  `verify_layout.py` の全文字・全画素の検査を通ったものだけを掲載する。同じ変更を Word にも入れる。
- Word で PDF 化できない間の文言の修正は、Word を直したうえで、PDF の該当行だけを `pdf_lines.py` で
  差し替える（行の開始位置・書体・大きさは同じ、他の文字と画素は一切変えない）。変更は
  `wording-changes.json` に追記し、`gate.sh` が PR ごとに再現して `verify_lines.py` で検査する。
  Word 側は、文字幅から折り返しを計算し、行数が変わらないことを確かめてから入れる。
