# BIOLOGY — 生物学的根拠と仮定の台帳

コード中のパラメータ・行動ルールは、ここに定義した ID で根拠を参照する。
`tests/architecture/params.test.ts` が、参照切れや出典欄の欠落を検出する。

## 書式

- 見出し `### <ID> <短い名前>` が 1 項目。ID 体系:
  - `BIO-<分野>-<番号>` 文献に基づく生物学的知見。**出典** 欄は必須
  - `PHY-<分野>-<番号>` 物理定数・物理法則。**出典** 欄は必須
  - `ASM-<分野>-<番号>` 仮定（根拠が直接ないもの）。**検証** 欄（どう確かめるか）は必須
  - 技術的な選択（解像度・予算・UI）は `ENG-*` として [ENGINEERING.md](ENGINEERING.md) に置く
- 分野: `MOR` 形態, `LOC` 移動, `PHE` フェロモン, `NAV` ナビゲーション, `SOC` 社会行動, `DEV` 発育, `NST` 巣, `ENV` 環境, `SPC` 種の扱い
- **確度** は次のいずれか:
  - `原典確認済`: 原著論文・原記載を読んで値を確認した
  - `二次資料`: 図鑑・総説・データベースから取った。原典は未確認
  - `近縁種から補完`: *F. japonica* のデータがなく、近縁種の値を使う（種名を明記）
  - `仮定`: 根拠なし（ASM のみ）

---

## 種の扱い

### ASM-SPC-001 データ不足時の補完順序
- **内容**: *Formica japonica* Motschoulsky, 1866（クロヤマアリ）を基準種とする。値が得られない場合は
  ① *Formica* 属の他種 → ② 同じヤマアリ亜科 Formicinae の種（例: *Lasius niger*）→ ③ その他のアリ
  の順に補い、各項目の **確度** に `近縁種から補完（種名）` と書く。
- **理由**: 系統的に近いほど形態・化学感覚・行動様式が似ていると期待できるため。プロジェクトオーナーが 2026-10-11 に承認した方針。
- **検証**: *F. japonica* の一次データが見つかった時点で該当項目を差し替え、影響する実験（二重橋など）を再実行する。
- **使用箇所**: 方針（全フェーズ）

---

## 形態 (MOR)

### BIO-MOR-001 働きアリの体長
- **値**: 約 4.5–6 mm。代表値として 5 mm を使う。
- **出典**: 寺山守ほか (2014)『日本産アリ類図鑑』朝倉書店（著者表記・ページは要確認）、および日本産アリ類データベースのクロヤマアリ種解説。プロジェクト仕様の「体長約 5 mm」とも一致。
- **確度**: 二次資料（原典の記載ページは未確認。Phase 2 の形態データ整備で確認する）
- **使用箇所**: `ant.workerBodyLength`（スケールバーと Phase 0 の仮ボディの大きさ）

---

## 採用予定の文献（まだ ID 化していない）

フェーズで実際に使う時点で ID を割り当て、原典で値を確認する。書誌情報も採用時に原典で照合すること。

| 用途 (Phase) | 文献 | 主な内容 |
|---|---|---|
| 二重橋実験 (3) | Goss, Aron, Deneubourg & Pasteels (1989) *Naturwissenschaften* "Self-organized shortcuts in the Argentine ant" | 長さの異なる 2 経路で短い方へ収束 |
| 二重橋実験 (3) | Beckers, Deneubourg & Goss (1992) *J. Theor. Biol.* "Trails and U-turns in the selection of a path by the ant *Lasius niger*" | ヤマアリ亜科での経路選択とUターン（ASM-SPC-001 の②） |
| フェロモン追従 (3) | Deneubourg, Aron, Goss & Pasteels (1990) *J. Insect Behav.* "The self-organizing exploratory pattern of the Argentine ant" | 探索パターンのモデル |
| 歩容 (2) | Zollikofer (1994) *J. Exp. Biol.* "Stepping patterns in ants I–III" | *Formica* を含む三脚歩容・速度依存性 |
| 経路積分 (4) | Müller & Wehner (1988) *PNAS* "Path integration in desert ants, *Cataglyphis fortis*" | 帰巣ベクトルとその系統誤差 |
| 掘削 (5) | Buhl et al. (2004) *Behav. Ecol. Sociobiol.* "Self-organized digging activity in ant colonies" | 掘削量の時間変化とトンネル網 |
| 掘削 (5) | Khuong et al. (2016) *PNAS* "Stigmergic construction and topochemical information shape ant nest architecture" | 土粒の運搬・設置ルールと化学標識（*Lasius niger*） |
| 巣の構造 (5) | Tschinkel (2015) *J. Insect Sci.* "The architecture of subterranean ant nests" | 地下巣の形状・深さの比較 |
| 分業 (6) | Bonabeau, Theraulaz & Deneubourg (1996) *Proc. R. Soc. B* 固定反応閾値モデル | タスク配分の閾値モデル |
| 警報 (3, 7) | *Formica* の Dufour 腺分泌物（undecane など）と蟻酸に関する文献 — 要調査 | 警報フェロモンの成分と応答 |
| 道しるべ (3) | *F. japonica* の道しるべフェロモン（後腸由来か）に関する文献 — 要調査 | 堆積量・揮発時間 |
| 巣深度 (5) | *F. japonica* の巣の深さ・部屋数の実測 — 要調査 | 土壌ボクセル領域の深さ（現在は ENG の初期値） |
