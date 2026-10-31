#Requires -Version 5.1
<#
.SYNOPSIS
    Installs (or removes) the optional opencode plugin that adds the /ocshell dashboard.

.DESCRIPTION
    Copies the runtime plugin files into the opencode config directory, where OpenCode
    discovers them:

        %USERPROFILE%\.config\opencode\plugins\open-in-opencode\tui.ts
        %USERPROFILE%\.config\opencode\plugins\open-in-opencode\lib\
        %USERPROFILE%\.config\opencode\plugins\open-in-opencode\ui\

    Only runtime files are copied. package.json, tsconfig.json, bun.lock and test/ stay in the
    repository. The plugin is a thin front end over ocshell.exe and is optional: everything it
    does is also available from a terminal.
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

$sourceRoot = Join-Path $root 'plugin'
$entry = Join-Path $sourceRoot 'tui.ts'
if (-not (Test-Path $entry)) { throw "plugin entry not found: $entry" }

foreach ($directory in @('lib', 'ui')) {
    $source = Join-Path $sourceRoot $directory
    if (-not (Test-Path $source)) { throw "plugin directory not found: $source" }
}

New-Item -ItemType Directory -Force -Path $Target | Out-Null

# Remove stale runtime files before copying so a renamed or deleted module cannot linger.
foreach ($directory in @('lib', 'ui')) {
    $stale = Join-Path $Target $directory
    if (Test-Path $stale) { Remove-Item $stale -Recurse -Force }
}

Copy-Item $entry $Target -Force
foreach ($directory in @('lib', 'ui')) {
    Copy-Item (Join-Path $sourceRoot $directory) (Join-Path $Target $directory) -Recurse -Force
}

Write-Host "installed: $Target"
Write-Host ''
Write-Host 'Restart opencode, then run /ocshell to open the dashboard.'
Write-Host 'The dashboard can change the terminal, override the opencode path, toggle settings,'
Write-Host 'check for updates and copy a diagnostics report.'

if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) {
    Write-Warning 'opencode was not found on PATH; the plugin will load once it is installed.'
}
exit 0
