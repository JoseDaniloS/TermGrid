// node capture.js video [saida.mp4]       -> captura quadro a quadro e codifica com FFmpeg
// node capture.js still <segundos> <saida.png> [--nocursor]
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30;
const REELS = process.argv.includes('--reels'); // versao vertical 1080x1920 (Reels)
const url = pathToFileURL(path.join(__dirname, 'index.html')).href + '?capture' + (REELS ? '&fmt=reels' : '');

async function open() {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: REELS ? { width: 1080, height: 1920 } : { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => window.TL && Array.from(document.images).every((i) => i.complete), null, { timeout: 15000 });
  await page.evaluate(() => document.fonts && document.fonts.ready.then(() => 0));
  return { browser, page, errors };
}

// avança sempre para frente, em passos de 1/30 s, para os callbacks dispararem em ordem
async function stepTo(page, from, to) {
  const n = Math.round((to - from) * FPS);
  for (let i = 1; i <= n; i++) await page.evaluate((t) => { window.TL.time(t, false); return 0; }, from + i / FPS);
}

(async () => {
  const mode = process.argv[2];
  const { browser, page, errors } = await open();
  const total = await page.evaluate(() => window.TL.duration());
  if (mode === 'still') {
    const t = parseFloat(process.argv[3]);
    await page.evaluate(() => { window.TL.time(0, false); return 0; });
    await stepTo(page, 0, t);
    if (process.argv.includes('--nocursor')) await page.addStyleTag({ content: '#cursor,#ripple,#caps{display:none!important}' });
    await page.screenshot({ path: process.argv[4] });
  } else {
    const out = process.argv[3] || path.join(__dirname, '..', 'demo.mp4');
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(FPS), '-movflags', '+faststart', '-an', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((res, rej) => { ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg saiu com ' + c)))); });
    const frames = Math.round(total * FPS);
    await page.evaluate(() => { window.TL.time(0, false); return 0; });
    for (let f = 0; f < frames; f++) {
      if (f > 0) await page.evaluate((t) => { window.TL.time(t, false); return 0; }, f / FPS);
      const buf = await page.screenshot({ type: 'png' });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (f % 150 === 0) console.log('quadro', f, '/', frames);
    }
    ff.stdin.end();
    await done;
    console.log('ok', out, frames + ' quadros');
  }
  await browser.close();
  if (errors.length) { console.error('erros de console:', errors); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
