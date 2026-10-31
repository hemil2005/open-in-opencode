#Requires -Version 5.1
<#
.SYNOPSIS
    Generates the .appinstaller file that drives automatic updates.

.DESCRIPTION
    The .appinstaller must be published at a stable URL so installed clients can find new
    versions. The convention used here is a release asset with a fixed name:

        https://github.com/<owner>/<repo>/releases/latest/download/OpenCodeShell.appinstaller

    Inside, MainBundle/Uri points at the versioned bundle of that release.

.PARAMETER Repo
    GitHub repository as owner/name.

.PARAMETER Tag
    Release tag. Defaults to v<version>.

.PARAMETER BaseUri
    Overrides both URIs, e.g. http://localhost:8791 for local testing.

.EXAMPLE
    .\scripts\make-appinstaller.ps1 -Repo hemil2005/open-in-opencode
#>
[CmdletBinding()]
param(
    [string]$Repo,
    [string]$Tag,
    [string]$BaseUri
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$identity = Get-Content (Join-Path $root 'packaging\identity.json') -Raw | ConvertFrom-Json
$version = $identity.version

if ($BaseUri) {
    $installerUri = "$($BaseUri.TrimEnd('/'))/OpenCodeShell.appinstaller"
    $bundleUri = "$($BaseUri.TrimEnd('/'))/OpenCodeShell_$version.msixbundle"
} else {
    if (-not $Repo) { throw 'Pass -Repo <owner/name> (or -BaseUri for a local test).' }
    if (-not $Tag) { $Tag = "v$version" }
    $installerUri = "https://github.com/$Repo/releases/latest/download/OpenCodeShell.appinstaller"
    $bundleUri = "https://github.com/$Repo/releases/download/$Tag/OpenCodeShell_$version.msixbundle"
}

$template = Get-Content (Join-Path $root 'packaging\appinstaller.template.xml') -Raw
$document = $template.
    Replace('{{INSTALLER_URI}}', $installerUri).
    Replace('{{NAME}}', $identity.name).
    Replace('{{PUBLISHER}}', $identity.publisher).
    Replace('{{VERSION}}', $version).
    Replace('{{BUNDLE_URI}}', $bundleUri)

$outDir = Join-Path $root 'out'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$path = Join-Path $outDir 'OpenCodeShell.appinstaller'
[System.IO.File]::WriteAllText($path, $document, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "version   : $version"
Write-Host "installer : $installerUri"
Write-Host "bundle    : $bundleUri"
Write-Host "written   : $path"
Write-Host ''
Write-Host 'Point clients at it with:'
Write-Host "  ocshell settings set updateUri `"$installerUri`""
