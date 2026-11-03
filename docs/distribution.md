# Distribution

Open in OpenCode ships through three channels.

| Channel | Signing | User experience |
|---|---|---|
| Microsoft Store (MSIX) | Microsoft re-signs on submission | No SmartScreen warning, no certificate step, Store-managed updates |
| Direct download (EXE / one-liner) | Stable self-signed certificate | SmartScreen "unknown publisher" until the user chooses Run anyway; the installer trusts the certificate |
| npm (`open-in-opencode`) | Uses the direct-download setup | Installs a Node bootstrapper; the signed setup still performs the install and asks for administrator approval |

## Microsoft Store

- Identity: `Hemil.OpeninOpenCode` / `CN=CF970B36-771B-4CB4-BE90-BB2782DFF0B7` /
  `PublisherDisplayName=Hemil`, in `packaging/identity.store.json`.
- Build with `scripts/package.ps1 -Store`; validate with the Windows App Certification Kit;
  upload the bundle in Partner Center.
- The Store signs the package. The local `StoreTest` certificate exists only to install the
  package for testing and is never published.
- Updates are managed by the Store. The Store build does not contact GitHub and does not ship
  an `.appinstaller`.
- The Store uses the square `StoreLogo`; the context-menu icon and the README wide logo are
  unchanged.

## Direct download

- Every direct release is signed with the stable self-signed certificate
  (`CN=OpenInOpenCodeDev`).
- The installer trusts that certificate in `LocalMachine\TrustedPeople`; the one-liner runs the
  installer, which performs the trust step.
- SmartScreen shows "unknown publisher". This is expected for a self-signed certificate and is
  accepted for this project. No CA or Azure Trusted Signing certificate is used.
- Updates use the fixed `updates` prerelease and the `.appinstaller`; `ocshell update apply`
  installs from a detached helper after the running process exits.

## npm

- The npm package contains only a Node bootstrapper. It downloads the fixed-name
  `OpenInOpenCodeSetup.exe` and `checksums.txt` from the latest direct release, verifies the
  SHA-256, and runs the signed setup elevated.
- npm does not sign anything or reimplement the installation. The direct-download certificate
  and installer rules above still apply.
- The package is Windows-only and requires Node.js 22 or newer. `npm install -g` does not
  change the machine; installation is the explicit `open-in-opencode install` command.
- `doctor`, `settings` and `update` delegate to `ocshell.exe`. The npm wrapper version is
  independent of the app's four-part version.

## Why both MSIX and EXE

- The Windows 11 top-level context menu requires a packaged app
  (`windows.fileExplorerContextMenus`).
- The EXE is the bootstrapper: it installs the MSIX on Windows 11, or the CLI and classic
  registry verbs on Windows 10.
- winget and scoop consume the EXE. npm uses the EXE as well, so there is still one signed
  installer and one set of install rules.

## Store assets

| Asset | Path |
|---|---|
| Store logo (50×50) | `packaging/AssetsStore/StoreLogo.png` |
| Store listing image (300×300) | `packaging/AssetsStore/store-listing-300.png` |
| Context-menu icon | `src/resources/opencode.ico` (unchanged) |
| README logo | `docs/images/logo-wide.svg` (unchanged) |

## Package managers

winget and scoop manifests live under `manifests/` and point at the versioned setup executable.
They are written but not submitted.

The npm package lives under `npm/` and is published as `open-in-opencode`. It is published
separately from the app release so the wrapper can be updated without a new app build. The
release workflow publishes `checksums.txt`; the npm CLI refuses to install without a matching
entry.

## Pipeline

```
GitHub Actions (windows-latest)
  -> llvm-mingw 20261020 + SDK BuildTools 10.0.28000.2957
  -> x64 + arm64 DLLs -> OpenInOpenCode_<version>.msixbundle
  -> direct: sign with the self-signed cert, publish setup + install.ps1, payload to "updates"
  -> store: build -Store, assert identity, upload the store-msix artifact for submission
```
