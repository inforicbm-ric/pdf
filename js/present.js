// present.js — janela de apresentação (fica na tela estendida)

const sync = new SyncBus();

const state = {
  pdf: null,
  scale: 1.2,
  viewMode: 'single',
  fitMode: 'page', // 'page' | 'width' | null (manual)
  transition: 'fade', // 'fade' | 'instant'
  scrollFrac: { x: 0, y: 0 },
  pageStrokes: new Map(),   // pageNum -> [stroke,...]
  liveStrokes: new Map(),   // strokeId -> stroke em desenho ativo
};

const stage = document.getElementById('present-stage');
const overlay = document.getElementById('start-overlay');
const overlayText = document.getElementById('overlay-text');

const slots = [
  {
    root: document.getElementById('present-slot-left'),
    pdfCanvas: document.getElementById('present-pdf-canvas'),
    drawCanvas: document.getElementById('present-draw-canvas'),
  },
  {
    root: document.getElementById('present-slot-right'),
    pdfCanvas: document.getElementById('present-pdf-canvas-2'),
    drawCanvas: document.getElementById('present-draw-canvas-2'),
  },
];
slots.forEach((s) => {
  s.ctxPdf = s.pdfCanvas.getContext('2d');
  s.ctxDraw = s.drawCanvas.getContext('2d');
  s.pageNum = null;
});

let fitScales = null; // { scaleX, scaleY } calculado 1x por página(s)/resize, usando o tamanho REAL desta tela
let hasPdfLoaded = false;
let renderGeneration = 0; // detecta chamadas de renderPage() atropeladas por uma mais nova
let navGeneration = 0; // detecta mensagens 'state' atropeladas por uma mais nova (cliques rápidos)

// Trava de segurança: canvases muito grandes (em pixels) corrompem ou travam
// no Chrome. Nunca deixa nenhum lado passar disso, não importa o zoom pedido.
const MAX_CANVAS_DIM = 8000;

function safeViewport(page, scale) {
  let viewport = page.getViewport({ scale });
  const biggest = Math.max(viewport.width, viewport.height);
  if (biggest > MAX_CANVAS_DIM) {
    viewport = page.getViewport({ scale: scale * (MAX_CANVAS_DIM / biggest) });
  }
  return viewport;
}

async function enterFullscreen() {
  try {
    await document.documentElement.requestFullscreen();
  } catch (err) {
    console.warn('Fullscreen indisponível (provavelmente precisa de um clique real nesta janela):', err);
  }
}

// A revelação do conteúdo só acontece quando o navegador CONFIRMA que a tela
// cheia foi ativada — nunca "no escuro". Se falhar, o aviso continua visível
// e clicável para tentar de novo.
document.addEventListener('fullscreenchange', () => {
  const active = !!document.fullscreenElement;
  if (active) {
    overlay.classList.add('hidden');
    stage.classList.remove('hidden');
  } else {
    overlay.classList.remove('hidden');
    stage.classList.add('hidden');
  }
  sync.send('fullscreen-state', { active });
});

// Clique em qualquer lugar do aviso tenta iniciar a tela cheia — esse é o
// caminho confiável (exigido pelo navegador: precisa de um clique real
// dentro desta janela).
overlay.addEventListener('click', enterFullscreen);
window.enterFullscreen = enterFullscreen; // tentativa best-effort vinda do controle (nem sempre funciona, ver acima)

sync.send('present-ready');
window.addEventListener('beforeunload', () => sync.send('present-closed'));

async function ensurePdfLoaded() {
  const record = await PdfDB.loadPdfBuffer();
  if (!record) return false;
  state.pdf = await pdfjsLib.getDocument({ data: record.data.slice(0) }).promise;
  markPdfLoaded();
  return true;
}

function strokesFor(pageNum) {
  if (!state.pageStrokes.has(pageNum)) state.pageStrokes.set(pageNum, []);
  return state.pageStrokes.get(pageNum);
}

async function computeFitScales(pages) {
  // Soma a largura natural de todas as páginas visíveis (+ o gap entre elas)
  // e usa o tamanho REAL desta janela (window.innerWidth/innerHeight) —
  // nunca o tamanho da pré-visualização do controle.
  const gap = pages.length > 1 ? 10 : 0;
  let totalW = 0, maxH = 0;
  for (const pNum of pages) {
    const page = await state.pdf.getPage(pNum);
    const natural = page.getViewport({ scale: 1 });
    totalW += natural.width;
    maxH = Math.max(maxH, natural.height);
  }
  totalW += gap;
  return {
    scaleX: window.innerWidth / totalW,
    scaleY: window.innerHeight / maxH,
  };
}

async function renderPage() {
  if (!state.pdf) return;
  const myGeneration = ++renderGeneration;
  const pages = state.pages && state.pages.length ? state.pages : [1];

  if (fitScales === null) {
    fitScales = await computeFitScales(pages);
  }
  if (myGeneration !== renderGeneration) return;

  let effectiveScale;
  if (state.fitMode === 'width') {
    // Encosta nas laterais (esquerda/direita) da tela; pode cortar topo/rodapé.
    effectiveScale = fitScales.scaleX;
  } else if (state.fitMode === 'page') {
    // Página inteira visível, encostando no topo+rodapé OU nas laterais
    // (o que for mais restritivo) — nunca corta nada.
    effectiveScale = Math.min(fitScales.scaleX, fitScales.scaleY);
  } else {
    // Zoom manual (+/-): usa o percentual relativo ao "ajustar página" que o
    // controle já calculou para si mesmo — assim os dois lados concordam
    // sobre o que é "100%" e não há salto ao trocar de Ajustar Página p/ +/-.
    const baseFit = Math.min(fitScales.scaleX, fitScales.scaleY);
    effectiveScale = baseFit * ((state.zoomPercent ?? 100) / 100);
  }

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const pNum = pages[i];
    if (pNum === undefined) {
      slot.root.classList.add('hidden');
      slot.pageNum = null;
      continue;
    }
    slot.root.classList.remove('hidden');
    slot.pageNum = pNum;
    const page = await state.pdf.getPage(pNum);
    if (myGeneration !== renderGeneration) return;

    const viewport = safeViewport(page, effectiveScale);
    slot.pdfCanvas.width = slot.drawCanvas.width = viewport.width;
    slot.pdfCanvas.height = slot.drawCanvas.height = viewport.height;

    // Cancela qualquer desenho anterior ainda em andamento nesse mesmo slot
    // antes de começar um novo — evita dois desenhos disputando o mesmo canvas.
    if (slot.renderTask) {
      try { slot.renderTask.cancel(); } catch (e) { /* ignora */ }
    }
    slot.renderTask = page.render({ canvasContext: slot.ctxPdf, viewport });
    try {
      await slot.renderTask.promise;
    } catch (err) {
      if (err && err.name === 'RenderingCancelledException') return; // uma chamada mais nova assumiu, tudo certo
      throw err;
    }
    if (myGeneration !== renderGeneration) return;
    redrawSlot(slot);
  }

  applyStagePosition();
}

function redrawSlot(slot) {
  slot.ctxDraw.clearRect(0, 0, slot.drawCanvas.width, slot.drawCanvas.height);
  if (slot.pageNum == null) return;
  for (const s of strokesFor(slot.pageNum)) drawStroke(slot.ctxDraw, s, slot.drawCanvas.width, slot.drawCanvas.height);
  for (const s of state.liveStrokes.values()) {
    if (s.page === slot.pageNum) drawStroke(slot.ctxDraw, s, slot.drawCanvas.width, slot.drawCanvas.height);
  }
}

const FADE_MS = 180; // precisa bater com a duração no CSS

function fadeOutSlots() {
  if (state.transition !== 'fade') return Promise.resolve();
  const visibleSlots = slots.filter((s) => s.pageNum != null);
  if (!visibleSlots.length) return Promise.resolve();
  visibleSlots.forEach((slot) => {
    slot.root.classList.remove('fade-transition');
    void slot.root.offsetWidth; // força reflow para reiniciar a animação
    slot.root.classList.add('fade-out');
  });
  return new Promise((resolve) => setTimeout(resolve, FADE_MS));
}

function applyPageChangeFade() {
  if (state.transition !== 'fade') return;
  slots.forEach((slot) => {
    if (slot.pageNum == null) return;
    slot.root.classList.remove('fade-out');
    slot.root.classList.remove('fade-transition');
    void slot.root.offsetWidth; // força reflow para reiniciar a animação
    slot.root.classList.add('fade-transition');
  });
}

function drawStroke(ctx, item, w, h) {
  ctx.save();
  if (item.kind === 'highlight-rect') {
    ctx.globalAlpha = 0.35;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = item.color;
    item.rects.forEach((r) => ctx.fillRect(r.x * w, r.y * h, r.w * w, r.h * h));
  } else {
    if (!item.points.length) { ctx.restore(); return; }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = item.color;
    ctx.lineWidth = item.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    item.points.forEach((p, i) => {
      const x = p.x * w, y = p.y * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.restore();
}

// Posiciona o palco de acordo com a rolagem da janela de controle.
// Se cabe inteiro, fica centralizado; se está maior que a tela (zoom > 100%),
// acompanha a rolagem, cortando as bordas igual uma rolagem de verdade.
function computeOffset(contentSize, viewportSize, frac) {
  if (contentSize <= viewportSize) return (viewportSize - contentSize) / 2;
  const maxScroll = contentSize - viewportSize;
  return -(frac * maxScroll);
}

function applyStagePosition() {
  const visibleSlots = slots.filter((s) => s.pageNum != null);
  const totalW = visibleSlots.reduce((sum, s) => sum + s.pdfCanvas.width, 0) + (visibleSlots.length - 1) * 10;
  const maxH = Math.max(...visibleSlots.map((s) => s.pdfCanvas.height), 0);
  stage.style.left = computeOffset(totalW, window.innerWidth, state.scrollFrac.x) + 'px';
  stage.style.top = computeOffset(maxH, window.innerHeight, state.scrollFrac.y) + 'px';
}

function markPdfLoaded() {
  if (hasPdfLoaded) return;
  hasPdfLoaded = true;
  overlayText.textContent = 'PDF pronto — clique aqui para entrar em tela cheia';
}

window.addEventListener('resize', async () => {
  fitScales = null;
  if (state.pdf) await renderPage();
});

sync.on(async (msg) => {
  switch (msg.type) {
    case 'pdf-closed':
    case 'control-unloading': {
      slots.forEach((slot) => {
        slot.root.classList.add('hidden');
        slot.pageNum = null;
        slot.ctxPdf.clearRect(0, 0, slot.pdfCanvas.width, slot.pdfCanvas.height);
        slot.ctxDraw.clearRect(0, 0, slot.drawCanvas.width, slot.drawCanvas.height);
      });
      state.pdf = null;
      state.pageStrokes.clear();
      state.liveStrokes.clear();
      fitScales = null;
      hasPdfLoaded = false;
      overlayText.textContent = 'Aguardando PDF';
      overlay.classList.remove('hidden');
      stage.classList.add('hidden');
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      break;
    }
    case 'load': {
      const ok = await ensurePdfLoaded();
      fitScales = null;
      if (ok && state.pages) await renderPage();
      break;
    }
    case 'state': {
      const myNav = ++navGeneration;
      const viewModeChanged = state.viewMode !== msg.viewMode;
      state.transition = msg.transition; // precisa estar atualizado ANTES do fade-out (usa state.transition)
      if (msg.pageChanged) await fadeOutSlots();
      if (myNav !== navGeneration) return; // uma mensagem mais nova já assumiu
      state.scale = msg.scale;
      state.zoomPercent = msg.zoomPercent;
      state.viewMode = msg.viewMode;
      state.fitMode = msg.fitMode;
      state.pages = msg.pages;
      state.scrollFrac = { x: msg.scrollX, y: msg.scrollY };
      Object.entries(msg.strokesByPage || {}).forEach(([p, strokes]) => state.pageStrokes.set(Number(p), strokes));
      state.liveStrokes.clear();
      if (viewModeChanged) fitScales = null;
      if (!state.pdf) await ensurePdfLoaded();
      await renderPage();
      if (myNav !== navGeneration) return;
      if (msg.pageChanged) applyPageChangeFade();
      break;
    }
    case 'transition': {
      state.transition = msg.mode;
      break;
    }
    case 'blank-screen': {
      const blankEl = document.getElementById('present-blank');
      if (msg.mode === 'off') {
        blankEl.classList.add('hidden');
      } else {
        blankEl.style.background = msg.mode === 'black' ? '#000' : '#fff';
        blankEl.textContent = msg.mode === 'black' ? 'B' : 'W';
        blankEl.style.color = msg.mode === 'black' ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)';
        blankEl.classList.remove('hidden');
      }
      break;
    }
    case 'laser': {
      const dot = document.getElementById('laser-dot');
      if (!msg.active) {
        dot.classList.add('hidden');
      } else {
        const activeSlot = slots.find((s) => s.pageNum === msg.page) || slots.find((s) => s.pageNum != null);
        if (!activeSlot) break;
        // Usa o getBoundingClientRect do canvas DESTA janela (tela estendida)
        // que já leva em conta a posição real do canvas no fullscreen.
        const rect = activeSlot.pdfCanvas.getBoundingClientRect();
        const px = rect.left + msg.fracX * rect.width;
        const py = rect.top + msg.fracY * rect.height;
        dot.classList.remove('hidden');
        dot.style.left = px + 'px';
        dot.style.top = py + 'px';
      }
      break;
    }
    case 'scroll': {
      state.scrollFrac = { x: msg.scrollX, y: msg.scrollY };
      applyStagePosition();
      break;
    }
    case 'stroke-point': {
      let stroke = state.liveStrokes.get(msg.strokeId);
      if (msg.isNew || !stroke) {
        stroke = { id: msg.strokeId, page: msg.page, kind: 'stroke', color: msg.color, size: msg.size, points: [] };
        state.liveStrokes.set(msg.strokeId, stroke);
      }
      stroke.points.push(msg.point);
      const slot = slots.find((s) => s.pageNum === msg.page);
      if (slot) redrawSlot(slot);
      break;
    }
    case 'set-page-strokes': {
      state.pageStrokes.set(msg.page, msg.strokes || []);
      const slot = slots.find((s) => s.pageNum === msg.page);
      if (slot) {
        state.liveStrokes.forEach((s, id) => { if (s.page === msg.page) state.liveStrokes.delete(id); });
        redrawSlot(slot);
      }
      break;
    }
    case 'sync-state': {
      state.scale = msg.scale;
      state.zoomPercent = msg.zoomPercent;
      state.viewMode = msg.viewMode;
      state.fitMode = msg.fitMode;
      state.transition = msg.transition;
      state.pages = msg.pages;
      state.scrollFrac = { x: msg.scrollX, y: msg.scrollY };
      Object.entries(msg.strokesByPage || {}).forEach(([p, strokes]) => state.pageStrokes.set(Number(p), strokes));
      if (msg.hasPdf) {
        fitScales = null;
        const ok = await ensurePdfLoaded();
        if (ok) await renderPage();
      }
      break;
    }
  }
});
