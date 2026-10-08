# sign.ps1 — code-sign every Frozen binary with an installed cert, then
# rebuild the installer. Smart App Control only trusts properly signed
# binaries: there is no manifest/registry workaround for unsigned exes.
#
# Usage (from an elevated prompt, after installing your cert to the machine):
#   powershell -File installer\sign.ps1 -Thumbprint A1B2C3...
# or with a PFX:
#   powershell -File installer\sign.ps1 -Pfx C:\certs\frozen.pfx -Password secret
param(
  [string]$Thumbprint = '',
  [string]$Pfx = '',
  [string]$Password = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$bin  = Join-Path $root 'target\x86_64-pc-windows-gnu\release'
$ts   = 'http://timestamp.digicert.com'

$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" |
  Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $signtool) { throw 'signtool.exe not found — install the Windows 10/11 SDK signing tools.' }

$args = @('sign', '/fd', 'sha256', '/td', 'sha256', '/tr', $ts)
if ($Thumbprint) { $args += @('/sha1', $Thumbprint) }
elseif ($Pfx)    { $args += @('/f', $Pfx, '/p', $Password) }
else             { throw 'Pass -Thumbprint (installed cert) or -Pfx/-Password.' }

foreach ($exe in 'frozen.exe','frozen-svc.exe','frozen-helper.exe','frozen-nmh.exe','frozen-gui.exe','frozen-gui-tauri.exe') {
  $p = Join-Path $bin $exe
  if (Test-Path $p) { & $signtool @args $p; if ($LASTEXITCODE) { throw "sign failed: $exe" } }
}

Write-Host "Binaries signed. Now uncomment SignTool/SignedUninstaller in installer\frozen.iss and rerun ISCC."
