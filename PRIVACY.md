# Privacy Policy — Open in OpenCode

**Effective date:** November 1, 2026
**Publisher:** Hemil Shah (independent developer)

## Summary

Open in OpenCode is a Windows File Explorer extension that launches the opencode command-line
tool in the folder you select. It does not collect, transmit, or sell personal data. Everything
it stores stays on your device.

## What the app does

When you choose "Open in OpenCode" from the context menu, the app starts the `opencode`
program with the selected folder as its working directory. It does not read, upload, or analyze
the contents of your files.

## Data we collect

None. The app has no accounts, no telemetry, no analytics, no advertising, and no crash
reporting. We do not receive any information about you or your usage.

## Data stored on your device

The app stores a small settings file and a local log:

- `%APPDATA%\OpenInOpenCode\settings.json` — your preferences (terminal choice, binary path,
  update URL, logging).
- `%LOCALAPPDATA%\OpenInOpenCode\shell.log` — diagnostic messages, kept locally and rotated at
  1 MB.

Neither file is transmitted anywhere. You can delete them at any time; uninstalling the app
removes them.

## Network access

The app only uses the network for updates:

- The direct-download build uses the MSIX `.appinstaller` mechanism and `ocshell update
  check|apply` to contact GitHub (github.com) for version information and a newer build.
- The Microsoft Store build is updated by the Store and does not contact GitHub.
- Update requests contain no personal data beyond what is inherent to any HTTPS request (such
  as your IP address, handled by GitHub or Microsoft under their own privacy policies).

The app does not contact any other server.

## Third-party software

The app launches `opencode`, which is a separate product with its own privacy policy. Any data
that `opencode` processes (for example, prompts sent to an AI provider) is governed by
opencode's terms and privacy policy, not this one.

## Certificate

The direct-download installer adds the app's self-signed signing certificate to the Windows
trusted store so Windows can verify the package. This is a public certificate and does not
contain personal data. Microsoft Store installs are signed by Microsoft and need no local
certificate.

## Children's privacy

The app is not directed at children and collects no data from anyone.

## Changes

If this policy changes, the updated version will be published at this URL with a new effective
date.

## Contact

Questions: https://github.com/hemil2005/open-in-opencode/issues
