#!/bin/sh
# Render the crowd sprite atlas (needs the MPFB set-up from tools/fighters/build.sh and ImageMagick).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$HERE/../..
CACHE=$ROOT/tools/fighters/.cache
BLENDER=${BLENDER:-/opt/blender/blender-4.2.9-linux-x64/blender}
export BLENDER_USER_RESOURCES=$CACHE/blender-user
OUT=$CACHE/crowd
rm -rf "$OUT"
"$BLENDER" -b --python "$HERE/build_crowd.py" -- "$OUT" 32
mkdir -p "$ROOT/public/assets/crowd"
# 8 x 4 cells of 128 x 256 (renders are 256 x 512: downscale for a sharp, small atlas)
montage "$OUT"/cell_*.png -background none -geometry 128x256+0+0 -tile 8x4 "$OUT/atlas.png"
convert "$OUT/atlas.png" -quality 82 -define webp:alpha-quality=90 "$ROOT/public/assets/crowd/crowd.webp"
ls -la "$ROOT/public/assets/crowd/crowd.webp"
