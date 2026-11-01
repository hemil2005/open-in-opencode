# Third-Party Notices

Open in OpenCode is built with and redistributes no third-party source code in its MSIX
package. The following tools are used at build time or are referenced by the product.

## Build tools

- **Microsoft.Windows.SDK.BuildTools** (`MakeAppx.exe`, `SignTool.exe`) — Microsoft Corporation.
  Used to pack and sign the MSIX bundle. https://www.nuget.org/packages/Microsoft.Windows.SDK.BuildTools
- **llvm-mingw** — LLVM Project, Apache License 2.0 with LLVM Exceptions. Used to cross-compile
  the ARM64 build. https://github.com/mstorsjo/llvm-mingw
- **MinGW-w64** — used for the x64 build.
- **Inno Setup** — Jordan Russell / Martijn Laan. Used to build the Windows installer.
  https://jrsoftware.org/isinfo.php

## Runtime / integration

- **opencode** — the CLI this extension launches. Open in OpenCode is an independent project and
  is not affiliated with or endorsed by the OpenCode team. "OpenCode" is used only to name the
  tool this extension integrates with. https://opencode.ai

## Assets

- The Windows Store logo (`packaging/AssetsStore/StoreLogo.png`) is supplied by the project
  author.
- The context-menu icon (`src/resources/opencode.ico`) is the opencode mark, used only to
  identify the tool the extension launches. It is not affiliated with the OpenCode team.
