#Requires -Version 5.1
<#
.SYNOPSIS
    Registers the built package for the current user (developer install).

.DESCRIPTION
    Registers .\dist as a loose-file package with Add-AppxPackage -Register. That requires
    Windows Developer Mode because the loose layout is unsigned.

    For a real installation use the signed bundle from scripts/package.ps1 instead; a loose
    and a packaged installation of the same identity cannot coexist, so use -Replace to switch.

.PARAMETER Replace
    Remove an existing Open in OpenCode installation (packaged or loose) before registering.

.PARAMETER RestartExplorer
    Restart Explorer so the new verb is picked up immediately. Closes all Explorer windows.
#>
[CmdletBinding()]
param(
    [switch]$Replace,
    [switch]$RestartExplorer
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$manifest = Join-Path $root 'dist\AppxManifest.xml'
if (-not (Test-Path $manifest)) { throw "Not built yet: $manifest. Run .\scripts\build.ps1 first." }

$developerMode = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' `
        -Name AllowDevelopmentWithoutDevLicense -ErrorAction SilentlyContinue).AllowDevelopmentWithoutDevLicense
if ($developerMode -ne 1) {
    Write-Warning 'Developer Mode is off. Registering an unsigned loose package will fail.'
    Write-Warning 'Enable it under Settings > System > For developers, or install the signed bundle.'
}

$legacy = Get-AppxPackage OpenCodeShell -ErrorAction SilentlyContinue
if ($legacy) {
    Write-Host "removing legacy package: $($legacy.PackageFullName)"
    Remove-AppxPackage -Package $legacy.PackageFullName
}

$existing = Get-AppxPackage OpenInOpenCode -ErrorAction SilentlyContinue
if ($existing) {
    $installedFrom = $existing.InstallLocation
    $isThisCheckout = $false
    if ($installedFrom -and (Test-Path $installedFrom)) {
        $isThisCheckout = ((Resolve-Path $installedFrom).Path.TrimEnd('\') -eq
                           (Resolve-Path (Join-Path $root 'dist')).Path.TrimEnd('\'))
    }
    if (-not $isThisCheckout) {
        if (-not $Replace) {
            throw "Open in OpenCode is installed from '$installedFrom'. Re-run with -Replace to switch this checkout to a loose developer install."
        }
        Write-Host "removing existing installation: $($existing.PackageFullName)"
        Remove-AppxPackage -Package $existing.PackageFullName
    }
}

Write-Host "registering $manifest"
Add-AppxPackage -Register $manifest

$package = Get-AppxPackage OpenInOpenCode
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
