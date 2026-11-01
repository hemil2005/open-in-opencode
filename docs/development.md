# Development

Everything for building, packaging, releasing and understanding Open in OpenCode. For installing and using it, see the [README](../README.md).

## Requirements

| | |
|---|---|
| To build | mingw-w64 (x86_64) with `windres`; llvm-mingw for arm64 |
| To package | MakeAppx and SignTool (see `-InstallTools` below) |
| To test | An interactive Windows desktop session |

## Install from source

```powershell
git clone https://github.com/hemil2005/open-in-opencode.git
cd open-in-opencode
.\scripts\build.ps1
.\scripts\install.ps1 -Replace -RestartExplorer
```

A loose developer registration requires Developer Mode (it is unsigned) and cannot coexist with a packaged install. `-Replace` switches between them.

To remove it:

```powershell
.\scripts\uninstall.ps1 -RemoveLogs
```

## Build

```powershell
.\scripts\build.ps1                              # x64 -> dist\
.\scripts\build.ps1 -Architecture arm64 -OutDir stage\arm64
.\scripts\build.ps1 -Clean
.\scripts\build.ps1 -Compiler 'C:\msys64\mingw64\bin\x86_64-w64-mingw32-g++.exe'
```

x64 uses mingw-w64. arm64 uses llvm-mingw, the only toolchain that targets Windows on ARM, looked up under `.tools\llvm`.

`dist\` is a complete loose-package layout (`AppxManifest.xml`, `OpenInOpenCode.dll`, `ocshell.exe`, placeholder exe, assets) ready for `Add-AppxPackage -Register`. It is git-ignored.

## Package and sign

```powershell
.\scripts\new-cert.ps1          # one-time: self-signed code-signing cert -> .secrets\
.\scripts\package.ps1           # x64 + arm64 -> out\OpenInOpenCode_<version>.msixbundle
.\scripts\package.ps1 -Sign     # also signs and verifies the bundle
```

`package.ps1 -InstallTools` fetches MakeAppx and SignTool from the `Microsoft.Windows.SDK.BuildTools` NuGet package into `.tools\`, so a full Windows SDK install is not required.

Before the bundle will install, its certificate must be trusted by the machine (admin, once):

```powershell
Import-Certificate -FilePath .\.secrets\OpenInOpenCode.cer `
    -CertStoreLocation Cert:\LocalMachine\TrustedPeople
```

It has to be Trusted **People**, not Root, and not the user store, because App Installer does not search user certificates. With that in place the package sideloads on a default Windows 11/10 machine, and **Developer Mode is not required for a signed package**.

A loose developer install and a packaged install of the same identity cannot coexist. Use `.\scripts\install.ps1 -Replace` to switch back to a loose build.

## Test

```powershell
.\tests\menu-smoke-test.ps1
```

This needs an interactive desktop session. It opens a scratch folder, right-clicks the background and asserts the menu entry exists. It never invokes the entry, so no opencode process is started.

## Plugin development

The optional TUI plugin lives in `plugin/` and is a multi-file Bun/TypeScript project:

```
plugin/
  tui.ts                    entry: Plugin.define, delegates to ui/register
  ui/register.tsx           full-page route and /ocshell command
  ui/dashboard.tsx          dashboard layout, selection, keys and actions
  ui/rows.ts                pure row model (labels, values, tones, disabled reasons)
  ui/editors.ts             terminal picker, settings prompts and launch-option editors
  ui/launch.tsx             context-menu launch-option manager
  ui/diagnostics.tsx        diagnostics checks and full report view
  ui/updates.ts             update apply flow and progress
  lib/ocshell.ts            async process runner, resolution and typed errors
  lib/state.ts              snapshot loading, update TTL and cache shapes
  lib/format.ts             formatting, health, sorting and validation
  lib/report.ts             plain-text report and clipboard fallback
  lib/types.ts              CLI JSON types and runtime shape guards
  test/                     Bun tests and fixtures
```

Run the checks from `plugin/`:

```powershell
cd plugin
bun install --frozen-lockfile
bun run typecheck
bun test
```

JSX files must start with `/** @jsxImportSource @opentui/solid */`. The installer copies only the runtime files, `tui.ts`, `lib/` and `ui/`; it never copies `package.json`, `tsconfig.json`, `bun.lock` or `test/`. Verify the layout with:

```powershell
.\scripts\test-install-plugin.ps1
```

The plugin tests do not need OpenCode running. Manual TUI checks use OpenCode 2.2.5 or newer. `update apply` has no cancel: if you leave the page while it runs, the installer may continue; the 10-minute timeout terminates the direct child only.

## Updates and releases

Updates use the standard MSIX `.appinstaller` mechanism. There is no custom updater.

```powershell
.\scripts\make-appinstaller.ps1 -Repo hemil2005/open-in-opencode -Tag updates   # -> out\OpenInOpenCode.appinstaller
```

Publish it as a release asset with a **fixed** name in the `updates` prerelease, so the URL
clients check never changes:

```
https://github.com/hemil2005/open-in-opencode/releases/download/updates/OpenInOpenCode.appinstaller
```

Windows then updates the package itself (`AutomaticBackgroundTask`, every 8 hours). Users can check or apply updates manually:

```powershell
ocshell update check                     # compare installed vs published
ocshell update apply                     # download and install the newer bundle
ocshell settings set updateUri <url>     # override the built-in source
```

`OnLaunch` update prompts only fire when the app is launched. This package has no launchable surface, so `AutomaticBackgroundTask` is the dependable path.

The release workflow (`.github/workflows/release.yml`) builds and signs both architectures. The user-facing tag publishes only the versioned and fixed-name setup executables and `install.ps1`; the bundle, the `.appinstaller` and the `.cer` go to the fixed `updates` prerelease so testers see one download. Push a tag matching the package version (for example `v0.8.0.2`).

Set `SIGNING_PFX_BASE64` and `SIGNING_PFX_PASSWORD` as repository secrets for a stable signer. Without them, the workflow generates a fresh self-signed certificate per release and publishes its `.cer`, which `install.ps1` trusts. That keeps tagged releases working, but it accumulates a certificate per release, so set the secrets before regular releases.

## CLI installers

The one-liner sources are published as fixed-name release assets:

| Source | Release asset | Purpose |
|---|---|---|
| `scripts/install-oneliner.ps1` | `install.ps1` | Downloads and runs the setup executable |

Uninstall from **Settings > Apps**. `scripts/uninstall-oneliner.ps1` stays in the repository for
scripted removal, but it is not a release asset.

The one-liner self-elevates once, downloads the setup executable, and runs it silently. The
setup trusts the certificate and installs the MSIX on Windows 11, or installs the CLI and
classic verbs on Windows 10.

The user-facing release also carries `OpenInOpenCodeSetup.exe` (fixed name) and the versioned
setup; the `updates` prerelease holds the payload the updater reads.

Package-manager manifests are written but not submitted:

```
manifests\winget\OpenInOpenCode.OpenInOpenCode.yaml
manifests\scoop\open-in-opencode.json
```

Refresh their SHA256 after every signed build.

## Windows 10 and classic verbs

The packaged entry is Windows 11 only. On Windows 10 (1809+) the installer places `ocshell.exe` in `Program Files` and registers **classic** context-menu verbs instead.

```powershell
ocshell registry install     # refuses on Windows 11 unless --force is given
ocshell registry status
ocshell registry uninstall
```

Classic verbs cover four targets: folder, folder background, **drive icon** and **desktop background**. The packaged menu can only register the first two, because the manifest schema rejects `Drive` and `DesktopBackground`.

On Windows 11 these verbs would duplicate the packaged entry, so the installer only writes them when the build number is below 22000. `--force` exists for testing, and the entry then appears under *Show more options*.

> Windows 10 support has **not** been run on a Windows 10 machine. The registry logic is verified on Windows 11's classic menu, which uses the same shell mechanism.

## How it works

The Windows 11 context menu cannot be extended through the registry. Only a **packaged** app can contribute an `IExplorerCommand`, and the package gives the shell extension an identity.

```
packaging\AppxManifest.xml
|-- windows.comServer                     -> OpenInOpenCode.dll, STA, surrogate (dllhost)
`-- windows.fileExplorerContextMenus
   |-- ItemType "Directory"               -> folder icons
   `-- ItemType "Directory\Background"    -> empty space inside a folder
```

Explorer activates the COM class only while building a menu, so the DLL is loaded on demand. `GetTitle` and `GetIcon` are kept cheap. The work happens in `Invoke`, which resolves the binary, optionally checks for an existing session, and calls `CreateProcess` with the folder as the working directory.

## Project layout

```
src\core\                    settings, launch options, terminals, binary resolution, launch, log, json, http, update, registry
src\extension\command.cpp    IExplorerCommand (Windows 11 packaged verb)
src\cli\main.cpp             ocshell.exe (launch, settings, doctor, update, registry, selftest)
src\noop.cpp                 placeholder exe required by the manifest
src\resources\app.rc         icon resource
packaging\identity.json      name, publisher, version (single source of truth)
packaging\AppxManifest.template.xml   package + verb registration (rendered per arch)
packaging\appinstaller.template.xml   auto-update manifest (rendered per release)
packaging\Assets\            package logos
installer\openshell.iss      Inno Setup installer
installer\install-package.ps1   cert trust + Add-AppxPackage (also standalone)
plugin\                      optional opencode dashboard plugin (tui.ts, lib\, ui\, test\)
scripts\                     build / package / sign / installer / appinstaller / plugin / install
tests\menu-smoke-test.ps1    end-to-end menu smoke test
tests\com-activation.ps1     headless COM activation check (ARM64 CI)
.github\workflows\           arm64 verification, signed release
docs\design-notes.md         platform findings behind the design decisions
docs\distribution.md         shipping options and signing requirements
```
