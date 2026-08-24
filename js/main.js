// main.js — janela de controle (fica no seu notebook)

function reportLibStatus() {
  document.getElementById('lib-status').textContent = window.pdfjsLib
    ? 'PDF.js carregado ✔️'
    : '⚠️ PDF.js não encontrado em /lib. Veja o README para instalar offline.';
}
reportLibStatus();
window.addEventListener('pdfjs-ready', reportLibStatus);

const sync = new SyncBus();

const state = {
  pdf: null,
  fileName: '',
  pageNum: 1,
  numPages: 0,
  scale: 1.2,
  viewMode: 'single', // 'single' | 'double'
  fitMode: 'page',    // 'page' | 'width' | null (null = zoom manual)
  transition: 'fade', // 'fade' | 'instant'
  tool: 'select',
  color: '#ff3b30',
  size: 4,
  pageStrokes: new Map(),   // pageNum -> [stroke,...]
  redoStacks: new Map(),    // pageNum -> [stroke,...]
  drawing: false,
  currentStroke: null,
  currentHighlightRect: null,
  activeSlot: null,
  presentWindow: null,
  presentScreenSize: null, // { width, height } da tela estendida real, quando conectada
  zoomAreaActive: false,   // modo "Zoom de Área" ativo
  zoomAreaDrag: null,      // { slot, startX, startY, x, y } durante o arraste
};

// ---------- DOM ----------
const el = (id) => document.getElementById(id);
const fileInput = el('file-input');
const pageStage = el('page-stage');
const emptyState = el('empty-state');
const pageInput = el('page-input');
const pageTotal = el('page-total');
const zoomSelect = el('zoom-select');
const zoomSelectDefaultOption = zoomSelect.querySelector('option[value=""]');
const presentDot = el('present-dot');
const presentStatus = el('present-status');
const sidebarFile = el('sidebar-file');

// ---------- Blank Screen (tela preta/branca) ----------
let blankMode = 'off';   // 'off' | 'on'
let blankColor = 'black'; // 'black' | 'white'

el('btn-blank-screen').addEventListener('click', () => {
  blankMode = blankMode === 'off' ? 'on' : 'off';
  const btn = el('btn-blank-screen');
  const colorBtn = el('btn-blank-color');
  if (blankMode === 'off') {
    btn.textContent = '⏸ Pausar Tela';
    btn.classList.remove('active');
    colorBtn.classList.add('hidden');
    sync.send('blank-screen', { mode: 'off' });
  } else {
    btn.textContent = '▶ Retomar Tela';
    btn.classList.add('active');
    colorBtn.classList.remove('hidden');
    sync.send('blank-screen', { mode: blankColor });
  }
});

el('btn-blank-color').addEventListener('click', () => {
  blankColor = blankColor === 'black' ? 'white' : 'black';
  el('btn-blank-color').textContent = blankColor === 'black' ? '⬛' : '⬜';
  el('btn-blank-color').title = blankColor === 'black' ? 'Mudar para tela branca' : 'Mudar para tela preta';
  if (blankMode === 'on') sync.send('blank-screen', { mode: blankColor });
});

// ---------- Ponteiro Laser ----------
let laserActive = false;

// O botão laser funciona como toggle — clica pra ligar, clica de novo pra desligar.
// Não usamos mousedown/mouseup porque botões disabled bloqueiam esses eventos.
el('tool-laser').addEventListener('click', () => {
  laserActive = !laserActive;
  if (laserActive) {
    el('tool-laser').classList.add('active');
  } else {
    stopLaser();
  }
});

function stopLaser() {
  laserActive = false;
  el('tool-laser').classList.remove('active');
  sync.send('laser', { active: false });
}

// Rastreia o mouse e envia a posição RELATIVA AO CANVAS DO PDF (proporção 0-1).
// A tela estendida usa essa mesma proporção dentro do seu próprio canvas,
// garantindo que o ponto apareça no mesmo lugar do conteúdo independente
// do tamanho de cada monitor.
document.addEventListener('mousemove', (e) => {
  if (!laserActive) return;
  if (!state.presentWindow || state.presentWindow.closed) { stopLaser(); return; }

  // Tenta usar o canvas da primeira página visível como referência
  const activeSlot = slots.find((s) => s.pageNum != null);
  if (!activeSlot) return;

  const rect = activeSlot.pdfCanvas.getBoundingClientRect();
  // Posição normalizada dentro do canvas (pode ficar fora de [0,1] se o mouse
  // sair da área do PDF — mandamos mesmo assim, a tela estendida vai receber
  // e mostrar fora da página, o que é ok para apontar elementos na borda)
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  sync.send('laser', { active: true, x, y, page: activeSlot.pageNum });
});



el('btn-toggle-sidebar').addEventListener('click', () => {
  const collapsed = el('sidebar').classList.toggle('collapsed');
  el('btn-toggle-sidebar').textContent = collapsed ? '▶' : '◀';
  el('btn-toggle-sidebar').title = collapsed ? 'Expandir painel' : 'Recolher painel';
});
const viewerWrap = el('viewer-wrap');
const viewModeSelect = el('view-mode-select');
const transitionSelect = el('transition-select');

// Dois "slots" de página: [0] esquerda (sempre visível), [1] direita (só no modo duas páginas)
const slots = [
  { root: el('page-slot-left'), pdfCanvas: el('pdf-canvas'), drawCanvas: el('draw-canvas') },
  { root: el('page-slot-right'), pdfCanvas: el('pdf-canvas-2'), drawCanvas: el('draw-canvas-2') },
];
slots.forEach((s) => {
  s.ctxPdf = s.pdfCanvas.getContext('2d');
  s.ctxDraw = s.drawCanvas.getContext('2d');
  s.pageNum = null;
});

// ---------- Toolbar wiring ----------
el('btn-open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) loadFile(e.target.files[0]);
});

['dragover', 'dragenter'].forEach((ev) =>
  document.body.addEventListener(ev, (e) => e.preventDefault())
);
document.body.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f && f.type === 'application/pdf') loadFile(f);
});

function pageStep() {
  return state.viewMode === 'double' ? 2 : 1;
}

el('btn-prev').addEventListener('click', () => goToPage(state.pageNum - pageStep()));
el('btn-next').addEventListener('click', () => goToPage(state.pageNum + pageStep()));
pageInput.addEventListener('change', () => goToPage(parseInt(pageInput.value, 10) || 1));

el('btn-zoom-in').addEventListener('click', () => { state.fitMode = null; setZoom(state.scale + 0.15); });
el('btn-zoom-out').addEventListener('click', () => { state.fitMode = null; setZoom(state.scale - 0.15); });

zoomSelect.addEventListener('change', async (e) => {
  const val = e.target.value;
  if (val === 'fit-page') { exitZoomArea(); await fitPage(); }
  else if (val === 'fit-width') { exitZoomArea(); await fitWidth(); }
  else if (val === 'zoom-area') {
    enterZoomArea();
    return; // não reseta o select — mantém mostrando "Zoom de Área"
  }
  else {
    exitZoomArea();
    const pct = parseFloat(val);
    if (!isNaN(pct)) await setZoomPercent(pct);
  }
  e.target.value = ''; // volta a mostrar o percentual atual
});

viewModeSelect.addEventListener('change', (e) => {
  state.viewMode = e.target.value;
  renderPage();
  broadcastState();
});

transitionSelect.addEventListener('change', (e) => {
  state.transition = e.target.value;
  sync.send('transition', { mode: state.transition });
});

el('tool-select').addEventListener('click', () => setTool('select'));
el('tool-pen').addEventListener('click', () => setTool('pen'));
el('tool-highlight').addEventListener('click', () => setTool('highlight'));
el('tool-eraser').addEventListener('click', () => setTool('eraser'));
el('pen-color').addEventListener('input', (e) => {
  state.color = e.target.value;
  // Atualiza a cor do ícone de gota/balde em tempo real
  document.querySelector('.color-label').style.setProperty('--pen-preview-color', e.target.value);
});

// Abre o seletor nativo ao clicar no label (o input está escondido)
document.querySelector('.color-label').addEventListener('click', () => {
  if (!el('pen-color').disabled) el('pen-color').click();
});
el('pen-size').addEventListener('input', (e) => (state.size = parseInt(e.target.value, 10)));

el('btn-undo').addEventListener('click', undo);
el('btn-redo').addEventListener('click', redo);
el('btn-clear-page').addEventListener('click', clearPage);

el('btn-present').addEventListener('click', openPresentation);

document.addEventListener('keydown', (e) => {
  if (!state.pdf) return;
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape' && state.zoomAreaActive) { exitZoomArea(); return; }
  if (e.key === 'ArrowRight') goToPage(state.pageNum + pageStep());
  if (e.key === 'ArrowLeft') goToPage(state.pageNum - pageStep());
  if (e.key === '+' || e.key === '=') { exitZoomArea(); state.fitMode = null; setZoom(state.scale + 0.15); }
  if (e.key === '-') { exitZoomArea(); state.fitMode = null; setZoom(state.scale - 0.15); }
  if (e.key.toLowerCase() === 'p') setTool('pen');
  if (e.key.toLowerCase() === 'h') setTool('highlight');
  if (e.key.toLowerCase() === 'e') setTool('eraser');
  if (e.key.toLowerCase() === 'v') setTool('select');
  if (e.key.toLowerCase() === 'l') { el('tool-laser').click(); }
});

// ---------- Load PDF ----------
async function loadFile(file) {
  const buffer = await file.arrayBuffer();
  await PdfDB.savePdfBuffer(buffer.slice(0), file.name);
  state.fileName = file.name;
  sidebarFile.textContent = file.name;

  const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
  state.pdf = pdf;
  state.numPages = pdf.numPages;
  state.pageStrokes.clear();
  state.redoStacks.clear();
  state.pageNum = 1;

  emptyState.classList.add('hidden');
  pageStage.classList.remove('hidden');
  enableControls(true);
  pageTotal.textContent = `/ ${state.numPages}`;

  await fitPage(); // sempre abre no Ajustar Página (100%)
  generateThumbnails();
  sync.send('load');
}

function enableControls(on) {
  [
    'btn-prev', 'btn-next', 'page-input', 'btn-zoom-in', 'btn-zoom-out', 'zoom-select',
    'view-mode-select', 'transition-select', 'tool-select', 'tool-pen',
    'tool-highlight', 'tool-eraser', 'pen-color', 'pen-size', 'btn-undo',
    'btn-redo', 'btn-clear-page', 'btn-present', 'btn-blank-screen',
  ].forEach((id) => (el(id).disabled = !on));
  // tool-laser é habilitado separadamente quando a tela estendida está conectada
}

// ---------- Miniaturas de páginas ----------
const THUMB_SCALE = 0.28; // escala maior = mais nítido na sidebar de 190px de largura

async function generateThumbnails() {
  const container = el('thumb-container');
  container.innerHTML = '';

  for (let i = 1; i <= state.numPages; i++) {
    const item = document.createElement('div');
    item.className = 'thumb-item' + (i === state.pageNum ? ' active' : '');
    item.dataset.page = i;

    const canvas = document.createElement('canvas');
    item.appendChild(canvas);

    const label = document.createElement('span');
    label.textContent = i;
    item.appendChild(label);

    item.addEventListener('click', () => goToPage(i));
    container.appendChild(item);

    // Renderiza progressivamente para não travar a UI
    setTimeout(() => renderThumb(i, canvas), i * 40);
  }
}

async function renderThumb(pageNum, canvas) {
  try {
    const page = await state.pdf.getPage(pageNum);
    // Usa a largura real do canvas CSS (sidebar tem 190px - 2*padding - 2*border)
    // mas renderiza em escala maior para ficar nítido em telas de alta densidade (retina/HiDPI)
    const naturalVp = page.getViewport({ scale: 1 });
    const targetW = 150; // largura alvo em px lógicos
    const scale = targetW / naturalVp.width;
    const viewport = page.getViewport({ scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  } catch (e) { /* página pode ter sido trocada durante a renderização — ignora */ }
}

function updateThumbActive() {
  el('thumb-container').querySelectorAll('.thumb-item').forEach((item) => {
    item.classList.toggle('active', parseInt(item.dataset.page) === state.pageNum);
    if (item.classList.contains('active')) {
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}

// ---------- Rendering ----------
function visiblePagesFor(pageNum) {
  if (state.viewMode === 'double') {
    const right = Math.min(pageNum + 1, state.numPages);
    return right !== pageNum ? [pageNum, right] : [pageNum];
  }
  return [pageNum];
}
function visiblePages() {
  return visiblePagesFor(state.pageNum);
}

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

let renderGeneration = 0; // detecta chamadas de renderPage() atropeladas por uma mais nova

async function renderPage() {
  if (!state.pdf) return;
  const myGeneration = ++renderGeneration;
  const pages = visiblePages();

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
    if (myGeneration !== renderGeneration) return; // uma chamada mais nova já assumiu

    const viewport = safeViewport(page, state.scale);
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

  pageInput.value = state.pageNum;
  const fit = await computeFitScales();
  state.pageFitScale = fit.page;
  zoomSelectDefaultOption.textContent = Math.round((state.scale / fit.page) * 100) + '%';
  requestAnimationFrame(broadcastScroll);
}

function strokesFor(pageNum) {
  if (!state.pageStrokes.has(pageNum)) state.pageStrokes.set(pageNum, []);
  return state.pageStrokes.get(pageNum);
}

function slotForPage(pageNum) {
  return slots.find((s) => s.pageNum === pageNum);
}

function redrawSlot(slot) {
  slot.ctxDraw.clearRect(0, 0, slot.drawCanvas.width, slot.drawCanvas.height);
  if (slot.pageNum == null) return;
  for (const item of strokesFor(slot.pageNum)) {
    drawAnnotation(slot.ctxDraw, item, slot.drawCanvas.width, slot.drawCanvas.height);
  }
}

function drawAnnotation(ctx, item, w, h) {
  ctx.save();
  if (item.kind === 'highlight-rect') {
    ctx.globalAlpha = 0.35;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = item.color;
    item.rects.forEach((r) => ctx.fillRect(r.x * w, r.y * h, r.w * w, r.h * h));
  } else {
    if (item.points.length < 1) { ctx.restore(); return; }
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

// ---------- Sincronização de rolagem (scroll) ----------
function getScrollFrac() {
  const maxX = viewerWrap.scrollWidth - viewerWrap.clientWidth;
  const maxY = viewerWrap.scrollHeight - viewerWrap.clientHeight;
  return {
    scrollX: maxX > 0 ? viewerWrap.scrollLeft / maxX : 0,
    scrollY: maxY > 0 ? viewerWrap.scrollTop / maxY : 0,
  };
}

let scrollRaf = null;
function broadcastScroll() {
  sync.send('scroll', getScrollFrac());
}
viewerWrap.addEventListener('scroll', () => {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null;
    broadcastScroll();
  });
});

// ---------- Envia o estado completo (página(s), zoom, modo, traços) ----------
const FADE_MS = 180; // precisa bater com a duração no CSS

function broadcastState(pageChanged = false, overridePageNum = null, scrollOverride = null) {
  const pages = overridePageNum != null ? visiblePagesFor(overridePageNum) : visiblePages();
  const strokesByPage = {};
  pages.forEach((p) => (strokesByPage[p] = strokesFor(p)));
  sync.send('state', {
    scale: state.scale,
    // Percentual relativo ao "ajustar página" DESTA janela — a tela estendida
    // usa esse número (não o "scale" bruto) para o modo de zoom manual, assim
    // os dois lados concordam sobre o que é "100%" e não há salto ao trocar
    // de Ajustar Página para +/-.
    zoomPercent: state.pageFitScale ? (state.scale / state.pageFitScale) * 100 : 100,
    viewMode: state.viewMode,
    fitMode: state.fitMode,
    transition: state.transition,
    pageChanged,
    pages,
    strokesByPage,
    ...(scrollOverride || getScrollFrac()),
  });
}

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

// ---------- Navigation / Zoom ----------
let navGeneration = 0;

async function goToPage(n) {
  if (!state.pdf) return;
  n = Math.min(Math.max(1, n), state.numPages);
  if (n === state.pageNum) return;
  const myNav = ++navGeneration;

  // Avisa a tela estendida JÁ, em paralelo com o nosso próprio fade — assim
  // as duas telas começam a transição praticamente juntas, em vez da tela
  // estendida só começar depois que o controle já tiver terminado tudo.
  broadcastState(true, n, { scrollX: 0, scrollY: 0 });

  await fadeOutSlots(); // some com a página atual antes de trocar
  if (myNav !== navGeneration) return; // uma navegação mais nova já assumiu (cliques rápidos)

  state.pageNum = n;
  viewerWrap.scrollTop = 0;
  viewerWrap.scrollLeft = 0;
  await renderPage();
  if (myNav !== navGeneration) return;
  applyPageChangeFade(); // e a nova aparece
  updateThumbActive();
}

async function setZoom(s) {
  if (!state.pdf) return;
  state.scale = Math.min(Math.max(0.05, s), 18);
  await renderPage();
  broadcastState();
}

async function computeFitScales() {
  const page = await state.pdf.getPage(state.pageNum);
  const naturalViewport = page.getViewport({ scale: 1 });
  const slotsShown = visiblePages().length;

  let availW, availH;
  if (state.presentScreenSize) {
    // Usa o tamanho REAL da tela estendida como referência (não a janelinha
    // de pré-visualização do controle) — assim o controle "estoura" e mostra
    // rolagem exatamente quando a tela estendida também estoura, permitindo
    // controlar a posição dela por aqui.
    availW = (state.presentScreenSize.width - (slotsShown - 1) * 10) / slotsShown;
    availH = state.presentScreenSize.height;
  } else {
    availW = (viewerWrap.clientWidth - 48 - (slotsShown - 1) * 10) / slotsShown;
    availH = viewerWrap.clientHeight - 48;
  }

  return {
    width: availW / naturalViewport.width,
    page: Math.min(availW / naturalViewport.width, availH / naturalViewport.height),
  };
}

async function fitWidth() {
  if (!state.pdf) return;
  state.fitMode = 'width';
  const fit = await computeFitScales();
  await setZoom(fit.width);
}

async function fitPage() {
  if (!state.pdf) return;
  state.fitMode = 'page';
  const fit = await computeFitScales();
  await setZoom(fit.page);
}

// "100%" no seletor de zoom = Ajustar Página (igual pedido). Os demais
// valores são múltiplos dessa mesma referência (200% = 2x o "ajustar página").
async function setZoomPercent(pct) {
  if (!state.pdf) return;
  if (pct === 100) {
    await fitPage();
    return;
  }
  state.fitMode = null;
  const fit = await computeFitScales();
  await setZoom(fit.page * (pct / 100));
}

// ---------- Zoom de Área ----------
function enterZoomArea() {
  state.zoomAreaActive = true;
  viewerWrap.style.cursor = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'%3E%3Cline x1=\'12\' y1=\'2\' x2=\'12\' y2=\'22\' stroke=\'black\' stroke-width=\'2\'/%3E%3Cline x1=\'2\' y1=\'12\' x2=\'22\' y2=\'12\' stroke=\'black\' stroke-width=\'2\'/%3E%3C/svg%3E") 12 12, crosshair';
  zoomSelectDefaultOption.textContent = '🔍 Zoom de Área';
}

function exitZoomArea() {
  if (!state.zoomAreaActive) return;
  state.zoomAreaActive = false;
  state.zoomAreaDrag = null;
  viewerWrap.style.cursor = '';
  // Remove o canvas de prévia se existir
  const overlay = document.getElementById('zoom-area-overlay');
  if (overlay) overlay.remove();
  // Reseta o label do select para o zoom atual
  const fit = state.pageFitScale;
  if (fit) {
    zoomSelectDefaultOption.textContent = Math.round((state.scale / fit) * 100) + '%';
  } else {
    zoomSelectDefaultOption.textContent = 'Zoom';
  }
  zoomSelect.value = '';
}

// Canvas de prévia do retângulo de seleção de área
function getOrCreateZoomAreaCanvas() {
  let c = document.getElementById('zoom-area-overlay');
  if (!c) {
    c = document.createElement('canvas');
    c.id = 'zoom-area-overlay';
    c.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:9999;';
    document.body.appendChild(c);
  }
  c.width = window.innerWidth;
  c.height = window.innerHeight;
  return c;
}

function drawZoomAreaPreview(x1, y1, x2, y2) {
  const c = getOrCreateZoomAreaCanvas();
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
  const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
  ctx.save();
  ctx.fillStyle = 'rgba(59,130,246,0.12)';
  ctx.fillRect(rx, ry, rw, rh);
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(rx, ry, rw, rh);
  ctx.restore();
}

viewerWrap.addEventListener('pointerdown', (e) => {
  if (!state.zoomAreaActive || !state.pdf) return;
  e.preventDefault();
  state.zoomAreaDrag = { startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY };
  viewerWrap.setPointerCapture(e.pointerId);
});

viewerWrap.addEventListener('pointermove', (e) => {
  if (!state.zoomAreaActive || !state.zoomAreaDrag) return;
  state.zoomAreaDrag.x = e.clientX;
  state.zoomAreaDrag.y = e.clientY;
  drawZoomAreaPreview(
    state.zoomAreaDrag.startX, state.zoomAreaDrag.startY,
    state.zoomAreaDrag.x, state.zoomAreaDrag.y
  );
});

viewerWrap.addEventListener('pointerup', async (e) => {
  if (!state.zoomAreaActive || !state.zoomAreaDrag) return;
  const { startX, startY, x: endX, y: endY } = state.zoomAreaDrag;
  state.zoomAreaDrag = null;

  // Remove prévia
  const overlay = document.getElementById('zoom-area-overlay');
  if (overlay) overlay.remove();

  // Rejeita retângulos muito pequenos (clique acidental)
  const selW = Math.abs(endX - startX);
  const selH = Math.abs(endY - startY);
  if (selW < 10 || selH < 10) { exitZoomArea(); return; }

  // Converte as coordenadas de tela para coordenadas normalizadas dentro do canvas do PDF
  const activeSlot = slots.find((s) => s.pageNum != null);
  if (!activeSlot) { exitZoomArea(); return; }
  const canvasRect = activeSlot.pdfCanvas.getBoundingClientRect();

  // Região selecionada em pixels do canvas
  const rx1 = Math.min(startX, endX) - canvasRect.left;
  const ry1 = Math.min(startY, endY) - canvasRect.top;
  const rx2 = Math.max(startX, endX) - canvasRect.left;
  const ry2 = Math.max(startY, endY) - canvasRect.top;

  // Calcula o zoom necessário para a região selecionada preencher o viewer
  const scaleRatio = Math.min(
    viewerWrap.clientWidth / (rx2 - rx1),
    viewerWrap.clientHeight / (ry2 - ry1)
  );
  const newScale = state.scale * scaleRatio;

  // Calcula a posição de rolagem para centralizar a área selecionada
  // (em proporção do canvas atual, para aplicar depois do novo renderPage)
  const fracX = (rx1 + (rx2 - rx1) / 2) / canvasRect.width;
  const fracY = (ry1 + (ry2 - ry1) / 2) / canvasRect.height;

  exitZoomArea();
  state.fitMode = null;
  state.scale = Math.min(Math.max(0.05, newScale), 18);
  await renderPage();

  // Centraliza a rolagem no ponto focal escolhido
  const newSlot = slots.find((s) => s.pageNum != null);
  if (newSlot) {
    const targetX = fracX * newSlot.pdfCanvas.width - viewerWrap.clientWidth / 2;
    const targetY = fracY * newSlot.pdfCanvas.height - viewerWrap.clientHeight / 2;
    viewerWrap.scrollLeft = Math.max(0, targetX);
    viewerWrap.scrollTop = Math.max(0, targetY);
  }

  broadcastState();
});


function setTool(tool) {
  state.tool = tool;
  ['select', 'pen', 'highlight', 'eraser'].forEach((t) =>
    el('tool-' + t).classList.toggle('active', t === tool)
  );
  const cursor = tool === 'select' ? 'default' : 'crosshair';
  slots.forEach((s) => (s.drawCanvas.style.cursor = cursor));
  if (tool === 'highlight' && el('pen-color').value === '#ff3b30') {
    el('pen-color').value = '#ffeb3b';
    state.color = '#ffeb3b';
    document.querySelector('.color-label').style.setProperty('--pen-preview-color', '#ffeb3b');
  }
}
setTool('select');

function normalizeRect(r) {
  return {
    x: Math.min(r.startX, r.x),
    y: Math.min(r.startY, r.y),
    w: Math.abs(r.x - r.startX),
    h: Math.abs(r.y - r.startY),
  };
}

function drawHighlightPreview(slot) {
  if (!state.currentHighlightRect || state.currentHighlightRect.slot !== slot) return;
  const r = normalizeRect(state.currentHighlightRect);
  const w = slot.drawCanvas.width, h = slot.drawCanvas.height;
  const ctx = slot.ctxDraw;
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = state.color;
  ctx.fillRect(r.x * w, r.y * h, r.w * w, r.h * h);
  ctx.restore();
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function normPoint(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height,
  };
}

slots.forEach((slot) => {
  slot.drawCanvas.addEventListener('pointerdown', (e) => onPointerDown(e, slot));
  slot.drawCanvas.addEventListener('pointermove', (e) => onPointerMove(e, slot));
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) =>
    slot.drawCanvas.addEventListener(ev, onPointerUp)
  );
});

function onPointerDown(e, slot) {
  if (!state.pdf || state.tool === 'select' || slot.pageNum == null) return;
  state.drawing = true;
  state.activeSlot = slot;
  slot.drawCanvas.setPointerCapture(e.pointerId);
  const { x, y } = normPoint(e, slot.drawCanvas);

  if (state.tool === 'pen') {
    state.currentStroke = { id: genId(), kind: 'stroke', color: state.color, size: state.size, points: [{ x, y }] };
    strokesFor(slot.pageNum).push(state.currentStroke);
    state.redoStacks.set(slot.pageNum, []);
    redrawSlot(slot);
    sync.send('stroke-point', {
      page: slot.pageNum, strokeId: state.currentStroke.id, point: { x, y },
      color: state.color, size: state.size, isNew: true,
    });
  } else if (state.tool === 'highlight') {
    state.currentHighlightRect = { slot, startX: x, startY: y, x, y };
  } else if (state.tool === 'eraser') {
    eraseAt(slot, x, y);
  }
}

function onPointerMove(e, slot) {
  if (!state.drawing || state.activeSlot !== slot) return;
  const { x, y } = normPoint(e, slot.drawCanvas);
  if (state.tool === 'pen' && state.currentStroke) {
    state.currentStroke.points.push({ x, y });
    redrawSlot(slot);
    sync.send('stroke-point', { page: slot.pageNum, strokeId: state.currentStroke.id, point: { x, y }, isNew: false });
  } else if (state.tool === 'highlight' && state.currentHighlightRect) {
    state.currentHighlightRect.x = x;
    state.currentHighlightRect.y = y;
    redrawSlot(slot);
    drawHighlightPreview(slot);
  } else if (state.tool === 'eraser') {
    eraseAt(slot, x, y);
  }
}

function onPointerUp() {
  if (state.tool === 'highlight' && state.currentHighlightRect && state.activeSlot) {
    const slot = state.activeSlot;
    const r = normalizeRect(state.currentHighlightRect);
    if (r.w > 0.004 && r.h > 0.004) {
      const item = { id: genId(), kind: 'highlight-rect', color: state.color, rects: [r] };
      strokesFor(slot.pageNum).push(item);
      state.redoStacks.set(slot.pageNum, []);
      sync.send('set-page-strokes', { page: slot.pageNum, strokes: strokesFor(slot.pageNum) });
    }
    redrawSlot(slot);
  }
  state.currentHighlightRect = null;
  state.drawing = false;
  state.currentStroke = null;
  state.activeSlot = null;
}

function itemNearPoint(item, x, y, threshold) {
  if (item.kind === 'highlight-rect') {
    return item.rects.some(
      (r) => x >= r.x - threshold && x <= r.x + r.w + threshold && y >= r.y - threshold && y <= r.y + r.h + threshold
    );
  }
  return item.points.some((p) => Math.hypot(p.x - x, p.y - y) < threshold);
}

function eraseAt(slot, x, y) {
  const strokes = strokesFor(slot.pageNum);
  const threshold = 0.02;
  const remaining = strokes.filter((item) => !itemNearPoint(item, x, y, threshold));
  if (remaining.length !== strokes.length) {
    state.pageStrokes.set(slot.pageNum, remaining);
    redrawSlot(slot);
    sync.send('set-page-strokes', { page: slot.pageNum, strokes: remaining });
  }
}

function undo() {
  const strokes = strokesFor(state.pageNum);
  if (!strokes.length) return;
  const removed = strokes.pop();
  if (!state.redoStacks.has(state.pageNum)) state.redoStacks.set(state.pageNum, []);
  state.redoStacks.get(state.pageNum).push(removed);
  const slot = slotForPage(state.pageNum);
  if (slot) redrawSlot(slot);
  sync.send('set-page-strokes', { page: state.pageNum, strokes });
}

function redo() {
  const redoStack = state.redoStacks.get(state.pageNum) || [];
  if (!redoStack.length) return;
  const stroke = redoStack.pop();
  strokesFor(state.pageNum).push(stroke);
  const slot = slotForPage(state.pageNum);
  if (slot) redrawSlot(slot);
  sync.send('set-page-strokes', { page: state.pageNum, strokes: strokesFor(state.pageNum) });
}

function clearPage() {
  state.pageStrokes.set(state.pageNum, []);
  state.redoStacks.set(state.pageNum, []);
  const slot = slotForPage(state.pageNum);
  if (slot) redrawSlot(slot);
  sync.send('set-page-strokes', { page: state.pageNum, strokes: [] });
}

// ---------- Presentation window (tela estendida) ----------
async function refitAfterScreenChange() {
  if (!state.pdf) return;
  if (state.fitMode === 'width') await fitWidth();
  else if (state.fitMode === 'page') await fitPage();
  else {
    await renderPage(); // zoom manual: mantém o percentual, só recalcula a referência
    broadcastState();
  }
}

async function openPresentation() {
  const base = location.href.replace(/index\.html?$/, '');
  const url = base + 'present.html';

  if ('getScreenDetails' in window) {
    try {
      const details = await window.getScreenDetails();
      const current = details.currentScreen;
      const target = details.screens.find((s) => s !== current) || details.screens[0];
      const features = `left=${target.availLeft},top=${target.availTop},width=${target.availWidth},height=${target.availHeight},menubar=no,toolbar=no,location=no,status=no`;
      state.presentWindow = window.open(url, 'pdfPresentWindow', features);
      state.presentScreenSize = { width: target.availWidth, height: target.availHeight };
      el('btn-close-present').disabled = false;
      await refitAfterScreenChange();
      return;
    } catch (err) {
      console.warn('getScreenDetails falhou, usando modo manual:', err);
    }
  }

  alert('Seu navegador não permite detectar telas automaticamente (funciona no Chrome/Edge). A janela vai abrir agora — arraste-a para a segunda tela e clique nela para iniciar a tela cheia.');
  state.presentWindow = window.open(url, 'pdfPresentWindow', 'width=1280,height=800');
  // Sem detecção automática, assume um tamanho comum de monitor (Full HD) como referência.
  state.presentScreenSize = { width: 1920, height: 1080 };
  el('btn-close-present').disabled = false;
  await refitAfterScreenChange();
}

el('btn-close-present').addEventListener('click', () => {
  if (state.presentWindow && !state.presentWindow.closed) {
    state.presentWindow.close();
  }
  state.presentWindow = null;
  state.presentScreenSize = null;
  el('btn-close-present').disabled = true;
  el('tool-laser').disabled = true;
  stopLaser();
  // Reseta o botão de blank screen
  blankMode = 'off';
  el('btn-blank-screen').textContent = '⏸ Pausar Tela';
  el('btn-blank-screen').classList.remove('active');
  el('btn-blank-color').classList.add('hidden');
  presentDot.classList.remove('on');
  presentStatus.textContent = 'Tela estendida: fechada';
  refitAfterScreenChange();
});

sync.on((msg) => {
  if (msg.type === 'present-ready') {
    presentDot.classList.add('on');
    presentStatus.textContent = 'Tela estendida: conectada (clique nela para tela cheia)';
    el('btn-close-present').disabled = false;
    el('tool-laser').disabled = false;
    const pages = visiblePages();
    const strokesByPage = {};
    pages.forEach((p) => (strokesByPage[p] = strokesFor(p)));
    sync.send('sync-state', {
      hasPdf: !!state.pdf,
      scale: state.scale,
      zoomPercent: state.pageFitScale ? (state.scale / state.pageFitScale) * 100 : 100,
      viewMode: state.viewMode,
      fitMode: state.fitMode,
      transition: state.transition,
      pages,
      strokesByPage,
      ...getScrollFrac(),
    });
  }
  if (msg.type === 'present-closed') {
    presentDot.classList.remove('on');
    presentStatus.textContent = 'Tela estendida: fechada';
    el('btn-close-present').disabled = true;
    el('tool-laser').disabled = true;
    stopLaser();
    state.presentWindow = null;
    state.presentScreenSize = null;
    refitAfterScreenChange();
  }
  if (msg.type === 'fullscreen-state') {
    presentStatus.textContent = msg.active
      ? 'Tela estendida: conectada (tela cheia ativa)'
      : 'Tela estendida: conectada (clique nela para tela cheia)';
  }
});
