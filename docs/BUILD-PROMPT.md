# Build prompt (draft 1)

Paste this into a new Claude Code session that has both repos (`daniel1990000/city-ranker` and
`daniel1990000/ufc`). It will be revised once the owner answers the questions in `MASTER-PLAN.md` §12;
the `{{…}}` placeholders get filled in then.

---

You are building **{{GAME_NAME}}**, an original arcade 3D MMA fighting game for Android phones, in the
`city-ranker` repo (now the game's repo). Read `docs/MASTER-PLAN.md` first; it is the source of truth for scope,
content, money and milestones. The owner is non-technical and mobile-first: reply in short plain language,
explain what things mean for the game or the launch.

**Ground rules**
- Everything is original. Use no code, art, sound, fonts, names or data from EA SPORTS UFC or any UFC/EA
  property, and no real fighters, brands or the words "UFC" or "Octagon". The EA APK was a design reference
  only; never put any of it in this repo.
- Reuse freely from the owner's own game in the `ufc` repo (Cartstronaut): it is our code. Copy the platform
  layer (`src/platform/`), the meta layer (`src/meta/`: saves with migrations, purchases/entitlements, reward
  clock, remote tuning, ad pacing, season pass, weekly), audio, ragdoll, effects, UI patterns, the Android
  project, the CI workflow, the release routine and the QA scripts. Keep their safety rules: grant purchases
  once per Play token and only when purchased; acknowledge/consume after the grant is saved; refunds revoke;
  timed rewards never go backwards; a failed cloud read never overwrites the cloud; UMP consent before ads;
  ads use Google's test ids until the owner provides real ones.
- Stack: Vite + TypeScript (strict) + three.js + Capacitor 8. Package `com.danielspurr.{{package}}`.
  Landscape. Must hold 60 fps on a mid-range phone and 30 fps on a low-end one.
- The fight simulation is deterministic (fixed timestep, seeded RNG, no `Math.random` in `src/game/`), so bot
  fights can be simulated headless in tests for balance, and weekly tournaments are the same for everyone.
- Quality bar: launch-quality, not a prototype. Every milestone ends with typecheck, lint, unit tests and the
  QA simulations green, a browser check at phone sizes with Playwright, and a playable build. Be honest about
  gaps.
- Develop on the session's designated branch, commit with clear messages, push. No pull requests unless asked.

**Fighting (milestones 2–3)**: implement §5 of the plan: touch controls (right side strikes by tap/swipe
direction, left side hold to block and swipe to slip, swipe down to shoot), stamina, head/body/leg damage,
stun → knockdown → KO, ref stoppage, judges' decision, takedown/sprawl timing, a ground scramble, a submission
tug-of-war, special moves, five AI archetypes with ladder-scaled difficulty, slow-motion finish and replay.
Fighters are a code-built skeletal model with keyframed + procedural animation (blending, hit reactions,
foot IK) and a ragdoll on knockout. Write a headless bot-vs-bot balance test that runs thousands of fights
and reports win rates per archetype, average fight length and finish types.

**Content and meta (milestones 4–5)**: fighter generator and 40 original fighters in 5 divisions and 4
rarities; 6 arenas; career ladder of 5 tiers with boss fights and belts; training, gear, shards; daily fight
card; weekly tournament with Google Play Games leaderboards; monthly Season Pass track.

**Money (milestone 6)**: §7 of the plan: rewarded ads (double cash, daily free pack, second wind, skip timer),
interstitials with Cartstronaut's pacing rules, IAPs (No Ads, Starter Pack, gem bundles, monthly Season Pass,
fighter bundles), packs {{PACK_POLICY}}, odds shown wherever randomness is involved. Tests for every money
rule, as in Cartstronaut's `tests/`.

**Online**: {{ONLINE_POLICY}}

**Launch (milestones 7–8)**: tutorial fight, low-end performance pass, two independent audit rounds, store
listing assets (screenshots, feature graphic, short video), privacy policy, Data safety answers, content
rating answers (expected PEGI 12 / ESRB Teen; blood off by default; ads capped at Teen), `docs/RELEASE.md`
with notes for every release, a `CLAUDE.md` handover kept current.

Start with milestone 1 (fresh project from the Cartstronaut shell), then milestone 2. After each milestone,
tell the owner in two or three plain sentences what they can now try and what is next.
