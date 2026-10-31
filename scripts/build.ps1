#Requires -Version 5.1
<#
.SYNOPSIS
    Builds OpenCodeShell into .\dist (extension DLL, ocshell.exe, placeholder exe, package).

.PARAMETER Compiler
    Path to x86_64-w64-mingw32-g++.exe. Defaults to a PATH lookup, then a common install path.

.PARAMETER Clean
    Remove .\dist and .\src\generated before building.
#>
[CmdletBinding()]
param(
    [string]$Compiler,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$build = Join-Path $root '.build'
$generated = Join-Path $root 'src\generated'

function Resolve-Tool {
    param([string]$Name, [string]$Override, [string[]]$Fallbacks)

    if ($Override) {
        if (-not (Test-Path $Override)) { throw "tool not found: $Override" }
        return $Override
    }
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    foreach ($candidate in $Fallbacks) {
        if (Test-Path $candidate) { return $candidate }
    }
    throw "Could not find $Name. Install mingw-w64 and add it to PATH, or pass -Compiler."
}

$gxx = Resolve-Tool 'x86_64-w64-mingw32-g++' $Compiler @(
    'D:\mingw64\bin\x86_64-w64-mingw32-g++.exe',
    'C:\msys64\mingw64\bin\x86_64-w64-mingw32-g++.exe'
)
$windres = Join-Path (Split-Path $gxx) 'windres.exe'
if (-not (Test-Path $windres)) { throw "windres.exe not found next to $gxx" }

if ($Clean) {
    foreach ($path in @($dist, $build, $generated)) {
        if (Test-Path $path) { Remove-Item $path -Recurse -Force }
    }
}
New-Item -ItemType Directory -Force -Path $dist, $build, $generated | Out-Null

Write-Host "compiler : $gxx"

# --- identity header ----------------------------------------------------------------
# Generated rather than committed so packaging/identity.json stays the single source of truth.
$identity = Get-Content (Join-Path $root 'packaging\identity.json') -Raw | ConvertFrom-Json
$header = @(
    '#pragma once',
    '',
    '// Generated from packaging/identity.json by scripts/build.ps1. Do not edit.',
    "#define OC_IDENTITY_NAME L`"$($identity.name)`"",
    "#define OC_IDENTITY_PUBLISHER L`"$($identity.publisher)`"",
    "#define OC_IDENTITY_DISPLAY_NAME L`"$($identity.displayName)`"",
    "#define OC_IDENTITY_VERSION L`"$($identity.version)`""
) -join "`r`n"
[System.IO.File]::WriteAllText((Join-Path $generated 'identity.h'), $header, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "identity : $($identity.name) $($identity.version) ($($identity.publisher))"

# --- icon resource -------------------------------------------------------------------
Write-Host 'resource : src\resources\app.rc'
$resource = Join-Path $build 'app.res'
Push-Location (Join-Path $root 'src\resources')
try {
    & $windres -i 'app.rc' -O coff -o $resource
    if ($LASTEXITCODE -ne 0) { throw 'windres failed' }
} finally {
    Pop-Location
}

$core = @(
    'src\core\json.cpp',
    'src\core\paths.cpp',
    'src\core\log.cpp',
    'src\core\settings.cpp',
    'src\core\terminals.cpp',
    'src\core\binary.cpp',
    'src\core\launch.cpp'
) | ForEach-Object { Join-Path $root $_ }

$common = @(
    '-std=c++17', '-O2', '-DUNICODE', '-D_UNICODE',
    '-static', '-static-libgcc', '-static-libstdc++',
    "-I$(Join-Path $root 'src')"
)

$libs = @('-lole32', '-lshlwapi', '-luuid', '-lshell32', '-luser32', '-ladvapi32', '-lcrypt32')

# --- extension DLL -------------------------------------------------------------------
# Static C++ runtime is mandatory: the COM surrogate (dllhost) only resolves DLLs from the
# package folder and System32, so a dynamic libstdc++/libgcc dependency makes the extension
# fail to load with 0x8007007E.
Write-Host 'dll      : OpenCodeShell.dll'
& $gxx @common -shared -o (Join-Path $dist 'OpenCodeShell.dll') `
    $core (Join-Path $root 'src\extension\command.cpp') $resource @libs
if ($LASTEXITCODE -ne 0) { throw 'extension build failed' }

# --- CLI -----------------------------------------------------------------------------
Write-Host 'cli      : ocshell.exe'
& $gxx @common -mconsole -o (Join-Path $dist 'ocshell.exe') `
    $core (Join-Path $root 'src\cli\main.cpp') @libs
if ($LASTEXITCODE -ne 0) { throw 'cli build failed' }

# --- placeholder executable ----------------------------------------------------------
Write-Host 'exe      : noop.exe'
& $gxx @common -mwindows -o (Join-Path $dist 'noop.exe') (Join-Path $root 'src\noop.cpp')
if ($LASTEXITCODE -ne 0) { throw 'placeholder build failed' }

# --- package payload -----------------------------------------------------------------
Copy-Item (Join-Path $root 'packaging\AppxManifest.xml') $dist -Force
Copy-Item (Join-Path $root 'packaging\Assets') $dist -Recurse -Force

Write-Host ''
Get-ChildItem $dist -Recurse -File |
    ForEach-Object { '{0,-34} {1,10:N0} bytes' -f $_.FullName.Substring($dist.Length + 1), $_.Length }
Write-Host ''
Write-Host "Built into $dist"
