# Installs the Open in OpenCode package. Run elevated by the installer; also usable standalone.
#
#   1. trusts the signing certificate (idempotent, matched by thumbprint)
#   2. installs the MSIX, preferring the .appinstaller so updates register
#
# Exits 0 on success (including "already installed"), 1 on failure.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Certificate,
    [string]$Bundle,
    [string]$AppInstaller,
    [Parameter(Mandatory = $true)][string]$Version
)

$ErrorActionPreference = 'Stop'

try {
    if (-not (Test-Path $Certificate)) { throw "certificate not found: $Certificate" }
    if (-not $Bundle -and -not $AppInstaller) { throw 'either -Bundle or -AppInstaller is required' }
    if ($Bundle -and -not (Test-Path $Bundle)) { throw "bundle not found: $Bundle" }
    if ($AppInstaller -and -not (Test-Path $AppInstaller)) { throw "appinstaller not found: $AppInstaller" }

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

    # One-time cleanup of the pre-rename trust entry.
    Get-ChildItem Cert:\LocalMachine\TrustedPeople -ErrorAction SilentlyContinue |
        Where-Object { $_.Subject -eq 'CN=OpenCodeShellDev' -and $_.Thumbprint -ne $signing.Thumbprint } |
        ForEach-Object {
            Remove-Item "Cert:\LocalMachine\TrustedPeople\$($_.Thumbprint)" -Force
            Write-Host "removed legacy certificate: $($_.Thumbprint)"
        }

    # --- package -------------------------------------------------------------------
    # One-time migration from the pre-rename package identity.
    $legacy = Get-AppxPackage OpenCodeShell -ErrorAction SilentlyContinue
    if ($legacy) {
        Write-Host "removing legacy package: $($legacy.PackageFullName)"
        Remove-AppxPackage -Package $legacy.PackageFullName
    }

    $installed = Get-AppxPackage OpenInOpenCode -ErrorAction SilentlyContinue
    if ($installed) {
        Write-Host "found: $($installed.PackageFullName)"

        # A loose (developer) registration cannot be upgraded by a packaged one.
        if ($installed.IsDevelopmentMode) {
            Write-Host 'removing developer registration'
            Remove-AppxPackage -Package $installed.PackageFullName
        } elseif ($installed.Version -and ([version]$installed.Version -ge [version]$Version) -and -not $AppInstaller) {
            Write-Host 'same or newer version already installed; nothing to do'
            exit 0
        }
    }

    if ($AppInstaller -and (Test-Path $AppInstaller)) {
        # The appinstaller pulls the bundle from its URI and registers the update source.
        try {
            Add-AppxPackage -AppInstallerFile $AppInstaller -ErrorAction Stop
            Write-Host 'installed from the appinstaller; updates registered'
        } catch {
            if (-not ($Bundle -and (Test-Path $Bundle))) { throw }
            Write-Warning "appinstaller install failed: $($_.Exception.Message)"
            Write-Host 'falling back to the bundled package'
            Add-AppxPackage -Path $Bundle
        }
    } else {
        Add-AppxPackage -Path $Bundle
    }

    $now = Get-AppxPackage OpenInOpenCode
    if (-not $now) { throw 'installation reported success but the package is not present' }

    Write-Host "installed: $($now.PackageFullName)"
    exit 0
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
