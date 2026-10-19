// Abre index.html por file:// (sem parâmetros), confere que a timeline avança e que não há erros de console.
const { chromium } = require('playwright-core');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(pathToFileURL(path.join(__dirname, 'index.html')).href);
  await page.waitForTimeout(400);
  const t1 = await page.evaluate(() => window.TL.time());
  await page.waitForTimeout(1000);
  const t2 = await page.evaluate(() => window.TL.time());
  await browser.close();
  if (!(t2 > t1) || errors.length) {
    console.error('FALHOU', { t1, t2, errors });
    process.exit(1);
  }
  console.log('check ok: TL.time() ' + t1.toFixed(2) + ' -> ' + t2.toFixed(2) + ', sem erros de console');
})().catch((e) => { console.error(e); process.exit(1); });
