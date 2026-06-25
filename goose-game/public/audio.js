// Sound manager for Quit Goosin' Around! — Web Audio API.
//
// Why Web Audio instead of <audio> elements: most of this game's sounds fire
// from WebSocket events (turn, Big Boy, draws) — not from inside a click
// handler. Browsers (Safari/iOS especially) block HTMLAudioElement.play()
// outside a user gesture even AFTER the user has interacted, so those sounds
// were silent on the deployed HTTPS site (localhost is exempt, so it worked
// locally). With Web Audio we decode each clip into a buffer once and play it
// through a single AudioContext that we resume() on the first user gesture —
// after that, buffers can be played at any time, from any event, on every
// browser.
//
// Files are optional/drop-in: sounds/<name>.<ext> (mp3/ogg/wav/m4a). Anything
// missing or undecodable is silently skipped. Mute + volume persist.

const SOUND_NAMES = [
  'click', 'drawgoose', 'drawgeese', 'drawgeeses', 'honk', 'bigboy',
  'lawnmower', 'getgoosed', 'goosegang', 'turn', 'win', 'lose',
  'trade', 'announce', 'goosed', 'goosednoannounce',
];
const EXTS = ['mp3', 'ogg', 'wav', 'm4a'];

let muted = localStorage.getItem('goose_muted') === '1';
let volume = parseFloat(localStorage.getItem('goose_vol') ?? '0.7');
const clampVol = (v) => Math.max(0, Math.min(1, v));

let ctx;                 // AudioContext | null(unsupported) | undefined(not yet)
const buffers = {};      // name -> AudioBuffer | null (decoded once; null = missing)
const loading = {};      // name -> Promise<AudioBuffer|null> while in flight

function getCtx() {
  if (ctx === undefined) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = AC ? new AC() : null;
  }
  return ctx;
}

// Fetch + decode the first extension that exists into an AudioBuffer.
function loadBuffer(name) {
  if (name in buffers) return Promise.resolve(buffers[name]);
  if (loading[name]) return loading[name];
  const c = getCtx();
  if (!c) return Promise.resolve(null);
  loading[name] = (async () => {
    for (const ext of EXTS) {
      try {
        const resp = await fetch(`sounds/${name}.${ext}`);
        if (!resp.ok) continue;
        const data = await resp.arrayBuffer();
        const buf = await c.decodeAudioData(data);  // promise form (modern browsers)
        buffers[name] = buf;
        return buf;
      } catch { /* missing or undecodable in this format — try the next ext */ }
    }
    buffers[name] = null;
    return null;
  })();
  loading[name].finally(() => { delete loading[name]; });
  return loading[name];
}

// Resume the (autoplay-suspended) context on the first user gesture so later
// event-driven sounds are allowed to play.
function unlock() { const c = getCtx(); if (c && c.state === 'suspended') c.resume(); }

export function initAudio() {
  getCtx();
  SOUND_NAMES.forEach(loadBuffer);
  if (typeof window !== 'undefined') {
    ['pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach((ev) =>
      window.addEventListener(ev, unlock, { capture: true, passive: true }));
  }
}

function playBuffer(buf) {
  const c = getCtx();
  if (!c || !buf) return;
  if (c.state === 'suspended') c.resume();
  try {
    const src = c.createBufferSource();
    src.buffer = buf;
    const gain = c.createGain();
    gain.gain.value = clampVol(volume);
    src.connect(gain).connect(c.destination);
    src.start(0);
  } catch { /* ignore */ }
}

export function playSound(name) {
  if (muted || !name) return;
  const buf = buffers[name];
  if (buf) playBuffer(buf);
  else loadBuffer(name);  // not ready/missing → silent now, ready next time
}

// Sequential queue — used only for the draw→turn chain so click, draw, and
// turn-pass sounds play one after another instead of all at once.
let queue = [];
let pumping = false;
export function enqueueSound(name) {
  if (muted || !name) return;
  queue.push(name);
  if (!pumping) pump();
}
async function pump() {
  if (!queue.length) { pumping = false; return; }
  pumping = true;
  const name = queue.shift();
  let buf = buffers[name];
  if (buf === undefined) buf = await loadBuffer(name);  // wait so order is kept
  const c = getCtx();
  if (!c || !buf) { setTimeout(pump, 40); return; }     // missing → small gap, continue
  if (c.state === 'suspended') c.resume();
  try {
    const src = c.createBufferSource();
    src.buffer = buf;
    const gain = c.createGain();
    gain.gain.value = clampVol(volume);
    src.connect(gain).connect(c.destination);
    let advanced = false;
    const next = () => { if (advanced) return; advanced = true; pump(); };
    src.onended = next;
    src.start(0);
    // Safety advance in case 'onended' is missed.
    setTimeout(next, (buf.duration * 1000) + 150);
  } catch { setTimeout(pump, 40); }
}

// Map server fx event types -> sound names.
const FX_SOUND = {
  BIG_BOY: 'bigboy', LAWN_MOWER: 'lawnmower', GET_GOOSED: 'getgoosed',
  GOOSE_GANG: 'goosegang', TRADE: 'trade', ANNOUNCE: 'announce',
  TURN: 'turn', WIN: 'win', PENALTY: 'goosednoannounce', ABSORB: 'goosed',
};
export function fxSound(type) { return FX_SOUND[type] || null; }

// Per-card draw sounds (Goose=1, Geese=2, Geeses=4).
const DRAW_SOUND = { GOOSE: 'drawgoose', GEESE: 'drawgeese', GEESES: 'drawgeeses' };
export function drawSound(kind) { return DRAW_SOUND[kind] || null; }

export function setMuted(v) { muted = !!v; localStorage.setItem('goose_muted', muted ? '1' : '0'); }
export function isMuted() { return muted; }
export function setVolume(v) { volume = clampVol(v); localStorage.setItem('goose_vol', String(volume)); }
export function getVolume() { return volume; }
