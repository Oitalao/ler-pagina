**Português (Brasil)** · [English](README.en.md)

# ler-pagina

Deixa o **Claude Code** abrir STF, STJ, tribunais estaduais, Planalto e Jusbrasil no Windows, mesmo quando o site barra robôs, **sem aparecer na sua tela** e **sem usar o seu navegador**.

Feito por um advogado para conferir súmula, lei e acórdão na fonte oficial. O STJ, por exemplo, responde ao Claude com uma tela de "Verificação automática em andamento" e ele acaba citando de memória ou de site secundário. Com o ler-pagina, ele abre a página de verdade.

## Instalar

1. Abra o **PowerShell** (tecla Windows, digite `powershell`, Enter).
2. Cole a linha abaixo e aperte Enter:

```powershell
irm https://raw.githubusercontent.com/Oitalao/ler-pagina/main/instalar.ps1 | iex
```

3. Feche e abra de novo o Claude Code.

O instalador confere o Node.js (instala pelo winget se faltar), usa o Chrome ou, se não houver, o Edge, registra o comando `ler-pagina`, instala a skill no Claude Code e faz um teste no site do Planalto. Não precisa de administrador.

Pronto: quando o Claude não conseguir abrir um site por causa de verificação anti-robô, ele usa o ler-pagina sozinho. Você também pode pedir: "abre a Súmula 632 do STJ no site do STJ".

## Como funciona

- O ler-pagina abre um Chrome **só do agente** (perfil separado, sem conta nem login seu) numa **área de trabalho oculta do Windows**. Ele não aparece na tela, na barra de tarefas nem no Alt+Tab.
- Para o site, é um navegador comum, com janela de verdade. Por isso passa na verificação da Cloudflare que barra curl, Playwright e navegador "headless".
- A primeira consulta a um site leva uns 10 a 20 segundos (o tempo da verificação). As seguintes, uns 4 segundos.

Testado em outubro de 2026: STF (portal e pesquisa de jurisprudência), STJ (súmulas e consulta processual), Planalto, TJSP, TJPR, TJPA, TJMG, Jusbrasil e PDFs de tribunais.

## Captcha

Alguns sites pedem captcha para todo mundo (a pesquisa de jurisprudência do TJMG, por exemplo). O mesmo vale para as verificações embutidas do tipo "Sou humano" ou "Não sou um robô" (hCaptcha, reCAPTCHA, Turnstile), como a do comprovante de CNPJ da Receita, onde você marca o quadrado e clica em Consultar. Nesse caso aparece uma **janelinha no canto da tela** com a imagem da página escondida: você clica no campo, digita o código e aperta Enter. A janelinha fecha sozinha quando o site libera, e o Claude continua. Sua área de trabalho não muda. Ninguém resolve captcha por você; se você fechar a janelinha ou não responder em 3 minutos, o Claude avisa.

## Privacidade

- Nada seu é usado: nem seu Chrome, nem seus cookies, nem suas senhas.
- Os cookies do navegador do agente ficam só na memória e somem quando o computador desliga.
- O texto é lido num "mundo isolado" da página, invisível aos scripts do site.
- Os arquivos temporários (textos grandes e PDFs) são apagados sozinhos depois de um dia.
- Depois de cada leitura, ele apaga todo cookie que não seja de site oficial (`.jus.br`, `.gov.br`, `.leg.br`, `.mp.br`, `.def.br`) nem a liberação técnica da Cloudflare. No Jusbrasil, os cookies de rastreamento são apagados.
- O programa não manda nada para servidor nenhum além do próprio site consultado.

## Gasta poucos tokens

Cada palavra que o Claude lê custa. Por isso o ler-pagina entrega o mínimo necessário:

- **Texto limpo**, uma linha por parágrafo, sem menu, rodapé, banner de cookies nem formulário de busca.
- **Sem texto revogado.** O que o Planalto risca sai, e fica só o rótulo: "§ 5º (Revogado pela Lei nº 9.528, de 1997)". A Lei 8.213/91, por exemplo, cai de 323 mil para 177 mil caracteres, e o Claude não cita redação revogada por engano.
- **Só o trecho pedido.** Com `--buscar "Art. 1.790"`, vem só o artigo inteiro (caput, incisos e parágrafos), não o Código Civil todo.
- **Página grande vai para arquivo.** Acima de 15 mil caracteres, ele mostra o começo e grava o texto completo num arquivo, onde o Claude procura sem reler tudo.
- **PDF já sai em texto**, com a marca `[pag. N]` para citar a folha.
- **Vários endereços numa chamada só.**

## Uso pelo terminal

```
ler-pagina "https://scon.stj.jus.br/SCON/sumstj/doc.jsp?sumula=632"   # texto da página
ler-pagina "<url>" --buscar "Art. 5"                                   # só os trechos com o termo
ler-pagina "<url1>" "<url2>"                                           # vários endereços de uma vez
ler-pagina "<url>" --md                                                # Markdown, com links
ler-pagina "<url>" --html --saida pagina.html                          # HTML completo
ler-pagina "<url-do-pdf>"                                              # texto do PDF, com [pag. N]
ler-pagina "<url>" --baixar acordao.pdf                                # salva PDF/DOCX
ler-pagina "<url>" --com-revogados                                     # mantém o texto riscado
ler-pagina "<url>" --clicar "button[name=qsa]" --antes antes.html     # clica num botão depois que a página libera
ler-pagina --testar                                                    # confere se está funcionando
ler-pagina --ajuda                                                     # todas as opções
```

O texto de PDF usa o `pdftotext`, que já vem com o Git for Windows (o Claude Code no Windows usa o Git). Se não houver, ele tenta o PyMuPDF e, sem os dois, só salva o arquivo.

## Segunda internet (opcional)

Se um tribunal barrar o IP do seu escritório por excesso de consultas, o ler-pagina pode sair por outra internet (a de casa, por exemplo) através de um túnel SSH até um computador que fique lá. Copie `config.exemplo.json` para `%LOCALAPPDATA%\ler-pagina\config.json` e troque `meu-servidor` pelo nome do host no seu `~/.ssh/config` (a chave SSH precisa entrar sem senha). Se uma saída for barrada num site, ele tenta a outra e lembra por 2 horas.

## Uso responsável

Use para consultas pontuais a páginas públicas, como uma pessoa faria. Não use para raspar tribunal em massa: além de sobrecarregar serviço público, o site vai barrar o seu IP.

## Atualizar

Rode de novo a mesma linha da instalação. Ela troca os arquivos do programa e mantém a sua configuração (`config.json`).

## Desinstalar

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\ler-pagina\desinstalar.ps1"
```

## Requisitos

Windows 10 ou 11, Google Chrome ou Microsoft Edge, Node.js 22 ou mais novo (o instalador cuida disso) e o Claude Code.

## Licença

MIT.
