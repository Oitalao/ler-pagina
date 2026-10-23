// ler-pagina: abre um endereco no navegador oculto do agente e devolve o texto (ou HTML, ou o arquivo).
// Passa pela verificacao anti-robo de JavaScript (Cloudflare etc.) porque e um Chrome comum, com janela,
// so que numa area de trabalho do Windows que o usuario nao ve. Nao usa o perfil nem os cookies do usuario.
//
// Uso: ler-pagina <url> [--html] [--baixar <arquivo>] [--espera <segundos>] [--rota <nome>]
//
// Rotas de saida: "direta" (a internet do computador) e, se configuradas, rotas por tunel SSH (outra internet).
// Se uma rota for barrada num site, tenta a proxima e lembra por 2 h.
// Captcha: mostra a area oculta na tela para o usuario resolver e volta assim que o captcha some.
//
// Privacidade: cada rota usa um contexto so de memoria, que some quando o navegador do agente fecha.
// Depois de cada leitura, apaga todo cookie que nao seja de dominio oficial (.jus.br, .gov.br, .leg.br, .mp.br,
// .def.br) nem cookie tecnico de verificacao anti-robo (cf_clearance, __cf_bm, _cfuvid).
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmdirSync, statSync, existsSync, rmSync, renameSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

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
const BLOQUEIO_HORAS = 2;

const args = process.argv.slice(2);
const url = args.find(a => /^https?:\/\//i.test(a));
const opc = n => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] ?? true) : null; };
if (!url) { console.error('uso: ler-pagina <url> [--html] [--baixar arquivo] [--espera segundos] [--rota nome]'); process.exit(2); }
// espera por rota: desafio automatico da Cloudflare libera em < 15 s; passou disso, e desafio de clicar ou IP marcado
const esperaMax = Number(opc('--espera')) || 25;
const host = new URL(url).hostname;
const dormir = ms => new Promise(ok => setTimeout(ok, ms));
mkdirSync(BASE, { recursive: true });

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
async function resolverCaptcha(targetId, ler, s) {
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
      seguidas = (navegou && r.texto.length > 0 && !CAPTCHA.test(r.texto)) ? seguidas + 1 : 0;
      if (seguidas >= 2) { resolvido = true; break; }   // duas leituras seguidas sem captcha, ja em outra pagina
    }
    writeFileSync(join(pasta, 'fim'), '1');   // fecha a janelinha
    if (!fechada) { await Promise.race([new Promise(ok => janela.once('exit', ok)), dormir(3000)]); if (!fechada) try { janela.kill(); } catch {} }
    rmSync(pasta, { recursive: true, force: true });
    return resolvido;
  }, TRAVA_TELA, 200000);
}

// ---------- uma tentativa numa rota ----------
async function tentar(rota) {
  const ctx = await contextoDaRota(rota);
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId: ctx, background: true });
  try {
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p, lim) => cdp(m, p, sessionId, lim);
    await s('Page.navigate', { url });
    const ler = async () => {
      const doc = await s('DOM.getDocument', { depth: 0 });
      const html = (await s('DOM.getOuterHTML', { nodeId: doc.root.nodeId })).outerHTML;
      const texto = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
      let mime = '';
      try { mime = (await s('Page.getResourceTree')).frameTree.frame.mimeType || ''; } catch {}
      return { html, texto, arquivo: mime !== '' && !/html|xml|text\/plain/i.test(mime) };
    };
    let r = { html: '', texto: '', arquivo: false }, estado = 'desafio', captchaVisto = false;
    let t0 = Date.now();
    await dormir(2000);
    while ((Date.now() - t0) / 1000 < esperaMax) {
      try { r = await ler(); } catch { r = { html: '', texto: '', arquivo: false }; }
      const curta = r.texto.length < 3000;   // tela de desafio/recusa/captcha e sempre curta
      if (curta && RECUSA.test(r.texto)) { estado = 'recusado'; break; }
      if (curta && CAPTCHA.test(r.texto)) {
        if (captchaVisto || process.env.LER_PAGINA_SEM_TELA) { estado = 'captcha'; break; }
        captchaVisto = true;
        console.error('captcha: abri uma janelinha no canto da tela para o usuario resolver...');
        if (!(await resolverCaptcha(targetId, ler, s))) { estado = 'captcha'; break; }
        t0 = Date.now();   // resolveu: espera a pagina de resultado
        continue;
      }
      if (!(curta && DESAFIO.test(r.texto)) && (r.texto.length > 200 || r.arquivo || (r.texto.length > 0 && Date.now() - t0 > 8000))) { estado = 'ok'; break; }
      await dormir(1500);
    }
    if (estado === 'ok' && !r.arquivo) { await dormir(1500); try { r = await ler(); } catch {} }

    let saida = null;
    if (estado === 'ok' && (opc('--baixar') || r.arquivo)) {
      let destino = opc('--baixar');
      if (!destino || destino === true) { mkdirSync(TEMP, { recursive: true }); destino = join(TEMP, `arquivo-${Date.now()}.pdf`); }
      let resp;
      if (rota !== 'direta') {
        // por tunel, o download tambem sai por la: baixa dentro do proprio navegador
        const b64 = await s('Runtime.evaluate', { expression: `fetch(${JSON.stringify(url)}).then(r=>r.arrayBuffer()).then(b=>{let s='';const u=new Uint8Array(b);for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode(...u.subarray(i,i+32768));return btoa(s)})`, awaitPromise: true, returnByValue: true }, 180000);
        resp = { ok: true, status: 200, tipo: '', buf: Buffer.from(b64.result.value || '', 'base64') };
      } else {
        // so os cookies que o proprio navegador mandaria a este endereco
        const { cookies } = await s('Network.getCookies', { urls: [url] });
        const cab = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        const rr = await fetch(url, { headers: { 'User-Agent': info['User-Agent'], ...(cab ? { Cookie: cab } : {}) } });
        resp = { ok: rr.ok, status: rr.status, tipo: rr.headers.get('content-type') || '', buf: Buffer.from(await rr.arrayBuffer()) };
      }
      if (!resp.ok || resp.buf.length === 0 || (/text\/html/i.test(resp.tipo) && !opc('--baixar'))) {
        estado = 'falhou'; saida = `download falhou (HTTP ${resp.status}, ${resp.buf.length} bytes, ${resp.tipo})`;
      } else { writeFileSync(destino, resp.buf); saida = `ARQUIVO: ${destino} (${resp.buf.length} bytes, HTTP ${resp.status}${resp.tipo ? ', ' + resp.tipo : ''}, rota ${rota})`; }
    } else if (estado === 'ok') {
      saida = opc('--html') ? r.html : r.texto;
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
    return { estado, saida, texto: r.texto };
  } finally {
    await cdp('Target.closeTarget', { targetId }).catch(() => {});
  }
}

// ---------- ordem das rotas ----------
const todas = ['direta', ...ROTAS_TUNEL.map(r => r.nome)];
const est0 = lerEstado();
const livre = rota => !((est0.bloqueios[`${host}|${rota}`] || 0) > Date.now());
let rotas = opc('--rota') ? [opc('--rota')] : [...todas.filter(livre), ...todas.filter(r => !livre(r))];

let codigo = 3, ultimo = null;
for (const [i, rota] of rotas.entries()) {
  let r;
  try { r = await tentar(rota); } catch (e) { console.error(`rota ${rota}: erro: ${e.message}`); continue; }
  ultimo = { rota, ...r };
  if (r.estado === 'ok') { console.log(r.saida); codigo = 0; break; }
  if (r.estado === 'captcha') break;   // captcha nao depende do IP: trocar de rota nao adianta
  if (r.estado === 'desafio' || r.estado === 'recusado') {
    await comTrava(async () => { const e = lerEstado(); e.bloqueios[`${host}|${rota}`] = Date.now() + BLOQUEIO_HORAS * 3600e3; gravarEstado(e); });
    console.error(`rota ${rota}: ${r.estado === 'desafio' ? 'verificacao nao liberou' : 'site recusou este IP'}${i < rotas.length - 1 ? '; tentando a proxima rota' : ''}`);
    continue;
  }
  console.error(`rota ${rota}: ${r.saida}`); codigo = 5; break;
}
if (codigo === 3) {
  if (ultimo && ultimo.estado === 'captcha') console.error('BLOQUEADO: o site pediu captcha e ele nao foi resolvido a tempo (3 min). Rode de novo quando o usuario puder resolver.');
  else console.error(`BLOQUEADO em todas as rotas (${rotas.join(', ')}).`);
  if (process.env.DEPURAR && ultimo) console.error('PAGINA:', (ultimo.texto || '').slice(0, 300));
}
ws.close();
process.exit(codigo);
