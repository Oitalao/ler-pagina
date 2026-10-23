# Janelinha discreta para o usuario resolver um captcha sem sair da tela dele.
# Mostra a imagem ao vivo da pagina que esta no navegador escondido; cliques e teclas digitadas aqui
# sao repassados para la pelo ler-pagina. Fecha sozinha quando o site libera (arquivo "fim").
# Fechar a janela = desistir.
param([Parameter(Mandatory)][string]$Pasta, [string]$Site = 'o site')

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
# o processo nasce escondido (para nao piscar console) e o Windows aplicaria isso a primeira janela:
# por isso a janela se mostra a forca pelo ShowWindow
Add-Type -Namespace J -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
'@

$png = Join-Path $Pasta 'tela.png'; $dim = Join-Path $Pasta 'tela.txt'
$eventos = Join-Path $Pasta 'eventos.txt'; $fim = Join-Path $Pasta 'fim'

$form = New-Object System.Windows.Forms.Form
$form.Text = "Verificação de $Site"
$form.FormBorderStyle = 'FixedToolWindow'
$form.TopMost = $true
$form.ShowInTaskbar = $true
$form.KeyPreview = $true
$form.ClientSize = New-Object System.Drawing.Size(720, 540)
$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(($area.Right - 740), ($area.Bottom - 590))

$dica = New-Object System.Windows.Forms.Label
$dica.Dock = 'Top'; $dica.Height = 52; $dica.Padding = New-Object System.Windows.Forms.Padding(8, 4, 8, 0)
$dica.Text = "O site pediu uma verificação. Clique no campo da imagem e digite (Enter envia). Esta janela fecha sozinha quando liberar; fechar = desistir."
$form.Controls.Add($dica)

$tela = New-Object System.Windows.Forms.PictureBox
$tela.Dock = 'Fill'; $tela.SizeMode = 'Zoom'; $tela.BackColor = [System.Drawing.Color]::White; $tela.Cursor = 'Hand'
$form.Controls.Add($tela); $tela.BringToFront()

$semBom = New-Object System.Text.UTF8Encoding($false)
function Enviar([string]$linha) { [System.IO.File]::AppendAllText($eventos, $linha + "`n", $semBom) }

# clique: converte da caixa (com zoom e margens) para pixels CSS da pagina
$tela.Add_MouseUp({
  param($s, $e)
  if ($e.Button -ne 'Left' -or -not $tela.Image -or -not (Test-Path $dim)) { return }
  $img = $tela.Image; $cw = $tela.ClientSize.Width; $ch = $tela.ClientSize.Height
  $esc = [Math]::Min($cw / $img.Width, $ch / $img.Height)
  $ox = ($cw - $img.Width * $esc) / 2; $oy = ($ch - $img.Height * $esc) / 2
  $ix = ($e.X - $ox) / $esc; $iy = ($e.Y - $oy) / $esc
  if ($ix -lt 0 -or $iy -lt 0 -or $ix -gt $img.Width -or $iy -gt $img.Height) { return }
  $css = (Get-Content $dim -Raw).Trim() -split ' '
  $x = [Math]::Round($ix * [double]$css[0] / $img.Width); $y = [Math]::Round($iy * [double]$css[1] / $img.Height)
  Enviar "click $x $y"
})
# Enter e Esc sao engolidos pela janela como "botao padrao": por isso viram botoes invisiveis
$ok = New-Object System.Windows.Forms.Button; $ok.Size = New-Object System.Drawing.Size(0, 0); $ok.TabStop = $false
$ok.Add_Click({ Enviar 'key Enter' }); $form.Controls.Add($ok); $form.AcceptButton = $ok
$form.Add_KeyDown({
  param($s, $e)
  if ($e.KeyCode -eq 'Back') { Enviar 'key Backspace'; $e.SuppressKeyPress = $true }
})
$form.Add_KeyPress({
  param($s, $e)
  if (-not [char]::IsControl($e.KeyChar)) { Enviar ("text " + $e.KeyChar) }
})

# atualiza a imagem e fecha quando o ler-pagina mandar
$ultimo = [datetime]::MinValue
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 400
$timer.Add_Tick({
  if ((Test-Path $fim) -or -not (Test-Path $Pasta)) { $timer.Stop(); $form.Close(); return }
  if (-not [J.W]::IsWindowVisible($form.Handle)) { [void][J.W]::ShowWindow($form.Handle, 5); [void][J.W]::SetForegroundWindow($form.Handle) }
  try {
    $t = (Get-Item $png -ErrorAction Stop).LastWriteTimeUtc
    if ($t -ne $script:ultimo) {
      $script:ultimo = $t
      $bytes = [System.IO.File]::ReadAllBytes($png)
      $novo = [System.Drawing.Image]::FromStream((New-Object System.IO.MemoryStream(, $bytes)))
      $velho = $tela.Image; $tela.Image = $novo; if ($velho) { $velho.Dispose() }
    }
  } catch {}
})
$timer.Start()
$form.Add_Shown({ $form.Activate() })
# Show + laco de mensagens (ShowDialog herdaria o "escondido" e o Shown nunca dispararia)
$form.Show()
[void][J.W]::ShowWindow($form.Handle, 5); [void][J.W]::SetForegroundWindow($form.Handle)
[System.Windows.Forms.Application]::Run($form)
