; Inno Setup script for Open in OpenCode.
;
; Build with scripts/build-installer.ps1, which passes:
;   /DAppVersion=<version>   from packaging/identity.json
;   /DPublisherCN=<publisher>
;
; Two installation paths:
;   Windows 11 (build 22000+): trust the signing certificate, install the MSIX bundle.
;   Windows 10:                install ocshell.exe and register classic context-menu verbs.
;
; The package itself lives in WindowsApps; this installer only exists to raise the privilege
; needed for certificate trust and package installation.

#define AppName "Open in OpenCode"
#define AppPublisher "Open in OpenCode"

#ifndef AppVersion
  #define AppVersion "0.0.0.0"
#endif

#ifndef PublisherCN
  #define PublisherCN "CN=OpenInOpenCodeDev"
#endif

[Setup]
AppId={{A4C1E7B2-9F3D-4E6A-8B21-5C7D0E9F1A34}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\OpenInOpenCode
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\out
OutputBaseFilename=OpenInOpenCodeSetup-{#AppVersion}
SetupIconFile=..\src\resources\opencode.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#AppName}
UninstallDisplayIcon={sys}\shell32.dll,13
MinVersion=10.0.17763

[Files]
; Windows 11: staged to {tmp} and removed after the install step.
Source: "..\out\OpenInOpenCode.cer"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: IsWindows11
Source: "..\out\OpenInOpenCode.msixbundle"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: IsWindows11
Source: "..\out\OpenInOpenCode.appinstaller"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: IsWindows11
Source: "install-package.ps1"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: IsWindows11

; Windows 10: the CLI is the product, and it writes the registry verbs itself.
Source: "..\out\ocshell.exe"; DestDir: "{app}"; Flags: ignoreversion; Check: IsWindows10

[Code]
function IsWindows11: Boolean;
var
  Version: TWindowsVersion;
begin
  GetWindowsVersionEx(Version);
  Result := Version.Build >= 22000;
end;

function IsWindows10: Boolean;
begin
  Result := not IsWindows11;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Parameters: String;
  ResultCode: Integer;
  Succeeded: Boolean;
begin
  if CurStep <> ssPostInstall then
    Exit;

  if IsWindows11 then
  begin
    Parameters :=
      '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\install-package.ps1') + '"' +
      ' -Certificate "' + ExpandConstant('{tmp}\OpenInOpenCode.cer') + '"' +
      ' -AppInstaller "' + ExpandConstant('{tmp}\OpenInOpenCode.appinstaller') + '"' +
      ' -Bundle "' + ExpandConstant('{tmp}\OpenInOpenCode.msixbundle') + '"' +
      ' -Version "{#AppVersion}"';
    Succeeded := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Parameters, '',
                      SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
  end
  else
  begin
    Succeeded := Exec(ExpandConstant('{app}\ocshell.exe'), 'registry install', '', SW_HIDE,
                      ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
  end;

  if not Succeeded then
    MsgBox('Open in OpenCode could not be installed.' + #13#10 + #13#10 +
           'Run the installer again, or see the README for a manual installation.',
           mbError, MB_OK);
end;

function InitializeUninstall(): Boolean;
var
  Parameters: String;
  ResultCode: Integer;
begin
  Result := True;

  // Windows 10: remove the classic verbs before the executable is deleted.
  if FileExists(ExpandConstant('{app}\ocshell.exe')) then
    Exec(ExpandConstant('{app}\ocshell.exe'), 'registry uninstall', '', SW_HIDE,
         ewWaitUntilTerminated, ResultCode);

  // Windows 11: remove the package (a no-op when it was never installed).
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
       '-NoProfile -ExecutionPolicy Bypass -Command "Get-AppxPackage OpenInOpenCode | Remove-AppxPackage; Get-AppxPackage OpenCodeShell | Remove-AppxPackage"',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Silent uninstall keeps the certificate: nobody to ask, and dropping machine-wide trust
  // without consent would be surprising.
  if UninstallSilent then
    Exit;

  if MsgBox('Also remove the Open in OpenCode signing certificate from this computer?' + #13#10 +
            'Choose No to keep it, for example if you plan to reinstall.',
            mbConfirmation, MB_YESNO) = IDYES then
  begin
    Parameters :=
      '-NoProfile -ExecutionPolicy Bypass -Command "' +
      'Get-ChildItem Cert:\LocalMachine\TrustedPeople | ' +
      'Where-Object { $_.Subject -eq ''{#PublisherCN}'' -or $_.Subject -eq ''CN=OpenCodeShellDev'' } | Remove-Item"';
    Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Parameters, '',
         SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;
