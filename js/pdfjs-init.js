// pdfjs-init.js — carrega o PDF.js (build atual, formato ES module .mjs)
// e expõe como window.pdfjsLib para o resto do app (scripts clássicos) usar.
import * as pdfjsLib from '../lib/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.mjs';
window.pdfjsLib = pdfjsLib;
window.dispatchEvent(new Event('pdfjs-ready'));
