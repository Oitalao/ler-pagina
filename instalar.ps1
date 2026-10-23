# Instalador do ler-pagina (navegador do agente para o Claude Code).
# Uso: abra o PowerShell e cole:
#   irm https://raw.githubusercontent.com/Oitalao/ler-pagina/main/instalar.ps1 | iex
# ou, numa copia baixada do repositorio:  powershell -ExecutionPolicy Bypass -File instalar.ps1

$ErrorActionPreference = 'Stop'
$repo    = 'https://raw.githubusercontent.com/Oitalao/ler-pagina/main'
$destino = Join-Path $env:LOCALAPPDATA 'Programs\ler-pagina'
$skill   = Join-Path $env:USERPROFILE '.claude\skills\ler-pagina'
$arquivos = @('ler-pagina.mjs', 'iniciar-oculto.ps1', 'janela-captcha.ps1', 'ler-pagina.cmd', 'ler-pagina', 'desinstalar.ps1', 'config.exemplo.json')

function Passo($t) { Write-Host "`n> $t" -ForegroundColor Cyan }
function Ok($t)    { Write-Host "  $t" -ForegroundColor Green }

Write-Host 'Instalando o ler-pagina...' -ForegroundColor White

# 1. Node.js 22 ou mais novo
Passo 'Conferindo o Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
$versao = 0
if ($node) { $versao = [int]((& node --version) -replace '^v(\d+).*', '$1') }
if ($versao -lt 22) {
  Write-Host '  O Node.js 22 ou mais novo nao esta instalado. Instalando pelo winget (pode pedir permissao)...'
  winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements | Out-Null
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Nao consegui instalar o Node.js. Instale pelo site https://nodejs.org (versao LTS) e rode este instalador de novo.'
  }
}
Ok "Node.js $(& node --version)"

# 2. Chrome ou Edge
Passo 'Conferindo o navegador'
$nav = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
         "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
         "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $nav) { throw 'Nao achei o Google Chrome nem o Microsoft Edge. Instale o Chrome e rode de novo.' }
Ok "vai usar $nav (com um perfil separado, nunca o seu)"

# 3. Copia os arquivos
Passo "Copiando para $destino"
New-Item -ItemType Directory -Force $destino | Out-Null
$local = if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot 'ler-pagina.mjs'))) { $PSScriptRoot } else { $null }
foreach ($a in $arquivos) {
  if ($local) { Copy-Item (Join-Path $local $a) (Join-Path $destino $a) -Force }
  else { Invoke-WebRequest "$repo/$a" -OutFile (Join-Path $destino $a) -UseBasicParsing }
}
Ok 'arquivos copiados'

# 4. Coloca o comando no PATH do usuario
Passo 'Registrando o comando ler-pagina'
$pathUsuario = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($pathUsuario -split ';') -notcontains $destino) {
  [Environment]::SetEnvironmentVariable('Path', ($pathUsuario.TrimEnd(';') + ';' + $destino), 'User')
}
Ok 'comando registrado (vale para janelas abertas daqui para frente)'

# 5. Skill do Claude Code
Passo 'Instalando a skill no Claude Code'
New-Item -ItemType Directory -Force $skill | Out-Null
if ($local) { Copy-Item (Join-Path $local 'skill\SKILL.md') (Join-Path $skill 'SKILL.md') -Force }
else { Invoke-WebRequest "$repo/skill/SKILL.md" -OutFile (Join-Path $skill 'SKILL.md') -UseBasicParsing }
Ok "skill em $skill"

# 6. Teste
Passo 'Testando (abre o navegador escondido e le uma pagina do Planalto)'
$teste = & node (Join-Path $destino 'ler-pagina.mjs') 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicaocompilado.htm' 2>&1
if ($LASTEXITCODE -eq 0 -and ($teste -join ' ') -match 'Constitui') { Ok 'funcionou' }
else { Write-Host "  O teste nao passou. Mensagem: $($teste | Select-Object -First 3)" -ForegroundColor Yellow }

Write-Host "`nPronto. Feche e abra de novo o Claude Code. Quando ele nao conseguir abrir um site por causa de verificacao anti-robo, vai usar o ler-pagina sozinho." -ForegroundColor White
Write-Host 'Para desinstalar: powershell -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\Programs\ler-pagina\desinstalar.ps1"'
