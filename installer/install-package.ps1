# Installs the OpenCodeShell package. Run elevated by the installer; also usable standalone.
#
#   1. trusts the signing certificate (idempotent, matched by thumbprint)
#   2. installs the MSIX bundle unless an equal or newer version is already present
#
# Exits 0 on success (including "already installed"), 1 on failure.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Certificate,
    [Parameter(Mandatory = $true)][string]$Bundle,
    [Parameter(Mandatory = $true)][string]$Version
)

$ErrorActionPreference = 'Stop'

try {
    if (-not (Test-Path $Certificate)) { throw "certificate not found: $Certificate" }
    if (-not (Test-Path $Bundle)) { throw "bundle not found: $Bundle" }

    # --- certificate trust ---------------------------------------------------------
    # LocalMachine\TrustedPeople, not Root: it is the store App Installer searches, and it
    # grants less than a root certificate.
    $signing = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $Certificate
    $trusted = Get-ChildItem Cert:\LocalMachine\TrustedPeople -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $signing.Thumbprint }

    if ($trusted) {
        Write-Host "certificate already trusted: $($signing.Thumbprint)"
    } else {
        Import-Certificate -FilePath $Certificate -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
        Write-Host "certificate trusted: $($signing.Thumbprint)"
    }

    # --- package -------------------------------------------------------------------
    $installed = Get-AppxPackage OpenCodeShell -ErrorAction SilentlyContinue
    if ($installed) {
        Write-Host "found: $($installed.PackageFullName)"

        if ($installed.Version -and ([version]$installed.Version -ge [version]$Version)) {
            Write-Host 'same or newer version already installed; nothing to do'
            exit 0
        }

        # A loose (developer) registration cannot be upgraded by a packaged one.
        if ($installed.IsDevelopmentMode) {
            Write-Host 'removing developer registration'
            Remove-AppxPackage -Package $installed.PackageFullName
        }
    }

    Add-AppxPackage -Path $Bundle
    $now = Get-AppxPackage OpenCodeShell
    if (-not $now) { throw 'installation reported success but the package is not present' }

    Write-Host "installed: $($now.PackageFullName)"
    exit 0
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
