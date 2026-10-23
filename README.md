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

Alguns sites pedem captcha para todo mundo (a pesquisa de jurisprudência do TJMG, por exemplo). Nesse caso o ler-pagina **mostra a tela escondida** para você digitar o código e **volta sozinho** para a sua área de trabalho assim que o captcha some. Ninguém resolve captcha por você. Se você não resolver em 3 minutos, a tela volta e o Claude avisa.

## Privacidade

- Nada seu é usado: nem seu Chrome, nem seus cookies, nem suas senhas.
- Os cookies do navegador do agente ficam só na memória e somem quando o computador desliga.
- Depois de cada leitura, ele apaga todo cookie que não seja de site oficial (`.jus.br`, `.gov.br`, `.leg.br`, `.mp.br`, `.def.br`) nem a liberação técnica da Cloudflare. No Jusbrasil, os cookies de rastreamento são apagados.
- O programa não manda nada para servidor nenhum além do próprio site consultado.

## Uso pelo terminal

```
ler-pagina "https://scon.stj.jus.br/SCON/sumstj/doc.jsp?sumula=632"   # texto da página
ler-pagina "<url>" --html                                              # HTML completo
ler-pagina "<url>" --baixar acordao.pdf                                # salva PDF/DOCX
```

## Segunda internet (opcional)

Se um tribunal barrar o IP do seu escritório por excesso de consultas, o ler-pagina pode sair por outra internet (a de casa, por exemplo) através de um túnel SSH até um computador que fique lá. Copie `config.exemplo.json` para `%LOCALAPPDATA%\ler-pagina\config.json` e troque `meu-servidor` pelo nome do host no seu `~/.ssh/config` (a chave SSH precisa entrar sem senha). Se uma saída for barrada num site, ele tenta a outra e lembra por 2 horas.

## Uso responsável

Use para consultas pontuais a páginas públicas, como uma pessoa faria. Não use para raspar tribunal em massa: além de sobrecarregar serviço público, o site vai barrar o seu IP.

## Desinstalar

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\ler-pagina\desinstalar.ps1"
```

## Requisitos

Windows 10 ou 11, Google Chrome ou Microsoft Edge, Node.js 22 ou mais novo (o instalador cuida disso) e o Claude Code.

## Licença

MIT.
