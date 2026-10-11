/*
 * BI monogram loader. The monogram brushes itself on, holds, drains away, loops,
 * until the page says it is ready. Ported from lab/site-with-loader.html (see
 * lab/README.md for the brush mechanics); paper and page tone changed to the
 * infinite-canvas white. Hook: window.BILoader.ready() — the overlay leaves once
 * the page is ready AND one complete pass has played (a fast load must not cut the
 * mark off mid-stroke). ?hold keeps it looping; click to dismiss.
 */
(async function () {
let stopped = false;
let pageReady = false;
// the page may call ready() before the paths have loaded
window.BILoader = { ready() { pageReady = true; } };

const canvas = document.querySelector('#bi-loader canvas');
const ctx = canvas.getContext('2d');
const PAPER = '#ffffff';   // the Codrops demo's page colour (was Bryce's #f4f1ea)
const INK = [26, 24, 20];

const params = {
  width: 34,       // widest point of the brush (relative to scale)
  taperMin: 0.18,  // thinnest point, as a fraction of width (the hairlines)
  bristles: 9,
  ink: 0.72,
  wet: 0.55,       // body of ink under the bristle streaks
  dryness: 0.35,
  scatter: 0.5,
  fan: 0.5,
  scale: 0.25      // half again: loader size
};

// The monogram is not one weight. It swells in the bowls and thins to a
// hairline at the entries and exits. Each path carries its own weight curve:
// a list of [position along path 0..1, weight multiplier].
const WEIGHTS = [
  [[0.0,0.32], [0.091,0.38], [0.182,0.34], [0.273,0.38], [0.364,0.33], [0.455,0.4], [0.545,0.33], [0.636,0.33], [0.727,0.33], [0.818,0.35], [0.909,0.35], [1.0,0.19]],
  [[0.0,0.19], [0.091,0.41], [0.182,0.49], [0.273,0.52], [0.364,0.44], [0.455,0.44], [0.545,0.47], [0.636,0.33], [0.727,0.33], [0.818,0.33], [0.909,0.33], [1.0,0.19]],
  [[0.0,0.27], [0.091,0.52], [0.182,0.45], [0.273,0.33], [0.364,0.44], [0.455,0.64], [0.545,0.66], [0.636,0.68], [0.727,0.47], [0.818,0.37], [0.909,0.34], [1.0,0.19]],
];

const DENSITY = [
  [[0.0,0.56], [0.091,0.84], [0.182,0.65], [0.273,0.72], [0.364,0.48], [0.455,0.89], [0.545,0.64], [0.636,0.63], [0.727,0.58], [0.818,0.7], [0.909,0.57], [1.0,0.09]],
  [[0.0,0.3], [0.091,0.75], [0.182,0.97], [0.273,0.95], [0.364,0.88], [0.455,0.86], [0.545,0.83], [0.636,0.57], [0.727,0.55], [0.818,0.58], [0.909,0.61], [1.0,0.31]],
  [[0.0,0.42], [0.091,0.89], [0.182,0.79], [0.273,0.6], [0.364,0.86], [0.455,0.97], [0.545,0.91], [0.636,0.88], [0.727,0.93], [0.818,0.62], [0.909,0.59], [1.0,0.17]],
];

function densityAt(pi, u) {
  const w = DENSITY[pi] || [[0,1],[1,1]];
  for (let i = 0; i < w.length - 1; i++) {
    if (u <= w[i+1][0]) {
      const t = (u - w[i][0]) / (w[i+1][0] - w[i][0] || 1);
      return w[i][1] + (w[i+1][1] - w[i][1]) * t;
    }
  }
  return w[w.length-1][1];
}


// The spans Cai marked in red, read straight out of his annotation: for each
// path, the [start u, end u] stretches that must go heavy. These are RANGES,
// not points. Earlier this was four pinpricks, which is why the thickening
// never showed.
const DARK = {
  0: [[0.0, 0.045], [0.06, 0.097], [0.277, 0.356], [0.421, 0.523]],
  1: [[0.192, 1.0]],
  2: [[0.045, 0.154], [0.289, 0.526], [0.634, 0.935]],
};

// 1 inside a marked span, easing off over a short margin at each end so the
// brush swells into the weight instead of stepping into it.
function darkAt(pi, u) {
  const rs = DARK[pi] || [];
  const m = 0.035;
  let best = 0;
  for (const [a, b] of rs) {
    let v = 0;
    if (u >= a && u <= b) v = 1;
    else if (u > a - m && u < a) v = (u - (a - m)) / m;
    else if (u > b && u < b + m) v = 1 - (u - b) / m;
    if (v > best) best = v;
  }
  return best * best * (3 - 2 * best);   // smoothstep
}

function weightAt(pi, u) {
  const w = WEIGHTS[pi] || [[0,1],[1,1]];
  for (let i = 0; i < w.length - 1; i++) {
    if (u <= w[i+1][0]) {
      const t = (u - w[i][0]) / (w[i+1][0] - w[i][0] || 1);
      return w[i][1] + (w[i+1][1] - w[i][1]) * t;
    }
  }
  return w[w.length-1][1];
}

let dpr = Math.min(devicePixelRatio || 1, 2);
const head = { x: 0, y: 0, dx: 0, dy: 0 };
let bristles = [];
let travelled = 0;

function buildBristles() {
  bristles = Array.from({ length: params.bristles }, (_, i) => {
    const t = params.bristles === 1 ? 0 : i / (params.bristles - 1) - 0.5;
    return {
      offset: t,
      load: 0.35 + 0.65 * Math.random(),
      gapFreq: 0.015 + 0.04 * Math.random(),
      gapPhase: Math.random() * Math.PI * 2,
      wobble: (Math.random() - 0.5) * 2
    };
  });
}
// The page behind stays whatever it is; the monogram sits on a soft-edged
// disc of paper, so the loader reads as a coaster of light rather than a
// full-bleed sheet.
const DISC = { radius: 0.13, feather: 0.45 };   // of the disc's own radius

function clearPaper() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  const cx = innerWidth / 2, cy = innerHeight / 2;
  const r = Math.min(innerWidth, innerHeight) * DISC.radius;
  const g = ctx.createRadialGradient(cx, cy, r * (1 - DISC.feather), cx, cy, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}
function setupCanvas() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  clearPaper();
}

// --- the paths -------------------------------------------------------------
// Cai's own pen paths (lab/pen.html -> lab/bi-paths.json, copied to assets/). Never re-trace the logo.
let PATHS;
try { PATHS = await (await fetch('assets/bi-paths.json')).json(); }
catch (e) { document.getElementById('bi-loader')?.remove(); window.BILoader = { ready() {} }; return; }

function bezier(p0,c0,c1,p1,t){
  const u=1-t,a=u*u*u,b=3*u*u*t,c=3*u*t*t,d=t*t*t;
  return [a*p0[0]+b*c0[0]+c*c1[0]+d*p1[0], a*p0[1]+b*c0[1]+c*c1[1]+d*p1[1]];
}
function samplePath(p){
  const pts=p.points,out=[];
  const n=pts.length,last=p.closed?n:n-1;
  for(let i=0;i<last;i++){
    const a=pts[i],b=pts[(i+1)%n];
    const p0=[a[0],a[1]],c0=[a[0]+a[2],a[1]+a[3]];
    const c1=[b[0]-b[2],b[1]-b[3]],p1=[b[0],b[1]];
    let len=0,prev=p0;
    for(let k=1;k<=12;k++){const q=bezier(p0,c0,c1,p1,k/12);len+=Math.hypot(q[0]-prev[0],q[1]-prev[1]);prev=q;}
    const steps=Math.max(8,Math.ceil(len/1.2));
    for(let k=0;k<steps;k++) out.push(bezier(p0,c0,c1,p1,k/steps));
  }
  out.push(p.closed?[pts[0][0],pts[0][1]]:[pts[n-1][0],pts[n-1][1]]);
  return out;
}
const SAMPLED = PATHS.map(samplePath);

// --- drawing ---------------------------------------------------------------
const draw = { on:false, path:0, t:0, speed:22.4, lift:0 };

// per-path pace: the B (0) runs twice as fast as the I's two strokes
const PATH_SPEED = [2.0, 1.0, 1.0];

// The loop: paint it on, let it sit, then lift the ink back off along the
// same route, then a beat of empty paper before it begins again.
const loop = { phase:'draw', hold:0, erased:0 };
const HOLD_FRAMES  = 55;   // how long the finished monogram sits
const PAUSE_FRAMES = 30;   // blank paper before the next pass
const ERASE_SPEED  = 5.0;  // segments drained per frame, at the start of the exit
const ERASE_ACCEL  = 1.09; // and it keeps picking up speed as it goes

function fitBox(){
  const size = Math.min(innerWidth, innerHeight) * 0.84 * params.scale;
  return { size, ox:(innerWidth-size)/2, oy:(innerHeight-size)/2 };
}
function at(pi,t){
  const {size,ox,oy}=fitBox(); const s=SAMPLED[pi];
  const i=Math.min(s.length-1,Math.floor(t)), j=Math.min(s.length-1,i+1), f=t-i;
  return { x: ox + (s[i][0]+(s[j][0]-s[i][0])*f)/1000*size,
           y: oy + (s[i][1]+(s[j][1]-s[i][1])*f)/1000*size };
}

function startDraw(){
  clearPaper();
  LAID.length = 0;
  eraseHead = 0;
  loop.phase = 'draw';
  draw.on=true; draw.path=0; draw.t=0; draw.lift=0;
  const p=at(0,0); head.x=p.x; head.y=p.y; head.dx=0; head.dy=0;
}

// Lift segments back off by painting paper over them, oldest first, slightly
// wider than the ink so no dark fringe is left behind.
let eraseHead = 0;    // how far into the record the ink has drained

// Ink does not get rubbed out, it withdraws. So instead of painting paper over
// the mark (which reads as an eraser), clear the sheet and REPAINT everything
// that is still wet, fading the newly-exposed end so the withdrawal has a soft
// trailing edge instead of a blunt one.
const FADE_SEGMENTS = 26;

function repaintRemaining(){
  clearPaper();
  const from = Math.floor(eraseHead);
  for (let i = from; i < LAID.length; i++) {
    const seg = LAID[i];
    // the segments nearest the retreating front fade out
    const age = i - from;
    const fade = age < FADE_SEGMENTS ? age / FADE_SEGMENTS : 1;
    paint(seg[0], seg[1], seg[2], seg[3], seg[4] * (0.35 + 0.65*fade),
          seg[5] * fade, seg[6] * fade, fade);
  }
}

function update(){
  // --- the loop phases ---
  if (stopped) return;
  if (loop.phase === 'static') { requestAnimationFrame(update); return; }

  if (!draw.on && loop.phase === 'draw' && LAID.length) {
    loop.phase = 'hold'; loop.hold = HOLD_FRAMES;
  } else if (loop.phase === 'hold') {
    if (--loop.hold <= 0) { loop.phase = 'erase'; eraseHead = 0; loop.rate = ERASE_SPEED; }
  } else if (loop.phase === 'erase') {
    if (eraseHead < LAID.length) {
      loop.rate = (loop.rate || ERASE_SPEED) * ERASE_ACCEL;
      eraseHead += loop.rate;
      repaintRemaining();
    } else { loop.phase = 'pause'; loop.hold = PAUSE_FRAMES; clearPaper(); }
  } else if (loop.phase === 'pause') {
    if (--loop.hold <= 0) { loop.phase = 'draw'; startDraw(); }
  }

  if (draw.on) stepDraw();

  requestAnimationFrame(update);
}

function stepDraw(){
  {
    if (draw.lift > 0) { draw.lift--; }
    else {
      const s = SAMPLED[draw.path];
      const prev = { x: head.x, y: head.y };
      draw.t += draw.speed * (PATH_SPEED[draw.path] || 1);
      if (draw.t >= s.length - 1) {
        draw.path++;
        if (draw.path >= SAMPLED.length) { draw.on = false; }
        else {
          draw.t = 0; draw.lift = 5;
          const p = at(draw.path, 0);
          head.x = p.x; head.y = p.y;
        }
      } else {
        // the head sits ON the path, no spring lag, so the mark matches the
        // curve Cai drew instead of cutting its corners
        const p = at(draw.path, draw.t);
        head.x = p.x; head.y = p.y;
        const u = draw.t / (s.length - 1);
        stamp(prev.x, prev.y, head.x, head.y, weightAt(draw.path, u),
              densityAt(draw.path, u), darkAt(draw.path, u));
      }
    }
  }
}

// Every stamp is recorded so the stroke can be unwound in reverse later.
// A flat canvas cannot be un-painted; a list of segments can be replayed.
const LAID = [];

function stamp(x0,y0,x1,y1,weight,density,dark){
  LAID.push([x0,y0,x1,y1,weight,density,dark]);
  paint(x0,y0,x1,y1,weight,density,dark);
}

function paint(x0,y0,x1,y1,weight,density,dark,alpha){
  const A = alpha === undefined ? 1 : alpha;
  const dx=x1-x0, dy=y1-y0, dist=Math.hypot(dx,dy);
  if (dist < 0.02) return;
  const px=-dy/dist, py=dx/dist;

  // weight drives the brush width; the hairlines are genuinely thin
  const w = params.width * params.scale *
            (params.taperMin + (1 - params.taperMin) * weight / 0.7)
            * (1 + 0.55*dark);

  const speed = Math.min(1, dist/12) * (1 - 0.85*dark);
  const starve = 1 - params.dryness * speed;
  const spread = w * (1 + params.fan * speed);
  const steps = Math.max(1, Math.ceil(dist/1.5));

  ctx.lineCap='round';

  // WET CORE: the body of ink the loaded brush lays down. Its opacity follows
  // the measured density, and the zones Cai marked push it to nearly solid.
  const wet = Math.min(1, params.wet * (0.25 + 0.75*density) + 0.5*dark) * A;
  if (wet > 0.02) {
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    ctx.strokeStyle = `rgba(${INK[0]},${INK[1]},${INK[2]},${(wet*(0.45+0.3*dark)).toFixed(3)})`;
    ctx.lineWidth = w * (0.5 + 0.3*dark) * (0.8 + 0.4*density);
    ctx.stroke();
  }

  for (const b of bristles) {
    ctx.lineWidth = Math.max(0.45, (w/params.bristles)*(0.9+0.8*b.load));
    let drawing=false;
    for (let s=0; s<=steps; s++){
      const k=s/steps, travel=travelled+dist*k;
      const cx=x0+dx*k, cy=y0+dy*k;
      const jitter = params.scatter*0.1*w*b.wobble*Math.sin(travel*0.05+b.gapPhase);
      const x = cx+px*(b.offset*spread+jitter);
      const y = cy+py*(b.offset*spread+jitter);
      const contact = 0.5+0.5*Math.sin(b.gapPhase+travel*b.gapFreq);
      // Where the logo is dark the brush was loaded: the hairs close up and
      // stop skipping. Where it is pale, the dry gaps open.
      const gate = (1-starve)*0.9 * (1.45 - 0.9*density) * (1 - 0.95*dark);
      if (contact > gate) {
        if (!drawing){
          ctx.beginPath(); ctx.moveTo(x,y);
          const a = params.ink*b.load*starve*(0.55+0.45*contact)
                    * (0.45 + 1.15*density) * (1 + 0.55*dark) * A;
          ctx.strokeStyle=`rgba(${INK[0]},${INK[1]},${INK[2]},${a.toFixed(3)})`;
          drawing=true;
        } else ctx.lineTo(x,y);
      } else if (drawing){ ctx.stroke(); drawing=false; }
    }
    if (drawing) ctx.stroke();
  }
  travelled += dist;
}

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

buildBristles();
setupCanvas();

if (REDUCED) {
  // No animation for visitors who asked not to have any: paint the finished
  // monogram in one pass and leave it there.
  // Paint every segment, just without animating: run the whole path in one
  // synchronous pass so the mark is complete rather than sparse.
  startDraw();
  let guard = 0;
  while (draw.on && guard++ < 20000) stepDraw();
  loop.phase = 'static';
} else {
  setTimeout(startDraw, 450);
}
requestAnimationFrame(update);



// registered only now: a resize during the paths fetch must not reach startDraw()
addEventListener('resize', () => { if (stopped || loop.phase === 'static') return; setupCanvas(); startDraw(); });

// --- the hook the page uses --------------------------------------------------------
function finish() {
  const el = document.getElementById('bi-loader');
  if (!el) return;
  performance.mark?.('bi-loader-done');
  el.classList.add('done');
  setTimeout(() => { stopped = true; el.remove(); }, 600);
}
window.BILoader = { ready() { pageReady = true; } };

// Count real cycles: one full pass (draw, hold, exit) must have played.
let passes = 0, lastPhase = '';
const watch = setInterval(() => {
  if (loop.phase !== lastPhase) {
    if (lastPhase === 'erase' && loop.phase === 'pause') passes++;
    lastPhase = loop.phase;
  }
}, 40);

const HOLD = location.search.includes('hold');
const gate = setInterval(() => {
  if (HOLD) return;
  if (pageReady && (REDUCED || passes >= 1)) { clearInterval(gate); clearInterval(watch); finish(); }
}, 60);
if (HOLD) document.getElementById('bi-loader')?.addEventListener('click', finish);
})();
