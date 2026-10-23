# ler-pagina: navegador do agente.
# Abre o Chrome (ou o Edge) com perfil proprio numa area de trabalho oculta do Windows.
# Nao aparece na tela, na barra de tarefas nem no Alt+Tab. Para o site, e um navegador comum, com janela.
#
# Uso: iniciar-oculto.ps1 -Perfil <pasta> [-Porta 9340]                -> abre o navegador se ainda nao estiver aberto
#      iniciar-oculto.ps1 -Mostrar [-Segundos 180] [-Sinal <arquivo>]  -> mostra a area oculta (captcha) e volta
#                                                                         quando o arquivo -Sinal aparecer ou o tempo acabar
param(
  [string]$Perfil = "$env:LOCALAPPDATA\ler-pagina\perfil",
  [int]$Porta = 9340,
  [switch]$Mostrar,
  [int]$Segundos = 180,
  [string]$Sinal = ''
)

$ErrorActionPreference = 'Stop'
$mesa = 'AgenteNavegador'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MesaOculta {
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr CreateDesktop(string n, IntPtr d, IntPtr m, int f, uint a, IntPtr s);
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr OpenDesktop(string n, int f, bool i, uint a);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SwitchDesktop(IntPtr h);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct SI { public int cb; public string r; public string desk; public string t; public int x, y, w, h, cx, cy, fa, fl; public short sw, cb2; public IntPtr r2, i, o, e; }
  [StructLayout(LayoutKind.Sequential)] public struct PI { public IntPtr hp, ht; public int pid, tid; }
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CreateProcess(string a, string c, IntPtr pa, IntPtr ta, bool inh, uint f, IntPtr env, string dir, ref SI si, out PI pi);
  public static IntPtr Mesa(string n) {
    IntPtr h = OpenDesktop(n, 0, false, 0x10000000);
    if (h == IntPtr.Zero) h = CreateDesktop(n, IntPtr.Zero, IntPtr.Zero, 0, 0x10000000, IntPtr.Zero);
    if (h == IntPtr.Zero) throw new Exception("nao consegui criar a area oculta: " + Marshal.GetLastWin32Error());
    return h;
  }
  public static int Lancar(string n, string app, string cmd) {
    Mesa(n);
    var si = new SI(); si.cb = Marshal.SizeOf(si); si.desk = n;
    PI pi;
    if (!CreateProcess(app, cmd, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, null, ref si, out pi))
      throw new Exception("nao consegui abrir o navegador: " + Marshal.GetLastWin32Error());
    return pi.pid;
  }
}
'@

function Vivo {
  # HttpWebRequest puro: Invoke-RestMethod do PowerShell 5 pode depender do motor do Internet Explorer e travar
  try {
    $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$Porta/json/version")
    $req.Timeout = 2000; $req.ReadWriteTimeout = 2000; $req.Proxy = $null
    $resp = $req.GetResponse()
    $txt = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd(); $resp.Close()
    return ($txt -match '"Browser":\s*"(Chrome|Edg|HeadlessChrome)')
  } catch { return $false }
}

function AcharNavegador {
  $candidatos = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($c in $candidatos) { if ($c -and (Test-Path $c)) { return $c } }
  throw 'nao achei o Google Chrome nem o Microsoft Edge'
}

if ($Mostrar) {
  if (-not (Vivo)) { exit 0 }   # nada a mostrar
  $normal = [MesaOculta]::OpenDesktop('Default', 0, $false, 0x10000000)
  if ($normal -eq [IntPtr]::Zero) { Write-Error 'nao achei a area de trabalho normal; nao vou trocar'; exit 1 }
  $oculta = [MesaOculta]::Mesa($mesa)
  try {
    if (-not [MesaOculta]::SwitchDesktop($oculta)) { Write-Error 'nao consegui mostrar a area oculta'; exit 1 }
    $fim = (Get-Date).AddSeconds($Segundos)
    while ((Get-Date) -lt $fim) {
      if ($Sinal -and (Test-Path $Sinal)) { break }
      Start-Sleep -Milliseconds 300
    }
  } finally {
    # volta sempre, mesmo com erro ou interrupcao; tenta algumas vezes
    for ($i = 0; $i -lt 5; $i++) { if ([MesaOculta]::SwitchDesktop($normal)) { break }; Start-Sleep -Milliseconds 300 }
    if ($Sinal) { Remove-Item $Sinal -ErrorAction SilentlyContinue }
  }
  exit 0
}

if (Vivo) { exit 0 }
$navegador = AcharNavegador
New-Item -ItemType Directory -Force $Perfil | Out-Null
$args_ = @(
  "--user-data-dir=`"$Perfil`"", "--remote-debugging-port=$Porta", '--remote-debugging-address=127.0.0.1',
  '--no-first-run', '--no-default-browser-check', '--disable-sync', '--start-maximized', 'about:blank'
) -join ' '
[MesaOculta]::Lancar($mesa, $navegador, "`"$navegador`" $args_") | Out-Null
for ($i = 0; $i -lt 60; $i++) { if (Vivo) { exit 0 }; Start-Sleep -Milliseconds 250 }
Write-Error 'o navegador do agente nao respondeu'
exit 1
