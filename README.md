# build-crossword-grid

> 言葉と言葉が、思いがけず出会う場所。

単語リスト（人名リストなど）から、日本語（カタカナ）／英語／日英混在に対応したクロスワード盤面と、そのままそのまま配布・印刷に使えるExcelワークブック（問題／解答／使用単語／配置評価の4シート）を自動生成するツールです。

もとは ChatGPT / Codex 用のスキルとして tomoari "ふじてん" fujino 氏が作成したものを、GitHub上で単体配布できる形に移植しました。生成・検証ロジックはオリジナルのまま、Excel出力部分だけをChatGPT専用の内部ライブラリから公開ライブラリ（[exceljs](https://github.com/exceljs/exceljs)）に書き換えています。変更点の詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## できること

- 単語（人名）の一覧から、盤面上で互いに交差するクロスワードを自動配置
- 日本語（カタカナ）・英語（ラテン文字）・混在のいずれにも対応した文字正規化
- 生成側とは別に、独立した検証スクリプトで盤面の正しさ（連結性・交差条件・文字の一致など）をチェック
- 問題（穴埋め用）・解答・使用単語一覧・配置評価の4シートからなるExcelブックを出力

## 必要な環境

- Node.js 18以上
- Python 3.9程度以上（`openpyxl` を使用。xlsx/xlsmを読み込む場合のみ必要）

## セットアップ

```bash
git clone <このリポジトリのURL>
cd build-crossword-grid
npm install
pip install -r requirements.txt
```

## 使い方

1. 入力ファイル（`.xlsx` / `.csv` / `.tsv` / `.txt` / `.json` のいずれか）を用意します。1列に単語（人名）を並べただけのシンプルな形式で構いません。

2. 正規化する。

   ```bash
   python3 scripts/prepare_words.py 入力ファイル normalized.json --profile auto --locale auto
   ```

3. 盤面を生成する。

   ```bash
   node scripts/generate_crossword.mjs normalized.json layout.json 120 20260921 60 60 adaptive 0.15 50
   ```

   引数は順に「入力／出力／試行回数／乱数シード／盤面サイズ上限／拡張後の上限／strict または adaptive／短い単語の許容しきい値／再配置の試行回数」です。

4. 独立検証する（`"ok": true` が出るまでは完成とみなしません）。

   ```bash
   node scripts/validate_crossword.mjs layout.json validation.json
   ```

5. Excelワークブックを作る。

   ```bash
   node scripts/build_workbook.mjs layout.json 出力.xlsx validation.json
   ```

`examples/` フォルダに、実際に生成した単語リストとワークブックのサンプルを置いています。

## 詳しい仕様

配置ルール・スコアリング・正規化の細かい挙動は [SKILL.md](./SKILL.md) と [references/input-and-quality.md](./references/input-and-quality.md) にまとめています。ChatGPT / Codex 上でこのスキルとして使う場合の設定は `agents/openai.yaml` を参照してください。

## ライセンス

[MIT License](./LICENSE)（オリジナル作者：tomoari "ふじてん" fujino）
