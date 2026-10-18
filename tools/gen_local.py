#!/usr/bin/env python3
"""Make photo-real plant sprites on this computer, no API key.
For each plant and state: the app's own drawing (from render_inits.js) is refined by a local
image-to-image diffusion model, which keeps the whole-plant composition and adds photographic
texture, then the white background is keyed out and the sprite and manifest are written.

  gen_local.py <init-dir> [--strength 0.62] [--size 512] [--commit 40] [--only id1,id2] [--states flower,leaf]
"""
import os, sys, time, json, subprocess, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sprites
from PIL import Image

ROOT = sprites.ROOT
STATE_TEXT = {'flower': 'in full flower', 'leaf': 'in full leaf, no flowers', 'fruit': 'carrying ripe fruit', 'autumn': 'in autumn colour', 'bare': 'leafless in winter, bare branches', 'spring': 'with fresh spring foliage'}

def prompt_for(p, st):
    form = {'tree': 'tree', 'shrub': 'shrub', 'climber': 'climbing plant', 'perennial': 'plant', 'grass': 'ornamental grass', 'bulb': 'flowering bulbs'}[p['type']]
    return f"photograph of a {form}, {p['latin']} ({p['name']}), {STATE_TEXT[st]}, whole plant, plain white background, natural daylight, sharp botanical detail"

def main():
    a = sys.argv[1:]
    if not a: sys.exit(__doc__)
    init_dir = a[0]; opts = dict(zip(a[1::2], a[2::2]))
    strength = float(opts.get('--strength', 0.62)); size = int(opts.get('--size', 512)); every = int(opts.get('--commit', 40))
    only = set(opts['--only'].split(',')) if '--only' in opts else None
    states = opts['--states'].split(',') if '--states' in opts else None
    plants = sprites.load_plants()
    todo = []
    for pid in sorted(os.listdir(init_dir)):
        if not os.path.isdir(os.path.join(init_dir, pid)) or pid not in plants: continue
        if only and pid not in only: continue
        for f in sorted(os.listdir(os.path.join(init_dir, pid))):
            st = f[:-4]
            if states and st not in states: continue
            m = sprites.load_manifest()
            if m.get(pid, {}).get(st, {}).get('file') and 'local' in m[pid][st].get('source', ''): continue
            todo.append((pid, st))
    # visual impact first: woody plants, then the rest
    order = {'tree': 0, 'shrub': 1, 'climber': 2, 'perennial': 3, 'grass': 4, 'bulb': 5}
    todo.sort(key=lambda x: (order[plants[x[0]]['type']], x[0]))
    print(f'{len(todo)} images to make', flush=True)
    import torch
    from diffusers import AutoPipelineForImage2Image
    dtype = torch.float32 if os.environ.get('LOCAL_FP32') else torch.bfloat16   # bf16: 3x faster and half the memory on CPU
    pipe = AutoPipelineForImage2Image.from_pretrained('stabilityai/sd-turbo', torch_dtype=dtype, variant='fp16').to('cpu')
    pipe.set_progress_bar_config(disable=True); pipe.enable_attention_slicing()
    done = 0; t_start = time.time()
    for i, (pid, st) in enumerate(todo):
        p = plants[pid]; t0 = time.time()
        try:
            init = Image.open(os.path.join(init_dir, pid, st + '.png')).convert('RGB').resize((size, size))
            init_bbox = Image.eval(init.convert('L'), lambda v: 255 if v < 245 else 0).getbbox()
            raw_dir = os.path.join(sprites.RAW, pid); os.makedirs(raw_dir, exist_ok=True)
            for attempt in range(3):
                g = torch.Generator('cpu').manual_seed((abs(hash(pid + st)) + attempt * 7919) % 100000)
                img = pipe(prompt=prompt_for(p, st), image=init, strength=strength, num_inference_steps=max(2, round(4 / strength)), guidance_scale=0.0, generator=g).images[0]
                for stale in (os.path.join(raw_dir, st + '.jpg'), os.path.join(raw_dir, st + '.png')):
                    if os.path.exists(stale): os.remove(stale)
                img.save(os.path.join(raw_dir, st + '.png'))
                m = sprites.load_manifest(); m.setdefault(pid, {})[st] = {'source': 'generated locally (sd-turbo image-to-image from the app drawing)', 'credit': '', 'license': 'generated', 'file': None}
                sprites.save_manifest(m)
                sprites.cmd_cutout(pid, st, 'white')
                e = sprites.load_manifest()[pid][st]
                ok = init_bbox is None or (e.get('h', 0) >= (init_bbox[3] - init_bbox[1]) * 0.6 and e.get('w', 0) >= (init_bbox[2] - init_bbox[0]) * 0.5)
                if ok: break
                print(f'  retry {attempt + 1}: cutout {e.get("w")}x{e.get("h")} much smaller than the drawing', flush=True)
            done += 1
            print(f'[{i + 1}/{len(todo)}] {pid} {st} {time.time() - t0:.0f}s', flush=True)
        except Exception as e:
            print(f'[{i + 1}/{len(todo)}] {pid} {st} FAILED {e}', flush=True)
        if done and done % every == 0:
            commit(done)
    commit(done)
    print(f'finished {done} images in {(time.time() - t_start) / 60:.0f} min', flush=True)

def commit(n):
    try:
        subprocess.run(['git', 'add', 'assets/sprites'], cwd=ROOT, check=True)
        r = subprocess.run(['git', '-c', 'user.name=Stuart Marshall', '-c', 'user.email=stuart-marshall1@hotmail.co.uk', 'commit', '-q', '-m', f'Plant sprites: {n} images generated locally\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01FxKxN49h4TxJPP3Wdz1LNL'], cwd=ROOT)
        if r.returncode == 0:
            subprocess.run(['git', 'push', '-u', 'origin', 'netgarden-app'], cwd=ROOT, check=False)
            print(f'committed and pushed after {n} images', flush=True)
    except Exception as e:
        print('commit failed', e, flush=True)

if __name__ == '__main__':
    main()
