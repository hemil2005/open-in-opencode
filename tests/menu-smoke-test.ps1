#Requires -Version 5.1
<#
.SYNOPSIS
    Smoke test: opens a folder, right-clicks its background, and checks that the
    "Open in OpenCode" entry is present in the resulting Windows 11 context menu.

.DESCRIPTION
    Requires an interactive desktop session (it drives the real shell). It never invokes the
    entry, so no opencode process is started.

    The test works around two platform quirks:
      * a background process cannot call SetForegroundWindow, so it attaches to the current
        foreground thread first;
      * this process must be DPI-aware, otherwise coordinates are virtualised and the
        right-click lands in the wrong place.
#>
[CmdletBinding()]
param(
    [string]$MenuEntry = 'Open in OpenCode'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-AppxPackage OpenCodeShell -ErrorAction SilentlyContinue)) {
    throw 'OpenCodeShell is not registered. Run .\scripts\install.ps1 first.'
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type @'
using System;
using System.Text;
using System.Collections;
using System.Runtime.InteropServices;
public struct RECT { public int Left, Top, Right, Bottom; }
public class Shell {
  public delegate bool CB(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(CB cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool on);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool alt);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint f, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[Shell]::SetProcessDPIAware() | Out-Null

function Get-CabinetWindows {
    $list = New-Object System.Collections.ArrayList
    $callback = [Shell+CB] {
        param($hwnd, $unused)
        if ([Shell]::IsWindowVisible($hwnd)) {
            $class = New-Object System.Text.StringBuilder 256
            [Shell]::GetClassNameW($hwnd, $class, 256) | Out-Null
            if ($class.ToString() -eq 'CabinetWClass') { [void]$script:list.Add($hwnd) }
        }
        return $true
    }
    $script:list = $list
    [Shell]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
    return $script:list
}

function Focus-Window([IntPtr]$hwnd) {
    $foreground = [Shell]::GetForegroundWindow()
    $pid_ = 0
    $foregroundThread = [Shell]::GetWindowThreadProcessId($foreground, [ref]$pid_)
    $thisThread = [Shell]::GetCurrentThreadId()
    [Shell]::AttachThreadInput($thisThread, $foregroundThread, $true) | Out-Null
    [Shell]::ShowWindow($hwnd, 9) | Out-Null
    [Shell]::SetForegroundWindow($hwnd) | Out-Null
    [Shell]::SwitchToThisWindow($hwnd, $true)
    [Shell]::AttachThreadInput($thisThread, $foregroundThread, $false) | Out-Null
    Start-Sleep -Milliseconds 700
}

$folder = Join-Path $env:TEMP 'opencode-shell-smoke'
New-Item -ItemType Directory -Force -Path $folder | Out-Null

$before = @(Get-CabinetWindows)
Start-Process explorer.exe $folder

$hwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 24 -and $hwnd -eq [IntPtr]::Zero; $i++) {
    Start-Sleep -Milliseconds 500
    $new = @(Get-CabinetWindows | Where-Object { $before -notcontains $_ })
    if ($new.Count -gt 0) { $hwnd = $new[0] }
}
if ($hwnd -eq [IntPtr]::Zero) { throw 'could not open a File Explorer window' }

try {
    Focus-Window $hwnd

    $rect = New-Object RECT
    [Shell]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
    $x = [int](($rect.Left + $rect.Right) / 2)
    $y = [int]($rect.Top + ($rect.Bottom - $rect.Top) * 0.62)

    [Shell]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 250
    [Shell]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)  # right button down
    [Shell]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)  # right button up
    Start-Sleep -Milliseconds 1500

    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, $MenuEntry)
    $entry = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)

    if ($entry) {
        Write-Host "PASS  '$MenuEntry' is present in the context menu" -ForegroundColor Green
        exit 0
    }
    Write-Host "FAIL  '$MenuEntry' not found in the context menu" -ForegroundColor Red
    Write-Host '      Check %LOCALAPPDATA%\OpenCodeShell\shell.log and re-run install.ps1.'
    exit 1
} finally {
    [Shell]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero)
    [Shell]::keybd_event(0x1B, 0, 2, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 300
    try { Stop-Process -Id (Get-Process explorer | Where-Object { $_.MainWindowHandle -eq $hwnd }).Id -Force -ErrorAction SilentlyContinue } catch {}
    Remove-Item $folder -Recurse -Force -ErrorAction SilentlyContinue
}
