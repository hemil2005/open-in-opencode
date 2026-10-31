# OpenCodeShell

Adds **Open in OpenCode** to the Windows 11 File Explorer context menu, so the CLI starts in
whatever folder you right-clicked — the same way *Open in Terminal* works, but for
[opencode](https://opencode.ai).

> **Unofficial.** This is a community project. It is not built, endorsed, or supported by the
> OpenCode team. See [opencode's note on projects that use its name](https://github.com/anomalyco/opencode#building-on-opencode).

```
right-click a folder  →  Open in OpenCode ▸ New session
                                          Continue last session
                                          Skip permission prompts
```

## Status

Working and used daily on Windows 11 (build 26300). Ships as a **signed MSIX bundle** for x64
and arm64, using a self-signed certificate that the installer trusts — no Developer Mode
needed. Public distribution (Store or a CA certificate) is still to come; see
[Distribution](docs/distribution.md).

## Features

- Top-level entry in the Windows 11 context menu (not buried under *Show more options*).
- Works on a folder icon, in a folder's empty background, and on a drive root.
- Submenu with session variants:
  - **New session** — `opencode "<dir>"`
  - **Continue last session** — `opencode --continue "<dir>"`, falling back to a new session
    when the folder has no history (avoids opencode's `--continue` placeholder-id error)
  - **Skip permission prompts** — `opencode --auto "<dir>"`
- Finds the opencode binary across npm, curl, scoop, chocolatey and `PATH` installs; override
  with `OPENCODE_SHELL_BINARY` or the `binaryPath` setting.
- Discovers installed terminals (Windows Terminal, Alacritty, WezTerm, kitty, Ghostty, ConEmu,
  mintty, …) and lets you pick one; falls back to the Windows default console.
- Runs out-of-process in a COM surrogate, so a fault cannot take down Explorer.

## Requirements

| | |
|---|---|
| OS | Windows 11, build 22000 or later |
| CLI | `opencode` installed and signed in |
| To install the current build | Windows Developer Mode enabled (unsigned package) |
| To build | mingw-w64 (x86_64) with `windres` |

Windows 10 is intentionally not supported: `windows.fileExplorerContextMenus` is only honoured
by the Windows 11 shell.

## Install

### From the installer

1. Download `OpenCodeShellSetup-<version>.exe` from the releases page.
2. SmartScreen shows "unknown publisher" for a self-signed certificate — **More info → Run anyway**.
3. Approve the UAC prompt. The installer trusts the signing certificate in
   `LocalMachine\TrustedPeople` and installs the MSIX bundle.
4. Right-click any folder, or empty space inside one.

No Developer Mode is required. Uninstall from **Settings → Apps**, which removes the package
and offers to remove the certificate too.

### From source (development)

```powershell
git clone <this repo> opencode-shell
cd opencode-shell
.\scripts\build.ps1
.\scripts\install.ps1 -Replace -RestartExplorer
```

A loose developer registration requires Developer Mode (it is unsigned) and cannot coexist
with a packaged install — `-Replace` switches between them.

To remove:

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

Trusted **People**, not Root, and not the user store — App Installer does not search user
certificates. With that in place the package sideloads on a default Windows 11/10 machine:
**Developer Mode is not required for a signed package**.

A loose developer install and a packaged install of the same identity cannot coexist. Use
`.\scripts\install.ps1 -Replace` to switch back to a loose build.

## Configuration

Settings live in `%APPDATA%\OpenCodeShell\settings.json`, managed through `ocshell.exe`.

```powershell
.\dist\ocshell.exe doctor                  # package / certificate / binary / terminal
.\dist\ocshell.exe settings list
.\dist\ocshell.exe settings terminals      # what was discovered, and where
.\dist\ocshell.exe settings set terminal.id alacritty
.\dist\ocshell.exe settings set terminal.mode default
.\dist\ocshell.exe settings locate-binary  # file picker for opencode.exe
.\dist\ocshell.exe selftest
```

| Key | Values |
|---|---|
| `binaryPath` | full path to `opencode.exe`; empty means auto-discovery |
| `terminal.mode` | `auto`, `default` (no terminal wrapper) or `custom` |
| `terminal.id` | a terminal id from `settings terminals` (used in `auto` mode) |
| `terminal.customPath` | executable for `custom` mode |
| `terminal.customArgs` | argument template, e.g. `--working-directory {dir} -e {command}` |
| `continueFromProjectRoot` | `true`/`false` — fall back to the project root session |
| `logging` | `true`/`false` — verbose log lines |

Terminal discovery probes `App Paths`, `PATH`, and the usual install roots (Program Files,
scoop, chocolatey, MSYS2, Cygwin, Git for Windows). A terminal found without a known command
template is listed with `*` and can still be used through `terminal.mode=custom`.

Argument templates understand `{dir}`, `{command}`, `{commandline}` and `{pscommand}`.

## Test

```powershell
.\tests\menu-smoke-test.ps1
```

Requires an interactive desktop session. It opens a scratch folder, right-clicks the
background and asserts the menu entry exists. It never invokes the entry, so no opencode
process is started.

## How it works

The Windows 11 context menu cannot be extended through the registry — only a **packaged** app
can contribute an `IExplorerCommand`, and the package gives the shell extension an identity.

```
packaging\AppxManifest.xml
├─ windows.comServer                     → OpenCodeShell.dll, STA, surrogate (dllhost)
└─ windows.fileExplorerContextMenus
   ├─ ItemType "Directory"               → folder icons
   └─ ItemType "Directory\Background"    → empty space inside a folder
```

Explorer activates the COM class only while building a menu, so the DLL is loaded on demand.
`GetTitle`/`GetIcon` are kept cheap; the work happens in `Invoke`, which resolves the binary,
optionally checks for an existing session, and calls `CreateProcess` with the folder as the
working directory.

### Behaviour details

| Situation | Result |
|---|---|
| Folder icon, folder background, drive root, desktop | Entry appears |
| More than one item selected | Entry is hidden (only the first folder would be used) |
| `--continue` in a folder with no sessions | Starts a new session instead of erroring |
| `opencode` not found | Warning dialog; details logged |
| opencode exits | Its terminal window closes with it |

## Troubleshooting

**Entry does not appear.** Restart Explorer (`Stop-Process -Name explorer -Force`), or sign out
and back in. Registration changes are picked up by the shell at logon.

**Entry appears but does nothing.** Check the log:

```powershell
Get-Content "$env:LOCALAPPDATA\OpenCodeShell\shell.log" -Tail 20
```

If the file does not exist, the DLL never loaded — the package is probably unregistered or its
folder moved. Re-run `.\scripts\install.ps1`.

**Everything broke after a rebuild.** The package points at `dist\`; re-register it.

## Project layout

```
src\core\                    settings, terminal discovery, binary resolution, launch, log, json
src\extension\command.cpp    IExplorerCommand (Windows 11 packaged verb)
src\cli\main.cpp             ocshell.exe (launch, settings, doctor, selftest)
src\noop.cpp                 placeholder exe required by the manifest
src\resources\app.rc         icon resource
packaging\identity.json      name, publisher, version (single source of truth)
packaging\AppxManifest.template.xml   package + verb registration (rendered per arch)
packaging\Assets\            package logos
installer\openshell.iss      Inno Setup installer
installer\install-package.ps1   cert trust + Add-AppxPackage (also standalone)
scripts\                     build / package / sign / installer / install / uninstall
tests\menu-smoke-test.ps1    end-to-end menu smoke test
tests\com-activation.ps1     headless COM activation check (ARM64 CI)
.github\workflows\           arm64 verification
docs\design-notes.md         platform findings behind the design decisions
docs\distribution.md         shipping options and signing requirements
```

## Publishing notes

- The menu icon currently uses the opencode mark. Replace it before a public release if
  trademark use is a concern (see `docs/distribution.md`).
- No telemetry, no network access, no elevation. The extension only launches a local process.

## License

Not chosen yet. Nothing here may be redistributed until a license is added.

## Credits

Built on opencode's packaging model and Microsoft's
[packaged context-menu documentation](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/integrate-packaged-app-with-file-explorer).
