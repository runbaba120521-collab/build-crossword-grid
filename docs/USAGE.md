# 利用ガイド

## ChatGPT / Codex のスキルとして使う場合

`agents/openai.yaml` に登録されている呼び出し用プロンプトの例です。

```
Use $build-crossword-grid to turn my uploaded word list into a validated crossword workbook.
```

単語リスト（Excel・CSV・テキストなど）を添付したうえで、上記のように依頼すると、`SKILL.md` に書かれた手順（正規化 → 生成 → 検証 → Excel化）で自動的に処理されます。

## コマンドラインで単体で使う場合

このリポジトリを `git clone` して `npm install` / `pip install -r requirements.txt` を済ませていれば、ChatGPTやCodexがなくても手元のパソコンだけで一連の処理を実行できます。手順は [README.md](../README.md) の「使い方」を参照してください。

### 実行例

`examples/sample_words.txt` を使う場合:

```bash
python3 scripts/prepare_words.py examples/sample_words.txt work/normalized.json --profile auto --locale auto
node scripts/generate_crossword.mjs work/normalized.json work/layout.json 120 20260921 60 60 adaptive 0.15 50
node scripts/validate_crossword.mjs work/layout.json work/validation.json
node scripts/build_workbook.mjs work/layout.json work/crossword.xlsx work/validation.json
```

`work/` は生成物を入れる作業用フォルダで、リポジトリの外に作ることをおすすめします（`.gitignore` で除外済みです）。

## うまく盤面ができないとき

- `generate_crossword.mjs` の標準エラー出力に `"status": "infeasible"` が出た場合は、単語同士で共有できる文字が足りていません。単語を増やす・入れ替える、または `adaptive` モードに切り替えることを検討してください。
- `"status": "best-effort"` の場合は、次の順に試してください。
  1. 再配置の回数（9番目の引数）を `300` にし、試行回数（3番目の引数）を `300`〜`600` に増やして、乱数シード（4番目の引数）を変えながら何回か試す。
  2. 全部の単語は置けたのに「交差が1か所だけの語」が多すぎて不合格になる場合は、最後に `--single-budget 数` を付けて、1交差の語をその数まで認める（adaptive モードのみ）。
  3. それでも置けない語が残る場合は、単語リストを見直す。盤面サイズの上限（5・6番目の引数）を広げるのも一つの手です。
- 置きにくい語（つながれる相手が3語以下の語）は、誘引配置によって自動で優先して置かれます。特別な指定は要りません。
- `validate_crossword.mjs` が `"ok": false` を返した場合は、`errors` の内容を確認してください。特に `Grid is disconnected` は、生成された盤面が2つ以上の孤立したかたまりに分かれてしまっている場合に出ます（v0.1.0でこのケースを生成側でも検出できるように修正済みです。詳しくは CHANGELOG.md を参照）。
