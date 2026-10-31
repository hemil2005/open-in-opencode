#Requires -Version 5.1
<#
.SYNOPSIS
    Signs a package or executable and verifies the signature.

.PARAMETER Path
    File to sign (.msix, .msixbundle, .exe).

.PARAMETER Pfx
    Path to the certificate. Defaults to .secrets\OpenCodeShell.pfx.

.PARAMETER Password
    PFX password. Defaults to .secrets\password.txt.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [string]$Pfx,
    [string]$Password,
    [string]$TimestampUrl = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot

if (-not [System.IO.Path]::IsPathRooted($Path)) { $Path = Join-Path $root $Path }
if (-not $Pfx) { $Pfx = Join-Path $root '.secrets\OpenCodeShell.pfx' }
if (-not [System.IO.Path]::IsPathRooted($Pfx)) { $Pfx = Join-Path $root $Pfx }
if (-not (Test-Path $Path)) { throw "not found: $Path" }
if (-not (Test-Path $Pfx)) { throw "certificate not found: $Pfx. Run .\scripts\new-cert.ps1 first." }

if (-not $Password) {
    $passwordFile = Join-Path $root '.secrets\password.txt'
    if (Test-Path $passwordFile) { $Password = (Get-Content $passwordFile -Raw).Trim() }
}
if (-not $Password) { throw 'no PFX password: pass -Password or create .secrets\password.txt' }

$signtool = Get-ChildItem (Join-Path $root '.tools\sdk') -Recurse -Filter 'signtool.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\' } |
    Select-Object -First 1
if (-not $signtool) { throw 'signtool.exe not found. Run .\scripts\package.ps1 -InstallTools first.' }

Write-Host "signing : $(Split-Path -Leaf $Path)"
# The timestamp authority is the flakiest part of signing; retry and fall back before giving up.
$timestampUrls = @($TimestampUrl, 'http://timestamp.sectigo.com', 'http://timestamp.digicert.com') |
    Where-Object { $_ } | Select-Object -Unique

$signed = $false
foreach ($url in $timestampUrls) {
    & $signtool.FullName sign /fd SHA256 /f $Pfx /p $Password /tr $url /td SHA256 $Path
    if ($LASTEXITCODE -eq 0) {
        $signed = $true
        break
    }
    Write-Warning "timestamping via $url failed; retrying"
    Start-Sleep -Seconds 2
}

if (-not $signed) {
    Write-Warning 'all timestamp servers failed; signing without a timestamp'
    Write-Warning 'the signature stays valid but stops verifying when the certificate expires'
    & $signtool.FullName sign /fd SHA256 /f $Pfx /p $Password $Path
    if ($LASTEXITCODE -ne 0) { throw 'signtool sign failed' }
}

Write-Host 'verifying ...'
$output = & $signtool.FullName verify /pa /v $Path 2>&1
$output | Write-Output
if ($LASTEXITCODE -ne 0) {
    $text = ($output | Out-String)
    if ($text -match 'not trusted|terminated in a root') {
        Write-Warning 'Signature is present but the certificate is not trusted yet.'
        Write-Warning 'Import .secrets\OpenCodeShell.cer into LocalMachine\TrustedPeople to complete the chain.'
        exit 0
    }
    throw 'signtool verify failed'
}
Write-Host 'signature valid'
