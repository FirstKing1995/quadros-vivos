// Quadros Vivos — editor da parede (área de administração).
// Coordenadas em metros: x a partir da borda esquerda, y a partir da borda de baixo da área dos quadros.
import { ESTILOS, tamanhoExterno, internoDoExterno } from './medidas.js';

const $ = (s) => document.querySelector(s);
const CHAVE = 'qv-rascunho';
const FOLHA = { w: 0.21, h: 0.297 };
const arred = (v) => Math.round(v * 100) / 100;

let P = null;         // layout em edição
let original = '';    // parede.json como veio do site
let midias = [];
let sel = -1;         // quadro selecionado
let escala = 1;       // pixels por metro

let toastTimer;
function toast(msg, ms = 3800) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
const ehVideo = (arq) => /\.(mp4|webm|mov|m4v)$/i.test(arq || '');
const infoMidia = (arq) => midias.find((m) => m.arquivo === arq);

function mudou() {
  try { localStorage.setItem(CHAVE, JSON.stringify(P)); } catch { /* sem espaço: segue */ }
  desenhar();
}

// ---------- desenho da parede ----------
function desenhar() {
  const el = $('#parede');
  const W = P.parede.largura, H = P.parede.altura;
  escala = el.clientWidth / W;
  el.style.height = H * escala + 'px';
  el.style.backgroundSize = `${escala * 0.1}px ${escala * 0.1}px`;
  $('#medidas').textContent = `Parede de ${String(W).replace('.', ',')} x ${String(H).replace('.', ',')} m · grade de 10 cm · ${P.quadros.length} quadros`;
  el.innerHTML = '';
  const mk = P.marcador;
  const f = document.createElement('div');
  f.className = 'folha-ed';
  Object.assign(f.style, caixa(mk.x, mk.y, FOLHA.w, FOLHA.h));
  f.innerHTML = '<div class="mk"></div>';
  f.title = 'Folha impressa (arraste para mudar o lugar)';
  f.dataset.folha = '1';
  el.appendChild(f);
  P.quadros.forEach((q, i) => {
    const { W: ow, H: oh, L } = tamanhoExterno(q);
    const d = document.createElement('div');
    d.className = `q ${ESTILOS[q.estilo] ? q.estilo : 'classica'}${i === sel ? ' sel' : ''}`;
    d.dataset.i = i;
    Object.assign(d.style, caixa(q.x, q.y, ow, oh));
    const img = document.createElement('div');
    img.className = 'img';
    Object.assign(img.style, { left: L * escala + 'px', top: L * escala + 'px', right: L * escala + 'px', bottom: L * escala + 'px' });
    const pos = `${(q.foco?.[0] ?? 0.5) * 100}% ${(q.foco?.[1] ?? 0.5) * 100}%`;
    if (!q.midia) img.textContent = String(i + 1);
    else if (ehVideo(q.midia)) {
      const v = document.createElement('video');
      Object.assign(v, { src: q.midia, muted: true, loop: true, autoplay: true, playsInline: true });
      v.style.objectPosition = pos;
      img.appendChild(v);
    } else {
      const im = document.createElement('img'); im.src = q.midia; im.alt = ''; im.style.objectPosition = pos;
      img.appendChild(im);
    }
    d.innerHTML = '<div class="mold"></div>';
    d.appendChild(img);
    d.insertAdjacentHTML('beforeend', `<span class="rot">${i + 1}</span><span class="alca" data-alca="1"></span>`);
    el.appendChild(d);
  });
  avisos();
  painel();
}

function caixa(cx, cy, w, h) {
  return { left: (cx - w / 2) * escala + 'px', top: (P.parede.altura - cy - h / 2) * escala + 'px', width: w * escala + 'px', height: h * escala + 'px' };
}

function retangulo(q) {
  const { W, H } = tamanhoExterno(q);
  return { x0: q.x - W / 2, x1: q.x + W / 2, y0: q.y - H / 2, y1: q.y + H / 2 };
}

function avisos() {
  const lista = [];
  const ruins = new Set();
  const R = P.quadros.map(retangulo);
  R.forEach((a, i) => {
    if (a.x0 < -0.001 || a.y0 < -0.001 || a.x1 > P.parede.largura + 0.001 || a.y1 > P.parede.altura + 0.001) { lista.push(`O quadro ${i + 1} passa da borda da parede.`); ruins.add(i); }
    for (let j = i + 1; j < R.length; j++) {
      const b = R[j];
      const folga = Math.max(b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1);
      if (folga < 0.02) { lista.push(folga < 0 ? `Os quadros ${i + 1} e ${j + 1} estão um sobre o outro.` : `Os quadros ${i + 1} e ${j + 1} estão quase encostando.`); ruins.add(i); ruins.add(j); }
    }
  });
  const mk = P.marcador;
  const cobre = P.quadros.some((q) => Math.abs(q.x - mk.x) + FOLHA.w / 2 <= tamanhoExterno(q).W / 2 && Math.abs(q.y - mk.y) + FOLHA.h / 2 <= tamanhoExterno(q).H / 2);
  if (!cobre) lista.push('A folha fica à mostra. Ponha um quadro por cima dela: pela câmera ele a esconde.');
  const nv = P.quadros.filter((q) => ehVideo(q.midia)).length;
  if (nv > 6) lista.push(`São ${nv} vídeos. O celular toca só os que estão na tela, mas acima de 6 pode pesar.`);
  const ul = $('#avisos');
  ul.innerHTML = lista.length ? lista.map((t) => `<li>${t}</li>`).join('') : '<li class="ok">Tudo certo: nenhum quadro encostando e a folha está coberta.</li>';
  for (const i of ruins) { const d = document.querySelector(`.q[data-i="${i}"]`); if (d) d.classList.add('ruim'); }
}

// ---------- painel ----------
function painel() {
  const q = P.quadros[sel];
  $('#painel-quadro').hidden = !q;
  if (!q) return;
  $('#pq-titulo').textContent = `Quadro ${sel + 1}`;
  $('#pq-estilos').innerHTML = Object.entries(ESTILOS).map(([k, e]) => `<button data-estilo="${k}" class="${q.estilo === k ? 'on' : ''}">${e.nome}</button>`).join('');
  if (document.activeElement !== $('#pq-w')) $('#pq-w').value = Math.round(q.w * 100);
  if (document.activeElement !== $('#pq-h')) $('#pq-h').value = Math.round(q.h * 100);
  const { W, H } = tamanhoExterno(q);
  $('#pq-externo').textContent = `Com a moldura: ${Math.round(W * 100)} x ${Math.round(H * 100)} cm.`;
  const info = infoMidia(q.midia);
  $('#pq-proporcao').hidden = !info;
  $('#pq-fx').value = Math.round((q.foco?.[0] ?? 0.5) * 100);
  $('#pq-fy').value = Math.round((q.foco?.[1] ?? 0.5) * 100);
  $('#pq-foco').hidden = !q.midia;
  for (const b of document.querySelectorAll('#pq-midias button')) b.classList.toggle('on', (b.dataset.arq || null) === (q.midia || null));
}

function miniaturas() {
  const item = (m) => {
    const vis = m.tipo === 'video'
      ? (m.capa ? `<img src="${m.capa}" alt="" loading="lazy">` : `<video src="${m.arquivo}#t=0.5" muted preload="metadata"></video>`)
      : `<img src="${m.arquivo}" alt="" loading="lazy">`;
    const icone = m.tipo === 'video' ? '<span class="tipo"><i data-lucide="play"></i></span>' : '';
    return `<button data-arq="${m.arquivo}" title="${m.original || m.arquivo}">${vis}${icone}</button>`;
  };
  $('#pq-midias').innerHTML = '<button data-arq=""><span class="vazio">Moldura vazia</span></button>' + midias.map(item).join('');
  $('#pp-midias').innerHTML = midias.length ? midias.map(item).join('') : '<p class="nota">Nenhuma ainda.</p>';
  if (window.lucide) lucide.createIcons();
}

function painelParede() {
  $('#pp-titulo').value = P.titulo || '';
  $('#pp-dedicatoria').value = P.dedicatoria || '';
  $('#pp-w').value = P.parede.largura;
  $('#pp-h').value = P.parede.altura;
  $('#pp-mx').value = Math.round(P.marcador.x * 100);
  $('#pp-my').value = Math.round(P.marcador.y * 100);
  $('#pp-lado').value = String(P.marcador.lado);
}

// ---------- arrastar ----------
let gesto = null;
function pontoEmMetros(e) {
  const r = $('#parede').getBoundingClientRect();
  return { x: (e.clientX - r.left) / escala, y: P.parede.altura - (e.clientY - r.top) / escala };
}

$('#parede').addEventListener('pointerdown', (e) => {
  const p = pontoEmMetros(e);
  const alvo = e.target.closest('.q, .folha-ed');
  if (!alvo) { sel = -1; desenhar(); return; }
  $('#parede').setPointerCapture(e.pointerId);
  if (alvo.dataset.folha) { gesto = { tipo: 'folha', dx: p.x - P.marcador.x, dy: p.y - P.marcador.y }; return; }
  const i = Number(alvo.dataset.i);
  const q = P.quadros[i];
  if (sel !== i) { sel = i; desenhar(); }
  if (e.target.dataset.alca) {
    const { W, H } = tamanhoExterno(q);
    gesto = { tipo: 'tamanho', i, x0: q.x - W / 2, y1: q.y + H / 2, prop: q.w / q.h };
  } else gesto = { tipo: 'mover', i, dx: p.x - q.x, dy: p.y - q.y };
  e.preventDefault();
});

$('#parede').addEventListener('pointermove', (e) => {
  if (!gesto) return;
  const p = pontoEmMetros(e);
  if (gesto.tipo === 'folha') {
    P.marcador.x = arred(p.x - gesto.dx); P.marcador.y = arred(p.y - gesto.dy);
  } else if (gesto.tipo === 'mover') {
    const q = P.quadros[gesto.i];
    q.x = arred(p.x - gesto.dx); q.y = arred(p.y - gesto.dy);
  } else {
    const q = P.quadros[gesto.i];
    const W = Math.max(0.12, p.x - gesto.x0), H = Math.max(0.12, gesto.y1 - p.y);
    const { w, h } = internoDoExterno(q.estilo, W, H, e.shiftKey ? gesto.prop : null);
    q.w = arred(w); q.h = arred(h);
    const ext = tamanhoExterno(q);
    q.x = arred(gesto.x0 + ext.W / 2); q.y = arred(gesto.y1 - ext.H / 2);
  }
  desenhar();
});

const soltar = () => { if (gesto) { gesto = null; mudou(); } };
$('#parede').addEventListener('pointerup', soltar);
$('#parede').addEventListener('pointercancel', soltar);

$('#parede').addEventListener('keydown', (e) => {
  const q = P.quadros[sel];
  if (!q) return;
  const passo = e.shiftKey ? 0.05 : 0.01;
  const mov = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, passo], ArrowDown: [0, -passo] }[e.key];
  if (mov) { q.x = arred(q.x + mov[0]); q.y = arred(q.y + mov[1]); mudou(); e.preventDefault(); }
  if (e.key === 'Delete' || e.key === 'Backspace') { remover(); e.preventDefault(); }
});

// ---------- ações ----------
function remover() {
  if (sel < 0) return;
  P.quadros.splice(sel, 1); sel = -1; mudou();
}
function novoId() { let n = 1; while (P.quadros.some((q) => q.id === 'q' + n)) n++; return 'q' + n; }

$('#bt-novo').addEventListener('click', () => {
  P.quadros.push({ id: novoId(), x: arred(P.parede.largura / 2), y: arred(P.parede.altura / 2), w: 0.3, h: 0.4, estilo: 'classica', midia: null, foco: [0.5, 0.5] });
  sel = P.quadros.length - 1; mudou();
  toast('Quadro novo no meio da parede. Arraste para o lugar dele.');
});
$('#pq-remover').addEventListener('click', remover);
$('#pq-duplicar').addEventListener('click', () => {
  const q = P.quadros[sel]; if (!q) return;
  const c = JSON.parse(JSON.stringify(q)); c.id = novoId(); c.x = arred(c.x + 0.1); c.y = arred(c.y - 0.1);
  P.quadros.push(c); sel = P.quadros.length - 1; mudou();
});
$('#pq-estilos').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  P.quadros[sel].estilo = b.dataset.estilo; mudou();
});
for (const [id, k] of [['#pq-w', 'w'], ['#pq-h', 'h']]) {
  $(id).addEventListener('change', () => {
    const v = Number($(id).value) / 100;
    if (v >= 0.06 && v <= 3) { P.quadros[sel][k] = arred(v); mudou(); }
  });
}
$('#pq-proporcao').addEventListener('click', () => {
  const q = P.quadros[sel], m = infoMidia(q.midia); if (!m) return;
  const prop = m.w / m.h;
  if (prop >= 1) q.h = arred(q.w / prop); else q.w = arred(q.h * prop);
  mudou();
});
for (const [id, k] of [['#pq-fx', 0], ['#pq-fy', 1]]) {
  $(id).addEventListener('input', () => {
    const q = P.quadros[sel]; q.foco = q.foco || [0.5, 0.5];
    q.foco[k] = Number($(id).value) / 100;
    const m = document.querySelector(`.q[data-i="${sel}"] .img > *`);
    if (m) m.style.objectPosition = `${q.foco[0] * 100}% ${q.foco[1] * 100}%`;
  });
  $(id).addEventListener('change', mudou);
}
$('#pq-midias').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const q = P.quadros[sel];
  q.midia = b.dataset.arq || null;
  q.foco = [0.5, 0.5];
  mudou();
});
$('#pp-midias').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (sel < 0) { toast('Escolha um quadro na parede primeiro.'); return; }
  P.quadros[sel].midia = b.dataset.arq; mudou();
});
$('#pp-titulo').addEventListener('change', () => { P.titulo = $('#pp-titulo').value.trim(); mudou(); });
$('#pp-dedicatoria').addEventListener('change', () => { P.dedicatoria = $('#pp-dedicatoria').value.trim(); mudou(); });
$('#pp-w').addEventListener('change', () => { const v = Number($('#pp-w').value); if (v >= 1) { P.parede.largura = v; mudou(); } });
$('#pp-h').addEventListener('change', () => { const v = Number($('#pp-h').value); if (v >= 1) { P.parede.altura = v; mudou(); } });
$('#pp-mx').addEventListener('change', () => { P.marcador.x = Number($('#pp-mx').value) / 100; mudou(); });
$('#pp-my').addEventListener('change', () => { P.marcador.y = Number($('#pp-my').value) / 100; mudou(); });
$('#pp-lado').addEventListener('change', () => { P.marcador.lado = Number($('#pp-lado').value); mudou(); toast('Imprima a folha de novo com o tamanho novo.'); });

$('#bt-ver').addEventListener('click', () => {
  try { localStorage.setItem(CHAVE, JSON.stringify(P)); } catch { /* segue */ }
  window.open('index.html?previa&rascunho', '_blank');
});

$('#bt-salvar').addEventListener('click', async () => {
  const texto = JSON.stringify(P, null, 2) + '\n';
  try {
    const r = await fetch('api/salvar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: texto });
    if (!r.ok) throw new Error(String(r.status));
    original = JSON.stringify(P);
    localStorage.removeItem(CHAVE);
    toast('Parede salva. Para ir para o site, publique o projeto de novo.');
  } catch {
    // no site publicado não há onde gravar: baixa o arquivo para trocar no repositório
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
    a.download = 'parede.json';
    a.click();
    toast('Baixei o arquivo parede.json. Coloque-o no lugar do atual em site/ e publique de novo.', 7000);
  }
});

$('#bt-continuar').addEventListener('click', () => {
  P = JSON.parse(localStorage.getItem(CHAVE)); $('#faixa-rascunho').hidden = true; painelParede(); desenhar();
});
$('#bt-descartar').addEventListener('click', () => { localStorage.removeItem(CHAVE); $('#faixa-rascunho').hidden = true; });
addEventListener('resize', () => desenhar());

async function iniciar() {
  if (window.lucide) lucide.createIcons();
  P = await (await fetch('parede.json?v=' + Date.now())).json();
  original = JSON.stringify(P);
  try { midias = await (await fetch('midia/lista.json?v=' + Date.now())).json(); } catch { midias = []; }
  try {
    const r = localStorage.getItem(CHAVE);
    if (r && r !== original && JSON.parse(r).quadros) $('#faixa-rascunho').hidden = false;
  } catch { /* rascunho estragado: ignora */ }
  miniaturas();
  painelParede();
  desenhar();
}
iniciar();
