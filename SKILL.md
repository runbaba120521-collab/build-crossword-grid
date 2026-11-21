---
name: build-crossword-grid
description: Create validated fill-in crossword grids and Excel workbooks from uploaded word or name lists in XLSX, CSV, TSV, TXT, or JSON. Use when a user asks to build a Japanese katakana, English alphabet, or mixed Japanese/Latin crossword; normalize entries; place every entry left-to-right or top-to-bottom; require a connected grid with strict or adaptive crossing targets; compare candidates by weighted crossing score; analyze character frequency; or produce puzzle, answer, entry, and quality-report sheets.
---

# Build Crossword Grid

Create a deterministic, inspectable crossword workbook from an uploaded list. Preserve display text while using a normalized grid form. Treat the requested quality conditions as hard constraints unless the user explicitly relaxes them.

> This repository is a portable, GitHub-hosted version of a skill originally
> written by 天気雨 (tenkiame) for ChatGPT/Codex. The workbook-building
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

For roughly 20–120 entries, begin with 120 attempts. Compare at least 20 generated candidates before accepting a complete layout, and rank them by completeness, connectivity, policy compliance, total quality score, crossing coverage, intersections, then compactness. Increase the board limit only when the user permits expansion. Never change strict/adaptive mode or the one-crossing budget silently.

If the result is `best-effort`, retry in this order and stop as soon as the independent validator returns `"ok": true`:

1. Run 300 attempts with 300 repair rounds (the ninth argument) and a new seed (seed + 1).
2. If still incomplete, run 600 attempts with 300 repair rounds on at least three more seeds (seed + 2, seed + 3, seed + 4). Validate each result and keep the passing layout with the highest total quality score.

The generator also uses attraction placement by default. An entry that shares characters with three or fewer other entries (for example トモダチ, whose ト, モ and ダ each appear in only one other word) is placed as soon as one of its partner entries is on the board, before the free space around that partner fills up. If an entry is still left unplaced, the generator tries two fixes: it moves a partner entry toward the outside of the board and crosses the unplaced entry with it, or it lifts at most two entries that block the path, places the unplaced entry and puts the lifted entries back elsewhere. A fix is kept only if more entries are placed, the board stays connected and no entry has zero crossings. Pass `--no-attract` only to compare with the earlier behavior.

Repair rounds re-place entries that have only one crossing. They are the main lever when every entry is placed but the one-crossing count is above the budget, which is common for lists with many short words (three characters or fewer). Different seeds explore different starting layouts, so try several before reporting failure.

```bash
node "$SKILL_DIR/scripts/generate_crossword.mjs" \
  NORMALIZED_JSON LAYOUT_JSON 600 SEED 60 60 adaptive 0.15 300
```

Report which seed and settings produced the accepted layout.

3. If every retry is still `best-effort` only because too many entries have exactly one crossing (all entries placed, none with zero crossings), offer to relax the one-crossing budget. Tell the user the automatic budget, how many one-crossing entries the best layout needed, and that the puzzle stays fully connected but some words will be joined to the grid at only one point. Rerun with `--single-budget N` only after the user agrees to a specific N, and validate again.

```bash
node "$SKILL_DIR/scripts/generate_crossword.mjs" \
  NORMALIZED_JSON LAYOUT_JSON 600 SEED 60 60 adaptive 0.15 300 --single-budget N
```

   `--single-budget` works only in adaptive mode. It never allows zero-crossing entries. The layout, the validation report and the workbook all record that the budget was set by the user, next to the automatic value.

4. Last resort only: if the user declines a larger budget, or entries still cannot be placed, say that the word list itself is the limit and ask whether the user wants to change it. Do not propose specific replacement or additional words unless the user asks for suggestions, so the list stays the user's own. You may report factual details, such as which entries could not be placed.

For a list that fails preflight, explain that the shared-character graph cannot support the requested structure and name the blocking entries. Switching from strict to adaptive mode is an option to offer. Changing the list follows the same rule as step 4: ask, and suggest specific words only when the user asks. Never allow a placed entry to have zero crossings.

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
