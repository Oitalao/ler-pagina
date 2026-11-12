---
name: ler-pagina
description: Ler página, lei, súmula, acórdão ou PDF de STF, STJ, tribunais (*.jus.br), Planalto, Jusbrasil, Receita e diários oficiais, ou de qualquer site que barre curl/WebFetch com verificação anti-robô (Cloudflare "Just a moment", "Verificação automática em andamento", HTTP 403) ou captcha. Usar em vez de procurar fonte secundária ou dizer que não foi possível conferir. Windows.
---

# ler-pagina (navegador do agente)

Chrome **do agente** (perfil próprio, nunca o do usuário) numa área de trabalho oculta do Windows: para o site é um navegador comum, por isso passa na verificação que barra curl, WebFetch e headless.

**Ir direto ao ler-pagina** (sem tentar WebFetch antes, que falha e gasta uma rodada) em: `*.jus.br`, `planalto.gov.br`, `jusbrasil.com.br`, `receita.fazenda.gov.br`. Nos demais sites, usar quando o WebFetch voltar 403 ou página de desafio.

## Gastar poucos tokens

A saída padrão já vem limpa: uma linha por parágrafo, sem menu, rodapé, banner de cookies nem texto riscado (revogado, no Planalto: fica só "§ 5º (Revogado pela Lei ...)"). Acima de 15 mil caracteres mostra o começo e grava o texto inteiro num arquivo (`[CORTADO: ... Texto completo: <arquivo>]`): procure nele com Grep em vez de pedir de novo.

- Quer um dispositivo, súmula ou trecho? **Use `--buscar`**: devolve só os parágrafos com o termo (ignora acento e caixa; "Art. 5" não pega "Art. 50"; num artigo de lei traz o artigo inteiro, até o próximo "Art."). Em PDF, cada trecho vem com `[pag. N]`.
- Vários endereços numa chamada só: `ler-pagina "<url1>" "<url2>"` (saídas separadas por `===== <url>`).

## Comando

```
ler-pagina "<url>"                           # texto limpo
ler-pagina "<url>" --buscar "Art. 1.790"     # só os trechos (repetível; --contexto N parágrafos depois, padrão 2)
ler-pagina "<url>" --md                      # Markdown com links (para seguir resultados de busca)
ler-pagina "<url>" --html --saida pag.html   # HTML completo (nunca cortado: sempre com --saida)
ler-pagina "<url.pdf>"                       # PDF: sai o texto, com [pag. N]
ler-pagina "<url>" --baixar a.pdf [--texto]  # salva o arquivo (e mostra o texto)
ler-pagina "<url>" --com-revogados           # mantém o texto riscado
ler-pagina "<url>" --max 0                   # sem corte (evitar)
ler-pagina "<url>" --clicar "<seletor CSS>" [--antes arquivo]   # clica depois que a página libera
ler-pagina --testar                          # confere se está funcionando
```

Opções menos usadas: `--espera <s>` (padrão 25 por rota), `--rota <nome>`, `--saida <arquivo>`, `--ajuda`. Funciona no Git Bash (`ler-pagina`) e no PowerShell/cmd (`ler-pagina.cmd`). Sempre pôr a URL entre aspas e nunca pôr dado pessoal do usuário ou de cliente na URL. Primeira consulta a um site leva 10 a 20 s; as seguintes, uns 4 s.

## Códigos de saída

`0` ok · `2` uso errado · `3` BLOQUEADO (desafio que não libera, IP recusado ou captcha não resolvido; não repetir em laço) · `4` `--buscar` não achou (o texto inteiro fica no arquivo indicado) · `5` página vazia, elemento de `--clicar` ausente ou download falhou.

Página curta com erro do próprio site ("Request Rejected", "Ocorreu um erro ao buscar o documento") é resposta do site. Muitas consultas seguidas ao mesmo tribunal fazem ele barrar o IP por um tempo: espaçar e juntar endereços numa chamada.

## Captcha

Se o site pedir captcha (ex.: jurisprudência do TJMG) ou tiver "Sou humano"/"Não sou um robô" (hCaptcha, reCAPTCHA, Turnstile, como no comprovante de CNPJ da Receita), abre uma **janelinha no canto da tela do usuário** com a imagem ao vivo da página; ele clica e digita ali e ela fecha sozinha quando o site libera (máx. 3 min). Avisar o usuário em uma linha antes de rodar consulta que terá captcha. Receita: o usuário marca a verificação e clica em Consultar na janelinha; para a página seguinte, `--clicar 'button[name=qsa]' --antes comprovante.html`.

Não usar o Claude in Chrome como atalho para captcha: ele pode estar ligado ao Chrome de outro computador com a mesma conta.

## Rotas e privacidade

- Rota `direta` (a internet deste computador) e, se o `config.json` tiver, rotas por túnel SSH: barrou numa, tenta a próxima e lembra por 2 h.
- Cookies só na memória; depois de cada leitura, apaga todo cookie que não seja de domínio oficial (`.jus.br`, `.gov.br`, `.leg.br`, `.mp.br`, `.def.br`) nem técnico de verificação (`cf_clearance`, `__cf_bm`, `_cfuvid`).
- Os arquivos temporários (`texto-*`, `arquivo-*`) somem sozinhos depois de um dia.
