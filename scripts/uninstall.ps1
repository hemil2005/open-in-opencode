#Requires -Version 5.1
<#
.SYNOPSIS
    Unregisters the package for the current user.

.PARAMETER RemoveLogs
    Also delete %LOCALAPPDATA%\OpenCodeShell (the extension log).
#>
[CmdletBinding()]
param(
    [switch]$RemoveLogs
)

$ErrorActionPreference = 'Stop'

$package = Get-AppxPackage OpenCodeShell
if (-not $package) {
    Write-Host 'OpenCodeShell is not registered for this user.'
} else {
    Remove-AppxPackage -Package $package.PackageFullName
    Write-Host "removed : $($package.PackageFullName)"
}

if ($RemoveLogs) {
    $logs = Join-Path $env:LOCALAPPDATA 'OpenCodeShell'
    if (Test-Path $logs) {
        Remove-Item $logs -Recurse -Force
        Write-Host "removed : $logs"
    }
}

Write-Host 'If the context menu entry is still visible, restart Explorer or sign out and back in.'
