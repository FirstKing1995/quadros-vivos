// Quadros Vivos — tela inicial, realidade aumentada e prévia sem câmera.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Parede } from './parede.js';
import { SessaoAR, arDisponivel } from './xr.js';
import { SessaoCamera } from './camera.js';
import { desenharFolha } from './folha.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);

async function lerLayout() {
  if (params.has('rascunho')) {
    try { const r = JSON.parse(localStorage.getItem('qv-rascunho')); if (r && r.quadros) return r; } catch { /* sem rascunho */ }
  }
  const r = await fetch('parede.json?v=' + Date.now());
  return r.json();
}

let toastTimer;
function toast(msg, ms = 3200) {
  // a camada da realidade aumentada só mostra o que está dentro dela
  const t = $('#previa-ui').hidden ? $('#toast') : $('#toast-pv');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- cena compartilhada ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.xr.enabled = true;
$('#palco').appendChild(renderer.domElement);
const cena = new THREE.Scene();
cena.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.03).texture;
cena.add(new THREE.HemisphereLight(0xfff4e0, 0x403020, 0.9));
const sol = new THREE.DirectionalLight(0xfff0d8, 1.6);
sol.position.set(-1.2, 2.5, 2);
cena.add(sol);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.02, 60);
addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});

let layout, parede, sessao, temAR = false, erroAR = '';

// linha de diagnóstico no rodapé: diz o que o aparelho e o navegador oferecem
function diagnostico() {
  const ua = navigator.userAgent;
  const aparelho = (/Android [^;)]*;\s*([^;)]+)/.exec(ua) || [])[1] || (/(iPhone|iPad|Windows|Mac OS X|Linux)/.exec(ua) || [])[1] || 'aparelho';
  const nav = /SamsungBrowser\/(\d+)/.test(ua) ? 'Samsung Internet' : /EdgA?\/(\d+)/.test(ua) ? 'Edge'
    : /Instagram|FBAN|FBAV|WhatsApp|; wv\)/.test(ua) ? 'navegador interno de app' : /Chrome\/(\d+)/.test(ua) ? 'Chrome ' + /Chrome\/(\d+)/.exec(ua)[1] : 'outro navegador';
  const partes = [aparelho.trim(), nav, 'WebXR ' + (navigator.xr ? 'sim' : 'não'), 'ARCore ' + (temAR ? 'sim' : 'não')];
  if (erroAR) partes.push('erro: ' + erroAR);
  $('#diag').textContent = partes.join(' · ');
}

async function preparar() {
  if (window.lucide) lucide.createIcons();
  try { await document.fonts.load('italic 40px "Cormorant Garamond"'); } catch { /* segue com a fonte padrão */ }
  layout = await lerLayout();
  $('#titulo').textContent = layout.titulo || 'Nossa parede';
  $('#dedicatoria').textContent = layout.dedicatoria || '';
  document.title = (layout.titulo || 'Nossa parede') + ' | Quadros Vivos';
  const total = layout.quadros.length;
  parede = new Parede(layout);
  [temAR] = await Promise.all([
    arDisponivel(),
    parede.carregar((f) => { $('#status').textContent = `Preparando ${total} quadros... ${Math.round(f * 100)}%`; })
  ]);
  cena.add(parede.grupo);
  $('#bt-previa').disabled = false;
  $('#bt-abrir').disabled = false;
  $('#status').textContent = `${total} quadros prontos.`;
  // sem ARCore a parede abre no modo simples (câmera comum)
  $('#aviso-ar').hidden = temAR;
  diagnostico();
  if (params.has('previa')) abrirPrevia();
}

// ---------- realidade aumentada ----------
const ui = {
  procurando(modo) {
    $('#busca').hidden = false; $('#busca').classList.remove('sumir');
    ui.progresso(0);
    $('#busca-titulo').textContent = modo === false ? 'Mire no centro da folha' : 'Procure a folha';
    $('#busca-dica').textContent = modo === 'camera'
      ? 'Afaste-se uns três passos e deixe a folha inteira na tela. A parede aparece em volta dela.'
      : modo ? 'Aponte para a folha na parede, a cerca de um passo dela.'
        : 'Mexa o celular devagar até o círculo dourado aparecer sobre a folha. Então toque na tela.';
  },
  toast(t) { toast(t); },
  progresso(f) { $('#busca-arco').style.strokeDashoffset = String(339.3 * (1 - f)); },
  dica(t) { $('#busca-dica').textContent = t; },
  podeTocar(sim) {
    if (sim && !ui._avisouToque) { ui._avisouToque = true; ui.dica('Mire no centro da folha e toque na tela, ou siga apontando para ela.'); }
    if (!sim) ui._avisouToque = false;
  },
  colocada(origem) {
    ui.progresso(1);
    $('#busca').classList.add('sumir');
    setTimeout(() => { $('#busca').hidden = true; }, 450);
    toast(origem === 'toque' ? 'Parede no lugar. Se a folha aparecer, ajusto sozinho.'
      : origem === 'camera' ? 'Mantenha a folha na tela. Toque num quadro com vídeo para ouvir.'
        : 'Toque num quadro com vídeo para ouvir o som.', 4200);
  },
  toque(r) {
    if (r.som === true) toast('Som ligado neste quadro.');
    else if (r.som === false) toast('Som desligado.');
  },
  fim() {
    $('#camada').hidden = true;
    $('#palco').hidden = true;
    $('#inicio').hidden = false;
    sessao = null;
  }
};

async function abrir() {
  parede.liberarVideos(); // ainda dentro do toque: libera os vídeos
  if (temAR && !params.has('simples')) {
    $('#camada').hidden = false;
    sessao = new SessaoAR({ renderer, cena, camera, parede, camada: $('#camada'), ui, marcador: layout.marcador });
    try {
      await sessao.iniciar();
      $('#inicio').hidden = true;
      return;
    } catch (e) {
      console.error(e);
      erroAR = (e && (e.name || e.message)) || 'falhou';
      diagnostico();
      $('#camada').hidden = true;
    }
  }
  abrirCamera();
}

// modo simples: câmera comum, sem ARCore
async function abrirCamera() {
  const c = new SessaoCamera({ renderer, cena, parede, ui, marcador: layout.marcador });
  sessao = c;
  $('#camada').hidden = false; $('#palco').hidden = false; $('#inicio').hidden = true;
  try {
    await c.iniciar(params.has('camerafalsa') ? cameraFalsa() : undefined);
  } catch (e) {
    console.error(e);
    sessao = null;
    $('#camada').hidden = true; $('#palco').hidden = true; $('#inicio').hidden = false;
    const negou = e && /NotAllowed|Permission/i.test(e.name + e.message);
    $('#status').textContent = negou
      ? 'A câmera foi bloqueada. Toque no cadeado ao lado do endereço, libere a Câmera e tente de novo.'
      : 'Não consegui abrir a câmera: ' + ((e && (e.message || e.name)) || 'erro desconhecido');
  }
}

// para testar no computador: um vídeo de mentira com a folha balançando (?simples&camerafalsa)
function cameraFalsa() {
  const cv = document.createElement('canvas'); cv.width = 720; cv.height = 1280;
  const g = cv.getContext('2d');
  const folha = document.createElement('canvas'); folha.width = 420; folha.height = 594;
  desenharFolha(folha.getContext('2d'), 420, 594, layout.marcador);
  const t0 = performance.now();
  (function desenhar() {
    const t = (performance.now() - t0) / 1000;
    g.fillStyle = '#e9e5de'; g.fillRect(0, 0, 720, 1280);
    g.save();
    g.translate(360 + Math.sin(t * 0.7) * 60, 700 + Math.cos(t * 0.5) * 40);
    g.rotate(Math.sin(t * 0.4) * 0.12);
    const k = 0.22 + Math.sin(t * 0.3) * 0.03; // folha vista de uns 2,5 m
    g.drawImage(folha, -210 * k, -297 * k, 420 * k, 594 * k);
    g.restore();
    requestAnimationFrame(desenhar);
  })();
  return cv.captureStream(30);
}

// botões sobre a câmera não podem virar "toque na cena"
for (const b of document.querySelectorAll('.camada .bt-redondo')) b.addEventListener('beforexrselect', (e) => e.preventDefault());
$('#ar-sair').addEventListener('click', () => { if (sessao) sessao.encerrar(); else ui.fim(); });
$('#ar-repor').addEventListener('click', () => { if (sessao) { sessao.procurar(); toast('Aponte para a folha de novo.'); } });
$('#ar-mudo').addEventListener('click', () => { parede.silenciar(); toast('Todos os quadros em silêncio.'); });

// ---------- prévia sem câmera ----------
let sala, controles;
function montarSala() {
  sala = new THREE.Group();
  const mk = layout.marcador, pw = layout.parede.largura, ph = layout.parede.altura;
  const base = 0.5; // altura do pé da área dos quadros em relação ao chão
  const paredeM = new THREE.Mesh(new THREE.PlaneGeometry(pw + 3, ph + 1.6), new THREE.MeshStandardMaterial({ color: 0xf3f0ea, roughness: 0.95 }));
  paredeM.position.set(pw / 2 - mk.x, (ph + 1.6) / 2 - base - mk.y, -0.002);
  sala.add(paredeM);
  const chao = new THREE.Mesh(new THREE.PlaneGeometry(pw + 3, 5), new THREE.MeshStandardMaterial({ color: 0x6b4f38, roughness: 0.7 }));
  chao.rotation.x = -Math.PI / 2;
  chao.position.set(pw / 2 - mk.x, -base - mk.y, 2.5);
  sala.add(chao);
  const rodape = new THREE.Mesh(new THREE.BoxGeometry(pw + 3, 0.1, 0.015), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
  rodape.position.set(pw / 2 - mk.x, -base - mk.y + 0.05, 0.007);
  sala.add(rodape);
  // a folha impressa no lugar dela (fica atrás do quadro que a cobre)
  const c = document.createElement('canvas'); c.width = 420; c.height = 594;
  desenharFolha(c.getContext('2d'), c.width, c.height, mk);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const folha = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.297), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  folha.position.z = 0.0008;
  sala.add(folha);
  cena.add(sala);
}

function abrirPrevia() {
  if (!sala) montarSala();
  $('#inicio').hidden = true; $('#palco').hidden = false; $('#previa-ui').hidden = false;
  document.body.style.background = '#000';
  parede.grupo.matrixAutoUpdate = true;
  parede.grupo.position.set(0, 0, 0); parede.grupo.quaternion.identity();
  parede.grupo.visible = true;
  sala.visible = true;
  const meio = layout.parede.altura / 2 - layout.marcador.y;
  const dx = layout.parede.largura / 2 - layout.marcador.x;
  camera.position.set(dx, meio + 0.1, 3.3);
  if (!controles) {
    controles = new OrbitControls(camera, renderer.domElement);
    controles.enableDamping = true;
    controles.minDistance = 0.5; controles.maxDistance = 6;
    controles.minAzimuthAngle = -1.2; controles.maxAzimuthAngle = 1.2;
    controles.minPolarAngle = 0.5; controles.maxPolarAngle = 2.2;
  }
  controles.target.set(dx, meio, 0);
  controles.update();
  window.qv = { camera, controles, parede }; // para inspecionar pelo console
  parede.liberarVideos();
  parede.aparecer();
  const relogio = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.1, relogio.getDelta());
    controles.update();
    parede.atualizar(dt, camera);
    renderer.render(cena, camera);
  });
}

function fecharPrevia() {
  renderer.setAnimationLoop(null);
  parede.silenciar();
  for (const v of parede.videos) v.pause();
  if (sala) sala.visible = false;
  $('#palco').hidden = true; $('#previa-ui').hidden = true; $('#inicio').hidden = false;
  document.body.style.background = '';
}

// clique na prévia: só conta se não arrastou
let baixo = null;
renderer.domElement.addEventListener('pointerdown', (e) => { baixo = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (renderer.xr.isPresenting || !baixo || Math.hypot(e.clientX - baixo[0], e.clientY - baixo[1]) > 6) return;
  const r = renderer.domElement.getBoundingClientRect();
  if (sessao instanceof SessaoCamera) {
    const res = sessao.tocar(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    if (res) ui.toque(res);
    return;
  }
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const res = parede.tocar(rc);
  if (res && res.som !== null) toast(res.som ? 'Som ligado neste quadro.' : 'Som desligado.');
});

$('#bt-abrir').addEventListener('click', abrir);
$('#bt-previa').addEventListener('click', abrirPrevia);
$('#pv-voltar').addEventListener('click', fecharPrevia);
$('#pv-repetir').addEventListener('click', () => parede.aparecer());
$('#pv-mudo').addEventListener('click', () => parede.silenciar());

preparar().catch((e) => {
  console.error(e);
  $('#status').textContent = 'Não consegui carregar a parede. Recarregue a página.';
});
