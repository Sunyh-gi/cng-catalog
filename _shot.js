/* 视觉复核截图：临时起 http 服务 + 可注入模拟数据
   用法： node _shot.js                     → 真实数据，整屏
          node _shot.js --mock              → 38 条模拟数据（看 3 列网格 & 4 个类别胶囊）
          node _shot.js --clip=0,80,700,180 → 只截指定区域（CSS 像素，x,y,w,h），用来放大核对几像素级对齐
          node _shot.js --owned             → 预置若干已购标记，看绿色小圆点
          node _shot.js --open              → 打开第一张卡片的「已购 / 未购」弹层
          node _shot.js --year=2025         → 先点进该年份页再截图
   产物：_shot[_mock][_owned|_open][_yYYYY][_crop].png（复核完请删除） */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer-core');

const ROOT = __dirname;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MOCK = process.argv.includes('--mock');
const OWNED = process.argv.includes('--owned');
const OPEN = process.argv.includes('--open');
const year = (process.argv.find(a => a.startsWith('--year=')) || '').slice(7) || null;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.css': 'text/css; charset=utf-8' };

function mockCatalog() {
  const types = ['province', 'special', 'supplement', 'appendix'];
  const names = { province: '专辑', special: '年度特刊', supplement: '增刊', appendix: '附刊' };
  const out = []; let n = 0;
  for (let y = 2026; y >= 2012; y--) {
    const cnt = y === 2026 ? 3 : (y % 3) + 2;
    for (let i = 1; i <= cnt; i++) {
      const t = types[(n++) % 4];
      out.push({ id: `${y}-${String(i).padStart(2, '0')}`, year: y, issue: i, type: t,
        title: t === 'supplement' || t === 'special'
          ? `${y}年${t === 'special' ? '' : '增刊'} ${names[t]} 示例标题第${i}辑`
          : `${y}年第${i}期 ${names[t]} 示例标题（上）` });
    }
  }
  return out;
}

(async () => {
  const server = http.createServer((req, res) => {
    let f = decodeURIComponent(req.url.split('?')[0]);
    if (f === '/' ) f = '/index.html';
    if (f === '/catalog.js' && MOCK) {
      res.writeHead(200, { 'Content-Type': MIME['.js'] });
      return res.end(`window.CNG_CATALOG_UPDATED="2026-09-22";window.CNG_CATALOG=${JSON.stringify(mockCatalog())};`);
    }
    const p = path.join(ROOT, f.replace(/^\/+/, ''));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      res.writeHead(404); return res.end('404');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/index.html`;

  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=2'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 780, deviceScaleFactor: 2 });
  await page.goto(base, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 600));

  const clipArg = (process.argv.find(a => a.startsWith('--clip=')) || '').slice(7);
  const clip = clipArg
    ? (([x, y, width, height]) => ({ x, y, width, height }))(clipArg.split(',').map(Number))
    : null;

  /* --owned：把当前数据全部预置为「已购」，用来核对卡片上的绿点
     --open：点一下第一张卡片的非图片区，把拥有状态选择框打开 */
  if (OWNED) {
    await page.evaluate(() => {
      const all = {};
      (window.CNG_CATALOG || []).forEach(e => { all[e.id] = 1; });
      localStorage.setItem('cng-owned-v1', JSON.stringify(all));
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 500));
  }
  if (OPEN) {
    await page.click('.card');
    await new Promise(r => setTimeout(r, 300));
  }
  /* --year=YYYY：先点进该年份页，再截图（年份页会自动切成「按期号」排序） */
  if (year) {
    const hit = await page.evaluate((y) => {
      const items = Array.from(document.querySelectorAll('#yearList .nav__item .nav__text'));
      const t = items.filter(n => n.textContent.trim() === String(y))[0];
      if (!t) return false;
      t.closest('.nav__item').click();
      return true;
    }, year);
    if (!hit) console.log('提示：年份 ' + year + ' 不在当前数据里');
    await new Promise(r => setTimeout(r, 400));
  }

  const suffix = (MOCK ? '_mock' : '') + (OWNED ? '_owned' : '') + (OPEN ? '_open' : '') +
                 (year ? '_y' + year : '') + (clip ? '_crop' : '');
  const out = path.join(ROOT, '_shot' + suffix + '.png');
  await page.screenshot(clip ? { path: out, clip } : { path: out });
  await browser.close();
  server.close();
  console.log('已生成 ' + out);
})();
