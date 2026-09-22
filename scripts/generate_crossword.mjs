import fs from "node:fs/promises";


const sourcePath = process.argv[2];
const outputPath = process.argv[3];
const requestedAttempts = Number(process.argv[4] || 120);
const requestedSeed = Number(process.argv[5] || 20260921);
const requestedMaxSize = Number(process.argv[6] || 60);
const expandedMaxSize = Number(process.argv[7] || requestedMaxSize);
const qualityPolicy = process.argv[8] || "adaptive";
const shortWordThreshold = Number(process.argv[9] || 0.15);
const repairRounds = Number(process.argv[10] || 50);
const initialLayoutPath = process.argv[11];


if (!sourcePath || !outputPath) {
  console.error("Usage: node generate_crossword.mjs normalized.json layout.json [attempts] [seed] [max-size] [expand-to] [strict|adaptive] [short-word-threshold] [repair-rounds] [initial-layout]");
  process.exit(2);
}
if (![requestedAttempts, requestedSeed, requestedMaxSize, expandedMaxSize, repairRounds].every(Number.isFinite)) {
  throw new Error("Attempts, seed, and board sizes must be numeric.");
}
if (requestedAttempts < 1 || requestedMaxSize < 5 || expandedMaxSize < requestedMaxSize || repairRounds < 0) {
  throw new Error("Invalid search limits.");
}
if (!new Set(["strict", "adaptive"]).has(qualityPolicy) || shortWordThreshold < 0 || shortWordThreshold > 1) {
  throw new Error("Quality policy must be strict or adaptive, and threshold must be between 0 and 1.");
}


const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
if (!Array.isArray(source.entries)) throw new Error("Normalized input must contain an entries array.");
const japaneseLowValueChars = new Set(["ー", "ッ", "ャ", "ュ", "ョ", "ァ", "ィ", "ゥ", "ェ", "ォ", "ヮ"]);
const words = source.entries
  .filter(entry => entry.display && entry.board)
  .map((entry, index) => ({
    id: index,
    display: String(entry.display),
    board: String(entry.board),
  }))
  .filter(word => word.board.length >= 2);
if (words.length < 4) throw new Error("At least four usable words are required for a two-crossing crossword.");
for (const word of words) word.chars = Array.from(word.board);
const shortWordCount = words.filter(word => word.chars.length <= 3).length;
const shortWordShare = shortWordCount / words.length;
const adaptiveShortEnabled = qualityPolicy === "adaptive" && shortWordShare >= shortWordThreshold;
const singleCrossingBudget = qualityPolicy === "strict" ? 0 : Math.min(
  Math.max(1, Math.ceil(words.length * 0.10)),
  adaptiveShortEnabled ? Math.max(1, Math.ceil(shortWordCount * 0.50)) : 1,
);
function requiredCrossings() {
  return qualityPolicy === "strict" ? 2 : 1;
}
function targetCrossings() {
  return 2;
}
function pointsForCrossings(count) {
  if (count >= 4) return 10;
  if (count === 3) return 6;
  if (count === 2) return 4;
  if (count === 1) return 2;
  return 0;
}


const charToWords = new Map();
for (const word of words) {
  for (const ch of new Set(word.chars)) {
    if (!charToWords.has(ch)) charToWords.set(ch, []);
    charToWords.get(ch).push(word.id);
  }
}
for (const word of words) {
  let degree = 0;
  let weightedDegree = 0;
  for (const ch of new Set(word.chars)) {
    const n = (charToWords.get(ch)?.length ?? 1) - 1;
    degree += n;
    const documentFrequency = (charToWords.get(ch)?.length ?? 1) / words.length;
    const weight = source.profile === "katakana"
      ? (japaneseLowValueChars.has(ch) ? 0.25 : 1)
      : Math.max(0.25, 1 - documentFrequency * 0.7);
    weightedDegree += n * weight;
  }
  word.degree = degree;
  word.weightedDegree = weightedDegree;
  word.frequencyScore = word.chars.reduce((sum, ch) => sum + (charToWords.get(ch)?.length ?? 0), 0);
}


function crossingQuality(ch) {
  if (source.profile === "katakana") return japaneseLowValueChars.has(ch) ? 1 : 8;
  const documentFrequency = (charToWords.get(ch)?.length ?? 1) / words.length;
  return 1 + Math.round(7 * Math.max(0.1, 1 - documentFrequency));
}


function analyzeFeasibility() {
  const adjacency = words.map(() => new Set());
  for (const ids of charToWords.values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        adjacency[ids[i]].add(ids[j]);
        adjacency[ids[j]].add(ids[i]);
      }
    }
  }
  const components = [];
  const seen = new Set();
  for (const word of words) {
    if (seen.has(word.id)) continue;
    const component = [];
    const queue = [word.id];
    seen.add(word.id);
    while (queue.length) {
      const id = queue.shift();
      component.push(id);
      for (const next of adjacency[id]) if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
    components.push(component);
  }
  const active = new Set(words.map(word => word.id));
  const removed = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...active]) {
      const degree = [...adjacency[id]].filter(next => active.has(next)).length;
      if (degree < requiredCrossings(words[id])) {
        active.delete(id);
        removed.push(id);
        changed = true;
      }
    }
  }
  const blockers = removed.map(id => ({
    no: id + 1,
    display: words[id].display,
    board: words[id].board,
    possiblePartners: adjacency[id].size,
  }));
  return {
    ok: components.length === 1 && blockers.length === 0,
    connectedComponents: components.length,
    componentSizes: components.map(component => component.length).sort((a, b) => b - a),
    viableCoreSize: active.size,
    blockers,
  };
}


const preflight = analyzeFeasibility();
if (!preflight.ok) {
  const diagnostic = {
    status: "infeasible",
    reason: "The shared-character graph cannot support one connected grid with the configured crossing targets.",
    profile: source.profile ?? "auto",
    locale: source.locale ?? "en",
    qualityPolicy,
    adaptiveShortEnabled,
    singleCrossingBudget,
    shortWordShare,
    preflight,
    words: words.map(word => ({ no: word.id + 1, display: word.display, board: word.board })),
  };
  await fs.writeFile(outputPath, JSON.stringify(diagnostic, null, 2));
  console.error(JSON.stringify(diagnostic));
  process.exit(2);
}


function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}


const key = (r, c) => `${r},${c}`;


function emptyState(limit) {
  return {
    limit,
    grid: new Map(),
    charCells: new Map(),
    placements: new Map(),
    crossCounts: new Map(),
    minR: Infinity, maxR: -Infinity, minC: Infinity, maxC: -Infinity,
  };
}


function bboxFor(state, r, c, dir, len) {
  const endR = dir === "V" ? r + len - 1 : r;
  const endC = dir === "H" ? c + len - 1 : c;
  return {
    minR: Math.min(state.minR, r, endR),
    maxR: Math.max(state.maxR, r, endR),
    minC: Math.min(state.minC, c, endC),
    maxC: Math.max(state.maxC, c, endC),
  };
}


function validCandidate(state, word, r, c, dir) {
  const len = word.chars.length;
  const before = dir === "H" ? key(r, c - 1) : key(r - 1, c);
  const after = dir === "H" ? key(r, c + len) : key(r + len, c);
  if (state.grid.has(before) || state.grid.has(after)) return null;


  let intersections = 0;
  let quality = 0;
  const crossedWords = new Set();
  for (let i = 0; i < len; i++) {
    const rr = dir === "V" ? r + i : r;
    const cc = dir === "H" ? c + i : c;
    const cell = state.grid.get(key(rr, cc));
    const ch = word.chars[i];
    if (cell) {
      if (cell.ch !== ch) return null;
      if (dir === "H") {
        if (cell.h !== null || cell.v === null) return null;
        crossedWords.add(cell.v);
      } else {
        if (cell.v !== null || cell.h === null) return null;
        crossedWords.add(cell.h);
      }
      intersections++;
      quality += crossingQuality(ch);
    } else if (dir === "H") {
      if (state.grid.has(key(rr - 1, cc)) || state.grid.has(key(rr + 1, cc))) return null;
    } else {
      if (state.grid.has(key(rr, cc - 1)) || state.grid.has(key(rr, cc + 1))) return null;
    }
  }
  if (state.placements.size > 0 && intersections === 0) return null;
  const box = bboxFor(state, r, c, dir, len);
  const height = box.maxR - box.minR + 1;
  const width = box.maxC - box.minC + 1;
  if (height > state.limit || width > state.limit) return null;
  const oldArea = state.placements.size ? (state.maxR - state.minR + 1) * (state.maxC - state.minC + 1) : 0;
  const area = height * width;
  const centerDistance = Math.abs((box.minR + box.maxR) / 2) + Math.abs((box.minC + box.maxC) / 2);
  const imbalance = Math.abs(height - width);
  const deficitHelp = [...crossedWords].filter(id => (state.crossCounts.get(id) ?? 0) < targetCrossings(words[id])).length;
  const newWordSatisfied = intersections >= targetCrossings(word) ? 1 : 0;
  const qualityPointsGain = pointsForCrossings(intersections) + [...crossedWords].reduce((sum, id) => {
    const before = state.crossCounts.get(id) ?? 0;
    return sum + pointsForCrossings(before + 1) - pointsForCrossings(before);
  }, 0);
  const score = qualityPointsGain * 6000 + intersections * 18000 + deficitHelp * 42000 + newWordSatisfied * 52000 + quality * 80
    - (area - oldArea) * 10 - area * 0.05 - imbalance * 7 - centerDistance * 0.8;
  return { wordId: word.id, r, c, dir, intersections, crossedWords: crossedWords.size, crossWordIds: [...crossedWords], deficitHelp, score, box };
}


function candidatesFor(state, word) {
  const found = new Map();
  for (let i = 0; i < word.chars.length; i++) {
    const ch = word.chars[i];
    const cells = state.charCells.get(ch) ?? [];
    for (const cell of cells) {
      if (cell.h !== null && cell.v === null) {
        const r = cell.r - i;
        const c = cell.c;
        const candidate = validCandidate(state, word, r, c, "V");
        if (candidate) found.set(`${r},${c},V`, candidate);
      }
      if (cell.v !== null && cell.h === null) {
        const r = cell.r;
        const c = cell.c - i;
        const candidate = validCandidate(state, word, r, c, "H");
        if (candidate) found.set(`${r},${c},H`, candidate);
      }
    }
  }
  return [...found.values()].sort((a, b) => b.score - a.score).slice(0, 48);
}


function place(state, word, candidate) {
  const { r, c, dir } = candidate;
  const placement = { ...candidate, board: word.board, display: word.display };
  state.placements.set(word.id, placement);
  state.crossCounts.set(word.id, candidate.intersections);
  for (const crossedId of candidate.crossWordIds ?? []) {
    state.crossCounts.set(crossedId, (state.crossCounts.get(crossedId) ?? 0) + 1);
  }
  state.minR = candidate.box.minR;
  state.maxR = candidate.box.maxR;
  state.minC = candidate.box.minC;
  state.maxC = candidate.box.maxC;
  for (let i = 0; i < word.chars.length; i++) {
    const rr = dir === "V" ? r + i : r;
    const cc = dir === "H" ? c + i : c;
    const k = key(rr, cc);
    let cell = state.grid.get(k);
    if (!cell) {
      cell = { ch: word.chars[i], r: rr, c: cc, h: null, v: null };
      state.grid.set(k, cell);
      if (!state.charCells.has(cell.ch)) state.charCells.set(cell.ch, []);
      state.charCells.get(cell.ch).push(cell);
    }
    if (dir === "H") cell.h = word.id;
    else cell.v = word.id;
  }
}


function rebuildDerived(state) {
  state.charCells = new Map();
  state.crossCounts = new Map([...state.placements.keys()].map(id => [id, 0]));
  state.minR = Infinity;
  state.maxR = -Infinity;
  state.minC = Infinity;
  state.maxC = -Infinity;
  for (const cell of state.grid.values()) {
    if (!state.charCells.has(cell.ch)) state.charCells.set(cell.ch, []);
    state.charCells.get(cell.ch).push(cell);
    state.minR = Math.min(state.minR, cell.r);
    state.maxR = Math.max(state.maxR, cell.r);
    state.minC = Math.min(state.minC, cell.c);
    state.maxC = Math.max(state.maxC, cell.c);
    if (cell.h !== null && cell.v !== null) {
      state.crossCounts.set(cell.h, (state.crossCounts.get(cell.h) ?? 0) + 1);
      state.crossCounts.set(cell.v, (state.crossCounts.get(cell.v) ?? 0) + 1);
    }
  }
}


function removeWord(state, wordId) {
  const placement = state.placements.get(wordId);
  if (!placement) return null;
  const word = words[wordId];
  for (let i = 0; i < word.chars.length; i++) {
    const rr = placement.dir === "V" ? placement.r + i : placement.r;
    const cc = placement.dir === "H" ? placement.c + i : placement.c;
    const cellKey = key(rr, cc);
    const cell = state.grid.get(cellKey);
    if (!cell) continue;
    if (placement.dir === "H") cell.h = null;
    else cell.v = null;
    if (cell.h === null && cell.v === null) state.grid.delete(cellKey);
  }
  state.placements.delete(wordId);
  rebuildDerived(state);
  return placement;
}


function cloneState(sourceState) {
  const state = emptyState(sourceState.limit);
  for (const [wordId, placement] of sourceState.placements) {
    state.placements.set(wordId, { ...placement, crossWordIds: [...(placement.crossWordIds ?? [])] });
    const word = words[wordId];
    for (let i = 0; i < word.chars.length; i++) {
      const rr = placement.dir === "V" ? placement.r + i : placement.r;
      const cc = placement.dir === "H" ? placement.c + i : placement.c;
      const cellKey = key(rr, cc);
      let cell = state.grid.get(cellKey);
      if (!cell) {
        cell = { ch: word.chars[i], r: rr, c: cc, h: null, v: null };
        state.grid.set(cellKey, cell);
      }
      if (placement.dir === "H") cell.h = wordId;
      else cell.v = wordId;
    }
  }
  rebuildDerived(state);
  return state;
}


function stateFromLayout(layout) {
  const state = emptyState(layout.rules?.maxSize ?? 60);
  for (const p of layout.placements) {
    const wordId = p.id ?? (p.no - 1);
    const placement = { wordId, r: p.row - 1, c: p.col - 1, dir: p.dir, board: p.board, display: p.display };
    state.placements.set(wordId, placement);
    const word = words[wordId];
    for (let i = 0; i < word.chars.length; i++) {
      const rr = placement.dir === "V" ? placement.r + i : placement.r;
      const cc = placement.dir === "H" ? placement.c + i : placement.c;
      const cellKey = key(rr, cc);
      let cell = state.grid.get(cellKey);
      if (!cell) {
        cell = { ch: word.chars[i], r: rr, c: cc, h: null, v: null };
        state.grid.set(cellKey, cell);
      }
      if (placement.dir === "H") cell.h = wordId;
      else cell.v = wordId;
    }
  }
  rebuildDerived(state);
  return state;
}


function deficitIds(state) {
  const zero = [];
  const single = [];
  for (const [id, count] of state.crossCounts) {
    if (count === 0) zero.push(id);
    else if (count === 1) single.push(id);
  }
  if (qualityPolicy === "strict" || single.length > singleCrossingBudget) return [...zero, ...single];
  return zero;
}


function repackSingles(sourceState, rng, variants = 12) {
  let bestState = sourceState;
  let bestMetrics = metrics(sourceState);
  for (let variant = 0; variant < variants; variant++) {
    const state = cloneState(sourceState);
    const removedIds = deficitIds(state);
    for (const id of removedIds) removeWord(state, id);


    const remaining = new Set(removedIds);
    while (remaining.size) {
      const options = [];
      for (const wordId of remaining) {
        const word = words[wordId];
        const candidates = candidatesFor(state, word);
        if (!candidates.length) continue;
        const best = candidates[0];
        const difficulty = (maxFrequencyScore - word.frequencyScore) * 90 + (maxDegree - word.degree) * 40;
        options.push({ word, candidates, priority: best.score + difficulty + rng() * 1800 });
      }
      if (!options.length) break;
      const twoCross = options.filter(option => option.candidates[0].intersections >= targetCrossings(option.word));
      const active = twoCross.length ? twoCross : options;
      active.sort((a, b) => b.priority - a.priority);
      const option = chooseWeighted(active.slice(0, 8), rng, 0.78);
      const validChoices = option.candidates.filter(c => !twoCross.length || c.intersections >= targetCrossings(option.word)).slice(0, 12);
      place(state, option.word, chooseWeighted(validChoices, rng, 0.74));
      remaining.delete(option.word.id);
    }
    if (remaining.size) continue;
    repairSingles(state, rng, 4);
    const m = metrics(state);
    if (betterMetrics(m, bestMetrics)) {
      bestState = state;
      bestMetrics = m;
    }
  }
  return bestState;
}


function repackNeighborhood(sourceState, rng, variants = 30, extraCount = 6) {
  let bestState = sourceState;
  let bestMetrics = metrics(sourceState);
  for (let variant = 0; variant < variants; variant++) {
    const state = cloneState(sourceState);
    const singles = deficitIds(state);
    const pool = [...state.crossCounts.entries()]
      .filter(([id, count]) => count >= targetCrossings(words[id]) && count <= targetCrossings(words[id]) + 1 && !singles.includes(id))
      .map(([id, count]) => ({ id, count, noise: rng() }))
      .sort((a, b) => a.count - b.count || words[b.id].frequencyScore - words[a.id].frequencyScore || a.noise - b.noise)
      .slice(0, 32);
    const extras = [];
    const available = [...pool];
    while (extras.length < extraCount && available.length) {
      const index = Math.floor(rng() * Math.min(available.length, 18));
      extras.push(available.splice(index, 1)[0].id);
    }
    const removedIds = [...new Set([...singles, ...extras])];
    for (const id of removedIds) removeWord(state, id);


    const remaining = new Set(removedIds);
    while (remaining.size) {
      const options = [];
      for (const wordId of remaining) {
        const word = words[wordId];
        const candidates = candidatesFor(state, word);
        if (!candidates.length) continue;
        const best = candidates[0];
        const difficulty = (maxFrequencyScore - word.frequencyScore) * 75 + (maxDegree - word.degree) * 35;
        options.push({ word, candidates, priority: best.score + difficulty + rng() * 2400 });
      }
      if (!options.length) break;
      const twoCross = options.filter(option => option.candidates[0].intersections >= targetCrossings(option.word));
      const active = twoCross.length ? twoCross : options;
      active.sort((a, b) => b.priority - a.priority);
      const option = chooseWeighted(active.slice(0, 10), rng, 0.8);
      const validChoices = option.candidates.filter(c => !twoCross.length || c.intersections >= targetCrossings(option.word)).slice(0, 16);
      place(state, option.word, chooseWeighted(validChoices, rng, 0.78));
      remaining.delete(option.word.id);
    }
    if (remaining.size) continue;
    repairSingles(state, rng, 4);
    const m = metrics(state);
    if (betterMetrics(m, bestMetrics)) {
      bestState = state;
      bestMetrics = m;
      if (m.belowMinimum === 0 && m.connected) break;
    }
  }
  return bestState;
}


function repairSingles(state, rng, maxPasses = 5) {
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    const currentSingles = deficitIds(state)
      .sort((a, b) => words[a].frequencyScore - words[b].frequencyScore || rng() - 0.5);
    for (const wordId of currentSingles) {
      if (!deficitIds(state).includes(wordId)) continue;
      const snapshot = cloneState(state);
      const before = metrics(state);
      removeWord(state, wordId);
      const word = words[wordId];
      const candidates = candidatesFor(state, word).filter(candidate => candidate.intersections >= targetCrossings(word)).slice(0, 32);
      let accepted = false;
      for (const candidate of candidates) {
        place(state, word, candidate);
        const after = metrics(state);
        if (after.placed === before.placed && betterMetrics(after, before)) {
          accepted = true;
          improved = true;
          break;
        }
        removeWord(state, wordId);
      }
      if (!accepted) {
        Object.assign(state, snapshot);
      }
    }
    if (!improved) break;
  }
  return state;
}


function chooseWeighted(items, rng, temperature = 0.78) {
  if (items.length === 1) return items[0];
  const weights = items.map((_, i) => Math.pow(temperature, i));
  let pick = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return items[i];
  }
  return items[items.length - 1];
}


const frequencyRankedWords = [...words].sort((a, b) =>
  (b.frequencyScore + b.weightedDegree + b.chars.length * 3) -
  (a.frequencyScore + a.weightedDegree + a.chars.length * 3));
const maxFrequencyScore = Math.max(...words.map(word => word.frequencyScore));
const maxDegree = Math.max(...words.map(word => word.degree));


function seedCycle(limit, rng) {
  for (let trial = 0; trial < 80; trial++) {
    const state = emptyState(limit);
    const firstWord = frequencyRankedWords[Math.floor(rng() * Math.min(28, frequencyRankedWords.length))];
    place(state, firstWord, validCandidate(state, firstWord, 0, 0, "H"));


    const secondOptions = [];
    for (const word of frequencyRankedWords.slice(0, 70)) {
      if (state.placements.has(word.id)) continue;
      for (const candidate of candidatesFor(state, word).filter(c => c.dir === "V").slice(0, 8)) {
        secondOptions.push({ word, candidate, score: candidate.score + word.frequencyScore * 30 });
      }
    }
    if (!secondOptions.length) continue;
    secondOptions.sort((a, b) => b.score - a.score);
    const second = chooseWeighted(secondOptions.slice(0, 30), rng, 0.82);
    place(state, second.word, second.candidate);


    const thirdOptions = [];
    for (const word of frequencyRankedWords.slice(0, 85)) {
      if (state.placements.has(word.id)) continue;
      for (const candidate of candidatesFor(state, word).filter(c => c.dir === "H" && c.intersections === 1).slice(0, 10)) {
        thirdOptions.push({ word, candidate, score: candidate.score + word.frequencyScore * 24 });
      }
    }
    if (!thirdOptions.length) continue;
    thirdOptions.sort((a, b) => b.score - a.score);
    const third = chooseWeighted(thirdOptions.slice(0, 36), rng, 0.84);
    place(state, third.word, third.candidate);


    const fourthOptions = [];
    for (const word of frequencyRankedWords) {
      if (state.placements.has(word.id)) continue;
      for (const candidate of candidatesFor(state, word).filter(c => c.dir === "V" && c.intersections >= 2).slice(0, 12)) {
        fourthOptions.push({ word, candidate, score: candidate.score + word.frequencyScore * 18 });
      }
    }
    if (!fourthOptions.length) continue;
    fourthOptions.sort((a, b) => b.score - a.score);
    const fourth = chooseWeighted(fourthOptions.slice(0, 40), rng, 0.86);
    place(state, fourth.word, fourth.candidate);
    if ([...state.crossCounts.entries()].every(([id, count]) => count >= targetCrossings(words[id]))) return state;
  }
  return null;
}


function attempt(seed, limit) {
  const rng = mulberry32(seed);
  let state = adaptiveShortEnabled ? null : seedCycle(limit, rng);
  if (!state) {
    state = emptyState(limit);
    const seedPool = frequencyRankedWords.slice(0, 24);
    const seedWord = seedPool[Math.floor(rng() * seedPool.length)];
    const seedDir = rng() < 0.5 ? "H" : "V";
    const seedCandidate = validCandidate(state, seedWord, 0, 0, seedDir);
    place(state, seedWord, seedCandidate);
  }


  while (state.placements.size < words.length) {
    const options = [];
    for (const word of words) {
      if (state.placements.has(word.id)) continue;
      const candidates = candidatesFor(state, word);
      if (!candidates.length) continue;
      const best = candidates[0];
      const urgency = Math.max(0, 18 - candidates.length) * 130;
      const corePhase = state.placements.size < 14;
      const frequencyPriority = corePhase ? word.frequencyScore * 28 : 0;
      const difficultyPriority = corePhase ? 0
        : (maxFrequencyScore - word.frequencyScore) * 105 + (maxDegree - word.degree) * 45;
      const priority = best.score + urgency + frequencyPriority + difficultyPriority + word.chars.length * 18 + word.weightedDegree * 2 + rng() * 900;
      options.push({ word, candidates, priority });
    }
    if (!options.length) break;
    const twoCrossOptions = state.placements.size >= 10
      ? options.filter(option => option.candidates[0].intersections >= targetCrossings(option.word))
      : [];
    const activeOptions = twoCrossOptions.length ? twoCrossOptions : options;
    activeOptions.sort((a, b) => b.priority - a.priority);
    const option = chooseWeighted(activeOptions.slice(0, 12), rng, 0.76);
    const topCandidates = option.candidates.slice(0, 10);
    const chosen = chooseWeighted(topCandidates, rng, 0.72);
    place(state, option.word, chosen);
  }
  if (state.placements.size === words.length) {
    repairSingles(state, rng, 6);
    for (let round = 0; round < 4; round++) {
      const before = metrics(state);
      const repacked = repackSingles(state, rng, 18);
      const after = metrics(repacked);
      state = repacked;
      if ((after.belowMinimum === 0 && after.connected) || (after.belowMinimum >= before.belowMinimum && after.disconnected >= before.disconnected)) break;
    }
    for (let round = 0; round < 3 && (metrics(state).belowMinimum > 0 || !metrics(state).connected); round++) {
      const before = metrics(state);
      const repacked = repackNeighborhood(state, rng, 28, 5 + round * 2);
      const after = metrics(repacked);
      state = repacked;
      if ((after.belowMinimum === 0 && after.connected) || (after.belowMinimum >= before.belowMinimum && after.disconnected >= before.disconnected)) break;
    }
  }
  return state;
}


function placementConnectivity(state) {
  // Two placed words are adjacent when a cell carries both their ids (a crossing).
  // This mirrors the independent validator's BFS so the generator cannot call a
  // physically disconnected board "complete" just because every word individually
  // has enough crossings (see: disconnected-board bug).
  const ids = [...state.placements.keys()];
  if (ids.length === 0) return { connectedComponents: 0, largestComponent: 0, disconnected: 0 };
  const adjacency = new Map(ids.map(id => [id, new Set()]));
  for (const cell of state.grid.values()) {
    if (cell.h !== null && cell.v !== null) {
      adjacency.get(cell.h)?.add(cell.v);
      adjacency.get(cell.v)?.add(cell.h);
    }
  }
  const seen = new Set();
  let components = 0;
  let largest = 0;
  for (const id of ids) {
    if (seen.has(id)) continue;
    components++;
    let size = 0;
    const queue = [id];
    seen.add(id);
    while (queue.length) {
      const current = queue.shift();
      size++;
      for (const next of adjacency.get(current) ?? []) if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
    largest = Math.max(largest, size);
  }
  return { connectedComponents: components, largestComponent: largest, disconnected: ids.length - largest };
}


function metrics(state) {
  const height = state.maxR - state.minR + 1;
  const width = state.maxC - state.minC + 1;
  const area = height * width;
  let intersections = 0;
  const perWord = new Map([...state.placements.keys()].map(id => [id, 0]));
  for (const cell of state.grid.values()) {
    if (cell.h !== null && cell.v !== null) {
      intersections++;
      perWord.set(cell.h, (perWord.get(cell.h) ?? 0) + 1);
      perWord.set(cell.v, (perWord.get(cell.v) ?? 0) + 1);
    }
  }
  const multi = [...perWord.values()].filter(v => v >= 2).length;
  const single = [...perWord.values()].filter(v => v === 1).length;
  const zero = [...perWord.values()].filter(v => v === 0).length;
  const excessSingles = Math.max(0, single - singleCrossingBudget);
  const belowMinimum = zero + excessSingles;
  const qualityPoints = [...perWord.values()].reduce((sum, count) => sum + pointsForCrossings(count), 0);
  const density = state.grid.size / area;
  const { connectedComponents, largestComponent, disconnected } = placementConnectivity(state);
  const connected = state.placements.size > 0 && connectedComponents <= 1;
  return { placed: state.placements.size, total: words.length, width, height, area, cells: state.grid.size, intersections, multi, single, zero, excessSingles, belowMinimum, qualityPoints, density, connectedComponents, largestComponent, disconnected, connected };
}


function betterMetrics(a, b) {
  if (!b) return true;
  if (a.placed !== b.placed) return a.placed > b.placed;
  if (a.disconnected !== b.disconnected) return a.disconnected < b.disconnected;
  if (a.belowMinimum !== b.belowMinimum) return a.belowMinimum < b.belowMinimum;
  if (a.qualityPoints !== b.qualityPoints) return a.qualityPoints > b.qualityPoints;
  if (a.multi !== b.multi) return a.multi > b.multi;
  if (a.intersections !== b.intersections) return a.intersections > b.intersections;
  if (Math.abs(a.width - a.height) !== Math.abs(b.width - b.height)) return Math.abs(a.width - a.height) < Math.abs(b.width - b.height);
  if (a.area !== b.area) return a.area < b.area;
  return a.density > b.density;
}


function isSoundLayout(m) {
  // A layout only counts as genuinely finished when every entry is placed,
  // the crossing-count policy is met, AND the whole board is one connected
  // component. Checking belowMinimum alone lets two well-crossed but mutually
  // disconnected clusters slip through as "complete".
  return m.placed === words.length && m.belowMinimum === 0 && m.connected;
}


async function search(limit, attempts, seedBase) {
  let best = null;
  let bestMetrics = null;
  for (let i = 0; i < attempts; i++) {
    const state = attempt(seedBase + i * 7919, limit);
    const m = metrics(state);
    if (betterMetrics(m, bestMetrics)) {
      best = state;
      bestMetrics = m;
      console.log(JSON.stringify({ attempt: i + 1, limit, ...m }));
    }
    if (i >= 19 && bestMetrics && isSoundLayout(bestMetrics)) break;
  }
  return { state: best, metrics: bestMetrics };
}


function optimizeDeficits(sourceState, rounds, seedBase) {
  let optimized = sourceState;
  let bestMetrics = metrics(optimized);
  const rng = mulberry32(seedBase);
  for (let round = 0; round < rounds && (bestMetrics.belowMinimum > 0 || !bestMetrics.connected); round++) {
    const extraCount = 4 + (round % 5) * 2;
    const candidate = repackNeighborhood(optimized, rng, 50, extraCount);
    const candidateMetrics = metrics(candidate);
    if (betterMetrics(candidateMetrics, bestMetrics)) {
      optimized = candidate;
      bestMetrics = candidateMetrics;
      console.log(JSON.stringify({ repairRound: round + 1, extraCount, ...bestMetrics }));
    }
  }
  return { state: optimized, metrics: bestMetrics };
}


let result;
if (initialLayoutPath) {
  const initialLayout = JSON.parse(await fs.readFile(initialLayoutPath, "utf8"));
  const initialState = stateFromLayout(initialLayout);
  result = { state: initialState, metrics: metrics(initialState) };
} else {
  result = await search(requestedMaxSize, requestedAttempts, requestedSeed);
}
if (result.metrics.placed === words.length && (result.metrics.belowMinimum > 0 || !result.metrics.connected)) {
  result = optimizeDeficits(result.state, repairRounds, requestedSeed + 2000003);
}
if ((result.metrics.placed < words.length || result.metrics.belowMinimum > 0 || !result.metrics.connected) && expandedMaxSize > requestedMaxSize) {
  const expanded = await search(expandedMaxSize, Math.max(40, Math.floor(requestedAttempts / 2)), requestedSeed + 1000003);
  if (betterMetrics(expanded.metrics, result.metrics)) result = expanded;
}


const state = result.state;
const finalMetrics = metrics(state);
const placements = [...state.placements.entries()].map(([id, p]) => {
  const word = words[id];
  let crossCount = 0;
  for (let i = 0; i < word.chars.length; i++) {
    const rr = p.dir === "V" ? p.r + i : p.r;
    const cc = p.dir === "H" ? p.c + i : p.c;
    const cell = state.grid.get(key(rr, cc));
    if (cell.h !== null && cell.v !== null) crossCount++;
  }
  return {
    id,
    no: id + 1,
    display: word.display,
    board: word.board,
    row: p.r - state.minR + 1,
    col: p.c - state.minC + 1,
    direction: p.dir === "H" ? "horizontal-left-to-right" : "vertical-top-to-bottom",
    dir: p.dir,
    length: word.chars.length,
    requiredCrossings: requiredCrossings(word),
    targetCrossings: targetCrossings(word),
    intersections: crossCount,
    qualityPoints: pointsForCrossings(crossCount),
  };
}).sort((a, b) => a.no - b.no);


const grid = Array.from({ length: finalMetrics.height }, () => Array(finalMetrics.width).fill(null));
const cellInfo = Array.from({ length: finalMetrics.height }, () => Array.from({ length: finalMetrics.width }, () => ({ ch: null, h: null, v: null })));
for (const cell of state.grid.values()) {
  const rr = cell.r - state.minR;
  const cc = cell.c - state.minC;
  grid[rr][cc] = cell.ch;
  cellInfo[rr][cc] = { ch: cell.ch, h: cell.h, v: cell.v };
}


const unplaced = words.filter(w => !state.placements.has(w.id)).map(w => ({ no: w.id + 1, display: w.display, board: w.board }));
const output = {
  status: isSoundLayout(finalMetrics) ? "complete" : "best-effort",
  generatedAt: new Date().toISOString(),
  profile: source.profile ?? "auto",
  locale: source.locale ?? "en",
  preflight,
  rules: {
    horizontal: "left-to-right-only",
    vertical: "top-to-bottom-only",
    qualityPolicy,
    adaptiveShortEnabled,
    singleCrossingBudget,
    shortWordThreshold,
    shortWordShare,
    minimumCrossings: qualityPolicy === "strict" ? 2 : `at least 1 per entry; at most ${singleCrossingBudget} entries may have exactly 1`,
    targetCrossings: 2,
    scoring: { "4+": 10, "3": 6, "2": 4, "1": 2, "0": 0 },
    punctuation: "removed-during-normalization",
    cellUnit: "one-normalized-character-per-cell",
    maxSize: result.state.limit,
  },
  metrics: finalMetrics,
  words: words.map(w => ({ no: w.id + 1, display: w.display, board: w.board, length: w.chars.length, requiredCrossings: requiredCrossings(w), targetCrossings: targetCrossings(w) })),
  placements,
  unplaced,
  grid,
  cellInfo,
};
await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ final: finalMetrics, unplaced }));
