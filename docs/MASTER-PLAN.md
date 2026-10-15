# MMA game: master plan (draft 1, 15 October 2026)

Working title: **TBD** (see the questions at the end). Status: plan only, no game code yet. This repo was
City Ranker; it has been cleared to start fresh (the old page is still in git history).

## 1. What the EA UFC APK actually gives us

Checked on 15 October 2026 with the APK the owner uploaded (EA SPORTS UFC, Android, version 1.9.3786573).

- **It unpacks and partly decompiles.** The two RAR parts join into a 43 MB APK. The Java side (3,676 classes)
  decompiles to readable code with jadx, but it is almost all glue: EA's account and online services, Facebook,
  Google sign-in, ad networks (Google ad manager, Supersonic, PlayHaven), file downloads, notifications.
- **The fighting game itself cannot be turned back into source code.** It lives in one native C++ library
  (`libufcandroidzf.so`, 35 MB, machine code with its names stripped). Tools can show its assembly, but not
  anything we could reuse or build on.
- **The fighters, arenas and animations are not in the APK.** They were downloaded from EA's servers after
  install, and those servers are long closed. The APK holds menus flow files, config, shaders, a splash video,
  EA's licensed fonts and the logo.
- **What it is useful for: design reference only.** The configs and text confirm how the game was built as a
  business: fighter *cards* with rarity, an energy system, weight classes, special events, a submission
  "tap or not" moment, XP and levels, and an ad plan (an interstitial on login, in the store, on a loss and on
  level-up, at least 60 s apart, only after the 10th session for most of them).

## 2. What we may and may not take

Game ideas and mechanics (tap to strike, swipe for power moves, stamina, a submission minigame, card
collecting, a career ladder) are free for anyone to use. Everything EA or the UFC *made or owns* is not:

| Not allowed (would get the game pulled from Play, or a lawsuit) | What we do instead |
|---|---|
| EA's code, art, sounds, video, fonts (Purista EA is licensed to EA) | Our own code (most of it copied from Cartstronaut, which we wrote), our own art and sound |
| "UFC", "Ultimate Fighting Championship", "Octagon", EA SPORTS names and logos | Our own league name and logo; call it "the cage" |
| Real fighters' names, faces, nicknames, likeness | A fictional roster with original names, looks and backstories |
| Brand names on gear (TapouT, Venum, Reebok…) | Our own gear brands, which double as cosmetics |

Nothing from the APK goes into this repo. The decompiled files stay in a throwaway scratch folder.

## 3. The game in one paragraph

A punchy, arcade 3D MMA game for phones. Build a fictional fighter from the amateur ranks to world champion
across weight classes, collect and train a roster of original fighters, and fight with simple touch controls
that still reward timing: tap to jab, swipe to throw power shots, hold to block, swipe down to shoot a
takedown, then win a ground scramble or a submission tug-of-war. Free to play, earns from rewarded ads,
gentle interstitials, a monthly Season Pass, and direct cosmetic and convenience purchases.

## 4. Core loop

1. **Fight** (2–4 minutes): 3 rounds of 60–90 s, KO/TKO/submission/decision.
2. **Earn**: cash (soft currency), XP, fighter shards, occasional gear.
3. **Improve**: train stats (striking, grappling, cardio, chin), unlock moves, upgrade fighters, equip gear.
4. **Progress**: climb the career ladder and the weekly tournament; unlock the next division and event.
5. **Come back**: daily fights and login rewards, weekly tournament reset, monthly Season Pass.

## 5. Fighting (the part that has to feel great)

- **Camera and orientation**: landscape, side-on 3/4 view of the cage, slight zoom on big hits. (Default; see
  questions.)
- **Controls** (left half of the screen = defence, right half = offence):
  - Tap right: jab / quick strike. Swipe right (up/side/down): hook, uppercut, body shot, kick.
  - Hold left: block. Swipe left: slip/dodge (perfect timing = counter window, slow-motion flash).
  - Swipe down on the right: takedown attempt (stamina cost; defender gets a timed swipe to sprawl).
  - Special move button fills from landed hits (flying knee, spinning back fist, superman punch).
- **Stamina**: every action costs it; empty stamina = slow, weak strikes and easy takedowns.
- **Damage**: head, body, legs tracked separately; a hurt meter leads to stun, knockdown, KO; the ref stops a
  fight on accumulated damage (TKO).
- **Ground**: a short positional scramble (mount, guard, side control) using swipe-direction prompts, with
  ground-and-pound taps.
- **Submission**: a tug-of-war of rapid taps vs a stamina-weighted bar, both fighters' stats shift the odds.
- **AI**: per-archetype styles (brawler, boxer, kicker, wrestler, submission ace) with difficulty that scales
  with the ladder; tuned by a deterministic simulation like Cartstronaut's (same seed = same fight), so we can
  run thousands of bot fights in tests to balance it.
- **Presentation**: walkouts, ring announcer cards (text, no voice at first), replay of the finishing blow,
  crowd, slow-motion knockouts, rag-doll fall (Cartstronaut already has a ragdoll).

## 6. Content at launch

- **Roster**: 40 original fighters across 5 divisions (fly, light, welter, middle, heavy), 4 rarities.
  Built from a code-driven character generator (body shape, skin tone, hair, beard, tattoos, shorts, gloves)
  so new fighters cost no art time.
- **Career**: 5 tiers (Amateur → Regional → National → Contender → Champion), ~60 fights, boss fights at the
  end of each tier, a title belt per division.
- **Events**: daily "fight card" (3 fights), weekly tournament (same bracket for everyone, seeded by the week,
  leaderboard on Google Play Games), monthly Season Pass track.
- **Arenas**: 6 venues (garage gym, county fair, nightclub, stadium, beach, rooftop), cosmetic only.
- **Cosmetics**: shorts, gloves, walkout music, entrance effects, cage skins, victory poses, tattoos.

## 7. Money (reuse what already works in Cartstronaut)

- **Rewarded ads** (opt-in, labelled "Watch ad: …"): double fight cash, a free pack per day, a second wind
  in a lost fight (once per fight), skip a training timer.
- **Interstitials**: same rules as Cartstronaut (never in the first session or first 10 min, then every 3rd fight,
  4 min apart, behind an "Ad break" card). Removed by the No Ads purchase.
- **In-app purchases**: No Ads; Starter Pack (one-time, includes the current Season Pass); gem bundles
  (hard currency for cosmetics and speed-ups); monthly Season Pass (consumable, like Cartstronaut); premium
  fighter bundles at fixed prices.
- **Packs**: see question 3. Recommended: no *paid* random boxes. Packs are earned through play and ads, show
  their odds, and duplicates turn into shards. Paid random boxes are banned or restricted in some countries
  (e.g. Belgium, the Netherlands) and Google requires the odds to be shown.
- **Energy**: recommended none for career fights (energy walls hurt early retention); daily fight card and
  tournament have their own fight counts.

## 8. Technology (copy from Cartstronaut, add the fighting)

Same stack as Cartstronaut: Vite + TypeScript + three.js, Android via Capacitor 8. Copy directly:

| From Cartstronaut | Use |
|---|---|
| `src/platform/` (iap, ads with UMP consent, games, telemetry, notify, platform, sharecard) | As is, renamed ids |
| `src/meta/` (save + migrations, entitlements, clock, tuning, adpacing, season, weekly, shop) | As is, new fields |
| `src/audio/audio.ts` (procedural sound) | Base for hit, crowd and UI sounds |
| `src/render/ragdoll.ts`, `fx.ts`, `crowd.ts`, `glow.ts`, `textures.ts`, `style.ts` | Knockouts, sparks, crowd, look |
| `src/ui/` patterns and CSS, the App state machine in `src/app.ts` | Menus, shop, modals, HUD |
| `android/` project (R8, renderer-crash recovery, Play Games plugin, keep.xml) | New package name |
| `.github/workflows/build.yml`, release routine, QA scripts (hit-audit, browser-audit, save-robust, fuzz) | As is, adapted |
| `tests/` for money, saves, clock, seasons, ads | Adapted to the new economy |

New for this game: fight simulation (`src/game/fight/`), skeletal fighter model + keyframed and procedural
animation (blends, hit reactions, IK feet), fighter generator, AI, camera director, career/roster/cards meta.

## 9. Milestones (each ends with a playable build the owner can try)

1. **Fresh project** — copy the Cartstronaut shell (platform, meta, CI, Android) with a placeholder scene;
   tests, lint, CI green; new app id; web build playable.
2. **One good fight** — two fighters, striking, blocking, stamina, KO, one AI style. Phone feel test.
3. **Full fight system** — takedowns, ground, submissions, specials, TKO/decision, 5 AI styles, replays.
4. **Fighters and look** — character generator, 40 fighters, 6 arenas, walkouts, crowd, sound.
5. **Progression** — career ladder, training, gear, cards/shards, daily card, weekly tournament.
6. **Money** — shop, gems, packs, Season Pass, rewarded ads and interstitials, consent, restore, refunds.
7. **Polish and audits** — onboarding/tutorial fight, performance on low-end phones, two audit rounds,
   store screenshots and video, privacy policy, Data safety.
8. **Closed test** (12 testers, 14 days), fix what comes back, launch.

## 10. Launch checklist (owner tasks marked ★)

- ★ New Play Console app; ★ new AdMob app and ad units; ★ product ids in Play Console.
- ★ New upload keystore and the four `ANDROID_KEY*` GitHub secrets on this repo (or reuse Cartstronaut's key).
- Content rating: real-world combat, blood off by default → expected PEGI 12 / ESRB Teen. Ads capped at Teen.
- Privacy policy and `app-ads.txt` on the owner's site; Data safety form (same answers as Cartstronaut, plus
  anything new).
- Name check: Play Store search, a trademark search (UK IPO / EUIPO / USPTO), and the domain.
- ★ Consider renaming this GitHub repo from `city-ranker` to the game's name (Settings → Rename).

## 11. Honest risks

- **Looks**: EA's game had motion-captured, photo-real fighters from a large studio. Code-built stylised fighters
  can look great and consistent, but not photo-real. Photo-real would need a 3D artist and mocap (money).
- **Animation is the hardest part.** Fighting games live on animation feel; expect most iteration in milestones
  2–3, with phone tests by the owner.
- **Real-time online PvP** needs servers, anti-cheat and ongoing cost. Recommended for after launch.
- **Scope**: this is bigger than Cartstronaut. Plan for many sessions; each milestone ships something playable.

## 12. Open questions for the owner

1. Name (shortlist in the chat; needs a trademark/store check).
2. Look: stylised chunky 3D (doable in code) or photo-real (needs paid art)?
3. Packs: earned-only random packs (recommended) or paid random packs too?
4. Online: offline career + weekly leaderboards at launch (recommended), or real-time PvP from day one?
5. Defaults assumed unless the owner says otherwise: landscape; 12+/Teen; blood off; same ad rules and Season
   Pass as Cartstronaut; no energy wall; English only at launch; new upload keystore; package
   `com.danielspurr.<name>`.
