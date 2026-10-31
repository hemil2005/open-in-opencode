# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.8.0] - 2026-10-31

### Added

- Built-in update source: `ocshell update check|apply` now defaults to the published
  `.appinstaller`, so updates work without setting `updateUri` manually.
- Full-page `/ocshell` dashboard in the optional opencode plugin: health, live paths,
  terminal choice, every setting, update state and diagnostics.
- Searchable terminal picker, validated `opencode` and custom-terminal paths, update-source
  validation and a diagnostics report with OSC 52 / `clip.exe` / temp-file fallbacks.
- Custom Explorer launch options: up to three custom entries with user-entered flags, plus
  hide/show and reordering for both built-in and custom entries. Windows 11 reads the ordered
  list live; Windows 10 registry verbs refresh after each change.
- `ocshell settings launch list|add|update|hide|move|remove` for scripting the same menu.
- Async `ocshell` runner with per-call timeouts, abort support, 1 MiB per-stream output caps
  and typed errors. The plugin no longer blocks the TUI with `spawnSync`.
- Bun/TypeScript test tooling, plugin CI and an installer layout smoke check.

### Changed

- `scripts/install-plugin.ps1` now installs `tui.ts`, `lib/` and `ui/`, and removes stale
  runtime directories before copying. Tooling and tests stay out of the installed plugin.
- The plugin requires OpenCode 2.2.5 or newer.

## [0.7.0.1] - 2026-10-31

### Changed

- Release assets trimmed to six: the two raw architecture `.msix` files and `uninstall.ps1`
  are no longer published. The bundle already contains both architectures, and uninstalling
  goes through Settings > Apps.

## [0.7.0] - 2026-10-31

### Changed

- Renamed the package identity to `OpenInOpenCode` and the publisher to
  `CN=OpenInOpenCodeDev`; the display name is **Open in OpenCode** everywhere.
  `ocshell.exe` keeps its short name.
- Installs migrate automatically: the old package and certificate are removed, and settings
  are copied from `%APPDATA%\OpenCodeShell`.
- `MakeAppx bundle` is pinned to the package version. It previously stamped a date-derived
  bundle version, which made `.appinstaller` installs fail validation.

### Added

- PowerShell one-liner (`install.ps1`) that checks the Windows build, installs the supported
  path with one UAC prompt, and upgrades in place.
- `uninstall.ps1` one-liner.
- winget and scoop manifests under `manifests/` (not submitted yet).
- The setup ships the `.appinstaller` and registers the update source, falling back to the
  bundled package when the release URL is unreachable.
- Optional opencode plugin (`plugin/tui.ts`) exposing a `/ocshell` command in the TUI for
  settings, terminal choice and update checks, installed with `scripts/install-plugin.ps1`.

## [0.6.0] - 2026-10-31

### Added

- **Windows 10 support**: `ocshell registry install|uninstall|status` writes classic
  context-menu verbs for folder, folder background, drive icon and desktop background.
- Installer branches by OS — MSIX on Windows 11, `ocshell.exe` + registry verbs on Windows 10 —
  and `ocshell.exe` now ships in the installer for that path.

### Fixed

- Signing retries across timestamp authorities and falls back to an untimestamped signature, so
  a timestamp outage cannot fail a build.

## [0.5.0] - 2026-10-31

### Added

- Update pipeline: `packaging/appinstaller.template.xml` and `scripts/make-appinstaller.ps1`
  produce the `.appinstaller` that drives MSIX auto-update.
- `ocshell update check|apply`: compares the published version with the installed one and
  installs the newer bundle (WinHTTP download, PowerShell `Add-AppxPackage`).
- `updateUri` setting, with the build-time value baked into `identity.h`.
- `.github/workflows/release.yml` publishes bundle, installer and `.appinstaller`.

### Fixed

- `package.ps1 -Sign` now verifies the bundle signature after signing. A silent signing
  failure previously produced an unsigned bundle that failed to install with
  `0x800B0100`.

## [0.4.0] - 2026-10-31

### Added

- **Inno Setup installer** (`installer/openshell.iss`, `scripts/build-installer.ps1`): one
  signed EXE that trusts the certificate, installs the bundle, and uninstalls cleanly.
  Idempotent — re-running does not duplicate the certificate or the package.
- Install logic extracted to `installer/install-package.ps1` so it can also be run standalone.
- **`ocshell` execution alias** in the manifest, so the installed CLI is on PATH.

### Changed

- Package version 0.4.0.0.

## [0.3.0] - 2026-10-31

### Added

- MSIX bundle for x64 **and** arm64 (`scripts/package.ps1`), packed with MakeAppx from the
  `Microsoft.Windows.SDK.BuildTools` NuGet package, so the Windows SDK is not needed.
- Self-signed code-signing certificate (`scripts/new-cert.ps1`) and `scripts/sign.ps1` with
  RFC3161 timestamping and verification.
- `tests/com-activation.ps1`: headless COM activation check, used as the ARM64 verification.
- `.github/workflows/arm64-verify.yml` (runs on `windows-11-arm`).
- Manifest templating from `packaging/identity.json`; the manifest is rendered per
  architecture by the build.

### Changed

- `build.ps1` takes `-Architecture` and `-OutDir`.
- `install.ps1` gains `-Replace` to switch between a packaged and a loose install.
- Verified: the signed bundle installs with **Developer Mode disabled** once the certificate
  is trusted in `LocalMachine\TrustedPeople`, and upgrades in place across versions.

## [0.2.0] - 2026-10-31

### Added

- Shared `src/core` layer: settings, terminal discovery, binary resolution, launch, logging,
  JSON reader/writer. Both entry points use it.
- `ocshell.exe` with `launch`, `settings list|set|terminals|locate-binary`, `doctor`,
  `selftest` and `version`.
- Terminal discovery across `App Paths`, `PATH` and common install roots, with argument
  templates per terminal and a custom-command escape hatch.
- `continueFromProjectRoot` setting; the `--continue` fallback policy moved into core so both
  the packaged verb and the future registry verbs behave identically.
- Log rotation at 1 MB.
- `packaging/identity.json` as the single source of truth; `src/generated/identity.h` is
  produced by the build.

### Changed

- Package identity established; version now 0.2.0.0.
- Log moved to `%LOCALAPPDATA%\OpenInOpenCode\shell.log`; `GetTitle` tracing is debug-only.
- Removed the `cmd.exe /k opencode` fallback. A missing binary now produces a clear dialog and
  can be pinned with `settings locate-binary`.
- Multi-select hides the entry instead of acting on the first folder.

## [0.1.0] - 2026-10-31

### Added

- Packaged `IExplorerCommand` adding **Open in OpenCode** to the Windows 11 context menu, for
  folder icons and folder backgrounds.
- Submenu with *New session*, *Continue last session* and *Skip permission prompts*.
- Session probe so `--continue` degrades to a new session in folders without history.
- opencode icon embedded as a DLL resource.
- Multi-select is hidden rather than acting on only the first folder.
- Binary resolution across npm, curl, scoop, chocolatey and `PATH`, with
  `OPENCODE_SHELL_BINARY` override.
- Build, install and uninstall scripts, plus a menu smoke test.
- Design notes covering the platform constraints found during development.
