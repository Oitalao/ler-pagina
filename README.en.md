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

If a site asks for a captcha, a **small window pops up in the corner of your screen** showing the hidden page live; your clicks and keystrokes there are forwarded to it, and the window closes by itself once the site lets you through (or after 3 minutes). Your desktop is never switched. It never solves captchas by itself.

## Privacy

Cookies live in an in-memory browser context and vanish when the computer shuts down. After each read, every cookie that is not from an official Brazilian government domain (`.jus.br`, `.gov.br`, `.leg.br`, `.mp.br`, `.def.br`) or a technical anti-bot clearance cookie (`cf_clearance`, `__cf_bm`, `_cfuvid`) is deleted.

## Usage

```
ler-pagina "<url>"                  # page text
ler-pagina "<url>" --html           # full HTML
ler-pagina "<url>" --baixar file.pdf
```

Optional second exit route through an SSH SOCKS tunnel: see `config.exemplo.json` and the Portuguese README.

## Responsible use

For occasional lookups of public pages, as a person would do. Not for mass scraping.

## License

MIT.
