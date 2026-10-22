# Cage Kings: audit, fix and overhaul prompt

Paste this into a fresh Claude Code session on this repo (or say "run docs/AUDIT-PROMPT.md"). It is written to be run
start to finish in one session, in order, without parallel agents, and to be run again later: each run picks up
from the last audit report.

---

You are the lead developer, designer and QA on **Cage Kings**, an original 3D MMA fighting game for Android phones
(this repo). Your job in this session: **audit the whole game hard, fix what you find, then overhaul and extend it
until it is a game people keep playing and pay for**, and leave a clear plan for what comes next. Work in the order
below. Do not stop after the audit: the fixes and features are the point.

## 0. Ground rules (read first, follow throughout)

- Read `CLAUDE.md` first and follow it: the owner, their **standing decisions** (don't relitigate them), commands,
  release routine. Then `docs/MASTER-PLAN.md`, `docs/ARCHITECTURE.md`, `docs/FIGHT-DESIGN.md`, `docs/ECONOMY.md`,
  `docs/RELEASE.md` (including "Known gaps"), and `docs/AUDIT-2.md` if an earlier run left one.
- The owner is non-technical and plays on a phone. Reports to them are short, plain, and about what changed in the
  game. Ask them only about money, accounts, legal, or a standing decision; decide everything else yourself and
  say what you decided.
- **Evidence over opinion.** Every finding has a reproduction (a test, a bot match, a screenshot, a number). Every
  fix has a test that failed before and passes after, unless it is purely visual (then a before/after screenshot).
- **The simulation stays deterministic** (integer maths, seeded RNG, inputs-only controllers, snapshot/restore,
  replays). Bump `SIM_VERSION` when fight rules change. Never use `Math.random`, floats or wall time in
  `src/game/fight` (except `ai.ts`, which has its own seeded RNG).
- Nothing from EA SPORTS UFC, the UFC, real fighters or brands. Assets must be CC0 or made here; credit them in
  `docs/CREDITS.md`.
- Work on the session's designated branch; small commits with clear messages; push after each finished step. No
  pull requests unless asked. Keep `npm test`, `npm run lint`, `npm run typecheck` and both simulations green at
  every commit.
- Throwaway scripts go in `scripts/qa/_tmp_*` and are deleted before you finish. Kill processes by PID (never with
  a pattern that also matches your own shell command).
- Be honest about what you could not check (real phones, real purchases, real ads): list it for the owner.

## 1. Baseline (before touching anything)

Run and record the numbers in `docs/AUDIT-2.md` (create it):
- Typecheck, lint, all tests, `scripts/qa/fight-balance.test.ts` (RUNS=30) and `scripts/qa/econ-sim.test.ts`.
- Build size (`npm run build`), the largest assets, and the time to the first menu in the browser.
- A browser pass with Playwright (see CLAUDE.md "Browser QA"): every screen at 640x360, 844x390 and 1080x2400
  landscape (2400x1080), screenshots in the scratchpad. Play one full career fight and one quick fight with
  `qaAutoplay`, one with the keyboard.
- The bot table below at AI difficulty 100 / 500 / 950, 20 fights each: win %, finish types, rocked / hurt /
  knockdown counts per fight, time on the ground, fight length.

## 2. The audit (find everything; fix nothing yet except crashes)

Go area by area. For each finding record: **ID, area, severity (S1 crash / data loss / money, S2 exploit or
broken feature, S3 feels wrong, S4 polish), evidence, how to reproduce, proposed fix.** Write them into
`docs/AUDIT-2.md` as you go.

**Fight exploits (bots).** Write each as a `Controller` in `tests/fight-helpers.ts` (next to `Masher`) and fight
them against the AI. Any bot that beats difficulty 950 more than ~30 % of the time is an S2 exploit.
- Masher (exists), Turtle (only holds block), Runner (only walks backwards; does the clock or the judges punish
  it?), Kick spammer (only leg kicks / only head kicks), Takedown spammer (shoots on cooldown), Sub spammer (goes
  for a submission at every chance), Special spammer, Counter-only (waits for a whiff), Jab-only.
- Also: a human-paced player (0.5 s reactions) on the ground, in scrambles, sprawls and the tap battle. Can they
  always get up eventually? Can they ever be held down? Can they finish a submission?

**Fight feel.** Frame data (`docs/FIGHT-DESIGN.md`): are any moves strictly better than others? Is there a reason
to use every strike? Does stamina matter? Do rocked, hurt-to-the-body and limping happen often enough to feel
dramatic but not every exchange? Does every round feel different? Are decisions scored fairly (check
`judges.ts` against what happened)? Does the AI feel like a person (reaction, variety, adapting to the player) or a
machine (perfect timing, repeating patterns)?

**AI.** Per archetype and difficulty: does it play to its style? Does it adapt when losing? Does it exploit
anything? Is the difficulty curve smooth through the career (`docs/ECONOMY.md` career ladder)?

**Visuals.** Contact sheets of every clip from several angles (`lab.html?single`, `labCam`, `labSet`), male and
female, light and heavy builds. Look for limbs through bodies, gloves inside heads, feet sliding, snapping between
clips, hits that don't connect, odd hair or clothing. Ground and submission poses especially. The camera: does it
ever lose a fighter, clip through the cage, or frame badly on narrow phones?

**HUD and touch.** Every prompt (sprawl, scramble, tap battle, get up): is it readable, timed fairly, explained?
Thumb reach at all three sizes, notch and safe areas, left-handed mode, reduced motion. Can a new player learn
every control from the game alone (lesson, hints, move list)?

**Menus and flows.** Every button does something sensible; back works everywhere (Android back button); no dead
ends; loading states; empty states (no fighter in a division, no packs, offline); what happens mid-fight on app
switch, phone call, low battery, rotation.

**Economy and money.** Run `econ-sim`. How long to first title, first epic, a full division, as a free player and
as a small spender? Is anything pay-to-win beyond what `docs/ECONOMY.md` intends? Check every price, reward and
timer. Play policy compliance: odds shown before a paid pack, pity visible, paid packs blocked where required
(Belgium, check the Netherlands too), ads Teen-capped, interstitial pacing exactly as CLAUDE.md says, rewarded ads
opt-in and labelled, Starter Pack and Season Pass grant exactly what they say, refunds revoke, restore never grants
paid items twice. Look for dark patterns and remove them.

**Saves and platform.** Corrupt or truncated saves, old versions (migrations), save codes, cloud restore (read
before write), clock changes, purchases while offline, the native save mirror, renderer crash recovery, audio
focus, the back button, notifications.

**Performance.** Draw calls, triangle counts, texture sizes, shader compile hitches, garbage per frame, memory over
ten fights in a row, load time, APK and web bundle size. Use the `ride-hitch`-style throttled test idea from
Cartstronaut (`/home/user/ufc/scripts/qa`) if the repo is available. Target: steady 60 fps on a mid phone, 30 on a
low one, with auto quality stepping down cleanly.

**Code health.** Dead code and unused exports (e.g. **achievements are read but never awarded**, **the weekly
tournament module `src/meta/weekly.ts` has no game mode**), settings that do nothing, TODOs, duplicated logic,
missing tests for launch-critical rules, lint suppressions, error handling that swallows real failures.

**Legal and content.** No real names or brands anywhere (code, data, art, text). Credits complete. Privacy
policy matches what the app actually collects. Age rating answers match the content.

Finish the audit with a ranked table at the top of `docs/AUDIT-2.md` and a one-paragraph plain summary.

## 3. Fix (heaviest first)

Fix in this order: S1, then S2, then S3 that the owner would notice in the first ten minutes, then the rest.
For each: a failing test or bot match first, then the fix, then re-run the tests, both simulations and the bot
table. After any fight change, re-check the "owner playtest" tests in `tests/fight-sim.test.ts` and the balance
targets: archetypes 38-62 % against the field, decisions 30-50 %, a masher beats a beginner most of the time and a
champion rarely, a person-paced player can get up and can finish holds. Update `docs/FIGHT-DESIGN.md` with the new
numbers. Mark each finding fixed (with the commit) in `docs/AUDIT-2.md`.

## 4. Overhaul and new features

Pick from this list by **impact on fun, retention and money per day of work**, write a short design note for each
in `docs/MASTER-PLAN.md` before building it, build it fully (code, UI, tests, balance), and verify it in the
browser. Do at least the first group; go as far down as the session allows.

**Fight depth (the game is the fight).**
- **Clinch game**: tie-ups at close range, knees, elbows (no blood), dirty boxing, cage pressure, breaking away.
- **Striking depth**: feints, switch stance, checking leg kicks, catching kicks, counters off a parry, combo
  inputs that feel like combos, body-head mixes that pay off.
- **Ground depth**: half guard, side control, back mount; more submissions (rear-naked choke, triangle, kimura,
  guillotine off a bad shot); getting up against the cage; transitions shown with clear prompts.
- **Damage you can see**: swelling and marking that build up (blood stays off), a doctor's check that can stop a
  fight, fighters slowing as they tire.
- **AI with personality**: tendencies per fighter (pressure, counter-puncher, wrestler who strikes to set up the
  shot), adapting during a fight, taunts and momentum.

**Things to come back for.**
- **Achievements**: award them in game (career milestones, finishes, collection) and sync to Play Games.
- **Weekly tournament** using `src/meta/weekly.ts`: the same seeded bracket for everyone, rewards by finish, the
  week's best score on the leaderboard.
- **Daily missions** (three a day, rerollable with a rewarded ad), streak rewards, a first-win-of-the-day bonus.
- **Career story**: rivals who come back, callouts, a title picture, defences, rankings per division, a retirement
  and legacy screen.
- **Fight camp**: short training mini-games (pad rhythm, sparring drills) that give the stat points the timers
  give now, as an alternative to waiting.

**Make it look and sound like a broadcast.**
- Walkouts, the referee, the corner between rounds (advice text built from the round's stats), a stats screen
  between rounds, instant replay of knockdowns from the input log (the camera already has a replay mode).
- On-screen commentary lines (text) driven by fight events; better crowd and impact sounds; menu music.
- Animation: tighten every clip found weak in the audit; if the owner has a licensed motion pack or Mixamo access,
  plan the retarget to the MPFB rig in `tools/fighters/`.

**Money (within the standing decisions).**
- Cosmetics for gems: shorts, gloves, walkout music and entrances, cage and venue themes; shown on the fighter in
  the shop. Cosmetics only, never stats.
- Better offers: a level-gated second offer, Season Pass preview of the premium track, "Watch ad: …" placements
  that players actually want (double rewards, extra training, a second free pack per day at most).
- Funnel telemetry (opt-in only): first fight finished, lesson finished, first pack, first purchase, day-1 and
  day-7 return, so the owner can see where players drop off.

**Quality of life.** Difficulty choice (Easy / Normal / Hard) and an assist option for the ground, a training
room with a move list and a dummy, control size and opacity settings, a "how to" card for every prompt the first
time it shows, faster menus (fewer taps to the next fight).

## 5. The plan for later

Update `docs/MASTER-PLAN.md` with:
- What shipped in this run, and the audit's open items.
- A roadmap: before launch (closed test fixes, store assets, a short gameplay video), the first 30 / 60 / 90 days
  after launch (events, seasons, new fighters, cosmetics), and **live PvP** later (the simulation is ready for
  lockstep with input delay and rollback; outline server needs, matchmaking, anti-cheat by replaying inputs, and
  cost).
- KPIs and targets (day-1 / day-7 / day-30 retention, fights per day, payer share, revenue per daily player, ad
  impressions per player) and which telemetry events measure each.
- What the owner has to do, in plain steps.

## 6. Release and report

Follow the release routine in `CLAUDE.md`: bump the minor version, notes in `docs/RELEASE.md`, all checks green,
refresh the store screenshots and feature graphic if the game looks different (`node scripts/store.mjs`), commit with
`[release] x.y.z: ...`, push, and check that CI passed and published the release with the APK. Then tell the owner,
in a few short plain lines: the download link, the biggest things that changed, what to try on the phone, and what
still needs them.

## 7. Keep going

If time is left, start again at step 2 on the areas with the most open findings, then fix, then build the next
feature from the list. Each loop ends with green checks, a pushed commit and an updated `docs/AUDIT-2.md`. Stop only
when the session ends or the remaining items need the owner (money, accounts, real phones).
