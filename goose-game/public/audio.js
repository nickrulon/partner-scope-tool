// Sound manager for Quit Goosin' Around!
// Maps named events to files in public/sounds/<name>.<ext>. Files are optional:
// drop your own audio in and it plays automatically; until then everything is
// silently a no-op. Mute + volume persist in localStorage.

const SOUND_NAMES = [
  'click', 'drawgoose', 'drawgeese', 'drawgeeses', 'honk', 'bigboy',
  'lawnmower', 'getgoosed', 'goosegang', 'turn', 'win', 'lose',
  'trade', 'announce', 'goosed',
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

// Map server fx event types -> sound names.
const FX_SOUND = {
  BIG_BOY: 'bigboy', LAWN_MOWER: 'lawnmower', GET_GOOSED: 'getgoosed',
  GOOSE_GANG: 'goosegang', TRADE: 'trade', ANNOUNCE: 'announce',
  TURN: 'turn', WIN: 'win', PENALTY: 'goosed', ABSORB: 'goosed',
};
export function fxSound(type) { return FX_SOUND[type] || null; }

// Per-card draw sounds (Goose=1, Geese=2, Geeses=4).
const DRAW_SOUND = { GOOSE: 'drawgoose', GEESE: 'drawgeese', GEESES: 'drawgeeses' };
export function drawSound(kind) { return DRAW_SOUND[kind] || null; }

export function setMuted(v) { muted = !!v; localStorage.setItem('goose_muted', muted ? '1' : '0'); }
export function isMuted() { return muted; }
export function setVolume(v) { volume = Math.max(0, Math.min(1, v)); localStorage.setItem('goose_vol', String(volume)); }
export function getVolume() { return volume; }
