# Fighter bodies

`./build.sh` rebuilds `public/assets/fighters/` (two bodies, textures, `fighters.json`) from CC0 assets:

1. Downloads MPFB 2.0.18 (MakeHuman for Blender) and the CC0 MakeHuman system asset pack into `.cache/` (git-ignored).
2. `build.py` (Blender 4.2, headless) makes one male and one female base fighter: the `game_engine` rig, the CC0
   game-weight "muscle" body, eyes, lashes, teeth, 3 brow and 6 hair styles, plus 11 morph targets baked from
   variant fighters (heavy, thin, muscle, soft, african, asian, faceSquare, faceOval, faceRound, noseBroad, older).
   Shorts, fingerless gloves and (women) a sports top are cut from the body itself, so they carry the morphs.
3. `textures.py` shrinks the textures to WebP (alpha kept) and `gltfpack` compresses the bodies (meshopt;
   `-vtf` keeps texture coordinates as floats because the textures are applied at runtime, not in the file).

Runtime: `src/render/fighter/` (`look.ts` picks a look from a seed, `fighterView.ts` builds the fighter,
`materials.ts` skin / hair / garment shaders, `rig.ts` poses the skeleton). Preview: `npx vite`, then `/lab.html`
(`?close&pose=relaxed&seed=4&n=1` for a face close-up, `?damage` for bruises and sweat).

Licences: MPFB assets and the MakeHuman system assets are CC0 (see docs/CREDITS.md).
