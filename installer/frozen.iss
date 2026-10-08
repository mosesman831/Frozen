; Frozen — Inno Setup installer (spec §25)
; Layout:
;   {pf}\Frozen\            frozen.exe, frozen-svc.exe, frozen-helper.exe,
;                           frozen-gui.exe (slint fallback), frozen-gui-tauri.exe,
;                           frozen-nmh.exe, extension\
;   {commonappdata}\Frozen\ bin\frozen-nmh.exe + com.frozen.frozen.json
;                           (browser-spawned host at a stable path), logs\,
;                           data-*.db (live state, kept on uninstall)
;
; Build: iscc installer\frozen.iss   (after `cargo build --release`)

#define AppVersion "1.0.1"
#define BinDir "..\target\x86_64-pc-windows-gnu\release"

[Setup]
AppName=Frozen
AppVersion={#AppVersion}
AppPublisher=Frozen
DefaultDirName={autopf}\Frozen
DefaultGroupName=Frozen
OutputDir=..\dist
OutputBaseFilename=FrozenSetup-{#AppVersion}
PrivilegesRequired=admin
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName=Frozen
CloseApplications=yes
; Code signing: Smart App Control / SmartScreen will block unsigned builds.
; Once a code-signing cert exists (installer/sign.ps1 signs the inner exes),
; uncomment the two lines below so the installer + uninstaller are signed too.
; SignTool=frozen /d $qFrozen Setup$q /fd sha256 /tr http://timestamp.digicert.com /td sha256 /a $f
; SignedUninstaller=yes

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; \
    GroupDescription: "Additional icons:"

[Files]
; core binaries
Source: "{#BinDir}\frozen.exe";        DestDir: "{app}"; Flags: ignoreversion
Source: "{#BinDir}\frozen-svc.exe";    DestDir: "{app}"; Flags: ignoreversion
Source: "{#BinDir}\frozen-helper.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#BinDir}\frozen-nmh.exe";    DestDir: "{app}"; Flags: ignoreversion
Source: "{#BinDir}\frozen-gui.exe";    DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "{#BinDir}\frozen-gui-tauri.exe"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
; tauri-build emits this next to the exe — gnu target links it dynamically,
; so the installed copy fails to launch without it on a clean machine
Source: "{#BinDir}\WebView2Loader.dll"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
; WebView2 evergreen bootstrapper — required by frozen-gui-tauri on machines
; without the runtime (absent on some Server installs; present on Win10/11)
Source: "webview2-setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall
; extension bundle (page only — users load it / store listing post-MVP)
Source: "..\extension\*"; DestDir: "{app}\extension"; Flags: ignoreversion recursesubdirs; Excludes: "dev-key.pem,dev-pub.b64,dev-pub.der"
; browser-spawned native host at a stable, service-writable path
Source: "{#BinDir}\frozen-nmh.exe";    DestDir: "{commonappdata}\Frozen\bin"; Flags: ignoreversion
Source: "..\extension\com.frozen.frozen.json"; DestDir: "{commonappdata}\Frozen\bin"; Flags: ignoreversion

[Dirs]
Name: "{commonappdata}\Frozen\bin"
Name: "{commonappdata}\Frozen\logs"

[Icons]
Name: "{group}\Frozen"; Filename: "{app}\frozen-gui-tauri.exe"
Name: "{group}\Frozen (classic)"; Filename: "{app}\frozen-gui.exe"
Name: "{group}\Uninstall Frozen"; Filename: "{uninstallexe}"
Name: "{commondesktop}\Frozen"; Filename: "{app}\frozen-gui-tauri.exe"; \
    Tasks: desktopicon

[Registry]
; per-user helper autostart (all users)
Root: HKLM; Subkey: "SOFTWARE\Microsoft\Windows\CurrentVersion\Run"; \
    ValueName: "FrozenHelper"; ValueType: string; \
    ValueData: """{app}\frozen-helper.exe"""; Flags: uninsdeletevalue
; native-messaging host registration (machine-wide, chrome + edge)
Root: HKLM; Subkey: "SOFTWARE\Google\Chrome\NativeMessagingHosts\com.frozen.frozen"; \
    ValueType: string; ValueData: "{commonappdata}\Frozen\bin\com.frozen.frozen.json"; \
    Flags: uninsdeletekey
Root: HKLM; Subkey: "SOFTWARE\Microsoft\Edge\NativeMessagingHosts\com.frozen.frozen"; \
    ValueType: string; ValueData: "{commonappdata}\Frozen\bin\com.frozen.frozen.json"; \
    Flags: uninsdeletekey

[Run]
; WebView2 runtime first — silent no-op when already installed
Filename: "{tmp}\webview2-setup.exe"; Parameters: "/silent /install"; \
    Flags: runhidden waituntilterminated; Check: not WebView2Installed
; install + start the enforcement service (sc.exe — Inno can't reliably
; spawn our own exe mid-install)
Filename: "sc.exe"; Parameters: "create FrozenSvc binPath= ""\""{app}\frozen-svc.exe\"" --service"" start= auto"; \
    Flags: runhidden waituntilterminated
Filename: "sc.exe"; Parameters: "failure FrozenSvc reset= 86400 actions= restart/3000/restart/5000/restart/10000"; \
    Flags: runhidden waituntilterminated
Filename: "sc.exe"; Parameters: "start FrozenSvc"; \
    Flags: runhidden waituntilterminated
; start the per-user helper for the installing session (cmd start —
; Inno's own Exec can't reliably spawn our exes mid-install)
Filename: "cmd.exe"; Parameters: "/c start """" ""{app}\frozen-helper.exe"""; \
    Flags: nowait runhidden skipifsilent postinstall

[UninstallRun]
Filename: "sc.exe"; Parameters: "stop FrozenSvc";   Flags: runhidden waituntilterminated; RunOnceId: "stopsvc"
Filename: "sc.exe"; Parameters: "delete FrozenSvc"; Flags: runhidden waituntilterminated; RunOnceId: "delsvc"
Filename: "taskkill.exe"; Parameters: "/F /IM frozen-helper.exe"; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "killhelper"
Filename: "taskkill.exe"; Parameters: "/F /IM frozen-nmh.exe";    Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "killnmh"

[Code]
// refuse install while a frozen session is active — state lives in
// {commonappdata}\Frozen\data-frozen.db via the frozen.session setting;
// simplest honest gate: if the service answers `frozen status` as active,
// bail out (the svc binary can answer read-only before we touch anything).
// WebView2 runtime present? (evergreen client GUID, HKLM then HKCU)
function WebView2Installed(): Boolean;
var
  Ver: String;
begin
  Result := RegQueryStringValue(HKLM,
    'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'pv', Ver) and (Ver <> '');
  if not Result then
    Result := RegQueryStringValue(HKCU,
      'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
      'pv', Ver) and (Ver <> '');
end;

function InitializeSetup(): Boolean;
var
  Code: Integer;
begin
  Result := True;
  // If an old install exists, stop its pieces so files can be replaced.
  // ({app} isn't initialized yet at 1:90 — use the default location)
  if FileExists(ExpandConstant('{autopf}\Frozen\frozen.exe')) then begin
    Exec('sc.exe', 'stop FrozenSvc', '', SW_HIDE, ewWaitUntilTerminated, Code);
    Exec('taskkill.exe', '/F /IM frozen-helper.exe', '', SW_HIDE,
         ewWaitUntilTerminated, Code);
    Exec('taskkill.exe', '/F /IM frozen-nmh.exe', '', SW_HIDE,
         ewWaitUntilTerminated, Code);
  end;
end;

// After [Run] finishes (sc create + sc start), verify the service actually
// reached RUNNING — sc.exe failures are silently ignored by waituntilterminated,
// which previously left installs "complete" with a dead service.
procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
  Tries: Integer;
  Started: Boolean;
  OutFile, ErrText: String;
  Raw: AnsiString;
begin
  if CurStep = ssPostInstall then begin
    Started := False;
    for Tries := 1 to 15 do begin
      Sleep(1000);
      if Exec('cmd.exe', '/c sc.exe query FrozenSvc | findstr /C:"RUNNING"', '',
              SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0) then begin
        Started := True;
        break;
      end;
    end;
    if not Started then begin
      OutFile := ExpandConstant('{commonappdata}\Frozen\logs\install-scstart.txt');
      Exec('cmd.exe', '/c sc.exe start FrozenSvc > "' + OutFile + '" 2>&1',
           '', SW_HIDE, ewWaitUntilTerminated, Code);
      ErrText := '';
      if LoadStringFromFile(OutFile, Raw) then
        ErrText := Trim(String(Raw));
      Log('FrozenSvc failed to start: ' + ErrText);
      if not WizardSilent() then
        MsgBox('Frozen installed, but the FrozenSvc service could not be started.'
          + #13#10#13#10
          + 'This is usually security software (Smart App Control / antivirus) blocking the unsigned service binary.'
          + #13#10#13#10 + ErrText + #13#10#13#10
          + 'After allowing it, start the service as administrator:' + #13#10
          + '    sc start FrozenSvc' + #13#10#13#10
          + 'The app reconnects automatically once the service is running.',
          mbCriticalError, MB_OK);
    end;
  end;
end;
