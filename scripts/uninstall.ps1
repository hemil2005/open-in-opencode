#Requires -Version 5.1
<#
.SYNOPSIS
    Unregisters the package for the current user.

.PARAMETER RemoveLogs
    Also delete %LOCALAPPDATA%\OpenInOpenCode (the extension log).
#>
[CmdletBinding()]
param(
    [switch]$RemoveLogs
)

$ErrorActionPreference = 'Stop'

$removed = $false
foreach ($name in @('OpenInOpenCode', 'OpenCodeShell')) {
    $package = Get-AppxPackage $name -ErrorAction SilentlyContinue
    if ($package) {
        Remove-AppxPackage -Package $package.PackageFullName
        Write-Host "removed : $($package.PackageFullName)"
        $removed = $true
    }
}
if (-not $removed) {
    Write-Host 'Open in OpenCode is not registered for this user.'
}

if ($RemoveLogs) {
    foreach ($name in @('OpenInOpenCode', 'OpenCodeShell')) {
        $logs = Join-Path $env:LOCALAPPDATA $name
        if (Test-Path $logs) {
            Remove-Item $logs -Recurse -Force
            Write-Host "removed : $logs"
        }
    }
}

Write-Host 'If the context menu entry is still visible, restart Explorer or sign out and back in.'
