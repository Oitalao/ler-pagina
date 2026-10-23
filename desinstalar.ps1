# Remove o ler-pagina: fecha o navegador do agente, apaga os arquivos, a skill e o registro no PATH.
$ErrorActionPreference = 'SilentlyContinue'
$destino = Join-Path $env:LOCALAPPDATA 'Programs\ler-pagina'
$dados   = Join-Path $env:LOCALAPPDATA 'ler-pagina'
$skill   = Join-Path $env:USERPROFILE '.claude\skills\ler-pagina'

# fecha o navegador do agente (so o que usa o perfil do ler-pagina)
Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" |
  Where-Object { $_.CommandLine -match 'ler-pagina\\perfil' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Seconds 1

$p = [Environment]::GetEnvironmentVariable('Path', 'User')
[Environment]::SetEnvironmentVariable('Path', (($p -split ';') | Where-Object { $_ -and $_ -ne $destino }) -join ';', 'User')
Remove-Item $skill, $dados -Recurse -Force
Set-Location $env:TEMP
Remove-Item $destino -Recurse -Force
Write-Host 'ler-pagina removido.'
