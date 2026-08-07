# Leitor de PDF — Tela Estendida

App 100% front-end (HTML + CSS + JS puro) para abrir um PDF no seu notebook
e espelhar automaticamente em tela cheia na sua segunda tela (monitor
estendido), incluindo página atual, zoom e marcações feitas com a caneta.

Não precisa de servidor, back-end ou internet para funcionar — depois de
instalado o PDF.js localmente (veja abaixo), tudo roda direto no navegador.

## Como funciona

- **`index.html`** → janela de controle. Fica aberta no seu notebook: você
  abre o PDF, navega, dá zoom e desenha aqui.
- **`present.html`** → janela de apresentação. É aberta automaticamente na
  segunda tela em tela cheia e reflete tudo que você faz na janela de
  controle (página, zoom, desenho).
- A comunicação entre as duas janelas é feita via `BroadcastChannel`
  (tempo real) e o PDF fica salvo localmente via `IndexedDB` — nada sai
  do seu computador.

## Passo 1 — Instalar o PDF.js (necessário, 1 vez)

O leitor usa a biblioteca [PDF.js](https://mozilla.github.io/pdf.js/) para
renderizar os PDFs. Para funcionar **totalmente offline**, baixe-a e coloque
dentro da pasta `lib/`. Instruções completas em `lib/LEIA-ME.txt`. Resumo:

1. Baixe direto: https://github.com/mozilla/pdf.js/releases/download/v6.2.108/pdfjs-6.2.108-dist.zip
   (ou pegue a versão mais recente em https://mozilla.github.io/pdf.js/getting_started/#download)
2. Descompacte e copie `build/pdf.mjs` e `build/pdf.worker.mjs` para dentro de `lib/`

> Nota: nas versões atuais do PDF.js os arquivos são `.mjs` (módulo ES),
> não mais `pdf.min.js` como em versões antigas — se você tiver instruções
> antigas por aí, ignore-as e use os nomes acima.

## Passo 2 — Usar localmente

Como os arquivos do PDF.js são módulos ES, os navegadores **bloqueiam** o
carregamento deles quando a página é aberta direto do disco (`file://`).
Por isso, mesmo para uso 100% local, é preciso servir a pasta com um
servidor local simples (não precisa de internet, roda no seu computador):

```
npx serve .
# ou
python3 -m http.server
```

Depois acesse pelo navegador em algo como `http://localhost:3000` (a porta
exata aparece no terminal).

1. Clique em **Abrir PDF** (ou arraste o arquivo para a janela).
2. Clique em **🖥️ Enviar p/ Tela Estendida**.
   - No **Chrome/Edge**, o navegador vai pedir permissão para gerenciar
     janelas em múltiplas telas — aceite. A janela de apresentação abre
     sozinha, posicionada e dimensionada exatamente na sua segunda tela.
   - Em outros navegadores, a janela abre normalmente — **arraste-a
     manualmente para a segunda tela**.
3. Na janela de apresentação, clique uma vez em **"Iniciar Tela Cheia"**
   (o navegador exige esse clique por segurança; depois disso tudo é
   automático).
4. Use a caneta, o zoom e a navegação de página normalmente na janela de
   controle — tudo aparece espelhado na tela estendida.

### Suporte de navegador

| Recurso | Chrome / Edge (desktop) | Firefox / Safari |
|---|---|---|
| Detecção automática da segunda tela | ✅ | ❌ (abre janela normal, você arrasta manualmente) |
| Sincronização de página/zoom/desenho | ✅ | ✅ |
| Tela cheia na apresentação | ✅ (1 clique) | ✅ (1 clique) |

## Passo 3 — Publicar no GitHub Pages

1. Crie um repositório novo no GitHub (ex.: `pdf-dual-screen`).
2. Suba **todos** os arquivos desta pasta, incluindo `lib/pdf.min.js` e
   `lib/pdf.worker.min.js` (não suba só o LEIA-ME — os arquivos reais da
   biblioteca precisam estar no repositório para funcionar).
3. No repositório: **Settings → Pages → Source**, selecione a branch
   `main` e pasta `/ (root)`. Salve.
4. Em alguns minutos seu app estará em:
   `https://SEU-USUARIO.github.io/pdf-dual-screen/`
5. A Window Management API (detecção da 2ª tela) exige HTTPS — o GitHub
   Pages já serve em HTTPS por padrão, então funciona normalmente.

> Depois de carregado uma vez, o app não faz mais nenhuma chamada de
> rede (PDF.js está vendorizado localmente e o PDF fica só no seu
> navegador) — por isso ele continua funcionando mesmo sem internet,
> mesmo hospedado no GitHub Pages.

## Estrutura de arquivos

```
pdf-dual-screen/
├── index.html          # janela de controle
├── present.html         # janela de apresentação (tela estendida)
├── css/style.css
├── js/
│   ├── main.js          # lógica da janela de controle
│   ├── present.js       # lógica da janela de apresentação
│   ├── sync.js           # comunicação em tempo real (BroadcastChannel)
│   └── db.js             # armazenamento local do PDF (IndexedDB)
├── lib/                  # coloque aqui pdf.min.js e pdf.worker.min.js
└── README.md
```

## Limitações conhecidas

- A detecção automática de monitores (`getScreenDetails`) é uma API
  experimental disponível apenas em navegadores baseados em Chromium.
- PDFs muito grandes (centenas de MB) podem demorar para carregar no
  `IndexedDB` na primeira vez que são abertos.
- A borracha atual apaga o traço inteiro que estiver sob o cursor (não
  apenas o pedaço tocado) — simples e previsível para marcações rápidas.
