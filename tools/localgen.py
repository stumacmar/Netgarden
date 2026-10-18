#!/usr/bin/env python3
"""Generate plant images with a local diffusion model on the CPU (no API key).
Used by sprites.py when --provider local. Keeps one pipeline loaded per process.

  localgen.py <prompt> <out.png> [--model stabilityai/sd-turbo] [--steps 4] [--size 512] [--seed N]
"""
import os, sys, time

_PIPE = {}
def pipeline(model):
    if model in _PIPE: return _PIPE[model]
    import torch
    from diffusers import AutoPipelineForText2Image
    dtype = torch.bfloat16 if 'xl' in model else torch.float32
    pipe = AutoPipelineForText2Image.from_pretrained(model, torch_dtype=dtype, variant='fp16').to('cpu')
    pipe.set_progress_bar_config(disable=True)
    _PIPE[model] = pipe
    return pipe

NEGATIVE = 'close-up, macro, cropped, partial plant, zoomed in, multiple plants, pot, hands, people, text, watermark, blurry'

def generate(prompt, out, model='stabilityai/sd-turbo', steps=4, size=512, seed=None):
    import torch
    pipe = pipeline(model)
    g = torch.Generator('cpu').manual_seed(seed) if seed is not None else None
    img = pipe(prompt=prompt, negative_prompt=NEGATIVE, num_inference_steps=steps, guidance_scale=0.0, height=size, width=size, generator=g).images[0]
    img.save(out)
    return out

if __name__ == '__main__':
    a = sys.argv[1:]
    if len(a) < 2: sys.exit(__doc__)
    opts = dict(zip(a[2::2], a[3::2]))
    t0 = time.time()
    generate(a[0], a[1], opts.get('--model', 'stabilityai/sd-turbo'), int(opts.get('--steps', 4)), int(opts.get('--size', 512)), int(opts['--seed']) if '--seed' in opts else None)
    print('wrote', a[1], 'in %.0fs' % (time.time() - t0))
