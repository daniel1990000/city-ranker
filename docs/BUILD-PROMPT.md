# Build prompt (draft 2)

Paste this into a new Claude Code session that has both repos (`daniel1990000/city-ranker`, the game's repo, and
`daniel1990000/ufc`, Cartstronaut).

---

You are building **Cage Kings**, an original 3D MMA fighting game with realistic-looking fighters for Android
phones, in the `city-ranker` repo. Read `docs/MASTER-PLAN.md` first; it is the source of truth for scope,
content, money, the realistic-art route, the PvP-ready design and the milestones. The owner is non-technical and
mobile-first: reply in short plain language and explain what things mean for the game or the launch.

**Ground rules**
- Everything is original or properly licensed. Use no code, models, textures, animations, sound, fonts, names or
  data from EA SPORTS UFC or any UFC/EA property, and no real fighters, real gear brands or the words "UFC" or
  "Octagon". The EA APK was a design reference only; never put any of it in this repo. Every third-party asset
  goes in `docs/CREDITS.md` with its source and licence, and its licence must allow use in a paid, closed-source
  game outside Unity/Unreal.
- Reuse freely from the owner's own game in the `ufc` repo (Cartstronaut): it is our code. Copy the platform
  layer (`src/platform/`), the meta layer (`src/meta/`: saves with migrations, purchases/entitlements, reward
  clock, remote tuning, ad pacing, season pass, weekly), audio, effects, ragdoll, UI patterns, the Android
  project, the CI workflow, the release routine and the QA scripts. Keep their safety rules: grant purchases
  once per Play token and only when purchased; acknowledge/consume after the grant is saved; refunds revoke;
  timed rewards never go backwards; a failed cloud read never overwrites the cloud; UMP consent before ads;
  ads use Google's test ids until the owner provides real ones.
- Stack: Vite + TypeScript (strict) + three.js + Capacitor 8. Package `com.danielspurr.cagekings`. Landscape.
  60 fps on a mid-range phone, 30 fps on a low-end one, with a lower-detail mode.
- Develop on the session's designated branch, commit with clear messages, push. No pull requests unless asked.
- Quality bar: launch-quality, not a prototype. Every milestone ends with typecheck, lint, unit tests and the
  QA simulations green, a browser check at phone sizes with Playwright, and a playable build. Be honest about
  gaps.

**PvP-ready from day one (plan §9)**: the fight simulation in `src/game/fight/` is deterministic (fixed
timestep, seeded RNG, no `Math.random`, no `Math.sin/cos/exp` or other engine-dependent maths inside the
simulation), takes only per-tick input commands from controllers (touch, AI, replay; network later), can
snapshot and restore its full state cheaply, and records fights as input logs. Fighters and loadouts are
versioned plain data validated by shared code; rewards are pure functions of the result; networking sits
behind one interface with only a local implementation at launch. Tests prove the same inputs give the same
fight, and that snapshot → restore → replay matches.

**Realistic fighters (plan §8)**: a Blender + MPFB (MakeHuman, CC0 assets) script in `tools/fighters/` generates
each fighter from a recipe and exports glTF with levels of detail; PBR skin with sweat, bruise and cut layers;
arena lighting, shadows, tone mapping, bloom and a colour grade. Animation from Mixamo clips the owner
downloads (give them an exact list) or a licensed MMA mocap pack, with blending, hit reactions, foot planting
and a physics knockdown in code. Milestone 2 ends with a phone performance test of two fighters in a lit cage;
if it fails, stop and tell the owner before building more art.

**Fighting (milestones 2–3)**: plan §5: tap/swipe striking on the right, hold to block and swipe to slip on
the left, swipe down to shoot, stamina, head/body/leg damage shown on the fighters, stun → knockdown → KO, ref
stoppage, judges' decision, takedown/sprawl timing, a ground scramble, a submission tug-of-war, specials, five
AI archetypes with ladder-scaled difficulty, slow-motion finish and replay. A headless bot-vs-bot balance test
runs thousands of fights and reports win rates per archetype, fight length and finish types.

**Content and meta (milestones 4–5)**: 40 original fighters in 5 divisions and 4 rarities; 6 arenas; career
ladder of 5 tiers with boss fights and belts; training, gear, shards; daily fight card; weekly tournament with
Google Play Games leaderboards; monthly Season Pass track.

**Money (milestone 6)**: plan §7: rewarded ads (double cash, daily free pack, second wind, skip timer),
interstitials with Cartstronaut's pacing rules, IAPs (No Ads, Starter Pack, gem bundles, monthly Season Pass,
fighter bundles), and fighter packs bought with gems or earned, with odds shown before every purchase, a
visible pity counter, duplicates to shards, every fighter earnable for free, and paid packs switched off in
countries on a remote-tunable list (Belgium at launch) based on the Play Store country. Tests for every money
rule, as in Cartstronaut's `tests/`.

**Launch (milestones 7–8)**: tutorial fight, low-end performance pass, two independent audit rounds, store
listing assets (screenshots, feature graphic, short video), privacy policy, Data safety answers, content
rating answers (expected PEGI 12 / ESRB Teen with "In-game purchases (includes random items)"; blood off; ads
capped at Teen), `docs/RELEASE.md` with notes for every release, a `CLAUDE.md` handover kept current.

Start with milestone 1 (fresh project from the Cartstronaut shell), then milestone 2. After each milestone,
tell the owner in two or three plain sentences what they can now try and what is next.
