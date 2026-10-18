#!/usr/bin/env python3
"""Re-run the background cutout for every locally generated sprite from its saved raw image.
Run only when gen_local.py is not running (both write the manifest)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sprites
m = sprites.load_manifest(); n = 0
for pid, states in list(m.items()):
    for st, e in list(states.items()):
        raw = os.path.join(sprites.RAW, pid, st + '.png')
        if 'local' in (e.get('source') or '') and os.path.exists(raw):
            sprites.cmd_cutout(pid, st, 'white'); n += 1
print('re-cut', n)
