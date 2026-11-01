#Requires -Version 5.1
<#
.SYNOPSIS
    Installs Open in OpenCode with one command.

.DESCRIPTION
    Run without arguments:

        irm https://github.com/hemil2005/open-in-opencode/releases/latest/download/install.ps1 | iex

    The script re-launches itself elevated (one UAC prompt), downloads the signed setup
    executable, and runs it silently. The setup chooses the right path for the OS:

        Windows 11 (22000+)  trusts the signing certificate and installs the MSIX package
        Windows 10 (1809+)   installs ocshell.exe and the classic registry verbs

    The setup carries the certificate and the package, so no other download is needed.
    Running it again upgrades in place.

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

$temp = Join-Path $env:TEMP ('open-in-opencode-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $temp | Out-Null

try {
    $setup = Join-Path $temp 'OpenInOpenCodeSetup.exe'
    Write-Host "downloading $BaseUri/OpenInOpenCodeSetup.exe"
    Invoke-WebRequest -Uri "$BaseUri/OpenInOpenCodeSetup.exe" -OutFile $setup -UseBasicParsing

    Write-Host 'running the installer...'
    $process = Start-Process -FilePath $setup -Wait -PassThru `
        -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART')
    if ($process.ExitCode -ne 0) { throw "setup exited with code $($process.ExitCode)" }

    $package = Get-AppxPackage OpenInOpenCode -ErrorAction SilentlyContinue
    if ($package) {
        Write-Host "installed: Open in OpenCode $($package.Version)"
        Write-Host 'Right-click any folder to use it.'
    }
    else {
        $cli = Join-Path $env:ProgramFiles 'OpenInOpenCode\ocshell.exe'
        if (-not (Test-Path $cli)) { throw 'installation finished but nothing was found' }
        & $cli registry status
        Write-Host 'installed: Open in OpenCode (classic menu)'
    }
}
finally {
    Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
