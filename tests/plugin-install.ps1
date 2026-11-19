#Requires -Version 5.1
<#
.SYNOPSIS
    Checks that `ocshell plugin install` deploys the packaged runtime into a target and that
    `plugin status` / `plugin uninstall` agree with the filesystem.

.DESCRIPTION
    The target is a temporary directory, so the user's real opencode plugin is never touched.

.PARAMETER Ocshell
    Path to ocshell.exe. Defaults to dist\ocshell.exe, then a PATH lookup.
#>
[CmdletBinding()]
param(
    [string]$Ocshell
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot

if (-not $Ocshell) {
    $candidate = Join-Path $root 'dist\ocshell.exe'
    if (Test-Path $candidate) {
        $Ocshell = $candidate
    } else {
        $command = Get-Command ocshell.exe -ErrorAction SilentlyContinue
        if ($command) { $Ocshell = $command.Source }
    }
}

if (-not $Ocshell -or -not (Test-Path $Ocshell)) {
    throw 'ocshell.exe not found. Pass -Ocshell <path> or build first.'
}

$payload = Join-Path (Split-Path -Parent $Ocshell) 'plugin\tui.ts'
if (-not (Test-Path $payload)) {
    throw "the packaged plugin payload is missing next to $Ocshell"
}

$target = Join-Path ([System.IO.Path]::GetTempPath()) ("ocshell-plugin-cli-" + [guid]::NewGuid().ToString('N'))

try {
    & $Ocshell plugin install --target $target | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'plugin install failed' }

    foreach ($relative in @(
            '.version',
            'tui.ts',
            'lib\format.ts',
            'lib\ocshell.ts',
            'lib\report.ts',
            'lib\state.ts',
            'lib\types.ts',
            'ui\dashboard.tsx',
            'ui\diagnostics.tsx',
            'ui\editors.ts',
            'ui\launch.tsx',
            'ui\register.tsx',
            'ui\rows.ts',
            'ui\updates.ts'
        )) {
        $path = Join-Path $target $relative
        if (-not (Test-Path $path)) { throw "installed plugin is missing $relative" }
    }

    foreach ($relative in @('package.json', 'tsconfig.json', 'bun.lock', 'test', 'node_modules')) {
        $path = Join-Path $target $relative
        if (Test-Path $path) { throw "installed plugin unexpectedly contains $relative" }
    }

    $status = & $Ocshell plugin status --target $target
    if ($LASTEXITCODE -ne 0) { throw 'plugin status failed' }
    if (($status -join "`n") -notmatch 'installed') { throw 'plugin status did not report an install' }

    & $Ocshell plugin uninstall --target $target | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'plugin uninstall failed' }
    if (Test-Path $target) { throw "plugin uninstall did not remove $target" }

    Write-Host 'plugin CLI deployment check passed'
} finally {
    if (Test-Path $target) { Remove-Item $target -Recurse -Force }
}

exit 0
