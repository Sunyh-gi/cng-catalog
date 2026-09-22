/**
 * 对齐诊断探针 —— 打印页头 / 筛选行 / 胶囊 / 网格的精确几何，用来定位几像素级的错位。
 *
 * 跑法：
 *   set NODE_PATH=C:\Users\Mickey\.workbuddy\binaries\node\workspace\node_modules
 *   node _probe_align.js
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = __dirname;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
               '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

function startServer() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    const file = path.join(ROOT, rel.replace(/^\/+/, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('404');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

(async () => {
  const server = await startServer();
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: true,
    args: ['--no-sandbox', '--force-device-scale-factor=1'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 780 });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 300));

  const dump = await page.evaluate(() => {
    const R = el => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        sel: el.className || el.tagName,
        L: +r.left.toFixed(2), R: +r.right.toFixed(2),
        T: +r.top.toFixed(2),  B: +r.bottom.toFixed(2),
        W: +r.width.toFixed(2), H: +r.height.toFixed(2),
        cy: +((r.top + r.bottom) / 2).toFixed(2),
        margin: cs.marginTop + ' ' + cs.marginBottom,
        padding: cs.padding,
        lh: cs.lineHeight,
        fs: cs.fontSize,
      };
    };
    const one = s => R(document.querySelector(s));
    const all = s => Array.from(document.querySelectorAll(s)).map(R);

    const pillText = Array.from(document.querySelectorAll('.pill')).map(p => {
      const range = document.createRange();
      range.selectNodeContents(p);
      const t = range.getBoundingClientRect();
      const pr = p.getBoundingClientRect();
      return {
        text: p.textContent.trim(),
        pillW: +pr.width.toFixed(2), pillH: +pr.height.toFixed(2),
        padX: +(t.left - pr.left).toFixed(2),
        padXR: +(pr.right - t.right).toFixed(2),
        padY: +(t.top - pr.top).toFixed(2),
        padYB: +(pr.bottom - t.bottom).toFixed(2),
        textH: +t.height.toFixed(2),
      };
    });

    return {
      viewport: { w: innerWidth, h: innerHeight },
      sidebar: one('.sidebar'),
      brand: one('.brand'),
      logo: one('.brand__logo'),
      nav: one('.nav'),
      navLabel0: one('.nav .nav__label'),
      navLead: one('.nav__item--lead'),
      navYear0: one('#yearList .nav__item'),
      footer: one('.footer'),
      main: one('.main'),
      header: one('.header'),
      titles: one('.header__titles'),
      title: one('#pageTitle'),
      sub: one('#pageSub'),
      search: one('.search'),
      filters: one('.filters'),
      pills: one('.pills'),
      pill0: one('.pill'),
      sort: one('.sort'),
      sortBtn: one('.sort__btn'),
      sortLabel: one('#sortLabel'),
      scroller: one('.scroller'),
      grid: one('.grid'),
      card0: one('.card'),
      pillCount: all('.pill').length,
      pillText,
    };
  });

  console.log(JSON.stringify(dump, null, 2));

  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
