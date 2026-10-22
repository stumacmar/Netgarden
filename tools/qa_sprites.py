#!/usr/bin/env python3
"""Check every sprite for the faults found in review and mark the bad ones rejected in the manifest.
The app then draws those plants itself until a better image replaces them, and
`sprites.py generate-all` regenerates anything marked rejected.

Checks (per assets/sprites/<id>/<state>.png):
  empty      : almost no opaque pixels, or the cut-out took most of the frame (background not keyed)
  bare-leafy : a "bare" winter sprite that is mostly green
  flat       : fewer than 12 distinct colours among opaque pixels (a vector-style illustration)
  squashed   : aspect ratio wildly off the plant's height to spread

  qa_sprites.py [--apply] [--only id1,id2]
Without --apply it only prints the report."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sprites
from PIL import Image

def blobs(mask, w, h, limit=4000):
    """largest 4-connected blob in a boolean list, scanning at most `limit` seeds"""
    seen = bytearray(w * h); best = 0; seeds = 0
    for start in range(0, w * h, 7):
        if not mask[start] or seen[start]: continue
        seeds += 1
        if seeds > limit: break
        stack = [start]; seen[start] = 1; n = 0
        while stack:
            i = stack.pop(); n += 1; x, y = i % w, i // w
            for j in ((i - 1) if x > 0 else -1, (i + 1) if x < w - 1 else -1, (i - w) if y > 0 else -1, (i + w) if y < h - 1 else -1):
                if j >= 0 and mask[j] and not seen[j]: seen[j] = 1; stack.append(j)
        best = max(best, n)
    return best

def check(pid, st, e, p):
    path = os.path.join(sprites.ROOT, e['file'])
    if not os.path.exists(path): return ['missing']
    im = Image.open(path).convert('RGBA'); im.thumbnail((256, 256)); w, h = im.size
    px = list(im.getdata()); opaque = [c for c in px if c[3] > 128]
    faults = []
    cover = len(opaque) / max(1, len(px))
    if cover < 0.03 or cover > 0.92: faults.append('empty')
    if opaque:
        green = sum(1 for r, g, b, a in opaque if g > r + 15 and g > b + 15) / len(opaque)
        if st == 'bare' and green > 0.3: faults.append('bare-leafy')
        colours = len(set((r // 24, g // 24, b // 24) for r, g, b, a in opaque))
        if colours < 12: faults.append('flat')
    asp = w / h; want = max(0.2, p.get('s', 1)) / max(0.2, p.get('h', 1))
    if asp > want * 4 or asp < want / 4: faults.append('squashed')
    return faults

def main():
    a = sys.argv[1:]; apply = '--apply' in a
    only = set(a[a.index('--only') + 1].split(',')) if '--only' in a else None
    plants = sprites.load_plants(); m = sprites.load_manifest(); n = 0; bad = 0
    for pid, states in m.items():
        if only and pid not in only: continue
        p = plants.get(pid)
        if not p: continue
        for st, e in states.items():
            if not e.get('file'): continue
            n += 1; f = check(pid, st, e, p)
            if f:
                bad += 1; print(f'{pid:26s} {st:7s} {", ".join(f)}')
                if apply: e['rejected'] = True; e['rejected_for'] = f
            elif apply and e.get('rejected'):
                e.pop('rejected', None); e.pop('rejected_for', None)
    print(f'{bad} of {n} sprites flagged' + (' and marked rejected' if apply else ' (run with --apply to mark them)'))
    if apply: sprites.save_manifest(m)

if __name__ == '__main__': main()
