// Quadros Vivos — molduras feitas de geometria (sem arquivos de modelo).
// Cada estilo empilha anéis extrudados com bisel: banda de fora, friso arredondado e filete de dentro.
import * as THREE from 'three';
import { ESTILOS, larguraMoldura } from './medidas.js';

export { ESTILOS, larguraMoldura };
export { tamanhoExterno } from './medidas.js';

// ---------- texturas procedurais ----------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

let _texturas = null;
function texturas() {
  if (_texturas) return _texturas;
  // relevo de entalhe: volutas e contas repetidas, costurado nas bordas
  const c = canvas(256, 256), g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
  let s = 11;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  g.filter = 'blur(1.2px)';
  for (let i = 0; i < 46; i++) {
    const x = r() * 256, y = r() * 256, rad = 8 + r() * 18, a0 = r() * 6.28;
    g.lineWidth = 2 + r() * 4;
    g.strokeStyle = r() > 0.5 ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.45)';
    for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
      g.beginPath(); g.arc(x + ox, y + oy, rad, a0, a0 + 3.6 + r()); g.stroke();
    }
  }
  for (let i = 0; i < 70; i++) {
    const x = r() * 256, y = r() * 256, rad = 2 + r() * 3;
    g.fillStyle = 'rgba(255,255,255,.6)';
    for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) { g.beginPath(); g.arc(x + ox, y + oy, rad, 0, 6.29); g.fill(); }
  }
  g.filter = 'none';
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) { const n = (r() - 0.5) * 30; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  g.putImageData(img, 0, 0);
  const relevo = new THREE.CanvasTexture(c);
  relevo.wrapS = relevo.wrapT = THREE.RepeatWrapping;
  relevo.repeat.set(9, 9);

  // veio de madeira escura
  const m = canvas(512, 512), gm = m.getContext('2d');
  gm.fillStyle = '#3a2214'; gm.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 160; i++) {
    const y = r() * 512, amp = 2 + r() * 6, cor = r() > 0.5 ? 'rgba(20,10,5,.35)' : 'rgba(110,70,40,.25)';
    gm.strokeStyle = cor; gm.lineWidth = 0.6 + r() * 2.2;
    gm.beginPath();
    for (let x = 0; x <= 512; x += 8) gm.lineTo(x, y + Math.sin(x / (30 + r() * 8) + i) * amp);
    gm.stroke();
  }
  const madeira = new THREE.CanvasTexture(m);
  madeira.colorSpace = THREE.SRGBColorSpace;
  madeira.wrapS = madeira.wrapT = THREE.RepeatWrapping;
  madeira.repeat.set(3, 3);

  // sombra macia (retângulo e oval)
  const sombra = (oval) => {
    const k = canvas(256, 256), gk = k.getContext('2d');
    gk.filter = 'blur(18px)';
    gk.fillStyle = '#000';
    if (oval) { gk.beginPath(); gk.ellipse(128, 128, 84, 84, 0, 0, 6.29); gk.fill(); } else gk.fillRect(44, 44, 168, 168);
    const t = new THREE.CanvasTexture(k);
    return t;
  };

  // vinheta + reflexo de vidro sobre a foto
  const vidro = (oval) => {
    const k = canvas(256, 256), gk = k.getContext('2d');
    const rg = gk.createRadialGradient(128, 128, oval ? 70 : 90, 128, 128, oval ? 132 : 182);
    rg.addColorStop(0, 'rgba(20,12,4,0)'); rg.addColorStop(1, 'rgba(20,12,4,.55)');
    gk.fillStyle = rg; gk.fillRect(0, 0, 256, 256);
    const lg = gk.createLinearGradient(0, 0, 256, 256);
    lg.addColorStop(0.18, 'rgba(255,255,255,0)'); lg.addColorStop(0.3, 'rgba(255,250,235,.06)');
    lg.addColorStop(0.36, 'rgba(255,255,255,0)');
    gk.fillStyle = lg; gk.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(k);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  _texturas = { relevo, madeira, sombraRet: sombra(false), sombraOval: sombra(true), vidroRet: vidro(false), vidroOval: vidro(true) };
  return _texturas;
}

let _mat = null;
export function materiais() {
  if (_mat) return _mat;
  const t = texturas();
  _mat = {
    ouro: new THREE.MeshStandardMaterial({ color: 0xd1a74e, metalness: 1, roughness: 0.3, bumpMap: t.relevo, bumpScale: 1.4 }),
    ouroVelho: new THREE.MeshStandardMaterial({ color: 0x9a7432, metalness: 1, roughness: 0.42, bumpMap: t.relevo, bumpScale: 0.8 }),
    ouroLiso: new THREE.MeshStandardMaterial({ color: 0xe0b860, metalness: 1, roughness: 0.22 }),
    bronze: new THREE.MeshStandardMaterial({ color: 0x6b4a2a, metalness: 0.9, roughness: 0.38, bumpMap: t.relevo, bumpScale: 0.5 }),
    madeira: new THREE.MeshStandardMaterial({ map: t.madeira, metalness: 0, roughness: 0.5, color: 0xffffff }),
    fundo: new THREE.MeshStandardMaterial({ color: 0x1a120b, roughness: 0.9 })
  };
  return _mat;
}

// ---------- formas ----------
function contorno(oval, w, h, buraco = false) {
  const p = buraco ? new THREE.Path() : new THREE.Shape();
  if (oval) {
    // pontos sem repetir o primeiro no fim (absellipse deixa uma emenda visível no bisel)
    const N = 96;
    for (let i = 0; i < N; i++) {
      const a = ((buraco ? -i : i) / N) * Math.PI * 2;
      const x = Math.cos(a) * w / 2, y = Math.sin(a) * h / 2;
      if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
    }
    p.closePath();
  } else if (buraco) { p.moveTo(-w / 2, -h / 2); p.lineTo(-w / 2, h / 2); p.lineTo(w / 2, h / 2); p.lineTo(w / 2, -h / 2); p.closePath(); }
  else { p.moveTo(-w / 2, -h / 2); p.lineTo(w / 2, -h / 2); p.lineTo(w / 2, h / 2); p.lineTo(-w / 2, h / 2); p.closePath(); }
  return p;
}

// anel entre (wo, ho) e (wi, hi), da parede (z = z0) até z0 + alto, com bisel arredondado
function anel(oval, wo, ho, wi, hi, z0, alto, bisel, mat, segs = 3) {
  const b = Math.min(bisel, (wo - wi) / 4.2, alto / 2.2);
  const forma = contorno(oval, wo - 2 * b, ho - 2 * b);
  forma.holes.push(contorno(oval, wi + 2 * b, hi + 2 * b, true));
  const geo = new THREE.ExtrudeGeometry(forma, {
    depth: Math.max(0.0005, alto - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b,
    bevelSegments: segs, curveSegments: oval ? 72 : 1
  });
  geo.translate(0, 0, z0 + b);
  const mesh = new THREE.Mesh(geo, mat);
  return mesh;
}

function roseta(raio, mat) {
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI / 2;
    pts.push(new THREE.Vector2(Math.sin(a) * raio * (1 + 0.12 * Math.sin(a * 10)), Math.cos(a) * raio * 0.45));
  }
  const geo = new THREE.LatheGeometry(pts, 18);
  geo.rotateX(Math.PI / 2);
  return new THREE.Mesh(geo, mat);
}

// geometria da foto (retângulo ou oval) com UV de 0 a 1
function geoFoto(oval, w, h) {
  if (!oval) return new THREE.PlaneGeometry(w, h);
  const geo = new THREE.ShapeGeometry(contorno(true, w, h), 64);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  return geo;
}

// Monta a moldura completa. Devolve { grupo, foto (Mesh), sombra (Mesh), profundidade }.
export function criarMoldura(q, materialFoto) {
  const M = materiais(), T = texturas();
  const est = ESTILOS[q.estilo] ? q.estilo : 'classica';
  const oval = ESTILOS[est].oval;
  const { w, h } = q;
  const L = larguraMoldura(est, w, h);
  const D = est === 'fina' ? 0.022 : 0.03 + 0.02 * Math.min(w, h);
  const g = new THREE.Group();
  const W = (f) => w + 2 * L * f, H = (f) => h + 2 * L * f;

  if (est === 'fina') {
    g.add(anel(oval, W(1), H(1), W(0.25), H(0.25), 0, D * 0.8, L * 0.25, M.bronze));
    g.add(anel(oval, W(0.42), H(0.42), W(0), H(0), 0, D, L * 0.12, M.ouroVelho, 4));
  } else {
    const fora = est === 'nogueira' ? M.madeira : M.ouro;
    g.add(anel(oval, W(1), H(1), W(0.36), H(0.36), 0, D * 0.62, L * 0.16, fora, 3));
    g.add(anel(oval, W(1.02), H(1.02), W(0.9), H(0.9), 0, D * 0.7, L * 0.05, est === 'nogueira' ? M.ouroVelho : M.ouroLiso, 4));
    g.add(anel(oval, W(0.42), H(0.42), W(0.24), H(0.24), 0, D, L * 0.08, est === 'nogueira' ? M.ouroLiso : M.ouroLiso, 5));
    g.add(anel(oval, W(0.27), H(0.27), W(0), H(0), 0, D * 0.55, L * 0.06, est === 'nogueira' ? M.madeira : M.ouroVelho, 3));
    if (est === 'classica') {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const r = roseta(L * 0.36, M.ouroLiso);
        r.position.set(sx * (w / 2 + L * 0.68), sy * (h / 2 + L * 0.68), D * 0.62);
        g.add(r);
      }
    }
    if (est === 'oval') {
      const r = roseta(L * 0.5, M.ouroLiso);
      r.position.set(0, h / 2 + L * 0.7, D * 0.62);
      g.add(r);
    }
  }

  // fundo escuro atrás da foto (aparece na borda da vinheta)
  const fundo = new THREE.Mesh(geoFoto(oval, W(0.3), H(0.3)), M.fundo);
  fundo.position.z = D * 0.2;
  g.add(fundo);

  const foto = new THREE.Mesh(geoFoto(oval, w + 0.004, h + 0.004), materialFoto);
  foto.position.z = D * 0.28;
  g.add(foto);

  const vidro = new THREE.Mesh(geoFoto(oval, w + 0.004, h + 0.004), new THREE.MeshBasicMaterial({
    map: oval ? T.vidroOval : T.vidroRet, transparent: true, depthWrite: false, toneMapped: false
  }));
  vidro.position.z = D * 0.28 + 0.0015;
  g.add(vidro);

  const s = 1.32;
  const sombra = new THREE.Mesh(new THREE.PlaneGeometry(W(1) * s, H(1) * s), new THREE.MeshBasicMaterial({
    color: 0x000000, alphaMap: oval ? T.sombraOval : T.sombraRet, transparent: true, opacity: 0.55, depthWrite: false
  }));
  sombra.position.set(0, -L * 0.3, 0.0015);
  sombra.renderOrder = -1;
  g.add(sombra);

  for (const o of g.children) if (o !== sombra && o !== vidro) o.castShadow = false;
  return { grupo: g, foto, vidro, sombra, profundidade: D, L };
}
