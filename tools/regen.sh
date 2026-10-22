#!/bin/sh
# Regenerate every plant sprite with the OpenAI image model, then check and publish them.
# Needs OPENAI_API_KEY in the environment. Roughly 1,500 images: about £25 at low quality, £90 at medium.
#   tools/regen.sh [low|medium]
set -e
cd "$(dirname "$0")/.."
Q="${1:-medium}"
[ -n "$OPENAI_API_KEY" ] || { echo "Set OPENAI_API_KEY first"; exit 1; }
python3 tools/sprites.py generate-all --provider openai --quality "$Q" --replace-local
python3 tools/qa_sprites.py --apply
echo "Done. Review tools/qa_sprites.py output, then: git add assets/sprites && git commit -m 'Plant sprites: photographic set'"
