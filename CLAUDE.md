# Cage Kings: notes for Claude

Original 3D MMA fighting game for Android phones (landscape): realistic fighters, touch controls, a career ladder per
weight class, fighter packs, a monthly Season Pass, ads and in-app purchases. Vite + TypeScript + three.js, Android via
Capacitor 8 (package and Java package `com.danielspurr.cagekings`). This repo was City Ranker until October 2026.
Plan: `docs/MASTER-PLAN.md`. Contracts between the parts: `docs/ARCHITECTURE.md`. Current version: `package.json`.

## The owner
- Non-technical, mobile-first, writes informally. Answer in plain language, short, no jargon; explain what something
  means for the game or the launch, not how it is built.
- Wants a launch-quality game that earns money: verify, test, be honest about gaps.
- Standing decisions (don't relitigate):
  - Name **Cage Kings**; 12+/Teen; ads capped at Teen; blood off.
  - **Nothing from EA SPORTS UFC, the UFC, real fighters or real brands**: no code, models, textures, sounds, fonts,
    names, no "UFC" / "Octagon". The EA APK the owner uploaded was a design reference only and is not in the repo.
  - Realistic look: MakeHuman / MPFB CC0 bodies (`tools/fighters/`), not cartoon.
  - **Paid packs too**, with odds shown before buying, visible pity counters, duplicates to shards, every fighter
    earnable free, and paid packs off in countries on `paidPacksBlockedCountries` (Belgium at least).
  - Leaderboards only at launch, but **live PvP must not need a rewrite**: keep the fight simulation deterministic
    (integer maths, seeded RNG, inputs-only controllers, snapshot/restore, input-log replays).
  - Interstitials as in Cartstronaut: never in the first session or first 10 min of play, then every 3rd fight,
    4 min apart, behind an "Ad break" card. Rewarded videos are opt-in and labelled "Watch ad: …".
  - Monthly Season Pass (`season_pass`, consumable); the Starter Pack includes only the current month's pass.
  - Remote tuning is a JSON file on the owner's site (`docs/REMOTE-TUNING.md`), not Firebase.
- Don't create pull requests unless asked. Develop and push on the session's designated branch.

## Commands
```sh
npm run dev            # local dev server (http://localhost:5173; lab.html = fighter lab)
npm test               # unit tests (vitest), must all pass
npm run lint           # eslint (floating promises, exhaustive switches)
npm run typecheck
npm run build          # store build (no window.cageKings debug hook)
npm run build:qa       # keeps window.cageKings for Playwright QA scripts
npm run android:apk    # web build + cap sync + release APK (needs android/keystore.properties and an Android SDK)
# simulations CI also runs (they honour OUT=<report path>):
OUT=/tmp/q/balance.md RUNS=30 npx vitest run --config /dev/null scripts/qa/fight-balance.test.ts
OUT=/tmp/q/econ.md npx vitest run --config /dev/null scripts/qa/econ-sim.test.ts
./tools/fighters/build.sh   # rebuild the fighter bodies (Blender 4.2 + MPFB, downloads CC0 assets to .cache)
python3 tools/icons.py      # launcher icons, splash screens, feature graphic
node scripts/store.mjs      # Play Store screenshots into docs/store (needs the dev server on :5173)
```
- Browser QA: `npx vite --port 5173` then Playwright with Chromium at `/opt/pw-browsers/chromium` (launch args
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`). Software rendering is slow: use the QA hooks
  `window.cageKings.qaSpeed(30)` and `qaAutoplay(true)` to finish fights, `qaNav({s:'packs'})`, `qaGround('mount')`.
  The fighter lab (`lab.html?single&nopole`) has `labSet(action, u)`, `labCam(pos, target)`, `labBones(names)` and
  `labClip(action)` for checking poses from any angle.
  Throwaway scripts go in `scripts/qa/_tmp_*` and are deleted before finishing. Kill processes by PID.

## Code map
- `src/game/fight/` the deterministic simulation: `types.ts` (contract), `moves.ts` frame data, `sim.ts` standing
  exchanges, `ground.ts` takedowns / ground / submissions, `judges.ts`, `ai.ts` (5 archetypes, difficulty 0..1000),
  `replay.ts`. Design and balance numbers: `docs/FIGHT-DESIGN.md`. Tests: `tests/fight-sim.test.ts`.
- `src/game/touch/` gesture recogniser (touch + keyboard -> FightInput per tick).
- `src/render/fighter/` realistic fighters: `look.ts` (look from seed + hints), `fighterView.ts` (load, dress),
  `materials.ts` (skin: tone, stubble, buzz cut, bruising, sweat, tattoos; hair; garments), `rig.ts` (IK pose solver),
  `poses.ts` + `clips.ts` (one clip per ActionId), `animator.ts` (sim progress -> clip time, impact aligned).
- `src/render/` `arena/` (venues, cage, lights, crowd), `camera.ts` (broadcast camera), `fx.ts`, `fightScene.ts`,
  `portraits.ts` (menu portraits rendered from the 3D fighters).
- `src/ui/` styles, menus (`menus.ts`), fight HUD + touch layer (`fight/`), settings. `src/app.ts` navigation and
  fights; `src/app/game.ts` all game rules for the menus; `src/app/fightSession.ts` one fight; `src/app/services.ts`
  platform start-up.
- `src/meta/` saves (`save.ts`, slots per area), `entitlements.ts` (purchases: grant once per Play token, only when
  purchased; ack/consume after the grant is saved; refunds revoke), `clock.ts`, `tuning.ts`, `adpacing.ts`,
  `season.ts`, `weekly.ts`, `daily.ts`, content: `roster.ts` (48 original fighters), `divisions.ts`, `fighters.ts`
  (levels, training, stars), `career.ts`, `packs.ts`, `names.ts`. Economy: `docs/ECONOMY.md`.
- Launch-critical rules are tested in `tests/money.test.ts` (purchases, refunds, bundle fighter, restores, reward
  clock, ad pacing, cloud read-before-write, leaderboard scores).
- `src/platform/` iap, ads (UMP consent first, Google test ids until real ones are in the secrets), games (Play Games
  leaderboards + cloud save), telemetry (opt-in), notify, platform, country (paid-pack gating).
- `src/audio/sound.ts` all sound, synthesised at start-up (no sample files).
- Android: `android/` (from Cartstronaut: R8 + resource shrinking, renderer-crash recovery, Play Games plugin).

## Release routine
1. Bump the version in `package.json` and `package-lock.json`. versionCode = major*10000 + minor*100 + patch.
2. Typecheck, lint, all tests, the two simulations.
3. Notes in `docs/RELEASE.md`.
4. Commit with `[release] x.y.z: ...` and push. CI (`.github/workflows/build.yml`) builds the web bundle and the
   Android APK + AAB and publishes a GitHub Release. Signing comes from the `ANDROID_KEYSTORE_BASE64`,
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` secrets; without them the release carries
   a debug-signed test APK (not for Play). Set the `UPLOAD_CERT_SHA256` variable to lock the upload key.
- There is no Android SDK in the cloud session: CI builds the APK.

## Status (16 October 2026, version 0.1.0)
- Built: fight engine + AI + replays (tested, balanced), realistic generated fighters with IK animation, six venues,
  broadcast camera, HUD + touch controls, full menus (hub, career, fighters, training, packs with odds/pity/reveal,
  shop, season, settings), first-fight lesson (`src/app/tutorial.ts`), leaderboards (`src/meta/record.ts`), cloud save that reads before it
  writes (`src/app/cloud.ts`), auto graphics quality (`src/render/autoQuality.ts`), economy (simulated), synthesised sound, platform services, Android project, CI.
- Next (see `docs/RELEASE.md` "Known gaps"): motion-captured animation upgrade, women's ground poses
  polish, real-phone performance pass, store listing assets, closed test.
