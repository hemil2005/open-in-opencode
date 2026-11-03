# open-in-opencode

Install [Open in OpenCode](https://github.com/hemil2005/open-in-opencode) from npm.

```powershell
npm install -g open-in-opencode
open-in-opencode install
```

Or without a global install:

```powershell
npx open-in-opencode install
```

The npm package is a small bootstrapper. It downloads the signed Windows setup, verifies its
SHA-256 checksum, and runs it. The setup performs the real installation and asks for
administrator approval. `npm install -g` itself does not change the machine or request
elevation. SmartScreen may show the same "unknown publisher" warning as the direct installer.

## Requirements

- Windows 10 (1809+) or Windows 11
- Node.js 22 or newer
- x64 or arm64

## Commands

```powershell
open-in-opencode install                 # install or upgrade to the latest release
open-in-opencode install --version 1.0.0.0
open-in-opencode install --dry-run       # show the download URLs
open-in-opencode doctor                  # check the package, certificate, binary and terminal
open-in-opencode settings list
open-in-opencode update check
open-in-opencode uninstall
```

`doctor`, `settings` and `update` delegate to `ocshell.exe`, which remains the source of truth.

## Removing

```powershell
open-in-opencode uninstall
npm uninstall -g open-in-opencode
```

`npm uninstall -g` removes only this wrapper. Use `open-in-opencode uninstall` or Windows
**Settings > Apps** to remove the app itself.

## Updates

App updates use the normal Open in OpenCode update channel. The npm wrapper version is
independent of the app version; `open-in-opencode install` always targets the latest release
unless `--version` is given.

## License

MIT. See [LICENSE](LICENSE).
