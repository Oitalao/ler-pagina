[Português (Brasil)](README.md) · **English**

# ler-pagina

Lets **Claude Code** on Windows open court and government websites (built for Brazilian courts: STF, STJ, state courts, Planalto, Jusbrasil) even when they block bots, **without showing up on your screen** and **without using your own browser**.

## Install

Open PowerShell and paste:

```powershell
irm https://raw.githubusercontent.com/Oitalao/ler-pagina/main/instalar.ps1 | iex
```

Then restart Claude Code. The installer checks Node.js 22+ (installs it with winget if missing), uses Chrome (or Edge), registers the `ler-pagina` command, installs the Claude Code skill and runs a test. No admin rights needed.

## How it works

- It runs a separate, agent-only Chrome profile on a **hidden Windows desktop** (`CreateDesktop`): no window, no taskbar button, nothing in Alt+Tab.
- To the website it is a normal headed browser, so it passes Cloudflare-style JavaScript challenges that block curl, Playwright and headless browsers. Pages are read over the DevTools protocol without `Runtime.enable`.
- First request to a site takes ~10-20 s; later ones ~4 s.

## Captcha

If a site asks for a captcha (including embedded "I am human" checkboxes such as hCaptcha, reCAPTCHA or Turnstile), a **small window pops up in the corner of your screen** showing the hidden page live; your clicks and keystrokes there are forwarded to it, and the window closes by itself once the site lets you through (or after 3 minutes). Your desktop is never switched. It never solves captchas by itself.

## Privacy

Cookies live in an in-memory browser context and vanish when the computer shuts down. After each read, every cookie that is not from an official Brazilian government domain (`.jus.br`, `.gov.br`, `.leg.br`, `.mp.br`, `.def.br`) or a technical anti-bot clearance cookie (`cf_clearance`, `__cf_bm`, `_cfuvid`) is deleted.

## Token-frugal output

Everything the model reads costs tokens, so the output is trimmed at the source:

- **Clean text**, one line per paragraph, without navigation, footers, cookie banners or search forms.
- **No repealed text.** Struck-through provisions (how Planalto marks repealed law) are dropped, keeping only the label: "§ 5º (Revogado pela Lei nº 9.528, de 1997)". Law 8.213/91 shrinks from 323k to 177k characters, and the model stops quoting repealed wording.
- **Just the passage you need.** `--buscar "Art. 1.790"` returns only that whole article (accent- and case-insensitive; "Art. 5" does not match "Art. 50").
- **Big pages go to a file.** Above 15,000 characters it prints the start and saves the full text to a temp file the agent can grep.
- **PDFs come out as text**, with `[pag. N]` page markers.
- **Several URLs in one call.**

## Usage

```
ler-pagina "<url>"                         # clean page text
ler-pagina "<url>" --buscar "Art. 5"       # only the matching passages (repeatable)
ler-pagina "<url1>" "<url2>"               # several pages at once
ler-pagina "<url>" --md                    # Markdown with links
ler-pagina "<url>" --html --saida p.html   # full HTML
ler-pagina "<pdf-url>"                     # PDF text with page markers
ler-pagina "<url>" --baixar file.pdf       # save the file
ler-pagina "<url>" --com-revogados         # keep struck-through text
ler-pagina "<url>" --clicar "button[name=qsa]" --antes before.html   # click an element once the page is through
ler-pagina --testar                        # self-test
ler-pagina --ajuda                         # all options
```

PDF text uses `pdftotext`, bundled with Git for Windows (which Claude Code on Windows already requires), or PyMuPDF.

To update, run the install line again; your `config.json` is kept.

Optional second exit route through an SSH SOCKS tunnel: see `config.exemplo.json` and the Portuguese README.

## Responsible use

For occasional lookups of public pages, as a person would do. Not for mass scraping.

## License

MIT.
