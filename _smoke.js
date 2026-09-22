/**
 * 中国国家地理 · 特别刊物目录 —— 冒烟测试
 *
 * 跑法（在项目目录下）：
 *   set NODE_PATH=C:\Users\Mickey\.workbuddy\binaries\node\workspace\node_modules
 *   node _smoke.js
 *
 * 覆盖五轮：
 *   A 真实数据      —— 直接读当前 catalog.js，验证计数 / 卡片 / 封面加载 / 放大查看
 *   C 对齐几何      —— 页头、筛选行、网格、侧栏的像素级对齐
 *   D 拥有状态      —— 点卡片弹层、已购绿点、localStorage 持久化
 *   F 缩略图不裁切  —— object-fit 与缩略图比例
 *   B 模拟数据（约 40 条）—— 由本脚本注入，验证网格列数 / 滚动 / 年份筛选 / 类别筛选 / 搜索 / 排序
 *   E 排序          —— 年份页「按期号」与自动切换（也用模拟数据）
 *
 * 用本机 Edge（puppeteer-core）+ 临时 http 服务，服务端可替换 catalog.js 内容。
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = __dirname;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.ico':  'image/x-icon',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

/* ---------------- 结果收集 ---------------- */
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---------------- 模拟数据 ---------------- */
function mockCatalog() {
  const types = ['province', 'special', 'supplement', 'appendix'];
  const out = [];
  for (let y = 2026; y >= 2012; y--) {
    const cnt = 1 + (y % 3);
    for (let i = 1; i <= cnt; i++) {
      out.push({
        id: `mock-${y}-${i}`,
        year: y,
        issue: i,
        type: types[(y + i) % 4],
        title: `${y}年第${i}期 测试专辑（上）`,
      });
    }
    if (y % 2 === 0) {
      out.push({
        id: `mock-${y}-tk`, year: y, issue: null,
        type: 'special', title: `${y}年增刊 测试特刊`,
      });
    }
  }
  return out;
}

/* ---------------- 被测服务 ---------------- */
let mockData = null;

function startServer() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';

    if (rel === '/catalog.js' && mockData) {
      const body = 'window.CNG_CATALOG_UPDATED = "2026-09-22";\n' +
                   'window.CNG_CATALOG = ' + JSON.stringify(mockData, null, 2) + ';\n';
      res.writeHead(200, { 'Content-Type': MIME['.js'] });
      return res.end(body);
    }

    const file = path.join(ROOT, rel.replace(/^\/+/, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 ' + rel);
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* ---------------- 页面小工具 ---------------- */
const text = (page, sel) =>
  page.$eval(sel, n => n.textContent.trim()).catch(() => null);

const count = (page, sel) =>
  page.$$eval(sel, ns => ns.length).catch(() => 0);

async function collectErrors(page) {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') {
      const t = m.text();
      // 模拟数据没有真实封面图，404 属预期
      if (!/404/.test(t)) errs.push('console: ' + t);
    }
  });
  return errs;
}

/* ---------------- 主流程 ---------------- */
(async () => {
  if (!fs.existsSync(EDGE)) {
    console.error('找不到 Edge：' + EDGE);
    process.exit(1);
  }

  const server = await startServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/index.html`;

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
  });

  /* ================= 场景 A：真实数据 ================= */
  mockData = null;
  let page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 780 });
  let errors = await collectErrors(page);
  await page.goto(base, { waitUntil: 'networkidle0' });
  await sleep(300);

  const realCount = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'catalog.js'), 'utf8')
      .match(/window\.CNG_CATALOG\s*=\s*(\[[\s\S]*?\])\s*;/)[1]
  ).length;

  const titleInfo = await page.$eval('#pageTitle', n => ({
    t: n.textContent.trim(),
    fs: getComputedStyle(n).fontSize,
    fw: getComputedStyle(n).fontWeight,
  }));
  check('A1 页面标题（固定文案「目录」+ 19px / 500）',
    titleInfo.t === '目录' && titleInfo.fs === '19px' && titleInfo.fw === '500',
    `${titleInfo.t} / ${titleInfo.fs} / ${titleInfo.fw}`);

  const sub = await text(page, '#pageSub');
  check('A2 副标题含真实条数', sub && sub.indexOf('共 ' + realCount + ' 期') === 0, sub);

  const cards = await count(page, '.card');
  check('A3 卡片数 = 数据条数', cards === realCount, `卡片 ${cards} / 数据 ${realCount}`);

  const navYears = await count(page, '#yearList .nav__item');
  const years = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog.js'), 'utf8')
    .match(/window\.CNG_CATALOG\s*=\s*(\[[\s\S]*?\])\s*;/)[1])
    .reduce((a, e) => a.indexOf(e.year) < 0 ? a.concat(e.year) : a, []).length;
  check('A4 年份导航项数 = 数据年份数', navYears === years, `导航 ${navYears} / 年份 ${years}`);

  check('A5 侧栏全部计数', await text(page, '#navCountAll') === String(realCount),
    await text(page, '#navCountAll'));

  const pillTexts = await page.$$eval('.pill', ns => ns.map(n => n.textContent.trim()));
  check('A6 类别胶囊含计数', pillTexts.length >= 1 && /^全部 · \d+$/.test(pillTexts[0]), pillTexts.join(' | '));

  const version = await text(page, '#footVersion');
  const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const declaredVer = (htmlSrc.match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
  const logSrc = fs.existsSync(path.join(ROOT, 'CHANGELOG.md'))
    ? fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8') : '';
  const topLogged = (logSrc.match(/^##\s+(v\d+\.\d+)/m) || [])[1];
  check('A7 页脚版本号 = HTML 常量 = CHANGELOG 最新条目',
    /^v\d+\.\d+$/.test(version || '') && declaredVer === version && topLogged === version,
    `页脚 ${version} / HTML ${declaredVer} / CHANGELOG ${topLogged}`);

  const updated = await text(page, '#footUpdated');
  check('A8 页脚更新日期', /^数据更新 \d{4}-\d{2}-\d{2}$/.test(updated || ''), updated);

  const coverOk = await page.$eval('.card__cover img', n => n.complete && n.naturalWidth > 0)
    .catch(() => false);
  check('A9 缩略图加载成功', coverOk, coverOk ? '' : '图片未加载');

  // 点封面放大
  let viewerOpen = false;
  if (cards > 0) {
    await page.click('.card__cover');
    await sleep(400);
    viewerOpen = await page.$eval('#viewer', n => !n.hidden);
    const fullOk = await page.$eval('#viewerImg', n => n.complete && n.naturalWidth > 0)
      .catch(() => false);
    check('A10 点封面打开原图', viewerOpen && fullOk,
      `打开 ${viewerOpen} / 原图加载 ${fullOk}`);
    await page.keyboard.press('Escape');
    await sleep(200);
    const closed = await page.$eval('#viewer', n => n.hidden);
    check('A11 Esc 关闭放大', closed, closed ? '' : '未关闭');
  } else {
    check('A10 点封面打开原图', false, '无卡片，跳过');
    check('A11 Esc 关闭放大', false, '无卡片，跳过');
  }

  check('A12 无 JS 报错', errors.length === 0, errors.join(' ;; '));

  /* 站点图标（favicon）：必须是本地文件，不能退回内联占位 */
  const iconHrefs = await page.$$eval('link[rel~="icon"]', ns => ns.map(n => n.getAttribute('href') || ''));
  const localIcons = iconHrefs.filter(h => h && !/^data:/i.test(h) && !/^(https?:)?\/\//i.test(h));
  const iconPng = localIcons.some(h => /favicon\.png$/i.test(h));
  check('A13 站点图标指向本地文件（不是内联占位）', localIcons.length > 0 && iconPng,
    iconHrefs.length ? iconHrefs.join(' | ') : '没有 link[rel=icon]');

  const pngPath = path.join(ROOT, 'favicon.png');
  const icoPath = path.join(ROOT, 'favicon.ico');
  let pngDim = '', icoDim = '';
  if (fs.existsSync(pngPath)) {
    const b = fs.readFileSync(pngPath);
    pngDim = b.readUInt32BE(16) + 'x' + b.readUInt32BE(20);       // PNG IHDR 宽 / 高
  }
  if (fs.existsSync(icoPath)) {
    const b = fs.readFileSync(icoPath);
    icoDim = (b[6] || 0) + 'x' + (b[7] || 0);                     // ICO 目录项宽 / 高
  }
  check('A14 favicon 文件是官方 32×32 图标', pngDim === '32x32' && icoDim === '32x32',
    `png ${pngDim || '缺失'} / ico ${icoDim || '缺失'}`);

  /* A15：默认视图（最近出版）下，同年多张无期号条目要按 附刊 → 增刊 → 特刊 排，
     与「按期号」模式口径一致（否则同年的两本增刊 / 特刊会在两个视图里来回换位）。
     用真实数据，所以 mock 里那种「每年最多一张无期号」的情况不会让这项变空守。 */
  const NOISSUE = { appendix: 1, supplement: 2, special: 3 };
  const a15 = await page.evaluate(() => {
    const cat = {};
    (window.CNG_CATALOG || []).forEach(e => { cat[e.id] = e; });
    return { cat: cat, order: Array.from(document.querySelectorAll('.card')).map(n => n.dataset.id) };
  });
  const tailByYear = {};
  a15.order.forEach(id => {
    const en = a15.cat[id];
    if (en && en.issue == null) (tailByYear[en.year] = tailByYear[en.year] || []).push(en);
  });
  const multiYears = Object.keys(tailByYear).filter(y => tailByYear[y].length >= 2);
  const a15ok = multiYears.length > 0 && multiYears.every(y => {
    const r = tailByYear[y].map(en => NOISSUE[en.type] || 9);
    return r.every((v, i) => i === 0 || v >= r[i - 1]);
  });
  check('A15 同年多张无期号条目按 附刊→增刊→特刊 排（与按期号一致）', a15ok,
    multiYears.length
      ? multiYears.map(y => y + ' ' + tailByYear[y].map(en => en.type).join('→')).join(' ; ')
      : '数据里没有「同年两张以上无期号」的组合，这项无从检验');

  /* ---------- C 对齐几何（与数据无关） ---------- */
  const geo = await page.evaluate(() => {
    const box = s => { const n = document.querySelector(s); if (!n) return null;
      const r = n.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right,
               cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2, h: r.height, w: r.width }; };

    const pillTexts = Array.from(document.querySelectorAll('.pill')).map(pill => {
      const range = document.createRange();
      range.selectNodeContents(pill);
      const t = range.getBoundingClientRect();
      const p = pill.getBoundingClientRect();
      return {
        text: pill.textContent.trim(),
        above: +(t.top - p.top).toFixed(2),
        below: +(p.bottom - t.bottom).toFixed(2),
        pillH: +p.height.toFixed(2),
      };
    });

    const margins = Array.from(document.querySelectorAll('.header__titles > *')).map(n => {
      const cs = getComputedStyle(n);
      return { tag: n.tagName, mt: cs.marginTop, mb: cs.marginBottom };
    });

    /* 分组标签文字底边 → 下方第一项顶边 的实测间距。
       注意「按年份」的下一兄弟是 display:contents 的 #yearList，它本身没有盒子，
       要往下钻到第一个真实子元素才能量到。 */
    const nextBox = el => {
      let n = el.nextElementSibling;
      while (n && getComputedStyle(n).display === 'contents') n = n.firstElementChild;
      return n ? n.getBoundingClientRect() : null;
    };
    const navGaps = Array.from(document.querySelectorAll('.nav__label')).map(l => {
      const range = document.createRange();
      range.selectNodeContents(l);
      const t = range.getBoundingClientRect();
      const nr = nextBox(l);
      return {
        text: l.textContent.trim(),
        textBottom: +t.bottom.toFixed(2),
        nextTop: nr ? +nr.top.toFixed(2) : null,
        gap: nr ? +(nr.top - t.bottom).toFixed(2) : null,
      };
    });

    return {
      titles: box('.header__titles'),
      header: box('.header'),
      search: box('.search'),
      filters: box('.filters'),
      firstPill: box('.pill'),
      sort:     box('.sort'),
      sortBtn:  box('.sort__btn'),
      grid:     box('.grid'),
      navLead:  box('.nav__item--lead'),
      divider0: box('.sidebar__divider'),
      brand:    box('.brand'),
      pillTexts, margins, navGaps,
    };
  });

  check('C1 页头标题组位置正确（28–76，带内有意下沉 8px）',
    geo.titles && Math.abs(geo.titles.top - 28) <= 1 && Math.abs(geo.titles.bottom - 76) <= 1,
    `实际 ${geo.titles && geo.titles.top.toFixed(1)}–${geo.titles && geo.titles.bottom.toFixed(1)}（顶部栏 0–${geo.brand && geo.brand.bottom.toFixed(0)}）`);

  check('C2 页头标题组高度 = 26+5+17 = 48',
    geo.titles && Math.abs(geo.titles.h - 48) <= 1, `实际 ${geo.titles && geo.titles.h.toFixed(1)}`);

  check('C3 标题组内无多余外边距',
    geo.margins.every(m => parseFloat(m.mt) === 0 && parseFloat(m.mb) === 0),
    geo.margins.map(m => `${m.tag} mt${m.mt} mb${m.mb}`).join(' | '));

  check('C4 页头左右垂直居中对齐',
    geo.titles && geo.search && Math.abs(geo.titles.cy - geo.search.cy) <= 1,
    `标题组中心 ${geo.titles && geo.titles.cy.toFixed(1)} / 搜索框中心 ${geo.search && geo.search.cy.toFixed(1)}`);

  check('C5 筛选行左右垂直居中对齐',
    geo.firstPill && geo.sortBtn && Math.abs(geo.firstPill.cy - geo.sortBtn.cy) <= 1,
    `胶囊中心 ${geo.firstPill && geo.firstPill.cy.toFixed(1)} / 排序控件中心 ${geo.sortBtn && geo.sortBtn.cy.toFixed(1)}`);

  /* 文字实测矩形是「字形盒」（高 ≈ 字体 ascent+descent，19px），不是行盒。
     行盒在胶囊里被精确居中，字形盒因上下行距不对称会有 ≤0.5px 的字体度量残差，
     属于正确的排版居中，不是布局错位。所以这里比对「字形盒中心 vs 胶囊中心」。 */
  const worst = geo.pillTexts.reduce((a, b) =>
    Math.abs(b.above - b.below) > Math.abs(a.above - a.below) ? b : a, geo.pillTexts[0] || { above: 0, below: 0 });
  check('C6 胶囊内文字垂直居中（中心偏差 ≤ 0.6px）',
    geo.pillTexts.length > 0 && Math.abs(worst.above - worst.below) / 2 <= 0.6,
    `偏差最大「${worst.text}」上 ${worst.above} / 下 ${worst.below}，胶囊高 ${worst.pillH}`);

  /* 页头 / 筛选行自身带 padding-right:6px（补偿滚动条），所以要比的是「内容右缘」：
     页头取最右的搜索框、筛选行取最右的排序控件、网格取网格本身（scrollbar-gutter 已扣掉 6px） */
  const rightNodes = [
    ['页头内容', geo.search],
    ['筛选行内容', geo.sort],
    ['网格', geo.grid],
  ].filter(p => p[1]);
  const rights = rightNodes.map(p => p[1].right);
  check('C7 页头 / 筛选行 / 网格 右缘对齐',
    rightNodes.length === 3 && Math.abs(Math.max(...rights) - Math.min(...rights)) <= 1,
    rightNodes.map((p, i) => `${p[0]} ${rights[i].toFixed(1)}`).join(' / '));

  const lefts = [geo.header, geo.filters, geo.grid, geo.titles].filter(Boolean).map(b => b.left);
  check('C8 页头 / 筛选行 / 网格 左缘对齐',
    lefts.length === 4 && Math.abs(Math.max(...lefts) - Math.min(...lefts)) <= 1,
    `左缘 ${lefts.map(v => v.toFixed(1)).join(' / ')}`);

  /* 侧栏「全部」项与主区「全部」胶囊必须等高、且顶边齐平（两者是同一水平带上的两个入口） */
  const lead = geo.navLead, pillA = geo.firstPill;
  check('C9 侧栏「全部」项 = 主区「全部」胶囊（等高 + 顶边对齐）',
    lead && pillA && Math.abs(lead.h - pillA.h) <= 1 &&
    Math.abs(lead.top - pillA.top) <= 1 && Math.abs(lead.bottom - pillA.bottom) <= 1,
    `侧栏 ${lead && lead.top.toFixed(1)}–${lead && lead.bottom.toFixed(1)}（高 ${lead && lead.h.toFixed(1)}）` +
    ` / 胶囊 ${pillA && pillA.top.toFixed(1)}–${pillA && pillA.bottom.toFixed(1)}（高 ${pillA && pillA.h.toFixed(1)}）`);

  /* 页头文字块必须整体落在侧栏顶部分隔线之上（含搜索框），两列顶部才是同一条带 */
  check('C10 页头内容整体在侧栏顶部分隔线之上',
    geo.titles && geo.search && geo.divider0 &&
    geo.titles.bottom < geo.divider0.top && geo.search.bottom < geo.divider0.top,
    `标题组底 ${geo.titles && geo.titles.bottom.toFixed(1)} / 搜索框底 ${geo.search && geo.search.bottom.toFixed(1)}` +
    ` / 分隔线顶 ${geo.divider0 && geo.divider0.top.toFixed(1)}`);

  /* 页头带高必须等于侧栏品牌区高，两列顶部才是同一条带 */
  check('C11 页头带高 = 侧栏品牌区高',
    geo.header && geo.brand && Math.abs(geo.header.h - geo.brand.h) <= 1,
    `页头 ${geo.header && geo.header.h.toFixed(1)} / 品牌区 ${geo.brand && geo.brand.h.toFixed(1)}`);

  /* 侧栏分组标签与下方内容的间距 = 5px（标签盒内让 3px + nav gap 2px） */
  check('C12 侧栏分组标签与下方内容间距 = 5px',
    geo.navGaps.length === 2 && geo.navGaps.every(g => g.gap != null && Math.abs(g.gap - 5) <= 0.5),
    geo.navGaps.map(g => `「${g.text}」文字底 ${g.textBottom} → 下一项顶 ${g.nextTop}（间距 ${g.gap}）`).join(' | '));

  /* ---------- D 拥有状态标记 ---------- */
  /* 先清掉本机标记，保证每次运行都从「未购」出发 */
  await page.evaluate(() => { try { localStorage.removeItem('cng-owned-v1'); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(600);

  const realId = await page.$eval('.card', n => n.dataset.id);
  const realTitle = await page.$eval('.card .card__title', n => n.textContent.trim());

  await page.click('.card');
  await sleep(250);
  const modal = await page.evaluate(() => {
    const m = document.getElementById('ownedModal');
    return { open: !m.hidden, id: m.dataset.id,
             opts: Array.from(m.querySelectorAll('.owned-modal__opt'))
                     .map(b => b.querySelector('.owned-modal__name').textContent.trim()) };
  });
  check('D1 点卡片非图片区弹出弹层（已购 / 未购）',
    modal.open && modal.id === realId && modal.opts.length === 2 &&
    modal.opts[0] === '已购' && modal.opts[1] === '未购',
    `打开 ${modal.open} / 指向 ${modal.id} / 选项 ${modal.opts.join(' · ')}`);

  /* 全屏遮罩 + 卡片在屏幕正中 */
  const modalGeo = await page.evaluate(() => {
    const o = document.getElementById('ownedModal');
    const c = o.querySelector('.owned-modal__card');
    const or = o.getBoundingClientRect(), cr = c.getBoundingClientRect();
    return {
      vw: innerWidth, vh: innerHeight,
      ow: +or.width.toFixed(1), oh: +or.height.toFixed(1),
      ox: +or.left.toFixed(1), oy: +or.top.toFixed(1),
      dcx: +(cr.left + cr.width / 2 - innerWidth / 2).toFixed(1),
      dcy: +(cr.top + cr.height / 2 - innerHeight / 2).toFixed(1),
    };
  });
  check('D2 弹层是铺满视口的遮罩，卡片正好落在屏幕正中',
    modalGeo.ow === modalGeo.vw && modalGeo.oh === modalGeo.vh &&
    modalGeo.ox === 0 && modalGeo.oy === 0 &&
    Math.abs(modalGeo.dcx) <= 1 && Math.abs(modalGeo.dcy) <= 1,
    `遮罩 ${modalGeo.ow}×${modalGeo.oh} @ ${modalGeo.ox},${modalGeo.oy} / 卡片中心偏差 ${modalGeo.dcx},${modalGeo.dcy}`);

  /* 第一优先级：z-index 必须高于封面放大层 */
  const zs = await page.evaluate(() => ({
    modal:  parseInt(getComputedStyle(document.getElementById('ownedModal')).zIndex, 10),
    viewer: parseInt(getComputedStyle(document.getElementById('viewer')).zIndex, 10),
  }));
  check('D3 弹层是页面上最高优先级的浮层（z-index 高于封面放大层）',
    zs.modal > zs.viewer, `弹层 ${zs.modal} / 封面放大层 ${zs.viewer}`);

  const modalTitle = await page.$eval('#ownedModalTitle', n => n.textContent.trim());
  check('D4 弹层里显示该刊物名', modalTitle === realTitle, `${modalTitle}`);

  await page.evaluate(() => { document.querySelector('.owned-modal__opt[data-owned="1"]').click(); });
  await sleep(200);
  const dot = await page.evaluate(() => {
    const d = document.querySelector('.card .card__owned');
    if (!d) return null;
    const info = document.querySelector('.card__info');
    const title = document.querySelector('.card__title');
    const dr = d.getBoundingClientRect(), ir = info.getBoundingClientRect(), tr = title.getBoundingClientRect();
    return {
      w: +dr.width.toFixed(1), h: +dr.height.toFixed(1),
      leftDiff: +(dr.left - ir.left).toFixed(1),
      below: +(dr.top - tr.bottom).toFixed(1),
      bg: getComputedStyle(d).backgroundColor,
      radius: getComputedStyle(d).borderRadius,
    };
  });
  check('D5 选「已购」后刊名下方出现小圆点（比信息区左缘右移 3px）',
    !!dot && dot.w <= 8 && Math.abs(dot.leftDiff - 3) <= 1 && dot.below > 0,
    dot ? `尺寸 ${dot.w}×${dot.h} / 比信息区左缘右移 ${dot.leftDiff}px / 刊名下方 ${dot.below}px` : '没出现圆点');

  check('D6 圆点是正圆且为绿色',
    !!dot && dot.radius === '50%' && (function () {
      const m = (dot.bg || '').match(/\d+/g);
      return !!m && +m[1] > 120 && (+m[1] - +m[0]) > 60 && (+m[1] - +m[2]) > 60;
    })(),
    dot ? `${dot.bg} / 圆角 ${dot.radius}` : '没出现圆点');

  await page.click('.card');
  await sleep(200);
  await page.evaluate(() => { document.querySelector('.owned-modal__opt[data-owned="0"]').click(); });
  await sleep(200);
  const dotGone = (await page.$('.card .card__owned')) === null;
  check('D7 改选「未购」后圆点消失、卡片无任何标记', dotGone, dotGone ? '' : '圆点仍在');

  await page.click('.card');
  await sleep(200);
  await page.evaluate(() => { document.querySelector('.owned-modal__opt[data-owned="1"]').click(); });
  await sleep(250);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(600);
  const persisted = (await page.$('.card .card__owned')) !== null;
  check('D8 刷新页面后已购标记仍在（localStorage）', persisted, persisted ? '' : '刷新后丢了');

  await page.click('.card__cover');
  await sleep(350);
  const coverAct = await page.evaluate(() => ({
    viewer: !document.getElementById('viewer').hidden,
    modal:  !document.getElementById('ownedModal').hidden,
  }));
  check('D9 点封面仍只放大原图，不弹弹层',
    coverAct.viewer && !coverAct.modal,
    `放大 ${coverAct.viewer} / 弹层 ${coverAct.modal}`);
  await page.keyboard.press('Escape');
  await sleep(200);

  await page.click('.card');
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(200);
  const escClosed = await page.$eval('#ownedModal', n => n.hidden);
  check('D10 Esc 收起弹层', escClosed, escClosed ? '' : '没收起');

  /* 点遮罩空白处（左上角，肯定在居中卡片之外）= 取消 */
  await page.click('.card');
  await sleep(200);
  await page.mouse.click(20, 20);
  await sleep(200);
  const backdropClosed = await page.$eval('#ownedModal', n => n.hidden);
  check('D11 点遮罩空白处收起弹层', backdropClosed, backdropClosed ? '' : '没收起');

  check('D12 无 JS 报错', errors.length === 0, errors.join(' ;; '));

  /* ---------- F 封面缩略图不被裁切 ----------
     杂志封面并非都是 3:4，用 object-fit:cover 会切掉边缘。
     这里直接比对「缩略图比例」与「原图比例」，确认缩略图本身没被裁过；
     再确认卡片上用 contain（而不是 cover）来显示。 */
  const coverFit = await page.$eval('.card__cover img', n => getComputedStyle(n).objectFit);
  check('F1 封面缩略图用 contain 显示（不裁切）', coverFit === 'contain', 'object-fit: ' + coverFit);

  const ratioCheck = await page.evaluate(async () => {
    const load = (src) => new Promise(res => {
      const im = new Image();
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => res(null);
      im.src = src;
    });
    const out = [];
    for (const c of Array.from(document.querySelectorAll('.card'))) {
      const id = c.dataset.id;
      const img = c.querySelector('.card__cover img');
      const thumb = await load(img.getAttribute('src'));
      const full = await load('covers/full/' + id + '.jpg');
      if (!thumb || !full) { out.push({ id, ok: false, rt: 0, rf: 0 }); continue; }
      const rt = thumb.w / thumb.h, rf = full.w / full.h;
      out.push({ id, rt: +rt.toFixed(4), rf: +rf.toFixed(4), ok: Math.abs(rt - rf) < 0.005 });
    }
    return out;
  });
  const ratioBad = ratioCheck.filter(r => !r.ok);
  check('F2 每张缩略图都保留原图比例（没被裁过）', ratioBad.length === 0,
    ratioCheck.map(r => `${r.id} ${r.rt} vs ${r.rf}`).join(' / '));

  const oddRatio = ratioCheck.filter(r => r.ok && Math.abs(r.rf - 0.75) > 0.01);
  check('F3 数据里确实有非 3:4 的封面（F1 才有意义）', oddRatio.length > 0,
    oddRatio.length ? oddRatio.map(r => `${r.id} ${r.rf}`).join(' / ') : '全部都是 3:4，F1 形同虚设');

  check('F4 无 JS 报错', errors.length === 0, errors.join(' ;; '));

  await page.close();

  /* ================= 场景 B：模拟数据 ================= */
  mockData = mockCatalog();
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 780 });
  errors = await collectErrors(page);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await sleep(500);

  const mTotal = mockData.length;
  check('B1 卡片数 = 模拟条数', await count(page, '.card') === mTotal,
    `${await count(page, '.card')} / ${mTotal}`);

  const cols = await page.$eval('#grid', n =>
    getComputedStyle(n).gridTemplateColumns.split(' ').filter(Boolean).length);
  check('B2 1440 宽下 3 列', cols === 3, cols + ' 列');

  const cardW = await page.$eval('.card', n => Math.round(n.getBoundingClientRect().width));
  check('B3 卡片宽 368', Math.abs(cardW - 368) <= 2, cardW + 'px');

  const scroll = await page.$eval('#scroller', n => ({
    sh: n.scrollHeight, ch: n.clientHeight,
  }));
  check('B4 滚动区可滚动', scroll.sh > scroll.ch + 20,
    `scrollHeight ${scroll.sh} / clientHeight ${scroll.ch}`);

  const navY = await page.$$eval('#yearList .nav__item .nav__text', ns => ns.map(n => n.textContent.trim()));
  check('B5 年份降序且齐全', navY[0] === '2026' && navY[navY.length - 1] === '2012' && navY.length === 15,
    navY.join(','));

  // 年份筛选
  await page.$$eval('#yearList .nav__item', ns => {
    const t = ns.filter(n => n.textContent.trim().indexOf('2015') === 0)[0];
    t.click();
  });
  await sleep(200);
  const y2015Sub = await text(page, '#pageSub');
  const all2015 = await page.$$eval('.card', ns =>
    ns.every(n => n.dataset.id.indexOf('-2015-') > 0));
  check('B6 点年份筛选生效',
    (y2015Sub || '').indexOf('2015 年') === 0 && all2015,
    `副标题「${y2015Sub}」全部为 2015：${all2015}`);

  // 回到全部 + 类别筛选
  await page.click('.nav__item--lead');
  await sleep(200);
  const pillLabels = await page.$$eval('.pill', ns => ns.map(n => n.textContent.trim()));
  const wantPill = pillLabels.filter(t => t.indexOf('附刊') === 0)[0];
  if (wantPill) {
    await page.$$eval('.pill', ns => {
      ns.filter(n => n.textContent.indexOf('附刊') === 0)[0].click();
    });
    await sleep(200);
    const tags = await page.$$eval('.card__tag', ns => ns.map(n => n.textContent.trim()));
    check('B7 类别筛选生效', tags.length > 0 && tags.every(t => t === '附刊'),
      `${tags.length} 张，标签集合 ${[...new Set(tags)].join('/')}`);
  } else {
    check('B7 类别筛选生效', false, '模拟数据里没有附刊');
  }

  // 搜索
  await page.click('.nav__item--lead');
  await sleep(150);
  await page.$$eval('.pill', ns => ns[0].click());
  await sleep(150);
  await page.type('#searchInput', '2015年第1期');
  await sleep(400);
  const searched = await page.$$eval('.card__title', ns => ns.map(n => n.textContent.trim()));
  check('B8 搜索生效', searched.length > 0 && searched.every(t => t.indexOf('2015年第1期') === 0),
    `${searched.length} 条`);

  // 清空搜索 + 排序切换
  await page.$eval('#searchInput', n => { n.value = ''; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(400);
  await page.click('#sortBtn');
  await sleep(150);
  await page.$$eval('.sort__opt', ns => ns.filter(n => n.dataset.sort === 'old')[0].click());
  await sleep(250);
  const firstYear = await page.$eval('.card', n => Number(n.dataset.id.split('-')[1]));
  const lastYear = await page.$$eval('.card', ns => Number(ns[ns.length - 1].dataset.id.split('-')[1]));
  const sortLabel = await text(page, '#sortLabel');
  check('B9 排序切换生效', sortLabel === '最早出版' && firstYear <= lastYear,
    `标签「${sortLabel}」，首 ${firstYear} → 末 ${lastYear}`);

  check('B10 无 JS 报错', errors.length === 0, errors.join(' ;; '));

  /* ================= 场景 E：年份页「按期号」排序 =================
     模拟数据里偶数年会多一条无期号的条目（mock-YYYY-tk），正好用来测「无期号垫底」 */

  const ids = () => page.$$eval('.card', ns => ns.map(n => n.dataset.id));

  // 回到全部并切到 2014（2014 有 1、2 期 + 一条无期号）
  await page.click('.nav__item--lead');
  await sleep(150);
  await page.$$eval('#yearList .nav__item', ns => {
    ns.filter(n => n.textContent.trim().indexOf('2014') === 0)[0].click();
  });
  await sleep(250);
  const eLabel = await text(page, '#sortLabel');
  check('E1 点进年份页自动切成「按期号」', eLabel === '按期号', `排序标签「${eLabel}」`);

  const eSeq = await ids();
  const eIssuedOnly = eSeq.filter(id => !/-tk$/.test(id));
  const eIssued = eIssuedOnly.map(id => Number(id.split('-')[2]));
  const eTail = eSeq.slice(eIssuedOnly.length);
  const asc = eIssued.every((v, i) => i === 0 || v > eIssued[i - 1]);
  const tailAllNoIssue = eTail.length > 0 && eTail.every(id => /-tk$/.test(id));
  const issuedLead = eSeq.slice(0, eIssuedOnly.length).join(',') === eIssuedOnly.join(',');
  check('E2 年份内按期号升序，无期号的垫在末尾',
    eSeq.length > 0 && eIssued.length > 0 && asc && tailAllNoIssue && issuedLead,
    `顺序 ${eSeq.join(' → ')}`);

  // 回到全部：排序应回到默认的「最近出版」
  await page.click('.nav__item--lead');
  await sleep(250);
  const backLabel = await text(page, '#sortLabel');
  const backFirst = await page.$eval('.card', n => n.dataset.id);
  check('E3 回到「全部」自动回到「最近出版」（最新年份在前）',
    backLabel === '最近出版' && Number(backFirst.split('-')[1]) === 2026,
    `排序标签「${backLabel}」/ 首张 ${backFirst}`);

  // 在全部视图手动选「按期号」：年份降序，同年内期号升序
  await page.click('#sortBtn');
  await sleep(150);
  await page.$$eval('.sort__opt', ns => ns.filter(n => n.dataset.sort === 'issue')[0].click());
  await sleep(250);
  const allSeq = await ids();
  const yearsOf = allSeq.map(id => Number(id.split('-')[1]));
  const yearsDesc = yearsOf.every((v, i) => i === 0 || v <= yearsOf[i - 1]);
  const y2026 = allSeq.filter(id => id.indexOf('-2026-') > 0 && !/-tk$/.test(id))
                      .map(id => Number(id.split('-')[2]));
  const y2026Asc = y2026.every((v, i) => i === 0 || v > y2026[i - 1]);
  const manualLabel = await text(page, '#sortLabel');
  check('E4 全部视图选「按期号」= 年份降序 + 同年期号升序',
    manualLabel === '按期号' && yearsDesc && y2026Asc,
    `标签「${manualLabel}」/ 年份降序 ${yearsDesc} / 2026 期号 ${y2026.join(',')} 升序 ${y2026Asc}`);

  check('E5 无 JS 报错', errors.length === 0, errors.join(' ;; '));

  await browser.close();
  server.close();

  /* ---------------- 汇总 ---------------- */
  const pass = results.filter(r => r.pass).length;
  console.log('');
  results.forEach(r => {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '   [' + r.detail + ']' : ''}`);
  });
  console.log('');
  console.log(`合计 ${pass}/${results.length}`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(err => {
  console.error('冒烟测试异常：', err);
  process.exit(2);
});
