# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- ARM64 build output for an MSIX bundle.
- Log rotation.
- CI pipeline producing the bundle.
- License.

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
