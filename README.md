# BMW Pong

A BMW-branded ping pong game for Windows. The game is plain HTML, CSS and
JavaScript on a canvas, and [Tauri 2](https://tauri.app) packages it as a small
native Windows app with an installer.

## Features

- **1 player vs CPU** with three difficulty levels named after drive modes:
  Comfort, Sport and Sport+.
- **2 players** on one keyboard, or with two gamepads.
- **Table tennis scoring**: first to 11, win by 2, and the serve switches every
  2 points (every point at 10–10).
- **Spin**: hit the ball with a moving paddle to curve it.
- **BMW styling**: carbon-fibre backdrop, BMW blue and M tricolour net, LED
  light-bar paddles, and synthesised sound (no audio files needed).
- **Fullscreen** (F11 / F), **pause** (Esc / P), **mute** (M).

| Action | Player 1 | Player 2 |
| --- | --- | --- |
| Move | `W` / `S` or mouse (arrow keys also work in 1-player mode) | `↑` / `↓` |
| Serve | `Space` / click / gamepad A | `Space` / gamepad A |

## Branding

All brand settings are in [`src/brand.js`](src/brand.js): colours, tagline,
player names and the logo path.

> **Logo:** `src/assets/logo.svg` is a **placeholder badge**. Replace it with
> the official BMW logo artwork from the BMW brand portal (keep the filename,
> or change `logo` in `brand.js`). It is used on the menu and as a faint
> watermark on the table.
>
> The UI falls back to Segoe UI. If you have a licence for **BMW Type Next**,
> install it on the target machines, or add it with `@font-face` in
> `src/style.css`. The game uses it automatically when it is available.

App icons are generated from `src/assets/app-icon.png`. After changing that
file, run `npm run icons`.

## Development

Prerequisites (Windows): [Node.js 18+](https://nodejs.org),
[Rust](https://rustup.rs), and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/): the Microsoft
C++ Build Tools and WebView2, which Windows 10/11 already include.

```bash
npm install
npm run dev      # run the desktop app with live reload
npm run build    # build the Windows installers
```

You can also run the game in a plain browser with `npm run serve`, which serves
it at http://localhost:5173.

### Build output

`npm run build` writes:

- `src-tauri/target/release/bundle/nsis/BMW Pong_1.0.0_x64-setup.exe`: the
  installer
- `src-tauri/target/release/bundle/msi/BMW Pong_1.0.0_x64_en-US.msi`: an MSI
  for managed or enterprise deployment
- `src-tauri/target/release/bmw-pong.exe`: the standalone executable

### CI builds

`.github/workflows/build-windows.yml` builds the installers on a Windows runner
in three cases: on every push to `main`, on `v*` tags, and when you start the
workflow manually from the Actions tab. You can download the installers from
the workflow run's **Artifacts** section.

## Project layout

```
src/                 Web front end (loaded directly, no bundler)
  index.html         Menus, HUD and overlays
  style.css          BMW look and feel
  brand.js           Brand configuration
  game.js            Game loop, physics, AI, rendering, audio
  assets/            Logo and app icon sources
src-tauri/           Tauri (Rust) desktop shell
  tauri.conf.json    Window, security (CSP) and Windows bundle settings
  capabilities/      Permissions exposed to the web view
  icons/             Generated app icons
```
