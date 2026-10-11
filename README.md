# Antverse

クロヤマアリ（*Formica japonica*）のコロニーと環境を、生物学的知見に基づいてブラウザ上に再現するシミュレーション（Three.js / WebGPU）。

- 設計: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 根拠台帳: [docs/BIOLOGY.md](docs/BIOLOGY.md), [docs/ENGINEERING.md](docs/ENGINEERING.md)
- フェーズ報告: [docs/reports/](docs/reports/)

```
npm install
npm run dev     # http://localhost:5173
npm test
```

## 画質と公開先
- ローカル（`npm run dev`）は最高画質（ultra）、GitHub Pages などの公開版は軽量 + 自動調整（web）、スマホはタッチ操作向け（mobile）を自動で選びます。`?quality=` で切り替えられます。
- `main` に push すると GitHub Pages に自動で公開されます（`.github/workflows/deploy-pages.yml`）。初回のみ Settings → Pages → Source を「GitHub Actions」にしてください。
- 詳細は [docs/ARCHITECTURE.md §7](docs/ARCHITECTURE.md) を参照してください。
