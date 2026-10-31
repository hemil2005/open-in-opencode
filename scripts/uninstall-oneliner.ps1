#Requires -Version 5.1
<#
.SYNOPSIS
    Removes Open in OpenCode.

.DESCRIPTION
    Run from a checkout:

        .\scripts\uninstall-oneliner.ps1

    Removes the packaged install and, when present, the setup-installed copy. The signing
    certificate is kept unless -RemoveCertificate is given, matching the setup uninstaller.
    This is a repository script, not a release asset; Settings > Apps is the normal path.

.PARAMETER RemoveCertificate
    Also remove the self-signed signing certificate from LocalMachine\TrustedPeople.

.PARAMETER NoElevate
    Skip the self-elevation step (the caller must already be elevated). Used by tests.
#>
[CmdletBinding()]
param(
    [switch]$RemoveCertificate,
    [switch]$NoElevate
)

$ErrorActionPreference = 'Stop'

if ($env:OPENCODE_REMOVE_CERT -eq '1') { $RemoveCertificate = $true }

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin) -and -not $NoElevate -and -not $env:OPENCODE_INSTALL_ELEVATED) {
    Write-Host 'Removing Open in OpenCode requires administrator rights.'
    Write-Host 'Requesting elevation...'
    $env:OPENCODE_INSTALL_ELEVATED = '1'
    if ($RemoveCertificate) { $env:OPENCODE_REMOVE_CERT = '1' }
    $command = if ($PSCommandPath) {
        "& '$PSCommandPath' -NoElevate" + $(if ($RemoveCertificate) { ' -RemoveCertificate' } else { '' })
    } else {
        "`$env:OPENCODE_REMOVE_CERT='$($env:OPENCODE_REMOVE_CERT)'; irm 'https://github.com/hemil2005/open-in-opencode/releases/latest/download/uninstall.ps1' | iex"
    }
    $elevated = Start-Process powershell -Verb RunAs -Wait -PassThru `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command)
    exit $elevated.ExitCode
}

$removed = $false

# Setup install (Windows 10, or the EXE on Windows 11).
$entries = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
) | ForEach-Object { Get-ItemProperty $_ -ErrorAction SilentlyContinue } |
    Where-Object { $_.DisplayName -like 'Open in OpenCode*' }

foreach ($entry in $entries) {
    $commandLine = if ($entry.QuietUninstallString) { $entry.QuietUninstallString } else { $entry.UninstallString }
    if (-not $commandLine) { continue }
    Write-Host "running: $commandLine"
    # Inno's string already carries the silent switches, so let cmd parse it verbatim.
    $process = Start-Process -FilePath $env:ComSpec -ArgumentList '/c', $commandLine -Wait -PassThru
    if ($process.ExitCode -ne 0) { Write-Warning "uninstaller exited with code $($process.ExitCode)" }
    $removed = $true
}

# Packaged install (one-liner, winget, scoop, or the EXE on Windows 11).
foreach ($name in @('OpenInOpenCode', 'OpenCodeShell')) {
    Get-AppxPackage $name -ErrorAction SilentlyContinue | ForEach-Object {
        Remove-AppxPackage -Package $_.PackageFullName
        Write-Host "removed package: $($_.PackageFullName)"
        $removed = $true
    }
}

# Classic registry verbs (Windows 10), in case the setup uninstaller did not run.
$cli = Join-Path $env:ProgramFiles 'OpenInOpenCode\ocshell.exe'
if (Test-Path $cli) { & $cli registry uninstall }

if ($RemoveCertificate) {
    foreach ($subject in @('CN=OpenInOpenCodeDev', 'CN=OpenCodeShellDev')) {
        Get-ChildItem Cert:\LocalMachine\TrustedPeople -ErrorAction SilentlyContinue |
            Where-Object { $_.Subject -eq $subject } |
            ForEach-Object {
                Remove-Item "Cert:\LocalMachine\TrustedPeople\$($_.Thumbprint)" -Force
                Write-Host "removed certificate: $($_.Thumbprint)"
            }
    }
}

foreach ($name in @('OpenInOpenCode', 'OpenCodeShell')) {
    $logs = Join-Path $env:LOCALAPPDATA $name
    if (Test-Path $logs) { Remove-Item $logs -Recurse -Force -ErrorAction SilentlyContinue }
}

if (-not $removed) { Write-Host 'Open in OpenCode was not installed.' }
else { Write-Host 'Open in OpenCode removed. Restart Explorer if the menu entry is still visible.' }
