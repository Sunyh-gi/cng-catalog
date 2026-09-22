/* 本地 → GitHub Contents API 同步脚本（不落盘 token，从环境变量 GHPAT 或同目录 .gh_token 读取）
 * 用法: node _gh_push.js [--create] [--pages] [--msg "提交说明"]
 *   --create  仓库不存在时创建（public，因为免费账号的 Pages 只对 public 仓开放）
 *   --pages   追加启用 GitHub Pages（main / root）
 *   --msg     覆盖默认提交说明
 * 推送清单: 下方 STATIC 白名单 + 自动扫描 covers/full 与 covers/thumb 下的所有图片
 *   STATIC 是显式白名单，本地文件（如 DEV_NOTES.md）不在其中就不会被推上去。
 * 覆盖前自动 GET 取 sha；新建文件自动跳过 sha；每文件推送后回读 sha 校验。
 * 排除: 预览-*.png（本地决策记录）、_shot*.png、_tmp/、__pycache__/、DEV_NOTES.md
 */
const fs = require("fs");
const path = require("path");

const REPO = process.env.GH_REPO || "Sunyh-gi/cng-catalog";
const BRANCH = "main";
const TOKEN = process.env.GHPAT || (function () {
  try { return fs.readFileSync(path.join(__dirname, ".gh_token"), "utf8").trim(); } catch (e) { return ""; }
})();
if (!TOKEN) { console.error("缺少 token：请把 classic PAT 写入同目录 .gh_token 文件，或设置 GHPAT 环境变量"); process.exit(2); }

const STATIC = [
  "index.html",
  "catalog.js",
  "logo.jpg",
  "favicon.png",
  "favicon.ico",
  "README.md",
  "CHANGELOG.md",
  ".gitignore",
  ".gh_token.example",
  "_add_cover.py",
  "_smoke.js",
  "_shot.js",
  "_gh_push.js",
  "_probe_align.js"
];
const SCAN_DIRS = ["covers/full", "covers/thumb"];

const DEFAULT_MSG = "chore: 同步中国国家地理刊物目录";

const API = "https://api.github.com";

function listFiles() {
  const out = STATIC.filter(function (f) { return fs.existsSync(path.join(__dirname, f)); });
  SCAN_DIRS.forEach(function (d) {
    const abs = path.join(__dirname, d);
    if (!fs.existsSync(abs)) return;
    fs.readdirSync(abs).sort().forEach(function (f) {
      if (/\.(jpg|jpeg|png|webp)$/i.test(f)) out.push(d + "/" + f);
    });
  });
  return out;
}

function req(url, opts) {
  opts = opts || {};
  opts.headers = Object.assign({
    "User-Agent": "gh-push-script",
    "Authorization": "Bearer " + TOKEN,
    "Accept": "application/vnd.github+json"
  }, opts.headers || {});
  return fetch(url, opts);
}

function encPath(f) { return f.split("/").map(encodeURIComponent).join("/"); }

async function ensureRepo() {
  const g = await req(API + "/repos/" + REPO);
  if (g.status === 200) { console.log("仓库已存在: " + REPO); return; }
  if (g.status !== 404) throw new Error("GET repo -> " + g.status + " " + (await g.text()).slice(0, 200));
  if (!process.argv.includes("--create")) { throw new Error("仓库不存在，加 --create 参数可自动创建"); }
  const name = REPO.split("/")[1];
  const p = await req(API + "/user/repos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: name,
      description: "中国国家地理刊物目录 · 历年省份专辑 / 增刊 / 特刊 / 附刊",
      private: false,
      has_issues: false,
      has_wiki: false,
      has_projects: false,
      auto_init: false
    })
  });
  if (p.status !== 201) throw new Error("POST /user/repos -> " + p.status + " " + (await p.text()).slice(0, 300));
  const pj = await p.json();
  console.log("已创建仓库: " + pj.full_name + "（" + (pj.private ? "private" : "public") + "）");
}

async function pushFile(f, msg) {
  const content = fs.readFileSync(path.join(__dirname, f));
  const b64 = content.toString("base64");
  const url = API + "/repos/" + REPO + "/contents/" + encPath(f) + "?ref=" + BRANCH;
  let sha = null;
  const g = await req(url);
  if (g.status === 200) { const j = await g.json(); sha = j.sha; }
  else if (g.status !== 404) throw new Error("GET " + f + " -> " + g.status + " " + (await g.text()).slice(0, 200));
  const p = await req(API + "/repos/" + REPO + "/contents/" + encPath(f), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: msg + (sha ? " [update " + f + "]" : " [add " + f + "]"),
      branch: BRANCH,
      sha: sha || undefined,
      content: b64
    })
  });
  if (p.status !== 200 && p.status !== 201) throw new Error("PUT " + f + " -> " + p.status + " " + (await p.text()).slice(0, 300));
  const pj = await p.json();
  const newSha = pj.content && pj.content.sha;
  const v = await req(url + "&t=" + Date.now());
  if (v.status !== 200) throw new Error("VERIFY " + f + " -> " + v.status);
  const vj = await v.json();
  if (vj.sha !== newSha) throw new Error("VERIFY " + f + " sha 不一致");
  console.log((sha ? "更新" : "新建") + " " + f + " (" + content.length + " B) -> " + (newSha || "").slice(0, 8));
}

async function enablePages() {
  const p = await req(API + "/repos/" + REPO + "/pages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: { branch: BRANCH, path: "/" } })
  });
  if (p.status === 201) { console.log("Pages: 201（已启用 main / root）"); return; }
  if (p.status === 409) { console.log("Pages: 409（已启用，跳过）"); return; }
  throw new Error("POST pages -> " + p.status + " " + (await p.text()).slice(0, 300));
}

async function main() {
  await ensureRepo();
  const files = listFiles();
  const msg = (function () {
    const i = process.argv.indexOf("--msg");
    return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : DEFAULT_MSG;
  })();
  for (const f of files) await pushFile(f, msg);
  if (process.argv.includes("--pages")) await enablePages();
  const owner = REPO.split("/")[0], name = REPO.split("/")[1];
  console.log("全部完成: " + files.length + " 个文件已同步到 " + REPO + "@" + BRANCH);
  console.log("线上地址: https://" + owner.toLowerCase() + ".github.io/" + name + "/");
}

main().catch(e => { console.error("失败: " + e.message); process.exit(1); });
