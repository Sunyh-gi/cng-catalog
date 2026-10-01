# 中国国家地理刊物目录（cng-catalog）

> 中国国家地理历年刊物目录工作台：省份专辑 / 年度增刊 / 特刊 / 附刊 / 图书五类，78 期数据 + 156 张封面，含购入标记与多维度筛选。桌面与手机端自适应（≤700px 走单列纵流，实测 320–390px 无横向溢出）。线上地址：**https://sunyh-gi.github.io/cng-catalog/**（GitHub Pages，public 仓 `Sunyh-gi/cng-catalog`）。

## 快速上手

| 操作 | 方法 |
|---|---|
| 录入新刊 | 用户发封面图 → `_check_cover.py` 核验 → `_add_cover.py` 录入（自动写 catalog.js + covers）→ 冒烟 → CHANGELOG 记「数据更新」 |
| 封面核验 | `python _check_cover.py`（完整性/红边/内容框/无书脊/查重/偏小） |
| 发布 | `node _gh_push.js --dry-run` 核对 → `node _gh_push.js`（PAT 在 `.gh_token`，幂等只推变化文件） |
| 发布核验 | `python _verify_live.py`（7 项全过才算成功；Pages CDN 有 2–4 分钟滞后，别误判） |
| 回归 | `node _smoke.js`（70 断言，含手机端 G 轮；EDGE_PATH 指定 Edge） |
| 改标题 | 直接 Edit catalog.js（勿拿 covers/full/<id>.jpg 当 --src，会报 WinError 32） |

## 文件结构

```
中国国家地理刊物\
├── index.html          # 单文件工作台（v3.12；桌面 + 手机 ≤700px 两套布局）
├── catalog.js          # 数据真源（78 条：year/issue/type/title…）
├── covers\             # 156 张封面（full + thumb）
├── CHANGELOG.md        # 110KB 完整变更史（版本节 + 数据更新节）
├── DEV_NOTES.md / README.md
├── _add_cover.py       # 封面录入（自动缩略图；--title 帮助含三类命名规范）
├── _check_cover.py     # 封面入库前核验
├── _gh_push.js / .gh_token(.example)   # GitHub 推送（⚠ PAT 勿外传）
├── _verify_live.py     # 线上核验（7 项）
├── _smoke.js / _shot.js / _probe_align.js
├── 预览-*.png × 5      # 关键方案对比截图
└── docs\日志\          # 09-22（设计稿）+ 09-23（录入约定）+ 09-24（78 条收官）日志
```

## 核心口径（详见 项目记忆.md）

- **刊名与种类是两回事**：特辑/专刊只是名称；种类看性质（专辑/特刊/增刊/附刊/图书）
- 封面一律「无书脊版」；红边框是素材固有样式不裁剪；真封面内容框比例 ≈ 0.655
- 版本号只代表页面本身：录数据不抬版本，记 CHANGELOG「数据更新」

## 详细历史

- `docs\日志\2026-09-22.md`（设计稿 13 轮）、`2026-09-23-*.md`（录入约定）、`2026-09-24-*.md`（18 本新增 + 图书分类 + 推送上线）、`2026-10-01-手机端布局.md`（v3.12 根因排查与改法）
