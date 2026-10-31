# Open in OpenCode

A Windows File Explorer integration that opens [opencode](https://opencode.ai) in the folder
you right-clicked - the same gesture as *Open in Terminal*, for the opencode CLI.

> **Not affiliated with OpenCode.**
> Open in OpenCode is an independent project. It is not made by, endorsed by, or affiliated
> with the OpenCode team or its developers. "OpenCode" is used only to name the tool this
> extension integrates with.

```
right-click a folder  ->  Open in OpenCode  >  New session
                                               Continue last session
                                               Skip permission prompts
```

The package identity and CLI keep the internal name **OpenCodeShell** / **ocshell.exe**.

---

## Overview

Open in OpenCode adds a top-level **Open in OpenCode** entry to the Windows context menu and
starts `opencode` with the selected folder as its working directory. It ships as a signed MSIX
bundle for x64 and arm64, plus a small CLI (`ocshell.exe`) for settings, diagnostics, registry
verbs and updates.

The installer chooses the right mechanism for the OS:

| Windows | Context menu | Mechanism |
|---|---|---|
| Windows 11, build 22000+ | Modern menu, top level | Packaged `IExplorerCommand` |
| Windows 10, 1809+ | Classic menu | Registry verbs written by `ocshell` |

## Features

- **Top-level entry** in the Windows 11 context menu, not buried under *Show more options*.
- **Session variants** in a submenu:
  - **New session** - `opencode "<dir>"`
  - **Continue last session** - `opencode --continue "<dir>"`, falling back to a new session
    when the folder has no history (avoids opencode's `--continue` placeholder-id error)
  - **Skip permission prompts** - `opencode --auto "<dir>"`
- **Broad folder coverage** - folder icon, folder background, drive root and desktop
  background (the last two through classic verbs).
- **Binary discovery** across npm, curl, scoop, chocolatey and `PATH` installs; override with
  `OPENCODE_SHELL_BINARY` or the `binaryPath` setting.
- **Terminal discovery** for Windows Terminal, Alacritty, WezTerm, kitty, Ghostty, ConEmu,
  mintty and others; falls back to the Windows default console.
- **Fault isolation** - the extension runs out of process in a COM surrogate, so a fault
  cannot take down Explorer.
- **Signed package** - no Developer Mode required; the installer trusts the signing
  certificate in `LocalMachine\TrustedPeople`.
- **Standard updates** - MSIX `.appinstaller`; there is no custom updater.
- **Optional opencode plugin** - a `/ocshell` command in the TUI.

## Requirements

| | |
|---|---|
| OS | Windows 11 (22000+) or Windows 10 (1809+) |
| CLI | `opencode` installed and signed in |
| Developer Mode | Not required for the signed installer |
| To build | mingw-w64 (x86_64) with `windres`; llvm-mingw for arm64 |

## Install

### From the installer

1. Download `OpenCodeShellSetup-<version>.exe` from the releases page.
2. SmartScreen shows "unknown publisher" for a self-signed certificate - choose
   **More info**, then **Run anyway**.
3. Approve the UAC prompt. The installer trusts the signing certificate and installs the
   package on Windows 11, or places `ocshell.exe` and registers the classic verbs on
   Windows 10.
4. Right-click any folder, or empty space inside one.

No Developer Mode is required. Uninstall from **Settings > Apps**, which removes the package
and offers to remove the certificate too.

### From source (development)

```powershell
git clone https://github.com/hemil2005/open-in-opencode.git
cd open-in-opencode
.\scripts\build.ps1
.\scripts\install.ps1 -Replace -RestartExplorer
```

A loose developer registration requires Developer Mode (it is unsigned) and cannot coexist
with a packaged install - `-Replace` switches between them.

To remove:

```powershell
.\scripts\uninstall.ps1 -RemoveLogs
```

## Usage

Right-click a folder, or empty space inside one, and choose **Open in OpenCode**. The submenu
starts a session in that directory.

| Situation | Result |
|---|---|
| Folder icon, folder background, drive root, desktop | Entry appears |
| More than one item selected | Entry is hidden (only the first folder would be used) |
| `--continue` in a folder with no sessions | Starts a new session instead of erroring |
| `opencode` not found | Warning dialog; details logged |
| opencode exits | Its terminal window closes with it |

## Windows 10

The packaged entry is Windows 11 only. On Windows 10 (1809+) the installer places
`ocshell.exe` in `Program Files` and registers **classic** context-menu verbs instead, which
appear directly in the Windows 10 menu.

```powershell
ocshell registry install     # refuses on Windows 11 unless --force is given
ocshell registry status
ocshell registry uninstall
```

Classic verbs cover four targets - folder, folder background, **drive icon** and **desktop
background**. The packaged menu can only register the first two, because the manifest schema
rejects `Drive` and `DesktopBackground`.

On Windows 11 these verbs would duplicate the packaged entry, so the installer only writes them
when the build number is below 22000. `--force` exists for testing: the entry then appears under
*Show more options*.

> Windows 10 support has **not** been run on a Windows 10 machine. The registry logic is
> verified on Windows 11's classic menu, which uses the same shell mechanism.

## Configuration

Settings live in `%APPDATA%\OpenCodeShell\settings.json`, managed through `ocshell.exe`.

```powershell
ocshell doctor                  # package / certificate / binary / terminal
ocshell settings list
ocshell settings terminals      # what was discovered, and where
ocshell settings set terminal.id alacritty
ocshell settings set terminal.mode default
ocshell settings locate-binary  # file picker for opencode.exe
ocshell selftest
```

| Key | Values |
|---|---|
| `binaryPath` | full path to `opencode.exe`; empty means auto-discovery |
| `terminal.mode` | `auto`, `default` (no terminal wrapper) or `custom` |
| `terminal.id` | a terminal id from `settings terminals` (used in `auto` mode) |
| `terminal.customPath` | executable for `custom` mode |
| `terminal.customArgs` | argument template, e.g. `--working-directory {dir} -e {command}` |
| `continueFromProjectRoot` | `true`/`false` - fall back to the project root session |
| `logging` | `true`/`false` - verbose log lines |

Terminal discovery probes `App Paths`, `PATH`, and the usual install roots (Program Files,
scoop, chocolatey, MSYS2, Cygwin, Git for Windows). A terminal found without a known command
template is listed with `*` and can still be used through `terminal.mode=custom`.

Argument templates understand `{dir}`, `{command}`, `{commandline}` and `{pscommand}`.

## Inside opencode

An optional plugin adds a `/ocshell` command to the opencode TUI: show settings, change the
terminal, override the opencode path, and check for updates.

```powershell
.\scripts\install-plugin.ps1              # -> %USERPROFILE%\.config\opencode\plugins\opencode-shell
.\scripts\install-plugin.ps1 -Uninstall
```

Restart opencode, then run `/ocshell`.

The plugin is a thin front end over `ocshell.exe` and never the only way in - the settings it
edits are needed before opencode can even start.

## Updates

Updates use the standard MSIX `.appinstaller` mechanism - there is no custom updater.

```powershell
.\scripts\make-appinstaller.ps1 -Repo hemil2005/open-in-opencode   # -> out\OpenCodeShell.appinstaller
```

Publish it as a release asset with a **fixed** name, so the URL clients check never changes:

```
https://github.com/hemil2005/open-in-opencode/releases/latest/download/OpenCodeShell.appinstaller
```

Windows then updates the package itself (`AutomaticBackgroundTask`, every 8 hours), and users
can check or apply manually:

```powershell
ocshell update check                     # compare installed vs published
ocshell update apply                     # download and install the newer bundle
ocshell settings set updateUri <url>     # override the built-in source
```

`OnLaunch` update prompts only fire when the app is launched; this package has no launchable
surface, so `AutomaticBackgroundTask` is the dependable path.

The release workflow (`.github/workflows/release.yml`) builds and signs both architectures and
publishes the bundle, the installer and the `.appinstaller`. It expects two repository secrets,
`SIGNING_PFX_BASE64` and `SIGNING_PFX_PASSWORD`, and a tag matching the package version
(for example `v0.6.0.0`).

## Build

```powershell
.\scripts\build.ps1                              # x64 -> dist\
.\scripts\build.ps1 -Architecture arm64 -OutDir stage\arm64
.\scripts\build.ps1 -Clean
.\scripts\build.ps1 -Compiler 'C:\msys64\mingw64\bin\x86_64-w64-mingw32-g++.exe'
```

x64 uses mingw-w64; arm64 uses llvm-mingw (the only toolchain that targets Windows on ARM),
looked up under `.tools\llvm`.

`dist\` is a complete loose-package layout (`AppxManifest.xml`, `OpenCodeShell.dll`,
`ocshell.exe`, placeholder exe, assets) ready for `Add-AppxPackage -Register`. It is
git-ignored.

## Package and sign

```powershell
.\scripts\new-cert.ps1          # one-time: self-signed code-signing cert -> .secrets\
.\scripts\package.ps1           # x64 + arm64 -> out\OpenCodeShell_<version>.msixbundle
.\scripts\package.ps1 -Sign     # also signs and verifies the bundle
```

`package.ps1 -InstallTools` fetches MakeAppx/SignTool from the
`Microsoft.Windows.SDK.BuildTools` NuGet package into `.tools\`, so a full Windows SDK install
is not required.

Before the bundle will install, its certificate must be trusted by the machine (admin, once):

```powershell
Import-Certificate -FilePath .\.secrets\OpenCodeShell.cer `
    -CertStoreLocation Cert:\LocalMachine\TrustedPeople
```

Trusted **People**, not Root, and not the user store - App Installer does not search user
certificates. With that in place the package sideloads on a default Windows 11/10 machine:
**Developer Mode is not required for a signed package**.

A loose developer install and a packaged install of the same identity cannot coexist. Use
`.\scripts\install.ps1 -Replace` to switch back to a loose build.

## Test

```powershell
.\tests\menu-smoke-test.ps1
```

Requires an interactive desktop session. It opens a scratch folder, right-clicks the
background and asserts the menu entry exists. It never invokes the entry, so no opencode
process is started.

## How it works

The Windows 11 context menu cannot be extended through the registry - only a **packaged** app
can contribute an `IExplorerCommand`, and the package gives the shell extension an identity.

```
packaging\AppxManifest.xml
|-- windows.comServer                     -> OpenCodeShell.dll, STA, surrogate (dllhost)
`-- windows.fileExplorerContextMenus
   |-- ItemType "Directory"               -> folder icons
   `-- ItemType "Directory\Background"    -> empty space inside a folder
```

Explorer activates the COM class only while building a menu, so the DLL is loaded on demand.
`GetTitle`/`GetIcon` are kept cheap; the work happens in `Invoke`, which resolves the binary,
optionally checks for an existing session, and calls `CreateProcess` with the folder as the
working directory.

## Troubleshooting

**Entry does not appear.** Restart Explorer (`Stop-Process -Name explorer -Force`), or sign out
and back in. Registration changes are picked up by the shell at logon.

**Entry appears but does nothing.** Check the log:

```powershell
Get-Content "$env:LOCALAPPDATA\OpenCodeShell\shell.log" -Tail 20
```

If the file does not exist, the DLL never loaded - the package is probably unregistered or its
folder moved. Re-run `.\scripts\install.ps1`.

**Everything broke after a rebuild.** The package points at `dist\`; re-register it.

## Project layout

```
src\core\                    settings, terminals, binary resolution, launch, log, json, http, update, registry
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
plugin\tui.ts                optional opencode plugin (/ocshell)
scripts\                     build / package / sign / installer / appinstaller / plugin / install
tests\menu-smoke-test.ps1    end-to-end menu smoke test
tests\com-activation.ps1     headless COM activation check (ARM64 CI)
.github\workflows\           arm64 verification, signed release
docs\design-notes.md         platform findings behind the design decisions
docs\distribution.md         shipping options and signing requirements
```

## Notes

- **Trademarks.** OpenCode and its mark belong to their respective owners. This project uses
  the mark only to identify the tool it integrates with; it is not affiliated with or
  endorsed by the OpenCode team.
- **Privacy.** No telemetry, no network access beyond update checks, no elevation. The
  extension only launches a local process.
- **Windows 10 and arm64.** Registry verbs are verified on Windows 11's classic menu but not
  on real Windows 10 hardware. The arm64 build compiles and is PE-verified; runtime
  verification needs an ARM64 Windows runner.

## License

MIT. See [LICENSE](LICENSE).

## Credits

Built on opencode's packaging model and Microsoft's
[packaged context-menu documentation](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/integrate-packaged-app-with-file-explorer).
