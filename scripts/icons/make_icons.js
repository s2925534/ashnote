// Draws the Ashnote icon set from one SVG design (a chat bubble whose corner drifts away as embers).
// Usage: node scripts/icons/make_icons.js   (needs Playwright; writes assets/*.png and store/google-play/*.png)
const { chromium } = require("playwright");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");

const BG = `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#121a3d"/><stop offset="1" stop-color="#1f2f78"/></linearGradient>
<linearGradient id="bub" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b8bff"/><stop offset="1" stop-color="#2a56f0"/></linearGradient>
<radialGradient id="glow" cx="0.72" cy="0.3" r="0.5"><stop offset="0" stop-color="#ffb547" stop-opacity="0.35"/><stop offset="1" stop-color="#ffb547" stop-opacity="0"/></radialGradient></defs>`;
// the mark in a 1024 box, centred on (512,512); scale shrinks it for adaptive-icon safe zones
const mark = (fill, ember, scale = 1) => `<g transform="translate(512 512) scale(${scale}) translate(-512 -512)">
  <path d="M250 300h420a90 90 0 0 1 90 90v190a90 90 0 0 1-90 90H430l-130 100v-100h-50a90 90 0 0 1-90-90V390a90 90 0 0 1 90-90z" fill="${fill}"/>
  <g fill="${ember}">
    <rect x="700" y="250" width="52" height="52" rx="8"/><rect x="782" y="186" width="40" height="40" rx="7" opacity=".9"/>
    <rect x="770" y="300" width="34" height="34" rx="6" opacity=".85"/><rect x="842" y="128" width="28" height="28" rx="5" opacity=".7"/>
    <rect x="866" y="238" width="22" height="22" rx="4" opacity=".55"/><rect x="900" y="92" width="16" height="16" rx="3" opacity=".4"/>
  </g></g>`;
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${BG}${body}</svg>`;
const full = (s = 1) => svg(1024, 1024, `<rect width="1024" height="1024" fill="url(#bg)"/><rect width="1024" height="1024" fill="url(#glow)"/>${mark("url(#bub)", "#ffb547", s)}`);

const files = [
  ["assets/icon.png", 1024, 1024, full(0.92), false],
  ["assets/splash-icon.png", 1024, 1024, svg(1024, 1024, mark("url(#bub)", "#ffb547", 0.8)), true],
  ["assets/android-icon-foreground.png", 512, 512, svg(1024, 1024, mark("url(#bub)", "#ffb547", 0.62)), true],
  ["assets/android-icon-background.png", 512, 512, svg(1024, 1024, `<rect width="1024" height="1024" fill="url(#bg)"/><rect width="1024" height="1024" fill="url(#glow)"/>`), false],
  ["assets/android-icon-monochrome.png", 432, 432, svg(1024, 1024, mark("#ffffff", "#ffffff", 0.62)), true],
  ["assets/favicon.png", 48, 48, full(0.95), false],
  ["store/google-play/icon-512.png", 512, 512, full(0.9), false],
];

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ deviceScaleFactor: 1 });
  for (const [out, w, h, s, transparent] of files) {
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(`<html><body style="margin:0;background:transparent">${s.replace(/width="1024" height="1024" viewBox/, `width="${w}" height="${h}" viewBox`)}</body></html>`);
    await p.screenshot({ path: path.join(ROOT, out), omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
    console.log("wrote", out);
  }
  // Play Store feature graphic, 1024 x 500
  await p.setViewportSize({ width: 1024, height: 500 });
  await p.setContent(`<html><body style="margin:0"><div style="width:1024px;height:500px;background:linear-gradient(135deg,#121a3d,#1f2f78);display:flex;align-items:center;gap:40px;padding:0 70px;box-sizing:border-box;font-family:Inter,Segoe UI,Roboto,sans-serif;color:#fff">
    <div style="width:300px;height:300px;flex:none">${svg(1024, 1024, mark("url(#bub)", "#ffb547", 1)).replace('width="1024" height="1024" viewBox', 'width="300" height="300" viewBox')}</div>
    <div><div style="font-size:84px;font-weight:800;letter-spacing:-2px">Ashnote</div>
    <div style="font-size:27px;line-height:1.4;opacity:.85;margin-top:10px;white-space:nowrap">Private chat that leaves nothing behind.<br>No account, no server of ours.<br>Gone after reading.</div></div></div></body></html>`);
  await p.screenshot({ path: path.join(ROOT, "store/google-play/feature-graphic.png"), clip: { x: 0, y: 0, width: 1024, height: 500 } });
  console.log("wrote store/google-play/feature-graphic.png");
  await b.close();
})();
