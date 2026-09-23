# -*- coding: utf-8 -*-
"""
封面入库前核对工具 —— 录入新刊/替换封面之前跑一遍，避免出错。

用法：
  python _check_cover.py "C:\\path\\cover.jpg"
  python _check_cover.py "C:\\path\\cover.jpg" --id 2016-TK-sanjiangyuan

它检查什么（都是踩过坑才知道要看的）：
  1. 文件完整性         `Image.verify()` 能否通过（截断/损坏）
  2. 基本尺寸与体积      宽高、整图比例、KB
  3. 红边与内容框       「红框」是本刊封面素材的固有样式，不是瑕疵；
                        真正有意义的是**去掉红边后的画面比例**，全库主流为 0.653–0.657。
                        整图比例（0.66–0.75）差异全来自红边留多留少，不能用来判断是否变形。
  4. 无书脊判定         左红边/上红边内若出现大量非红像素，多半是竖排书脊文字（要换图）；
                        注意只有红边宽度范围内的采样才算数，别把红边以内的画面当书脊。
  5. 全库 md5 排重      与 covers/full 逐字节比对，防止误发重复图
  6. id 占用查询        配合 --id 使用：id 已在库中 = 这是「替换封面」，记得先备份旧图；
                        id 不在库中 = 这是「新增刊目」
  7. 尺寸偏小提醒       宽 <690px（全库主流宽度）会提示，方便决定要不要找高清版重录

判读口径：
  · 红框不完整（某边测不到、四角深浅不一）是扫描/图源差异 → **不裁剪、不处理**
  · 内容框比例落在 0.653–0.657 → 画面正常；明显偏离先怀疑红框检出不全，而非变形
  · 左红边内非红约 0%  → 无书脊，可用
"""
import argparse
import hashlib
import os
import re
import sys

from PIL import Image

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FULL_DIR = os.path.join(BASE_DIR, "covers", "full")
THUMB_DIR = os.path.join(BASE_DIR, "covers", "thumb")
CATALOG_PATH = os.path.join(BASE_DIR, "catalog.js")

MAIN_RATIO_LO, MAIN_RATIO_HI = 0.653, 0.657   # 全库「去掉红边的画面比例」主流区间
MAINSTREAM_WIDTH = 690                        # 全库主流封面宽度


def reddish(p):
    """红框判定：偏红即可，容忍扫描件里偏暗/偏粉的红。"""
    r, g, b = p[0], p[1], p[2]
    return r >= 140 and (r - g) >= 60 and (r - b) >= 60


def scan_width(px, w, h, fixed, axis, forward):
    """沿一条直线扫红色带宽度。axis='x' 固定 y 扫 x；axis='y' 固定 x 扫 y。"""
    n = 0
    limit = w - 1 if axis == "x" else h - 1
    while n <= limit:
        k = n if forward else limit - n
        p = px[k, fixed] if axis == "x" else px[fixed, k]
        if not reddish(p):
            break
        n += 1
    return n


def count_non_red(px, w, h, rng, axis):
    tot = non = 0
    for k in rng:
        span = range(h) if axis == "col" else range(w)
        for t in span:
            p = px[k, t] if axis == "col" else px[t, k]
            tot += 1
            if not reddish(p):
                non += 1
    return non, tot


def catalog_ids():
    if not os.path.exists(CATALOG_PATH):
        return []
    raw = open(CATALOG_PATH, encoding="utf-8").read()
    m = re.search(r"window\.CNG_CATALOG\s*=\s*(\[[\s\S]*?\])\s*;", raw)
    if not m:
        sys.exit("catalog.js 格式异常：找不到 window.CNG_CATALOG = [...] 数组")
    import json
    return [e.get("id") for e in json.loads(m.group(1))]


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--src", help="封面原图路径（也可直接作为第一个位置参数）")
    ap.add_argument("--id", help="拟用的刊目 id，用于查询是否已在库中")
    ap.add_argument("src_pos", nargs="?", help=argparse.SUPPRESS)
    args = ap.parse_args()

    src = args.src or args.src_pos
    if not src:
        ap.error("缺少封面原图路径")
    if not os.path.isfile(src):
        sys.exit("找不到原图：%s" % src)

    print("=" * 72)
    print("文件 %s" % os.path.basename(src))
    size = os.path.getsize(src)
    print("  体积 %.1f KB (%d 字节)" % (size / 1024.0, size))

    try:
        with Image.open(src) as im:
            im.verify()
        print("完整性 verify() 通过（未截断/未损坏）")
    except Exception as exc:
        print("完整性 verify() **失败**：%s  → 这张图不能用" % exc)

    with Image.open(src) as im:
        w, h = im.size
        print("  尺寸 %d x %d   mode=%s   format=%s" % (w, h, im.mode, im.format))
        print("  整图比例 %.4f（仅供参考，红边多寡会显著影响这个数）" % (w / float(h)))
        px = im.convert("RGB").load()

        l = scan_width(px, w, h, h // 2, "x", True)
        r = scan_width(px, w, h, h // 2, "x", False)
        t = scan_width(px, w, h, w // 2, "y", True)
        b = scan_width(px, w, h, w // 2, "y", False)
        print("  红边(中轴线) 左%d 上%d 右%d 下%d" % (l, t, r, b))
        if min(l, r) or min(t, b):
            cw, ch = w - l - r, h - t - b
            if cw > 0 and ch > 0:
                ratio = cw / float(ch)
                flag = "落主流区间 ✔" if MAIN_RATIO_LO <= ratio <= MAIN_RATIO_HI else "偏离主流，先怀疑红框检出不全"
                print("  画面内容框 %d x %d   r=%.4f  → %s" % (cw, ch, ratio, flag))
        for name, pt in (("左上", (2, 2)), ("右上", (w - 3, 2)),
                         ("左下", (2, h - 3)), ("右下", (w - 3, h - 3))):
            print("  角 %s %s" % (name, px[pt[0], pt[1]]))

        # 书脊判定：只看红边宽度以内，留 2px 余量避免吃到画面
        for name, width, axis in (("左红边", l, "col"), ("上红边", t, "row")):
            span = max(width - 2, 0)
            if span <= 0:
                print("  %s 未检出，跳过书脊判定" % name)
                continue
            non, tot = count_non_red(px, w, h, range(span), axis)
            pct = 100.0 * non / tot
            verdict = "无书脊 ✔" if pct < 1.0 else "**疑似书脊文字/图案，建议换图**"
            print("  %s(%dpx) 内非红 %.2f%%（%d/%d）→ %s" % (name, width, pct, non, tot, verdict))

        # 右红边逐行宽度：红框是否断续
        widths = [scan_width(px, w, h, y, "x", False) for y in range(h)]
        sw = sorted(widths)
        broken = sum(1 for x in widths if x < 10)
        print("  右红边逐行宽度 min=%d 中位=%d max=%d；<10px 的行 %d/%d%s"
              % (sw[0], sw[len(sw) // 2], sw[-1], broken, h,
                 "（红框断续，扫描差异，不处理）" if broken else ""))

    with open(src, "rb") as fh:
        my_md5 = hashlib.md5(fh.read()).hexdigest()
    print("  md5 %s" % my_md5)

    hits, n = [], 0
    if os.path.isdir(FULL_DIR):
        for fn in sorted(os.listdir(FULL_DIR)):
            if not fn.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                continue
            n += 1
            with open(os.path.join(FULL_DIR, fn), "rb") as fh:
                if hashlib.md5(fh.read()).hexdigest() == my_md5:
                    hits.append(fn)
    print("  与库内 %d 张封面逐字节比对：%s" % (n, ("**重复 → %s**" % ", ".join(hits)) if hits else "无重复 ✔"))

    if w < MAINSTREAM_WIDTH:
        print("⚠ 宽度 %dpx 低于全库主流 %dpx —— 素材偏小，看看有没有高清版" % (w, MAINSTREAM_WIDTH))

    if args.id:
        ids = catalog_ids()
        print("-" * 72)
        if args.id in ids:
            print("id `%s` **已在库中（共 %d 条）→ 这是「替换封面」**" % (args.id, len(ids)))
            print("  替换前务必按约定备份旧图到根目录 `_backup_%s_full_<WxH>.jpg`" % args.id)
        else:
            print("id `%s` 不在库中（共 %d 条）→ 这是「新增刊目」" % (args.id, len(ids)))
            if os.path.exists(os.path.join(FULL_DIR, args.id + ".jpg")):
                print("  ⚠ 但 covers/full 里已有同名文件，注意核对")
    print("=" * 72)


if __name__ == "__main__":
    main()
