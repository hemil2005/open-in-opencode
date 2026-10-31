# Plugin TUI Dashboard — Implementation Plan

**Status:** Draft for review. Plan only; no plugin code has been changed.
**Date:** 2026-10-31
**Scope:** `plugin/`, `scripts/install-plugin.ps1`, plugin tooling, plugin CI, plugin docs.
**Out of scope:** the Windows context-menu extension, the MSIX installer, the CLI launch path, and any release/publish step.

---

## 1. Decisions already made

| Decision | Choice |
|---|---|
| Plugin surface | Full-page dashboard, not a chain of dialogs |
| Navigation | `context.ui.router.register` + `context.ui.router.navigate` |
| Tooling | Bun tests + `tsc --noEmit` |
| CI | A dedicated plugin job |
| Prompt-footer status badge | Deferred; not in this plan |
| `model` / `agent` settings | Not exposed; not read or written by the plugin |
| Existing context submenu | Unchanged: New session, Continue last session, Skip permission prompts |
| `/ocshell` command | Kept; it opens the dashboard |
| CLI as source of truth | Kept; the plugin never edits settings files directly |

No pull request, push, or upstream submission is part of this plan.

---

## 2. Baseline (verified against the current tree)

The plan was written against commit `46c877b` (package version `0.7.0.0`, clean tree except an untracked `docs/images/logo.svg`). Since then the tree advanced to `16b80ef` / package version `0.7.0.1` through the logo and release-asset commits; `plugin/tui.ts` and the three-entry context menu are unchanged.

- `plugin/tui.ts` is 215 lines. It uses `spawnSync` for every CLI call and presents four choices through `dialog.select`:
  - Show settings (raw text in `dialog.alert`)
  - Change terminal
  - opencode executable
  - Check for updates
- `plugin/tui.ts` types the plugin context as `any`.
- `scripts/install-plugin.ps1` copies only `plugin/tui.ts` into
  `%USERPROFILE%\.config\opencode\plugins\open-in-opencode\tui.ts`.
- There is no `plugin/package.json`, no TypeScript config, no plugin tests, and no plugin CI job.
- The current `settings list --json` shape has no `model` or `agent` keys. This plan assumes that contract. If the 0.8.0 work is restored before implementation, re-check the settings shape first.
- The context menu is already back to three entries; this plan does not touch it.

### 2.1 OpenCode 2.2.5 plugin facts

Verified from the installed `@opencode/plugin` 2.2.5 types, the OpenCode `dev` source, and real-world plugins:

- Local plugins are loaded from a directory under `~/.config/opencode/plugins/`. The loader resolves an entry named `tui` with either `tui.ts` or `tui.tsx`.
- The loader scans relative imports with `Bun.Transpiler` and resolves them with `Bun.resolveSync`, so multi-file plugins and extensionless relative imports work.
- `.tsx` fixtures exist in the OpenCode repo (`packages/tui/test/fixture/plugin/*/tui.tsx`), so TSX is supported.
- Every `.tsx` file must carry `/** @jsxImportSource @opentui/solid */`. The host's Bun transpiler does not read our `tsconfig.json`.
- The public plugin API is available from `@opencode/plugin/tui` as `Plugin.Context`. Relevant members:
  - `context.ui.router.register({ name, render })` returns an unregister function.
  - `context.ui.router.navigate({ type: "plugin", name })`, `{ type: "home" }`, `{ type: "session", sessionID }`.
  - `context.ui.router.current()` returns the live route store; copy it before navigating.
  - `context.ui.dialog.select/show/alert/confirm/prompt/set/clear`.
  - `context.ui.toast.show`.
  - `context.keymap.layer(() => ({ ... }))`; a layer created by a mounted component is owned by that component and disappears when it unmounts.
  - `context.theme` (`ResolvedTheme`), `context.themeMode`, `context.renderer`, `context.storage`, `context.ui.format.path`.
- Theme tokens in 2.2.5 include `theme.text.base`, `theme.text.muted`, `theme.text.faint`, `theme.text.feedback.{success,warning,error,info}.base`, `theme.background.base`, `theme.background.raised.{base,high,max}`, `theme.border.base`, `theme.scrollbar.base`, and `theme.surface("dialog")`.
- `context.renderer.copyToClipboardOSC52(text)` exists. OSC 52 support varies by terminal, so a fallback is required.
- A page-scoped key layer should omit `mode`. That makes it inactive while a host dialog is open, so typing `q` or pressing Escape in a dialog does not close the page behind it. This is the pattern used by `opencode-tps-meter`.

### 2.2 `ocshell` contract used by the dashboard

All commands are async, UTF-8, and line-oriented. `ocshell` writes UTF-8 to stdout/stderr (verified in `src/cli/main.cpp`).

```text
ocshell version
ocshell doctor --json
ocshell settings list --json
ocshell settings terminals --json
ocshell settings set <key> <value>
ocshell update check --json
ocshell update apply
```

Important details:

- `doctor --json` still prints valid JSON when `binaryFound` is false, but exits `1`. The runner must parse stdout regardless of exit code for this command.
- `settings set` prints `updated <key>` on success and writes errors to stderr.
- `update check --json` returns:
  ```json
  {
    "current": "0.7.0.0",
    "available": "0.8.0.0",
    "updateAvailable": true,
    "bundleUri": "https://...",
    "installerUri": "https://..."
  }
  ```
- `settings list --json` returns:
  ```json
  {
    "version": 1,
    "binaryPath": "",
    "updateUri": "",
    "continueFromProjectRoot": false,
    "logging": false,
    "terminal": {
      "mode": "auto",
      "id": "wezterm-gui",
      "customPath": "",
      "customArgs": []
    }
  }
  ```
- `settings terminals --json` returns an array of
  `{ id, name, path, supported }`.
- Writable keys are `binaryPath`, `updateUri`, `terminal.mode`, `terminal.id`,
  `terminal.customPath`, `terminal.customArgs`, `continueFromProjectRoot`, and `logging`.
- `-` clears `binaryPath`, `updateUri`, `terminal.id`, and `terminal.customPath`.
- Log path is `%LOCALAPPDATA%\OpenInOpenCode\shell.log`.
- Settings path is `%APPDATA%\OpenInOpenCode\settings.json`.

---

## 3. Goals and non-goals

### Goals

1. Replace the four-choice dialog with one full-page dashboard that shows health, current values, and actions at a glance.
2. Remove `spawnSync`. No CLI call may freeze the TUI.
3. Make every current setting visible, and make every writable setting editable without leaving the dashboard.
4. Make terminal choice searchable and mark the current terminal.
5. Validate input before writing; never persist an invalid path or URL.
6. Make update check/apply non-blocking and show full failures instead of short toasts.
7. Add Bun tests, TypeScript typechecking, and a CI job for the plugin.
8. Keep the plugin optional and keep `ocshell` as the source of truth.

### Non-goals

- No `model` or `agent` rows, defaults, or flags.
- No prompt-footer or home-footer status badge.
- No session launching, session listing, or context-menu changes.
- No changes to the C++ launcher or registry code.
- No plugin npm publication.
- No release, version bump, build, package, or upload in this plan.
- No support for OpenCode versions older than 2.2.5 unless the spike shows a cheap fallback.

---

## 4. UX specification

### 4.1 Full-page layout

The dashboard is a single route with a fixed header, a scrolling body, and a fixed footer. It uses the whole content area; it does not float over a session.

```text
Open in OpenCode                                             0.7.0.0   ok
--------------------------------------------------------------------------
 Status
   Package        OpenInOpenCode_0.7.0.0_x64__jqs6rpst54t28
   Certificate    trusted
   ocshell        C:\Users\hemil\AppData\Local\Microsoft\WindowsApps\ocshell.exe
   opencode       C:\Users\hemil\AppData\Roaming\npm\...\opencode.exe (npm)
   Settings       C:\Users\hemil\AppData\Roaming\OpenInOpenCode\settings.json

 Configuration
 > Terminal       Windows Terminal (wt)
   opencode path  auto (npm)
   Continue root  off
   Logging        off
   Update source  built-in

 Maintenance
   Updates        up to date
   Diagnostics    all checks passed

 Advanced
   Terminal mode  auto
   Custom path    not set
   Custom args    not set

--------------------------------------------------------------------------
 [enter] change  [r] refresh  [c] copy report  [esc] back       updated 12:34
```

Rules:

- `>` marks the selected row. Section headers are not selectable.
- Every row shows its live value in the right column, not a generic label.
- Health is text plus a marker (`ok`, `!`, `x`), never color alone.
- Long paths are abbreviated with `context.ui.format.path` and a middle truncation helper. The full path is used in the report and in the row's detail.
- The header shows the `ocshell` version from `doctor`, not a hardcoded plugin version.
- The footer shows only the keys that apply to the selected row.

### 4.2 States

| State | Rendering |
|---|---|
| First load | Skeleton rows with `Loading ocshell...`; no blocking alert |
| `ocshell` missing | Full-page notice with install guidance, a retry row, and a copyable command |
| Ready | Normal dashboard |
| Refreshing | Existing values stay visible; header shows `refreshing...` |
| Partial failure | Failed source rows show `! unavailable`; a persistent error banner appears above the footer |
| Busy (write/update) | Selected row shows `...`; mutating rows are disabled; footer shows the running command |
| Update available | Updates row shows `! 0.8.0.0 available`; Enter opens confirmation |
| Update applying | Progress panel with the last output lines; no dashboard navigation |
| Update applied | Toast `Updated. Restart OpenCode to finish.` and a refreshed doctor |
| Fatal error | Persistent error banner; Enter opens a scrollable detail dialog with a copy action |

The first render never waits for the network. Cached data from `storage.store` is shown immediately, then refreshed.

### 4.3 Keys

| Key | Action |
|---|---|
| `up` / `k` | Move selection up |
| `down` / `j` | Move selection down |
| `enter` | Activate the selected row |
| `r` | Refresh doctor, settings, terminals, and update cache |
| `c` | Copy the diagnostics report |
| `esc` | Return to the previous route |
| `?` | Toggle a short help overlay (optional; only if the spike shows it is cheap) |

No mouse requirement. No `space` binding: Enter on a boolean row toggles it. This keeps one activation key and avoids conflicts with a focused input.

### 4.4 Row behavior

| Row | Value | Enter |
|---|---|---|
| Package | `doctor.package` or `not installed` | Show detail / copy |
| Certificate | `doctor.certificate` | Show detail |
| ocshell | resolved path or `not found` | Copy path |
| opencode | `binaryPath (source)` or `NOT FOUND` | Open binary editor |
| Settings | `settingsPath` | Open containing folder (optional) |
| Terminal | current terminal name/id | Searchable picker |
| opencode path | `auto (source)` or the override | Prompt + validate |
| Continue root | `on` / `off` | Toggle and write |
| Logging | `on` / `off` | Toggle and write |
| Update source | `built-in` or the URL | Prompt + validate |
| Updates | `not checked`, `up to date`, `x.y.z available`, `check failed` | Check, then confirm/apply |
| Diagnostics | `all checks passed` or `N issue(s)` | Expand details |
| Terminal mode | `auto` / `default` / `custom` | Select |
| Custom path | path or `not set` | Prompt + validate (only when mode is `custom`) |
| Custom args | rendered argument list or `not set` | Prompt (only when mode is `custom`) |

Boolean writes are optimistic in the UI but roll back on failure. Every write is followed by a re-read of `settings list --json`; the row shows the actual persisted value, not the requested one.

### 4.5 Responsive rules

- Minimum target: 80x24. At that size, all primary rows fit; advanced rows scroll.
- At narrow widths (below 100 columns), drop the header version and the right-side timestamp before truncating values.
- Never wrap a row into more than one line. Truncate the value, keep the label.
- Full paths and full error output live in the detail dialog or the copied report.
- The body uses a `scrollbox`; selecting a row scrolls it into view with `scrollChildIntoView`.
- Recompute display widths from `context.renderer.width`; verify resize behavior in the spike.

### 4.6 Visual rules

- Use only theme tokens. No hardcoded colors.
- Text: `theme.text.base`; labels: `theme.text.muted`; disabled: `theme.text.faint`.
- Success: `theme.text.feedback.success.base`; warning: `theme.text.feedback.warning.base`; error: `theme.text.feedback.error.base`.
- Selected row background: `theme.background.raised.high`.
- Borders/separators: `theme.border.base`.
- ASCII markers only: `>`, `ok`, `!`, `x`, `...`. No emoji.
- Keep section spacing to one blank line; the dashboard must feel dense, not like a form.

---

## 5. Architecture

### 5.1 File tree

```text
plugin/
  tui.ts                     entry: Plugin.define, delegates to ui/register
  ui/
    register.tsx             route registration, command slot, cleanup
    dashboard.tsx            full-page component, selection, layout, keys
    rows.ts                  pure row model and buildRows(snapshot)
    editors.ts               terminal picker, prompts, toggles, writes
    diagnostics.tsx          diagnostics section and detail dialog
    updates.ts               check/apply flow and progress state
  lib/
    ocshell.ts               binary resolution, async spawn, JSON runner
    types.ts                 Doctor, Settings, Terminal, UpdateInfo, Result
    format.ts                pure formatting, sorting, validation
    report.ts                plain-text report builder and copy helper
    state.ts                 snapshot loader, cache keys, refresh orchestration
  test/
    format.test.ts
    rows.test.ts
    ocshell.test.ts
    report.test.ts
  package.json
  tsconfig.json
  bun.lock
```

`tui.ts` stays the entry name. It contains no JSX, so it remains valid TypeScript. All JSX lives in `.tsx` files with the pragma.

### 5.2 Module responsibilities

- **`tui.ts`**: imports `registerDashboard` and calls it in `setup`. Returns the cleanup function. No business logic.
- **`ui/register.tsx`**: registers the plugin route, captures the previous route, registers the `/ocshell` command in an `app` slot so the keymap layer has a reactive owner, and returns disposers.
- **`ui/dashboard.tsx`**: owns signals for the snapshot, selection, busy state, and message. Calls the loader, builds rows, renders sections, handles keys, and delegates actions.
- **`ui/rows.ts`**: pure `buildRows(snapshot)`; no Solid imports. This is the main unit-test target.
- **`ui/editors.ts`**: dialog-based editors. Takes a runner, a refresh callback, and a toast callback; returns a promise. No JSX.
- **`ui/diagnostics.tsx`**: renders the diagnostics detail dialog (scrollbox, copy, close).
- **`ui/updates.ts`**: update check/apply state machine; takes the runner and callbacks.
- **`lib/ocshell.ts`**: the only module that spawns processes. Injects `spawn` for tests. Resolves `ocshell.exe` once and caches it.
- **`lib/types.ts`**: JSON shapes, `Result<T>`, `SourceError`, `RunResult`.
- **`lib/format.ts`**: pure functions for values, tones, truncation, sorting, filtering, validation.
- **`lib/report.ts`**: `buildReport` and `copyText` (OSC 52 → `clip.exe` → temp file).
- **`lib/state.ts`**: `loadSnapshot` with `Promise.allSettled`, cache read/write, stale-while-revalidate.

### 5.3 Data flow

```text
route mount
  -> read cached snapshot from storage
  -> render immediately (if cache exists)
  -> loadSnapshot(runner, signal)
       -> doctor --json
       -> settings list --json
       -> settings terminals --json
       -> update check --json (only if cache older than 15 min)
  -> merge results, keep partial successes
  -> write cache
  -> buildRows(snapshot)
  -> render

row action
  -> disable mutating rows
  -> run command (async, timeout)
  -> on success: re-read settings/doctor, refresh snapshot, toast
  -> on failure: keep old values, show persistent error
  -> re-enable rows
```

`loadSnapshot` never rejects. It returns a `Snapshot` with an `errors` array so one failed source does not blank the page.

### 5.4 Route lifecycle

```ts
// ui/register.tsx (shape, not final code)
const ROUTE = "open-in-opencode.dashboard"
const COMMAND = "ocshell.open"

export function registerDashboard(context: Plugin.Context) {
  let previous: Route = { type: "home" }

  const open = () => {
    const current = context.ui.router.current()
    if (current.type === "plugin" && current.name === ROUTE) return
    previous = { ...current }
    context.ui.router.navigate({ type: "plugin", name: ROUTE })
  }

  const close = () => {
    const target =
      previous.type === "plugin" && previous.name === ROUTE ? { type: "home" } : previous
    context.ui.router.navigate(target)
  }

  const unregister = context.ui.router.register({
    name: ROUTE,
    render: () => <Dashboard context={context} onClose={close} />,
  })

  const slot = context.ui.slot({
    append: "app",
    render: () => {
      context.keymap.layer(() => ({
        mode: "global",
        commands: [
          {
            id: COMMAND,
            title: "Open in OpenCode",
            group: "Open in OpenCode",
            palette: true,
            slash: { name: "ocshell" },
            run: open,
          },
        ],
        bindings: [COMMAND],
      }))
      return <></>
    },
  })

  return () => {
    slot()
    unregister()
  }
}
```

Notes:

- `previous` is copied, not held by reference, because `router.current()` can be a live store.
- The command is registered from an `app` slot, not bare `setup`, so `keymap.layer` has a component owner.
- If `context.ui.router` is missing, show an alert that OpenCode 2.2.5 or newer is required. Do not crash the plugin.
- The route name is stable and unique. A duplicate registration error on hot reload means cleanup did not run; log a toast and keep the old route.

### 5.5 Async runner

The runner is the critical fix. No `spawnSync` remains anywhere in `plugin/`.

```ts
// lib/ocshell.ts (shape)
export type RunOptions = {
  timeoutMs?: number
  signal?: AbortSignal
  maxBytes?: number
  allowNonZero?: boolean
}

export type RunResult = {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  truncated: boolean
}

export type Runner = {
  resolve(): string | undefined
  reset(): void
  run(args: string[], options?: RunOptions): Promise<RunResult>
  json<T>(
    args: string[],
    decode: (value: unknown) => T,
    options?: RunOptions,
  ): Promise<Result<T>>
}
```

Implementation rules:

- Resolve `ocshell.exe` in this order:
  1. `process.env.OCSHELL_PATH`, if the file exists.
  2. Each `PATH` directory plus `ocshell.exe`.
  3. `%LOCALAPPDATA%\Microsoft\WindowsApps\ocshell.exe`.
  4. Cache the result; `reset()` clears it for a manual retry.
- Use `spawn(binary, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })`.
- Collect `Buffer` chunks; decode UTF-8 once at the end.
- Cap output at 1 MiB. Keep draining the pipe after the cap so the child does not block; mark `truncated`.
- Timeout defaults: 15 s for reads, 60 s for writes, 10 min for `update apply`.
- On timeout or abort, call `child.kill()`. Document that this may not kill grandchildren (notably an installer spawned by `update apply`).
- Clear timers and abort listeners on every exit path.
- `json()` returns a discriminated `Result`:
  - `{ ok: true, value }`
  - `{ ok: false, error: { kind: "not-found" | "exit" | "timeout" | "aborted" | "parse" | "shape", ... } }`
- `doctor --json` is called with `allowNonZero: true`; the caller inspects `binaryFound`.
- Never log raw settings or paths to the OpenCode console.

### 5.6 Error model

```ts
export type SourceError = {
  source: "doctor" | "settings" | "terminals" | "update" | "write"
  message: string
  command?: string
  code?: number | null
  stderr?: string
  stdout?: string
}
```

- Errors are persistent until the next successful refresh or an explicit dismiss.
- The footer banner shows a one-line summary (`settings: exit 1`).
- Enter on the banner opens a detail dialog with the full command, exit code, stdout, stderr, and a copy action.
- Toasts are only for success and transient info. Never use a toast as the only report of a failure.

### 5.7 Cache and storage

Use `context.storage.store("snapshot", { initial })` for the last successful snapshot and `context.storage.store("update", { initial })` for the last update check.

```ts
type CachedSnapshot = {
  savedAt: number
  doctor: Doctor | null
  settings: Settings | null
  terminals: Terminal[]
  update: UpdateInfo | null
}

type CachedUpdate = {
  checkedAt: number
  current: string
  available: string
  updateAvailable: boolean
}
```

- Show cached data immediately; refresh in the background.
- Update cache TTL: 15 minutes. A manual `r` always checks.
- Ignore cache entries with an unexpected shape or an old schema version.
- Do not cache errors, raw output, or secrets.
- `storage.memory` is not needed for v1; UI signals are enough.

---

## 6. Implementation phases

Each phase ends with a green `bun run typecheck` and `bun test`, except Phase 0 (a throwaway spike). Commit after each phase. Do not mix the C++/menu work into these commits.

### Phase 0 — Spike the route and keymap

**Goal:** Prove the public API behaves as expected in OpenCode 2.2.5 before building on it.

Tasks:

1. Create a throwaway plugin at
   `%USERPROFILE%\.config\opencode\plugins\ocshell-spike\tui.tsx` with the JSX pragma.
2. Register a route named `ocshell-spike.page` and a `/spike` command.
3. Render a full-page `<box>` with a header, a `scrollbox`, and 20 selectable rows.
4. Add a page-scoped key layer for `up`, `down`, `return`, `escape`.
5. Open a `dialog.select` from the page and verify Escape closes the dialog without closing the page.
6. Verify theme tokens render in both light and dark themes.
7. Verify `renderer.copyToClipboardOSC52("test")` and a `clip.exe` fallback in Windows Terminal.
8. Verify `scrollChildIntoView` keeps the selection visible at 80x24.
9. Remove the throwaway plugin and record the results below.

Acceptance:

- The route fills the content area and returns to the previous route.
- Keys work; no host key conflicts.
- Dialogs layer correctly over the page.
- The clipboard path works or the fallback is confirmed.
- If `.tsx` loading fails, stop and revise the architecture before Phase 4.

**Spike results:** Verified on 2026-10-31 against OpenCode 2.2.5 on Windows, driving the real TUI through a ConPTY at 80x24 (`pywinpty` + `pyte`), not just typechecking.

- The local `.tsx` plugin loaded with the JSX pragma; `/spike` opened the route `ocshell-spike.page`.
- The route filled the content area with the header, bordered `scrollbox`, 20 rows, and footer.
- Page-scoped keys worked: `up`/`down` moved the selection, `return` opened `dialog.select`, `escape` closed the dialog while the page stayed mounted, and a second `escape` returned to the previous route (home).
- The dialog layered over the page; page-scoped keys did not fire while it was open, and Escape closed only the dialog.
- `renderer.copyToClipboardOSC52` returned true and the page reported `copied via OSC 52`.
- `scrollChildIntoView` kept the selection visible at 80x24; selecting row 20 scrolled the viewport to rows 4-20.
- Theme tokens resolved against the default `opencode` dark theme (background `#0a0a0a`, text `#eeeeee`, muted `#808080`, border `#484848`, success `#7fd88f`). No plugin-load errors appeared in the logs; the transient `Connection lost` seen during startup was the TUI waiting for the server and it recovered.
- A toast shown from the page remained visible after the page closed. That is the toast lifetime, not a route leak; the dashboard should avoid firing a toast immediately before navigating away.
- Not separately verified in the spike: the light theme variant and a real Windows Terminal clipboard paste. OpenCode 2.2.5's theme picker exposes no light entry (the `catppuccin-latte` asset exists but is not listed), and forcing light mode through the PTY (`theme_mode_lock`, OSC 11 replies) did not take effect. Treat both as manual follow-ups in a normal terminal; neither blocks the architecture.
- The throwaway plugin was removed from `%USERPROFILE%\.config\opencode\plugins\ocshell-spike` and from the repo after verification.

**Conclusion:** the route, keymap layering, dialog behavior, and scrollbox APIs are stable enough for the dashboard. Proceed with the async runner and pure helpers before building the full page.

### Phase 1 — Tooling and CI

**Goal:** Make the plugin typecheckable and testable before the refactor.

Files:

- `plugin/package.json`
- `plugin/tsconfig.json`
- `plugin/bun.lock` (generated by `bun install`)
- `plugin/test/smoke.test.ts`
- `.github/workflows/plugin.yml`
- `.gitignore` (`node_modules/`, `plugin/coverage/` if used)

`plugin/package.json` (draft):

```json
{
  "name": "@open-in-opencode/plugin",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "check": "bun run typecheck && bun test"
  },
  "devDependencies": {
    "@opencode/plugin": "2.2.5",
    "@opencode/theme": "2.2.5",
    "@opentui/core": "0.8.0",
    "@opentui/solid": "0.8.0",
    "@types/bun": "latest",
    "solid-js": "^1.9.0",
    "typescript": "^5.9.0"
  }
}
```

`plugin/tsconfig.json` (draft):

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "types": ["bun"],
    "jsx": "preserve",
    "jsxImportSource": "@opentui/solid",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true
  },
  "include": ["tui.ts", "ui/**/*.tsx", "lib/**/*.ts", "test/**/*.ts"]
}
```

CI workflow (draft):

```yaml
name: plugin

on:
  push:
    paths:
      - "plugin/**"
      - "scripts/install-plugin.ps1"
      - ".github/workflows/plugin.yml"
  pull_request:
    paths:
      - "plugin/**"
      - "scripts/install-plugin.ps1"
      - ".github/workflows/plugin.yml"

jobs:
  test:
    runs-on: windows-latest
    defaults:
      run:
        working-directory: plugin
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.0
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun test
```

Acceptance:

- `cd plugin; bun install; bun run typecheck; bun test` passes locally.
- The workflow is green on a test branch.
- No runtime dependency is bundled; devDependencies are only for typecheck/tests.
- `node_modules/` is ignored.

**Phase 1 results (2026-10-31):** `bun install --frozen-lockfile`, `bun run typecheck`, and `bun test` pass locally on Windows with Bun 1.4.0 and TypeScript 5.9.3. The GitHub workflow has not run yet; that requires pushing a branch, which is intentionally left to the user.

Commit: `chore(plugin): add bun/tsc tooling and CI`.

### Phase 2 — Async runner and types

**Goal:** Replace blocking process calls with a tested async runner.

Files:

- `plugin/lib/types.ts`
- `plugin/lib/ocshell.ts`
- `plugin/test/ocshell.test.ts`

Tasks:

1. Define `Doctor`, `Settings`, `Terminal`, `UpdateInfo`, `RunResult`, `Result`, `SourceError`.
2. Implement `createRunner({ spawn?, resolve?, platform? })` for injection.
3. Implement `resolveOcshell()` with the PATH/alias fallback and caching.
4. Implement `run()` with timeout, abort, output cap, and UTF-8 decoding.
5. Implement `json()` with JSON parsing and shape guards.
6. Write tests with a fake child process:
   - success
   - non-zero exit
   - invalid JSON
   - JSON on non-zero exit with `allowNonZero`
   - timeout
   - abort
   - missing binary (no spawn)
   - output truncation
   - `reset()` re-resolves
7. Do not delete the old `spawnSync` code yet; Phase 4 removes it.

Acceptance:

- `grep` confirms no `spawnSync` in `lib/`.
- A hung fake child resolves as `timedOut` and does not block the test process.
- The runner returns typed errors, not thrown strings.

Commit: `feat(plugin): add async ocshell runner`.

### Phase 3 — Pure formatting, rows, and report

**Goal:** Put every decision that can be tested without a terminal into pure functions.

Files:

- `plugin/lib/format.ts`
- `plugin/lib/report.ts`
- `plugin/ui/rows.ts`
- `plugin/test/format.test.ts`
- `plugin/test/rows.test.ts`
- `plugin/test/report.test.ts`

Functions:

- `formatTerminal(settings, terminals)` → display name/id.
- `formatBinary(doctor)` → `auto (npm)` or `path (source)` or `NOT FOUND`.
- `formatUpdate(update)` → `not checked`, `up to date`, `0.8.0.0 available`, `check failed`.
- `health(doctor, settings, terminals, update)` → `{ level, label, reasons }`.
- `truncateMiddle(value, width)`.
- `sortTerminals(terminals)` → supported first, then name.
- `filterTerminals(query, terminals)` → case-insensitive match on id, name, path.
- `validateBinaryPath(value)` → `-` or absolute existing file; reject directories and relative paths.
- `validateUpdateUri(value)` → `-`, empty, or `http(s)://` URL with no spaces.
- `validateCustomArgs(value)` → split on spaces with quote support matching the CLI? The CLI uses `SplitArguments`; the plugin only needs a reasonable split. Document the difference and keep it simple.
- `buildRows(snapshot)` → the row model used by the dashboard.
- `buildReport(snapshot, generatedAt)` → plain text.

Tests:

- Every formatter branch.
- Toggle rows reflect the settings values.
- Custom terminal rows appear only when `terminal.mode === "custom"`.
- Health is `error` when `ocshell` or opencode is missing, `warn` for certificate/settings/terminal issues, otherwise `ok`.
- Validation rejects relative paths, directories, nonexistent files, `ftp://`, `file://`, and URLs with spaces.
- Report includes every field and no `undefined`.

Acceptance:

- No Solid or Node imports in `format.ts` or `rows.ts`.
- Tests run in milliseconds.
- The row model is the single source of truth for labels, values, tones, and disabled reasons.

Commit: `feat(plugin): add dashboard row model and formatters`.

### Phase 4 — Dashboard shell

**Goal:** Replace the dialog hub with the full-page route.

Files:

- `plugin/tui.ts`
- `plugin/ui/register.tsx`
- `plugin/ui/dashboard.tsx`
- `plugin/lib/state.ts`
- `plugin/test/state.test.ts` (if state logic is nontrivial)

Tasks:

1. Implement `loadSnapshot(runner, signal)` with `Promise.allSettled` and partial results.
2. Implement cache read/write with a schema version and a 15-minute update TTL.
3. Build the page:
   - header: title, version, health marker
   - status section
   - configuration section
   - maintenance section
   - advanced section
   - footer with contextual keys and timestamp
4. Add signals: `snapshot`, `selectedId`, `busy`, `message`, `errorBanner`.
5. Keep selection by row id, not index, so refreshes do not jump.
6. Add page-scoped key layers for navigation, refresh, copy, and back.
7. Add a `scrollbox` ref and scroll the selected row into view.
8. Add loading, missing-`ocshell`, partial-error, and busy states.
9. Remove the old dialog functions from `tui.ts`.
10. Keep a small compatibility check: if `ui.router` is missing, show an alert instead of throwing.

Acceptance:

- `/ocshell` opens the dashboard, not a dialog chain.
- Cached data renders instantly; refresh happens in the background.
- A failed `settings` read does not blank the doctor rows.
- `r` refreshes; `esc` returns to the previous route.
- At 80x24, the primary rows are visible and the body scrolls.
- No `spawnSync` remains in `plugin/`.

Commit: `feat(plugin): add full-page dashboard route`.

### Phase 5 — Settings editors

**Goal:** Make every current setting visible and editable from the dashboard.

Files:

- `plugin/ui/editors.ts`
- `plugin/ui/rows.ts` (action ids)
- `plugin/test/editors.test.ts` (validation and no-write cases)

Tasks:

1. Terminal picker:
   - options: Automatic, Windows default, each detected terminal, Custom
   - `current` marks the active choice
   - `search` filters by name/id/path
   - unsupported terminals are `disabled` with a reason
   - writing: `terminal.mode` then `terminal.id`; re-read settings
2. opencode path:
   - `dialog.prompt` with the current value or `-`
   - validate absolute existing file; `-` clears
   - invalid input: show a detail dialog and do not call `settings set`
3. Booleans:
   - `continueFromProjectRoot`, `logging`
   - Enter toggles; write; re-read; roll back the UI on failure
4. Update source:
   - `dialog.prompt`; `-` resets to built-in
   - validate `http(s)://`
5. Advanced terminal:
   - mode select: `auto` / `default` / `custom`
   - custom path prompt (required when mode is custom)
   - custom args prompt (space-separated; show the parsed list)
6. After every successful write: refresh the snapshot and show a success toast. On failure: keep the old value and add a persistent error.
7. Tests: mock runner asserts `settings set` is never called for invalid input; valid input calls the expected key/value.

Acceptance:

- Every value from `settings list --json` is visible.
- Every writable value can be changed without leaving the dashboard.
- Invalid input never writes.
- The terminal picker marks the current terminal and explains unsupported ones.
- Two-step terminal writes leave a readable state even if the second write fails.

Commit: `feat(plugin): edit settings from the dashboard`.

### Phase 6 — Diagnostics and report copy

**Goal:** Make health and failures readable and shareable.

Files:

- `plugin/ui/diagnostics.tsx`
- `plugin/lib/report.ts`
- `plugin/test/report.test.ts`

Tasks:

1. Build checks from `doctor`, `settings`, `terminals`, and the update cache:
   - package installed
   - certificate trusted
   - `ocshell` found
   - opencode binary found
   - settings loaded / warning
   - terminals detected
   - update source status (if checked)
2. Render the checks with `ok` / `!` / `x` markers and a one-line reason.
3. Enter on Diagnostics opens a detail dialog with a scrollbox and the raw fields.
4. `c` copies the report:
   - try `renderer.copyToClipboardOSC52`
   - fall back to `clip.exe` via the async runner
   - fall back to a temp file and show the path
5. Add `open settings folder` and `open log` actions only if they are cheap and safe; otherwise show the paths.
6. Tests: report content, no secrets, all sections present; copy fallback selection with injected functions.

Acceptance:

- Missing binary, untrusted certificate, settings warning, and no-terminal states are obvious.
- Full error output is readable and copyable.
- The report contains no settings values that are not already visible in the dashboard.

Commit: `feat(plugin): add diagnostics and report copy`.

### Phase 7 — Update check and apply

**Goal:** Make updates non-blocking and honest about failure.

Files:

- `plugin/ui/updates.ts`
- `plugin/ui/dashboard.tsx` (progress panel)
- `plugin/test/updates.test.ts`

Tasks:

1. On mount, read the cached update. If older than 15 minutes, check in the background.
2. `update check --json` with a 30 s timeout. Update the cache on success; record an error on failure.
3. If `updateAvailable`:
   - row shows `! <version> available`
   - Enter opens `dialog.confirm`
4. Apply:
   - disable navigation while applying
   - run `update apply` with a 10 min timeout
   - stream the last 5 output lines into the progress panel
   - on success: toast, refresh doctor, clear the cache
   - on failure: persistent error with the full output and a copy action
5. If `doctor.package === "not installed"`, disable apply with the reason `Install the MSIX package first`.
6. If apply appears to need elevation (non-zero exit mentioning access/UAC, or a timeout), show: `Run "ocshell update apply" in a terminal to approve elevation.`
7. Do not offer a cancel that pretends to stop the installer. If the user leaves the page, the process may continue; document this.

Acceptance:

- The dashboard remains responsive during check and apply.
- Up-to-date, available, check-failed, apply-success, apply-failure, and not-installed states are distinct.
- No short toast is the only record of a failure.
- The 10-minute timeout is enforced.

Commit: `feat(plugin): add update check and apply flow`.

### Phase 8 — Packaging and docs

**Goal:** Ship the multi-file plugin correctly.

Files:

- `scripts/install-plugin.ps1`
- `README.md`
- `docs/development.md`
- `CHANGELOG.md`
- optional `docs/images/plugin-dashboard.png`

Tasks:

1. Update the installer:
   - copy `tui.ts`
   - copy `lib/` and `ui/` recursively
   - remove stale `lib/` and `ui/` in the target before copying
   - never copy `package.json`, `tsconfig.json`, `bun.lock`, or `test/`
   - update the help text and the final message
2. Add an installer smoke check (PowerShell or CI step):
   - install to a temp target
   - assert `tui.ts`, `lib/ocshell.ts`, and `ui/dashboard.tsx` exist
   - run `-Uninstall` and assert the target is gone
3. Update the README plugin section:
   - `/ocshell` opens a full-page dashboard
   - list the keys
   - install/uninstall commands
   - note the OpenCode 2.2.5 requirement
4. Update `docs/development.md`:
   - new plugin file tree
   - `bun install`, `bun test`, `bun run typecheck`
   - the `/** @jsxImportSource @opentui/solid */` requirement
5. Add an `[Unreleased]` CHANGELOG entry for the dashboard, async runner, tooling, and CI.
6. Optional: capture a dashboard screenshot after Phase 9 and add it to `docs/images/`.

Acceptance:

- Fresh install and upgrade both work.
- The installed directory contains only runtime files.
- Docs match the actual keys and file tree.
- No stale "four dialog options" text remains.

Commit: `chore(plugin): install multi-file plugin and document it`.

### Phase 9 — Verification

**Goal:** Prove the whole flow before calling it done.

Tasks:

1. `cd plugin; bun run typecheck`
2. `cd plugin; bun test`
3. Run `.\scripts\install-plugin.ps1 -Target <temp>` and verify the file layout.
4. Restart OpenCode and run `/ocshell`.
5. Walk the manual matrix in Section 7.2.
6. Record known limitations in the plan or in `docs/development.md`.
7. Do not build the MSIX, bump the version, tag, or release unless separately requested.

Acceptance:

- All automated checks pass.
- The manual matrix has no open `P0` or `P1` issues.
- The dashboard is usable at 80x24 with the default theme.
- The old blocking behavior is gone.

---

## 7. Test plan

### 7.1 Automated

| Area | Tests |
|---|---|
| `lib/ocshell.ts` | success, exit code, invalid JSON, non-zero JSON, timeout, abort, missing binary, truncation, reset |
| `lib/format.ts` | terminal/binary/update formatting, health levels, truncation, sorting, filtering, path validation, URL validation |
| `ui/rows.ts` | row values, tones, disabled reasons, conditional custom rows, selection stability |
| `lib/report.ts` | every section present, no `undefined`, no secrets, copy fallback order |
| `ui/updates.ts` | cache TTL, check success/failure, apply success/failure, not-installed guard |
| `ui/editors.ts` | invalid input never calls `settings set`; valid input calls the right key/value |

CI runs `bun install --frozen-lockfile`, `bun run typecheck`, and `bun test` on `windows-latest`.

### 7.2 Manual TUI matrix

| Scenario | Expected |
|---|---|
| Windows 11, Windows Terminal | Dashboard fills the page, theme colors, copy works |
| Windows 11, WezTerm | Dashboard renders; OSC 52 or `clip.exe` fallback works |
| Windows 11, conhost | Dashboard renders without relying on OSC 52 |
| Windows 10, if available | Dashboard renders; terminal discovery behaves |
| 80x24 | Primary rows visible, body scrolls, no wrapped rows |
| 120x40 | Wide layout, paths readable |
| 60x20 | Values truncate, footer keys still visible |
| `ocshell` on PATH | Normal load |
| `ocshell` missing | Full-page notice, no crash, retry works |
| `OCSHELL_PATH` override | Runner uses it |
| No supported terminals | Terminal row explains the state; custom mode offered |
| Unsupported terminal selected | Picker disables it with a reason |
| Binary auto | Row shows `auto (npm)` and source |
| Binary valid override | Row shows the path; doctor uses it |
| Binary invalid path | Prompt rejects it; no write |
| Corrupt settings file | Doctor warning visible; dashboard still loads |
| Update up to date | Row shows `up to date` |
| Update available | Row shows the version; confirm/apply works |
| Update check fails | Persistent error with output |
| Update apply succeeds | Toast, doctor refresh, restart hint |
| Update apply fails | Persistent error with full output |
| Apply needs elevation | Guidance to run in a terminal |
| Dialog open + Escape | Dialog closes, dashboard stays |
| `esc` on dashboard | Returns to the previous route |
| `c` copy | Report copied or temp-file path shown |
| Light theme / dark theme | Tokens remain readable |
| Refresh during a write | Stale results ignored; no state corruption |
| Leave the page during a read | Abort; no late state update |

### 7.3 Regression checks

- The Windows context menu still has exactly three entries.
- No C++ source changes are required by this plan.
- The MSIX package and installer scripts are untouched.
- `plugin/tui.ts` remains the discovered entry.
- No `model` or `agent` string appears in the plugin.

---

## 8. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| OpenCode plugin API changes | Dashboard breaks on upgrade | Pin `@opencode/plugin` 2.2.5 for typecheck; feature-detect `ui.router`; show a clear message |
| `.tsx` loading or JSX pragma issues | Page does not render | Phase 0 spike; pragma in every `.tsx`; fallback to `h()` if needed |
| Keymap conflicts with the host | Keys do nothing or fire twice | Page-scoped layer; omit `mode`; test dialogs over the page |
| Windows child process kill does not kill grandchildren | Installer keeps running after timeout | No fake cancel; document; guide to a terminal for elevation |
| OSC 52 unsupported | Copy fails silently | `clip.exe` fallback, then temp file with a visible path |
| `doctor` exits 1 when binary is missing | False failure | `allowNonZero` for doctor; inspect `binaryFound` |
| Non-ASCII paths | Garbled output | UTF-8 confirmed in the CLI; add a manual test with a non-ASCII path |
| Huge command output | Memory spike | 1 MiB cap with drain and `truncated` marker |
| Hot reload duplicate route | Plugin fails to register | Return and call disposers; unique route name; toast on duplicate |
| Settings writes are not atomic | Mode/id mismatch | Re-read after writes; show the persisted value; keep the dashboard usable |
| Cache shape changes | Crash on stale storage | Version the cache; ignore invalid entries |
| OpenCode running outside Windows | Plugin is irrelevant | Show the Windows-only alert; do not spawn anything |

---

## 9. Rollout

1. Land Phases 1–4 first. That delivers the visible dashboard and removes the TUI freeze.
2. Land Phase 5 next. That makes the dashboard a real settings surface.
3. Land Phases 6–7. Diagnostics and updates are the remaining value.
4. Land Phase 8 last. The installer must not copy a half-built plugin.
5. No version bump or release in this plan. The next release can include the plugin changes once the manual matrix is clean.

If the route API proves unstable in Phase 0, fall back to the dialog flow and keep the async runner, tests, and CI. The tooling work is still valuable.

---

## 10. Open questions for review

1. Should the dashboard auto-check for updates on mount (with a 15-minute cache), or only when the user selects the row? **Draft recommendation:** background check when the cache is stale, no toast unless an update is available.
2. Should `esc` return to the previous route or always go home? **Draft recommendation:** previous route, captured at open time.
3. Should advanced terminal settings (`terminal.mode`, `customPath`, `customArgs`) be editable in v1, or only visible? **Draft recommendation:** editable, but they can slip to a follow-up if Phase 5 grows.
4. Should the plugin require OpenCode 2.2.5+, or keep a dialog fallback for older versions? **Draft recommendation:** require 2.2.5+ and show a clear message; the plugin is optional.
5. Should the release workflow depend on the plugin CI job? **Draft recommendation:** start with a separate `plugin.yml`; add a `needs: plugin` gate to `release.yml` only after the job is stable.
6. Is a dashboard screenshot wanted in the README? **Draft recommendation:** yes, after Phase 9, but it is not a blocker.

---

## Appendix A — Public API signatures used

```ts
// @opencode/plugin/tui
export type Context = {
  readonly options: Readonly<Record<string, any>>
  readonly location: LocationRef | undefined
  readonly app: App
  readonly renderer: CliRenderer
  readonly client: OpenCodeClient
  readonly data: Data
  readonly attention: Attention
  readonly theme: ResolvedTheme
  readonly themeMode: "dark" | "light"
  readonly markdown: { registerCodeBlockRenderer(...): () => void }
  readonly keymap: Keymap
  readonly storage: Storage
  readonly ui: UI
}

// ui.router
register(page: Page): () => void
navigate(destination: Destination): void
current(): Route

type Route =
  | { type: "home" }
  | { type: "session"; sessionID: string }
  | { type: "plugin"; id: string; name: string; data?: Record<string, any> }

type Page = {
  name: string
  render: (input: { data?: Record<string, any> }) => JSX.Element
}

// ui.dialog.select
type DialogSelectOptions<Value> = {
  title: string
  placeholder?: string
  options: readonly DialogSelectOption<Value>[]
  current?: Value
  search?: (query: string, options: readonly DialogSelectOption<Value>[]) => readonly DialogSelectOption<Value>[]
  actions?: readonly DialogSelectAction<Value>[]
}

type DialogSelectOption<Value> = {
  title: string
  value: Value
  description?: string
  footer?: string
  category?: string
  disabled?: boolean
}

// keymap.layer
type KeymapLayer = {
  mode?: string
  enabled?: boolean | (() => boolean)
  target?: () => Renderable | null | undefined
  priority?: number
  commands?: readonly KeymapCommand[]
  bindings?: readonly string[]
}

// storage
store<Value extends object>(key: string, options: { initial: Value }): readonly [
  Store<Value>,
  (mutation: (draft: Value) => void) => Promise<void>,
]
```

---

## Appendix B — JSON shapes

```json
// ocshell doctor --json
{
  "version": "0.7.0.0",
  "settingsPath": "C:\\Users\\hemil\\AppData\\Roaming\\OpenInOpenCode\\settings.json",
  "settingsLoaded": true,
  "settingsWarning": "",
  "binaryFound": true,
  "binaryPath": "C:\\Users\\hemil\\AppData\\Roaming\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe",
  "binarySource": "npm",
  "package": "OpenInOpenCode_0.7.0.0_x64__jqs6rpst54t28",
  "certificate": "trusted",
  "terminalCount": 8,
  "terminal": "wezterm-gui"
}
```

```json
// ocshell settings list --json
{
  "version": 1,
  "binaryPath": "",
  "updateUri": "",
  "continueFromProjectRoot": false,
  "logging": false,
  "terminal": {
    "mode": "auto",
    "id": "wezterm-gui",
    "customPath": "",
    "customArgs": []
  }
}
```

```json
// ocshell settings terminals --json
[
  {
    "id": "wt",
    "name": "Windows Terminal",
    "path": "C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_...\\wt.exe",
    "supported": true
  }
]
```

```json
// ocshell update check --json
{
  "current": "0.7.0.0",
  "available": "0.8.0.0",
  "updateAvailable": true,
  "bundleUri": "https://...",
  "installerUri": "https://..."
}
```

---

## Appendix C — Theme tokens

```text
theme.text.base
theme.text.muted
theme.text.faint
theme.text.feedback.success.base
theme.text.feedback.warning.base
theme.text.feedback.error.base
theme.text.feedback.info.base
theme.background.base
theme.background.raised.base
theme.background.raised.high
theme.background.raised.max
theme.border.base
theme.scrollbar.base
theme.surface("dialog")
```

No hardcoded colors. If a token is missing in a future host version, fall back to `theme.text.base` rather than a literal color.

---

## Appendix D — Definition of done

- `/ocshell` opens a full-page dashboard.
- Header shows the live version and a text health marker.
- All current settings are visible; all writable settings are editable.
- No `spawnSync` remains; reads and writes are async with timeouts.
- Invalid paths and URLs never write.
- Update check/apply are non-blocking; failures show full output.
- Diagnostics are readable and copyable.
- `esc` returns to the previous route; dialogs do not close the page.
- 80x24 works; theme tokens are used; ASCII only.
- `bun run typecheck` and `bun test` pass locally and in CI.
- `scripts/install-plugin.ps1` installs the multi-file plugin and cleans stale files.
- No `model`/`agent` UI, no footer badge, no context-menu changes, no PR.
