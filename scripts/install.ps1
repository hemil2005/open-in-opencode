#Requires -Version 5.1
<#
.SYNOPSIS
    Registers the built package for the current user.

.DESCRIPTION
    Registers .\dist as a loose-file package with Add-AppxPackage -Register.

    This package is currently unsigned, so registration requires Windows Developer Mode.
    That is fine for local use and testing; public distribution needs a signed package
    (see docs/distribution.md).

.PARAMETER RestartExplorer
    Restart Explorer after registering so the new verb is picked up immediately. This closes
    all File Explorer windows.
#>
[CmdletBinding()]
param(
    [switch]$RestartExplorer
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$manifest = Join-Path $root 'dist\AppxManifest.xml'
if (-not (Test-Path $manifest)) { throw "Not built yet: $manifest. Run .\scripts\build.ps1 first." }

$developerMode = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' `
        -Name AllowDevelopmentWithoutDevLicense -ErrorAction SilentlyContinue).AllowDevelopmentWithoutDevLicense
if ($developerMode -ne 1) {
    Write-Warning 'Developer Mode is off. Registering an unsigned package will fail.'
    Write-Warning 'Enable it under Settings > System > For developers, then re-run this script.'
}

Write-Host "registering $manifest"
Add-AppxPackage -Register $manifest -ForceUpdateFromAnyVersion

$package = Get-AppxPackage OpenCodeShell
if (-not $package) { throw 'registration reported success but the package is not present' }
Write-Host "installed : $($package.PackageFullName)"
Write-Host "location  : $($package.InstallLocation)"

if ($RestartExplorer) {
    Write-Host 'restarting Explorer...'
    Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
} else {
    Write-Host 'If the entry does not appear yet, restart Explorer or sign out and back in.'
}
