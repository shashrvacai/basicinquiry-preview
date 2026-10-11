/*
 * Basic Inquiry home page: one time axis. Past sessions stack upward above the centre
 * line, upcoming sessions run downward below it, "today" sticks at the line.
 *
 * Look and motion after "Infinite Canvas" by Edoardo Lunardi for Codrops
 * (https://tympanus.net/Tutorials/InfiniteCanvas/ , github.com/edoardolunardi/infinite-canvas,
 * MIT licence, (c) Codrops): its palette, type and its scattered field of images. Here the
 * field runs vertically only: far above the line the drawings drift apart like the demo's
 * canvas; as a band of sessions comes down toward the centre it gathers into tidy columns
 * whose last images share one bottom edge (GSAP ScrollTrigger, scrubbed on scroll).
 *
 * Data: assets/events.json (refresh-calendar.py, today-60 .. today+60 days) and
 * assets/sketchbook.json (demo images: Cai's sketchbook, one post per past session).
 * No bundler. GSAP + ScrollTrigger come from the page's <script> tags (window.gsap).
 */
(function () {
  'use strict';

  const BOOK_URL = 'https://www.scratchconsortium.com/alain2020/robostrar/';
  const SIGN_IN_URL = BOOK_URL;   // Robostrar member login for now; drawing-club's sign-in later
  const ADDRESS = '1011 Main Street, Vancouver, BC V6A 4L4';
  const MAPS = 'https://www.google.com/maps/search/?api=1&query=1011+Main+Street+Vancouver+BC';

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gsap = window.gsap, ST = window.ScrollTrigger;
  const animate = !reduced && gsap && ST;
  if (gsap && ST) gsap.registerPlugin(ST);

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

  function openDialog(content, { returnFocus, origin, img } = {}) {
    if (open) return;
    dlgBody.replaceChildren(...content);
    dlg.hidden = false;
    dlg.classList.add('dlg-arming');
    setTimeout(() => dlg.classList.remove('dlg-arming'), 350);   // the opening tap must not land inside
    document.documentElement.style.overflow = 'hidden';
    open = { returnFocus, origin, img };
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
    const { returnFocus } = open;
    open = null;
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

  function showImage(btn, item) {
    const img = btn.querySelector('img');
    const origin = img.getBoundingClientRect();
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
    openDialog(content, { returnFocus: btn, origin, img: big });
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

  // ---------- past: bands of stacks ----------
  let pastSessions = [], posts = [];
  let geo = null, laps = 0, bandSeq = 0;
  const track = $('#past-track'), pastEl = $('#past');
  let io = null;

  function geometry() {
    const vw = document.documentElement.clientWidth;
    const room = Math.round(Math.min(160, Math.max(40, vw * 0.1)));      // the bounded left/right pan
    const field = vw + room * 2;
    const gap = vw < 600 ? 16 : 24;
    const target = vw < 600 ? 118 : 150;
    const cols = Math.max(3, Math.floor((field + gap) / (target + gap)));
    const colW = Math.floor((field - gap * (cols - 1)) / cols);
    return { vw, room, field, gap, cols, colW };
  }

  // a small deterministic random, so a band scatters the same way every time
  const rand = (seed) => { const x = Math.sin(seed * 9999) * 10000; return x - Math.floor(x); };

  function buildBand(lap, b) {
    const { cols, colW } = geo;
    const N = pastSessions.length;
    const band = h('div', { class: 'band', 'data-band': `${lap}-${b}` });
    const seed = ++bandSeq * 7.13;
    for (let c = 0; c < cols; c++) {
      const i = b * cols + c;
      if (i >= N) break;
      const s = pastSessions[i];
      const type = classify(s);
      const post = posts[(lap * N + i) % posts.length];
      const n = 2 + ((lap * N + i) % 3);                     // stacks of 2 to 4, so the level bottoms show
      const imgs = post.imgs.slice(0, n);
      const stack = h('div', { class: 'pstack' });
      imgs.forEach((im, k) => {
        const item = { src: im.src, w: im.w, h: im.h, post, session: s };
        const btn = h('button', { type: 'button', class: 'pimg', 'aria-label': `Drawing ${k + 1} of ${imgs.length}, ${s.title}, ${longDate(s.date)}. Demo: Cai's sketchbook` },
          h('img', { 'data-src': im.src, width: im.w, height: im.h, alt: '', decoding: 'async' }));
        btn.style.width = `${colW}px`;
        btn.addEventListener('click', (ev) => { if (suppressClick) { ev.preventDefault(); return; } showImage(btn, item); });
        stack.append(btn);
      });
      const view = h('button', { type: 'button', class: 'pview', text: 'View', 'aria-label': `View ${s.title}, ${longDate(s.date)}` });
      view.addEventListener('click', () => showSession(s, type, view));
      band.append(h('div', { class: 'pcol', style: `width:${colW}px` }, stack,
        h('div', { class: 'pcap' }, h('span', { class: 'pcap-t', text: s.title }), h('span', { class: 'pcap-d', text: shortDate(s.date) }), view)));
    }
    // the newest row is the tidy row at the centre line; every older row arrives scattered
    if (animate && !(lap === 0 && b === 0)) scatterOnScroll(band, seed);
    io?.observe(band);
    return band;
  }

  // Far above the line the drawings drift apart like the demo's canvas; as each one
  // comes down to the middle of the screen it settles back into its column. Each
  // drawing scrubs on its own position, so the top of the screen is always the loose
  // field and the stacks at the centre line are always tidy.
  function scatterOnScroll(band, seed) {
    const vw = geo.vw;
    band.querySelectorAll('.pimg').forEach((el, k) => {
      const r = (n) => rand(seed + k * 31 + n);
      gsap.to(el, {
        x: (r(1) - 0.5) * vw * 0.7, y: -60 - r(2) * 260, scale: 0.5 + r(3) * 0.4, opacity: 0.3 + r(4) * 0.45, ease: 'none',
        scrollTrigger: { trigger: el, start: 'bottom 52%', end: 'bottom -10%', scrub: 0.6 },
      });
    });
    band.querySelectorAll('.pcap').forEach((el) => gsap.to(el, {
      opacity: 0, ease: 'none', scrollTrigger: { trigger: el, start: 'bottom 30%', end: 'bottom 6%', scrub: 0.6 },
    }));
  }

  function addLap() {
    if (!pastSessions.length) return;
    const lap = laps++;
    const frag = document.createDocumentFragment();
    if (lap > 0) frag.append(h('p', { class: 'lap-divider ui', text: 'Two months back. Starting again from the newest.' }));
    const bands = Math.ceil(pastSessions.length / geo.cols);
    for (let b = 0; b < bands; b++) frag.append(buildBand(lap, b));
    // column-reverse: appended = drawn above. Keep what is on screen where it is.
    const h0 = pastEl.offsetHeight;
    track.append(frag);
    const dh = pastEl.offsetHeight - h0;
    if (lap > 0 && dh) scrollTo(0, scrollY + dh);
    if (animate) ST.refresh();
  }

  function buildPast() {
    geo = geometry();
    track.style.width = `${geo.field}px`;
    track.style.marginLeft = `${-geo.room}px`;
    track.style.setProperty('--gap', `${geo.gap}px`);
    if (animate) ST.getAll().forEach((t) => t.kill());
    track.replaceChildren();
    laps = 0;
    addLap();
  }

  // lazy: a band's drawings load near the screen and unload far from it
  function setupLazy() {
    io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        for (const img of en.target.querySelectorAll('img[data-src]')) {
          if (en.isIntersecting) { if (!img.getAttribute('src')) img.src = img.dataset.src; }
          else img.removeAttribute('src');
        }
      }
    }, { rootMargin: '150% 0px' });
  }

  // bounded horizontal pan over the stacks
  let panX = 0, suppressClick = false;
  function setPan(x, smooth) {
    panX = Math.max(-geo.room, Math.min(geo.room, x));
    if (smooth && gsap && !reduced) gsap.to(track, { x: panX, duration: 0.5, ease: 'power3.out', overwrite: true });
    else track.style.transform = `translateX(${panX}px)`;
  }
  function setupPan() {
    let down = null;
    pastEl.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, px: panX, horiz: null, id: e.pointerId };
      suppressClick = false;
    });
    pastEl.addEventListener('pointermove', (e) => {
      if (!down || e.pointerId !== down.id) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (down.horiz === null && Math.hypot(dx, dy) > 6) down.horiz = Math.abs(dx) > Math.abs(dy);
      if (down.horiz) { suppressClick = true; setPan(down.px + dx, false); }
      else if (down.horiz === false && e.pointerType === 'mouse') suppressClick = true;
    });
    const end = () => { down = null; setTimeout(() => { suppressClick = false; }, 0); };
    pastEl.addEventListener('pointerup', end);
    pastEl.addEventListener('pointercancel', () => { down = null; suppressClick = false; });
    pastEl.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { e.preventDefault(); setPan(panX - e.deltaX, true); }
    }, { passive: false });
    pastEl.addEventListener('dragstart', (e) => e.preventDefault());
  }

  // ---------- landing, cues, endless past ----------
  const centreEl = $('#centre');
  let landingY = 0, userMoved = false;
  function centre() {
    const r = centreEl.getBoundingClientRect();
    landingY = Math.max(0, Math.round(scrollY + r.top + r.height / 2 - innerHeight / 2));
    scrollTo(0, landingY);
  }
  ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((t) => addEventListener(t, () => { userMoved = true; }, { passive: true, once: true }));
  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (Math.abs(scrollY - landingY) > 140 && userMoved) document.body.classList.add('cues-off');
      if (scrollY < innerHeight * 1.5 && userMoved) addLap();   // endless upward: wrap the two months
    });
  }, { passive: true });

  let lastW = document.documentElement.clientWidth;
  let rz = 0;
  addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      const w = document.documentElement.clientWidth;
      if (w === lastW) return;
      lastW = w;
      const before = centreEl.getBoundingClientRect().top;
      buildPast();
      scrollTo(0, scrollY + centreEl.getBoundingClientRect().top - before);
      setPan(0, false);
    }, 200);
  });

  // ---------- Book a session ----------
  $('#book').addEventListener('click', (e) => {
    e.preventDefault();
    const first = document.querySelector('#upcoming .day-h') || $('#upcoming');
    const top = first.getBoundingClientRect().top + scrollY - parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--today-h') || 34) - 4;
    scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
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

    if (events) {
      renderUpcoming(events, $('#upcoming-list'));
      const lo = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60));
      pastSessions = events.filter((e) => !e.allDay && !e.cancelled && !classify(e).plain && e.date >= lo &&
        (e.date < TODAY || (e.date === TODAY && (e.until || e.start) <= NOW_HM)))
        .sort((a, b) => b.date.localeCompare(a.date) || (b.start || '').localeCompare(a.start || ''));
    }
    if (!pastSessions.length || !posts.length) { pastSessions = []; $('#cue-up').hidden = true; }

    setupLazy();
    buildPast();
    setupPan();
    centre();
    document.fonts?.ready.then(() => { if (!userMoved) { if (animate) ST.refresh(); centre(); } });

    // the loader leaves once the drawings on the first screen are decoded (and one pass has played)
    const onScreen = [...track.querySelectorAll('img[data-src]')].filter((img) => {
      const r = img.getBoundingClientRect(); return r.bottom > -50 && r.top < innerHeight + 50;
    });
    onScreen.forEach((img) => { if (!img.getAttribute('src')) img.src = img.dataset.src; });
    const timeout = new Promise((r) => setTimeout(r, 8000));
    await Promise.race([Promise.allSettled(onScreen.map((img) => img.decode())), timeout]);
    performance.mark?.('home-ready');
    window.BILoader?.ready();
  }
  boot().catch((e) => { console.error(e); window.BILoader?.ready(); });
})();
