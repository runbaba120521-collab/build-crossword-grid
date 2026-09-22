---
name: build-crossword-grid
description: Create validated fill-in crossword grids and Excel workbooks from uploaded word or name lists in XLSX, CSV, TSV, TXT, or JSON. Use when a user asks to build a Japanese katakana, English alphabet, or mixed Japanese/Latin crossword; normalize entries; place every entry left-to-right or top-to-bottom; require a connected grid with strict or adaptive crossing targets; compare candidates by weighted crossing score; analyze character frequency; or produce puzzle, answer, entry, and quality-report sheets.
---

# Build Crossword Grid

Create a deterministic, inspectable crossword workbook from an uploaded list. Preserve display text while using a normalized grid form. Treat the requested quality conditions as hard constraints unless the user explicitly relaxes them.

> This repository is a portable, GitHub-hosted version of a skill originally
> written by tomoari "ふじてん" fujino for ChatGPT/Codex. The workbook-building
> script has been rewritten to use the public `exceljs` package instead of an
> internal Codex-only library, and the grid generator now checks that the
> whole board is a single connected component before calling a layout
> "complete" (see CHANGELOG.md). Everything else follows the original design.

## Required workflow

1. Create a dedicated working directory outside the skill folder for generated files.
2. Normalize the upload with `scripts/prepare_words.py`.
3. Inspect the normalization warnings and entry count. Stop on duplicates or entries shorter than two normalized characters.
4. Generate a layout with `scripts/generate_crossword.mjs`.
5. If preflight reports `infeasible`, report the blocking entries and do not pretend a valid puzzle exists.
6. Validate independently with `scripts/validate_crossword.mjs`.
7. Build an Excel workbook only after validation passes, using `scripts/build_workbook.mjs` (requires `npm install` once, in this folder, to fetch `exceljs`).
8. Inspect all four sheets visually when spreadsheet rendering is available.
9. Return the workbook and summarize the exact validation metrics.

## Commands

Set `SKILL_DIR` to this skill's directory and use absolute paths.

```bash
python3 "$SKILL_DIR/scripts/prepare_words.py" INPUT NORMALIZED_JSON \
  --profile auto --locale auto

node "$SKILL_DIR/scripts/generate_crossword.mjs" \
  NORMALIZED_JSON LAYOUT_JSON 120 20260921 60 60 adaptive 0.15 50

node "$SKILL_DIR/scripts/validate_crossword.mjs" \
  LAYOUT_JSON VALIDATION_JSON

node "$SKILL_DIR/scripts/build_workbook.mjs" \
  LAYOUT_JSON OUTPUT_XLSX VALIDATION_JSON
```

Run `npm install` once inside `$SKILL_DIR` before the first workbook build, so `exceljs` is available.

Use `--profile katakana` for a specifically Japanese list and `--profile latin` for an English/Latin list. Leave `auto` for mixed or unknown input. Use `--sheet`, `--display-column`, or `--board-column` only when automatic spreadsheet detection selects the wrong data. Use `strict` when the user explicitly requires two crossings for every entry. Use `adaptive` otherwise: require at least one crossing for every entry, continue targeting two or more, and allow only a bounded number of one-crossing entries. The budget is one entry normally; when entries of three characters or fewer make up at least 15% of the list, it is the smaller of 10% of all entries or half of the short entries, rounded up.

## Quality rules

Require all of the following before calling a result complete:

- Place every normalized entry.
- Keep all entries in one connected component (checked independently by both the generator and the validator).
- Meet the configured crossing policy: two per entry in strict mode; in adaptive mode, at least one per entry and no more one-crossing entries than the reported budget. Never allow zero crossings.
- Prefer layouts with the highest total quality score among otherwise valid candidates: 4 or more crossings = 10 points, 3 = 6, 2 = 4, 1 = 2, and 0 = 0 for each entry.
- Place horizontal entries left-to-right only.
- Place vertical entries top-to-bottom only.
- Allow intersections only when the characters match.
- Reject parallel overlap, three-entry cells, non-crossing adjacency, and occupied cells immediately before or after an entry.
- Stay within the requested maximum board dimensions.
- Preserve the original display text separately from the normalized grid form.

Do not use the generator's own metrics as proof. Require the independent validator to return `"ok": true`.

## Search and retry policy

For roughly 20–120 entries, begin with 120 attempts. Compare at least 20 generated candidates before accepting a complete layout, and rank them by completeness, connectivity, policy compliance, total quality score, crossing coverage, intersections, then compactness. If the result is `best-effort`, retry with 300 attempts and a different seed. If still incomplete, retry once with 600 attempts. Increase the board limit only when the user permits expansion. Never change strict/adaptive mode or the one-crossing budget silently.

For a list that fails preflight, explain that the shared-character graph cannot support the requested structure. Suggest replacing the named blockers, adding compatible entries, switching from strict to adaptive mode, or explicitly changing the list. Never allow a placed entry to have zero crossings.

## Output workbook

Create four localized sheets:

- Puzzle / 問題: blank playable grid with no clues.
- Answer / 解答: completed grid.
- Entries / 使用単語: display form, grid form, direction, start coordinate, crossing count, and per-entry points.
- Quality Report / 配置評価: size, density, intersections, total quality score, one-crossing budget, direction counts, connectivity, rules, and validation status.

## Normalization behavior

Read `references/input-and-quality.md` when handling unusual scripts, diacritics, ambiguous columns, or failure reports.

- Katakana mode converts hiragana to katakana, applies Unicode compatibility normalization, retains small kana and the long-vowel mark as one cell each, uppercases embedded Latin letters, and removes separators.
- Latin mode uppercases letters, removes separators, and folds diacritics by default (É to E). Use `--keep-diacritics` only when the user wants accented characters to occupy distinct cells.
- Auto mode selects normalization per entry and supports Japanese/Latin mixed names. Exact characters must still connect across entries.

## Reporting

Report placed count, board dimensions, occupied cells, total intersections, total quality score, one-crossing count and budget, horizontal/vertical counts, connectivity, and validator status. If validation fails, return the failure report instead of an Excel workbook.
