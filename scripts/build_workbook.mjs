#!/usr/bin/env node
/**
 * Build the four-sheet crossword workbook (Puzzle / Answer / Entries / Quality
 * Report) from a validated layout, using the public "exceljs" package.
 *
 * This is a portable rewrite of the original build_workbook.mjs, which called
 * an internal "@oai/artifact-tool" module that only exists inside ChatGPT's
 * Codex runtime. This version has no dependency on that runtime and works
 * with a plain `node` install anywhere, as long as `npm install` has been run
 * in this skill's directory first.
 */
import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

const layoutPath = process.argv[2];
const outputPath = process.argv[3];
const validationPath = process.argv[4];

if (!layoutPath || !outputPath || !validationPath) {
  console.error("Usage: node build_workbook.mjs layout.json output.xlsx validation.json");
  process.exit(2);
}

const layout = JSON.parse(await fs.readFile(layoutPath, "utf8"));
const validation = JSON.parse(await fs.readFile(validationPath, "utf8"));
if (layout.status !== "complete") throw new Error("Workbook creation requires a complete layout.");
if (!validation.ok) throw new Error("Workbook creation requires a passing validation report.");

const ja = layout.locale === "ja";
const labels = ja ? {
  sheets: ["問題", "解答", "使用単語", "配置評価"],
  titles: ["クロスワード　問題", "クロスワード　解答", "使用単語と配置結果", "配置評価"],
  entryHeaders: ["No.", "表示", "盤面表記", "文字数", "配置", "開始行", "開始列", "最低交差", "実交差", "ポイント"],
  horizontal: "横（左→右）", vertical: "縦（上→下）",
  normalizedNote: "表示名は原文を保持し、盤面表記には正規化後の文字列を記録しています。",
  metricHeaders: ["指標", "結果"],
  metricNames: ["収録語数", "未配置", "盤面サイズ", "使用マス", "交差数", "総合点", "2回以上交差する語", "1回交差する語", "1交差許容数", "0回交差する語", "最低条件未満", "盤面密度", "横配置", "縦配置", "連結状態", "独立検証"],
  connected: "全語が1つに連結", pass: "合格",
  ruleHeaders: ["配置ルール", "設定"],
  rules: [
    ["横方向", "左から右のみ"], ["縦方向", "上から下のみ"],
    ["交差", "同じ文字で直交する場合のみ"], ["接触", "交差以外の隣接・平行重複は禁止"],
    ["文字単位", "正規化後の1文字を1マスとして扱う"], ["ヒント", "なし"],
  ],
} : {
  sheets: ["Puzzle", "Answer", "Entries", "Quality Report"],
  titles: ["Crossword Puzzle", "Crossword Answer", "Entries and placements", "Quality report"],
  entryHeaders: ["No.", "Display", "Grid form", "Length", "Direction", "Start row", "Start column", "Minimum", "Actual", "Points"],
  horizontal: "Horizontal (left to right)", vertical: "Vertical (top to bottom)",
  normalizedNote: "Display text is preserved. Grid form shows the normalized characters used in the puzzle.",
  metricHeaders: ["Metric", "Result"],
  metricNames: ["Entries placed", "Unplaced", "Board size", "Occupied cells", "Intersections", "Total quality score", "Entries with 2+ crossings", "Entries with 1 crossing", "One-crossing budget", "Entries with 0 crossings", "Below minimum", "Density", "Horizontal entries", "Vertical entries", "Connectivity", "Independent validation"],
  connected: "All entries in one component", pass: "PASS",
  ruleHeaders: ["Placement rule", "Setting"],
  rules: [
    ["Horizontal", "Left to right only"], ["Vertical", "Top to bottom only"],
    ["Crossings", "Perpendicular matching characters only"], ["Touching", "No non-crossing adjacency or parallel overlap"],
    ["Cell unit", "One normalized character per cell"], ["Clues", "None"],
  ],
};

const colors = {
  ink: "172033", navy: "243B53", blue: "486581", pale: "F2F5F8",
  stripe: "F7F9FB", white: "FFFFFF", block: "263238", border: "7B8794",
  amber: "FFF3CD", green: "E8F5E9",
};
const font = ja ? "Yu Gothic" : "Calibri";

function argb(hex) {
  return `FF${hex.replace("#", "").toUpperCase()}`;
}

function pxToExcelWidth(px) {
  // Rough px -> Excel "character width" conversion for the default font.
  return Math.max(2, (px - 5) / 7);
}

function pxToPoints(px) {
  return px * 0.75;
}

function fillCell(cell, hex) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(hex) } };
}

function fontCell(cell, opts) {
  cell.font = {
    name: opts.name ?? font,
    size: opts.size ?? 10,
    bold: Boolean(opts.bold),
    italic: Boolean(opts.italic),
    color: { argb: argb(opts.color ?? colors.ink) },
  };
}

function borderRange(ws, r1, c1, r2, c2, hex, style = "thin") {
  const color = { argb: argb(hex) };
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const cell = ws.getCell(r, c);
      cell.border = {
        top: { style, color },
        left: { style, color },
        bottom: { style, color },
        right: { style, color },
      };
    }
  }
}

const workbook = new ExcelJS.Workbook();
workbook.creator = "build-crossword-grid";
workbook.created = new Date(layout.generatedAt ?? Date.now());

const problem = workbook.addWorksheet(labels.sheets[0], { properties: { tabColor: { argb: argb(colors.blue) } }, views: [{ showGridLines: false }] });
const answer = workbook.addWorksheet(labels.sheets[1], { properties: { tabColor: { argb: argb(colors.navy) } }, views: [{ showGridLines: false }] });
const entries = workbook.addWorksheet(labels.sheets[2], { properties: { tabColor: { argb: argb("8AA6B8") } }, views: [{ showGridLines: false }] });
const quality = workbook.addWorksheet(labels.sheets[3], { properties: { tabColor: { argb: argb("B7C9D6") } }, views: [{ showGridLines: false }] });

function summaryText() {
  const m = layout.metrics;
  if (layout.rules.qualityPolicy === "adaptive") {
    return ja
      ? `${m.placed}語収録　${m.width}列×${m.height}行　1交差は最大${layout.rules.singleCrossingBudget}語・全語1交差以上　横は左→右、縦は上→下のみ`
      : `${m.placed} entries · ${m.width} × ${m.height} · up to ${layout.rules.singleCrossingBudget} one-crossing entries, none with zero · forward directions only`;
  }
  return ja
    ? `${m.placed}語収録　${m.width}列×${m.height}行　全語2交差以上　横は左→右、縦は上→下のみ`
    : `${m.placed} entries · ${m.width} columns × ${m.height} rows · at least 2 crossings each · forward directions only`;
}

function title(sheet, text, subtitle) {
  const titleCell = sheet.getCell(2, 2);
  titleCell.value = text;
  fontCell(titleCell, { size: 15, bold: true });
  const subtitleCell = sheet.getCell(3, 2);
  subtitleCell.value = subtitle;
  fontCell(subtitleCell, { size: 10, italic: true, color: colors.blue });
}

function buildGridSheet(sheet, heading, showLetters) {
  const { height, width } = layout.metrics;
  title(sheet, heading, summaryText());
  const startRow = 5;
  const startCol = 1;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const ch = layout.grid[r][c];
      const cell = sheet.getCell(startRow + r, startCol + c);
      if (ch) {
        cell.value = showLetters ? ch : null;
        fillCell(cell, colors.white);
        fontCell(cell, { size: 9, bold: true });
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = {
          top: { style: "thin", color: { argb: argb(colors.border) } },
          left: { style: "thin", color: { argb: argb(colors.border) } },
          bottom: { style: "thin", color: { argb: argb(colors.border) } },
          right: { style: "thin", color: { argb: argb(colors.border) } },
        };
      } else {
        fillCell(cell, colors.block);
      }
    }
  }
  for (let c = 0; c < width; c++) {
    sheet.getColumn(startCol + c).width = pxToExcelWidth(22);
  }
  for (let r = 0; r < height; r++) {
    sheet.getRow(startRow + r).height = pxToPoints(22);
  }
  sheet.views = [{ showGridLines: false, state: "frozen", ySplit: startRow - 1 }];
}

buildGridSheet(problem, labels.titles[0], false);
buildGridSheet(answer, labels.titles[1], true);

// Entries sheet
{
  const sheet = entries;
  const titleCell = sheet.getCell(2, 1);
  titleCell.value = labels.titles[2];
  fontCell(titleCell, { size: 15, bold: true });
  const subtitleCell = sheet.getCell(3, 1);
  subtitleCell.value = labels.normalizedNote;
  fontCell(subtitleCell, { size: 10, italic: true, color: colors.blue });

  const headerRow = 5;
  labels.entryHeaders.forEach((text, i) => {
    const cell = sheet.getCell(headerRow, i + 1);
    cell.value = text;
    fillCell(cell, colors.navy);
    fontCell(cell, { bold: true, color: colors.white });
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  borderRange(sheet, headerRow, 1, headerRow, labels.entryHeaders.length, colors.white);

  const placementByNo = new Map(layout.placements.map(p => [p.no, p]));
  const entryRows = layout.words.map(word => {
    const p = placementByNo.get(word.no);
    return [
      word.no, word.display, word.board, word.length,
      p.dir === "H" ? labels.horizontal : labels.vertical,
      p.row, p.col, p.requiredCrossings ?? word.requiredCrossings ?? 2, p.intersections, p.qualityPoints,
    ];
  });
  entryRows.forEach((row, i) => {
    const rowNumber = headerRow + 1 + i;
    row.forEach((value, c) => {
      const cell = sheet.getCell(rowNumber, c + 1);
      cell.value = value;
      fontCell(cell, {});
      cell.alignment = { vertical: "middle", horizontal: (c === 0 || c >= 3) ? "center" : "left" };
    });
    if (i % 2 === 1) {
      for (let c = 1; c <= labels.entryHeaders.length; c++) fillCell(sheet.getCell(rowNumber, c), colors.stripe);
    }
  });
  borderRange(sheet, headerRow + 1, 1, headerRow + entryRows.length, labels.entryHeaders.length, "D9E2EC");

  const entryWidths = [52, 235, 235, 62, 170, 76, 82, 76, 76, 76];
  entryWidths.forEach((px, i) => { sheet.getColumn(i + 1).width = pxToExcelWidth(px); });
  sheet.views = [{ showGridLines: false, state: "frozen", ySplit: headerRow }];
}

// Quality report sheet
{
  const sheet = quality;
  const titleCell = sheet.getCell(2, 1);
  titleCell.value = labels.titles[3];
  fontCell(titleCell, { size: 15, bold: true });

  const metricHeaderRow = 4;
  labels.metricHeaders.forEach((text, i) => {
    const cell = sheet.getCell(metricHeaderRow, i + 1);
    cell.value = text;
    fillCell(cell, colors.navy);
    fontCell(cell, { bold: true, color: colors.white });
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  borderRange(sheet, metricHeaderRow, 1, metricHeaderRow, 2, colors.white);

  const m = layout.metrics;
  const metricValues = [
    m.placed, layout.unplaced.length, `${m.width} × ${m.height}`, m.cells, m.intersections,
    m.qualityPoints, m.multi, m.single, layout.rules.singleCrossingBudget, m.zero, m.belowMinimum, m.density,
    layout.placements.filter(p => p.dir === "H").length,
    layout.placements.filter(p => p.dir === "V").length,
    labels.connected, labels.pass,
  ];
  labels.metricNames.forEach((name, i) => {
    const row = metricHeaderRow + 1 + i;
    const nameCell = sheet.getCell(row, 1);
    nameCell.value = name;
    fillCell(nameCell, colors.pale);
    fontCell(nameCell, {});
    const valueCell = sheet.getCell(row, 2);
    valueCell.value = metricValues[i];
    fillCell(valueCell, colors.green);
    fontCell(valueCell, {});
    if (name === labels.metricNames[11]) valueCell.numFmt = "0.0%";
  });
  borderRange(sheet, metricHeaderRow + 1, 1, metricHeaderRow + labels.metricNames.length, 2, "D9E2EC");

  const ruleStart = metricHeaderRow + labels.metricNames.length + 3;
  labels.ruleHeaders.forEach((text, i) => {
    const cell = sheet.getCell(ruleStart, i + 1);
    cell.value = text;
    fillCell(cell, colors.blue);
    fontCell(cell, { bold: true, color: colors.white });
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  borderRange(sheet, ruleStart, 1, ruleStart, 2, colors.white);

  const crossingRule = layout.rules.qualityPolicy === "adaptive"
    ? (ja ? `全語1か所以上、1交差は最大${layout.rules.singleCrossingBudget}語（目標2か所以上）` : `At least one each; up to ${layout.rules.singleCrossingBudget} one-crossing entries (target: two or more)`)
    : (ja ? "各語2か所" : "Two per entry");
  const ruleRows = [
    ...labels.rules.slice(0, 4),
    [ja ? "最低交差数" : "Minimum crossings", crossingRule],
    [ja ? "交差ポイント" : "Crossing points", ja ? "4以上=10、3=6、2=4、1=2、0=0" : "4+=10, 3=6, 2=4, 1=2, 0=0"],
    ...labels.rules.slice(4),
    [ja ? "盤面上限" : "Maximum size", `${layout.rules.maxSize} × ${layout.rules.maxSize}`],
  ];
  ruleRows.forEach((row, i) => {
    const rowNumber = ruleStart + 1 + i;
    const nameCell = sheet.getCell(rowNumber, 1);
    nameCell.value = row[0];
    fillCell(nameCell, colors.pale);
    fontCell(nameCell, {});
    const valueCell = sheet.getCell(rowNumber, 2);
    valueCell.value = row[1];
    fillCell(valueCell, colors.amber);
    fontCell(valueCell, {});
  });
  borderRange(sheet, ruleStart + 1, 1, ruleStart + ruleRows.length, 2, "D9E2EC");

  sheet.getColumn(1).width = pxToExcelWidth(190);
  sheet.getColumn(2).width = pxToExcelWidth(360);
}

await fs.mkdir(path.dirname(outputPath) || ".", { recursive: true });
await workbook.xlsx.writeFile(outputPath);
console.log(JSON.stringify({ outputPath, sheets: labels.sheets, metrics: layout.metrics }));
