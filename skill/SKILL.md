---
name: ler-pagina
description: Ler página ou baixar arquivo de site que barra curl/WebFetch com verificação anti-robô (Cloudflare "Verificação automática em andamento", "Just a moment", HTTP 403 com cf-mitigated, "Enable JavaScript and cookies") ou captcha — STF, STJ, tribunais, Planalto, Jusbrasil, diários oficiais. Usar SEMPRE que um curl ou WebFetch voltar 403 ou página de desafio, em vez de procurar fonte secundária ou dizer que não foi possível conferir. Windows.
---

# ler-pagina (navegador do agente)

Neste computador há um navegador **do agente**, com perfil próprio (nunca o do usuário), rodando numa **área de trabalho oculta do Windows**: não aparece na tela, na barra de tarefas nem no Alt+Tab, e para o site é um navegador comum com janela. Por isso passa na verificação JavaScript que barra curl, WebFetch, Playwright e navegador headless.

## Comando

```
ler-pagina "<url>"                     # texto limpo da página na saída
ler-pagina "<url>" --html              # HTML completo
ler-pagina "<url>" --baixar <arquivo>  # PDF, DOCX etc., salvo depois da verificação
ler-pagina "<url>" --espera 40         # espera máxima por rota (padrão 25 s)
ler-pagina "<url>" --rota <nome>       # força uma rota de saída (direta ou uma configurada)
ler-pagina "<url>" --clicar "<seletor CSS>" [--antes <arquivo>]  # depois que a página libera, clica num elemento e devolve a página seguinte
```

- Funciona no Git Bash (`ler-pagina`) e no PowerShell/cmd (`ler-pagina.cmd`).
- Se o endereço for um PDF, ele baixa sozinho e responde `ARQUIVO: <caminho>`; extrair o texto depois (ex.: pymupdf). Apagar o temporário ao terminar.
- Primeira consulta a um site leva ~10-20 s (resolve o desafio); as seguintes ~4 s.
- Sempre pôr a URL entre aspas. Nunca pôr dado pessoal do usuário ou de cliente na URL.

## Captcha

Se o site pedir captcha (ex.: pesquisa de jurisprudência do TJMG, que pede para todo mundo) ou tiver uma verificação embutida "Sou humano"/"Não sou um robô" (hCaptcha, reCAPTCHA, Turnstile, como no comprovante de CNPJ da Receita), abre uma **janelinha no canto da tela do usuário** com a imagem ao vivo da página; ele clica e digita ali, e a janelinha fecha sozinha quando o site libera. A área de trabalho dele não muda. Antes de rodar uma consulta que você sabe que terá captcha, avise o usuário em uma linha. Se ninguém resolver em 3 minutos, a ferramenta sai com `BLOQUEADO` (código 3); não repetir em laço.

Formulário com verificação seguido de botão (ex.: Receita: marcar "Sou humano" e clicar em Consultar): o usuário faz as duas coisas na janelinha. Se depois for preciso clicar em outro botão da página de resultado (ex.: "Consultar QSA"), usar `--clicar 'button[name=qsa]' --antes comprovante.html`: uma só verificação para as duas páginas.

Não usar o Claude in Chrome como atalho para captcha: ele pode estar ligado ao Chrome de **outro computador** com a mesma conta. Se precisar dele, conferir antes (`list_connected_browsers`) e confirmar que é o deste computador.

## Códigos de saída

- `0`: ok.
- `3`: `BLOQUEADO` (desafio que não libera em nenhuma rota, IP recusado ou captcha não resolvido).
- `5`: a página veio vazia ou o download falhou.
- Página com erro do próprio site (ex.: "Request Rejected", "Ocorreu um erro ao buscar o documento") é resposta do site, não defeito da ferramenta. Muitas consultas seguidas ao mesmo tribunal fazem ele barrar o IP por um tempo: espaçar.

## Rotas de saída

Por padrão só existe a rota `direta` (a internet deste computador). Se o arquivo `config.json` tiver rotas por túnel SSH (outra internet, por exemplo a de casa), a ferramenta tenta a próxima quando uma for barrada e lembra por 2 h qual estava barrada naquele site.

## Privacidade

- Cookies ficam num contexto só de memória, que some quando o navegador do agente fecha.
- Depois de cada leitura, a ferramenta apaga todo cookie que não seja de domínio oficial (`.jus.br`, `.gov.br`, `.leg.br`, `.mp.br`, `.def.br`) nem cookie técnico de verificação anti-robô (`cf_clearance`, `__cf_bm`, `_cfuvid`).
- Não usar o navegador pessoal do usuário para isso sem ele pedir.
