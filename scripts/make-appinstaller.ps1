#Requires -Version 5.1
<#
.SYNOPSIS
    Generates the .appinstaller file that drives automatic updates.

.DESCRIPTION
    The .appinstaller is published in the fixed "updates" release (a prerelease, so it never
    shows as Latest), together with the bundle and certificate:

        https://github.com/<owner>/<repo>/releases/download/updates/OpenInOpenCode.appinstaller

    Inside, MainBundle/Uri points at the versioned bundle in the same release. The user-facing
    release stays clean: only the setup executable and install.ps1.

.PARAMETER Repo
    GitHub repository as owner/name.

.PARAMETER Tag
    Release tag that holds the payload. Use "updates" (the default for releases).

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
    $installerUri = "$($BaseUri.TrimEnd('/'))/OpenInOpenCode.appinstaller"
    $bundleUri = "$($BaseUri.TrimEnd('/'))/OpenInOpenCode_$version.msixbundle"
} else {
    if (-not $Repo) { throw 'Pass -Repo <owner/name> (or -BaseUri for a local test).' }
    if (-not $Tag) { $Tag = 'updates' }
    $installerUri = "https://github.com/$Repo/releases/download/$Tag/OpenInOpenCode.appinstaller"
    $bundleUri = "https://github.com/$Repo/releases/download/$Tag/OpenInOpenCode_$version.msixbundle"
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
$path = Join-Path $outDir 'OpenInOpenCode.appinstaller'
[System.IO.File]::WriteAllText($path, $document, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "version   : $version"
Write-Host "installer : $installerUri"
Write-Host "bundle    : $bundleUri"
Write-Host "written   : $path"
Write-Host ''
Write-Host 'Point clients at it with:'
Write-Host "  ocshell settings set updateUri `"$installerUri`""
exit 0
