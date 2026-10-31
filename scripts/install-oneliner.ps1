#Requires -Version 5.1
<#
.SYNOPSIS
    Installs Open in OpenCode with one command.

.DESCRIPTION
    Run without arguments:

        irm https://github.com/hemil2005/open-in-opencode/releases/latest/download/install.ps1 | iex

    The script re-launches itself elevated (one UAC prompt), detects the Windows build, and
    installs the supported path:

        Windows 11 (22000+)  trust the signing certificate, install the MSIX via .appinstaller
        Windows 10 (1809+)   run the signed setup executable (classic registry verbs)

    Upgrades are in place: running it again on an older version upgrades, on the same or a
    newer version does nothing.

.PARAMETER BaseUri
    Override the download base, e.g. http://localhost:8791 for testing.

.PARAMETER NoElevate
    Skip the self-elevation step (the caller must already be elevated). Used by tests.
#>
[CmdletBinding()]
param(
    [string]$BaseUri,
    [switch]$NoElevate
)

$ErrorActionPreference = 'Stop'

$repo = 'hemil2005/open-in-opencode'
if (-not $BaseUri -and $env:OPENCODE_INSTALL_BASEURI) { $BaseUri = $env:OPENCODE_INSTALL_BASEURI }
if (-not $BaseUri) { $BaseUri = "https://github.com/$repo/releases/latest/download" }
$BaseUri = $BaseUri.TrimEnd('/')

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-WindowsBuild {
    return [int](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' `
            -Name CurrentBuildNumber).CurrentBuildNumber
}

# --- elevation -------------------------------------------------------------------------
if (-not (Test-Admin) -and -not $NoElevate -and -not $env:OPENCODE_INSTALL_ELEVATED) {
    Write-Host 'Open in OpenCode needs administrator rights to trust the signing certificate and install the package.'
    Write-Host 'Requesting elevation...'
    $env:OPENCODE_INSTALL_ELEVATED = '1'
    $command = "`$env:OPENCODE_INSTALL_BASEURI='$BaseUri'; irm '$BaseUri/install.ps1' | iex"
    $elevated = Start-Process powershell -Verb RunAs -Wait -PassThru `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command)
    exit $elevated.ExitCode
}

$build = Get-WindowsBuild
$isWindows11 = $build -ge 22000
$temp = Join-Path $env:TEMP ('open-in-opencode-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $temp | Out-Null

try {
    if ($isWindows11) {
        Write-Host "Windows 11 (build $build): installing the package"

        $certificate = Join-Path $temp 'OpenInOpenCode.cer'
        Write-Host "  downloading $BaseUri/OpenInOpenCode.cer"
        Invoke-WebRequest -Uri "$BaseUri/OpenInOpenCode.cer" -OutFile $certificate -UseBasicParsing

        $signing = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $certificate
        $trusted = Get-ChildItem Cert:\LocalMachine\TrustedPeople -ErrorAction SilentlyContinue |
            Where-Object { $_.Thumbprint -eq $signing.Thumbprint }
        if ($trusted) {
            Write-Host "  certificate already trusted: $($signing.Thumbprint)"
        } else {
            Import-Certificate -FilePath $certificate -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
            Write-Host "  certificate trusted: $($signing.Thumbprint)"
        }

        # One-time migration from the pre-rename identity.
        Get-AppxPackage OpenCodeShell -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Host "  removing legacy package: $($_.PackageFullName)"
            Remove-AppxPackage -Package $_.PackageFullName
        }
        Get-ChildItem Cert:\LocalMachine\TrustedPeople -ErrorAction SilentlyContinue |
            Where-Object { $_.Subject -eq 'CN=OpenCodeShellDev' -and $_.Thumbprint -ne $signing.Thumbprint } |
            ForEach-Object {
                Remove-Item "Cert:\LocalMachine\TrustedPeople\$($_.Thumbprint)" -Force
                Write-Host "  removed legacy certificate: $($_.Thumbprint)"
            }

        $appinstaller = Join-Path $temp 'OpenInOpenCode.appinstaller'
        Write-Host "  downloading $BaseUri/OpenInOpenCode.appinstaller"
        Invoke-WebRequest -Uri "$BaseUri/OpenInOpenCode.appinstaller" -OutFile $appinstaller -UseBasicParsing

        Write-Host '  installing...'
        try {
            Add-AppxPackage -AppInstallerFile $appinstaller -ErrorAction Stop
        } catch {
            Write-Warning "appinstaller install failed: $($_.Exception.Message)"
            Write-Host '  falling back to the bundle'
            [xml]$document = Get-Content $appinstaller -Raw
            $bundleUri = $document.AppInstaller.MainBundle.Uri
            $bundle = Join-Path $temp 'OpenInOpenCode.msixbundle'
            Invoke-WebRequest -Uri $bundleUri -OutFile $bundle -UseBasicParsing
            Add-AppxPackage -Path $bundle
        }

        $package = Get-AppxPackage OpenInOpenCode
        if (-not $package) { throw 'installation reported success but the package is not present' }
        Write-Host "installed: Open in OpenCode $($package.Version)"
        Write-Host 'Right-click any folder to use it.'
    }
    else {
        Write-Host "Windows 10 (build $build): installing the classic menu"
        $setup = Join-Path $temp 'OpenInOpenCodeSetup.exe'
        Write-Host "  downloading $BaseUri/OpenInOpenCodeSetup.exe"
        Invoke-WebRequest -Uri "$BaseUri/OpenInOpenCodeSetup.exe" -OutFile $setup -UseBasicParsing

        $process = Start-Process -FilePath $setup -Wait -PassThru `
            -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART')
        if ($process.ExitCode -ne 0) { throw "setup exited with code $($process.ExitCode)" }

        $cli = Join-Path ${env:ProgramFiles} 'OpenInOpenCode\ocshell.exe'
        if (-not (Test-Path $cli)) { throw "installation finished but $cli is missing" }
        & $cli registry status
        Write-Host 'installed: Open in OpenCode (classic menu)'
    }
}
finally {
    Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
