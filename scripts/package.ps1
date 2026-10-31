#Requires -Version 5.1
<#
.SYNOPSIS
    Packs the x64 and arm64 builds into an MSIX bundle, optionally signing it.

.PARAMETER Sign
    Sign the bundle with .secrets\OpenCodeShell.pfx.

.PARAMETER InstallTools
    Download MakeAppx/SignTool from the Microsoft.Windows.SDK.BuildTools NuGet package into
    .tools\sdk when they are not already present.

.EXAMPLE
    .\scripts\package.ps1 -InstallTools -Sign
#>
[CmdletBinding()]
param(
    [switch]$Sign,
    [switch]$InstallTools,
    [string]$Pfx,
    [string]$PfxPassword
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$identity = Get-Content (Join-Path $root 'packaging\identity.json') -Raw | ConvertFrom-Json
$version = $identity.version

$toolsRoot = Join-Path $root '.tools'
$sdkRoot = Join-Path $toolsRoot 'sdk'
$outDir = Join-Path $root 'out'
$bundleInput = Join-Path $root '.build\bundle'

function Find-SdkTool {
    param([string]$Name)
    $hit = Get-ChildItem $sdkRoot -Recurse -Filter $Name -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\x64\\' } |
        Select-Object -First 1
    if ($hit) { return $hit.FullName }
    return $null
}

function Install-SdkTools {
    Write-Host 'downloading Microsoft.Windows.SDK.BuildTools ...'
    New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null
    $index = Invoke-RestMethod 'https://api.nuget.org/v3-flatcontainer/microsoft.windows.sdk.buildtools/index.json'
    $latest = ($index.versions | Where-Object { $_ -notmatch 'preview' })[-1]
    $zip = Join-Path $toolsRoot 'sdk.zip'
    $url = "https://api.nuget.org/v3-flatcontainer/microsoft.windows.sdk.buildtools/$latest/microsoft.windows.sdk.buildtools.$latest.nupkg"
    Write-Host "  version $latest"
    Invoke-WebRequest -Uri $url -OutFile $zip -TimeoutSec 600
    Expand-Archive -Path $zip -DestinationPath $sdkRoot -Force
}

$makeappx = Find-SdkTool 'makeappx.exe'
if (-not $makeappx) {
    if (-not $InstallTools) { throw 'makeappx.exe not found. Re-run with -InstallTools.' }
    Install-SdkTools
    $makeappx = Find-SdkTool 'makeappx.exe'
}
if (-not $makeappx) { throw 'makeappx.exe still not found after install.' }

Write-Host "makeappx : $makeappx"
Write-Host "version  : $version"

foreach ($arch in @('x64', 'arm64')) {
    Write-Host ''
    Write-Host "== building $arch =="
    & (Join-Path $PSScriptRoot 'build.ps1') -Architecture $arch -OutDir (Join-Path $root "stage\$arch") -Clean
    if ($LASTEXITCODE -ne 0) { throw "build failed for $arch" }
}

if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
if (Test-Path $bundleInput) { Remove-Item $bundleInput -Recurse -Force }
New-Item -ItemType Directory -Force -Path $outDir, $bundleInput | Out-Null

foreach ($arch in @('x64', 'arm64')) {
    $msix = Join-Path $outDir ("{0}_{1}_{2}.msix" -f $identity.name, $version, $arch)
    Write-Host "packing  : $(Split-Path -Leaf $msix)"
    & $makeappx pack /d (Join-Path $root "stage\$arch") /p $msix /o
    if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed for $arch" }
    Copy-Item $msix $bundleInput -Force
}

$bundle = Join-Path $outDir ("{0}_{1}.msixbundle" -f $identity.name, $version)
Write-Host ''
Write-Host "bundling : $(Split-Path -Leaf $bundle)"
& $makeappx bundle /d $bundleInput /p $bundle /o
if ($LASTEXITCODE -ne 0) { throw 'makeappx bundle failed' }

if ($Sign) {
    Write-Host ''
    & (Join-Path $PSScriptRoot 'sign.ps1') -Path $bundle -Pfx $Pfx -Password $PfxPassword
    if ($LASTEXITCODE -ne 0) { throw 'signing failed' }
}

Write-Host ''
Get-ChildItem $outDir -File | ForEach-Object { '{0,-46} {1,10:N0} bytes' -f $_.Name, $_.Length }
Write-Host ''
Write-Host "Output: $outDir"
exit 0
