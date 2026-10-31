# Distribution

The self-signed pipeline is now implemented and verified end to end; a public release still
needs the installer, auto-update and (optionally) the Store. This document records what is
required, with pricing and eligibility as of late 2026.

## Current state

- `scripts/new-cert.ps1` issues a self-signed code-signing certificate whose subject matches
  `packaging/identity.json`.
- `scripts/package.ps1 -Sign` produces a signed `x64 + arm64` MSIX bundle in `out/`.
- Verified: the bundle installs with **Developer Mode disabled** once the certificate is
  trusted in `LocalMachine\TrustedPeople`, and upgrades in place (`0.2.0.0 → 0.3.0.0`).
- ARM64 is verified headlessly by `tests/com-activation.ps1` on a `windows-11-arm` runner.
- `scripts/make-appinstaller.ps1` + `ocshell update check|apply` implement auto-update;
  verified by publishing 0.7.0.0 to a local HTTP server and updating an installed 0.6.0.0.

Still outstanding: the Windows 10 registry path, the opencode plugin, and the Store
submission.

## The form factor is fixed

A shell extension needs package identity, so the deliverable is an **MSIX bundle** containing
the COM DLL, not a script or an npm package.

It also cannot be an opencode plugin: opencode plugins run inside the server process as
JavaScript and have no access to the Windows shell.

## Signing

Windows requires MSIX packages to be signed by a certificate that chains to a trusted root, and
the certificate subject must match `Identity/@Publisher` in the manifest.

| Route | Cost | Available from India | User experience |
|---|---|---|---|
| Microsoft Store (MSIX) | Free — Store re-signs on submission | Yes | No SmartScreen warning, no Developer Mode, automatic updates |
| Azure Artifact Signing (ex-Trusted Signing) | ~$9.99/month | **No** — individuals: USA/Canada; organisations: USA/Canada/EU/UK | SmartScreen warning until reputation builds |
| OV code-signing certificate | ~$150–500/year | Yes | Same warning until reputation builds |
| Self-signed certificate | Free | Yes | Requires trusting a root certificate as admin — not acceptable for public users |
| Unsigned + Developer Mode | Free | Yes | Unacceptable — asks strangers to enable Developer Mode |

Individual Microsoft Store developer registration is currently **free** (ID + selfie
verification; the previous $19 fee was waived).

**Recommendation: Microsoft Store.** It removes the certificate cost and the signing pipeline
entirely, handles updates and uninstall, and a comparable context-menu app already ships there.

## Work required before release

1. **ARM64.** The DLL is x64-only. Build a second DLL with `llvm-mingw`
   (`aarch64-w64-mingw32-g++`) and combine both architectures into an MSIX bundle. Only the
   bundle needs signing.
2. **Binary discovery.** Verify `ResolveBinary()` against every install path users actually
   have, and document `OPENCODE_SHELL_BINARY` as the escape hatch.
3. **Icon and naming.** The current icon is opencode's mark. opencode's README asks projects
   that use its name to state they are unaffiliated; using the logo is a separate trademark
   question. Ship a neutral icon or obtain permission.
4. **Logging.** `shell.log` currently grows without rotation. Rotate or cap it before release.
5. **Store assets.** Screenshots, description, privacy policy, support contact.
6. **CI.** Build both architectures and produce the bundle in GitHub Actions.

## Suggested pipeline

```
GitHub Actions (windows-latest)
  ├─ llvm-mingw x86_64   → OpenInOpenCode.dll
  ├─ llvm-mingw aarch64  → OpenInOpenCode.dll
  ├─ MakeAppx            → x64.msix + arm64.msix → OpenInOpenCode.msixbundle
  ├─ Store: submit bundle to Partner Center (Store signs)
  └─ or: signtool with an OV/Artifact Signing certificate → attach to GitHub Release
```

A **winget** manifest pointing at the GitHub Release is worth adding either way: it gives
`winget install` discoverability without a Store listing. winget does not bypass MSIX signing.

## If distribution is attempted without the Store

- Replace `Publisher` in `packaging/AppxManifest.xml` with the certificate subject exactly.
- Sign with the certificate, then attach the `.msixbundle` to a release.
- Expect SmartScreen warnings until download reputation accumulates (weeks, hundreds of
  installs), regardless of certificate type.
