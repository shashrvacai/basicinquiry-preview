/*
 * Basic Inquiry infinite canvas.
 *
 * A vanilla three.js reimplementation of "Infinite Canvas" by Edoardo Lunardi for Codrops
 * (demo https://tympanus.net/Tutorials/InfiniteCanvas/ , source
 * https://github.com/edoardolunardi/infinite-canvas). MIT licence,
 * Copyright (c) 2009-2025 Codrops. The chunk tiling, the seeded plane layout, the fade
 * model and the motion constants below follow the original; the React Three Fiber
 * wrapper is replaced by plain three.js so this file ports anywhere without a bundler.
 *
 * Added for Basic Inquiry (not in the demo):
 *  - tap / click selects a drawing (pointer events; under 6px and 300ms is a tap),
 *    the drawing lifts out of the field into a focused view with its post title, date
 *    and blog link; Esc, the close button, a tap outside or the back gesture put it back
 *  - Tab reaches the drawings (one focus target per post, the camera glides to one of
 *    its sketches and rings it), Enter selects
 *  - a placeholder tone while a sketch loads, a prioritised texture queue (what is on
 *    screen first, six requests at a time), and an onReady hook once the first screen
 *    of sketches is decoded
 *  - prefers-reduced-motion: no inertia, no mouse drift, instant select
 *
 * Usage:
 *   import { mountInfiniteCanvas } from './canvas.js';
 *   mountInfiniteCanvas(rootEl, { media, posts, onReady });
 *   media: [{ url, w, h, post }]   post: index into posts
 *   posts: [{ title, date (YYYY-MM-DD), href }]
 */
import * as THREE from './vendor/three.module.min.js';

// --- constants (from the demo's constants.ts) --------------------------------------
const CHUNK_SIZE = 110;
const RENDER_DISTANCE = 2;
const CHUNK_FADE_MARGIN = 1;
const MAX_VELOCITY = 3.2;
const DEPTH_FADE_START = 140;
const DEPTH_FADE_END = 260;
const INVIS_THRESHOLD = 0.01;
const KEYBOARD_SPEED = 0.18;
const VELOCITY_LERP = 0.16;
const VELOCITY_DECAY = 0.9;
const INITIAL_CAMERA_Z = 50;
const ITEMS_PER_CHUNK = 5;

// --- additions ---------------------------------------------------------------------
const TAP_MAX_PX = 6;
const TAP_MAX_MS = 300;
const MAX_IN_FLIGHT = 6;
const READY_TIMEOUT_MS = 10000;
const PICK_MIN_OPACITY = 0.3;

const CHUNK_OFFSETS = (() => {
  const max = RENDER_DISTANCE + CHUNK_FADE_MARGIN, out = [];
  for (let dx = -max; dx <= max; dx++)
    for (let dy = -max; dy <= max; dy++)
      for (let dz = -max; dz <= max; dz++)
        out.push({ dx, dy, dz });
  return out;
})();

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const seededRandom = (seed) => { const x = Math.sin(seed * 9999) * 10000; return x - Math.floor(x); };
const hashString = (str) => { let h = 0; for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0; return Math.abs(h); };

function generateChunkPlanes(cx, cy, cz) {
  const seed = hashString(`${cx},${cy},${cz}`), planes = [];
  for (let i = 0; i < ITEMS_PER_CHUNK; i++) {
    const s = seed + i * 1000, r = (n) => seededRandom(s + n);
    planes.push({
      x: cx * CHUNK_SIZE + r(0) * CHUNK_SIZE,
      y: cy * CHUNK_SIZE + r(1) * CHUNK_SIZE,
      z: cz * CHUNK_SIZE + r(2) * CHUNK_SIZE,
      size: 12 + r(4) * 8,
      mediaIndex: Math.floor(r(5) * 1_000_000),
    });
  }
  return planes;
}

const isTouchDevice = () =>
  'ontouchstart' in window || navigator.maxTouchPoints > 0 || (matchMedia?.('(pointer: coarse)').matches ?? false);

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const formatDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };

export function mountInfiniteCanvas(root, { media, posts, onReady } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touch = isTouchDevice();
  const css = getComputedStyle(root);
  const BG = css.getPropertyValue('--ic-bg').trim() || '#ffffff';
  const PLACEHOLDER = css.getPropertyValue('--ic-placeholder').trim() || '#f0eeec';

  let readyFired = false;
  const fireReady = () => { if (!readyFired) { readyFired = true; performance.mark?.('ic-ready'); onReady?.(); } };

  // --- renderer ----------------------------------------------------------------------
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  } catch (e) {
    renderFallback(root, media, posts);
    fireReady();
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, touch ? 1.25 : 1.5));
  renderer.setSize(root.clientWidth, root.clientHeight);
  const canvas = renderer.domElement;
  canvas.className = 'ic-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  root.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 120, 320);
  const camera = new THREE.PerspectiveCamera(60, root.clientWidth / root.clientHeight, 1, 500);
  camera.position.set(0, 0, INITIAL_CAMERA_Z);
  const GEOMETRY = new THREE.PlaneGeometry(1, 1);
  const placeholderColor = new THREE.Color(PLACEHOLDER);
  const white = new THREE.Color('#ffffff');

  // --- textures: cache + prioritised queue ------------------------------------------
  const textures = new Map();     // url -> { tex, state: 'queued'|'loading'|'ready'|'error', waiters:Set<plane>, prio }
  let inFlight = 0;
  const frustum = new THREE.Frustum();
  const projScreen = new THREE.Matrix4();
  const tmpV = new THREE.Vector3();

  function updateFrustum() {
    camera.updateMatrixWorld();
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
  }
  const sphere = new THREE.Sphere();
  function nearView(plane) {
    sphere.center.set(plane.d.x, plane.d.y, plane.d.z);
    sphere.radius = plane.d.size * 1.5 + 12;   // a margin so a sketch is in hand before it slides into view
    return frustum.intersectsSphere(sphere);
  }
  function inView(plane) { tmpV.set(plane.d.x, plane.d.y, plane.d.z); return frustum.containsPoint(tmpV); }

  function requestTexture(plane) {
    const url = plane.media.url;
    let t = textures.get(url);
    const prio = Math.abs(plane.d.z - s.base.z) + (inView(plane) ? 0 : 1000);
    if (!t) {
      t = { tex: null, state: 'queued', waiters: new Set(), prio };
      textures.set(url, t);
    }
    if (t.state === 'ready') { applyTexture(plane, t.tex); return; }
    t.waiters.add(plane);
    if (t.state === 'queued') t.prio = Math.min(t.prio, prio);
    pump();
  }
  function pump() {
    while (inFlight < MAX_IN_FLIGHT) {
      let best = null, bestUrl = null;
      for (const [url, t] of textures) {
        if (t.state !== 'queued' || !t.waiters.size) continue;
        if (!best || t.prio < best.prio) { best = t; bestUrl = url; }
      }
      if (!best) return;
      load(bestUrl, best);
    }
  }
  function load(url, t) {
    t.state = 'loading'; inFlight++;
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    img.decode().then(() => {
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      t.tex = tex; t.state = 'ready';
      for (const p of t.waiters) applyTexture(p, tex);
      t.waiters.clear();
      checkFirstScreen();
    }).catch(() => { t.state = 'error'; t.waiters.clear(); checkFirstScreen(); })
      .finally(() => { inFlight--; pump(); });
  }
  function applyTexture(plane, tex) {
    if (plane.removed) return;
    plane.mat.map = tex;
    plane.mat.color.copy(white);
    plane.mat.needsUpdate = true;
    plane.loaded = true;
  }

  // --- chunks ------------------------------------------------------------------------
  const chunks = new Map();  // key -> { cx, cy, cz, planes }
  const allPlanes = new Set();

  function addChunk(cx, cy, cz) {
    const key = `${cx},${cy},${cz}`;
    const planes = generateChunkPlanes(cx, cy, cz).map((d, i) => {
      const m = media[d.mediaIndex % media.length];
      const aspect = m.w && m.h ? m.w / m.h : 1;
      const mat = new THREE.MeshBasicMaterial({ color: placeholderColor.clone(), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(GEOMETRY, mat);
      mesh.position.set(d.x, d.y, d.z);
      mesh.scale.set(d.size * aspect, d.size, 1);
      mesh.visible = false;
      const plane = { id: `${key}-${i}`, d, media: m, mesh, mat, cx, cy, cz, opacity: 0, requested: false, loaded: false, hidden: false, removed: false };
      mesh.userData.plane = plane;
      scene.add(mesh);
      allPlanes.add(plane);
      return plane;
    });
    chunks.set(key, { cx, cy, cz, planes });
  }
  function removeChunk(key) {
    const c = chunks.get(key);
    for (const p of c.planes) {
      p.removed = true;
      scene.remove(p.mesh);
      p.mat.dispose();
      allPlanes.delete(p);
      const t = textures.get(p.media.url);
      if (t) t.waiters.delete(p);
    }
    chunks.delete(key);
  }
  function setChunkCentre(cx, cy, cz) {
    const want = new Set(CHUNK_OFFSETS.map((o) => `${cx + o.dx},${cy + o.dy},${cz + o.dz}`));
    for (const key of [...chunks.keys()]) if (!want.has(key)) removeChunk(key);
    for (const o of CHUNK_OFFSETS) {
      const k = `${cx + o.dx},${cy + o.dy},${cz + o.dz}`;
      if (!chunks.has(k)) addChunk(cx + o.dx, cy + o.dy, cz + o.dz);
    }
  }

  // --- controller state (the demo's ControllerState) ---------------------------------
  const s = {
    vel: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 },
    base: { x: 0, y: 0, z: INITIAL_CAMERA_Z }, drift: { x: 0, y: 0 },
    mouse: { x: 0, y: 0 }, scrollAccum: 0, dragging: false,
    grid: { cx: 0, cy: 0, cz: 0 }, lastChunkKey: '', lastChunkUpdate: 0, pendingChunk: null,
    fly: null, frozen: false,
  };
  const keys = new Set();
  const pointers = new Map();   // id -> { x, y }
  let tap = null;               // { id, x0, y0, t0, max }
  let pinchDist = 0;
  let hoverDirty = false, hoverPos = null;

  setChunkCentre(0, 0, 0);
  s.lastChunkKey = '0,0,0';

  // --- input ---------------------------------------------------------------------------
  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', (e) => {
    if (s.frozen) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    s.fly = null;
    if (pointers.size === 1) {
      s.dragging = true;
      tap = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), max: 0 };
      canvas.style.cursor = 'grabbing';
    } else if (pointers.size === 2) {
      tap = null;
      pinchDist = pinchDistance();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      s.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      s.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      if (!s.dragging) { hoverDirty = true; hoverPos = { x: e.clientX, y: e.clientY }; }
    }
    const p = pointers.get(e.pointerId);
    if (!p || s.frozen) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) {
      const k = e.pointerType === 'mouse' ? 0.025 : 0.02;
      s.target.x -= dx * k;
      s.target.y += dy * k;
      if (tap && tap.id === e.pointerId) tap.max = Math.max(tap.max, Math.hypot(e.clientX - tap.x0, e.clientY - tap.y0));
    } else if (pointers.size === 2 && pinchDist > 0) {
      const d = pinchDistance();
      s.scrollAccum += (pinchDist - d) * 0.006;
      pinchDist = d;
    }
  });
  const endPointer = (e, cancelled) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (!pointers.size) { s.dragging = false; canvas.style.cursor = 'grab'; }
    if (!cancelled && tap && tap.id === e.pointerId &&
        tap.max < TAP_MAX_PX && performance.now() - tap.t0 < TAP_MAX_MS) {
      const hit = pickAt(e.clientX, e.clientY);
      if (hit) select(hit, null);
    }
    if (tap && tap.id === e.pointerId) tap = null;
  };
  canvas.addEventListener('pointerup', (e) => endPointer(e, false));
  canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !s.dragging) { s.mouse.x = 0; s.mouse.y = 0; } });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (s.frozen) return;
    s.fly = null;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    s.scrollAccum += e.deltaY * unit * 0.006;
  }, { passive: false });
  // stop iOS Safari's own pinch-zoom / page bounce over the canvas
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  function pinchDistance() {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  const MOVE_KEYS = { w: 'f', arrowup: 'f', s: 'b', arrowdown: 'b', a: 'l', arrowleft: 'l', d: 'r', arrowright: 'r', e: 'u', q: 'dn' };
  const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  window.addEventListener('keydown', (e) => {
    const k = MOVE_KEYS[e.key.toLowerCase()];
    if (!k || s.frozen || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (root.closest('[inert]') || document.body.dataset.sheetOpen === '1') return;
    keys.add(k); s.fly = null;
    if (e.key.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { const k = MOVE_KEYS[e.key.toLowerCase()]; if (k) keys.delete(k); });
  window.addEventListener('blur', () => keys.clear());

  // --- picking ----------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pickAt(x, y) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const candidates = [];
    for (const p of allPlanes) if (p.mesh.visible && p.opacity > PICK_MIN_OPACITY && p.loaded) candidates.push(p.mesh);
    const hits = raycaster.intersectObjects(candidates, false);
    return hits.length ? hits[0].object.userData.plane : null;
  }

  // screen rectangle of a plane, from its four projected corners
  const corner = new THREE.Vector3();
  function screenRect(p) {
    const rect = canvas.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const hw = p.mesh.scale.x / 2, hh = p.mesh.scale.y / 2;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      corner.set(p.d.x + sx * hw, p.d.y + sy * hh, p.d.z).project(camera);
      const px = rect.left + (corner.x + 1) / 2 * rect.width;
      const py = rect.top + (1 - corner.y) / 2 * rect.height;
      x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
    }
    return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
  }

  // --- selection (the one addition Cai asked for) ------------------------------------------
  const lb = document.createElement('div');
  lb.className = 'ic-lb';
  lb.hidden = true;
  lb.setAttribute('role', 'dialog');
  lb.setAttribute('aria-modal', 'true');
  lb.setAttribute('aria-labelledby', 'ic-lb-title');
  lb.innerHTML = `
    <div class="ic-lb-scrim"></div>
    <figure class="ic-lb-fig">
      <img class="ic-lb-img" alt="">
      <figcaption class="ic-lb-cap">
        <h2 class="ic-lb-title" id="ic-lb-title"></h2>
        <time class="ic-lb-date"></time>
        <a class="ic-lb-link" target="_blank" rel="noopener">Read the sketchbook post</a>
      </figcaption>
    </figure>
    <button type="button" class="ic-lb-close">Close</button>`;
  document.body.appendChild(lb);
  const lbImg = lb.querySelector('.ic-lb-img');
  const lbScrim = lb.querySelector('.ic-lb-scrim');
  const lbCap = lb.querySelector('.ic-lb-cap');
  const lbClose = lb.querySelector('.ic-lb-close');
  const lbLink = lb.querySelector('.ic-lb-link');
  let selected = null;     // { plane, returnFocus, pushed }
  let closing = false;
  const EASE = 'cubic-bezier(.2,.7,.1,1)';

  function select(plane, returnFocus) {
    if (selected || closing) return;
    const post = posts[plane.media.post];
    s.frozen = true; s.dragging = false; pointers.clear(); tap = null; keys.clear();
    zeroMotion();
    const from = screenRect(plane);
    lbImg.src = plane.media.url;
    lbImg.alt = `Sketch from "${post.title}"`;
    // as large as the viewport allows under the caption, never past 2x the file's pixels
    const maxW = Math.min(window.innerWidth * 0.88, 680), maxH = window.innerHeight - 230;
    const k = Math.max(0.2, Math.min(maxW / plane.media.w, maxH / plane.media.h, 2));
    lbImg.width = plane.media.w; lbImg.height = plane.media.h;
    lbImg.style.width = `${Math.round(plane.media.w * k)}px`;
    lbImg.style.height = `${Math.round(plane.media.h * k)}px`;
    lb.querySelector('.ic-lb-title').textContent = post.title;
    const dt = lb.querySelector('.ic-lb-date');
    dt.textContent = formatDate(post.date); dt.dateTime = post.date;
    lbLink.href = post.href;
    lb.hidden = false;
    // ignore clicks for a beat: the tap that opened the dialog must not land on its link
    lb.classList.add('ic-lb-arming');
    setTimeout(() => lb.classList.remove('ic-lb-arming'), 400);
    plane.hidden = true; plane.mesh.visible = false;
    selected = { plane, returnFocus: returnFocus || null };
    history.pushState({ icSelected: true }, '');
    selected.pushed = true;
    lbClose.focus({ preventScroll: true });
    if (reduced) return;
    const to = lbImg.getBoundingClientRect();
    lbImg.animate(flip(from, to), { duration: 560, easing: EASE });
    lbScrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });
    for (const el of [lbCap, lbClose]) el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 360, delay: 220, easing: 'ease-out', fill: 'backwards' });
  }
  function flip(from, to) {
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const sc = from.width / to.width;
    return [{ transform: `translate(${dx}px, ${dy}px) scale(${sc})` }, { transform: 'none' }];
  }
  function requestClose() {
    if (!selected || closing) return;
    if (selected.pushed && history.state && history.state.icSelected) history.back();  // popstate closes
    else closeNow();
  }
  function closeNow() {
    if (!selected || closing) return;
    const { plane, returnFocus } = selected;
    const done = () => {
      lb.hidden = true; closing = false;
      plane.hidden = false;
      selected = null; s.frozen = false;
      (returnFocus || canvas.parentElement)?.focus?.({ preventScroll: true });
    };
    if (reduced || plane.removed) { done(); return; }
    closing = true;
    const to = screenRect(plane);
    const from = lbImg.getBoundingClientRect();
    const [a] = flip(to, from);
    const anim = lbImg.animate([{ transform: 'none' }, a], { duration: 420, easing: EASE, fill: 'forwards' });
    lbScrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, easing: 'ease-in', fill: 'forwards' });
    for (const el of [lbCap, lbClose]) el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
    anim.finished.then(() => {
      done();
      lb.getAnimations({ subtree: true }).forEach((x) => x.cancel());
    });
  }
  window.addEventListener('popstate', () => { if (selected) { selected.pushed = false; closeNow(); } });
  lbClose.addEventListener('click', requestClose);
  let scrimDown = false;
  lbScrim.addEventListener('pointerdown', () => { scrimDown = true; });
  lbScrim.addEventListener('pointerup', () => { if (scrimDown) requestClose(); scrimDown = false; });
  lb.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); requestClose(); }
    if (e.key === 'Tab') {   // keep focus inside the dialog: link <-> close
      const f = [lbLink, lbClose];
      const i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
    }
  });

  function zeroMotion() {
    s.vel.x = s.vel.y = s.vel.z = 0;
    s.target.x = s.target.y = s.target.z = 0;
    s.scrollAccum = 0; s.fly = null;
  }

  // --- keyboard reach: one focus target per post --------------------------------------------
  const ring = document.createElement('div');
  ring.className = 'ic-ring';
  ring.hidden = true;
  ring.innerHTML = '<span class="ic-ring-label"></span>';
  root.appendChild(ring);
  const ringLabel = ring.querySelector('.ic-ring-label');
  let focusPlane = null, focusBtn = null;

  const list = document.createElement('ol');
  list.className = 'ic-keys';
  list.setAttribute('aria-label', 'Drawings from the sketchbook');
  posts.forEach((post, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${post.title}, ${formatDate(post.date)}`;
    b.addEventListener('focus', () => focusPost(i, b));
    b.addEventListener('blur', () => { if (!selected) { focusPlane = null; focusBtn = null; ring.hidden = true; } });
    b.addEventListener('click', () => { const p = focusPlane || nearestOfPost(i, true); if (p && p.loaded) select(p, b); });
    li.appendChild(b);
    list.appendChild(li);
  });
  root.appendChild(list);

  function nearestOfPost(i, anywhere) {
    updateFrustum();
    let best = null, bestD = Infinity;
    for (const p of allPlanes) {
      if (p.media.post !== i) continue;
      const dz = s.base.z - p.d.z;
      if (dz < 15) continue;  // behind or too close to the camera
      const onScreen = p.opacity > 0.6 && p.loaded && inView(p);
      if (!anywhere && !onScreen) continue;
      const d = Math.hypot(p.d.x - s.base.x, p.d.y - s.base.y, dz) + (onScreen ? 0 : 500);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }
  function focusPost(i, btn) {
    if (s.frozen) return;
    focusBtn = btn;
    let p = nearestOfPost(i, false);
    if (!p) {
      p = nearestOfPost(i, true);
      if (p) s.fly = { x: p.d.x, y: p.d.y, z: p.d.z + 38 };
    }
    focusPlane = p;
    ringLabel.textContent = btn.textContent;
    if (p && !p.requested) { p.requested = true; requestTexture(p); }
  }

  // --- first screen readiness ----------------------------------------------------------
  let firstScreen = null;
  function checkFirstScreen() {
    if (readyFired || !firstScreen) return;
    for (const url of firstScreen) {
      const t = textures.get(url);
      if (!t || (t.state !== 'ready' && t.state !== 'error')) return;
    }
    fireReady();
  }
  setTimeout(fireReady, READY_TIMEOUT_MS);

  // --- frame loop (the demo's useFrame bodies) ------------------------------------------
  function frame(now) {
    requestAnimationFrame(frame);

    if (!s.frozen) {
      if (keys.has('f')) s.target.z -= KEYBOARD_SPEED;
      if (keys.has('b')) s.target.z += KEYBOARD_SPEED;
      if (keys.has('l')) s.target.x -= KEYBOARD_SPEED;
      if (keys.has('r')) s.target.x += KEYBOARD_SPEED;
      if (keys.has('dn')) s.target.y -= KEYBOARD_SPEED;
      if (keys.has('u')) s.target.y += KEYBOARD_SPEED;
    }

    const isZooming = Math.abs(s.vel.z) > 0.05;
    const zoomFactor = clamp(s.base.z / 50, 0.3, 2.0);
    const driftAmount = 8.0 * zoomFactor;
    const driftLerp = isZooming ? 0.2 : 0.12;
    if (s.dragging || s.frozen) { /* drift frozen */ }
    else if (touch || reduced) { s.drift.x = lerp(s.drift.x, 0, driftLerp); s.drift.y = lerp(s.drift.y, 0, driftLerp); }
    else { s.drift.x = lerp(s.drift.x, s.mouse.x * driftAmount, driftLerp); s.drift.y = lerp(s.drift.y, s.mouse.y * driftAmount, driftLerp); }

    if (reduced) {
      // No inertia: the world moves exactly as far as the hand did (the same total
      // distance the demo's decaying velocity would cover), then stops.
      const step = (v) => clamp(v * 10, -MAX_VELOCITY * 10, MAX_VELOCITY * 10);
      s.vel.x = step(s.target.x); s.vel.y = step(s.target.y);
      s.vel.z = clamp(s.target.z * 10 + s.scrollAccum * 50, -60, 60);
      s.target.x = s.target.y = s.target.z = 0; s.scrollAccum = 0;
    } else {
      s.target.z += s.scrollAccum;
      s.scrollAccum *= 0.8;
      s.target.x = clamp(s.target.x, -MAX_VELOCITY, MAX_VELOCITY);
      s.target.y = clamp(s.target.y, -MAX_VELOCITY, MAX_VELOCITY);
      s.target.z = clamp(s.target.z, -MAX_VELOCITY, MAX_VELOCITY);
      s.vel.x = lerp(s.vel.x, s.target.x, VELOCITY_LERP);
      s.vel.y = lerp(s.vel.y, s.target.y, VELOCITY_LERP);
      s.vel.z = lerp(s.vel.z, s.target.z, VELOCITY_LERP);
    }

    if (s.fly) {
      const k = reduced ? 1 : 0.08;
      s.base.x = lerp(s.base.x, s.fly.x, k); s.base.y = lerp(s.base.y, s.fly.y, k); s.base.z = lerp(s.base.z, s.fly.z, k);
      s.vel.x = s.vel.y = s.vel.z = 0;
      if (Math.hypot(s.base.x - s.fly.x, s.base.y - s.fly.y, s.base.z - s.fly.z) < 0.5) s.fly = null;
    } else if (!s.frozen) {
      s.base.x += s.vel.x; s.base.y += s.vel.y; s.base.z += s.vel.z;
    }
    camera.position.set(s.base.x + s.drift.x, s.base.y + s.drift.y, s.base.z);

    if (!reduced) {
      s.target.x *= VELOCITY_DECAY; s.target.y *= VELOCITY_DECAY; s.target.z *= VELOCITY_DECAY;
    }

    // chunk swap, throttled like the demo (100ms, 400ms while zooming, 500ms when fast)
    const cx = Math.floor(s.base.x / CHUNK_SIZE), cy = Math.floor(s.base.y / CHUNK_SIZE), cz = Math.floor(s.base.z / CHUNK_SIZE);
    s.grid = { cx, cy, cz };
    const key = `${cx},${cy},${cz}`;
    if (key !== s.lastChunkKey) { s.pendingChunk = { cx, cy, cz }; s.lastChunkKey = key; }
    const throttle = Math.abs(s.vel.z) > 1 ? 500 : isZooming ? 400 : 100;
    if (s.pendingChunk && now - s.lastChunkUpdate >= throttle) {
      const c = s.pendingChunk; s.pendingChunk = null; s.lastChunkUpdate = now;
      setChunkCentre(c.cx, c.cy, c.cz);
    }

    updateFrustum();
    updatePlanes();

    if (!firstScreen) {
      // what the visitor sees first: planes in front of the camera, inside the view,
      // inside the depth where the demo holds them fully opaque
      firstScreen = new Set();
      for (const p of allPlanes) {
        const depth = s.base.z - p.d.z;
        if (depth > 5 && depth < DEPTH_FADE_START && inView(p)) {
          firstScreen.add(p.media.url);
          if (!p.requested) { p.requested = true; requestTexture(p); }
        }
      }
      checkFirstScreen();
    }

    if (hoverDirty && !s.frozen) {
      hoverDirty = false;
      canvas.style.cursor = hoverPos && pickAt(hoverPos.x, hoverPos.y) ? 'pointer' : 'grab';
    }

    if (focusPlane && !selected) {
      if (focusPlane.removed) { focusPlane = null; ring.hidden = true; }
      else {
        const r = screenRect(focusPlane);
        ring.hidden = false;
        ring.style.transform = `translate(${r.left - 4}px, ${r.top - 4}px)`;
        ring.style.width = `${r.width + 8}px`;
        ring.style.height = `${r.height + 8}px`;
      }
    } else ring.hidden = true;

    renderer.render(scene, camera);
  }

  function updatePlanes() {
    const camZ = s.base.z, g = s.grid;
    for (const p of allPlanes) {
      const dist = Math.max(Math.abs(p.cx - g.cx), Math.abs(p.cy - g.cy), Math.abs(p.cz - g.cz));
      const absDepth = Math.abs(p.d.z - camZ);
      if (absDepth > DEPTH_FADE_END + 50) {
        p.opacity = 0; p.mat.opacity = 0; p.mat.depthWrite = false; p.mesh.visible = false;
        continue;
      }
      const gridFade = dist <= RENDER_DISTANCE ? 1 : Math.max(0, 1 - (dist - RENDER_DISTANCE) / CHUNK_FADE_MARGIN);
      const depthFade = absDepth <= DEPTH_FADE_START ? 1 : Math.max(0, 1 - (absDepth - DEPTH_FADE_START) / (DEPTH_FADE_END - DEPTH_FADE_START));
      const target = Math.min(gridFade, depthFade * depthFade);
      // lazy: a sketch is fetched only once its plane is near the view
      if (!p.requested && target > INVIS_THRESHOLD && nearView(p)) { p.requested = true; requestTexture(p); }
      p.opacity = target < INVIS_THRESHOLD && p.opacity < INVIS_THRESHOLD ? 0 : lerp(p.opacity, target, 0.18);
      const opaque = p.opacity > 0.99;
      p.mat.opacity = opaque ? 1 : p.opacity;
      p.mat.depthWrite = opaque;
      p.mesh.visible = p.opacity > INVIS_THRESHOLD && !p.hidden;
    }
  }

  // --- resize ----------------------------------------------------------------------------
  const resize = () => {
    const w = root.clientWidth, h = root.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(root);

  requestAnimationFrame(frame);

  return { select: (p) => select(p, null), close: requestClose, get state() { return s; }, pickAt, planes: allPlanes };
}

// No WebGL: a plain wall of sketches, each a link to its post.
function renderFallback(root, media, posts) {
  const wall = document.createElement('div');
  wall.className = 'ic-fallback';
  const seen = new Set();
  for (const m of media) {
    if (seen.has(m.post)) continue;
    seen.add(m.post);
    const p = posts[m.post];
    const a = document.createElement('a');
    a.href = p.href; a.target = '_blank'; a.rel = 'noopener';
    a.innerHTML = `<img src="${m.url}" width="${m.w}" height="${m.h}" loading="lazy" alt="">`;
    a.querySelector('img').alt = `Sketch from "${p.title}"`;
    wall.appendChild(a);
  }
  root.appendChild(wall);
}
