; Inno Setup script for OpenCodeShell.
;
; Build with scripts/build-installer.ps1, which passes:
;   /DAppVersion=<version>   from packaging/identity.json
;   /DPublisherCN=<publisher>
;
; The package itself installs into WindowsApps; this installer only exists to raise the
; privilege needed to trust the signing certificate and to call Add-AppxPackage.

#define AppName "Open in OpenCode"
#define AppPublisher "OpenCodeShell"

#ifndef AppVersion
  #define AppVersion "0.0.0.0"
#endif

#ifndef PublisherCN
  #define PublisherCN "CN=OpenCodeShellDev"
#endif

[Setup]
AppId={{A4C1E7B2-9F3D-4E6A-8B21-5C7D0E9F1A34}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\OpenCodeShell
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\out
OutputBaseFilename=OpenCodeShellSetup-{#AppVersion}
SetupIconFile=..\src\resources\opencode.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#AppName}
UninstallDisplayIcon={sys}\shell32.dll,13
MinVersion=10.0.22000

[Files]
; Staged to {tmp} and removed after the install step.
Source: "..\out\OpenCodeShell.cer"; DestDir: "{tmp}"; Flags: deleteafterinstall
Source: "..\out\OpenCodeShell.msixbundle"; DestDir: "{tmp}"
Source: "install-package.ps1"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  Parameters: String;
  ResultCode: Integer;
begin
  if CurStep <> ssPostInstall then
    Exit;

  Parameters :=
    '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\install-package.ps1') + '"' +
    ' -Certificate "' + ExpandConstant('{tmp}\OpenCodeShell.cer') + '"' +
    ' -Bundle "' + ExpandConstant('{tmp}\OpenCodeShell.msixbundle') + '"' +
    ' -Version "{#AppVersion}"';

  if (not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Parameters, '',
               SW_HIDE, ewWaitUntilTerminated, ResultCode)) or (ResultCode <> 0) then
  begin
    MsgBox('OpenCodeShell could not be installed.' + #13#10 + #13#10 +
           'Run the installer again, or install the bundle manually with Add-AppxPackage.',
           mbError, MB_OK);
  end;
end;

function InitializeUninstall(): Boolean;
var
  Parameters: String;
  ResultCode: Integer;
begin
  Result := True;

  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
       '-NoProfile -ExecutionPolicy Bypass -Command "Get-AppxPackage OpenCodeShell | Remove-AppxPackage"',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Silent uninstall has nobody to ask, and silently dropping machine-wide trust would be
  // surprising, so keep the certificate by default.
  if UninstallSilent then
    Exit;

  if MsgBox('Also remove the OpenCodeShell signing certificate from this computer?' + #13#10 +
            'Choose No to keep it, for example if you plan to reinstall.',
            mbConfirmation, MB_YESNO) = IDYES then
  begin
    Parameters :=
      '-NoProfile -ExecutionPolicy Bypass -Command "' +
      'Get-ChildItem Cert:\LocalMachine\TrustedPeople | ' +
      'Where-Object { $_.Subject -eq ''{#PublisherCN}'' } | Remove-Item"';
    Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Parameters, '',
         SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;
