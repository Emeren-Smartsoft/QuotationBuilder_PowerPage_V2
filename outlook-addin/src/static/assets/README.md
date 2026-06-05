# Add-in icons

The manifest references these files (served from the deployed root, e.g.
`https://<host>/assets/icon-32.png`):

| File           | Size      | Used for                         |
| -------------- | --------- | -------------------------------- |
| `icon-16.png`  | 16×16     | menu / button (small)            |
| `icon-32.png`  | 32×32     | menu / button (medium)           |
| `icon-80.png`  | 80×80     | menu / button (large)            |
| `icon-64.png`  | 64×64     | add-in tile (`IconUrl`)          |
| `icon-128.png` | 128×128   | add-in tile (`HighResolutionIconUrl`) |

Drop the Smartsoft logo PNGs here at the sizes above. `build.js` copies the
whole `src/static/` tree (including this `assets/` folder) into `dist/`.

Until real icons are added, Outlook shows a generic placeholder — the add-in
still loads and works.
