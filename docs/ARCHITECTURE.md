# Cage Kings: architecture and contracts

The source of truth for how the parts fit together. `docs/MASTER-PLAN.md` says *what* we build; this file says
*where* it lives and *which interfaces* the parts agree on. Change a contract here first, then the code.

## Stack and layout

Vite 7 + TypeScript (strict) + three.js 0.186 + Capacitor 8 (Android). Landscape. 60 Hz fixed-step simulation.

```
src/
  main.ts, app.ts          boot + App state machine (screens, actions)            [shell]
  platform/                iap, ads (UMP first), games (Play Games), telemetry,   [shell, from Cartstronaut]
                           notify, platform, sharecard
  meta/                    save (+migrations), entitlements, clock, tuning,       [shell, from Cartstronaut]
                           adpacing, season, weekly
                           roster, career, packs, economy, training, gear, shop   [content]
  game/fight/              deterministic fight simulation, AI, controllers,      [fight]
                           replay, snapshot. NO three.js, NO DOM, NO Math.random
  render/fighter/          load + dress + animate realistic fighters (three.js)   [art, anim]
  render/                  arena, crowd, lighting, camera director, fx, damage    [render]
  audio/                   sound                                                  [audio]
  ui/                      DOM UI, HUD, touch controls, styles                    [ui]
tools/fighters/            Blender + MPFB pipeline -> public/assets/fighters/     [art]
tools/anim/                animation pipeline -> public/assets/anim/              [anim]
tests/                     vitest unit tests (*.test.ts)
scripts/qa/                QA simulations and Playwright scripts
docs/                      plans, notes per area (docs/notes/<area>.md), credits
```

Every third-party asset is listed in `docs/CREDITS.md` with source and licence (CC0 or a licence that allows a
paid closed-source game). Nothing from EA SPORTS UFC, the UFC or real fighters, ever.

## Contract 1: the fight simulation (`src/game/fight/`)

- **Determinism**: integer maths only inside the simulation (fixed-point; positions in millimetres, time in
  ticks, meters 0..10000). No floats that could differ across devices, no `Math.sin/cos/exp/pow/random`, no
  `Date`. All randomness from a seeded integer RNG stored in the state.
- **Space**: one axis. Fighter 0 starts at x = -1200 facing +x, fighter 1 at x = +1200 facing -x. The cage
  wall stops movement at |x| = 3600. Lateral circling is cosmetic (renderer only).
- **API** (names may grow, not change):
  ```ts
  const fight = createFight({ seed, a: FighterSpec, b: FighterSpec, rules: FightRules });
  stepFight(fight, [inputA, inputB]);    // advance one tick (1/60 s)
  fight.state                            // plain JSON-serialisable FightState
  snapshot(fight) / restore(fight, snap) // structuredClone-able, cheap
  hashState(fight.state): number         // for determinism tests and (later) desync checks
  drainEvents(fight): FightEvent[]       // what happened this tick: hit, block, knockdown, sub start, round end…
  ```
- **Input per fighter per tick** (`FightInput`): `strike` (one of the strikes below, edge-triggered, buffered
  by the sim for a few ticks), `special`, `block` (held), `evade` ('left' | 'right' | 'back'), `move` (-1/0/1,
  toward = +1), `shoot` (takedown, or sprawl when defending one), `ground` ('up'|'down'|'left'|'right'),
  `tap` (submission mash / ground-and-pound).
- **Controllers**: `interface Controller { next(view: FightView, side: 0|1): FightInput }`: touch, AI, replay
  (input log), and later network all implement it. The AI only reads what a player could see.
- **Fighter in the state** exposes `action: ActionId`, `actionTick`, `actionLength` so the renderer can play
  the matching clip exactly in sync, plus stamina, damage per zone (head, body, legs), hurt, special meter,
  ground position.
- **Replays** are `{ version, seed, specs, rules, inputs: compact per-tick log }`; replaying gives the same
  `hashState` at every tick.

### ActionId list (shared by the sim and the animation clips; clip name = action id)

Standing: `idle`, `walkFwd`, `walkBack`, `jab`, `cross`, `hookL`, `hookR`, `uppercut`, `bodyShot`, `lowKick`,
`bodyKick`, `headKick`, `superman`, `flyingKnee`, `spinBackfist`, `block`, `blockHit`, `slipL`, `slipR`,
`swayBack`, `hitHeadL`, `hitHeadR`, `hitHeadHeavy`, `hitBody`, `hitLeg`, `stunned`, `knockdown`, `downed`,
`getUp`, `shoot`, `sprawl`, `takedownTop`, `takedownBottom`, `taunt`, `victory`, `defeat`, `walkout`.

Ground (paired, both fighters share one anchor point; top fighter faces +x of the anchor):
`gndGuardTop`, `gndGuardBottom`, `gndMountTop`, `gndMountBottom`, `gndPound` (top), `gndPoundHit` (bottom),
`gndBlock` (bottom), `gndAdvance` (top passes guard to mount), `gndEscape` (bottom gets back to guard),
`gndStandUp` (both get up), `subChokeAtk`, `subChokeDef`, `subArmbarAtk`, `subArmbarDef`, `tapOut`.

Each attack clip carries an `impact` time (seconds) in `public/assets/anim/clips.json`; the renderer scales the
clip so its impact lands on the simulation's first active tick.

## Contract 2: fighters on screen (`src/render/fighter/`)

- **Rig**: MPFB (MakeHuman for Blender) **"game_engine"** rig for every fighter, so every animation clip fits
  every body. Clips carry bone rotations only, plus the root/pelvis translation.
- **Look** is data, generated from a seed plus hints so the roster never needs hand-made art:
  ```ts
  interface LookHints { sex: 'm' | 'f'; build?: 'lean' | 'athletic' | 'muscular' | 'heavy';
    skin?: 'light' | 'tan' | 'brown' | 'dark'; hair?: string; beard?: boolean; tattoos?: boolean; }
  lookFromSeed(seed: number, hints: LookHints, division: DivisionId): FighterLook
  ```
  `FighterLook` (owned by the art code) holds body morph weights, skin tone, hair/beard/brow ids and colours,
  shorts style and colours, glove colour, tattoo ids. It is plain JSON (it goes in saves and replays).
- `createFighterView(look): FighterView` returns a three.js object with `play(action, t)`, damage layers
  (`setDamage({head, body, legs})`), sweat, and level-of-detail switching.

## Contract 3: game data (`src/meta/`)

- `DivisionId`: `'mLight' | 'mWelter' | 'mMiddle' | 'mHeavy' | 'wStraw' | 'wBantam'`.
- `FighterSpec` (in `src/game/fight/types.ts`): id, name, nickname, division, archetype
  (`'brawler' | 'boxer' | 'kicker' | 'wrestler' | 'grappler'`), stats 1..100 (power, speed, chin, cardio,
  striking, kicking, wrestling, grappling, submissions, defense), rarity (`'common'|'rare'|'epic'|'legend'`),
  lookSeed, lookHints.
- Roster: 48 original fighters (8 per division) in `src/meta/roster.ts`. Upgrades/levels are applied to a
  base spec by a pure function, so the sim only ever sees a final `FighterSpec`.
- Rewards and pack rolls are pure functions of (result, seed, state) so a server could compute them later.

## Contract 4: money and saves

Exactly Cartstronaut's rules (see the `ufc` repo `CLAUDE.md` and `src/meta/entitlements.ts`): grant once per
Play purchase token, only when purchased; acknowledge/consume after the grant is saved; refunds revoke; timed
rewards never go backwards; a failed cloud read never overwrites the cloud; UMP consent before ads; Google's
test ad ids until real ones are configured. Paid packs: odds shown before purchase, pity counter, disabled in
countries on the remote-tunable `paidPacksBlockedCountries` list (default `['BE']`).

## Working rules for parallel builders

- Stay inside your area's folders. If you need something from another area, write against the contract above
  and note it in `docs/notes/<area>.md`; integration happens after.
- Do not commit; the coordinator commits.
- `npm test`, `npm run typecheck` and `npm run lint` must pass for your files. Do not "fix" another area's files.
- Throwaway scripts go in `scripts/qa/_tmp_*` and are deleted before you finish.
