# -*- coding: utf-8 -*-
"""
刊物录入工具 —— 加一期刊目 = 放一张原图 + 追加一条数据。

用法：
  python _add_cover.py --src "C:\\path\\202602.jpg" --id 2026-02 --year 2026 \
      --issue 2 --type province --title "2026年第2期 黑龙江专辑（下）"

  --id      刊目唯一标识，同时作为封面文件名（建议 YYYY-NN / YYYY-TK-xxx / YYYY-BK-xxx）
  --year    年份（整数）
  --issue   期号（整数，可省略；增刊/特刊/图书无期号时不填）
  --type    province | special | supplement | appendix | book
  --title   刊名（严格按用户命名规范）
            · 连续性出版物：YYYY年第N期 <刊名> / YYYY年特刊|增刊|附刊 <地名>
            · 图书 book  ：「年份 书名」，如 2022 发现黄河：沿黄非物质文化遗产
                            （图书不带「年」字、也不带「图书」二字，类别由 type 体现）
  --no-append   只生成图片，不写入 catalog.js

脚本做的事：
  1. 原图复制到 covers/full/<id>.jpg（JPEG 源 1:1 复制；PNG/WebP 等非 JPEG 源自动转 JPEG，
     因为页面里封面路径写死为 covers/full/<id>.jpg）
  2. 生成 480x640（3:4）缩略图到 covers/thumb/<id>.jpg
  3. 在 catalog.js 里 upsert 该条目（同 id 覆盖），并按「年份降序 + 期号降序」重排
"""

import argparse
import datetime
import json
import os
import re
import shutil
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("缺少 Pillow，请先运行：python -m pip install Pillow")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FULL_DIR = os.path.join(BASE_DIR, "covers", "full")
THUMB_DIR = os.path.join(BASE_DIR, "covers", "thumb")
CATALOG_PATH = os.path.join(BASE_DIR, "catalog.js")

THUMB_SIZE = (480, 640)          # 4:3 竖版，对应杂志封面比例
THUMB_QUALITY = 82
FULL_QUALITY = 92                # 非 JPEG 源转 JPEG 时的质量（页面只认 .jpg，见下）

TYPES = ("province", "special", "supplement", "appendix", "book")

CATALOG_HEADER = """/* 中国国家地理 · 特别刊物目录
 * 数据真源，由 _add_cover.py 生成与维护。
 *
 * 字段：
 *   id     刊目唯一标识，同时是封面文件名（不含扩展名）
 *   year   年份
 *   issue  期号（增刊/特刊/图书无期号时为 null）
 *   type   province 省份专辑 | special 特刊 | supplement 增刊 | appendix 附刊 | book 图书
 *   title  刊名
 */
window.CNG_CATALOG_UPDATED = "%s";
window.CNG_CATALOG = """


def sort_key(e):
    """年份降序，同年期号降序；无期号（增刊/特刊）排在同年最后。"""
    issue = e.get("issue")
    return (-int(e["year"]), -(issue if isinstance(issue, int) else -1))


def load_catalog():
    if not os.path.exists(CATALOG_PATH):
        return []
    with open(CATALOG_PATH, encoding="utf-8") as fh:
        raw = fh.read()
    m = re.search(r"window\.CNG_CATALOG\s*=\s*(\[[\s\S]*?\])\s*;", raw)
    if not m:
        sys.exit("catalog.js 格式异常：找不到 window.CNG_CATALOG = [...] 数组")
    return json.loads(m.group(1))


def save_catalog(entries, updated):
    body = json.dumps(entries, ensure_ascii=False, indent=2)
    with open(CATALOG_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write((CATALOG_HEADER % updated) + body + ";\n")


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--src", required=True, help="封面原图路径")
    ap.add_argument("--id", required=True, help="刊目唯一标识 / 封面文件名")
    ap.add_argument("--year", required=True, type=int)
    ap.add_argument("--issue", type=int, default=None)
    ap.add_argument("--type", required=True, choices=TYPES)
    ap.add_argument("--title", required=True)
    ap.add_argument("--no-append", action="store_true", help="只出图，不写 catalog.js")
    args = ap.parse_args()

    if not os.path.isfile(args.src):
        sys.exit("找不到原图：%s" % args.src)

    os.makedirs(FULL_DIR, exist_ok=True)
    os.makedirs(THUMB_DIR, exist_ok=True)

    # 1) 写入 covers/full/<id>.jpg（页面里封面路径写死 .jpg）
    #    JPEG 源原样复制；PNG/WebP 等非 JPEG 源（如网页/截图下载）转成 JPEG，
    #    否则文件名会变成 <id>.png，页面点开大图就 404。像素尺寸不变。
    src_ext = os.path.splitext(args.src)[1].lower()
    full_path = os.path.join(FULL_DIR, args.id + ".jpg")
    if src_ext in (".jpg", ".jpeg"):
        shutil.copy2(args.src, full_path)
    else:
        print("源图是 %s，自动转 JPEG（q%d，尺寸不变）" % (src_ext or "无扩展名", FULL_QUALITY))
        with Image.open(args.src) as im:
            im.convert("RGB").save(full_path, "JPEG", quality=FULL_QUALITY,
                                   optimize=True, progressive=True)

    # 1.5) 更新封面时清掉 full 目录里同 id、非 .jpg 的旧文件（换格式不留残图；
    #      <id>.jpg 则已被上面覆盖）。约定：更新封面一律删旧图。
    for fn in os.listdir(FULL_DIR):
        fstem, fext = os.path.splitext(fn)
        if fstem == args.id and fext.lower() != ".jpg":
            stale = os.path.join(FULL_DIR, fn)
            os.remove(stale)
            print("已删除旧封面文件 %s" % os.path.relpath(stale, BASE_DIR))

    # 2) 生成缩略图
    thumb_path = os.path.join(THUMB_DIR, args.id + ".jpg")
    with Image.open(args.src) as im:
        src_w, src_h = im.size
        im = im.convert("RGB")
        im.thumbnail(THUMB_SIZE, Image.LANCZOS)
        im.save(thumb_path, "JPEG", quality=THUMB_QUALITY,
                optimize=True, progressive=True)

    print("原图   %s  (%d x %d, %d KB)"
          % (os.path.relpath(full_path, BASE_DIR), src_w, src_h,
             os.path.getsize(full_path) // 1024))
    with Image.open(thumb_path) as t:
        print("缩略图 %s  (%d x %d, %d KB)"
              % (os.path.relpath(thumb_path, BASE_DIR), t.size[0], t.size[1],
                 os.path.getsize(thumb_path) // 1024))

    if args.no_append:
        print("已跳过 catalog.js 写入（--no-append）")
        return

    # 3) upsert + 重排
    entries = load_catalog()
    entry = {
        "id": args.id,
        "year": args.year,
        "issue": args.issue,
        "type": args.type,
        "title": args.title,
    }
    replaced = False
    for i, e in enumerate(entries):
        if e.get("id") == args.id:
            entries[i] = entry
            replaced = True
            break
    if not replaced:
        entries.append(entry)
    entries.sort(key=sort_key)
    save_catalog(entries, datetime.date.today().isoformat())

    print("%s catalog.js  共 %d 条" % ("已更新" if replaced else "已新增", len(entries)))


if __name__ == "__main__":
    main()
