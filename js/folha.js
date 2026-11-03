// Quadros Vivos — desenho da folha impressa (marcador ArUco 4x4, dicionário ARUCO_4X4_1000).
// Os bits vêm do dicionário do js-aruco2 (vendor/aruco_4x4_1000.js); 1 = casa branca.
export const BITS = { 23: '1101110110000010' };

// SVG do marcador com o lado do quadrado preto em milímetros
export function marcadorSVG(id, ladoMM) {
  const bits = BITS[id];
  let r = '';
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (bits[y * 4 + x] === '1') r += `<rect x="${x + 1}" y="${y + 1}" width="1.01" height="1.01" fill="#fff"/>`;
  return `<svg viewBox="0 0 6 6" width="${ladoMM}mm" height="${ladoMM}mm" shape-rendering="crispEdges"><rect width="6" height="6" fill="#000"/>${r}</svg>`;
}

// folha A4 desenhada num canvas (usada na prévia 3D)
export function desenharFolha(g, W, H, mk) {
  const mm = W / 210;
  g.fillStyle = '#fbfaf7'; g.fillRect(0, 0, W, H);
  const lado = mk.lado * 1000 * mm, cel = lado / 6;
  const x0 = W / 2 - lado / 2, y0 = H / 2 - lado / 2;
  g.fillStyle = '#111'; g.fillRect(x0, y0, lado, lado);
  g.fillStyle = '#fbfaf7';
  const bits = BITS[mk.id] || BITS[23];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (bits[y * 4 + x] === '1') g.fillRect(x0 + (x + 1) * cel, y0 + (y + 1) * cel, cel + 0.5, cel + 0.5);
  g.fillStyle = '#7a6440';
  g.font = `italic ${Math.round(9 * mm)}px Georgia, serif`;
  g.textAlign = 'center';
  g.fillText('Quadros Vivos', W / 2, y0 - 14 * mm);
}
