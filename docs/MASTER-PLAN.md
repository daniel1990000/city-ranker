# Cage Kings: master plan (draft 2, 15 October 2026)

Status: plan only, no game code yet. This repo was City Ranker; it has been cleared to start fresh (the old page
is still in git history). Draft 2 takes in the owner's answers of 15 October 2026 (§13).

## 1. What the EA UFC APK actually gives us

Checked on 15 October 2026 with the APK the owner uploaded (EA SPORTS UFC, Android, version 1.9.3786573).

- **It unpacks and partly decompiles.** The two RAR parts join into a 43 MB APK. The Java side (3,676 classes)
  decompiles to readable code with jadx, but it is almost all glue: EA's account and online services, Facebook,
  Google sign-in, ad networks (Google ad manager, Supersonic, PlayHaven), file downloads, notifications.
- **The fighting game itself cannot be turned back into source code.** It lives in one native C++ library
  (`libufcandroidzf.so`, 35 MB, machine code with its names stripped). Tools can show its assembly, but not
  anything we could reuse or build on.
- **The fighters, arenas and animations are not in the APK.** They were downloaded from EA's servers after
  install, and those servers are long closed. The APK holds menu flow files, config, shaders, a splash video,
  EA's licensed fonts and the logo.
- **What it is useful for: design reference only.** The configs and text confirm how the game was built as a
  business: fighter *cards* with rarity, an energy system, weight classes, special events, a submission
  "tap or not" moment, XP and levels, and an ad plan (an interstitial on login, in the store, on a loss and on
  level-up, at least 60 s apart, only after the 10th session for most of them).

## 2. What we may and may not take

Game ideas and mechanics (tap to strike, swipe for power moves, stamina, a submission minigame, card
collecting, a career ladder) are free for anyone to use. Everything EA or the UFC *made or owns* is not, and
that includes the fighter models: they belong to EA, they are scans of real people, and they are not in the APK
anyway.

| Not allowed (would get the game pulled from Play, or a lawsuit) | What we do instead |
|---|---|
| EA's code, models, textures, animations, sounds, video, fonts (Purista EA is licensed to EA) | Our own code (much of it from Cartstronaut), realistic fighters from free-for-commercial-use sources (§8) |
| "UFC", "Ultimate Fighting Championship", "Octagon", EA SPORTS names and logos | The Cage Kings league, our own logo; call it "the cage" |
| Real fighters' names, faces, nicknames, likeness | A fictional roster with original names, looks and backstories |
| Brand names on gear (TapouT, Venum, Reebok…) | Our own gear brands, which double as cosmetics |

Nothing from the APK goes into this repo. The decompiled files stay in a throwaway scratch folder.

## 3. The game in one paragraph

**Cage Kings** is a hard-hitting 3D MMA game for phones with realistic-looking fighters. Build a fictional
fighter from the amateur ranks to world champion across weight classes, collect and train a roster of original
fighters, and fight with simple touch controls that still reward timing: tap to jab, swipe to throw power
shots, hold to block, swipe down to shoot a takedown, then win a ground scramble or a submission tug-of-war.
Free to play, earns from rewarded ads, gentle interstitials, fighter packs, a monthly Season Pass, and direct
purchases.

## 4. Core loop

1. **Fight** (2–4 minutes): 3 rounds of 60–90 s, KO/TKO/submission/decision.
2. **Earn**: cash (soft currency), XP, fighter shards, occasional gear and packs.
3. **Improve**: train stats (striking, grappling, cardio, chin), unlock moves, upgrade fighters, equip gear.
4. **Progress**: climb the career ladder and the weekly tournament; unlock the next division and event.
5. **Come back**: daily fights and login rewards, weekly tournament reset, monthly Season Pass.

## 5. Fighting (the part that has to feel great)

- **Camera and orientation**: landscape, side-on 3/4 view of the cage, broadcast-style cuts and zoom on big hits.
- **Controls** (left half of the screen = defence, right half = offence):
  - Tap right: jab / quick strike. Swipe right (up/side/down): hook, uppercut, body shot, kick.
  - Hold left: block. Swipe left: slip/dodge (perfect timing = counter window, slow-motion flash).
  - Swipe down on the right: takedown attempt (stamina cost; defender gets a timed swipe to sprawl).
  - Special move button fills from landed hits (flying knee, spinning back fist, superman punch).
- **Stamina**: every action costs it; empty stamina = slow, weak strikes and easy takedowns.
- **Damage**: head, body, legs tracked separately and shown on the fighters (swelling, cuts and bruises as
  texture layers, sweat sheen); a hurt meter leads to stun, knockdown, KO; the ref stops a fight on
  accumulated damage (TKO). Blood off by default (keeps the age rating at 12+/Teen).
- **Ground**: a short positional scramble (mount, guard, side control) using swipe-direction prompts, with
  ground-and-pound taps.
- **Submission**: a tug-of-war of rapid taps vs a stamina-weighted bar; both fighters' stats shift the odds.
- **AI**: per-archetype styles (brawler, boxer, kicker, wrestler, submission ace) with difficulty that scales
  with the ladder. The AI is just another "controller" sending the same inputs a player would (§9).
- **Presentation**: walkouts, fighter intro cards, replay of the finishing blow, crowd, slow-motion knockouts,
  physics knockdown falls blended out of the animation.

## 6. Content at launch

- **Roster**: 40 original fighters across 5 divisions (fly, light, welter, middle, heavy), 4 rarities
  (common, rare, epic, legend). Realistic bodies built from a scripted generator (§8), so new fighters cost
  little art time.
- **Career**: 5 tiers (Amateur → Regional → National → Contender → Champion), ~60 fights, boss fights at the
  end of each tier, a title belt per division.
- **Events**: daily "fight card" (3 fights), weekly tournament (same bracket for everyone, seeded by the week,
  leaderboard on Google Play Games), monthly Season Pass track.
- **Arenas**: 6 venues (back-street gym, county fair, nightclub, stadium, beach, rooftop), cosmetic only.
- **Cosmetics**: shorts, gloves, walkout music, entrance effects, cage skins, victory poses, tattoos.

## 7. Money

Reuse what already works in Cartstronaut, plus paid packs.

- **Rewarded ads** (opt-in, labelled "Watch ad: …"): double fight cash, a free pack per day, a second wind
  in a lost fight (once per fight), skip a training timer.
- **Interstitials**: same rules as Cartstronaut (never in the first session or first 10 min, then every 3rd fight,
  4 min apart, behind an "Ad break" card). Removed by the No Ads purchase.
- **In-app purchases**: No Ads; Starter Pack (one-time, includes the current Season Pass); gem bundles;
  monthly Season Pass (consumable, like Cartstronaut); fixed-price fighter bundles; **fighter packs**.
- **Fighter packs (paid and earned)**: bought with gems (so the gem bundles are the real-money step), earned
  from play, ads and the Season Pass. The rules that keep them legal on Play and out of trouble:
  - Odds shown on the pack screen before every purchase (Google Play requires it).
  - Paid packs switched off where paid random items are banned (Belgium), using the player's Play Store
    country; earned packs stay. The list of countries is remote-tunable so we can react to new laws without an
    update.
  - A pity counter: a guaranteed epic within a set number of packs, shown on screen.
  - Duplicates turn into shards; every fighter can also be earned without paying.
  - Store listing and rating answers declare "In-game purchases (includes random items)".
- **Energy**: none for career fights (energy walls hurt early retention); daily fight card and tournament have
  their own fight counts.

## 8. Technology and the realistic look

Same stack as Cartstronaut: Vite + TypeScript + three.js, Android via Capacitor 8. Copy directly:

| From Cartstronaut | Use |
|---|---|
| `src/platform/` (iap, ads with UMP consent, games, telemetry, notify, platform, sharecard) | As is, renamed ids |
| `src/meta/` (save + migrations, entitlements, clock, tuning, adpacing, season, weekly, shop) | As is, new fields |
| `src/audio/audio.ts` (procedural sound) | Base for UI sounds; hits and crowd move to recorded samples |
| `src/render/fx.ts`, `crowd.ts`, `glow.ts`, `ragdoll.ts` | Hit sparks, crowd, post effects, knockdown physics |
| `src/ui/` patterns and CSS, the App state machine in `src/app.ts` | Menus, shop, modals, HUD |
| `android/` project (R8, renderer-crash recovery, Play Games plugin, keep.xml) | New package name |
| `.github/workflows/build.yml`, release routine, QA scripts (hit-audit, browser-audit, save-robust, fuzz) | As is, adapted |
| `tests/` for money, saves, clock, seasons, ads | Adapted to the new economy |

**Realistic fighters without stealing or paying a studio** (much more realistic than Cartstronaut; honestly a
good modern mobile game look, not EA's photo-scans):

- **Bodies and faces**: MakeHuman / MPFB (a Blender add-on). Its core assets are CC0 and its exported models can
  be used in a paid, closed-source game. A Blender script in this repo generates each fighter from a recipe
  (height, build, muscle, face shape, skin tone, hair, beard, tattoos) and exports a game-ready glTF with
  levels of detail. This can run in the cloud session, so no artist is needed for the roster.
- **Skin and materials**: physically based skin (colour, normal and roughness maps), sweat, bruise and cut
  layers, gloves and shorts with fabric materials; arena lighting with spotlights, soft shadows, tone mapping,
  bloom and a broadcast colour grade.
- **Animation**: Mixamo (free with an Adobe account; its animations may be used royalty-free in commercial games,
  but not resold as raw files). It has boxing, kicks and fighting stances; the owner downloads the list we
  give them, because it needs a login. Optional upgrade: a paid MMA motion-capture pack (roughly £50–£300), checked
  first that its licence allows use outside Unity/Unreal. Code adds blending, hit reactions, foot planting and
  look-at on top.
- **Sound**: licensed sample packs with commercial-use terms (punches, body shots, crowd, ref, bell), plus
  procedural layers.
- **Performance gate**: two realistic fighters, the cage and a lit crowd must hold 60 fps on a mid-range phone
  and 30 fps on a low-end one, with a lower-detail mode. This is tested on a phone at the end of milestone 2,
  before the art goes further. If the WebView can't hold it, we stop and decide the engine before the
  rest gets built.

## 9. Ready for live PvP later without a rewrite

Launch is offline career and tournaments with Google Play leaderboards. The game is built from day one so live
PvP is an added feature, not a rewrite:

- **Inputs, not actions**: the fight simulation only ever receives per-tick input commands from a
  "controller". Touch, AI, replay and (later) network are just different controllers.
- **Deterministic simulation**: fixed timestep, seeded RNG, no `Math.random`, and no `Math.sin/cos/exp` or
  other engine-dependent maths inside the simulation (our own versions or lookup tables), so two phones
  given the same inputs compute the same fight. Tests check this.
- **Snapshot and restore**: the whole fight state can be saved and restored quickly, which is what "rollback"
  netcode needs to hide lag.
- **Fighters and loadouts are plain, versioned data**, validated by shared code a server could also run, so a
  server can check that nobody brings a hacked fighter.
- **Rewards are pure functions** of the fight result, so a server can compute them later instead of the phone.
- **Replays are input logs**: used now for finish replays and "ghost" rival fights; later the same format is
  the network message.
- **Networking sits behind one interface** (find a match, send inputs, receive inputs), with only a local
  version at launch.

## 10. Milestones (each ends with a playable build the owner can try)

1. **Fresh project**: copy the Cartstronaut shell (platform, meta, CI, Android) with a placeholder scene;
   tests, lint, CI green; app id `com.danielspurr.cagekings`; web build playable.
2. **One good fight + look test**: two realistic generated fighters with Mixamo animation, striking, blocking,
   stamina, KO, one AI style, lit cage. Phone feel and performance test (§8 gate).
3. **Full fight system**: takedowns, ground, submissions, specials, TKO/decision, 5 AI styles, replays,
   determinism and snapshot tests (§9).
4. **Fighters and look**: the generator at scale, 40 fighters, 6 arenas, damage layers, walkouts, crowd, sound.
5. **Progression**: career ladder, training, gear, cards/shards, daily card, weekly tournament, leaderboards.
6. **Money**: shop, gems, packs with odds/pity/country rules, Season Pass, rewarded ads and interstitials,
   consent, restore, refunds.
7. **Polish and audits**: tutorial fight, low-end performance, two audit rounds, store screenshots and video,
   privacy policy, Data safety, content rating.
8. **Closed test** (12 testers, 14 days), fix what comes back, launch.

## 11. Launch checklist (owner tasks marked ★)

- ★ New Play Console app; ★ new AdMob app and ad units; ★ product ids in Play Console.
- ★ New upload keystore and the four `ANDROID_KEY*` GitHub secrets on this repo (or reuse Cartstronaut's key).
- ★ A free Adobe account to download the Mixamo animations (milestone 2); optional budget for an MMA mocap
  pack and a sound pack.
- Content rating: real-world combat, blood off → expected PEGI 12 / ESRB Teen, plus "In-game purchases
  (includes random items)". Ads capped at Teen.
- Privacy policy and `app-ads.txt` on the owner's site; Data safety form.
- Name check for "Cage Kings": a quick web search on 15 October 2026 found no game with that name. Still to do:
  a Play Store search, a trademark search (UK IPO / EUIPO / USPTO) and the domain, before money goes into the logo.
- ★ Optional: rename this GitHub repo from `city-ranker` to `cage-kings` (Settings → Rename).

## 12. Honest risks

- **Looks**: much more realistic than Cartstronaut, but not EA's photo-scanned, motion-captured fighters. The
  biggest lever for realism is animation quality (the mocap pack), then lighting.
- **Phone performance** of realistic fighters inside the Android WebView is the main technical unknown; the
  milestone 2 gate exists to find out early.
- **Animation feel is the hardest part.** Expect most iteration in milestones 2–3, with phone tests by the owner.
- **Paid packs** bring rules and some bad reviews; the odds, pity counter and country switch handle the rules.
- **Scope**: this is bigger than Cartstronaut. Plan for many sessions; each milestone ships something playable.

## 13. Decisions (owner, 15 October 2026)

- Name: **Cage Kings** (subject to the name check in §11).
- Look: **much more realistic than Cartstronaut**; photo-real preferred. Ripping EA's assets is ruled out (§2);
  the realistic route is §8.
- Packs: **paid packs too**, with the safeguards in §7.
- Online: **leaderboards only at launch**, with live PvP designed in from the start (§9).
- Assumed unless the owner says otherwise: landscape; 12+/Teen; blood off; same ad rules and Season Pass as
  Cartstronaut; no energy wall; English only at launch; new upload keystore; package
  `com.danielspurr.cagekings`.

## 14. Roadmap (22 October 2026, after the second audit)

Where we are: milestones 1–6 are built and milestone 7 (polish and audits) is under way. The second audit
(`docs/AUDIT-2.md`) fixed the fight exploits the owner found and added the missing retention features.

### Before launch (owner + Claude, about 3–4 weeks)
1. **Real-phone pass** (owner installs the APK from the GitHub Release on a mid-range and, if possible, a cheap
   phone): frame rate in a fight at each graphics setting, menus, a full career fight, a purchase in the closed
   test. Claude fixes what comes back.
2. **Accounts** (owner, see §11): Play Console app, products, AdMob ids, Play Games leaderboards and achievements,
   privacy policy and `app-ads.txt` hosted, content rating, Data safety.
3. **Store listing**: screenshots and the feature graphic are generated from the game (`node scripts/store.mjs`);
   still to make: a 20–30 s gameplay video (recorded from the game with the QA camera tools).
4. **Closed test**: 12 testers for 14 days (Google's rule for new personal accounts). Watch the funnel (below),
   crashes and reviews; fix; then production.

### First 30 days after launch
- Weekly tournament every week (built in), one new venue look or crowd theme per fortnight via remote tuning.
- Fix-and-tune releases from the telemetry funnel: where players stop in the lesson, first career fights,
  the difficulty of the first boss, pack value.
- Tune the economy remotely (`docs/REMOTE-TUNING.md`): pack prices, free pack, daily rewards, ad rewards.

### 60 days
- **New fighters**: a pack of 8 (generated with `tools/fighters/`), one legend per weight class, all earnable free.
- **Cosmetics shop** (no stats): shorts, gloves, walkout colours, tattoos; sold for gems and earned in the Season
  Pass. This is the money that never feels pay-to-win.
- **Events**: weekend "KO bonus" and "submission night" events with their own leaderboard.
- **Motion-captured animation** upgrade (a licensed MMA mocap pack): the biggest visual gain still open.

### 90 days
- **Clinch game** (against the cage: knees, dirty boxing, trips), a new layer in the fight.
- **Rival "ghost" fights**: fight a replay-driven copy of a friend's or a top player's fighter (the input-log
  replays already exist), the first step towards PvP.
- **Gyms / clubs** with a weekly club score, if day-30 retention is good enough to justify it.

### Live PvP (later, when the audience is there)
The fight simulation is already deterministic, takes only inputs, can snapshot and restore, and replays from input
logs: that is exactly what rollback netcode needs. What is still to build:
- **Netcode**: lockstep with 2–3 frames of input delay plus rollback for the rest (restore the snapshot, re-run
  with the late inputs). The fight runs at 60 Hz; inputs are a few bytes per tick.
- **Server**: matchmaking (by rating and region) and a relay for the input messages (WebSocket or WebRTC data
  channel). A small managed service (for example a Cloudflare Durable Object or a Fly.io app) costs roughly
  $20–100 a month at a few thousand daily players; dedicated game servers are not needed.
- **Anti-cheat**: the server (or both phones) re-runs the fight from the input log; a result that doesn't match is
  thrown out. Fighters are plain data checked by shared code, so a hacked fighter is rejected before the fight.
- **Fairness**: ranked PvP uses normalised fighters (same level, stars only cosmetic) so money can't buy wins.
- Estimate: 3–5 sessions of work plus a real-phone network test.

### KPIs and targets (first 30 days)
| What | Target | Measured by (opt-in telemetry event) |
|---|---|---|
| Lesson finished | ≥ 80 % of installs | `lesson_done` / `app_open` (first) |
| Day-1 retention | ≥ 35 % | `app_open` on day 1 after install |
| Day-7 retention | ≥ 12 % | `app_open` on day 7 |
| Day-30 retention | ≥ 4 % | `app_open` on day 30 |
| Fights per daily player | ≥ 6 | `fight_end` |
| Payer share | ≥ 1.5 % of monthly players | `purchase` (result ok) |
| Revenue per daily player | ≥ $0.04 | `purchase` + ad revenue from AdMob |
| Ad impressions per daily player | 3–6 (interstitial + rewarded) | `ad_shown` |
| Crash-free sessions | ≥ 99.5 % | Play Console vitals, `renderer_gone` |

### What the owner has to do, in order
1. Install the latest APK from the GitHub Release on your phone and play a career fight, a tournament and the
   practice room; tell Claude what feels wrong.
2. Create the Play Console app and the products listed in `docs/RELEASE.md` "Known gaps".
3. Create the AdMob app and ad units, and put the ids in the GitHub secrets (then Claude makes the first Play build).
4. Create the Play Games leaderboards and achievements and put their ids in the secrets.
5. Host `privacy.html`, `app-ads.txt` and `tuning.json` on your site.
6. Fill in the content rating and Data safety forms; start the closed test with 12 testers.
