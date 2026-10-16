#!/usr/bin/env bash
# Rebuild the fighter bodies. Downloads MPFB and the CC0 MakeHuman system assets into tools/fighters/.cache (git-ignored)
# on first run. Needs Blender 4.2 LTS: set BLENDER=/path/to/blender (default /opt/blender/blender-4.2.9-linux-x64/blender).
set -euo pipefail
cd "$(dirname "$0")"
HERE=$PWD
CACHE=$HERE/.cache
BLENDER=${BLENDER:-/opt/blender/blender-4.2.9-linux-x64/blender}
mkdir -p "$CACHE"
export BLENDER_USER_RESOURCES=$CACHE/blender-user
if [ ! -d "$CACHE/blender-user/extensions/user_default/mpfb" ]; then
  curl -sSL -o "$CACHE/mpfb.zip" "https://extensions.blender.org/download/sha256:c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad/add-on-mpfb-v2.0.18.zip?repository=%2Fapi%2Fv1%2Fextensions%2F&blender_version_min=4.2.0"
  "$BLENDER" -b --command extension install-file -r user_default -e "$CACHE/mpfb.zip"
fi
if [ ! -d "$CACHE/sysassets" ]; then
  curl -sSL -o "$CACHE/sys.zip" https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip
  unzip -qo "$CACHE/sys.zip" -d "$CACHE/sysassets"
fi
D=$CACHE/blender-user/extensions/.user/user_default/mpfb
mkdir -p "$D"
[ -L "$D/data" ] || { rm -rf "$D/data"; ln -s "$CACHE/sysassets" "$D/data"; }
"$BLENDER" -b --python "$HERE/build.py" -- "$CACHE/out"
python3 "$HERE/textures.py" "$CACHE/sysassets" "$CACHE/out" "$HERE/../../public/assets/fighters"
# compress the bodies (meshopt; three.js decodes it with MeshoptDecoder)
for s in m f; do
  (cd "$HERE/../.." && npx gltfpack -i "$CACHE/out/fighter_$s.glb" -o "public/assets/fighters/fighter_$s.glb" -cc -kn -km -ke -kv -vp 14 -vtf)
done
