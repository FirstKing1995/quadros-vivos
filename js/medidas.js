// Quadros Vivos — estilos de moldura e suas medidas (sem dependências: usado pela cena 3D e pelo editor).
export const ESTILOS = {
  classica: { nome: 'Dourada clássica', oval: false },
  oval: { nome: 'Oval dourada', oval: true },
  nogueira: { nome: 'Nogueira com ouro', oval: false },
  fina: { nome: 'Bronze fina', oval: false }
};

const COEF = { fina: [0.022, 0.02], oval: [0.045, 0.05], nogueira: [0.042, 0.05], classica: [0.05, 0.06] };

// largura da moldura (m) em função do tamanho da foto
export function larguraMoldura(estilo, w, h) {
  const [a, b] = COEF[estilo] || COEF.classica;
  return a + b * Math.min(w, h);
}

export function tamanhoExterno(q) {
  const L = larguraMoldura(q.estilo, q.w, q.h);
  return { W: q.w + 2 * L, H: q.h + 2 * L, L };
}

// tamanho da foto que dá um tamanho externo (W, H); proporcao = w/h para manter, se vier
export function internoDoExterno(estilo, W, H, proporcao) {
  const [a, b] = COEF[estilo] || COEF.classica;
  let w = W * 0.8, h = H * 0.8;
  for (let i = 0; i < 6; i++) {
    const L = a + b * Math.min(w, h);
    w = W - 2 * L; h = H - 2 * L;
    if (proporcao) { if (w / h > proporcao) w = h * proporcao; else h = w / proporcao; }
  }
  return { w: Math.max(0.06, w), h: Math.max(0.06, h) };
}
