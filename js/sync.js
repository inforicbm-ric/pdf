// sync.js — canal de comunicação em tempo real entre a janela de controle
// (notebook) e a janela de apresentação (tela estendida).

const CHANNEL_NAME = 'pdf-dual-screen-sync';

class SyncBus {
  constructor() {
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.listeners = [];
    this.channel.onmessage = (ev) => {
      this.listeners.forEach((fn) => fn(ev.data));
    };
  }

  send(type, payload = {}) {
    this.channel.postMessage({ type, ...payload, ts: Date.now() });
  }

  on(callback) {
    this.listeners.push(callback);
  }
}

window.SyncBus = SyncBus;
