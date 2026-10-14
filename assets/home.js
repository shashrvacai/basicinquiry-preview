/*
 * Basic Inquiry home page: one time axis. The past sits above the centre line as a wall of
 * drawings, one block per day, newest nearest today; upcoming sessions run downward below it
 * as floating tiles. The today line and the bar are one sticky block in the page.
 *
 * The wall (Cai 10-13, replacing the Codrops 3D field): a drawing whose spot is high above
 * waits small and scattered in the sky at the top of the screen and falls into its spot as the
 * page scrolls up; scrolling down lifts it back into the sky. GSAP drives the ticker and the
 * easing; the look (white page, DM Sans + Asul, the brown accent) is still the Codrops
 * "Infinite Canvas" demo's (Edoardo Lunardi, MIT, (c) Codrops).
 *
 * Data: assets/events.json (refresh-calendar.py, today-60 .. today+60 days) and
 * assets/sketchbook.json (demo images: Cai's sketchbook). No bundler.
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
        h('div', { class: 'sess-body' },
          h('h3', { class: 'sess-t', text: (ongoing ? 'On the walls: ' : '') + parts[0] + (parts.length > 1 && type.key !== 'gallery' ? ' · ' + parts.slice(1).join(' · ') : '') }),
          h('p', { class: 'sess-when' }, h('time', { text: when }), e.cancelled ? h('span', { class: 'cancel-tag', text: ' Cancelled' }) : null),
          actions)));
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

// ---------- the past: drawings in the sky that fall into a wall ----------
// Cai 10-13: the past is a wall of thumbnails stacked at the bottom of the screen, newest day
// nearest today. A drawing whose spot on the wall is still high up waits small and scattered
// in the sky at the top of the screen; as the page scrolls up its spot comes down, and it
// falls into place like a brick in a falling-block game. Scrolling down lifts the bricks back
// into the sky. The fall is scrubbed by the scroll, each brick with its own start and finish
// so they land one after another, and eased toward the target so it never jerks.
const pastEl = $('#past'), lineEl = $('#centre');
let pastDays = [], sessionIndex = new Map(), posts = [];
let days = [];                     // { date, sessions, items, el, cap, bricks, last }
let bricks = [];                   // { el, slot, item, top, cx, w, h, A, B, sky, u, drawn }
let laps = 0;
const MAX_LAPS = 8;
const GAP = 6;
const rowH = () => innerWidth < 600 ? 92 : 128;
const wallW = () => Math.min(innerWidth - 32, 1100);
const fall = window.gsap ? window.gsap.parseEase('power2.out') : (t) => t;   // fast from afar, settling as it arrives
const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;

function dayItems(day, lap) {
  const items = [];
  for (const s of day.sessions) {
    const g = sessionIndex.get(s) + lap * sessionIndex.size;
    const post = posts[g % posts.length];
    const n = 3 + (g % 4);   // 3 to 6 drawings per session
    for (const im of post.imgs.slice(0, n)) items.push({ src: im.src, w: im.w, h: im.h, post, session: s });
  }
  return items;
}

// justified rows, no overlap; the short row goes on top of the day, the way a stack is built
function rowsFor(items) {
  const W = wallW(), H = rowH(), rows = [];
  let row = [], sum = 0;
  for (const it of items) {
    row.push(it); sum += H * it.w / it.h;
    if (sum + GAP * (row.length - 1) >= W) {
      const k = (W - GAP * (row.length - 1)) / sum;
      rows.push(row.map((x) => ({ it: x, w: H * x.w / x.h * k, h: H * k })));
      row = []; sum = 0;
    }
  }
  if (row.length) rows.push(row.map((x) => ({ it: x, w: H * x.w / x.h, h: H })));
  return rows.reverse();
}

let lazy = null;
function buildDay(d) {
  const block = h('div', { class: 'wday' });
  const rows = rowsFor(d.items);
  d.bricks = [];
  rows.forEach((row, ri) => {
    const r = h('div', { class: 'wrow' });
    for (const { it, w, h: hh } of row) {
      const slot = h('div', { class: 'slot' });
      slot.style.width = `${w.toFixed(1)}px`; slot.style.height = `${hh.toFixed(1)}px`;
      const btn = h('button', { type: 'button', class: 'brick', 'aria-label': `Drawing, ${it.session.title}, ${longDate(d.date)}. Demo: Cai's sketchbook` },
        h('img', { alt: '', width: it.w, height: it.h, 'data-src': it.src, decoding: 'async' }));
      btn.addEventListener('click', () => showImage(btn.getBoundingClientRect(), it, btn));
      slot.append(btn); r.append(slot);
      const b = { el: btn, slot, item: it, w, h: hh, u: reduced ? 1 : 0, drawn: -1, last: ri === rows.length - 1 };
      d.bricks.push(b);
      lazy?.observe(slot);
    }
    block.append(r);
  });
  d.cap = h('button', { type: 'button', class: 'daycap ui', text: shortDate(d.date),
    'aria-label': `${longDate(d.date)}: ${d.sessions.map((s) => s.title).join(', ')}. Open the day` });
  d.cap.addEventListener('click', () => showDay(d, d.cap));
  block.append(d.cap);
  d.el = block;
  return block;
}

// seeded per brick: where it waits, and the stretch of scroll its approach takes.
// Cai 10-13: three rows sit landed above the bar; a drawing still to come waits out of
// sight above the top edge, small and faded as in the Codrops depth, and comes toward the
// reader as the page scrolls up, growing into its spot.
const FALL = 0.6;                    // the approach takes this much of a screen of scroll
const ROWS_LANDED = 3;
let landLine = 0.45;                 // set each frame: the centre of the third row above the bar, as a share of the screen
let rowPos = [];                     // every row's centre, page coordinates, top to bottom
let pitch = 120;                     // average distance between row centres, day gaps included
function arm(b, i) {
  const r = (n) => seededRandom(hashString(b.item.src) + i * 31 + n);
  b.j = r(1) * 0.015;                // a hair of stagger, never enough to cross a neighbour
  // Cai 10-13: no overlap in the air. Each drawing comes straight down its own column from
  // above the screen, shrunk about its own centre, so neighbours stay side by side.
  b.sky = { y: -0.12, s: 0.5 };
}
const seededRandom = (seed) => { const x = Math.sin(seed * 9999) * 10000; return x - Math.floor(x); };
const hashString = (str) => { let v = 0; for (let i = 0; i < str.length; i++) v = ((v << 5) - v + str.charCodeAt(i)) | 0; return Math.abs(v); };

function measure() {
  const sy = scrollY;
  rowPos = [...pastEl.querySelectorAll('.wrow')].map((r) => { const b = r.getBoundingClientRect(); return b.top + sy + b.height / 2; });
  if (rowPos.length > 1) pitch = (rowPos[rowPos.length - 1] - rowPos[0]) / (rowPos.length - 1);
  for (const b of bricks) {
    const r = b.slot.getBoundingClientRect();
    b.top = r.top + sy; b.cx = r.left + r.width / 2;
  }
}

function buildWall() {
  const D = pastDays.length;
  days = []; bricks = [];
  const frag = [];
  for (let lap = laps; lap >= 0; lap--)         // oldest lap on top
    for (let i = D - 1; i >= 0; i--) {          // oldest day on top, newest nearest today
      const d = { ...pastDays[i], lap, items: dayItems(pastDays[i], lap) };
      frag.push(buildDay(d)); days.push(d);
    }
  pastEl.replaceChildren(...frag);
  bricks = days.flatMap((d) => d.bricks);
  bricks.forEach(arm);
  measure();
}

// one more lap of the two months on top when the reader nears the top of the wall
function growWall() {
  if (laps >= MAX_LAPS || !pastDays.length) return;
  laps++;
  const before = pastEl.offsetHeight;
  const D = pastDays.length, frag = [], added = [];
  for (let i = D - 1; i >= 0; i--) {
    const d = { ...pastDays[i], lap: laps, items: dayItems(pastDays[i], laps) };
    frag.push(buildDay(d)); added.push(d);
  }
  pastEl.prepend(...frag);
  const dh = pastEl.offsetHeight - before;
  scrollTo(0, scrollY + dh);
  days = [...added, ...days];
  const fresh = added.flatMap((d) => d.bricks);
  fresh.forEach(arm);
  bricks = [...fresh, ...bricks];
  measure();
}

function tick() {
  if (open) return;
  const vh = innerHeight, sy = scrollY;
  if (sy < vh * 1.5) growWall();
  // three rows stay landed above the bar. The line moves with the bar, never jumps a row at a
  // time (a jumping line made whole rows snap): the third row's centre, by the average pitch.
  const barTop = Math.min(vh, $('#dock').getBoundingClientRect().top);
  landLine = Math.max(0.1, (barTop - (ROWS_LANDED - 0.5) * pitch) / vh);
  for (const b of bricks) {
    const cy = b.top + b.h / 2 - sy;
    const B = landLine - b.j, A = B - FALL;
    const target = reduced ? 1 : clamp01((cy - A * vh) / (FALL * vh));
    if (cy > vh * 2 && b.drawn === 1 && target === 1) continue;     // landed far below: nothing to do
    if (target === 0 && b.drawn === 0) { b.u = 0; continue; }       // still out of sight above
    b.u += (target - b.u) * 0.18;
    if (Math.abs(target - b.u) < 0.002) b.u = target;
    const u = b.u;
    if (u === 1) {
      if (b.drawn !== 1) { b.el.style.transform = ''; b.el.style.opacity = ''; b.el.style.visibility = ''; b.el.style.pointerEvents = ''; b.el.classList.remove('flying'); b.drawn = 1; }
      continue;
    }
    if (u === 0) { b.el.style.visibility = 'hidden'; b.drawn = 0; continue; }
    const e = fall(u), k = 1 - e;
    const dy = (b.sky.y * vh - cy) * k;
    const s = b.sky.s + (1 - b.sky.s) * e;
    if (b.drawn === 1 || b.drawn === 0 || b.drawn === -1) { b.el.style.visibility = ''; b.el.style.pointerEvents = 'none'; b.el.classList.add('flying'); }   // only landed drawings take taps
    b.el.style.opacity = Math.min(1, u / 0.45).toFixed(3);          // faded while far, full as it arrives
    b.el.style.transform = `translate3d(0, ${dy.toFixed(1)}px, 0) scale(${s.toFixed(3)})`;
    b.drawn = u;
  }
  // a day's date shows once its bottom row has landed
  for (const d of days) {
    const row = d.bricks.filter((b) => b.last);
    const u = row.reduce((a, b) => a + b.u, 0) / (row.length || 1);
    const o = clamp01((u - 0.6) / 0.4);
    if (d.capO !== o) { d.cap.style.opacity = o.toFixed(2); d.capO = o; }
  }
}

// the line's distance below the middle of the screen
function lineOffsetPx() { const r = lineEl.getBoundingClientRect(); return r.top + r.height / 2 - innerHeight / 2; }

// ---------- landing, cues ----------
let landingY = 0, userMoved = false;
function centre() {
  landingY = Math.max(0, Math.round(scrollY + lineOffsetPx()));
  scrollTo(0, landingY);
}
['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((t) => addEventListener(t, () => { userMoved = true; }, { passive: true, once: true }));
addEventListener('scroll', () => {
  if (userMoved && Math.abs(scrollY - landingY) > 140) document.body.classList.add('cues-off');
}, { passive: true });

let lastW = innerWidth, rz = 0;
addEventListener('resize', () => {
  clearTimeout(rz);
  rz = setTimeout(() => {
    if (!bricks.length) return;
    if (innerWidth === lastW) { measure(); return; }   // mobile toolbar: rows stay, spots re-read
    lastW = innerWidth;
    const off = lineOffsetPx();
    buildWall();
    if (!userMoved) centre(); else scrollTo(0, scrollY + lineOffsetPx() - off);
  }, 200);
});

// ---------- Book a session ----------
$('#book').addEventListener('click', (e) => {
  e.preventDefault();
  const first = document.querySelector('#upcoming .day-h') || $('#upcoming');
  const offset = $('#dock').offsetHeight + 4;
  scrollTo({ top: first.getBoundingClientRect().top + scrollY - offset, behavior: reduced ? 'auto' : 'smooth' });
  first.focus?.({ preventScroll: true });
});
$('#signin').href = SIGN_IN_URL;

// ---------- BI: back to today ----------
$('#home').addEventListener('click', () => {
  scrollTo({ top: Math.max(0, Math.round(scrollY + lineOffsetPx())), behavior: reduced ? 'auto' : 'smooth' });
});

// ---------- About (words from the current site) ----------
$('#about').addEventListener('click', (e) => {
  openDialog([
    h('h2', { class: 'dlg-title', id: 'dlg-title', text: 'Welcome to Basic Inquiry' }),
    h('p', { class: 'dlg-text', text: 'The Vancouver Life Drawing Society is a not-for-profit, volunteer-run organization focusing on providing high quality life drawing sessions, gallery shows, and educational opportunities to its members. Everyone is welcome, from beginners to seasoned artists!' }),
    h('p', { class: 'dlg-text', text: 'All sessions are three hours with several breaks. Usually attendance is about 10–20 people, a mix of new and experienced artists. Drawing happens in silence; the breaks are a good time to meet people.' }),
    h('p', { class: 'dlg-text small' }, h('a', { href: MAPS, text: ADDRESS }), ' · ', h('a', { href: 'tel:+16046812855', text: '604.681.2855' }), ' · ', h('a', { href: 'mailto:board@lifedrawing.org', text: 'board@lifedrawing.org' })),
    h('p', { class: 'dlg-text small' }, h('a', { href: 'https://www.instagram.com/basicinquiry/', text: 'Instagram' }), ' · ', h('a', { href: 'https://www.facebook.com/basicinquiry', text: 'Facebook' })),
  ], { returnFocus: e.currentTarget });
});

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

  if (pastDays.length) {
    // pictures load as their spot nears the screen (a screen's worth above and below)
    lazy = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) {
        const img = en.target.querySelector('img');
        if (img?.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; }
        lazy.unobserve(en.target);
      }
    }, { rootMargin: '120% 0px 120% 0px' });
    buildWall();
  } else {
    $('#cue-up').hidden = true;
  }

  centre();
  measure();
  document.fonts?.ready.then(() => { if (!userMoved) { centre(); measure(); } });
  if (bricks.length) {
    (window.gsap ? window.gsap.ticker.add(tick) : (function loop() { tick(); requestAnimationFrame(loop); })());
    // the loader leaves once the newest drawings, the ones nearest today, are decoded
    const near = bricks.slice(-24).map((b) => b.el.querySelector('img'));
    await Promise.race([
      Promise.all(near.map((img) => (img.dataset.src ? (img.src = img.dataset.src, delete img.dataset.src) : 0, img.decode().catch(() => {})))),
      new Promise((r) => setTimeout(r, 6000)),
    ]);
  }
  performance.mark?.('home-ready');
  window.BILoader?.ready();
}
boot().catch((e) => { console.error(e); window.BILoader?.ready(); });

