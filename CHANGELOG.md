# Changelog

## 0.1.1

- `SKILL.md` の「Search and retry policy」（失敗したときのやり直し手順）を強化。ルール（交差1か所の語の許容数など）は変えていない。
  - 盤面が `best-effort`（不合格）だったとき、再配置の回数（9番目の引数）を50から300に増やし、乱数のシードを最大4通り変えて試すようにした。
  - 3文字以下の短い語が多いリスト（例：日本語学習の単語24語）で、全語は置けたのに交差1か所の語が許容数を1つ超えて不合格になる、という失敗が起きていた。同じリストで再配置を300回にすると、試した3つのシードがすべて合格に変わった。

## 0.1.0

- 初回のGitHub公開版。ChatGPT/Codex用スキル「build-crossword-grid」（作成: 天気雨 (tenkiame)）を、単体で動くリポジトリとして移植。
- `scripts/build_workbook.mjs` を、ChatGPT/Codex専用の内部ライブラリ（`@oai/artifact-tool`）依存から、公開npmパッケージ `exceljs` を使う実装に書き換え。これにより、ChatGPT/Codexの外（自分のパソコンやCIなど）でも単体で動作するようになった。
- `scripts/generate_crossword.mjs` に、盤面全体が1つの連結成分になっているかどうかの独立したチェック（`placementConnectivity` / `metrics().connected`）を追加。
  - 修正前は、各単語ごとの交差数（`belowMinimum`）だけを見て完成（`complete`）と判定していたため、交差条件は満たしていても盤面全体としては2つ以上の孤立したかたまりに分かれている盤面を「完成」と誤判定することがあった（独立検証スクリプト側のBFSでは正しく`disconnected`として弾かれていたため、生成側と検証側の判定が食い違っていた）。
  - 修正後は、検索・再配置ループの各所と、最終的な `status: "complete"` 判定の両方で連結性を要件に含めるようにした。
- README / CHANGELOG / LICENSE / requirements.txt / .gitignore / examples を追加し、単体のオープンソースリポジトリとして体裁を整備。
