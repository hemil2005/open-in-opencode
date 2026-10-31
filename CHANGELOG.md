# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- ARM64 build output for an MSIX bundle.
- CI pipeline producing the bundle.
- License.

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
