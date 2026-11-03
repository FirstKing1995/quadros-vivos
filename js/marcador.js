// Quadros Vivos — matemática do marcador impresso (sem dependências; roda no navegador e no Node).
// A folha tem um único marcador ArUco 4x4. Com os 4 cantos vistos pela câmera e a matriz de
// projeção da vista (WebXR), calcula onde está o centro da folha e para onde a parede aponta.

function normalizador(pts) {
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= pts.length; my /= pts.length;
  let d = 0;
  for (const p of pts) d += Math.hypot(p[0] - mx, p[1] - my);
  d = d / pts.length || 1;
  const s = Math.SQRT2 / d;
  return { s, mx, my, T: [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1] };
}

function resolver(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    if (Math.abs(A[i][i]) < 1e-14) return null;
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}

function mul3(a, b) {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-18) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };

// Homografia por DLT normalizada. src = folha (metros), dst = imagem (coordenadas normalizadas).
export function homografia(src, dst) {
  const ns = normalizador(src), nd = normalizador(dst);
  const ATA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const ATb = new Array(8).fill(0);
  for (let k = 0; k < src.length; k++) {
    const x = (src[k][0] - ns.mx) * ns.s, y = (src[k][1] - ns.my) * ns.s;
    const u = (dst[k][0] - nd.mx) * nd.s, v = (dst[k][1] - nd.my) * nd.s;
    for (const L of [[x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]]) {
      for (let i = 0; i < 8; i++) {
        ATb[i] += L[i] * L[8];
        for (let j = 0; j < 8; j++) ATA[i][j] += L[i] * L[j];
      }
    }
  }
  const h = resolver(ATA, ATb);
  if (!h) return null;
  const Hn = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  const ndi = inv3(nd.T);
  if (!ndi) return null;
  const H = mul3(mul3(ndi, Hn), ns.T);
  const s = H[8] || 1;
  return H.map((v) => v / s);
}

// Pose (câmera no padrão OpenCV: x direita, y para baixo, z para frente) com foco 1 e centro 0,
// porque a homografia já está em coordenadas normalizadas.
function poseDaHomografia(H) {
  let m1 = [H[0], H[3], H[6]], m2 = [H[1], H[4], H[7]], m3 = [H[2], H[5], H[8]];
  const l = 2 / (Math.hypot(...m1) + Math.hypot(...m2));
  let r1 = m1.map((v) => v * l), r2 = m2.map((v) => v * l), t = m3.map((v) => v * l);
  if (t[2] < 0) { r1 = r1.map((v) => -v); r2 = r2.map((v) => -v); t = t.map((v) => -v); }
  const c = [r1[0] + r2[0], r1[1] + r2[1], r1[2] + r2[2]];
  const dd = cruz(c, cruz(r1, r2));
  const nc = unit(c), nd = unit(dd);
  const a = nc.map((v, i) => (v + nd[i]) / Math.SQRT2);
  const b = nc.map((v, i) => (v - nd[i]) / Math.SQRT2);
  return { r1: a, r2: b, r3: cruz(a, b), t };
}

// Cantos do quadrado preto na folha, em metros, na ordem do js-aruco
// (superior-esquerdo, superior-direito, inferior-direito, inferior-esquerdo); y cresce para baixo.
export function cantosDaFolha(lado) {
  const h = lado / 2;
  return [[-h, -h], [h, -h], [h, h], [-h, h]];
}

// Pixel da imagem da câmera (origem no canto de cima) -> coordenada normalizada OpenCV,
// usando a matriz de projeção da vista (coluna maior, padrão WebGL).
export function normalizar(x, y, W, H, P) {
  const nx = (2 * x) / W - 1, ny = 1 - (2 * y) / H;
  return [(nx + P[8]) / P[0], -(ny + P[9]) / P[5]];
}

// Devolve a folha no espaço da vista (padrão WebGL: y para cima, câmera olhando para -z):
// centro, eixo da direita, eixo de cima e a normal que sai da parede (aponta para a câmera).
export function poseNaVista(cantos, W, H, P, lado) {
  const src = cantosDaFolha(lado);
  const dst = cantos.map((c) => normalizar(c.x, c.y, W, H, P));
  const Hm = homografia(src, dst);
  if (!Hm) return null;
  // erro de reprojeção em pixels
  let erro = 0;
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const w = Hm[6] * x + Hm[7] * y + Hm[8];
    const u = (Hm[0] * x + Hm[1] * y + Hm[2]) / w, v = (Hm[3] * x + Hm[4] * y + Hm[5]) / w;
    erro += Math.hypot((u - dst[i][0]) * P[0] * W / 2, (v - dst[i][1]) * P[5] * H / 2);
  }
  const p = poseDaHomografia(Hm);
  const gl = (v) => [v[0], -v[1], -v[2]];
  const ladoPx = Math.hypot(cantos[1].x - cantos[0].x, cantos[1].y - cantos[0].y);
  return {
    centro: gl(p.t),
    direita: gl(p.r1),
    cima: gl(p.r2).map((v) => -v),
    normal: gl(p.r3).map((v) => -v),
    erro: erro / 4,
    ladoPx
  };
}

// Refina os cantos do js-aruco (que vêm com precisão de pixel inteiro): procura a borda
// preto/branco de cada lado com precisão de fração de pixel, ajusta uma reta por lado e
// cruza as retas vizinhas. Em 1,5 m isso derruba o erro de direção de vários graus para menos de 1.
export function refinarCantos(cantos, rgba, W, H) {
  const lum = (x, y) => {
    if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) return NaN;
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
    const k = (y0 * W + x0) * 4;
    const a = rgba[k + 1], b = rgba[k + 5], c = rgba[k + W * 4 + 1], d = rgba[k + W * 4 + 5];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  let pts = cantos.map((c) => [c.x, c.y]);
  for (let volta = 0; volta < 2; volta++) {
    const retas = [];
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 12) return cantos;
      const t = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const n = [-t[1], t[0]];
      const r = Math.max(1.5, Math.min(4, len * 0.06));
      const achados = [];
      for (let k = 0; k < 24; k++) {
        const u = 0.12 + (0.76 * k) / 23;
        const p = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
        let melhor = -1, sm = 0, g = [];
        for (let s = -r, j = 0; s <= r + 1e-9; s += 0.25, j++) {
          const v = Math.abs(lum(p[0] + (s + 0.5) * n[0], p[1] + (s + 0.5) * n[1]) - lum(p[0] + (s - 0.5) * n[0], p[1] + (s - 0.5) * n[1]));
          g.push(v);
          if (v > melhor) { melhor = v; sm = j; }
        }
        if (!(melhor > 25) || sm === 0 || sm === g.length - 1) continue;
        const den = g[sm - 1] - 2 * g[sm] + g[sm + 1];
        const off = den < 0 ? (0.5 * (g[sm - 1] - g[sm + 1])) / den : 0;
        const s = -r + (sm + off) * 0.25;
        achados.push([p[0] + s * n[0], p[1] + s * n[1]]);
      }
      if (achados.length < 8) return cantos;
      // reta pelos pontos (direção principal)
      let mx = 0, my = 0;
      for (const q of achados) { mx += q[0]; my += q[1]; }
      mx /= achados.length; my /= achados.length;
      let sxx = 0, sxy = 0, syy = 0;
      for (const q of achados) { const dx = q[0] - mx, dy = q[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      retas.push({ p: [mx, my], d: [Math.cos(ang), Math.sin(ang)] });
    }
    const novos = [];
    for (let i = 0; i < 4; i++) {
      const A = retas[(i + 3) % 4], B = retas[i]; // canto i fica entre o lado anterior e o seu
      const det = A.d[0] * -B.d[1] + B.d[0] * A.d[1];
      if (Math.abs(det) < 1e-6) return cantos;
      const dx = B.p[0] - A.p[0], dy = B.p[1] - A.p[1];
      const s = (dx * -B.d[1] + B.d[0] * dy) / det;
      novos.push([A.p[0] + s * A.d[0], A.p[1] + s * A.d[1]]);
    }
    for (let i = 0; i < 4; i++) if (Math.hypot(novos[i][0] - cantos[i].x, novos[i][1] - cantos[i].y) > 6) return cantos;
    pts = novos;
  }
  return pts.map((p) => ({ x: p[0], y: p[1] }));
}

// Aplica uma matriz 4x4 (coluna maior) a um ponto ou a uma direção.
export function aplicar(M, v, w = 1) {
  return [
    M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12] * w,
    M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13] * w,
    M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14] * w
  ];
}

// Folha vista -> parede no mundo. Paredes são verticais: só aproveita a direção horizontal da
// normal (o ARCore já sabe onde é "para cima"), o que tira quase todo o tremor de inclinação.
export function paredeNoMundo(poseVista, matrizVista) {
  const centro = aplicar(matrizVista, poseVista.centro, 1);
  const n = aplicar(matrizVista, poseVista.normal, 0);
  const h = Math.hypot(n[0], n[2]);
  if (h < 0.5) return null; // folha deitada: não é parede
  const fora = [n[0] / h, 0, n[2] / h];
  return { centro, fora, inclinacao: Math.acos(Math.min(1, h)) };
}

// Junta várias leituras: mediana da posição e média da direção, descartando as que destoam.
export function combinarLeituras(lista) {
  if (!lista.length) return null;
  const med = (k) => { const a = lista.map((l) => l.centro[k]).sort((x, y) => x - y); return a[a.length >> 1]; };
  const c = [med(0), med(1), med(2)];
  const boas = lista.filter((l) => Math.hypot(l.centro[0] - c[0], l.centro[1] - c[1], l.centro[2] - c[2]) < 0.05);
  if (!boas.length) return null;
  const centro = [0, 0, 0], f = [0, 0, 0];
  for (const l of boas) for (let k = 0; k < 3; k++) { centro[k] += l.centro[k] / boas.length; f[k] += l.fora[k]; }
  const fora = unit(f);
  let espalho = 0;
  for (const l of boas) espalho = Math.max(espalho, Math.hypot(l.centro[0] - centro[0], l.centro[1] - centro[1], l.centro[2] - centro[2]));
  return { centro, fora, n: boas.length, espalho };
}

// Base da parede: x para a direita, y para cima, z saindo da parede.
export function baseDaParede(fora) {
  const cima = [0, 1, 0];
  const direita = unit(cruz(cima, fora));
  return { direita, cima, fora };
}
