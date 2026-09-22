# Input and quality reference

## Supported inputs

- `.xlsx` and `.xlsm`: select 使用人名, 使用単語, Words, Entries, or Sheet1 when present; otherwise use the first sheet.
- `.csv`, `.tsv`: accept a single word column or display/grid-form pairs.
- `.txt`: read one entry per nonblank line.
- `.json`: accept an array of strings, an array of objects, or an object containing entries, words, or items.

Automatic row selection treats two textual cells as display form plus grid form. When a numeric index precedes the word, it ignores the numeric cell. For ambiguous workbooks, pass one-based `--display-column` and `--board-column` values.

## Normalized JSON schema

```json
{
  "profile": "auto",
  "locale": "en",
  "sourceFile": "names.xlsx",
  "normalization": {
    "case": "uppercase",
    "hiraganaToKatakana": true,
    "diacritics": "folded-for-latin",
    "removedCharacters": []
  },
  "entries": [
    {"display": "Alfred Hitchcock", "board": "ALFREDHITCHCOCK"}
  ]
}
```

## Feasibility interpretation

The generator builds a shared-character graph before spatial search. Each entry is a vertex; two entries are adjacent when they share at least one normalized character. A single connected crossword requires:

- one connected graph component; and
- every entry to survive iterative degree peeling for its configured minimum (two in strict mode, one in adaptive mode).

These are necessary but not sufficient spatial conditions. Passing preflight means search is meaningful, not that every board size is guaranteed to succeed. Adaptive mode still targets two or more crossings per entry, but accepts a bounded number of one-crossing entries. The default budget is one; when three-character-or-shorter entries make up at least 15% of the list, the budget is the smaller of 10% of all entries or half of the short entries, rounded up. Zero-crossing entries are never valid.

Beyond the character graph, the generator also checks — independently of per-entry crossing counts — that every *placed* entry ends up in a single physically connected component on the board itself. A word graph can pass the character-sharing check above while the actual spatial search still produces two well-formed but mutually disconnected clusters; that case is treated as `best-effort`, never `complete`.

## Candidate scoring

Score each entry by its reconstructed crossing count and sum the result across the whole layout:

- four or more crossings: 10 points;
- three crossings: 6 points;
- two crossings: 4 points;
- one crossing: 2 points;
- zero crossings: 0 points.

Candidate comparison first requires all entries to be placed, the board to be a single connected component, and the selected strict/adaptive policy to pass. Among candidates at the same compliance level, prefer the higher total quality score before raw intersection count or compactness.

## Failure classes

- `infeasible`: the word graph cannot satisfy the hard constraints. Change the list or constraints.
- `best-effort`: graph feasibility passed, but the bounded search did not find a complete, fully-connected layout. Retry with more attempts or, with permission, a larger board.
- validator failure: treat as an implementation or layout defect. Do not generate the workbook.
- normalization duplicate: two display values collapse to the same grid form. Ask the user to remove or distinguish one.

## Validation independence

The validator reconstructs every occupied cell from placements and checks:

- exact grid text;
- unique entry numbers and valid coordinates;
- start/end separation;
- perpendicular matching intersections;
- no illegal adjacency or parallel overlap;
- reconstructed per-entry crossing counts;
- reconstructed per-entry and total quality points;
- the adaptive one-crossing budget and the prohibition on zero-crossing entries;
- one connected component (breadth-first search over the crossing graph);
- configured dimensions;
- agreement with reported occupied-cell and intersection totals.

## Reproducibility

Keep the normalized JSON, layout JSON, validation report, attempt count, seed, and board limit together during testing. The same inputs and seed produce the same search sequence.
