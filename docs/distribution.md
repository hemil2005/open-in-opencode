# Distribution

The extension works locally but is not yet shippable. This document records what is required,
with current pricing and eligibility as of late 2026.

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
  ├─ llvm-mingw x86_64   → OpenCodeShell.dll
  ├─ llvm-mingw aarch64  → OpenCodeShell.dll
  ├─ MakeAppx            → x64.msix + arm64.msix → OpenCodeShell.msixbundle
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
