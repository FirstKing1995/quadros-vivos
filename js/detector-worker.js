// Quadros Vivos — procura o marcador da folha fora da tela principal.
importScripts('../vendor/cv.js', '../vendor/aruco.js', '../vendor/aruco_4x4_1000.js');
var detector = new self.AR.Detector({ dictionaryName: 'ARUCO_4X4_1000' });

self.onmessage = function (m) {
  var d = m.data;
  var t0 = performance.now();
  var achado = null;
  try {
    var lista = detector.detectImage(d.w, d.h, new Uint8ClampedArray(d.buf));
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === d.id) { achado = lista[i].corners.map(function (c) { return { x: c.x, y: c.y }; }); break; }
    }
  } catch (e) { /* quadro ruim: ignora */ }
  self.postMessage({ cantos: achado, ms: performance.now() - t0, buf: d.buf, w: d.w, h: d.h, ctx: d.ctx }, [d.buf]);
};
