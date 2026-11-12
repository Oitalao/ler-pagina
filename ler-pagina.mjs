// ler-pagina: abre enderecos no navegador oculto do agente e devolve o texto limpo (ou Markdown, HTML ou o arquivo).
// Passa pela verificacao anti-robo de JavaScript (Cloudflare etc.) porque e um Chrome comum, com janela,
// so que numa area de trabalho do Windows que o usuario nao ve. Nao usa o perfil nem os cookies do usuario.
//
// Economia de tokens: o texto sai sem menu, rodape, banner de cookies nem texto riscado (revogado, no Planalto),
// com uma linha por paragrafo; --buscar devolve so os trechos com o termo; saida grande vai para arquivo.
//
// Rotas de saida: "direta" (a internet do computador) e, se configuradas, rotas por tunel SSH (outra internet).
// Se uma rota for barrada num site, tenta a proxima e lembra por 2 h.
// Captcha (inclusive "Sou humano" de hCaptcha/reCAPTCHA/Turnstile): abre uma janelinha com a pagina oculta para o
// usuario resolver e enviar o formulario; volta quando a pagina muda e a verificacao some.
//
// Privacidade: cada rota usa um contexto so de memoria, que some quando o navegador do agente fecha.
// Depois de cada leitura, apaga todo cookie que nao seja de dominio oficial (.jus.br, .gov.br, .leg.br, .mp.br,
// .def.br) nem cookie tecnico de verificacao anti-robo (cf_clearance, __cf_bm, _cfuvid).
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmdirSync, statSync, existsSync, rmSync, renameSync, readdirSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const VERSAO = '2.0.0';
const AQUI = dirname(fileURLToPath(import.meta.url));
const LOCAL = join(process.env.LOCALAPPDATA || tmpdir(), 'ler-pagina');
// config.json ao lado do programa (instalacao pessoal) ou em %LOCALAPPDATA%\ler-pagina
const CFG = (() => {
  for (const f of [join(AQUI, 'config.json'), join(LOCAL, 'config.json')]) {
    try { return JSON.parse(readFileSync(f, 'utf8')); } catch {}
  }
  return {};
})();
const BASE = CFG.dados || LOCAL;
const PERFIL = CFG.perfil || join(BASE, 'perfil');
const TEMP = CFG.temporarios || join(tmpdir(), 'ler-pagina');
const PORTA = CFG.porta || 9340;
const ROTAS_TUNEL = (CFG.rotas || []).filter(r => r && r.nome && r.ssh);
const ESTADO = join(BASE, 'estado.json'), TRAVA = join(BASE, 'trava'), TRAVA_TELA = join(BASE, 'trava-tela');
const OFICIAIS = ['.jus.br', '.gov.br', '.leg.br', '.mp.br', '.def.br'];
const TECNICOS = new Set(['cf_clearance', '__cf_bm', '_cfuvid']);
const DESAFIO = /Verifica..o autom.tica em andamento|Just a moment|Um momento…|Checking your browser|Enable JavaScript and cookies to continue|Verify you are human|Confirme que voc. . humano/i;
const RECUSA = /Request Rejected|Sorry, you have been blocked|Attention Required|Access Denied|Acesso negado|Too Many Requests|Error 1020|Error 1015/i;
const CAPTCHA = /Informe o c.digo|Digite o c.digo|Digite os n.meros|captcha|n.o sou um rob|I'm not a robot|Selecione todas as imagens/i;
// verificacao embutida em iframe (hCaptcha "Sou humano", reCAPTCHA, Turnstile): o texto dela nao aparece no HTML da
// pagina, so o iframe ou a div do widget. Ex.: comprovante de CNPJ da Receita (hCaptcha + botao Consultar).
const WIDGET = /<iframe[^>]+src="[^"]*(hcaptcha\.com|google\.com\/recaptcha|recaptcha\.net|challenges\.cloudflare\.com\/cdn-cgi\/challenge-platform\/[^"]*turnstile)|class="[^"]*(h-captcha|g-recaptcha|cf-turnstile)/i;
const pedeVerificacao = r => (r.texto.length < 3000 && CAPTCHA.test(r.texto)) || (r.texto.length < 4000 && !DESAFIO.test(r.texto) && WIDGET.test(r.html));
const BLOQUEIO_HORAS = 2;

// ---------- argumentos ----------
const AJUDA = `ler-pagina ${VERSAO}: le paginas protegidas por verificacao anti-robo no navegador oculto do agente.

uso: ler-pagina <url> [<url> ...] [opcoes]

saida (padrao: texto limpo, uma linha por paragrafo, sem menu/rodape/texto riscado)
  --md                  Markdown (titulos, listas, tabelas e links)
  --html                HTML completo (nunca cortado; use com --saida)
  --buscar <termo>      so os trechos com o termo (repetivel; ignora acento e caixa; "Art. 5" traz o artigo inteiro)
  --contexto <n>        paragrafos depois de cada ocorrencia em --buscar (padrao 2)
  --com-revogados       mantem o texto riscado (revogado)
  --max <caracteres>    acima disso, mostra o comeco e grava o resto em arquivo (padrao ${CFG.maxCaracteres || 15000}; 0 = sem limite)
  --saida <arquivo>     grava a saida inteira no arquivo e so informa o caminho

arquivos
  --baixar <arquivo>    salva o arquivo (PDF, DOCX...) depois da verificacao
  --texto               com --baixar: tambem extrai e mostra o texto do PDF
                        (PDF sem --baixar: o texto sai direto, com marcas [pag. N])

navegacao
  --clicar <seletor>    depois que a pagina libera, clica no elemento (CSS) e devolve a pagina seguinte
  --antes <arquivo>     com --clicar: grava a pagina de antes do clique
  --espera <segundos>   espera maxima por rota (padrao 25)
  --rota <nome>         forca uma rota de saida (direta ou uma do config.json)

outros
  --testar              confere se esta funcionando (Planalto e STJ)
  --versao, --ajuda

codigos de saida: 0 ok; 2 uso errado; 3 bloqueado (desafio, IP recusado ou captcha nao resolvido);
4 --buscar nao achou o termo; 5 pagina vazia, elemento de --clicar ausente ou download falhou`;

const COM_VALOR = new Set(['--baixar', '--espera', '--rota', '--clicar', '--antes', '--buscar', '--contexto', '--max', '--saida']);
const SEM_VALOR = new Set(['--html', '--md', '--texto', '--com-revogados', '--testar', '--versao', '--ajuda', '-h', '--help']);
const urls = [], valores = {}, flags = new Set();
{
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (COM_VALOR.has(a[i])) {
      if (i + 1 >= a.length) { console.error(`${a[i]} precisa de um valor\n\n${AJUDA}`); process.exit(2); }
      (valores[a[i]] ||= []).push(a[++i]);
    } else if (SEM_VALOR.has(a[i])) flags.add(a[i]);
    else if (/^https?:\/\//i.test(a[i])) urls.push(a[i]);
    else { console.error(`argumento desconhecido: ${a[i]}\n\n${AJUDA}`); process.exit(2); }
  }
}
const opc = n => valores[n] ? valores[n][valores[n].length - 1] : null;
const tem = n => flags.has(n);
if (tem('--versao')) { console.log(VERSAO); process.exit(0); }
if (tem('--ajuda') || tem('-h') || tem('--help')) { console.log(AJUDA); process.exit(0); }

const TESTES = [
  { nome: 'Planalto (Constituicao)', url: 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicaocompilado.htm', espera: /Art\. 5/ },
  { nome: 'STJ (Sumula 632)', url: 'https://scon.stj.jus.br/SCON/sumstj/doc.jsp?sumula=632', espera: /632/ },
];
if (tem('--testar')) urls.splice(0, urls.length, ...TESTES.map(t => t.url));
if (!urls.length) { console.error(AJUDA); process.exit(2); }
if (urls.length > 1 && (opc('--baixar') || opc('--clicar') || opc('--antes') || opc('--saida'))) {
  console.error('--baixar, --clicar, --antes e --saida valem para um endereco so'); process.exit(2);
}
for (const n of ['--espera', '--contexto', '--max']) if (opc(n) !== null && !(Number(opc(n)) >= 0)) { console.error(`${n} precisa de um numero`); process.exit(2); }

const modo = tem('--html') ? 'html' : tem('--md') ? 'md' : 'texto';
// espera por rota: desafio automatico da Cloudflare libera em < 15 s; passou disso, e desafio de clicar ou IP marcado
const esperaMax = Number(opc('--espera')) || 25;
const termos = (valores['--buscar'] || []).filter(Boolean);
const contexto = opc('--contexto') !== null ? Number(opc('--contexto')) : 2;
const maxChars = opc('--max') !== null ? Number(opc('--max')) : (CFG.maxCaracteres ?? 15000);
const dormir = ms => new Promise(ok => setTimeout(ok, ms));
mkdirSync(BASE, { recursive: true });

// temporarios desta ferramenta com mais de 1 dia somem sozinhos
try {
  for (const f of readdirSync(TEMP)) {
    if (!/^(arquivo|texto)-/.test(f)) continue;
    const p = join(TEMP, f);
    if (Date.now() - statSync(p).mtimeMs > 86400e3) rmSync(p, { force: true });
  }
} catch {}

// ---------- travas (mkdir e atomico) ----------
async function comTrava(fn, pasta = TRAVA, validade = 60000) {
  for (let i = 0; ; i++) {
    try { mkdirSync(pasta); break; } catch {
      try { if (Date.now() - statSync(pasta).mtimeMs > validade) { rmdirSync(pasta); continue; } } catch {}
      if (i > (validade / 250) * 2) throw new Error('trava ocupada por tempo demais');
      await dormir(250);
    }
  }
  try { return await fn(); } finally { try { rmdirSync(pasta); } catch {} }
}
const lerEstado = () => { try { return JSON.parse(readFileSync(ESTADO, 'utf8')); } catch { return { contextos: {}, bloqueios: {} }; } };
const gravarEstado = e => writeFileSync(ESTADO, JSON.stringify(e, null, 1));
const ps1 = (...extra) => ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(AQUI, 'iniciar-oculto.ps1'), ...extra];

// ---------- navegador oculto e tuneis ----------
async function versao() {
  const v = await (await fetch(`http://127.0.0.1:${PORTA}/json/version`, { signal: AbortSignal.timeout(3000) })).json();
  if (!/Chrome|Edg/.test(v.Browser || '')) throw new Error(`a porta ${PORTA} nao e o navegador do agente`);
  return v;
}
function portaAberta(p) {
  return new Promise(ok => { const c = connect(p, '127.0.0.1'); c.once('connect', () => { c.destroy(); ok(true); }); c.once('error', () => ok(false)); });
}
async function garantirTunel(r) {
  const porta = r.portaSocks || 1081;
  if (await portaAberta(porta)) return porta;
  const ssh = existsSync('C:/Windows/System32/OpenSSH/ssh.exe') ? 'C:/Windows/System32/OpenSSH/ssh.exe' : 'ssh';
  spawn(ssh, ['-N', '-D', `127.0.0.1:${porta}`, '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30', '-o', 'ConnectTimeout=10', r.ssh], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 60; i++) { if (await portaAberta(porta)) return porta; await dormir(250); }
  throw new Error(`nao consegui abrir o tunel SSH "${r.ssh}"`);
}

let info;
await comTrava(async () => {
  try { info = await versao(); } catch {
    execFileSync('powershell.exe', ps1('-Perfil', PERFIL, '-Porta', String(PORTA)), { stdio: 'ignore' });
    info = await versao();
  }
});

const ws = new WebSocket(info.webSocketDebuggerUrl);
await new Promise((ok, erro) => { ws.onopen = ok; ws.onerror = () => erro(new Error('o navegador recusou a conexao')); });
let seq = 0; const pend = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const { ok, erro } = pend.get(m.id); pend.delete(m.id); m.error ? erro(new Error(m.error.message)) : ok(m.result); }
};
// todo pedido ao navegador tem prazo: com a tela apagada/bloqueada o Chrome para de desenhar e,
// por exemplo, a captura de tela ficaria esperando para sempre
const cdp = (method, params = {}, sessionId, limite = 30000) => new Promise((ok, erro) => {
  const id = ++seq;
  const t = setTimeout(() => { pend.delete(id); erro(new Error(`${method}: sem resposta em ${limite / 1000}s`)); }, limite);
  pend.set(id, { ok: v => { clearTimeout(t); ok(v); }, erro: e => { clearTimeout(t); erro(e); } });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

async function contextoDaRota(nome) {
  return comTrava(async () => {
    const est = lerEstado();
    const { browserContextIds = [] } = await cdp('Target.getBrowserContexts');
    const tunel = ROTAS_TUNEL.find(r => r.nome === nome);
    let ctx = est.contextos[nome];
    if (!ctx || !browserContextIds.includes(ctx)) {
      const p = { disposeOnDetach: false };
      if (tunel) p.proxyServer = `socks5://127.0.0.1:${await garantirTunel(tunel)}`;
      ctx = (await cdp('Target.createBrowserContext', p)).browserContextId;
      est.contextos[nome] = ctx; gravarEstado(est);
    } else if (tunel) await garantirTunel(tunel);
    return ctx;
  });
}

// captcha: abre uma janelinha no canto da tela do usuario com a imagem ao vivo da pagina escondida;
// cliques e teclas dela sao repassados para a pagina. Fecha sozinha quando o site libera (ou em 3 min).
async function resolverCaptcha(host, ler, s) {
  return comTrava(async () => {
    const pasta = join(BASE, 'captcha');
    rmSync(pasta, { recursive: true, force: true }); mkdirSync(pasta, { recursive: true });
    const png = join(pasta, 'tela.png'), dim = join(pasta, 'tela.txt'), eventos = join(pasta, 'eventos.txt');
    writeFileSync(eventos, '');
    // so conta como resolvido depois que o usuario enviar: a pagina tem de navegar e o captcha sumir
    const navAtual = async () => { try { const h = await s('Page.getNavigationHistory'); return `${h.entries.length}|${h.entries[h.currentIndex]?.url}`; } catch { return ''; } };
    const nav0 = await navAtual();
    const foto = async () => {
      try {
        const m = await s('Page.getLayoutMetrics', {}, 4000);
        const v = m.cssVisualViewport || m.layoutViewport;
        const { data } = await s('Page.captureScreenshot', { format: 'png' }, 4000);
        // tamanho e imagem gravados juntos, da mesma captura, para o clique cair no lugar certo
        writeFileSync(dim, `${Math.round(v.clientWidth)} ${Math.round(v.clientHeight)}`);
        writeFileSync(png + '.tmp', Buffer.from(data, 'base64')); renameSync(png + '.tmp', png);
      } catch {}
    };
    await foto();
    const janela = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File',
      join(AQUI, 'janela-captcha.ps1'), '-Pasta', pasta, '-Site', host], { stdio: 'ignore', windowsHide: true });
    let fechada = false; janela.once('exit', () => { fechada = true; });
    let lidos = 0, resolvido = false, seguidas = 0;
    const t0 = Date.now();
    while (!fechada && Date.now() - t0 < 180000) {
      await dormir(500);
      // repassa o que o usuario fez na janelinha
      const linhas = readFileSync(eventos, 'utf8').replace(/^﻿/, '').split('\n').map(l => l.replace(/\r$/, '')).filter(Boolean);
      for (const l of linhas.slice(lidos)) {
        const [tipo, ...resto] = l.split(' ');
        if (tipo === 'click') {
          const [x, y] = resto.map(Number);
          for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
            await s('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }).catch(() => {});
        } else if (tipo === 'text') {
          await s('Input.insertText', { text: resto.join(' ') || ' ' }).catch(() => {});
        } else if (tipo === 'key') {
          const k = { Enter: [13, '\r'], Backspace: [8, ''], Tab: [9, ''] }[resto[0]];
          if (k) {
            await s('Input.dispatchKeyEvent', { type: 'keyDown', key: resto[0], code: resto[0], windowsVirtualKeyCode: k[0], ...(k[1] ? { text: k[1] } : {}) }).catch(() => {});
            await s('Input.dispatchKeyEvent', { type: 'keyUp', key: resto[0], code: resto[0], windowsVirtualKeyCode: k[0] }).catch(() => {});
          }
        }
      }
      lidos = linhas.length;
      await foto();
      let r; try { r = await ler(); } catch { seguidas = 0; continue; }
      const navegou = (await navAtual()) !== nav0;
      seguidas = (navegou && r.texto.length > 0 && !pedeVerificacao(r)) ? seguidas + 1 : 0;
      if (seguidas >= 2) { resolvido = true; break; }   // duas leituras seguidas sem captcha, ja em outra pagina
    }
    writeFileSync(join(pasta, 'fim'), '1');   // fecha a janelinha
    if (!fechada) { await Promise.race([new Promise(ok => janela.once('exit', ok)), dormir(3000)]); if (!fechada) try { janela.kill(); } catch {} }
    rmSync(pasta, { recursive: true, force: true });
    return resolvido;
  }, TRAVA_TELA, 200000);
}

// ---------- extracao do texto (roda na pagina, num mundo isolado: os scripts do site nao veem) ----------
// Percorre o DOM como o innerText (respeita display:none e blocos), mas sem menu, rodape, banners de cookies,
// formularios e, por padrao, sem texto riscado. Entra em iframes/frames do mesmo site. Nao altera a pagina.
const EXTRATOR = String.raw`(function (md, revogados) {
  const PULA = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','SVG','CANVAS','OBJECT','EMBED','BUTTON','SELECT','OPTION','INPUT','TEXTAREA','HEAD','IMG','PICTURE','VIDEO','AUDIO','MAP','DIALOG']);
  const LIXO = 'nav,aside,[role=navigation],[role=banner],[role=contentinfo],[role=search],[role=dialog],[role=alertdialog],[aria-hidden=true],[hidden]';
  const COOKIE = /(^|[\s_-])(cookies?|lgpd|consent|gdpr|onetrust)([\s_-]|$)/i;
  const RISCO = new Set(['S','STRIKE','DEL']);
  const ROTULO = /^(Art\.? ?\d[\d.]*(º|°|o)?(-[A-Z])?\.?|§ ?\d+(º|°|o)?(-[A-Z])?\.?|Parágrafo único\.?|[IVXLC]+ ?[-–]|[a-z]\))/;
  const out = [], comSeparador = new WeakSet(), cacheTab = new WeakMap();
  const simples = t => {
    if (!cacheTab.has(t)) cacheTab.set(t, !t.querySelector('table,img,form,ul,ol,h1,h2,h3,h4,h5,h6,blockquote,pre') && t.rows.length > 0 && t.rows[0].cells.length > 1
      && [...t.querySelectorAll('td,th')].every(c => c.querySelectorAll('p,div').length <= 2));
    return cacheTab.get(t);
  };
  let riscados = 0;
  const quebra = () => out.push(md ? '\n\n' : '\n');
  function anda(no, pre, cel) {
    if (no.nodeType === 3) {
      // pre de verdade (<pre>) mantem tudo; white-space:pre-* em texto comum (STJ quebra a linha no meio da frase)
      // so mantem a linha em branco, que separa paragrafos
      const d = no.data;
      out.push(pre === 'pre' ? d : pre ? d.replace(/\n[ \t]*\n\s*/g, '\u0001').replace(/[\s\u00a0]+/g, ' ').replace(/\u0001/g, '\n') : d.replace(/[\s\u00a0]+/g, ' '));
      return;
    }
    if (no.nodeType !== 1 && no.nodeType !== 11) return;
    if (no.nodeType === 11) { for (const f of no.childNodes) anda(f, pre, cel); return; }
    const el = no, tag = el.tagName;
    if (PULA.has(tag)) return;
    // formulario curto (busca, login) e lixo; o longo fica: em ASP.NET a pagina inteira esta dentro de um <form>
    if (tag === 'FORM' && (el.textContent || '').replace(/\s+/g, ' ').length < 1500) return;
    if (el.matches(LIXO)) return;
    if (tag === 'IFRAME' || tag === 'FRAME') {
      if ((el.ownerDocument.defaultView || window).getComputedStyle(el).display === 'none') return;
      try { const d = el.contentDocument; if (d && (d.body || d.documentElement)) { quebra(); anda(d.body || d.documentElement, pre, cel); quebra(); } } catch {}
      return;
    }
    if (tag === 'SLOT') { for (const f of el.assignedNodes({ flatten: true })) anda(f, pre, cel); return; }
    if ((tag === 'HEADER' || tag === 'FOOTER') && !el.parentElement?.closest('main,article,[role=main]')) return;
    const cls = typeof el.className === 'string' ? el.className : '';
    if (COOKIE.test(el.id || '') || COOKIE.test(cls) || /(^|\s)(noprint|no-print|d-print-none|sr-only|visually-hidden)(\s|$)/i.test(cls)) return;
    if (!revogados && (RISCO.has(tag) || /line-through/i.test(el.getAttribute('style') || ''))) {
      // texto riscado sai, mas o rotulo do dispositivo fica: "§ 5º (Revogado pela Lei ...)" continua dizendo qual foi
      const m = (el.textContent || '').replace(/[\s ]+/g, ' ').trim().match(ROTULO);
      if (m) out.push(m[0] + '\u0002 ');   // \u0002 marca rotulo vindo de texto riscado
      riscados++; return;
    }
    const cs = (el.ownerDocument.defaultView || window).getComputedStyle(el);
    if (cs.display === 'none') return;
    if (tag === 'BR') { out.push('\n'); return; }
    if (tag === 'HR') { quebra(); if (md) out.push('---'); quebra(); return; }
    const d = cs.display;
    // tabela de dados (celulas so com texto) vira "a | b"; tabela de layout (Planalto) tem celula como bloco
    const tab = /^table-(cell|row)$/.test(d) ? el.closest('table') : null;
    const dados = tab ? simples(tab) : false;
    let bloco = /^(block|flex|grid|list-item|table|flow-root|table-row|table-caption|table-header-group|table-row-group|table-footer-group)( |$)/.test(d) || tag === 'FRAMESET' || (d === 'table-cell' && !dados);
    // dentro de celula de tabela de dados, paragrafo vira espaco: a linha da tabela fica inteira
    const cel2 = cel || (d === 'table-cell' && dados);
    if (cel && bloco) { bloco = false; out.push(' '); }
    // <pre> so fica literal no Markdown (bloco de codigo); no texto e prosa quebrada a cada ~70 colunas (ementas do STJ)
    const pre2 = pre === 'pre' || (md && tag === 'PRE') ? 'pre' : (pre || tag === 'PRE' || /^pre/.test(cs.whiteSpace) ? 'quebra' : false);
    let ini = '', fim = '';
    if (d === 'table-cell' && dados && el.previousElementSibling) out.push(' | ');
    const emLinha = /^inline-/.test(d);   // inline-block etc.: o navegador separa visualmente; aqui, um espaco
    if (emLinha) out.push(' ');
    if (md) {
      if (/^H[1-6]$/.test(tag)) ini = '#'.repeat(+tag[1]) + ' ';
      else if (tag === 'LI') ini = el.parentElement && el.parentElement.tagName === 'OL' ? ([...el.parentElement.children].indexOf(el) + 1) + '. ' : '- ';
      else if (tag === 'PRE') { ini = '\u0060\u0060\u0060\n'; fim = '\n\u0060\u0060\u0060'; }
      else if (tag === 'TR' && dados) { ini = '| '; fim = ' |'; }
      else if (tag === 'A') {
        const h = el.href || '';
        if (/^https?:/i.test(h) && !/^#/.test(el.getAttribute('href') || '')) { ini = '['; fim = '](' + h + ')'; }
      }
    }
    const linhaMd = md && tag === 'TR' && dados;   // linhas de tabela Markdown sem linha em branco entre elas
    if (bloco) linhaMd ? out.push('\n') : quebra();
    out.push(ini);
    for (const f of (el.shadowRoot ? el.shadowRoot.childNodes : el.childNodes)) anda(f, pre2, cel2);
    out.push(fim);
    if (md && tag === 'TR' && dados) {
      if (!comSeparador.has(tab)) { comSeparador.add(tab); out.push('\n|' + ' --- |'.repeat(Math.max(1, el.children.length))); }
    }
    if (bloco && !linhaMd) quebra();
    if (emLinha) out.push(' ');
  }
  const doc = document;
  let raiz = doc.body || doc.documentElement;
  const m = doc.querySelector('main,[role=main]');
  if (m && doc.body) { const tm = (m.innerText || '').length, tb = (doc.body.innerText || '').length; if (tm > 500 && tm > tb * 0.3) raiz = m; }
  anda(raiz, false);
  // \ue000-\uf8ff: glifos de fonte de icones (Font Awesome etc.), que nao sao texto
  let t = out.join('').replace(/[\u00a0\u2000-\u200b\u3000]/g, ' ').replace(/[\ue000-\uf8ff\u200c-\u200f\ufeff]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/[ \t]{2,}/g, ' ');
  // fora: linhas so de separador ("|", "\u2022"), linhas que ficaram so com o rotulo de um texto riscado
  // (a redacao antiga, seguida da nova) e, se houve riscado, algarismo romano solto que sobrou dele
  t = t.split('\n').filter(l => {
    const s = l.trim();
    if (/^[|\u2022\u00b7\-\u2013\u2014_]+$/.test(s)) return false;
    if (/^[^\u0002]*\u0002$/.test(s)) return false;
    if (riscados && /^[IVXLC]+$/.test(s)) return false;
    return true;
  }).join('\n').replace(/\u0002/g, '');
  if (md) t = t.replace(/\[\s*\]\([^)]*\)/g, '').replace(/^#+ *$/gm, '').replace(/\n{3,}/g, '\n\n');
  else t = t.replace(/\n{2,}/g, '\n');
  const titulo = (doc.title || '').trim();
  let status = 0; try { status = performance.getEntriesByType('navigation')[0].responseStatus || 0; } catch {}
  return JSON.stringify({ titulo, texto: t.trim(), status });
})`;

// ---------- busca de trechos ----------
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[º°]/g, 'o').replace(/ª/g, 'a').toLowerCase().replace(/\s+/g, ' ');
const ehArtigo = s => /^\s*art\.?\s*\d/.test(s);
function buscar(texto, lista) {
  const linhas = texto.split('\n'), N = linhas.map(norm);
  const res = lista.map(t => {
    const n = norm(t).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp((/^\d/.test(n) ? '(?<!\\d)' : '') + n + (/\d$/.test(n) ? '(?![\\d])' : ''));
  });
  const marca = new Uint8Array(linhas.length);
  let achou = 0;
  // termo partido entre duas linhas (PDF quebra a linha no meio da frase, as vezes com hifen)
  const junta = i => i + 1 < N.length ? (/[a-z]-$/.test(N[i]) ? N[i].slice(0, -1) + N[i + 1] : N[i] + ' ' + N[i + 1]) : '';
  for (let i = 0; i < linhas.length; i++) {
    let par = false;
    if (!res.some(r => r.test(N[i]))) {
      if (!res.some(r => r.test(junta(i)) && !r.test(N[i + 1]))) continue;
      par = true;
    }
    achou++;
    let ini = Math.max(0, i - 1), fim = Math.min(linhas.length - 1, i + contexto + (par ? 1 : 0));
    if (ehArtigo(N[i])) {   // dispositivo de lei: o artigo inteiro, ate o proximo "Art."
      ini = i;
      let j = i + 1; while (j < linhas.length && j - i < 150 && !ehArtigo(N[j])) j++;
      fim = Math.max(fim, j - 1);
    }
    for (let k = ini; k <= fim; k++) marca[k] = 1;
  }
  // em PDF, cada trecho leva a marca da pagina onde comeca (para citar a folha)
  const PAG = /^\[pag\. \d+\]$/;
  const partes = []; let ant = -2, pag = null, pagMostrada = null;
  for (let i = 0; i < linhas.length; i++) {
    if (PAG.test(linhas[i])) pag = linhas[i];
    if (!marca[i]) continue;
    if (i !== ant + 1) partes.push(partes.length ? '[...]' : null);
    if (pag && pag !== pagMostrada && !PAG.test(linhas[i])) partes.push(pag);
    if (PAG.test(linhas[i])) pagMostrada = linhas[i]; else if (pag) pagMostrada = pag;
    partes.push(linhas[i]); ant = i;
  }
  return { achou, texto: partes.filter(p => p !== null).join('\n') };
}

// ---------- texto de PDF (pdftotext do Poppler/Git for Windows ou PyMuPDF) ----------
function textoPdf(arq) {
  const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], join(process.env.LOCALAPPDATA || '', 'Programs')].filter(Boolean);
  const cands = ['pdftotext', ...pf.map(p => join(p, 'Git', 'mingw64', 'bin', 'pdftotext.exe'))];
  let bruto = null;
  for (const c of cands) {
    const r = spawnSync(c, ['-enc', 'UTF-8', arq, '-'], { encoding: 'utf8', maxBuffer: 512 * 2 ** 20, windowsHide: true });
    if (r.status === 0 && r.stdout) { bruto = r.stdout; break; }
  }
  if (bruto === null) {
    const py = 'import sys\ntry:\n import pymupdf\nexcept ImportError:\n import fitz as pymupdf\nsys.stdout.reconfigure(encoding="utf-8")\nd=pymupdf.open(sys.argv[1])\nsys.stdout.write("\\f".join(p.get_text() for p in d))';
    for (const p of ['python', 'py', 'python3']) {
      // -P: nao poe a pasta atual no sys.path (sem -I, para achar o pymupdf instalado com pip --user)
      const r = spawnSync(p, ['-P', '-E', '-c', py, arq], { encoding: 'utf8', maxBuffer: 512 * 2 ** 20, windowsHide: true });
      if (r.status === 0 && r.stdout) { bruto = r.stdout; break; }
    }
  }
  if (bruto === null) return { erro: 'nao achei extrator de PDF (instale o Git for Windows, que traz o pdftotext, ou: pip install pymupdf)' };
  bruto = bruto.replace(/\r\n?/g, '\n');
  const pags = bruto.split('\f'); if (pags.length > 1 && !pags[pags.length - 1].trim()) pags.pop();
  const util = pags.join('').replace(/\s/g, '').length;
  if (util < 30 * pags.length) return { erro: `PDF sem texto (${pags.length} pag., provavelmente escaneado): precisa de OCR` };
  const texto = pags.map((p, i) => `[pag. ${i + 1}]\n` + p.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim()).join('\n');
  return { texto, paginas: pags.length };
}

// ---------- uma tentativa numa rota ----------
async function tentar(url, rota) {
  const host = new URL(url).hostname;
  const ctx = await contextoDaRota(rota);
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId: ctx, background: true });
  try {
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p, lim) => cdp(m, p, sessionId, lim);
    const nav = await s('Page.navigate', { url });
    // ERR_ABORTED e o Chrome entregando o endereco como download (PDF com "attachment"): segue e baixa abaixo
    if (nav.errorText && nav.errorText !== 'net::ERR_ABORTED') throw new Error(`o navegador nao abriu o endereco (${nav.errorText})`);
    const ler = async () => {
      const doc = await s('DOM.getDocument', { depth: 0 });
      const html = (await s('DOM.getOuterHTML', { nodeId: doc.root.nodeId })).outerHTML;
      const texto = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
      let mime = '';
      try { mime = (await s('Page.getResourceTree')).frameTree.frame.mimeType || ''; } catch {}
      return { html, texto, arquivo: mime !== '' && !/html|xml|text\/|json/i.test(mime) };
    };
    // texto final (ou Markdown), extraido num mundo isolado; se falhar, cai no texto bruto
    const extrair = async (r, md) => {
      try {
        const { frameTree } = await s('Page.getFrameTree');
        const { executionContextId } = await s('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'ler-pagina' });
        const v = await s('Runtime.evaluate', { expression: `${EXTRATOR}(${!!md}, ${tem('--com-revogados')})`, contextId: executionContextId, returnByValue: true }, 60000);
        const o = JSON.parse(v.result.value);
        if (o.texto.length >= 100 || r.texto.length < 300) {
          const t = o.titulo && !o.texto.startsWith(o.titulo) ? (md ? `# ${o.titulo}\n\n` : `${o.titulo}\n`) + o.texto : o.texto;
          return (o.status >= 400 ? `[HTTP ${o.status}: o site respondeu com erro]\n` : '') + t;
        }
      } catch {}
      return r.texto;
    };
    const conteudo = r => modo === 'html' ? r.html : extrair(r, modo === 'md');

    let r = { html: '', texto: '', arquivo: false }, estado = 'desafio', captchaVisto = false, desafioVisto = false;
    let t0 = Date.now();
    await dormir(2000);
    while ((Date.now() - t0) / 1000 < esperaMax) {
      try { r = await ler(); } catch { r = { html: '', texto: '', arquivo: false }; }
      const curta = r.texto.length < 3000;   // tela de desafio/recusa/captcha e sempre curta
      if (curta && RECUSA.test(r.texto)) { estado = 'recusado'; break; }
      // a tela de desafio da Cloudflare as vezes nao tem texto nenhum, so o script dela
      if ((curta && DESAFIO.test(r.texto)) || /challenge-platform|_cf_chl_opt|cf-chl-/.test(r.html)) desafioVisto = true;
      if (pedeVerificacao(r)) {
        if (captchaVisto || process.env.LER_PAGINA_SEM_TELA) { estado = 'captcha'; break; }
        captchaVisto = true;
        console.error('captcha: abri uma janelinha no canto da tela para o usuario resolver...');
        if (!(await resolverCaptcha(host, ler, s))) { estado = 'captcha'; break; }
        t0 = Date.now();   // resolveu: espera a pagina de resultado
        continue;
      }
      if (!(curta && DESAFIO.test(r.texto)) && (r.texto.length > 200 || r.arquivo || (r.texto.length > 0 && Date.now() - t0 > 8000))) { estado = 'ok'; break; }
      await dormir(1500);
    }
    // nada apareceu e nunca houve tela de verificacao: nao e bloqueio. Pode ser arquivo entregue como download
    // (o Chrome nao exibe): tenta baixar; se vier HTML, a pagina so continuou vazia
    let vazia = false;
    if (estado === 'desafio' && !desafioVisto && !r.texto) { vazia = true; estado = 'ok'; r.arquivo = true; }
    if (estado === 'ok' && !r.arquivo) { await dormir(1500); try { r = await ler(); } catch {} }
    // --clicar <seletor CSS>: depois que a pagina liberou, clica num elemento (ex.: botao "QSA" do comprovante de CNPJ,
    // que so existe depois do captcha) e devolve a pagina resultante; --antes <arquivo> guarda a pagina de antes do clique.
    const sel = opc('--clicar'); let erro = null;
    if (estado === 'ok' && !r.arquivo && sel) {
      const antes = opc('--antes');
      if (antes) try { writeFileSync(antes, await conteudo(r)); } catch (e) { estado = 'falhou'; erro = `--antes: nao consegui gravar ${antes} (${e.code || e.message})`; }
      if (estado === 'ok') {
        const clicou = await s('Runtime.evaluate', { expression: `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.scrollIntoView();e.click();return true})()`, returnByValue: true }).catch(() => null);
        if (!clicou || !clicou.result || clicou.result.value !== true) { estado = 'falhou'; erro = `--clicar: elemento nao encontrado: ${sel}`; }
        else { await dormir(4000); try { r = await ler(); } catch {} }
      }
    }

    let saida = erro, pdf = false;
    if (estado === 'ok' && (opc('--baixar') || r.arquivo)) {
      let resp;
      if (rota !== 'direta') {
        // por tunel, o download tambem sai por la: baixa dentro do proprio navegador
        const b64 = await s('Runtime.evaluate', { expression: `fetch(${JSON.stringify(url)}).then(r=>r.arrayBuffer()).then(b=>{let s='';const u=new Uint8Array(b);for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode(...u.subarray(i,i+32768));return btoa(s)})`, awaitPromise: true, returnByValue: true }, 180000);
        resp = { ok: true, status: 200, tipo: '', buf: Buffer.from(b64.result.value || '', 'base64') };
      } else {
        // so os cookies que o proprio navegador mandaria a este endereco
        const { cookies } = await s('Network.getCookies', { urls: [url] });
        const cab = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        const rr = await fetch(url, { headers: { 'User-Agent': info['User-Agent'], ...(cab ? { Cookie: cab } : {}) }, signal: AbortSignal.timeout(180000) });
        resp = { ok: rr.ok, status: rr.status, tipo: rr.headers.get('content-type') || '', buf: Buffer.from(await rr.arrayBuffer()) };
      }
      const ehHtml = /text\/html/i.test(resp.tipo) || /^\s*</.test(resp.buf.subarray(0, 64).toString('latin1'));
      if (vazia && [403, 429, 503].includes(resp.status)) {
        estado = 'desafio';   // vazia porque o site barrou: conta como bloqueio e tenta a proxima rota
      } else if (vazia && (!resp.ok || ehHtml) && !opc('--baixar')) {
        estado = 'falhou'; saida = `a pagina continuou vazia por ${esperaMax} s (HTTP ${resp.status}; tente --espera 60)`;
      } else if (!resp.ok || resp.buf.length === 0 || (/text\/html/i.test(resp.tipo) && !opc('--baixar'))) {
        estado = 'falhou'; saida = `download falhou (HTTP ${resp.status}, ${resp.buf.length} bytes, ${resp.tipo})`;
      } else {
        pdf = resp.buf.subarray(0, 5).toString('latin1') === '%PDF-';
        let destino = opc('--baixar'), temporario = false;
        if (!destino) {
          mkdirSync(TEMP, { recursive: true }); temporario = true;
          const ext = pdf ? 'pdf' : (new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1] || (resp.buf.subarray(0, 2).toString('latin1') === 'PK' ? 'zip' : 'bin'));
          destino = join(TEMP, `arquivo-${Date.now()}.${ext.toLowerCase()}`);
        }
        const linha = `ARQUIVO: ${destino} (${resp.buf.length} bytes, HTTP ${resp.status}${resp.tipo ? ', ' + resp.tipo : ''}, rota ${rota})`;
        try { writeFileSync(destino, resp.buf); } catch (e) { estado = 'falhou'; saida = `--baixar: nao consegui gravar ${destino} (${e.code || e.message})`; }
        if (estado !== 'ok') {}
        else if (pdf && (temporario || tem('--texto'))) {
          const x = textoPdf(destino);
          if (x.texto) { saida = temporario ? x.texto : `${linha}\n${x.texto}`; if (temporario) rmSync(destino, { force: true }); }
          else { estado = 'falhou'; saida = `${linha}; ${x.erro}`; }
        } else saida = linha;
      }
    } else if (estado === 'ok') {
      saida = await conteudo(r);
      if (!saida) { estado = 'falhou'; saida = 'pagina sem texto'; }
    }

    // limpeza de cookies pela propria aba (mesmo contexto), sem apagar os oficiais nem os tecnicos
    try {
      const { cookies } = await s('Network.getAllCookies');
      for (const c of cookies) {
        const oficial = OFICIAIS.some(d => ('.' + c.domain.replace(/^\./, '')).endsWith(d));
        if (!oficial && !TECNICOS.has(c.name)) await s('Network.deleteCookies', { name: c.name, domain: c.domain, path: c.path });
      }
    } catch (e) { console.error('aviso: limpeza de cookies falhou:', e.message); }
    return { estado, saida, texto: r.texto, pdf };
  } finally {
    await cdp('Target.closeTarget', { targetId }).catch(() => {});
  }
}

// ---------- um endereco, tentando as rotas em ordem ----------
async function processar(url) {
  const host = new URL(url).hostname;
  const todas = ['direta', ...ROTAS_TUNEL.map(r => r.nome)];
  const est0 = lerEstado();
  const livre = rota => !((est0.bloqueios[`${host}|${rota}`] || 0) > Date.now());
  const rotas = opc('--rota') ? [opc('--rota')] : [...todas.filter(livre), ...todas.filter(r => !livre(r))];
  let ultimo = null, ultimoErro = null;
  for (const [i, rota] of rotas.entries()) {
    let r;
    try { r = await tentar(url, rota); } catch (e) { ultimoErro = e.message; console.error(`rota ${rota}: erro: ${e.message}`); continue; }
    ultimo = r;
    if (r.estado === 'ok') return { codigo: 0, saida: r.saida, binario: /^ARQUIVO: [^\n]*$/.test(r.saida) };
    if (r.estado === 'captcha') break;   // captcha nao depende do IP: trocar de rota nao adianta
    if (r.estado === 'desafio' || r.estado === 'recusado') {
      await comTrava(async () => { const e = lerEstado(); e.bloqueios[`${host}|${rota}`] = Date.now() + BLOQUEIO_HORAS * 3600e3; gravarEstado(e); });
      console.error(`rota ${rota}: ${r.estado === 'desafio' ? 'verificacao nao liberou' : 'site recusou este IP'}${i < rotas.length - 1 ? '; tentando a proxima rota' : ''}`);
      continue;
    }
    return { codigo: 5, erro: `rota ${rota}: ${r.saida}` };
  }
  if (process.env.DEPURAR && ultimo) console.error('PAGINA:', (ultimo.texto || '').slice(0, 300));
  // nenhuma rota chegou a ver a pagina (endereco errado, sem internet, tunel caido): erro, nao bloqueio
  if (!ultimo && ultimoErro) return { codigo: 5, erro: `FALHOU: ${ultimoErro}` };
  return {
    codigo: 3, erro: ultimo && ultimo.estado === 'captcha'
      ? 'BLOQUEADO: o site pediu captcha e ele nao foi resolvido a tempo (3 min). Rode de novo quando o usuario puder resolver.'
      : `BLOQUEADO em todas as rotas (${rotas.join(', ')}).`
  };
}

// grava o texto inteiro num temporario e devolve o caminho (para Grep ou leitura por partes)
function guardar(texto, url) {
  mkdirSync(TEMP, { recursive: true });
  const f = join(TEMP, `texto-${new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '_')}-${Date.now()}.${modo === 'md' ? 'md' : 'txt'}`);
  writeFileSync(f, texto); return f;
}

// ---------- principal ----------
let codigoFinal = 0;
for (const [n, url] of urls.entries()) {
  const t0 = Date.now();
  const r = await processar(url);
  if (tem('--testar')) {
    const teste = TESTES.find(t => t.url === url);
    const ok = r.codigo === 0 && teste.espera.test(r.saida || '');
    console.log(`${ok ? 'ok     ' : 'FALHOU '} ${teste.nome} (${((Date.now() - t0) / 1000).toFixed(1)} s)${ok ? '' : ': ' + (r.erro || 'conteudo inesperado')}`);
    if (!ok) codigoFinal = 3;
    continue;
  }
  if (urls.length > 1) console.log(`${n ? '\n' : ''}===== ${url}`);
  if (r.codigo !== 0) { console.error(r.erro); codigoFinal ||= r.codigo; continue; }
  let saida = r.saida, aviso = '';
  if (!r.binario && termos.length && modo !== 'html') {
    const b = buscar(saida, termos);
    if (!b.achou) {
      console.log(`NADA ENCONTRADO para ${termos.map(t => `"${t}"`).join(' / ')} (pagina com ${saida.length} caracteres). Texto completo: ${guardar(saida, url)}`);
      codigoFinal ||= 4; continue;
    }
    aviso = `${b.achou} ocorrencia(s) de ${termos.map(t => `"${t}"`).join(' / ')}:\n`;
    saida = b.texto;
  }
  if (opc('--saida')) {
    try { writeFileSync(opc('--saida'), saida); console.log(`SALVO: ${opc('--saida')} (${saida.length} caracteres)`); }
    catch (e) { console.error(`--saida: nao consegui gravar ${opc('--saida')} (${e.code || e.message})`); codigoFinal ||= 5; }
    continue;
  }
  if (!r.binario && modo !== 'html' && maxChars > 0 && saida.length > maxChars) {
    const arq = guardar(r.saida, url);   // sempre a pagina inteira, mesmo com --buscar
    let corte = saida.lastIndexOf('\n', maxChars); if (corte < maxChars * 0.5) corte = maxChars;
    saida = `${saida.slice(0, corte)}\n[CORTADO: mostrei ${corte} de ${saida.length} caracteres${aviso ? ' dos trechos' : ''}. ${aviso ? 'Pagina inteira' : 'Texto completo'}: ${arq} (use --buscar "termo" ou Grep nesse arquivo)]`;
  }
  console.log(aviso + saida);
}
// sair sem process.exit() imediato: no Windows, matar o processo com o WebSocket/fetch ainda fechando derruba o
// Node com "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" (codigo 127)
process.exitCode = codigoFinal;
ws.onclose = () => setTimeout(() => process.exit(codigoFinal), 50);
ws.close();
setTimeout(() => process.exit(codigoFinal), 3000).unref();
