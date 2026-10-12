"""
Prepare species illustrations for the app (development tool, not deployed).

    python3 tools/prepare-species.py SOURCE_DIR [SOURCE_DIR ...]

Each SOURCE_DIR holds PNGs named after a species (snapper.png, mangrove_jack.png,
yellowfin_bream.png ...). Later folders win, so a folder of redrawn images can
be passed after the original set. Writes species-<name>.webp to the repo root,
named after the app's own species names (config.js SEASON), e.g.
species-mangrove-jack.webp.

For each image:
  1. clears the near-invisible haze (alpha <= 10) left by background removal
  2. removes stray pieces of neighbouring animals left from cutting up a sheet:
     keeps the main shape plus anything within a few pixels of it
  3. trims to the artwork and centres it on a common 15:8 canvas with even
     padding, so every card lines up; never stretches or crops the art
  4. saves 600x320 WebP, transparency kept

Needs Pillow, numpy and scipy.
"""
import hashlib
import os
import re
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
W, H, PAD = 600, 320, 0.06
NEAR = 4  # px at source size: solid pieces this close to the main shape are kept
EDGE = 4  # px of soft edge restored around what is kept

# Hand fixes for stray bits that touch the animal, so the shape test can't
# separate them. Keyed by the source file's SHA-1 (first 12 characters) so a
# fix can never land on a different drawing: box in source pixels, and only
# grey pixels inside it are cleared. The v4.8.1 artwork needs none.
ERASE_GREY = {}

# Longer names used by the illustration set -> the app's species names.
ALIASES = {
    'yellowfin bream': 'Bream',
    'blue tuskfish': 'Tuskfish',
    'dusky flathead': 'Flathead',
    'sand whiting': 'Whiting',
    'king threadfin': 'Threadfin',
}


def app_species():
    src = open(os.path.join(ROOT, 'config.js'), encoding='utf8').read()
    names = set()
    for block in re.findall(r'\bsp:\s*\[([^\]]*)\]', src):
        names.update(re.findall(r"'([^']+)'", block))
    return names


def slug(name):
    return 'species-' + re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-') + '.webp'


def clean(path):
    a = np.array(Image.open(path).convert('RGBA'))
    al = a[..., 3]
    al[al <= 10] = 0
    digest = hashlib.sha1(open(path, 'rb').read()).hexdigest()[:12]
    for x0, y0, x1, y1 in ERASE_GREY.get(digest, []):
        box = a[y0:y1, x0:x1].astype(int)
        grey = (abs(box[..., 0] - box[..., 1]) < 40) & (abs(box[..., 1] - box[..., 2]) < 40)
        a[y0:y1, x0:x1, 3][grey] = 0
    # Label only the solid parts, so a faint anti-aliased bridge can't join a
    # neighbour's fin to this animal; then grow back over the soft edge.
    solid = al > 96
    lab, n = ndimage.label(solid, structure=np.ones((3, 3)))
    if n == 0:
        raise SystemExit(path + ' is empty')
    sizes = ndimage.sum(np.ones_like(al), lab, range(1, n + 1))
    main = lab == (int(np.argmax(sizes)) + 1)
    near = ndimage.binary_dilation(main, iterations=NEAR)
    keep = np.isin(lab, np.unique(lab[near & (lab > 0)]))
    mask = ndimage.binary_dilation(keep, iterations=EDGE) & (al > 0)
    al[~mask] = 0
    a[..., 3] = al
    a[al == 0, :3] = 0
    ys, xs = np.nonzero(al)
    art = Image.fromarray(a).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    s = min(W * (1 - 2 * PAD) / art.width, H * (1 - 2 * PAD) / art.height)
    art = art.resize((max(1, round(art.width * s)), max(1, round(art.height * s))), Image.LANCZOS)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    out.paste(art, ((W - art.width) // 2, (H - art.height) // 2), art)
    return out


def main(dirs):
    known = {n.lower(): n for n in app_species()}
    chosen = {}
    for d in dirs:
        for f in sorted(os.listdir(d)):
            if not f.lower().endswith('.png'):
                continue
            key = os.path.splitext(f)[0].replace('_', ' ').replace('-', ' ').lower()
            name = known.get(key) or ALIASES.get(key)
            if not name:
                print('  ? no species for', f)
                continue
            chosen[name] = os.path.join(d, f)
    for name in sorted(chosen):
        dest = os.path.join(ROOT, slug(name))
        clean(chosen[name]).save(dest, 'WEBP', quality=86, method=6, alpha_quality=100)
        print(f'  {name:18s} <- {os.path.relpath(chosen[name])}  {os.path.getsize(dest) / 1024:.1f} KB')
    missing = sorted(set(known.values()) - set(chosen))
    if missing:
        print('  no image (keeps its drawing):', ', '.join(missing))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    main(sys.argv[1:])
