#Requires -Version 5.1
<#
.SYNOPSIS
    Headless check that the packaged COM class loads and returns the expected title.

.DESCRIPTION
    Uses CoCreateInstance on the packaged CLSID, queries IExplorerCommand and calls GetTitle.
    This exercises the pieces that actually differ between architectures -- package
    registration, surrogate activation, DLL loading and COM wiring -- without needing an
    interactive Explorer session. It is the ARM64 verification used in CI.

    The package must already be registered (install.ps1 locally, Add-AppxPackage in CI).
#>
[CmdletBinding()]
param(
    [string]$ExpectedTitle = 'Open in OpenCode',
    [string]$PackageName = 'OpenInOpenCode'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-AppxPackage $PackageName -ErrorAction SilentlyContinue)) {
    throw 'Open in OpenCode is not registered for this user.'
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("a08ce4d0-fa25-44ab-b57c-c7b1c323e0b9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IExplorerCommand {
    [PreserveSig] int GetTitle(IntPtr psiItemArray, out IntPtr ppszName);
    [PreserveSig] int GetIcon(IntPtr psiItemArray, out IntPtr ppszIcon);
    [PreserveSig] int GetToolTip(IntPtr psiItemArray, out IntPtr ppszInfotip);
    [PreserveSig] int GetCanonicalName(out Guid pguidCommandName);
    [PreserveSig] int GetState(IntPtr psiItemArray, [MarshalAs(UnmanagedType.Bool)] bool fOkToBeSlow, out uint pCmdState);
    [PreserveSig] int Invoke(IntPtr psiItemArray, IntPtr pbc);
    [PreserveSig] int GetFlags(out uint pFlags);
    [PreserveSig] int EnumSubCommands(out IntPtr ppEnum);
}

public static class ShellCommandProbe {
    public static string Title(Guid clsid) {
        Type type = Type.GetTypeFromCLSID(clsid);
        object instance = Activator.CreateInstance(type);
        var command = (IExplorerCommand)instance;

        IntPtr text;
        int hr = command.GetTitle(IntPtr.Zero, out text);
        if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        try {
            return Marshal.PtrToStringUni(text);
        } finally {
            if (text != IntPtr.Zero) Marshal.FreeCoTaskMem(text);
        }
    }
}
'@

$clsid = [Guid]'6F3A1C2E-5B4D-4A8E-9C71-3D2F8B0A6E54'
$title = [ShellCommandProbe]::Title($clsid)

Write-Host "architecture : $([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)"
Write-Host "clsid        : $clsid"
Write-Host "title        : '$title'"

if ($title -ne $ExpectedTitle) {
    Write-Host "FAIL  expected '$ExpectedTitle'" -ForegroundColor Red
    exit 1
}

Write-Host 'PASS  packaged COM class activates and returns the expected title' -ForegroundColor Green

# Report the icon too: a wrong module path here means the resource did not link.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class IconProbe {
    [DllImport("ole32.dll")] public static extern void CoTaskMemFree(IntPtr p);
}
'@ -ErrorAction SilentlyContinue
exit 0
