#Requires -Version 5.1
<#
.SYNOPSIS
    Builds Open in OpenCode for one architecture into an output directory.

.DESCRIPTION
    Produces a complete loose-package layout:

        <OutDir>\AppxManifest.xml   rendered from packaging/AppxManifest.template.xml
        <OutDir>\OpenInOpenCode.dll
        <OutDir>\ocshell.exe
        <OutDir>\noop.exe
        <OutDir>\Assets\*.png

    x64 uses mingw-w64 (gcc); arm64 uses llvm-mingw (clang), which is the only toolchain that
    targets Windows on ARM.

.PARAMETER Architecture
    x64 (default) or arm64.

.PARAMETER OutDir
    Output directory, relative to the repository root. Defaults to dist.

.PARAMETER Compiler
    Path to the target compiler. Defaults to a PATH lookup, then a known location.

.PARAMETER Clean
    Remove the output and resource directories first.
#>
[CmdletBinding()]
param(
    [ValidateSet('x64', 'arm64')]
    [string]$Architecture = 'x64',
    [string]$OutDir = 'dist',
    [string]$Compiler,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if (-not [System.IO.Path]::IsPathRooted($OutDir)) { $OutDir = Join-Path $root $OutDir }
$build = Join-Path $root ".build\$Architecture"
$generated = Join-Path $root 'src\generated'

$prefix = if ($Architecture -eq 'arm64') { 'aarch64-w64-mingw32' } else { 'x86_64-w64-mingw32' }

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
    return $null
}

$fallbacks = if ($Architecture -eq 'arm64') {
    @(Get-ChildItem (Join-Path $root '.tools\llvm') -Recurse -Filter "$prefix-g++.exe" -ErrorAction SilentlyContinue |
        Select-Object -Expand FullName)
} else {
    @(
        'D:\mingw64\bin\x86_64-w64-mingw32-g++.exe',
        'C:\msys64\mingw64\bin\x86_64-w64-mingw32-g++.exe'
    )
}

$gxx = Resolve-Tool "$prefix-g++" $Compiler $fallbacks
if (-not $gxx) {
    throw @"
Could not find $prefix-g++.
  x64   : install mingw-w64 and add it to PATH, or pass -Compiler.
  arm64 : download llvm-mingw into .tools\llvm (see scripts/package.ps1 -InstallTools).
"@
}

$windres = Join-Path (Split-Path $gxx) "$prefix-windres.exe"
if (-not (Test-Path $windres)) { $windres = Join-Path (Split-Path $gxx) 'windres.exe' }
if (-not (Test-Path $windres)) { throw "windres.exe not found next to $gxx" }

if ($Clean) {
    foreach ($path in @($OutDir, $build)) {
        if (Test-Path $path) { Remove-Item $path -Recurse -Force }
    }
}
New-Item -ItemType Directory -Force -Path $OutDir, $build, $generated | Out-Null

Write-Host "arch     : $Architecture"
Write-Host "compiler : $gxx"

# --- identity header ----------------------------------------------------------------
$identity = Get-Content (Join-Path $root 'packaging\identity.json') -Raw | ConvertFrom-Json
$header = @(
    '#pragma once',
    '',
    '// Generated from packaging/identity.json by scripts/build.ps1. Do not edit.',
    "#define OC_IDENTITY_NAME L`"$($identity.name)`"",
    "#define OC_IDENTITY_PUBLISHER L`"$($identity.publisher)`"",
    "#define OC_IDENTITY_DISPLAY_NAME L`"$($identity.displayName)`"",
    "#define OC_IDENTITY_VERSION L`"$($identity.version)`"",
    "#define OC_IDENTITY_UPDATE_URI L`"$($identity.updateUri)`""
) -join "`r`n"
[System.IO.File]::WriteAllText((Join-Path $generated 'identity.h'), $header, (New-Object System.Text.UTF8Encoding($false)))

# --- manifest ----------------------------------------------------------------------
$template = Get-Content (Join-Path $root 'packaging\AppxManifest.template.xml') -Raw
$manifest = $template.
    Replace('{{NAME}}', $identity.name).
    Replace('{{PUBLISHER}}', $identity.publisher).
    Replace('{{VERSION}}', $identity.version).
    Replace('{{ARCH}}', $Architecture).
    Replace('{{DISPLAY}}', $identity.displayName)
[System.IO.File]::WriteAllText((Join-Path $OutDir 'AppxManifest.xml'), $manifest, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "identity : $($identity.name) $($identity.version) $Architecture"

# --- icon resource -------------------------------------------------------------------
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
    'src\core\registry.cpp',
    'src\core\launch.cpp',
    'src\core\http.cpp',
    'src\core\update.cpp'
) | ForEach-Object { Join-Path $root $_ }

$common = @(
    '-std=c++17', '-O2', '-DUNICODE', '-D_UNICODE',
    # Static C++ runtime is mandatory: the COM surrogate (dllhost) only resolves DLLs from the
    # package folder and System32.
    '-static', '-static-libgcc', '-static-libstdc++',
    "-I$(Join-Path $root 'src')"
)

$libs = @('-lole32', '-lshlwapi', '-luuid', '-lshell32', '-luser32', '-ladvapi32', '-lcrypt32', '-lwinhttp')

Write-Host 'dll      : OpenInOpenCode.dll'
& $gxx @common -shared -o (Join-Path $OutDir 'OpenInOpenCode.dll') `
    $core (Join-Path $root 'src\extension\command.cpp') $resource @libs
if ($LASTEXITCODE -ne 0) { throw 'extension build failed' }

Write-Host 'cli      : ocshell.exe'
& $gxx @common -mconsole -o (Join-Path $OutDir 'ocshell.exe') `
    $core (Join-Path $root 'src\cli\main.cpp') @libs
if ($LASTEXITCODE -ne 0) { throw 'cli build failed' }

Write-Host 'exe      : noop.exe'
& $gxx @common -mwindows -o (Join-Path $OutDir 'noop.exe') (Join-Path $root 'src\noop.cpp')
if ($LASTEXITCODE -ne 0) { throw 'placeholder build failed' }

Copy-Item (Join-Path $root 'packaging\Assets') $OutDir -Recurse -Force

Write-Host ''
Get-ChildItem $OutDir -Recurse -File |
    ForEach-Object { '{0,-34} {1,10:N0} bytes' -f $_.FullName.Substring($OutDir.Length + 1), $_.Length }
Write-Host ''
Write-Host "Built $Architecture into $OutDir"
exit 0
