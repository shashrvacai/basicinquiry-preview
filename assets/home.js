/*
 * Basic Inquiry home page: one time axis. The past is a 3D field of drawings above the centre
 * line, upcoming sessions run downward below it, "today" sticks at the line.
 *
 * The field is the scene of "Infinite Canvas" by Edoardo Lunardi for Codrops
 * (https://tympanus.net/Tutorials/InfiniteCanvas/ , github.com/edoardolunardi/infinite-canvas,
 * MIT licence, (c) Codrops): its three.js camera (fov 60, z 50), fog (120 to 320), depth fade
 * (140 to 260), plane sizes (12 to 20 units), density (5 per 110-unit chunk), seeded layout,
 * fade-in and easing (lerp 0.16), mouse drift. Only the axis changes: page scroll moves the
 * camera up into the past instead of the wheel flying it forward. One cluster per past day.
 *
 * Data: assets/events.json (refresh-calendar.py, today-60 .. today+60 days) and
 * assets/sketchbook.json (demo images: Cai's sketchbook). No bundler; three is vendored and
 * imported on demand, GSAP core (window.gsap) only moves the bar.
 */
const BOOK_URL = 'https://www.scratchconsortium.com/alain2020/robostrar/';
const SIGN_IN_URL = BOOK_URL;   // Robostrar member login for now; drawing-club's sign-in later
const ADDRESS = '1011 Main Street, Vancouver, BC V6A 4L4';
const MAPS = 'https://www.google.com/maps/search/?api=1&query=1011+Main+Street+Vancouver+BC';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (sel, el = document) => el.querySelector(sel);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
};

// ---------- dates ----------
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const hm = (t) => { const [H, M] = t.split(':').map(Number); return (H % 12 || 12) + (M ? ':' + pad(M) : '') + ' ' + (H < 12 ? 'am' : 'pm'); };
const span = (e) => e.allDay ? 'All day' : hm(e.start) + (e.until && e.until > e.start ? ' to ' + hm(e.until) : '');
const longDate = (s) => parse(s).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
const shortDate = (s) => parse(s).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
const now = new Date();
const TODAY = iso(now);
const NOW_HM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

// ---------- session types ----------
function classify(e) {
  const t = e.title;
  if (e.allDay || /exhibit/i.test(t)) return { key: 'exhibit', label: 'Exhibit', plain: true };
  if (/^gallery opening reception/i.test(t)) return { key: 'reception', label: 'Reception', plain: true };
  if (/^gallery/i.test(t)) return { key: 'gallery', label: 'Gallery', plain: true };
  if (/^elp/i.test(t)) return { key: 'elp', label: 'ELP', plain: false };
  if (/portrait/i.test(t)) return { key: 'portrait', label: 'Portrait', plain: false };
  if (/gesture/i.test(t)) return { key: 'gesture', label: 'Gesture', plain: false };
  if (/multiday/i.test(t)) return { key: 'multiday', label: 'Multiday', plain: false };
  if (/long-?pose/i.test(t)) return { key: 'longpose', label: 'Long pose', plain: false };
  if (/regular/i.test(t)) return { key: 'regular', label: 'Regular', plain: false };
  return { key: 'other', label: 'Session', plain: false };
}
// Standing descriptions, verbatim from the society's weekly schedule (site/index-full.html),
// keyed by weekday (0 = Sunday) and start hour; then by type from its FAQ.
const SLOT_DESC = {
  '1-18': '1, 2, 5 & 10 minute warm ups, three ½ hour poses.',
  '2-10': '1, 2, 5 & 10 minute warm ups, three ½ hour poses.',
  '2-18': 'A clothed, seated, 3-hour pose. A row of donkeys and easels will be arranged in a semi-circle so each artist has a clear view of the model’s face.',
  '3-19': '2 to 5 minute poses.',
  '4-10': 'A changing variety of short and medium gestures, followed by several longer poses.',
  '4-19': '1, 2, 5 & 10 minute warm ups, three ½ hour poses.',
  '5-19': 'Same pose for three hours. When the same model is scheduled for two consecutive Fridays, the same pose will appear on both, creating a six-hour painting opportunity.',
  '6-10': '1, 2, 5 & 10 minute warm ups, then several longer poses.',
  '0-10': '30 minutes of warm-ups followed by a single two-hour pose.',
  '0-14': '½, 1, 2 and 5 minute poses for three hours.',
};
const TYPE_DESC = {
  gesture: 'A Gesture session is composed of many short, dynamic poses. This session is great for fast anatomy study and repetitive drawing exercise.',
  longpose: 'A Long Pose session is composed of only one pose, to which the model returns after each break. This is great for paintings or more detailed and developed studies.',
  multiday: 'A Long Pose session is composed of only one pose, to which the model returns after each break. This is great for paintings or more detailed and developed studies.',
  regular: 'Regular sessions mix poses of varying lengths, some short, some fast.',
};
function describe(e, type) {
  if (type.plain || type.key === 'elp') return null;    // nothing on record for these
  const slot = e.start ? `${parse(e.date).getDay()}-${Number(e.start.split(':')[0])}` : '';
  const fromSlot = SLOT_DESC[slot];
  const typeOk = fromSlot && (type.key !== 'portrait' || slot === '2-18') && (type.key !== 'gesture' || slot === '3-19' || slot === '0-14');
  return (typeOk ? fromSlot : null) || TYPE_DESC[type.key] || null;
}
const titleParts = (t) => t.split(/\s*\|\s*/);

// ---------- dialog: one shell for images and session details ----------
const dlg = h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title', hidden: true },
  h('div', { class: 'dlg-scrim' }),
  h('div', { class: 'dlg-body' }),
  h('button', { type: 'button', class: 'pill dlg-close', text: 'Close' }));
document.body.append(dlg);
const dlgBody = $('.dlg-body', dlg), dlgScrim = $('.dlg-scrim', dlg), dlgClose = $('.dlg-close', dlg);
let open = null;   // { returnFocus, origin, img, pushed }
const EASE = 'cubic-bezier(.2,.7,.1,1)';

function openDialog(content, { returnFocus, origin, img, onClose } = {}) {
  if (open) {   // swap what the open dialog shows (a day -> one of its drawings), same history entry
    open.onClose?.();
    dlgBody.replaceChildren(...content);
    Object.assign(open, { returnFocus: returnFocus || open.returnFocus, origin, img, onClose });
    dlgClose.focus({ preventScroll: true });
    if (!reduced && img && origin) img.animate(flip(origin, img.getBoundingClientRect()), { duration: 520, easing: EASE });
    return;
  }
  dlgBody.replaceChildren(...content);
  dlg.hidden = false;
  dlg.classList.add('dlg-arming');
  setTimeout(() => dlg.classList.remove('dlg-arming'), 350);   // the opening tap must not land inside
  document.documentElement.style.overflow = 'hidden';
  open = { returnFocus, origin, img, onClose };
  history.pushState({ biDialog: true }, '');
  open.pushed = true;
  dlgClose.focus({ preventScroll: true });
  if (reduced || !img || !origin) return;
  const to = img.getBoundingClientRect();
  img.animate(flip(origin, to), { duration: 520, easing: EASE });
  dlgScrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, easing: 'ease-out' });
}
function flip(from, to) {
  const dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2);
  return [{ transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width})` }, { transform: 'none' }];
}
function requestClose() {
  if (!open) return;
  if (open.pushed && history.state && history.state.biDialog) history.back();   // popstate closes
  else closeNow();
}
function closeNow() {
  if (!open) return;
  const { returnFocus, onClose } = open;
  open = null;
  onClose?.();
  dlg.hidden = true;
  document.documentElement.style.overflow = '';
  returnFocus?.focus({ preventScroll: true });
}
addEventListener('popstate', () => { if (open) { open.pushed = false; closeNow(); } });
dlgClose.addEventListener('click', requestClose);
let scrimDown = false;
dlgScrim.addEventListener('pointerdown', () => { scrimDown = true; });
dlgScrim.addEventListener('pointerup', () => { if (scrimDown) requestClose(); scrimDown = false; });
dlg.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); requestClose(); return; }
  if (e.key !== 'Tab') return;
  const f = [...dlg.querySelectorAll('a[href], button')];
  const i = f.indexOf(document.activeElement);
  e.preventDefault();
  f[(i + (e.shiftKey ? f.length - 1 : 1) + f.length) % f.length].focus();
});

function showSession(e, type, returnFocus) {
  const parts = titleParts(e.title);
  const isPast = e.date < TODAY || (e.date === TODAY && !e.allDay && (e.until || e.start) <= NOW_HM);
  const desc = describe(e, type);
  const when = e.allDay && e.end ? `${longDate(e.date)} to ${longDate(e.end)}` : `${longDate(e.date)}, ${span(e)}`;
  const content = [
    poster(type),
    h('h2', { class: 'dlg-title', id: 'dlg-title', text: parts[0] }),
    parts.length > 1 ? h('p', { class: 'dlg-text', text: parts.slice(1).join(' · ') }) : null,
    h('p', { class: 'dlg-label ui', text: when + (e.cancelled ? ' · Cancelled' : '') }),
    desc ? h('p', { class: 'dlg-text', text: desc }) : null,
    h('p', { class: 'dlg-text small' }, h('a', { href: MAPS, text: ADDRESS })),
    !type.plain && !e.cancelled && !isPast
      ? h('a', { class: 'pill pill-solid', href: BOOK_URL, title: 'Opens Robostrar, our booking system', text: 'Book this' }, h('span', { class: 'sr-only', text: ' (opens Robostrar)' }))
      : null,
  ].filter(Boolean);
  openDialog(content, { returnFocus });
}

function poster(type) {
  return h('div', { class: `poster ${type.key}`, 'aria-hidden': 'true' }, h('span', { text: type.label }), h('small', { text: 'Basic Inquiry' }));
}

// ---------- upcoming ----------
function renderUpcoming(events, root) {
  const last = events.reduce((m, e) => (e.end || e.date) > m ? (e.end || e.date) : m, '');
  const weekOut = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 6));
  if (last < weekOut) return false;   // stale: the static Robostrar line in the markup stays
  const items = [];
  for (const e of events) {
    if (e.allDay) {
      const end = e.end || e.date;
      if (end < TODAY) continue;
      items.push({ ...e, showOn: e.date < TODAY ? TODAY : e.date });
    } else if (e.date > TODAY || (e.date === TODAY && (e.until || e.start) > NOW_HM)) {
      items.push({ ...e, showOn: e.date });
    }
  }
  items.sort((a, b) => a.showOn.localeCompare(b.showOn) || (a.allDay ? -1 : b.allDay ? 1 : (a.start || '').localeCompare(b.start || '')));
  const days = new Map();
  for (const it of items) { if (!days.has(it.showOn)) days.set(it.showOn, []); days.get(it.showOn).push(it); }
  const tomorrow = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const frag = [];
  for (const [d, list] of days) {      // empty days never appear: only days with rows exist here
    const name = d === TODAY ? 'Today' : d === tomorrow ? 'Tomorrow' : parse(d).toLocaleDateString('en-CA', { weekday: 'long' });
    const sec = h('section', { class: 'day', 'aria-label': `${name}, ${longDate(d)}` },
      h('h2', { class: 'day-h ui', tabindex: '-1' }, h('b', { text: name }), h('span', { text: parse(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) })));
    for (const e of list) {
      const type = classify(e);
      const parts = titleParts(e.title);
      const ongoing = e.allDay && e.date < d;
      const when = e.allDay ? (e.end ? `On the walls until ${parse(e.end).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}` : 'All day') : span(e);
      const view = h('button', { type: 'button', class: 'pill', text: 'View', 'aria-label': `View ${parts[0]}, ${longDate(e.date)}` });
      view.addEventListener('click', () => showSession(e, type, view));
      const actions = h('div', { class: 'sess-actions' },
        !type.plain && !e.cancelled
          ? h('a', { class: 'pill pill-solid', href: BOOK_URL, title: 'Opens Robostrar, our booking system' }, 'Book this', h('span', { class: 'sr-only', text: ` ${parts[0]}, ${longDate(e.date)} ${span(e)} (opens Robostrar)` }))
          : null,
        view);
      sec.append(h('article', { class: `sess${type.plain ? ' plain' : ''}${e.cancelled ? ' cancelled' : ''}` },
        poster(type),
        h('div', {},
          h('h3', { class: 'sess-t', text: (ongoing ? 'On the walls: ' : '') + parts[0] + (parts.length > 1 && type.key !== 'gallery' ? ' · ' + parts.slice(1).join(' · ') : '') }),
          h('p', { class: 'sess-when' }, h('time', { text: when }), e.cancelled ? h('span', { class: 'cancel-tag', text: ' Cancelled' }) : null)),
        actions));
    }
    frag.push(sec);
  }
  root.replaceChildren(...frag);
  return true;
}


function showImage(origin, item, returnFocus, onClose) {
  const maxW = Math.min(innerWidth * 0.88, 680), maxH = innerHeight - 270;
  const k = Math.max(0.2, Math.min(maxW / item.w, maxH / item.h, 2));
  const big = h('img', { class: 'dlg-img', src: item.src, alt: `Drawing from Cai's sketchbook, "${item.post.title}"`, width: item.w, height: item.h });
  big.style.width = `${Math.round(item.w * k)}px`; big.style.height = `${Math.round(item.h * k)}px`;
  const content = [
    big,
    h('p', { class: 'dlg-label ui', id: 'dlg-title', text: "Demo: Cai's sketchbook" }),
    h('p', { class: 'dlg-text', text: `${item.session.title} · ${longDate(item.session.date)}` }),
    h('p', { class: 'dlg-text small' }, 'From ', h('a', { href: item.post.href, target: '_blank', rel: 'noopener', text: item.post.title })),
  ];
  openDialog(content, { returnFocus, origin, img: big, onClose });
}

// One past day: its sessions, and its drawings as buttons (the keyboard way to the drawings).
function showDay(cluster, returnFocus) {
  const sessions = cluster.sessions.map((s) => {
    const type = classify(s);
    const v = h('button', { type: 'button', class: 'pview', text: 'View', 'aria-label': `View ${s.title}` });
    v.addEventListener('click', () => showSession(s, type, returnFocus));
    return h('li', {}, h('b', { text: s.title }), ` · ${span(s)} `, v);
  });
  const thumbs = cluster.items.map((it, i) => {
    const b = h('button', { type: 'button', class: 'thumb', 'aria-label': `Drawing ${i + 1} of ${cluster.items.length}, ${it.session.title}. Demo: Cai's sketchbook` },
      h('img', { src: it.src, width: it.w, height: it.h, alt: '' }));
    b.addEventListener('click', () => showImage(b.querySelector('img').getBoundingClientRect(), it, returnFocus));
    return b;
  });
  openDialog([
    h('h2', { class: 'dlg-title', id: 'dlg-title', text: longDate(cluster.date) }),
    h('ul', { class: 'day-list' }, sessions),
    h('div', { class: 'thumbs' }, thumbs),
    h('p', { class: 'dlg-label ui', text: "Drawings: demo from Cai's sketchbook" }),
  ], { returnFocus });
}

// ---------- the past: the demo's 3D field, travelled vertically ----------
// Values from the demo's constants.ts / scene.tsx / utils.ts (Codrops Infinite Canvas):
const CHUNK_SIZE = 110;            // a chunk is a 110-unit cube
const PLANES_PER_CHUNK = 5;        // holding 5 drawings: the demo's density
const DEPTH_FADE_START = 140, DEPTH_FADE_END = 260, INVIS = 0.01;
const VELOCITY_LERP = 0.16;        // the demo's easing toward a moving target
const OPACITY_LERP = 0.18;         // its plane fade-in
const CAMERA_Z = 50, FOV = 60, NEAR = 1, FAR = 500, FOG_NEAR = 120, FOG_FAR = 320;
const DRIFT = 8.0, DRIFT_LERP = 0.12;   // its mouse drift (desktop only)
const DEPTH_CHUNKS = 2;            // the demo shows planes up to its render distance of 2 chunks deep
const DAY_GAP = 18;                // breathing room between two days, in world units
const seededRandom = (seed) => { const x = Math.sin(seed * 9999) * 10000; return x - Math.floor(x); };
const hashString = (str) => { let v = 0; for (let i = 0; i < str.length; i++) v = ((v << 5) - v + str.charCodeAt(i)) | 0; return Math.abs(v); };
const visH = (d) => 2 * d * Math.tan((FOV / 2) * Math.PI / 180);

const field = $('#field'), capsLayer = $('#field-caps'), pastEl = $('#past'), lineEl = $('#centre');
let THREE_ = null, renderer = null, scene = null, camera = null, GEOM = null, placeholder = null;
let pastDays = [], sessionIndex = new Map(), posts = [];
const clusters = [];               // { k, date, sessions, items, y0, H, seed, planes:null|[], cap:null|el }
let worldTop = 0;                  // world y of the top of the last built cluster
let wpp = 1;                       // world units per CSS pixel at the focal plane (z = 0)
const cam = { x: 0, y: 0, tx: 0, ty: 0, drift: { x: 0, y: 0 }, mouse: { x: 0, y: 0 }, touch: false };
const textures = new Map();
let inFlight = 0;

// the field's width at its middle depth (the frustum widens with depth, as in the demo)
function slabWidth() { return Math.max(CHUNK_SIZE, visH(CAMERA_Z - 40 + CHUNK_SIZE * DEPTH_CHUNKS / 2) * (innerWidth / innerHeight)); }   // never narrower than one chunk
function clusterHeight(n) {
  // keep the demo's density: (110^3 / 5) units of space per drawing
  const perDrawing = (CHUNK_SIZE ** 3 / PLANES_PER_CHUNK) / (slabWidth() * CHUNK_SIZE * DEPTH_CHUNKS);
  return Math.max(30, n * perDrawing);
}

function addCluster() {
  const k = clusters.length, D = pastDays.length;
  const day = pastDays[k % D], lap = Math.floor(k / D);
  const items = [];
  for (const s of day.sessions) {
    const g = sessionIndex.get(s) + lap * sessionIndex.size;
    const post = posts[g % posts.length];
    const n = 3 + (g % 4);   // 3 to 6 drawings per session
    for (const im of post.imgs.slice(0, n)) items.push({ src: im.src, w: im.w, h: im.h, post, session: s });
  }
  const H = clusterHeight(items.length);
  const c = { k, lap, date: day.date, sessions: day.sessions, items, y0: worldTop + (k === 0 ? 14 : DAY_GAP), H, seed: hashString(`${day.date}#${lap}`), planes: null, cap: null };
  worldTop = c.y0 + H;
  clusters.push(c);
  return c;
}

function buildPlanes(c) {
  const vw = innerWidth / innerHeight;
  c.planes = c.items.map((it, i) => {
    const s = c.seed + i * 1000, r = (n) => seededRandom(s + n);
    const size = 12 + r(4) * 8;                                   // the demo's plane size: 12 to 20 units
    // depth: from just in front of the lens to two chunks out, as in the demo. A day's first
    // drawing is anchored at the bottom of its cluster at mid-depth, so the line always has
    // that day's work right above it (on a phone the demo's density spreads a day over two screens).
    const first = i === 0;
    const z = first ? 40 - 0.35 * CHUNK_SIZE * DEPTH_CHUNKS : 40 - r(2) * CHUNK_SIZE * DEPTH_CHUNKS;
    const d = CAMERA_Z - z;
    const aspect = it.w / it.h;
    // x is uniform across the field whatever the depth, as in the demo's chunks, so a drawing
    // close to the lens is usually off to one side and the middle stays airy
    const x = first ? (r(0) - 0.5) * Math.max(0, visH(d) * vw - size * aspect) * 0.8 : (r(0) - 0.5) * slabWidth();
    const y = c.y0 + size / 2 + (first ? 0 : r(1)) * Math.max(0, c.H - size);
    const mat = new THREE_.MeshBasicMaterial({ color: placeholder.clone(), transparent: true, opacity: 0, side: THREE_.DoubleSide, depthWrite: false });
    const mesh = new THREE_.Mesh(GEOM, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(size * aspect, size, 1);
    mesh.visible = false;
    const p = { mesh, mat, item: it, cluster: c, opacity: 0, loaded: false, hidden: false, z };
    mesh.userData.p = p;
    scene.add(mesh);
    requestTexture(p);
    return p;
  });
}
function dropPlanes(c) {
  for (const p of c.planes) { scene.remove(p.mesh); p.mat.dispose(); p.removed = true; const t = textures.get(p.item.src); t?.waiters.delete(p); }
  c.planes = null;
  if (c.cap) { c.cap.remove(); c.cap = null; }
}

// textures: nearest first, six at a time, released when no plane near the camera uses them
function requestTexture(p) {
  const url = p.item.src;
  let t = textures.get(url);
  if (!t) { t = { tex: null, state: 'queued', waiters: new Set() }; textures.set(url, t); }
  if (t.state === 'ready') { applyTex(p, t.tex); return; }
  t.waiters.add(p); pump();
}
function pump() {
  while (inFlight < 6) {
    let best = null, bestUrl = null, bestD = Infinity;
    for (const [url, t] of textures) {
      if (t.state !== 'queued' || !t.waiters.size) continue;
      let dmin = Infinity;
      for (const p of t.waiters) dmin = Math.min(dmin, Math.abs(p.mesh.position.y - cam.y) + Math.abs(p.z) * 0.2);
      if (dmin < bestD) { bestD = dmin; best = t; bestUrl = url; }
    }
    if (!best) return;
    best.state = 'loading'; inFlight++;
    const img = new Image(); img.decoding = 'async'; img.src = bestUrl;
    const t = best;
    img.decode().then(() => {
      const tex = new THREE_.Texture(img);
      tex.colorSpace = THREE_.SRGBColorSpace; tex.minFilter = THREE_.LinearMipmapLinearFilter; tex.magFilter = THREE_.LinearFilter;
      tex.generateMipmaps = true; tex.anisotropy = 4; tex.needsUpdate = true;
      t.tex = tex; t.state = 'ready';
      for (const p of t.waiters) applyTex(p, tex);
      t.waiters.clear();
    }).catch(() => { t.state = 'error'; t.waiters.clear(); }).finally(() => { inFlight--; pump(); });
  }
}
function applyTex(p, tex) { if (p.removed) return; p.mat.map = tex; p.mat.color.set('#ffffff'); p.mat.needsUpdate = true; p.loaded = true; }
function releaseTextures() {
  const used = new Set();
  for (const c of clusters) if (c.planes) for (const p of c.planes) used.add(p.item.src);
  for (const [url, t] of textures) if (!used.has(url) && t.state === 'ready') { t.tex.dispose(); textures.delete(url); }
}

function layoutSpacer() {
  wpp = visH(CAMERA_Z) / innerHeight;
  pastEl.style.height = `${Math.ceil(worldTop / wpp + innerHeight * 0.6)}px`;
}
function growSpacer() {
  const before = pastEl.offsetHeight;
  layoutSpacer();
  const dh = pastEl.offsetHeight - before;
  if (dh > 0) scrollTo(0, scrollY + dh);   // new days go on top: keep the view where it is
}

// the camera's target: how far the centre line sits below the middle of the screen
function lineOffsetPx() { const r = lineEl.getBoundingClientRect(); return r.top + r.height / 2 - innerHeight / 2; }

function screenRect(p) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const v = new THREE_.Vector3(), hw = p.mesh.scale.x / 2, hh = p.mesh.scale.y / 2;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    v.set(p.mesh.position.x + sx * hw, p.mesh.position.y + sy * hh, p.z).project(camera);
    const px = (v.x + 1) / 2 * innerWidth, py = (1 - v.y) / 2 * innerHeight;
    x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
  }
  return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
}

const raycaster = { r: null, v: null };
function pickAt(x, y) {
  if (!raycaster.r) { raycaster.r = new THREE_.Raycaster(); raycaster.v = new THREE_.Vector2(); }
  raycaster.v.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  raycaster.r.setFromCamera(raycaster.v, camera);
  const meshes = [];
  for (const c of clusters) if (c.planes) for (const p of c.planes) if (p.mesh.visible && p.loaded && p.opacity > 0.3) meshes.push(p.mesh);
  const hit = raycaster.r.intersectObjects(meshes, false)[0];
  return hit ? hit.object.userData.p : null;
}
function selectPlane(p) {
  const origin = screenRect(p);
  p.hidden = true; p.mesh.visible = false;
  showImage(origin, p.item, null, () => { p.hidden = false; });
}

function placeCaption(c, v) {
  if (!c.cap) {
    c.cap = h('button', { type: 'button', class: 'daycap ui', text: parse(c.date).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }),
      'aria-label': `${longDate(c.date)}: ${c.sessions.map((s) => s.title).join(', ')}. Open the day` });
    c.cap.addEventListener('click', () => showDay(c, c.cap));
    c.cap.addEventListener('focus', () => {   // bring a focused day into view
      const off = (c.y0 + c.H / 2 - cam.y) / wpp;
      if (Math.abs(off) > innerHeight * 0.35) scrollTo({ top: scrollY - off, behavior: reduced ? 'auto' : 'smooth' });
    });
    // DOM order newest first, so Tab walks back in time
    const next = clusters.slice(0, c.k).reverse().find((o) => o.cap);
    if (next) next.cap.after(c.cap); else capsLayer.prepend(c.cap);
  }
  // the caption sits under the day's cluster, on the focal plane
  v.set(-(visH(CAMERA_Z) * innerWidth / innerHeight) / 2 * 0.86, c.y0 - 2, 0).project(camera);
  const px = Math.max(12, (v.x + 1) / 2 * innerWidth), py = (1 - v.y) / 2 * innerHeight;
  c.cap.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
}

function frame() {
  requestAnimationFrame(frame);
  const off = lineOffsetPx();
  const fieldVisible = off > -innerHeight * 0.5;
  cam.ty = off * wpp;
  if (reduced) { cam.x = cam.tx; cam.y = cam.ty; }
  else { cam.x += (cam.tx - cam.x) * VELOCITY_LERP; cam.y += (cam.ty - cam.y) * VELOCITY_LERP; }
  if (!reduced && !cam.touch && !draggingX) {
    cam.drift.x += (cam.mouse.x * DRIFT - cam.drift.x) * DRIFT_LERP;
    cam.drift.y += (cam.mouse.y * DRIFT - cam.drift.y) * DRIFT_LERP;
  } else if (cam.touch || reduced) { cam.drift.x *= 0.88; cam.drift.y *= 0.88; }
  if (!fieldVisible || open) { return; }
  camera.position.set(cam.x + cam.drift.x, cam.y + cam.drift.y, CAMERA_Z);

  // endless: when the camera nears the top of what is built, add the next lap
  const view = visH(DEPTH_FADE_END);
  while (pastDays.length && worldTop < cam.y + view * 1.5) addCluster();
  if (pastEl.offsetHeight < worldTop / wpp + innerHeight * 0.3) growSpacer();

  const v = new THREE_.Vector3();
  const near = view * 1.2, far = view * 3;
  for (const c of clusters) {
    const dy = Math.max(c.y0 - cam.y, cam.y - (c.y0 + c.H), 0);
    if (dy < near && !c.planes) buildPlanes(c);
    else if (dy > far && c.planes) dropPlanes(c);
    if (!c.planes) continue;
    for (const p of c.planes) {
      const depth = CAMERA_Z - p.z;
      const depthFade = depth <= DEPTH_FADE_START ? 1 : Math.max(0, 1 - (depth - DEPTH_FADE_START) / (DEPTH_FADE_END - DEPTH_FADE_START));
      const target = depthFade * depthFade;
      p.opacity = reduced ? target : p.opacity + (target - p.opacity) * OPACITY_LERP;
      const opaque = p.opacity > 0.99;
      p.mat.opacity = opaque ? 1 : p.opacity; p.mat.depthWrite = opaque;
      p.mesh.visible = p.opacity > INVIS && !p.hidden;
    }
    const capOn = Math.abs(c.y0 - cam.y) < visH(CAMERA_Z) * 0.75;
    if (capOn) placeCaption(c, v); else if (c.cap && c.cap !== document.activeElement) { c.cap.remove(); c.cap = null; }
  }
  if (++frameCount % 120 === 0) releaseTextures();
  renderer.render(scene, camera);
}
let frameCount = 0;
if (location.search.includes('debug')) window.__bi = () => {
  let built = 0, vis = 0, crisp = 0;
  const f = new THREE_.Frustum().setFromProjectionMatrix(new THREE_.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  for (const c of clusters) if (c.planes) for (const p of c.planes) { built++; if (p.mesh.visible && f.containsPoint(p.mesh.position)) { vis++; if (p.opacity > 0.5) crisp++; } }
  return { tx: cam.tx, point: (() => { for (const c of clusters) if (c.planes) for (const p of c.planes) { if (!p.loaded || p.opacity < 0.9 || !p.mesh.visible) continue; const r = screenRect(p); const x = r.left + r.width / 2, y = r.top + r.height / 2; if (x > 30 && x < innerWidth - 30 && y > 30 && y < innerHeight - 140 && pickAt(x, y) === p) return { x, y }; } return null; })(), clusters: clusters.length, H: clusters.slice(0, 5).map((c) => [c.items.length, Math.round(c.H)]), built, vis, crisp, camY: Math.round(cam.y), worldTop: Math.round(worldTop) };
};

// ---------- pointer: tap a drawing, drag sideways (bounded), drift with the mouse ----------
let draggingX = false;
function setupPointer(canvas) {
  let down = null;
  const room = () => visH(CAMERA_Z) * (innerWidth / innerHeight) * 0.12;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cam.touch = e.pointerType !== 'mouse';
    down = { x: e.clientX, y: e.clientY, t: performance.now(), tx: cam.tx, horiz: null, max: 0, id: e.pointerId };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') { cam.mouse.x = (e.clientX / innerWidth) * 2 - 1; cam.mouse.y = -(e.clientY / innerHeight) * 2 + 1; }
    if (!down || e.pointerId !== down.id) {
      if (e.pointerType === 'mouse') canvas.style.cursor = pickAt(e.clientX, e.clientY) ? 'pointer' : 'grab';
      return;
    }
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    down.max = Math.max(down.max, Math.hypot(dx, dy));
    if (down.horiz === null && down.max > 6) down.horiz = Math.abs(dx) > Math.abs(dy);
    if (down.horiz) { draggingX = true; const R = room(); cam.tx = Math.max(-R, Math.min(R, down.tx - dx * wpp)); }
  });
  const end = (e, cancelled) => {
    if (!down || e.pointerId !== down.id) return;
    const tap = !cancelled && down.max < 6 && performance.now() - down.t < 300;
    down = null; draggingX = false;
    if (tap) { const p = pickAt(e.clientX, e.clientY); if (p) selectPlane(p); }
  };
  canvas.addEventListener('pointerup', (e) => end(e, false));
  canvas.addEventListener('pointercancel', (e) => end(e, true));
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { cam.mouse.x = 0; cam.mouse.y = 0; } });
  canvas.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { e.preventDefault(); const R = room(); cam.tx = Math.max(-R, Math.min(R, cam.tx + e.deltaX * wpp)); }
  }, { passive: false });
}

// ---------- the bar: bottom while you are in the past, top while you are in upcoming ----------
const bar = $('#bar');
let barSide = 'bottom';
function placeBar(force) {
  const off = lineOffsetPx();
  const side = off > 40 ? 'bottom' : off < -40 ? 'top' : barSide;
  if (side === barSide && !force) return;
  const before = bar.getBoundingClientRect().top;
  barSide = side;
  document.body.dataset.bar = side;
  if (force || reduced || !window.gsap) return;
  const after = bar.getBoundingClientRect().top;
  window.gsap.fromTo(bar, { y: before - after }, { y: 0, duration: 0.45, ease: 'power3.inOut', overwrite: true });
}

// ---------- landing, cues ----------
let landingY = 0, userMoved = false;
function centre() {
  landingY = Math.max(0, Math.round(scrollY + lineOffsetPx()));
  scrollTo(0, landingY);
}
['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((t) => addEventListener(t, () => { userMoved = true; }, { passive: true, once: true }));
addEventListener('scroll', () => {
  placeBar(false);
  if (userMoved && Math.abs(scrollY - landingY) > 140) document.body.classList.add('cues-off');
}, { passive: true });

let lastW = innerWidth, lastH = innerHeight, rz = 0;
addEventListener('resize', () => {
  clearTimeout(rz);
  rz = setTimeout(() => {
    if (!renderer) return;
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    if (innerWidth === lastW && Math.abs(innerHeight - lastH) < 120) { lastH = innerHeight; layoutSpacer(); return; }   // mobile toolbar: keep the layout
    lastW = innerWidth; lastH = innerHeight;
    const y = cam.ty;
    for (const c of clusters) if (c.planes) dropPlanes(c);
    clusters.length = 0; worldTop = 0;
    while (pastDays.length && worldTop < y + visH(DEPTH_FADE_END) * 2) addCluster();
    layoutSpacer();
    scrollTo(0, scrollY + lineOffsetPx() - y / wpp);
  }, 200);
});

// ---------- Book a session ----------
$('#book').addEventListener('click', (e) => {
  e.preventDefault();
  const first = document.querySelector('#upcoming .day-h') || $('#upcoming');
  const root = getComputedStyle(document.documentElement);
  const offset = parseFloat(root.getPropertyValue('--bar-h')) + parseFloat(root.getPropertyValue('--today-h')) + 4;
  scrollTo({ top: first.getBoundingClientRect().top + scrollY - offset, behavior: reduced ? 'auto' : 'smooth' });
  first.focus?.({ preventScroll: true });
});
$('#signin').href = SIGN_IN_URL;

// ---------- boot ----------
async function boot() {
  history.scrollRestoration = 'manual';
  let events = null, sketch = [];
  try { events = (await (await fetch('assets/events.json', { cache: 'no-cache' })).json()).events; } catch (e) { events = null; }
  try { sketch = await (await fetch('assets/sketchbook.json')).json(); } catch (e) { sketch = []; }
  posts = [...sketch].sort((a, b) => b.date.localeCompare(a.date))
    .map((p) => ({ title: p.title, date: p.date, href: 'https://shashrvacai.com/blog/' + p.slug, imgs: p.imgs }));

  let past = [];
  if (events) {
    renderUpcoming(events, $('#upcoming-list'));
    const lo = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60));
    past = events.filter((e) => !e.allDay && !e.cancelled && !classify(e).plain && e.date >= lo &&
      (e.date < TODAY || (e.date === TODAY && (e.until || e.start) <= NOW_HM)))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.start || '').localeCompare(a.start || ''));
  }
  past.forEach((s, i) => sessionIndex.set(s, i));
  const byDay = new Map();
  for (const s of past) { if (!byDay.has(s.date)) byDay.set(s.date, []); byDay.get(s.date).push(s); }
  pastDays = [...byDay].map(([date, sessions]) => ({ date, sessions: sessions.slice().reverse() }));   // a day reads in clock order
  if (!pastDays.length || !posts.length) { pastDays = []; $('#cue-up').hidden = true; }

  try {
    THREE_ = await import('./vendor/three.module.min.js');
    renderer = new THREE_.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  } catch (e) { renderer = null; }
  if (renderer && pastDays.length) {
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, touch ? 1.25 : 1.5));   // the demo's dpr caps
    renderer.setSize(innerWidth, innerHeight);
    renderer.domElement.className = 'field-canvas';
    field.prepend(renderer.domElement);
    scene = new THREE_.Scene();
    scene.background = new THREE_.Color('#ffffff');
    scene.fog = new THREE_.Fog('#ffffff', FOG_NEAR, FOG_FAR);
    camera = new THREE_.PerspectiveCamera(FOV, innerWidth / innerHeight, NEAR, FAR);
    camera.position.set(0, 0, CAMERA_Z);
    GEOM = new THREE_.PlaneGeometry(1, 1);
    placeholder = new THREE_.Color('#f0eeec');
    for (let i = 0; i < pastDays.length; i++) addCluster();
    layoutSpacer();
    setupPointer(renderer.domElement);
  } else {
    pastEl.style.height = '0px';
  }

  centre();
  placeBar(true);
  document.fonts?.ready.then(() => { if (!userMoved) { centre(); placeBar(true); } });
  if (renderer && pastDays.length) {
    cam.y = cam.ty = lineOffsetPx() * wpp;
    requestAnimationFrame(frame);
    // the loader leaves once the drawings on the first screen are decoded (and one pass has played)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const firstUrls = new Set();
    for (const c of clusters) if (c.planes) for (const p of c.planes) {
      const r = screenRect(p);
      if (r.top + r.height > 0 && r.top < innerHeight && r.left + r.width > 0 && r.left < innerWidth) firstUrls.add(p.item.src);
    }
    const t0 = performance.now();
    while (performance.now() - t0 < 8000) {
      if ([...firstUrls].every((u) => { const t = textures.get(u); return !t || t.state === 'ready' || t.state === 'error'; })) break;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  performance.mark?.('home-ready');
  window.BILoader?.ready();
}
boot().catch((e) => { console.error(e); window.BILoader?.ready(); });

