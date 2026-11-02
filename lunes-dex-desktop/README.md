# Lunex Desktop

Electron shell around the Lunex DEX web app (`../lunes-dex-main`), shipped as
installers for macOS (dmg + zip, x64/arm64), Windows (NSIS, x64) and Linux
(AppImage + deb, x64), with auto-update from GitHub Releases.

The desktop app contains **no trading, signing or financial logic of its own**.
It packages the same Vite build as the website and serves it from a private
`app://lunex/` origin. All authority stays in `spot-api` and the contracts.

## Layout

```
lunes-dex-desktop/
  src/main/        main process (window, app:// protocol, CSP, menu, updater, IPC)
  src/preload/     sandboxed preload exposing window.lunexDesktop
  src/lunexDesktop.d.ts  type of window.lunexDesktop (copy into the web app)
  scripts/         build-web, runtime-config generation, checks
  assets/          icon source (icon.svg -> icon.png 1024px), mac entitlements
  electron-builder.yml
  web/             (generated) copy of lunes-dex-main/build — not committed
  dist/            (generated) compiled main/preload — not committed
  release/         (generated) installers — not committed
```

## Development

```bash
cd lunes-dex-main && npm install && npm run dev      # Vite on http://localhost:3000
cd lunes-dex-desktop && npm install && npm run dev   # Electron pointing at Vite
```

`npm run dev` sets `LUNEX_DEV_SERVER_URL=http://localhost:3000`. That variable
is ignored in packaged builds and only accepted for loopback http URLs. In dev
mode the CSP is whatever Vite serves (none); the strict CSP applies to the
packaged `app://lunex` bundle. DevTools are available only in dev.

## Building locally

```bash
cd lunes-dex-desktop
npm install
export REACT_APP_SPOT_API_URL=https://api.example.com   # see "Environment"
export REACT_APP_SPOT_WS_URL=wss://ws.example.com
npm run build:web          # builds lunes-dex-main with REACT_APP_DESKTOP=true, copies to ./web
                           # (add -- --skip-typecheck to run only `vite build`)
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:linux   # or dist:mac / dist:win / dist
ls release/
```

`dist:*` scripts never publish. macOS installers must be built on macOS;
Windows installers on Windows (or Linux with Wine). CI builds all three.

## Environment

The web bundle reads `REACT_APP_*` at build time exactly like the website
(`process.env` first, then `lunes-dex-main/.env*`). The same values are written
to `dist/runtime-config.json` so the main process can derive the CSP
`connect-src` (spot-api, spot WS, Lunes RPCs, WalletConnect relay).

| Variable | Purpose |
|---|---|
| `REACT_APP_SPOT_API_URL` | spot-api base URL (**must be https** in release builds; http is only allowed for localhost) |
| `REACT_APP_SPOT_WS_URL` | spot-api WebSocket (`wss://…`) |
| `REACT_APP_API_URL` | legacy fallback for the API URL |
| `REACT_APP_NETWORK`, `REACT_APP_RPC_TESTNET`, `REACT_APP_RPC_MAINNET`, `REACT_APP_GENESIS_HASH`, `REACT_APP_LUNES_GENESIS_HASH`, `REACT_APP_MAINTENANCE` | network selection / status |
| `REACT_APP_*_CONTRACT`, `REACT_APP_TOKEN_*`, `REACT_APP_LP_TOKEN_*`, `REACT_APP_LISTING_FEE_TOKEN` | contract and token addresses (see `lunes-dex-main/.env.example`) |
| `REACT_APP_WALLETCONNECT_PROJECT_ID` | WalletConnect Cloud project id |
| `REACT_APP_DESKTOP` | set to `true` automatically by `build:web` |
| `LUNEX_CSP_EXTRA_CONNECT_SRC` | optional, comma-separated extra `connect-src` origins (https/wss) |
| `LUNEX_MAC_SIGNED` | `true` to declare a signed mac build (auto-set when `CSC_LINK` is present) |
| `LUNEX_DISABLE_AUTO_UPDATE` | runtime: `1` disables update checks |

### spot-api must allow the desktop origin

Requests from the app carry `Origin: app://lunex`. Add it to the API's
`CORS_ALLOWED_ORIGINS` **and** `ALLOWED_WS_ORIGINS` (exact-match allowlists in
`spot-api/src/config.ts`, `src/index.ts`, `src/websocket/server.ts`), e.g.
`CORS_ALLOWED_ORIGINS="https://lunex.io,app://lunex"`. Without it, REST calls
fail CORS and the WebSocket is closed with 1008.

## Security model

- `contextIsolation`, `sandbox` (plus `app.enableSandbox()`), `nodeIntegration: false`,
  `webSecurity: true`, no `remote`, no `<webview>`, DevTools disabled in packaged builds.
- Web build served via `protocol.handle('app')` (standard + secure + fetch, no
  `bypassCSP`), with path-traversal protection and SPA fallback to `index.html`.
- Strict CSP on the document: `script-src 'self' 'wasm-unsafe-eval'` (wasm is
  needed by `@polkadot/wasm-crypto`; no `unsafe-eval`, no remote scripts),
  `connect-src` limited to configured endpoints, `object-src 'none'`,
  `frame-ancestors 'none'`, `form-action 'none'`. Note: `useWebMCP` loads a
  script from unpkg and is therefore blocked in the desktop app by design.
- Navigation pinned to the app origin; `window.open` is always denied and
  http(s) URLs are handed to the OS browser via `shell.openExternal` after
  scheme validation. All permission requests are denied except clipboard write.
- IPC: three fixed channels; the main process checks that the sender is the
  main window's top frame on the app origin and validates arguments.
- Electron fuses: `RunAsNode`, `NODE_OPTIONS`, `--inspect` disabled; cookie
  encryption, ASAR integrity validation and only-load-from-ASAR enabled.
- Single-instance lock; window bounds persisted in `userData/window-state.json`.

## `window.lunexDesktop` (preload API)

```ts
window.lunexDesktop?: {
  isDesktop: true;
  platform: string;            // 'darwin' | 'win32' | 'linux'
  version: string;             // desktop app version
  openExternal(url: string): Promise<void>;      // http(s) only
  onUpdateStatus(cb: (s: LunexUpdateStatus) => void): () => void; // replays last status
  installUpdate(): Promise<boolean>;             // only after state === 'downloaded'
}
```

See `src/lunexDesktop.d.ts` for `LunexUpdateStatus`
(`checking | available | not-available | downloading | downloaded | manual | error`).
The web app should feature-detect with `window.lunexDesktop?.isDesktop` (e.g. to
hide browser-extension wallets and prefer WalletConnect).

## Releasing

1. Bump nothing by hand — the tag sets the version.
2. `git tag desktop-v0.2.0 && git push origin desktop-v0.2.0`
3. `.github/workflows/desktop.yml` creates a **draft** release `desktop-v0.2.0`
   and the mac/win/linux jobs upload installers plus `latest*.yml` /
   `*.blockmap` into it.
4. Review the draft, then **Publish** it (not as a pre-release). Only published,
   non-prerelease `desktop-v*` releases are offered to users.

`workflow_dispatch` builds all three platforms without publishing; installers are
attached as workflow artifacts.

### CI configuration

Repository **variables** (Settings → Secrets and variables → Actions → Variables):
every `REACT_APP_*` listed above that production needs (at least
`REACT_APP_SPOT_API_URL`, `REACT_APP_SPOT_WS_URL`, `REACT_APP_NETWORK`, RPC URLs,
contract/token addresses, `REACT_APP_WALLETCONNECT_PROJECT_ID`) and optionally
`LUNEX_CSP_EXTRA_CONNECT_SRC`. All `REACT_APP_*` vars are exported automatically.
They end up in a public bundle — never put secrets there.

Repository **secrets** (all optional; unset = unsigned build):
`CSC_LINK`, `CSC_KEY_PASSWORD` (macOS Developer ID .p12, base64 or URL),
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (notarization),
`WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` (Windows Authenticode .pfx).
`GITHUB_TOKEN` is provided by Actions.

## Auto-update

- Checks 10 s after start and every 6 h (packaged builds only).
- The monorepo also has non-desktop releases (`v*.*.*`), so the app resolves the
  newest published `desktop-v*` release through the GitHub API and points
  electron-updater at that release's assets. Files are verified against the
  sha512 in `latest*.yml`.
- Windows/Linux: downloads in the background, then asks
  **“Restart to update”** (native dialog, app menu, or `installUpdate()` from the
  web UI). `autoInstallOnAppQuit` is off — nothing installs without consent.
- **macOS unsigned builds cannot self-update** (Squirrel.Mac requires a signed
  app). They only report `state: 'manual'` and offer to open the release page.
  Auto-install turns on automatically once mac builds are signed.
- Linux auto-update applies to the AppImage; the `.deb` updates via `pkexec dpkg`.

## Enabling code signing later

1. macOS: export a *Developer ID Application* certificate as .p12, base64 it into
   `CSC_LINK`, set `CSC_KEY_PASSWORD`, and set `APPLE_ID`,
   `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for notarization. Hardened
   runtime + `assets/entitlements.mac.plist` are already configured.
2. Windows: put the .pfx (base64) in `WIN_CSC_LINK` and its password in
   `WIN_CSC_KEY_PASSWORD`. Once signed, consider adding `win.publisherName`
   in `electron-builder.yml` so electron-updater verifies the publisher.
3. No code change is required; the workflow only disables identity discovery
   when no certificate is present.

## First run of unsigned builds

- **macOS**: right-click `Lunex.app` → **Open** → **Open**. If macOS says the app
  is damaged, run `xattr -dr com.apple.quarantine /Applications/Lunex.app`.
- **Windows**: SmartScreen shows “Windows protected your PC” → **More info** →
  **Run anyway**.
- **Linux**: `chmod +x Lunex-*.AppImage && ./Lunex-*.AppImage` (needs FUSE 2,
  e.g. `libfuse2`), or `sudo apt install ./Lunex-*-amd64.deb`.

Always download installers from the official GitHub release page and compare
the sha512 published in `latest*.yml`.
