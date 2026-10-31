#Requires -Version 5.1
<#
.SYNOPSIS
    Compiles the Inno Setup installer and signs it.

.DESCRIPTION
    Requires a signed bundle and a certificate:
        .\scripts\package.ps1 -Sign
        .\scripts\new-cert.ps1

    Inno Setup is fetched into .tools\inno when missing.

.PARAMETER InstallTools
    Download Inno Setup in portable mode into .tools\inno when ISCC.exe is not available.

.PARAMETER SkipSign
    Build the installer without signing it (useful for a quick local test).
#>
[CmdletBinding()]
param(
    [switch]$InstallTools,
    [switch]$SkipSign
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$identity = Get-Content (Join-Path $root 'packaging\identity.json') -Raw | ConvertFrom-Json
$version = $identity.version

$bundle = Join-Path $root "out\OpenCodeShell_$version.msixbundle"
if (-not (Test-Path $bundle)) {
    throw "bundle not found: $bundle. Run .\scripts\package.ps1 -Sign first."
}

$certificate = Join-Path $root '.secrets\OpenCodeShell.cer'
if (-not (Test-Path $certificate)) {
    throw "certificate not found: $certificate. Run .\scripts\new-cert.ps1 first."
}
Copy-Item $certificate (Join-Path $root 'out\OpenCodeShell.cer') -Force
# Inno cannot rename a wildcard Source, so stage the bundle under a fixed name.
Copy-Item $bundle (Join-Path $root 'out\OpenCodeShell.msixbundle') -Force

function Find-Iscc {
    $local = Join-Path $root '.tools\inno\ISCC.exe'
    if (Test-Path $local) { return $local }
    $command = Get-Command 'ISCC.exe' -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    foreach ($candidate in @(
            "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
            "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
            "$env:ProgramFiles\Inno Setup 6\ISCC.exe")) {
        if (Test-Path $candidate) { return $candidate }
    }
    return $null
}

function Install-Inno {
    # jrsoftware.org/download.php now redirects to an HTML page, so take the binary from the
    # project's GitHub releases instead.
    Write-Host 'downloading Inno Setup ...'
    $tools = Join-Path $root '.tools'
    New-Item -ItemType Directory -Force -Path $tools | Out-Null

    $release = Invoke-RestMethod 'https://api.github.com/repos/jrsoftware/issrc/releases/latest'
    $asset = $release.assets | Where-Object { $_.name -like 'innosetup-*.exe' } | Select-Object -First 1
    if (-not $asset) { throw 'could not locate the Inno Setup installer asset' }
    Write-Host "  $($asset.name)"

    $installer = Join-Path $tools 'innosetup.exe'
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $installer -TimeoutSec 900

    $target = Join-Path $tools 'inno'
    # /PORTABLE=1 installs without registry entries or an uninstaller.
    $process = Start-Process -FilePath $installer -Wait -PassThru -ArgumentList @(
        '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/PORTABLE=1', "/DIR=$target"
    )
    if ($process.ExitCode -ne 0) { throw "Inno Setup installer failed: $($process.ExitCode)" }
}

$iscc = Find-Iscc
if (-not $iscc) {
    if (-not $InstallTools) { throw 'ISCC.exe not found. Re-run with -InstallTools.' }
    Install-Inno
    $iscc = Find-Iscc
}
if (-not $iscc) { throw 'ISCC.exe still not found after install.' }

Write-Host "iscc     : $iscc"
Write-Host "version  : $version"
Write-Host "publisher: $($identity.publisher)"

$iss = Join-Path $root 'installer\openshell.iss'
& $iscc "/DAppVersion=$version" "/DPublisherCN=$($identity.publisher)" $iss
if ($LASTEXITCODE -ne 0) { throw 'ISCC compilation failed' }

$setup = Join-Path $root "out\OpenCodeShellSetup-$version.exe"
if (-not (Test-Path $setup)) { throw "expected output not found: $setup" }

if (-not $SkipSign) {
    & (Join-Path $PSScriptRoot 'sign.ps1') -Path $setup
    if ($LASTEXITCODE -ne 0) { throw 'signing failed' }
}

Write-Host ''
Get-ChildItem (Join-Path $root 'out') -File |
    ForEach-Object { '{0,-46} {1,10:N0} bytes' -f $_.Name, $_.Length }
Write-Host ''
Write-Host "Installer: $setup"
exit 0
