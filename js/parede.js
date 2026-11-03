// Quadros Vivos — a parede: carrega fotos e vídeos, monta as molduras e anima a chegada.
// O grupo tem a origem no centro da folha impressa: x para a direita, y para cima, z saindo da parede.
import * as THREE from 'three';
import { criarMoldura, tamanhoExterno } from './molduras.js';

const easeOutBack = (t) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const ease = (t) => t * t * (3 - 2 * t);
const limitar = (x, a, b) => Math.max(a, Math.min(b, x));

// foto que falta: um "retrato" vazio em tons de sépia com o número do quadro
function texturaVazia(q, i) {
  const asp = q.w / q.h;
  const c = document.createElement('canvas');
  c.width = asp >= 1 ? 512 : Math.round(512 * asp); c.height = asp >= 1 ? Math.round(512 / asp) : 512;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, c.width, c.height);
  const tons = [['#5a3d2a', '#c49a6c'], ['#3d2f3f', '#b48a78'], ['#2f3b35', '#a99a6e'], ['#4a2a2a', '#c7a07a']][i % 4];
  gr.addColorStop(0, tons[0]); gr.addColorStop(1, tons[1]);
  g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
  const rg = g.createRadialGradient(c.width / 2, c.height * 0.42, 10, c.width / 2, c.height * 0.42, Math.max(c.width, c.height) * 0.7);
  rg.addColorStop(0, 'rgba(255,240,210,.35)'); rg.addColorStop(1, 'rgba(0,0,0,.25)');
  g.fillStyle = rg; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(255,244,225,.85)';
  g.textAlign = 'center';
  const k = Math.min(c.width, c.height);
  g.font = `italic ${Math.round(k * 0.2)}px "Cormorant Garamond", Georgia, serif`;
  g.fillText(String(i + 1), c.width / 2, c.height * 0.52);
  g.font = `${Math.round(k * 0.055)}px Georgia, serif`;
  g.fillText('foto ou vídeo de vocês', c.width / 2, c.height * 0.66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { textura: t, mw: c.width, mh: c.height, tipo: 'vazio' };
}

function carregarFoto(url) {
  return new Promise((ok, falha) => {
    new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      ok({ textura: t, mw: t.image.width, mh: t.image.height, tipo: 'foto' });
    }, undefined, falha);
  });
}

function carregarVideo(url) {
  return new Promise((ok, falha) => {
    const v = document.createElement('video');
    v.src = url; v.crossOrigin = 'anonymous'; v.loop = true; v.muted = true; v.playsInline = true;
    v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.preload = 'auto';
    const pronto = () => {
      const t = new THREE.VideoTexture(v);
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
      ok({ textura: t, mw: v.videoWidth || 16, mh: v.videoHeight || 9, tipo: 'video', video: v });
    };
    v.addEventListener('loadedmetadata', pronto, { once: true });
    v.addEventListener('error', () => falha(new Error('vídeo ' + url)), { once: true });
    v.load();
  });
}

// "despertar" da foto: começa em sépia dourada e ganha cor
function materialDaFoto(textura) {
  const m = new THREE.MeshBasicMaterial({ map: textura, toneMapped: false, transparent: true, opacity: 0 });
  m.userData.revelar = { value: 0 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRevelar = m.userData.revelar;
    sh.fragmentShader = 'uniform float uRevelar;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float cinza = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      vec3 sepia = vec3(cinza) * vec3(1.12, 0.94, 0.68);
      diffuseColor.rgb = mix(sepia, diffuseColor.rgb, uRevelar);`);
  };
  return m;
}

export class Parede {
  constructor(layout) {
    this.layout = layout;
    this.grupo = new THREE.Group();
    this.grupo.matrixAutoUpdate = true;
    this.quadros = [];
    this.tempo = 0;
    this.inicio = -1;
    this.aoTocar = null;
    this._particulas();
    this._onda();
  }

  async carregar(aoProgresso) {
    const { quadros } = this.layout;
    let feitos = 0;
    const midias = await Promise.all(quadros.map(async (q, i) => {
      let m;
      try {
        if (!q.midia) m = texturaVazia(q, i);
        else if (/\.(mp4|webm|mov|m4v)$/i.test(q.midia)) m = await carregarVideo(q.midia);
        else m = await carregarFoto(q.midia);
      } catch (e) {
        console.warn('mídia não abriu', q.midia, e);
        m = texturaVazia(q, i);
      }
      feitos++;
      if (aoProgresso) aoProgresso(feitos / quadros.length);
      return m;
    }));
    this._montar(midias);
  }

  _montar(midias) {
    const mk = this.layout.marcador;
    this.layout.quadros.forEach((q, i) => {
      const md = midias[i];
      const mat = materialDaFoto(md.textura);
      const mold = criarMoldura(q, mat);
      const raiz = new THREE.Group();
      raiz.add(mold.grupo);
      raiz.position.set(q.x - mk.x, q.y - mk.y, 0);
      raiz.scale.setScalar(0.0001);
      raiz.visible = false;
      this.grupo.add(raiz);
      // recorte "cover" da mídia dentro da abertura, respeitando o ponto de foco
      const t = md.textura;
      const aM = md.mw / md.mh, aQ = q.w / q.h;
      const rep = aM > aQ ? [aQ / aM, 1] : [1, aM / aQ];
      const foco = q.foco || [0.5, 0.5];
      const base = { rep, off: [(1 - rep[0]) * foco[0], (1 - rep[1]) * (1 - foco[1])] };
      t.repeat.set(rep[0], rep[1]); t.offset.set(base.off[0], base.off[1]);
      const dist = Math.hypot(q.x - mk.x, q.y - mk.y);
      mold.foto.userData.quadro = i;
      this.quadros.push({ q, i, raiz, mold, mat, midia: md, base, dist, fase: Math.random() * 6.28, visto: false, tamanho: tamanhoExterno(q) });
    });
    // os de perto da folha aparecem primeiro
    const ord = [...this.quadros].sort((a, b) => a.dist - b.dist);
    ord.forEach((Q, k) => { Q.atraso = 0.35 + Q.dist * 0.55 + k * 0.05; });
  }

  get videos() { return this.quadros.filter((Q) => Q.midia.video).map((Q) => Q.midia.video); }

  // precisa ser chamado dentro de um toque (regra dos navegadores para vídeo)
  liberarVideos() {
    for (const v of this.videos) { const p = v.play(); if (p) p.catch(() => {}); }
  }

  // ---------- efeitos ----------
  _particulas() {
    const N = 900;
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(N * 3); this.pCor = new Float32Array(N * 3);
    this.pVel = new Float32Array(N * 3); this.pVida = new Float32Array(N); this.pMax = new Float32Array(N);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCor, 3));
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.25, 'rgba(255,230,170,.8)'); rg.addColorStop(1, 'rgba(255,200,90,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    const mat = new THREE.PointsMaterial({ size: 0.022, map: new THREE.CanvasTexture(c), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.pontos = new THREE.Points(geo, mat);
    this.pontos.frustumCulled = false;
    this.pProx = 0; this.pN = N;
    this.grupo.add(this.pontos);
  }

  _faisca(x, y, z, vx, vy, vz, vida) {
    const i = this.pProx; this.pProx = (this.pProx + 1) % this.pN;
    this.pPos.set([x, y, z], i * 3); this.pVel.set([vx, vy, vz], i * 3);
    this.pVida[i] = vida; this.pMax[i] = vida;
  }

  _explodir(Q) {
    const { W, H } = Q.tamanho;
    const cx = Q.raiz.position.x, cy = Q.raiz.position.y;
    const n = 70;
    for (let k = 0; k < n; k++) {
      // ao longo do contorno da moldura
      const u = Math.random() * 2 * (W + H);
      let x, y;
      if (u < W) { x = -W / 2 + u; y = H / 2; } else if (u < W + H) { x = W / 2; y = H / 2 - (u - W); }
      else if (u < 2 * W + H) { x = W / 2 - (u - W - H); y = -H / 2; } else { x = -W / 2; y = -H / 2 + (u - 2 * W - H); }
      const r = Math.hypot(x, y) || 1;
      const sp = 0.05 + Math.random() * 0.12;
      this._faisca(cx + x, cy + y, 0.03, (x / r) * sp, (y / r) * sp + 0.04, 0.02 + Math.random() * 0.06, 0.9 + Math.random() * 0.9);
    }
  }

  _onda() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { uRaio: { value: 0 }, uForca: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uRaio; uniform float uForca; varying vec2 vP;
        void main(){
          float d = length(vP);
          float anel = exp(-pow((d - uRaio) / 0.05, 2.0));
          float rastro = smoothstep(uRaio, 0.0, d) * 0.12 * smoothstep(0.0, 0.3, uRaio);
          float a = (anel + rastro) * uForca;
          gl_FragColor = vec4(vec3(1.0, 0.78, 0.38) * a, a);
        }`
    });
    this.onda = new THREE.Mesh(new THREE.PlaneGeometry(5, 4), mat);
    this.onda.position.z = 0.004;
    this.onda.visible = false;
    this.grupo.add(this.onda);
  }

  // ---------- ciclo ----------
  aparecer() {
    this.inicio = this.tempo;
    for (const Q of this.quadros) { Q.raiz.visible = false; Q.raiz.scale.setScalar(0.0001); Q.estourou = false; Q.mat.opacity = 0; Q.mat.transparent = true; Q.mat.needsUpdate = true; Q.mat.userData.revelar.value = 0; Q.mold.sombra.material.opacity = 0; }
    this.onda.visible = true;
  }

  esconder() {
    this.inicio = -1;
    for (const Q of this.quadros) Q.raiz.visible = false;
    this.onda.visible = false;
  }

  atualizar(dt, camera) {
    this.tempo += dt;
    const t = this.inicio >= 0 ? this.tempo - this.inicio : -1;
    if (t >= 0) {
      // onda dourada saindo da folha
      const ot = t / 2.2;
      this.onda.visible = ot < 1;
      this.onda.material.uniforms.uRaio.value = ease(Math.min(1, ot)) * 2.3;
      this.onda.material.uniforms.uForca.value = Math.sin(Math.min(1, ot) * Math.PI) * 1.2;
      for (const Q of this.quadros) {
        const lt = t - Q.atraso;
        if (lt < 0) continue;
        if (!Q.estourou) { Q.estourou = true; Q.raiz.visible = true; this._explodir(Q); }
        const a = Math.min(1, lt / 0.9);
        Q.raiz.scale.setScalar(Math.max(0.0001, easeOutBack(a)));
        Q.mold.sombra.material.opacity = 0.55 * ease(a);
        Q.mat.opacity = ease(Math.min(1, lt / 0.6));
        Q.mat.userData.revelar.value = ease(limitar((lt - 0.5) / 1.4, 0, 1));
        if (lt > 2 && Q.mat.transparent) { Q.mat.transparent = false; Q.mat.needsUpdate = true; }
      }
    }
    // fotos "respirando": aproximação lenta e deslize suave dentro do recorte
    for (const Q of this.quadros) {
      if (Q.midia.tipo === 'video' || !Q.raiz.visible) continue;
      const z = 1.05 + 0.045 * Math.sin(this.tempo * 0.37 + Q.fase);
      const [rx, ry] = Q.base.rep;
      const nx = rx / z, ny = ry / z;
      const px = 0.5 + 0.5 * Math.sin(this.tempo * 0.21 + Q.fase * 1.7), py = 0.5 + 0.5 * Math.cos(this.tempo * 0.17 + Q.fase);
      const tx = Q.midia.textura;
      tx.repeat.set(nx, ny);
      tx.offset.set(Q.base.off[0] + (rx - nx) * px, Q.base.off[1] + (ry - ny) * py);
    }
    // faíscas
    const g = this.pontos.geometry;
    for (let i = 0; i < this.pN; i++) {
      if (this.pVida[i] <= 0) { this.pCor[i * 3] = this.pCor[i * 3 + 1] = this.pCor[i * 3 + 2] = 0; continue; }
      this.pVida[i] -= dt;
      const k = i * 3;
      this.pVel[k + 1] -= 0.02 * dt;
      this.pPos[k] += this.pVel[k] * dt; this.pPos[k + 1] += this.pVel[k + 1] * dt; this.pPos[k + 2] += this.pVel[k + 2] * dt;
      const f = Math.max(0, this.pVida[i] / this.pMax[i]);
      const brilho = f * (0.6 + 0.4 * Math.sin(this.tempo * 25 + i));
      this.pCor[k] = brilho; this.pCor[k + 1] = brilho * 0.82; this.pCor[k + 2] = brilho * 0.5;
    }
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
    // vídeos só tocam quando o quadro está na tela (o celular decodifica poucos de cada vez)
    if (camera && (this._contaVis = (this._contaVis || 0) + 1) % 20 === 0) this._conferirVisiveis(camera);
  }

  _conferirVisiveis(camera) {
    camera.updateMatrixWorld();
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const esfera = new THREE.Sphere();
    for (const Q of this.quadros) {
      const v = Q.midia.video;
      if (!v) continue;
      Q.raiz.getWorldPosition(esfera.center);
      esfera.radius = Math.hypot(Q.tamanho.W, Q.tamanho.H) / 2 * this.grupo.scale.x;
      const ver = Q.raiz.visible && fr.intersectsSphere(esfera);
      if (ver && v.paused && this.videosLiberados !== false) { const p = v.play(); if (p) p.catch(() => {}); }
      else if (!ver && !v.paused && v.muted) v.pause();
    }
  }

  // toque num quadro: liga o som do vídeo (e desliga dos outros)
  tocar(raycaster) {
    const alvos = this.quadros.filter((Q) => Q.raiz.visible).map((Q) => Q.mold.foto);
    const hit = raycaster.intersectObjects(alvos, false)[0];
    if (!hit) return null;
    const Q = this.quadros[hit.object.userData.quadro];
    if (Q.midia.video) {
      const ligar = Q.midia.video.muted;
      for (const v of this.videos) v.muted = true;
      Q.midia.video.muted = !ligar;
      if (ligar) { Q.midia.video.currentTime = 0; Q.midia.video.play().catch(() => {}); }
      return { quadro: Q, som: ligar };
    }
    Q.fase += 1.3; // foto: dá uma "respirada" diferente
    this._explodir(Q);
    return { quadro: Q, som: null };
  }

  silenciar() { for (const v of this.videos) v.muted = true; }
}
