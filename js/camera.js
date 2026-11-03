// Quadros Vivos — modo simples: câmera comum do navegador, sem ARCore.
// Funciona em qualquer celular: a folha precisa ficar à vista, e a parede acompanha a folha.
// Os quadros ficam no mesmo plano da folha, então a projeção sai certa mesmo sem conhecer
// a lente exata (a homografia da folha já leva a lente embutida).
import * as THREE from 'three';
import * as MK from './marcador.js';

const LADO_LEITURA = 960;
const FOCO_PADRAO = 0.72; // foco típico da câmera traseira, em frações do lado maior do vídeo

export class SessaoCamera {
  constructor({ renderer, cena, parede, ui, marcador }) {
    Object.assign(this, { renderer, cena, parede, ui, mk: marcador });
    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = false;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.pos = new THREE.Vector3();
    this.rot = new THREE.Quaternion();
    this.alvoPos = new THREE.Vector3();
    this.alvoRot = new THREE.Quaternion();
    this.estado = 'parada';
  }

  async iniciar(stream) {
    if (!stream) {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não libera a câmera.');
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
    }
    this.stream = stream;
    const v = document.createElement('video');
    v.className = 'video-fundo';
    v.muted = true; v.playsInline = true; v.setAttribute('playsinline', '');
    v.srcObject = stream;
    document.body.prepend(v);
    this.video = v;
    await v.play();
    if (!v.videoWidth) await new Promise((ok) => v.addEventListener('loadedmetadata', ok, { once: true }));
    document.body.classList.add('modo-camera');
    this.worker = new Worker(new URL('./detector-worker.js', import.meta.url));
    this.worker.onmessage = (m) => this._resultado(m.data);
    this.ocupado = false;
    this.parede.grupo.matrixAutoUpdate = false;
    if (!this.parede.grupo.parent) this.cena.add(this.parede.grupo);
    this.renderer.setClearColor(0x000000, 0);
    this.procurar();
    let anterior = performance.now();
    this.renderer.setAnimationLoop(() => {
      const agora = performance.now();
      const dt = Math.min(0.1, (agora - anterior) / 1000); anterior = agora;
      this._quadro(dt, agora);
    });
  }

  procurar() {
    this.estado = 'procurando';
    this.visto = 0;
    this.parede.grupo.visible = false;
    this.parede.esconder();
    this.ui.procurando('camera');
  }

  encerrar() {
    this.estado = 'parada';
    this.renderer.setAnimationLoop(null);
    if (this.worker) this.worker.terminate();
    this.worker = null;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.video) this.video.remove();
    document.body.classList.remove('modo-camera');
    this.parede.silenciar();
    for (const v of this.parede.videos) v.pause();
    this.ui.fim();
  }

  // projeção que casa com o vídeo exibido em "cover" na tela
  _projecao() {
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    const el = this.renderer.domElement, sw = el.clientWidth || innerWidth, sh = el.clientHeight || innerHeight;
    const s = Math.max(sw / vw, sh / vh);
    const f = FOCO_PADRAO * Math.max(vw, vh);
    const n = 0.02, fa = 60;
    this.camera.projectionMatrix.set(
      (2 * f * s) / sw, 0, 0, 0,
      0, (2 * f * s) / sh, 0, 0,
      0, 0, -(fa + n) / (fa - n), (-2 * fa * n) / (fa - n),
      0, 0, -1, 0);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    return f;
  }

  _quadro(dt, agora) {
    const f = this._projecao();
    this._ler(f);
    const g = this.parede.grupo;
    if (this.estado === 'colocada') {
      const k = 1 - Math.exp(-dt * 14);
      this.pos.lerp(this.alvoPos, k);
      this.rot.slerp(this.alvoRot, k);
      g.matrix.compose(this.pos, this.rot, new THREE.Vector3(1, 1, 1));
      g.matrixWorldNeedsUpdate = true;
      const sumida = agora - this.visto;
      if (sumida > 900 && !this.avisou) { this.avisou = true; this.ui.toast('Mantenha a folha à vista na tela.'); }
      if (sumida > 3500) this.procurar();
    }
    this.parede.atualizar(dt, this.camera);
    this.renderer.render(this.cena, this.camera);
  }

  _ler(f) {
    if (this.ocupado || this.estado === 'parada') return;
    const v = this.video;
    const esc = Math.min(1, LADO_LEITURA / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * esc), h = Math.round(v.videoHeight * esc);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.ctx.drawImage(v, 0, 0, w, h);
    const img = this.ctx.getImageData(0, 0, w, h);
    const fe = f * esc;
    const P = new Array(16).fill(0);
    P[0] = (2 * fe) / w; P[5] = (2 * fe) / h; // matriz no formato do marcador.js (centro óptico no meio)
    this.ocupado = true;
    this.worker.postMessage({ w, h, buf: img.data.buffer, id: this.mk.id, ctx: { P } }, [img.data.buffer]);
  }

  _resultado(d) {
    this.ocupado = false;
    if (this.estado === 'parada' || !d.cantos) return;
    const cantos = MK.refinarCantos(d.cantos, new Uint8Array(d.buf), d.w, d.h);
    const pv = MK.poseNaVista(cantos, d.w, d.h, d.ctx.P, this.mk.lado);
    if (!pv || pv.erro > 3) return;
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...pv.direita), new THREE.Vector3(...pv.cima), new THREE.Vector3(...pv.normal));
    this.alvoRot.setFromRotationMatrix(m);
    this.alvoPos.set(...pv.centro);
    this.visto = performance.now();
    this.avisou = false;
    if (this.estado === 'procurando') {
      this.pos.copy(this.alvoPos); this.rot.copy(this.alvoRot);
      this.estado = 'colocada';
      this.parede.grupo.visible = true;
      this.parede.aparecer();
      if (navigator.vibrate) navigator.vibrate(40);
      this.ui.colocada('camera');
    }
  }

  // toque na tela: liga o som do quadro com vídeo
  tocar(x, y) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(x, y), this.camera);
    return this.parede.tocar(rc);
  }
}
