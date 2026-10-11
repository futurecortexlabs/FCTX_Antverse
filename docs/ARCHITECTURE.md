# Antverse — アーキテクチャ

Phase 0 着手前の提案に、プロジェクトオーナーの承認内容（2026-10-11）を反映した確定版。
**[Phase 0 実装済]** と書いた部分はコードに存在する。それ以外は後続フェーズの設計で、各フェーズの着手時に見直す。

## 承認済みの決定事項（2026-10-11）

| # | 決定 | 内容 |
|---|---|---|
| 1 | フェロモン場は CPU に置く | 当初仕様の「GPU 上の2Dグリッド」から変更。場の本体は Worker 内の疎なタイル格子に置き、GPU は可視化だけに使う。GPU compute 版は、計測でボトルネックと分かった時点で第2バックエンドとして追加する |
| 2 | 受け渡しは SharedArrayBuffer | COOP/COEP ヘッダが必要。ローカルまたは自前ホストを前提とする。ヘッダがない環境ではコピー転送に自動で切り替わる |
| 3 | 性能の基準 GPU | NVIDIA GeForce RTX 5070 Ti |
| 4 | 土壌ボクセル | ボクセル 1 mm、巣領域 512 × 512 × 1024 mm（初期値） |
| 5 | 種のデータ不足の補い方 | ASM-SPC-001（*F. japonica* → *Formica* 属 → ヤマアリ亜科の順） |
| 6 | 早送り | 速度プリセット ×0.25〜×128 と MAX **[Phase 0 実装済]**。長期のライフサイクルは Phase 6 で更新レートを分ける仕組みと合わせて設計する |

## 1. 全体構成 [Phase 0 実装済]

```
┌─ Main thread ─────────────────────┐        ┌─ Sim Worker（正となる状態）──────────┐
│ Three.js WebGPURenderer           │ ◀snap─ │ 固定 Δt ループ・時間倍率               │
│  （WebGL2 バックエンドへ自動切替）    │        │ World（SoA・ルール・状態ハッシュ）      │
│ HUD・カメラ・FPS/GPU 計測・補間     │ ─cmd▶  │ スナップショットの書き出し              │
└───────────────────────────────────┘        └──────────────────────────────────────┘
        同じ World が Node（vitest、scripts/bench-sim.ts、ヘッドレス実験）でもそのまま動く
```

### 層と依存の向き
`tests/architecture/layers.test.ts` で検査している。

| 層 | 役割 | import してよい層 |
|---|---|---|
| `core/` | 単位・乱数・決定論的数学関数・時計・SoA・ハッシュ | core |
| `config/` | パラメータ定義・プリセットの合成と検証 | core, config |
| `terrain/` | 地表の決定論的な生成と問い合わせ（Phase 1）。シミュレーションと描画が同じものを使う | core, config, terrain |
| `sim/` | World と行動ルール（three.js・DOM 非依存） | core, config, terrain, sim |
| `worker/` | Worker の入口・実行ループ・スナップショット | core, config, sim, worker |
| `render/` | three.js による描画 | core, config, terrain, render, `worker/protocol.ts` |
| `bench/` | 性能スイープ | core, config, bench |
| `app/` | 起動処理・HUD・メイン側のホスト | core, config, terrain, render, bench, app, `worker/protocol.ts` |

three.js を import してよいのは `render/` と `app/` だけ。

### スナップショットの受け渡し
- 各スロットのレイアウトは次のとおり。ヘッダは Float64×16（tick・シミュ時刻・公開時刻・個体数・倍率・一時停止など）。
  個体ごとに float×8（位置 3、クォータニオン 4、歩容位相 1）と u32×1（カースト・フラグ・運搬物・世代番号の下位 8 bit）。
- **共有メモリ方式**: SharedArrayBuffer のスロット 3 枚を、ロックなしのトリプルバッファで受け渡す。
  `Atomics.exchange` で中央スロットを交換するので、書き手は待たず、読み手は常に最新の完成版を得る。
- **コピー方式**: 同じレイアウトの ArrayBuffer を postMessage で転送し、使い終わったバッファは Worker に返して再利用する。
- **補間**: メイン側は直前と最新のスナップショットを保持し、最新から「1 tick」か「平滑化したスナップショット間隔」の大きい方だけ遅れた時刻を描画する。
  そのため早送り中も、2 枚の間を滑らかに補間できる。

## 2. 単位と座標系 [Phase 0 実装済]
- 1 ワールド単位 = 1 mm。時間は s、質量は mg、温度は °C、角度は rad。
- Y が上の右手系（three.js と同じ）。地表は y = 0、地下は y < 0。
- モデルのローカル座標では前が +X、上が +Y。向き角 h の前方ベクトルは (cos h, 0, −sin h)。
- 深度は 0.05 mm〜20 m の範囲を扱うため reversed-Z を使う。非対応のバックエンドでは対数深度に切り替える。

## 3. 再現性（決定論）[Phase 0 実装済]
- **乱数はカウンタ方式**: `rand(seed, stream, entity, tick, k)` は整数ハッシュの純関数で、状態を持たない。
  更新順や Worker の分割に依存しない。乱数の用途ごとに stream ID を割り当て、番号は追加のみとする（既存の番号は変えない）。
- **決定論的数学関数**: `core/dmath.ts` に sin・cos・atan・atan2・exp・log を自前実装している。
  ECMAScript が結果を厳密に定めているのは四則演算と sqrt だけなので、`core`・`config`・`sim` では Math.sin などの使用を禁止し、テストで検査している。
  あわせて `Math.random`、`Date.now`、`performance.now`、`**` 演算子も禁止。
- **状態ハッシュ**: `World.stateHash()` はシード・tick・空きスロットの一覧・全 SoA フィールドのハッシュ。
- **時間の扱い**: 固定 Δt で進め、壁時計の時間に倍率を掛けて積算する。追いつけない分は捨てるが、捨てても時間の進み方が変わるだけで、tick N の状態は変わらない。
  これはテスト（`sim-runner.test.ts`）と、アプリ内の「Determinism check」ボタン（実行中の World と、同じ tick までヘッドレスで再実行した結果を比較）で確認できる。
- **今後の注意**: 複数の Worker に分割する段階では、1 tick を 感知 → 判断 → 行動 → 相互作用 の段階に分け、相互作用は (i<j) の決まった順で解決する。

## 4. データ設計

### 4.1 エージェント（SoA）[Phase 0 で一部実装]
容量固定の TypedArray プールを使う。参照は `ref = (gen << 20) | slot` で、死んだ個体への古い参照を検出できる。
フィールドは**必要になったフェーズで末尾に追加する**（順序を変えると状態ハッシュの定義が変わるため）。

| フィールド | 型 | 用途 | Phase |
|---|---|---|---|
| posX/posY/posZ | f32 | 位置 (mm) | 0 ✓ |
| rot | f32×4 | 姿勢のクォータニオン | 0 ✓ |
| gaitPhase | f32 | 三脚歩容の位相（移動距離 ÷ ストライド長で進むので足が滑らない） | 0 ✓ |
| caste, flags, carryKind | u8 | カースト・生死などのフラグ・運搬物 | 0 ✓ |
| gen | u16 | 世代番号 | 0 ✓ |
| speed, heading | f32 | 速度・地面上の向き角（Phase 2 で地表面の座標系による操舵に置き換える） | 0 ✓ |
| colony | u16 | 所属コロニー | 6 |
| domain | u8 | 地表 / 地下 / 物体の上 | 2 |
| state, stateTime | u8, f32 | 行動の状態機械 | 2 |
| homeVec, odometer | f32×2, f32 | 経路積分（水平面に投影） | 4 |
| task, threshold[T] | u8, f32×T | 分業（反応閾値モデル） | 6 |
| ageDays | f32 | 齢による分業 | 6 |
| crop, reserve | f32 | 社会胃・体内エネルギー | 6 |
| carryMass, carryRef, targetRef | f32, u32, u32 | 運搬・追従 | 3 |

- 脚の関節角は状態として持たず、描画側で gaitPhase と地形への問い合わせから IK で求める（LOD0 のみ）。
- 近傍探索には一様グリッドを使い、毎 tick カウンティングソートで作り直す（走査順も決定的）。
- 運ばれる物（卵・幼虫・蛹・餌・土粒・死骸）は別の Item プールに置く。

### 4.2 フェロモン場（Phase 3）
- 地表の水平面上の疎なタイル格子。セルは 1 mm（仮定）、タイルは 64×64 セル。濃度のあるタイルだけ確保し、Float32Array 2 枚を交互に読み書きする。
- 蒸発は `c *= k`（k は設定の読み込み時に dexp で 1 回だけ計算）、拡散は 5 点ステンシルの陽解法で、安定条件を起動時に検証する。
- チャネルは `trail` と `alarm`。巣へ戻るためのフェロモンは持たない（帰巣は経路積分と視覚が担う）。
- GPU には、変化のあったタイルだけをヒートマップ用テクスチャへ転送する。

### 4.3 ボクセル土壌（Phase 5）
- ボクセル 1 mm、チャンク 32³。チャンクは UNIFORM（配列を持たない）か DENSE。領域は 512 × 512 × 1024 mm。
- DENSE のボクセルは `fill`・`material`・`moisture`・`chem` を u8 で持つ（チャンク内も SoA）。
- 温度は土壌熱伝導の解析解 `T(z,t) = T̄ + A·e^(−z/d)·sin(ωt − z/d)` を基本に、局所的な補正だけ粗い格子（8 mm）で持つ。
- 再メッシュ化は、変更のあったチャンクだけ Worker 上の Surface Nets で行う。掘った土は Item として地表に運ばれ、地表を盛り上げる。

### 4.5 地表 [Phase 1 実装済]
`src/terrain/` は (config, seed) だけで決まる純粋な関数の集まりです。シミュレーション Worker と描画側は、それぞれ同じ `Terrain` を作ります（生成は約 80 ms）。
同じものになることは、ダイジェスト（ハッシュ）で確かめます。World の状態ハッシュにも、地形のダイジェストを含めています。

| 要素 | 表現 | シミュレーションの問い合わせ | 描画 |
|---|---|---|---|
| 土の起伏 | 勾配ノイズの和。大きな起伏（2 m → 6 cm）と細かい凹凸（16 mm → 0.25 mm、ハースト指数 0.6）。導関数は解析的に求める | `ground(x, z, h)`（h = 0 で全詳細） | 四分木 LOD のチャンク + シェーダーによる細部 |
| 粗砂粒 0.63–2 mm | 2 mm セルごとに決定論的に生成する楕円体（保存しない） | `grainTop` | カメラ近くだけインスタンス描画 |
| 小石 2–30 mm | 楕円体を約 1,000 個保存 | `pebbleTop` | InstancedMesh |
| 落ち葉 | 卵形。16×8 の格子に、垂れ下がった形の高さを保存（下の葉にも重なる） | `leafTop` | 同じ格子のメッシュ + 葉脈シェーダー |
| 草 | 株ごとの葉。中心線をパラメータで表す（Phase 2 で登る対象） | `bladePoints` | 同じ折れ線のリボン |
| 足が乗る高さ | 上のものの最大値 | `supportHeight(x, z)`（約 0.8 µs） | — |

- **パッチ**: 落葉・草・礫の分布は、低周波ノイズの閾値で決める。閾値は、指定した被覆率に合うよう自動で較正する。巣口から 120 mm は裸地にする。
- **描画の LOD**:
  - 形状誤差の上限（落とした凹凸 + 補間誤差の 3σ）が画面上で 2 px を超えるノードを分割する。
  - チャンクの頂点間隔より細かい凹凸は、シミュレーションと同じハッシュと振幅のノイズを TSL で再現し、ピクセル単位の法線と明るさとして描く。
  - チャンク間の隙間はスカートでふさぐ。
  - 4 つの子がそろうまでは親を描くので、地面に穴も重なりも出ない。
- **カメラのガード**: カメラは常に「足が乗る高さ + 0.1 mm + ニア面の距離」より上にあり、周囲 0.4 mm も確かめる。注視点も地表より下に行かない。

### 4.4 パラメータ [Phase 0 実装済]
- `src/config/params.ts` の全値が `{value, unit, ref, min?, max?, integer?}` を持つ。
- ref の種類: `BIO-*`・`PHY-*`・`ASM-*` は [BIOLOGY.md](BIOLOGY.md)、`ENG-*` は [ENGINEERING.md](ENGINEERING.md) に定義する。
- テストで次の 2 点を検査している。
  - 全パラメータの ref と、ソースコード中に出てくる ID がすべて台帳に存在すること
  - BIO/PHY 項目に出典と確度が、ASM 項目に検証方法が書かれていること
- 上書きの方法: `config/presets/*.json`、URL の `?preset=`、`?seed=`、`?set=path=value`。
  未知のキー・型違い・範囲外の値はエラーになる。
- 行動ルール（`sim/rules/`）では、構造的な定数（0〜4、0.5）以外の数値リテラルを禁止し、テストで検査している。

## 5. ディレクトリ
```
config/presets/        実験条件の上書き JSON
docs/                  ARCHITECTURE / BIOLOGY / ENGINEERING / reports
scripts/               bench-sim.ts（Node のシミュレーションベンチ）、browser-run.ts（CDP による実ブラウザでの計測）、vite-report-plugin.ts（開発サーバーでのレポート保存）
src/core/              単位・乱数・決定論的数学関数・時計・SoA・ハッシュ・ローリング統計
src/config/            スキーマ・既定値・読み込み
src/terrain/           ノイズ、地表（土・粒・小石・落葉・草）、空間索引
src/sim/               World, headless, agents/, rules/
src/worker/            protocol, sim-runner, snapshot-writer, sim.worker
src/render/            renderer, environment（空・霧・影）, interpolation, ants/, terrain/（LOD・チャンク・材質・地表の物体・カメラのガード）, debug/
src/app/               main, sim-host, hud/, report
src/bench/             描画ベンチのスイープ
tests/architecture/    層・決定論の衛生・マジックナンバー・根拠ID
tests/determinism/     シード再現性
tests/experiments/     ヘッドレス統計実験（Phase 3 以降）
```

## 6. 実行方法
```
npm install
npm run dev        # http://localhost:5173 （COOP/COEP ヘッダ付き）
npm test           # 全テスト
npm run typecheck
npm run bench:sim  # Node でのシミュレーション単体ベンチ → docs/reports/bench/phase-<n>-sim-node.csv
# 以下は dev サーバー起動中に実行する（Chrome を DevTools 経由で操作）
npm run browser:smoke   # 両バックエンドの起動確認と決定論チェック
npm run browser:shots   # Phase 0 のスクリーンショット → docs/reports/phase-0/
node scripts/browser-run.ts terrain   # Phase 1 の地形の視点 8 種 + 計測値 → docs/reports/phase-1/
npm run bench:render    # 個体数スイープ（WebGL2 は `node scripts/browser-run.ts bench webgl`）
npm run dev:lan         # 同じ Wi-Fi のスマホから開けるように公開する
npm run build:artifact  # Artifact 用のページを dist/artifact.html に出力する
```

URL オプション:
- `?bench=1`: 描画ベンチ。結果は docs/reports/bench/phase-<n>-*.csv に保存される
- `?backend=webgl`: WebGL2 バックエンドを強制する
- `?seed=N`、`?preset=ants-10k`、`?set=debugWalk.count=5000`

キー操作: Space（一時停止 / 再開）、`.`（1 ステップ進める）、`[` `]`（遅く / 速く）、`M`（MAX）。

## 7. 画質ティアと公開先

### 画質ティア（`src/app/device.ts`、ENG-QLT-001）
起動した場所と端末から自動で選び、`config/presets/quality-<tier>.json` を適用します。`?quality=ultra|web|mobile` で強制でき、URL の `?preset=` と `?set=` はその後に適用されるので優先されます。

| ティア | 選ばれる条件 | 方針 | 主な設定 |
|---|---|---|---|
| **ultra** | localhost・LAN アドレス（デスクトップ） | 最高画質 | 地形誤差 1.5 px、影 4096、ピクセル比は画面どおり、自動調整なし |
| **web** | GitHub Pages・Artifact などのホスト | 遅くても見られる | 地形誤差 3 px、影 2048、ピクセル比 1.25 まで、自動調整あり |
| **mobile** | 指で操作する端末（短辺 820 px 未満） | タッチで操作できる | チャンク 32 マス、地形誤差 4 px、影 1024、HUD 折りたたみ、自動調整あり |

- **ティアが変えるのは描画と UI の値だけ**です（テストで検査）。どのティアでも、同じシードから同じ世界になります。
- **自動調整**（`src/app/quality-governor.ts`）: 30 fps を下回る状態が続くと、ボトルネックに効く方から下げます。
  - CPU 律速なら地形の細かさを下げます（チャンク数が減ります）。
  - GPU 律速、または GPU 時間が測れない場合は解像度を下げます。
  - 余裕が戻ったら、ティアの設定値まで戻します。
  - CPU を 6 倍遅くした検証では、解像度を保ったまま 30 → 43 fps に回復し、負荷を戻すと 10 秒で元の画質に戻りました。
- **スマホ向けの UI**:
  - 幅 600 px 未満では HUD を画面下にまとめ、ボタン列は横にスクロールします。`≡` / `×` で詳細表示を開閉します。
  - タッチ端末ではボタンを大きくし、ノッチなどの切り欠き（safe-area）を避けて配置します。
  - 1 本指で回転、2 本指でズームと移動です。
  - ページが非表示になると自動で一時停止します。
- **非対応環境への対応**:
  - WebGPU がなければ WebGL2 で描画します。reversed-Z が使えなければ対数深度に切り替えます。
  - 共有メモリが使えない環境（GitHub Pages・Artifact・HTTPS でない LAN）ではコピー転送になります。

### 公開先
| 方法 | 手順 | ティア | 制約 |
|---|---|---|---|
| ローカル | `npm run dev` | ultra | — |
| **GitHub Pages** | `main` に push すると `.github/workflows/deploy-pages.yml` が、型チェック・全テスト・ビルド・公開を行う。初回だけ、リポジトリの Settings → Pages → Source を「GitHub Actions」にする | web（スマホなら mobile） | 共有メモリなし（コピー転送）。無料プランでは公開リポジトリのみ。CI のテストは、Linux でも基準ハッシュが一致することの確認を兼ねる |
| Artifact | `npm run build:artifact` で dist/artifact.html と assets を発行する | web / mobile | 非公開（所有者と共有相手のみ） |
| 同じ Wi-Fi の LAN | `npm run dev:lan` を実行し、スマホで `http://<PCのIP>:5173` を開く | mobile | Windows ファイアウォールで受信の許可が必要。HTTPS でないため WebGL2 とコピー転送になる |

検証:
- `node scripts/browser-run.ts tiers`: 各ティアの設定と、CPU を遅くしたときの自動調整を確認する。
- `node scripts/browser-run.ts mobile [webgl|-] [url]`: 390×844・DPR 3・タッチのエミュレーションで確認する。
