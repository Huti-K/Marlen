# @marlen/desktop

Electron shell around the Marlen server + web app. It runs the bundled
`@marlen/server` as a utility child process on `127.0.0.1` (ports 43117+),
opens a window on it, and auto-updates from this repo's GitHub releases.
All state (SQLite DB, library, logs) lives in Electron's per-user data
directory (`~/Library/Application Support/Marlen` on macOS).

Day-to-day development doesn't involve this package — `pnpm dev` at the repo
root (browser + Vite) stays the loop. This shell only matters when working on
the shell itself or cutting a release.

## Run the shell locally

```sh
pnpm --filter @marlen/web build
pnpm --filter @marlen/desktop dev
```

`dev` assembles `build/app` (see `scripts/build.mjs`), npm-installs the
runtime deps there, rebuilds native modules against Electron's ABI, and
launches Electron. First run takes a few minutes (Electron headers +
better-sqlite3 compile); later runs are incremental.

`MARLEN_DESKTOP_SMOKE=1` makes the shell quit itself right after the window
finishes loading — a boot smoke test for CI or a headless check.

The `packageManager: "npm@…"` field in this package's package.json is
load-bearing: it tells electron-builder's node-module collector that
`build/app` is an npm-managed tree. Without it the collector detects pnpm
(from the workspace / the `pnpm dist` user agent), fails to read
`build/app/node_modules`, and silently packages only a fraction of the
runtime deps — the app then dies on `Cannot find package 'fastify'`.

## Cutting a release

1. Bump `version` in `apps/desktop/package.json`.
2. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. The `release.yml` workflow builds macOS and Windows installers and
   uploads them to a **draft** GitHub release.
4. Publish the release. Running apps with an update token poll every 4 hours
   (and on launch), download in the background, and show a "restart to
   update" toast.

## Downloads & updates

The repo is public: installers download from the Releases page (and from the
GitHub Pages download site on the `gh-pages` branch, which reads the latest
release via the GitHub API — it needs no rebuild per release). Auto-update
works anonymously out of the box.

macOS quirk until builds are signed: a CI-built dmg downloaded from GitHub
carries the quarantine flag — allow it once via System Settings → Privacy &
Security → "Open Anyway" (and macOS auto-update stays off until signing).

## Signing

Unsigned status quo: **Windows** installs and auto-updates fine (Windows
shows a one-time SmartScreen warning on first install); **macOS** blocks
unsigned builds at Gatekeeper and electron-updater won't apply updates there.
`release.yml` is pre-wired — signing turns on by adding repo secrets, no
workflow changes needed.

**macOS** (Apple Developer Program, $99/yr — required for Mac distribution):

1. Create a *Developer ID Application* certificate in the Apple Developer
   portal, export it from Keychain as `.p12`.
2. Repo secrets: `MAC_CERT_P12` (the .p12, base64-encoded),
   `MAC_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`
   (appleid.apple.com → app-specific passwords), `APPLE_TEAM_ID`.
3. In `release.yml`, give the mac leg its own package step (duplicate the
   step with `if: runner.os == 'macOS'` / `'Windows'`) and set the env vars
   only there: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
   `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Never set them to empty
   values on the other platform — electron-builder treats an empty
   `CSC_LINK` as a certificate path and the build fails on it.
4. Done — the next tagged release is signed + notarized, and macOS
   auto-updates start working.

**Windows** (optional — removes SmartScreen; updates work without it):
Azure Trusted Signing (~$10/mo): create a Trusted Signing account +
identity validation + certificate profile in Azure, plus an app
registration with the *Trusted Signing Certificate Profile Signer* role.
Then set the `AZURE_*` secrets and uncomment the two marked blocks
(`release.yml`, `electron-builder.yml`). Once Windows builds ship signed,
keep signing — dropping back to unsigned makes the updater reject updates.

The app icon lives in `resources/`: `icon.svg` (the web logo centered on an
Apple-grid rounded tile) is the editable source, `icon.png` (1024²) is what
electron-builder consumes and converts per platform. After editing the SVG,
re-render the PNG at 1024×1024 (any SVG rasterizer, e.g. sharp).
