#Requires -Version 5.1
<#
.SYNOPSIS
    Creates the self-signed code-signing certificate used to sign the MSIX bundle.

.DESCRIPTION
    The certificate subject must match Identity/@Publisher exactly, otherwise the package
    cannot be installed. packaging/identity.json is the source of truth for that value.

    Outputs (both git-ignored):
        .secrets\OpenInOpenCode.pfx   private key, used by sign.ps1
        .secrets\OpenInOpenCode.cer   public key, shipped by the installer
        .secrets\password.txt        PFX password, for local use only

    This is a development certificate. Step up to Azure Artifact Signing or the Microsoft
    Store before distributing publicly; see docs/distribution.md.

.PARAMETER Password
    PFX password. Generated and stored in .secrets\password.txt when omitted.
#>
[CmdletBinding()]
param(
    [string]$Password,
    [string]$OutDir = '.secrets',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if (-not [System.IO.Path]::IsPathRooted($OutDir)) { $OutDir = Join-Path $root $OutDir }

$identity = Get-Content (Join-Path $root 'packaging\identity.json') -Raw | ConvertFrom-Json
$publisher = $identity.publisher

$pfx = Join-Path $OutDir 'OpenInOpenCode.pfx'
$cer = Join-Path $OutDir 'OpenInOpenCode.cer'
$passwordFile = Join-Path $OutDir 'password.txt'

if ((Test-Path $pfx) -and -not $Force) {
    Write-Host "certificate already exists: $pfx"
    Write-Host 'Pass -Force to create a new one (existing installs will stop updating).'
    exit 0
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

if (-not $Password) {
    if (Test-Path $passwordFile) {
        $Password = (Get-Content $passwordFile -Raw).Trim()
    } else {
        $bytes = New-Object byte[] 24
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $Password = [Convert]::ToBase64String($bytes)
        Set-Content -Path $passwordFile -Value $Password -NoNewline
    }
}

Write-Host "publisher : $publisher"

# Code-signing EKU (1.3.6.1.5.5.7.3.3) plus digital signature key usage.
$certificate = New-SelfSignedCertificate `
    -Type Custom `
    -Subject $publisher `
    -KeyUsage DigitalSignature `
    -FriendlyName 'OpenInOpenCode signing' `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}') `
    -NotAfter (Get-Date).AddYears(3)

$secure = ConvertTo-SecureString -String $Password -Force -AsPlainText
Export-PfxCertificate -Cert $certificate -FilePath $pfx -Password $secure | Out-Null
Export-Certificate -Cert $certificate -FilePath $cer | Out-Null

Write-Host "pfx       : $pfx"
Write-Host "cer       : $cer"
Write-Host "thumbprint: $($certificate.Thumbprint)"
Write-Host ''
Write-Host 'Trust it for local testing (requires an elevated shell):'
Write-Host "  Import-Certificate -FilePath `"$cer`" -CertStoreLocation Cert:\LocalMachine\TrustedPeople"
