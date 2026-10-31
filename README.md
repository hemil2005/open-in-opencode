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

Working and used daily on Windows 11 (build 26300). **Unsigned**, so it currently installs
through Developer Mode only — see [Distribution](docs/distribution.md) for the public release
plan.

## Features

- Top-level entry in the Windows 11 context menu (not buried under *Show more options*).
- Works on a folder icon, in a folder's empty background, and on a drive root.
- Submenu with session variants:
  - **New session** — `opencode "<dir>"`
  - **Continue last session** — `opencode --continue "<dir>"`, falling back to a new session
    when the folder has no history (avoids opencode's `--continue` placeholder-id error)
  - **Skip permission prompts** — `opencode --auto "<dir>"`
- Finds the opencode binary across npm, curl, scoop, chocolatey and `PATH` installs; override
  with `OPENCODE_SHELL_BINARY`.
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

```powershell
git clone <this repo> opencode-shell
cd opencode-shell
.\scripts\build.ps1
.\scripts\install.ps1 -RestartExplorer
```

`install.ps1` warns if Developer Mode is off, because registering an unsigned package requires
it (`Settings → System → For developers`).

To remove:

```powershell
.\scripts\uninstall.ps1 -RemoveLogs
```

## Build

```powershell
.\scripts\build.ps1            # -> dist\
.\scripts\build.ps1 -Clean
.\scripts\build.ps1 -Compiler 'C:\msys64\mingw64\bin\x86_64-w64-mingw32-g++.exe'
```

`dist\` is a complete loose-package layout (`AppxManifest.xml`, DLL, placeholder exe, assets)
ready for `Add-AppxPackage -Register`. It is git-ignored.

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
src\command.cpp              IExplorerCommand implementation
src\noop.cpp                 placeholder exe required by the manifest
src\resources\app.rc         icon resource
packaging\AppxManifest.xml   package + verb registration
packaging\Assets\            package logos
scripts\                     build / install / uninstall
tests\menu-smoke-test.ps1    end-to-end menu smoke test
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
