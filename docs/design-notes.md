# Design notes

Findings that shaped the implementation. Several of these cost real debugging time, so they
are recorded rather than rediscovered.

## The modern context menu cannot be extended by registry

Windows 11 shows two context menus. Classic `HKCR\...\shell` verbs are demoted into
*Show more options* (or `Shift+F10`). The main menu only honours packaged apps that declare
`windows.fileExplorerContextMenus` and implement `IExplorerCommand` in a COM DLL.

This is why the project ships a package instead of a `.reg` script.

Corollary: Windows Terminal's own *Open in Terminal* entry comes from its MSIX manifest, not
from a registry verb — there is no `WindowsTerminal` key under `Directory\Background\shell`.

## Only two item types are allowed

The package schema rejects anything else:

```
'Drive' violates pattern constraint of '(\*|(\.[^.\\]+))|Directory|Directory\\Background'
```

So `Drive` and `DesktopBackground` **cannot** be registered. A drive *icon* in This PC is
therefore out of reach; a drive *root* works because it is a directory. The desktop works
because Windows serves its background menu from `Directory\Background`.

## `ECF_HASSUBCOMMANDS` is required for the cascade

`EnumSubCommands` is never called unless `GetFlags` returns `ECF_HASSUBCOMMANDS`. With plain
`ECF_DEFAULT` the item renders as a normal entry with no chevron, and no error is reported.

## The DLL must link the C++ runtime statically

The COM class is hosted by a surrogate (`dllhost.exe`), which resolves DLL imports from the
package folder and System32 only — not from the mingw `bin` directory. A dynamically linked
`libstdc++-6.dll` / `libgcc_s_seh-1.dll` makes the class fail to activate with
`0x8007007E` (module not found), and the menu entry silently disappears.

Build flags: `-static -static-libgcc -static-libstdc++`.

Static linking exposes a second trap: mingw's `libmingwex.a` already defines `StringCchPrintfW`,
so including `<strsafe.h>` produces a duplicate-symbol link error. The code uses `_snwprintf`
instead.

## Unsigned packages can be installed without a certificate — in Developer Mode

`Add-AppxPackage -Register .\AppxManifest.xml` installs a loose-file package with no MSIX, no
signature, no `signtool` and no Windows SDK, provided Developer Mode is on. This is what makes
local development practical.

It also means the package is only usable on machines with Developer Mode enabled. Public
distribution needs a signed package; see [distribution](distribution.md).

## `--continue` against an empty folder produces a bogus session id

Running `opencode --continue` in a folder with no sessions makes the TUI open with a
placeholder id of `"dummy"`, which fails the `starts_with("ses")` validation and surfaces as
a toast:

> Expected a string starting with "ses" at ["sessionID"]

Upstream: [anomalyco/opencode#25989](https://github.com/anomalyco/opencode/issues/25989).

The extension therefore runs `opencode session list --format json -n 1` in the target folder
(3-second cap, no window) and drops `--continue` when the result is empty. `session list` is
scoped to the working directory, which is exactly how `--continue` resolves its target.

## Testing quirks

Automating the shell menu is fiddly, and the smoke test encodes three workarounds:

1. **Foreground.** A background process cannot call `SetForegroundWindow`. Attach to the
   current foreground thread with `AttachThreadInput`, then activate.
2. **DPI.** Without `SetProcessDPIAware`, coordinates are virtualised (a 1920×1200 screen
   reports 1280×800) and synthetic clicks land in the wrong place.
3. **Cascades.** UI Automation cannot see submenu children until the popup is materialised by
   a real pointer hover, so automated tests assert the parent entry's presence only. The child
   titles can be verified from the log when `OPENCODE_SHELL_DEBUG=1`.

Also note that the shell builds a menu by calling `GetTitle` for every entry, which makes the
log a reliable "is our entry in this menu" probe during debugging.
