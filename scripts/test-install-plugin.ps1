#Requires -Version 5.1
<#
.SYNOPSIS
    Installs the plugin into a temporary target and checks the runtime file layout.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$installer = Join-Path $PSScriptRoot 'install-plugin.ps1'
$target = Join-Path ([System.IO.Path]::GetTempPath()) ("ocshell-plugin-test-" + [guid]::NewGuid().ToString("N"))

try {
    & $installer -Target $target | Out-Null

    foreach ($relative in @(
            'tui.ts',
            'lib/ocshell.ts',
            'lib/state.ts',
            'lib/types.ts',
            'ui/register.tsx',
            'ui/dashboard.tsx',
            'ui/rows.ts',
            'ui/editors.ts',
            'ui/launch.tsx',
            'ui/updates.ts',
            'ui/diagnostics.tsx'
        )) {
        $path = Join-Path $target $relative
        if (-not (Test-Path $path)) { throw "installed plugin is missing $relative" }
    }

    foreach ($relative in @('package.json', 'tsconfig.json', 'bun.lock', 'test')) {
        $path = Join-Path $target $relative
        if (Test-Path $path) { throw "installed plugin unexpectedly contains $relative" }
    }

    & $installer -Target $target -Uninstall | Out-Null
    if (Test-Path $target) { throw "installer did not remove $target" }

    Write-Host "installer layout check passed"
} finally {
    if (Test-Path $target) { Remove-Item $target -Recurse -Force }
}

exit 0
