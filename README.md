# 中国国家地理刊物目录

中国国家地理历年特别刊物目录 —— **专辑 / 特刊 / 增刊 / 附刊 / 图书** 五类，78 期、156 张封面，支持购入标记与按年份 / 类别 / 关键词筛选、多种排序。桌面与手机自适应。

**线上：https://sunyh-gi.github.io/cng-catalog/**

## 仓库结构

| 路径 | 说明 |
|---|---|
| `index.html` | 单文件工作台（v3.12），桌面 + 手机两套布局 |
| `catalog.js` | 数据真源，78 条 `year` / `issue` / `type` / `title` |
| `covers/` | 封面 `full` 与 `thumb`，各 78 张 |
| `CHANGELOG.md` | 完整变更史（版本节 + 数据更新节） |
| `_add_cover.py` · `_check_cover.py` | 封面录入 / 入库前核验 |
| `_smoke.js` | 回归冒烟，70 项断言（含手机端） |
| `_gh_push.js` | 推送，只推变化文件 |
| `_shot.js` · `_probe_align.js` | 截图 / 像素对齐探针 |

## 维护

```bash
python _check_cover.py        # 封面核验：完整性 / 红边 / 内容框 / 无书脊 / 查重
python _add_cover.py --help   # 录入新刊：自动生成缩略图，写 catalog.js + covers
node   _smoke.js              # 回归冒烟（EDGE_PATH 指定 Edge）
node   _gh_push.js --dry-run  # 核对变化清单；去掉 --dry-run 即推送
```

流程：封面图 → 核验 → 录入 → 冒烟 → 记 CHANGELOG「数据更新」。

## 口径

- **刊名与种类是两回事**：「特辑」「专刊」只是名称，种类看性质（专辑 / 特刊 / 增刊 / 附刊 / 图书）
- 封面一律「无书脊版」；红边框是素材固有样式、不裁剪，内容框比例 ≈ 0.655
- **版本号只代表页面本身**：录数据、改文档、改脚本都不抬版本，记 CHANGELOG「数据更新」节
