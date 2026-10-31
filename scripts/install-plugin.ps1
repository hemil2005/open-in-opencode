#Requires -Version 5.1
<#
.SYNOPSIS
    Installs (or removes) the optional opencode plugin that adds the /ocshell command.

.DESCRIPTION
    Copies plugin\tui.ts into the opencode config directory, where OpenCode discovers it:

        %USERPROFILE%\.config\opencode\plugins\open-in-opencode\tui.ts

    The plugin is a thin front end over ocshell.exe. It is optional: everything it does is
    also available from a terminal.
#>
[CmdletBinding()]
param(
    [switch]$Uninstall,
    [string]$Target
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if (-not $Target) { $Target = Join-Path $env:USERPROFILE '.config\opencode\plugins\open-in-opencode' }

# Remove the pre-rename plugin directory, whichever action this is.
$legacy = Join-Path $env:USERPROFILE '.config\opencode\plugins\opencode-shell'
if (Test-Path $legacy) {
    Remove-Item $legacy -Recurse -Force
    Write-Host "removed legacy: $legacy"
}

if ($Uninstall) {
    if (Test-Path $Target) {
        Remove-Item $Target -Recurse -Force
        Write-Host "removed  : $Target"
    } else {
        Write-Host "not installed: $Target"
    }
    exit 0
}

$source = Join-Path $root 'plugin\tui.ts'
if (-not (Test-Path $source)) { throw "plugin source not found: $source" }

New-Item -ItemType Directory -Force -Path $Target | Out-Null
Copy-Item $source $Target -Force

Write-Host "installed: $Target"
Write-Host ''
Write-Host 'Restart opencode, then run /ocshell in the TUI.'

if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) {
    Write-Warning 'opencode was not found on PATH; the plugin will load once it is installed.'
}
exit 0
