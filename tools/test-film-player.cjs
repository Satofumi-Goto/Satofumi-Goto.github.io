const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

// A gesture-sensitive media stub catches deferred play() without claiming to
// emulate iOS decoding. Run: node --test tools/test-film-player.cjs
const source = readFileSync(process.env.FILM_PLAYER_SOURCE || 'media/film-player.js', 'utf8');
function setup({ native = true, hls = true } = {}) {
  let gesture = false;
  const events = () => ({
    listeners: new Map(),
    addEventListener(name, callback, options) {
      const list = this.listeners.get(name) || [];
      list.push({ callback, once: options?.once });
      this.listeners.set(name, list);
    },
    removeEventListener(name, callback) {
      this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item.callback !== callback));
    },
    emit(name) {
      for (const item of [...(this.listeners.get(name) || [])]) {
        if (item.once) this.removeEventListener(name, item.callback);
        item.callback();
      }
    }
  });
  const label = { textContent: '' };
  const start = { ...events(), hidden: false, disabled: false, querySelector: () => label };
  const language = { ...events(), value: 'ja' };
  const fullscreen = events();
  const attempts = [];
  const video = {
    ...events(), dataset: { stream: '/ja/film.m3u8', streamEn: '/en/film.m3u8' },
    currentTime: 0, duration: 281, paused: true, src: '', loads: 0,
    canPlayType: () => native ? 'probably' : '',
    load() { this.loads++; },
    pause() { this.paused = true; },
    removeAttribute(name) { if (name === 'src') this.src = ''; },
    play() {
      const attempt = { gesture, src: this.src };
      attempts.push(attempt);
      this.paused = false;
      return { catch(callback) { attempt.reject = callback; } };
    },
    webkitEnterFullscreen() { throw new Error('Metadata not ready'); }
  };
  const players = [];
  class Hls {
    static isSupported() { return true; }
    static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' };
    constructor() { this.handlers = {}; players.push(this); }
    on(name, callback) { this.handlers[name] = callback; }
    loadSource(src) { this.src = src; }
    attachMedia() {}
    destroy() { this.destroyed = true; }
  }
  const elements = { video, '.film-start': start, '.film-fullscreen': fullscreen, '.film-language': language };
  vm.runInNewContext(source, {
    document: { documentElement: { lang: 'ja' }, querySelector: () => ({ querySelector: selector => elements[selector] }) },
    window: { Hls: hls ? Hls : undefined }, Hls
  });
  const act = (target, event) => { gesture = true; try { target.emit(event); } finally { gesture = false; } };
  return { video, start, language, fullscreen, attempts, players, act };
}

test('iPhone uses native HLS and requests audible play during the first tap', () => {
  const t = setup();
  t.act(t.start, 'click');
  assert.equal(t.players.length, 0);
  assert.equal(t.attempts.length, 1);
  assert.equal(t.attempts[0].gesture, true);
  assert.equal(t.attempts[0].src, '/ja/film.m3u8');
  t.video.emit('loadedmetadata');
  assert.equal(t.attempts.length, 1, 'metadata must not initiate a second play request');
});

test('native playback also works without hls.js', () => {
  const t = setup({ hls: false });
  t.act(t.start, 'click');
  assert.equal(t.attempts.length, 1);
  assert.equal(t.attempts[0].gesture, true);
});

test('language changes retain position and playing/paused state', () => {
  const t = setup();
  t.act(t.start, 'click');
  t.video.emit('loadedmetadata');
  t.video.currentTime = 90;
  t.language.value = 'en';
  t.act(t.language, 'change');
  t.video.currentTime = 0;
  t.video.emit('loadedmetadata');
  assert.equal(t.video.currentTime, 90);
  assert.equal(t.attempts.at(-1).src, '/en/film.m3u8');
  assert.equal(t.attempts.at(-1).gesture, true);
  t.video.pause();
  t.language.value = 'ja';
  const count = t.attempts.length;
  t.act(t.language, 'change');
  t.video.currentTime = 0;
  t.video.emit('loadedmetadata');
  assert.equal(t.video.currentTime, 90);
  assert.equal(t.video.paused, true);
  assert.equal(t.attempts.length, count);
});

test('native errors allow a fresh source load on retry', () => {
  const t = setup();
  t.act(t.start, 'click');
  t.video.emit('error');
  assert.equal(t.start.disabled, false);
  const loads = t.video.loads;
  t.act(t.start, 'click');
  assert.ok(t.video.loads > loads);
  assert.equal(t.attempts.at(-1).gesture, true);
});

test('a cancelled previous-language play cannot overwrite a successful new play', () => {
  const t = setup();
  t.act(t.start, 'click');
  const oldAttempt = t.attempts[0];
  t.language.value = 'en';
  t.act(t.language, 'change');
  t.video.emit('playing');
  oldAttempt.reject();
  assert.equal(t.start.hidden, true);
});

test('browsers without native HLS keep hls.js playback and retry after fatal errors', () => {
  const t = setup({ native: false });
  t.act(t.start, 'click');
  assert.equal(t.players.length, 1);
  t.players[0].handlers.manifest();
  assert.equal(t.attempts.length, 1);
  t.players[0].handlers.error(null, { fatal: true });
  assert.equal(t.start.disabled, false);
  t.act(t.start, 'click');
  assert.equal(t.players.length, 2);
});

test('iPhone fullscreen rejection does not throw out of the tap handler', () => {
  const t = setup();
  assert.doesNotThrow(() => t.act(t.fullscreen, 'click'));
  assert.equal(t.attempts[0].gesture, true);
});
