#Requires -Version 5.1
<#
.SYNOPSIS
    Builds OpenCodeShell into .\dist, ready to register with install.ps1.

.DESCRIPTION
    Compiles the shell extension DLL (x64) and the placeholder executable, embeds the icon
    resource, and assembles a loose package layout in .\dist:

        dist\AppxManifest.xml
        dist\OpenCodeShell.dll
        dist\noop.exe
        dist\Assets\*.png

.PARAMETER Compiler
    Path to x86_64-w64-mingw32-g++.exe. Defaults to a PATH lookup, then a common install path.

.PARAMETER Clean
    Remove .\dist before building.
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
    foreach ($path in @($dist, $build)) {
        if (Test-Path $path) { Remove-Item $path -Recurse -Force }
    }
}
New-Item -ItemType Directory -Force -Path $dist, $build | Out-Null

Write-Host "compiler : $gxx"

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

# --- extension DLL -------------------------------------------------------------------
# -static* is required: the packaged surrogate (dllhost) only resolves DLLs from the package
# folder and System32, so a dynamic libstdc++/libgcc dependency makes the extension silently
# fail to load.
Write-Host 'dll      : OpenCodeShell.dll'
& $gxx -std=c++17 -O2 -shared -DUNICODE -D_UNICODE `
    -static -static-libgcc -static-libstdc++ `
    -o (Join-Path $dist 'OpenCodeShell.dll') `
    (Join-Path $root 'src\command.cpp') `
    $resource `
    -lole32 -lshlwapi -luuid -lshell32 -luser32
if ($LASTEXITCODE -ne 0) { throw 'extension build failed' }

# --- placeholder executable ----------------------------------------------------------
Write-Host 'exe      : noop.exe'
& $gxx -std=c++17 -O2 -mwindows -DUNICODE -D_UNICODE `
    -o (Join-Path $dist 'noop.exe') `
    (Join-Path $root 'src\noop.cpp')
if ($LASTEXITCODE -ne 0) { throw 'placeholder build failed' }

# --- package payload -----------------------------------------------------------------
Copy-Item (Join-Path $root 'packaging\AppxManifest.xml') $dist -Force
Copy-Item (Join-Path $root 'packaging\Assets') $dist -Recurse -Force

Write-Host ''
Get-ChildItem $dist -Recurse -File |
    ForEach-Object { '{0,-34} {1,10:N0} bytes' -f $_.FullName.Substring($dist.Length + 1), $_.Length }
Write-Host ''
Write-Host "Built into $dist"
Write-Host 'Next: .\scripts\install.ps1'
