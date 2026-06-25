// Sound manager for Quit Goosin' Around!
// Maps named events to files in public/sounds/<name>.<ext>. Files are optional:
// drop your own audio in and it plays automatically; until then everything is
// silently a no-op. Mute + volume persist in localStorage.

const SOUND_NAMES = [
  'click', 'drawgoose', 'drawgeese', 'drawgeeses', 'honk', 'bigboy',
  'lawnmower', 'getgoosed', 'goosegang', 'turn', 'win', 'lose',
  'trade', 'announce', 'goosed', 'goosednoannounce',
];
const EXTS = ['mp3', 'ogg', 'wav', 'm4a'];

const resolved = {};   // name -> url string | null (probed once)
const probing = {};    // name -> true while in flight

let muted = localStorage.getItem('goose_muted') === '1';
let volume = parseFloat(localStorage.getItem('goose_vol') ?? '0.7');

function probe(name) {
  if (resolved[name] !== undefined || probing[name]) return;
  probing[name] = true;
  let i = 0;
  const tryNext = () => {
    if (i >= EXTS.length) { resolved[name] = null; probing[name] = false; return; }
    const url = `sounds/${name}.${EXTS[i++]}`;
    const a = new Audio();
    a.preload = 'auto';
    a.addEventListener('canplaythrough', () => { resolved[name] = url; probing[name] = false; }, { once: true });
    a.addEventListener('error', tryNext, { once: true });
    a.src = url;
  };
  tryNext();
}

export function initAudio() { SOUND_NAMES.forEach(probe); }

// --- Autoplay unlock -----------------------------------------------------
// Browsers block Audio.play() on a fresh HTTPS origin until the user has
// interacted with the page (localhost is exempt, which is why sounds work
// locally but go silent when deployed). Most of our sounds fire from
// WebSocket events (turn, Big Boy, draws) — outside any click handler — so
// they hit that block. On the first real user gesture we "prime" playback by
// starting a real (muted) clip inside the gesture; that grants the document
// playback permission so later event-driven sounds are allowed.
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  const url = resolved['click'] || Object.values(resolved).find(Boolean);
  if (!url) { probe('click'); return; } // nothing resolved yet — retry next gesture
  try {
    const a = new Audio(url);
    a.volume = 0;
    a.play().then(() => { audioUnlocked = true; a.pause(); a.currentTime = 0; }).catch(() => {});
  } catch { /* ignore */ }
}
if (typeof window !== 'undefined') {
  ['pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach((ev) =>
    window.addEventListener(ev, unlockAudio, { capture: true, passive: true }));
}

export function playSound(name) {
  if (muted || !name) return;
  const url = resolved[name];
  if (!url) { probe(name); return; } // not ready / missing → silent
  try {
    const a = new Audio(url);
    a.volume = Math.max(0, Math.min(1, volume));
    a.play().catch(() => {}); // ignore autoplay rejections
  } catch { /* ignore */ }
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
let waited = 0;
function pump() {
  if (!queue.length) { pumping = false; return; }
  pumping = true;
  const name = queue[0]; // peek — don't drop a sound that's still loading
  const url = resolved[name];
  if (url === undefined) {
    // Still probing this file. Wait briefly (so the chain stays in order)
    // rather than skipping ahead to the next sound (which made `turn` play
    // before `drawgoose` had finished loading). Give up after ~1.2s.
    probe(name);
    if (waited < 1200) { waited += 80; setTimeout(pump, 80); return; }
  }
  waited = 0;
  queue.shift();
  if (!url) { setTimeout(pump, 40); return; } // confirmed missing → small gap, continue
  let advanced = false;
  const next = () => { if (advanced) return; advanced = true; pump(); };
  try {
    const a = new Audio(url);
    a.volume = Math.max(0, Math.min(1, volume));
    a.addEventListener('ended', next, { once: true });
    a.addEventListener('error', () => setTimeout(next, 40), { once: true });
    a.play().then(() => {
      // Safety advance in case 'ended' is missed.
      const ms = (isFinite(a.duration) && a.duration > 0 ? a.duration * 1000 : 1500) + 150;
      setTimeout(next, ms);
    }).catch(() => setTimeout(next, 40));
  } catch { setTimeout(next, 40); }
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
export function setVolume(v) { volume = Math.max(0, Math.min(1, v)); localStorage.setItem('goose_vol', String(volume)); }
export function getVolume() { return volume; }
