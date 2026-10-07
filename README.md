# ❄️ Frozen

A **free, powerful, hard-to-bypass distraction blocker** for Windows — block lists, enforced schedules, locks, pomodoro, allowance, and a full-computer *Frozen mode*. All blocking is mediated by a browser extension pushed live from a protected Windows service — no hosts file, no proxy, no driver.

## Why Frozen is different

Most blockers write `0.0.0.0 site.com` into `hosts` and call it a day. That can't do wildcards, paths, or apps, shows an ugly DNS error instead of a block page, and dies the moment you edit the file back. Frozen instead:

- **Extension-mediated blocking** — a Manifest V3 extension intercepts navigation at `document_start`, kills service workers, and swaps the page for a real block UI. Supports domains, paths, keywords, wildcards — things `hosts` can't express.
- **A SYSTEM service is the prison guard** — pushes the block config to the browser over native messaging, force-closes browsers whose extension goes dark during a locked block, watches itself back to life, and refuses to stop.
- **Enforcement, not filtering** — the moat is anti-tamper: no task manager during locks, no clock-rolling (monotonic tamper clock), signed block state (SQLite tampering fails closed), pinned extension ID via `allowed_origins`.

## Features

- **Block lists** with schedules (weekly grid, date ranges, phase-bound pomodoro lists)
- **Locks**: timer, password, random-text (incl. *perfect* mode), range, restart, allowance — and **Enforced**: zero escape hatch until the schedule ends
- **Breaks**: delay breaks, random-text challenges, cause breaks (daily-capped), pomodoro breaks
- **Pomodoro** engine with presets — phase-bound blocks arm exactly during work intervals
- **Allowance** — per-day site budgets that tick down in real time
- **Frozen mode** — whole-computer lockout: full-screen overlay, input enforcement
- **Stats + audit log** — every block attempt, kill, lock change and RPC
- **Beautiful desktop GUI** (Tauri + React + Tailwind), native-messaging bridged to the service
- **Classic Slint GUI** bundled as a lightweight fallback

## Architecture

```
crates/
  frozen-svc      SYSTEM service — block state (HMAC-signed SQLite), scheduler,
                  locks/breaks/allowance engines, app+extension enforcement, pipes
  frozen-helper   per-user helper — foreground-app monitor, Frozen-mode overlay
  frozen-nmh      browser native-messaging host — pushes BlockListInfo to the ext
  frozen-cli      `frozen` — status / blocks / rules / locks / breaks / stats
  frozen-gui-tauri desktop GUI (Tauri v2 + React/Tailwind) — \\.\pipe\Frozen.App RPC
  frozen-common   pipe framing (byte-mode) + {op,id,payload} RPC protocol
  frozen-platform shared Windows bits (registry, processes, service mode)
extension/        MV3 extension — webNavigation verdicts, block page, popup, options
installer/        Inno Setup — service install, nmh manifest, WebView2 bootstrapper
```

The service listens on `\\.\pipe\Frozen.App` (GUI/CLI) and per-browser pipes. All state changes flow as `{op,id,payload}` envelopes → `ok|err` replies + `{op:"state"}` pushes — one protocol for the extension, GUI and CLI.

## Build

```sh
# Rust workspace (Windows; MSVC or GNU toolchain)
cargo build --release

# GUI frontend
cd crates/frozen-gui-tauri/ui && npm install && npm run build

# installer (Inno Setup 6)
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\frozen.iss
# → dist\FrozenSetup-x.y.z.exe
```

The extension loads unpacked from `extension/` (developer mode) — the bundled dev public key pins a stable ID whitelisted in `allowed_origins`.

## Safety notes

- `frozen` CLI and the GUI talk to the service — blocks, locks and breaks are identical either way.
- Enforced blocks are real: stop/pause/breaks are vetoed by the service until the schedule ends. Test on a spare block list first.
- The private extension key is deliberately **not** in this repo — `dev-pub.*` is public key material only.

## Status

Alpha — core engine (blocks, locks, breaks, pomodoro, allowance, Frozen mode, stats, audit, GUI, installer) is working and tested end-to-end. Planned: code signing, store-listed extension, Firefox, sync.
