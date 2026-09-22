import fs from "node:fs/promises";


const inputPath = process.argv[2];
const reportPath = process.argv[3];
if (!inputPath) {
  console.error("Usage: node validate_crossword.mjs layout.json [report.json]");
  process.exit(2);
}


const data = JSON.parse(await fs.readFile(inputPath, "utf8"));
const errors = [];
if (data.status === "infeasible") errors.push(data.reason || "Input is infeasible.");
const placements = Array.isArray(data.placements) ? data.placements : [];
const words = Array.isArray(data.words) ? data.words : [];
const grid = Array.isArray(data.grid) ? data.grid : [];
const qualityPolicy = data.rules?.qualityPolicy ?? "strict";
const configuredMinimum = qualityPolicy === "strict" ? 2 : 1;
const singleCrossingBudget = Number(data.rules?.singleCrossingBudget ?? 0);
const maximumSize = Number(data.rules?.maxSize ?? 60);
const occupied = new Map();
const key = (r, c) => `${r},${c}`;
function pointsForCrossings(count) {
  if (count >= 4) return 10;
  if (count === 3) return 6;
  if (count === 2) return 4;
  if (count === 1) return 2;
  return 0;
}


if (placements.length !== words.length) errors.push(`Unplaced entries: ${words.length - placements.length}`);
if (data.metrics?.placed !== placements.length) errors.push("Placed metric does not match placement count.");
if (data.metrics?.width > maximumSize || data.metrics?.height > maximumSize) errors.push("Board exceeds configured maximum size.");
if (grid.length !== data.metrics?.height || grid.some(row => !Array.isArray(row) || row.length !== data.metrics?.width)) {
  errors.push("Grid dimensions do not match metrics.");
}


const seenNumbers = new Set();
for (const placement of placements) {
  if (seenNumbers.has(placement.no)) errors.push(`Duplicate placement number: ${placement.no}`);
  seenNumbers.add(placement.no);
  const chars = Array.from(placement.board ?? "");
  if (!(["H", "V"].includes(placement.dir))) errors.push(`${placement.no}: invalid direction`);
  if (!Number.isInteger(placement.row) || !Number.isInteger(placement.col) || placement.row < 1 || placement.col < 1) {
    errors.push(`${placement.no}: invalid start coordinate`);
  }
  for (let i = 0; i < chars.length; i++) {
    const r = placement.row - 1 + (placement.dir === "V" ? i : 0);
    const c = placement.col - 1 + (placement.dir === "H" ? i : 0);
    if (grid[r]?.[c] !== chars[i]) errors.push(`${placement.no}: grid mismatch at character ${i + 1}`);
    const cellKey = key(r, c);
    if (!occupied.has(cellKey)) occupied.set(cellKey, []);
    occupied.get(cellKey).push({ word: placement.no, dir: placement.dir, ch: chars[i] });
  }
  const beforeR = placement.row - 1 - (placement.dir === "V" ? 1 : 0);
  const beforeC = placement.col - 1 - (placement.dir === "H" ? 1 : 0);
  const afterR = placement.row - 1 + (placement.dir === "V" ? chars.length : 0);
  const afterC = placement.col - 1 + (placement.dir === "H" ? chars.length : 0);
  if (grid[beforeR]?.[beforeC]) errors.push(`${placement.no}: occupied cell immediately before entry`);
  if (grid[afterR]?.[afterC]) errors.push(`${placement.no}: occupied cell immediately after entry`);
}


for (let r = 0; r < grid.length; r++) {
  for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
    if (grid[r][c] && !occupied.has(key(r, c))) errors.push(`${r + 1},${c + 1}: orphan grid character`);
  }
}


for (const [cellKey, uses] of occupied) {
  if (uses.length > 2) errors.push(`${cellKey}: more than two entries share a cell`);
  if (uses.length === 2) {
    if (uses[0].dir === uses[1].dir) errors.push(`${cellKey}: parallel overlap`);
    if (uses[0].ch !== uses[1].ch) errors.push(`${cellKey}: crossing character mismatch`);
  }
}


for (const placement of placements) {
  const chars = Array.from(placement.board ?? "");
  for (let i = 0; i < chars.length; i++) {
    const r = placement.row - 1 + (placement.dir === "V" ? i : 0);
    const c = placement.col - 1 + (placement.dir === "H" ? i : 0);
    const uses = occupied.get(key(r, c)) ?? [];
    if (uses.length === 1) {
      if (placement.dir === "H" && (occupied.has(key(r - 1, c)) || occupied.has(key(r + 1, c)))) {
        errors.push(`${placement.no}: illegal vertical touch at character ${i + 1}`);
      }
      if (placement.dir === "V" && (occupied.has(key(r, c - 1)) || occupied.has(key(r, c + 1)))) {
        errors.push(`${placement.no}: illegal horizontal touch at character ${i + 1}`);
      }
    }
  }
}


const adjacency = new Map(placements.map(placement => [placement.no, new Set()]));
const crossingsByWord = new Map(placements.map(placement => [placement.no, 0]));
for (const uses of occupied.values()) {
  if (uses.length === 2) {
    adjacency.get(uses[0].word)?.add(uses[1].word);
    adjacency.get(uses[1].word)?.add(uses[0].word);
    crossingsByWord.set(uses[0].word, (crossingsByWord.get(uses[0].word) ?? 0) + 1);
    crossingsByWord.set(uses[1].word, (crossingsByWord.get(uses[1].word) ?? 0) + 1);
  }
}
for (const placement of placements) {
  const actual = crossingsByWord.get(placement.no) ?? 0;
  const word = words.find(item => item.no === placement.no);
  const required = Number(placement.requiredCrossings ?? word?.requiredCrossings ?? configuredMinimum);
  if (actual < required) errors.push(`${placement.no}: ${actual} crossings; minimum is ${required}`);
  if (placement.intersections !== actual) errors.push(`${placement.no}: recorded crossing count ${placement.intersections} does not match ${actual}`);
  const points = pointsForCrossings(actual);
  if (Number(placement.qualityPoints) !== points) errors.push(`${placement.no}: recorded quality points ${placement.qualityPoints} do not match ${points}`);
}


const singleCrossingEntries = [...crossingsByWord.values()].filter(count => count === 1).length;
const zeroCrossingEntries = [...crossingsByWord.values()].filter(count => count === 0).length;
if (!Number.isInteger(singleCrossingBudget) || singleCrossingBudget < 0) errors.push("Invalid single-crossing budget.");
if (qualityPolicy === "strict" && singleCrossingBudget !== 0) errors.push("Strict mode must have a zero single-crossing budget.");
if (singleCrossingEntries > singleCrossingBudget) {
  errors.push(`One-crossing entries exceed budget: ${singleCrossingEntries}/${singleCrossingBudget}`);
}
if (zeroCrossingEntries > 0) errors.push(`Entries with zero crossings: ${zeroCrossingEntries}`);


const start = placements[0]?.no;
const visited = new Set(start === undefined ? [] : [start]);
const queue = start === undefined ? [] : [start];
while (queue.length) {
  const current = queue.shift();
  for (const next of adjacency.get(current) ?? []) if (!visited.has(next)) {
    visited.add(next);
    queue.push(next);
  }
}
if (visited.size !== placements.length) errors.push(`Grid is disconnected: ${visited.size}/${placements.length}`);


const intersections = [...occupied.values()].filter(uses => uses.length === 2).length;
const qualityPoints = [...crossingsByWord.values()].reduce((sum, count) => sum + pointsForCrossings(count), 0);
if (data.metrics?.intersections !== intersections) errors.push("Intersection metric does not match reconstructed grid.");
if (data.metrics?.cells !== occupied.size) errors.push("Occupied-cell metric does not match reconstructed grid.");
if (data.metrics?.single !== singleCrossingEntries) errors.push("Single-crossing metric does not match reconstructed grid.");
if (data.metrics?.zero !== zeroCrossingEntries) errors.push("Zero-crossing metric does not match reconstructed grid.");
if (data.metrics?.qualityPoints !== qualityPoints) errors.push("Quality-points metric does not match reconstructed grid.");


const report = {
  ok: errors.length === 0,
  errors,
  placed: placements.length,
  occupiedCells: occupied.size,
  intersections,
  connectedWords: visited.size,
  qualityPolicy,
  adaptiveShortEnabled: Boolean(data.rules?.adaptiveShortEnabled),
  singleCrossingBudget,
  singleCrossingEntries,
  zeroCrossingEntries,
  qualityPoints,
  width: data.metrics?.width ?? 0,
  height: data.metrics?.height ?? 0,
  horizontal: placements.filter(placement => placement.dir === "H").length,
  vertical: placements.filter(placement => placement.dir === "V").length,
};
if (reportPath) await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!report.ok) process.exitCode = 1;
