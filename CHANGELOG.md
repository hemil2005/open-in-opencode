# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Windows 10 registry verbs.
- opencode plugin surface for settings.

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

- Package identity renamed from `OpenCodeShellPhase0` to `OpenCodeShell`; version now 0.2.0.0.
- Log moved to `%LOCALAPPDATA%\OpenCodeShell\shell.log`; `GetTitle` tracing is debug-only.
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
