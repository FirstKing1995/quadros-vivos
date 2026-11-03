// Quadros Vivos — sessão de realidade aumentada (WebXR + ARCore no Chrome do Android).
// 1. Lê a imagem da câmera do próprio ARCore (recurso camera-access), procura a folha e
//    calcula onde a parede está no mundo. Junta várias leituras antes de colocar os quadros.
// 2. Prende a parede numa âncora do ARCore: ela fica no lugar mesmo quando a folha sai da tela.
// 3. Enquanto a folha aparece de perto, continua lendo e faz ajustes finos.
// Sem camera-access, cai no modo de mira: aponta para o centro da folha e toca.
import * as THREE from 'three';
import * as MK from './marcador.js';

const LADO_LEITURA = 960;
const LEITURAS_PARA_COLOCAR = 8;

export async function arDisponivel() {
  try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch { return false; }
}

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export class SessaoAR {
  constructor({ renderer, cena, camera, parede, camada, ui, marcador }) {
    Object.assign(this, { renderer, cena, camera, parede, camada, ui, mk: marcador });
    this.estado = 'parada';
    this.leituras = [];
    this.flip = true;
    this.flipTravado = false;
    this.falhas = 0;
    this.ocupado = false;
    this.ultLeitura = 0;
    this.semImagem = 0;
    this.raycaster = new THREE.Raycaster();
    this._mA = new THREE.Matrix4();
    this.offset = new THREE.Matrix4();
    this.alvo = new THREE.Matrix4();
  }

  async iniciar() {
    const s = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local'],
      optionalFeatures: ['camera-access', 'hit-test', 'anchors', 'dom-overlay'],
      domOverlay: { root: this.camada }
    });
    this.sessao = s;
    this.renderer.xr.setReferenceSpaceType('local');
    await this.renderer.xr.setSession(s);
    this.ref = this.renderer.xr.getReferenceSpace();
    this.gl = this.renderer.getContext();
    const recursos = s.enabledFeatures; // pode não existir em Chrome antigo
    const pode = (f) => !recursos || recursos.includes(f);
    this.temCamera = pode('camera-access') && typeof XRWebGLBinding !== 'undefined';
    if (this.temCamera) {
      try { this.binding = new XRWebGLBinding(s, this.gl); } catch { this.temCamera = false; }
    }
    if (pode('hit-test')) {
      try {
        const viewer = await s.requestReferenceSpace('viewer');
        this.fonteHit = await s.requestHitTestSource({ space: viewer });
      } catch { this.fonteHit = null; }
    }
    this.worker = new Worker(new URL('./detector-worker.js', import.meta.url));
    this.worker.onmessage = (m) => this._resultado(m.data);
    s.addEventListener('select', (e) => this._selecionar(e));
    s.addEventListener('end', () => this._fim());

    this.parede.grupo.matrixAutoUpdate = false;
    if (!this.parede.grupo.parent) this.cena.add(this.parede.grupo);
    this._criarMira();
    this.procurar();
    this.renderer.setAnimationLoop((t, f) => this._quadro(t, f));
  }

  procurar() {
    this.estado = 'procurando';
    this.leituras = [];
    this.tInicio = performance.now();
    this.parede.grupo.visible = false;
    this.parede.esconder();
    if (this.ancora) { try { this.ancora.delete(); } catch { /* já foi */ } }
    this.ancora = null;
    this.ui.procurando(this.temCamera);
  }

  encerrar() { if (this.sessao) this.sessao.end().catch(() => {}); }

  // ---------- quadro a quadro ----------
  _quadro(t, frame) {
    const dt = Math.min(0.1, (t - (this.tAnt || t)) / 1000);
    this.tAnt = t;
    if (frame) {
      const pose = frame.getViewerPose(this.ref);
      if (pose) {
        this._lerCamera(pose.views[0], t);
        this._mira(frame);
      }
      this._ancorar(frame);
    }
    this.parede.atualizar(dt, this.renderer.xr.getCamera());
    this.renderer.render(this.cena, this.camera);
  }

  get permiteToque() {
    return this.estado === 'procurando' && (!this.temCamera || performance.now() - this.tInicio > 7000);
  }

  // ---------- leitura da folha pela câmera do ARCore ----------
  _prepararCopia(w, h) {
    const gl = this.gl;
    if (!this.prog) {
      const sh = (tipo, src) => { const s = gl.createShader(tipo); gl.shaderSource(s, src); gl.compileShader(s); return s; };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; uniform float flip; void main(){ uv = vec2(p.x * 0.5 + 0.5, flip > 0.5 ? 0.5 - p.y * 0.5 : 0.5 + p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }'));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, 'precision mediump float; uniform sampler2D t; varying vec2 uv; void main(){ gl_FragColor = texture2D(t, uv); }'));
      gl.linkProgram(p);
      this.prog = p;
      this.aP = gl.getAttribLocation(p, 'p');
      this.uT = gl.getUniformLocation(p, 't');
      this.uFlip = gl.getUniformLocation(p, 'flip');
      this.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    }
    if (this.fw !== w || this.fh !== h) {
      if (this.fbo) { gl.deleteFramebuffer(this.fbo); gl.deleteTexture(this.ftex); }
      this.ftex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.ftex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      this.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.ftex, 0);
      this.fw = w; this.fh = h;
    }
  }

  _lerCamera(view, t) {
    if (!this.temCamera || this.ocupado || this.estado === 'parada') return;
    const intervalo = this.estado === 'procurando' ? 80 : 400;
    if (t - this.ultLeitura < intervalo) return;
    if (!view.camera) {
      if (++this.semImagem > 90) { this.temCamera = false; this.ui.procurando(false); }
      return;
    }
    this.ultLeitura = t;
    const gl = this.gl;
    let tex;
    try { tex = this.binding.getCameraImage(view.camera); } catch { tex = null; }
    if (!tex) return;
    const cw = view.camera.width, ch = view.camera.height;
    const esc = Math.min(1, LADO_LEITURA / Math.max(cw, ch));
    const w = Math.round(cw * esc), h = Math.round(ch * esc);
    this._prepararCopia(w, h);
    if (gl.bindVertexArray) gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
    for (const c of [gl.BLEND, gl.DEPTH_TEST, gl.SCISSOR_TEST, gl.CULL_FACE, gl.STENCIL_TEST]) gl.disable(c);
    gl.colorMask(true, true, true, true);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.uT, 0);
    gl.uniform1f(this.uFlip, this.flip ? 1 : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(this.aP);
    gl.vertexAttribPointer(this.aP, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.disableVertexAttribArray(this.aP);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.renderer.resetState();
    this.ocupado = true;
    this.worker.postMessage({
      w, h, buf: buf.buffer, id: this.mk.id,
      ctx: { M: Array.from(view.transform.matrix), P: Array.from(view.projectionMatrix), flip: this.flip }
    }, [buf.buffer]);
  }

  _resultado(d) {
    this.ocupado = false;
    if (this.estado === 'parada') return;
    if (!d.cantos) {
      this.falhas++;
      // a orientação da imagem da câmera muda entre aparelhos: alterna até achar a certa
      if (!this.flipTravado && this.falhas % 10 === 0) this.flip = !this.flip;
      if (this.estado === 'procurando' && this.falhas > 12) this.ui.progresso(0);
      return;
    }
    this.falhas = 0;
    if (!this.flipTravado) { this.flipTravado = true; this.flip = d.ctx.flip; }
    const cantos = MK.refinarCantos(d.cantos, new Uint8Array(d.buf), d.w, d.h);
    const pv = MK.poseNaVista(cantos, d.w, d.h, d.ctx.P, this.mk.lado);
    if (!pv || pv.erro > 2.5) return;
    if (pv.ladoPx < 70) { if (this.estado === 'procurando') this.ui.dica('Chegue mais perto: a folha precisa ocupar o círculo.'); return; }
    const pm = MK.paredeNoMundo(pv, d.ctx.M);
    if (!pm || pm.inclinacao > 0.4) { if (this.estado === 'procurando') this.ui.dica('A folha precisa estar presa na parede, de pé.'); return; }
    const agora = performance.now();
    this.leituras.push({ ...pm, t: agora });
    this.leituras = this.leituras.filter((l) => agora - l.t < 2500).slice(-16);
    if (this.estado === 'procurando') {
      this.ui.progresso(Math.min(1, this.leituras.length / LEITURAS_PARA_COLOCAR));
      this.ui.dica('Segure firme por um instante...');
      if (this.leituras.length >= LEITURAS_PARA_COLOCAR) {
        const c = MK.combinarLeituras(this.leituras);
        if (c && c.n >= LEITURAS_PARA_COLOCAR - 1 && c.espalho < 0.03) this._colocar(c.centro, c.fora, 'folha');
      }
    } else if (this.leituras.length >= 6) {
      const c = MK.combinarLeituras(this.leituras);
      if (c && c.n >= 5 && c.espalho < 0.02) this._ajustar(c);
    }
  }

  // ---------- colocação ----------
  _matrizDaParede(centro, fora) {
    const b = MK.baseDaParede(fora);
    return new THREE.Matrix4().makeBasis(V(b.direita), V(b.cima), V(b.fora)).setPosition(centro[0], centro[1], centro[2]);
  }

  _colocar(centro, fora, origem) {
    this.alvo.copy(this._matrizDaParede(centro, fora));
    this.origem = origem;
    this.estado = 'colocada';
    this.leituras = [];
    const g = this.parede.grupo;
    g.matrix.copy(this.alvo);
    g.matrixWorldNeedsUpdate = true;
    g.visible = true;
    this.parede.aparecer();
    this.ancoraPendente = true;
    if (this.mira) this.mira.visible = false;
    if (navigator.vibrate) navigator.vibrate(40);
    this.ui.colocada(origem);
  }

  _ajustar(c) {
    const novo = this._matrizDaParede(c.centro, c.fora);
    const g = this.parede.grupo;
    const pA = new THREE.Vector3().setFromMatrixPosition(g.matrix), pN = new THREE.Vector3().setFromMatrixPosition(novo);
    const fA = new THREE.Vector3().setFromMatrixColumn(g.matrix, 2), fN = new THREE.Vector3(c.fora[0], 0, c.fora[2]);
    const dist = pA.distanceTo(pN), ang = fA.angleTo(fN);
    let alvo;
    if (this.origem === 'toque' && dist < 1) { alvo = novo; this.origem = 'folha'; this.ui.toast('Folha encontrada: posição corrigida.'); }
    else if (dist < 0.15 && ang < 0.17) {
      const p = pA.lerp(pN, 0.35), f = fA.lerp(fN, 0.35).normalize();
      alvo = this._matrizDaParede([p.x, p.y, p.z], [f.x, f.y, f.z]);
    } else return;
    this.leituras = [];
    this.alvo.copy(alvo);
    if (this.ancora && this.mAncora) this.offset.copy(this.mAncora).invert().multiply(alvo);
    else { g.matrix.copy(alvo); g.matrixWorldNeedsUpdate = true; }
  }

  _ancorar(frame) {
    if (this.ancoraPendente && this.estado === 'colocada' && typeof frame.createAnchor === 'function') {
      this.ancoraPendente = false;
      const pedido = this.alvo.clone();
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      pedido.decompose(p, q, s);
      frame.createAnchor(new XRRigidTransform({ x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z, w: q.w }), this.ref).then((a) => {
        if (this.estado !== 'colocada') { a.delete(); return; }
        if (this.ancora) { try { this.ancora.delete(); } catch { /* já foi */ } }
        this.ancora = a;
        this.mAncora = pedido.clone();
        this.offset.copy(pedido).invert().multiply(this.alvo);
      }).catch(() => { /* sem âncora: a parede fica no espaço local, que o ARCore já mantém */ });
    }
    if (this.ancora && frame.trackedAnchors && frame.trackedAnchors.has(this.ancora)) {
      const ap = frame.getPose(this.ancora.anchorSpace, this.ref);
      if (ap) {
        this._mA.fromArray(ap.transform.matrix);
        this.mAncora = this._mA.clone();
        const g = this.parede.grupo;
        g.matrix.multiplyMatrices(this._mA, this.offset);
        g.matrixWorldNeedsUpdate = true;
      }
    }
  }

  // ---------- modo de mira (sem camera-access) ----------
  _criarMira() {
    if (this.mira) return;
    const g = new THREE.Group();
    const anel = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.105, 48), new THREE.MeshBasicMaterial({ color: 0xf0cf86, transparent: true, opacity: 0.9, depthTest: false }));
    const ponto = new THREE.Mesh(new THREE.CircleGeometry(0.012, 24), anel.material);
    const linhas = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.21, 0.297)),new THREE.LineBasicMaterial({ color: 0xf0cf86, transparent: true, opacity: 0.6, depthTest: false }));
    g.add(anel, ponto, linhas);
    g.matrixAutoUpdate = false;
    g.visible = false;
    g.renderOrder = 10;
    this.mira = g;
    this.cena.add(g);
  }

  _mira(frame) {
    this.hit = null;
    if (!this.fonteHit || this.estado !== 'procurando') { if (this.mira) this.mira.visible = false; return; }
    const res = frame.getHitTestResults(this.fonteHit);
    if (res.length) {
      const p = res[0].getPose(this.ref);
      if (p) {
        const M = p.transform.matrix;
        const n = [M[4], M[5], M[6]];
        const h = Math.hypot(n[0], n[2]);
        if (h > 0.85) this.hit = { pos: [M[12], M[13], M[14]], fora: [n[0] / h, 0, n[2] / h] };
      }
    }
    const mostrar = !!this.hit && this.permiteToque;
    this.mira.visible = mostrar;
    if (mostrar) { this.mira.matrix.copy(this._matrizDaParede(this.hit.pos, this.hit.fora)); this.mira.matrixWorldNeedsUpdate = true; }
    this.ui.podeTocar(mostrar);
  }

  _selecionar(e) {
    if (this.estado === 'procurando') {
      if (this.hit && this.permiteToque) this._colocar(this.hit.pos, this.hit.fora, 'toque');
      return;
    }
    if (this.estado !== 'colocada') return;
    const pose = e.frame.getPose(e.inputSource.targetRaySpace, this.ref);
    if (!pose) return;
    const M = pose.transform.matrix;
    this.cena.updateMatrixWorld();
    this.raycaster.set(new THREE.Vector3(M[12], M[13], M[14]), new THREE.Vector3(-M[8], -M[9], -M[10]).normalize());
    const r = this.parede.tocar(this.raycaster);
    if (r) this.ui.toque(r);
  }

  _fim() {
    this.estado = 'parada';
    this.renderer.setAnimationLoop(null);
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.parede.silenciar();
    for (const v of this.parede.videos) v.pause();
    if (this.ancora) { try { this.ancora.delete(); } catch { /* já foi */ } }
    this.ancora = null;
    this.ui.fim();
  }
}
