# Audit 2 (October 2026)

Run of `docs/AUDIT-PROMPT.md` on version 0.3.0. Severity: S1 crash / data loss / money, S2 exploit or broken
feature, S3 feels wrong, S4 polish. Status: fixed (commit) or open.

## Summary
The fight could be beaten by spamming one move: leg kicks (95 % against the champion AI), head kicks (55 %),
uppercuts (40 %), and takedown-then-submission spam won on the judges' cards (55 %). Good defence (block, then
counter) was barely rewarded. All of that is fixed: no single-move spam beats a champion now, defence pays
(parries, checks, predictability), and the AI reads habits. Further findings below.

## Baseline (0.3.0, before fixes)
- Tests 85/85, lint and typecheck clean, both simulations green. Web build ~5.7 MB (fighters 4.6 MB).
- Bot table against the AI (20 fights each, win % at difficulty 100 / 500 / 950):

| bot | 0.3.0 | after fixes |
|---|---|---|
| masher (6 power punches in a loop) | 70 / 35 / 20 | 80 / 30 / 30 |
| turtle (only blocks) | 0 / 0 / 0 | 0 / 0 / 0 |
| runner (only backs away) | 0 / 0 / 0 | 0 / 0 / 0 |
| jab only | 35 / 15 / 0 | 15 / 0 / 0 |
| cross only | 85 / 30 / 25 | 10 / 10 / 0 |
| leg kicks only | 95 / 90 / **95** | 0 / 0 / 0 |
| head kicks only | 80 / 60 / **55** | 0 / 0 / 0 |
| body kicks only | 55 / 35 / 15 | 35 / 5 / 0 |
| uppercut only | 85 / 80 / **40** | 5 / 5 / 0 |
| takedown spam | 65 / 55 / 35 | 45 / 35 / 30 |
| takedown + submission spam | 75 / 40 / **55** | 75 / 15 / 25 |
| special when ready | 45 / 25 / 5 | 30 / 25 / 5 |
| block, then counter | 0 / 15 / 5 | 0 / 5 / 5 (one-move bot: predictable) |

## Findings

| ID | Area | Sev | Finding | Status |
|---|---|---|---|---|
| F1 | Fight | S2 | Leg-kick spam beat the champion 95 %: a leg knockdown let the kicker pounce, and any knocked-down fighter counted as dazed, so a few ground punches were a TKO; leg kicks landing on a fighter stepping in counted as counters (x1.4); stamina came back so fast spam was free. | fixed: leg knockdowns don't daze, ground TKO needs 9 unanswered, counters only to the head, stamina regen -20 %, leg damage 45 % (was 60 %), legs recover to 45 % after a leg knockdown |
| F2 | Fight | S2 | One-move spam (head kick, uppercut, cross) beat strong AI: its defence depends on reacting in time. | fixed: **predictability** (each straight repeat of the same strike: +2 startup ticks, -12 % damage, up to 4; three jabs free), "Mix it up!" on the HUD; the AI reads habits (defends a move more the more it sees it, pre-blocks a one-trick opponent, closes in on kickers) and punishes recoveries |
| F3 | Fight | S2 | Takedown + submission spam won decisions: every submission attempt scored for the judges. | fixed: only a hold that gets to 70 % counts; the AI sprawls better with every shot it has seen; a stuffed shooter getting up can be hit |
| F4 | Fight | S3 | Good defence was barely rewarded. | fixed: **parry** (guard raised within 5 ticks of the impact: no chip, no guard damage, attacker late, counter window), **checks** (a guard up against a leg kick hurts the kicker's shin), kicks that miss or are blocked leave the kicker exposed longer |
| F5 | Fight | S3 | "Hurt to the body" almost never happened after counters became head-only. | fixed: body over 45 % and a strong body shot or any body kick |
| F6 | UI | S2 | The Fighters list collapsed on phones: card rows shrank to 28 px inside the scrolling grid and the cards overlapped (only a strip of each showed). | fixed: fixed card shape (aspect-ratio) and rows as tall as the cards |
| F7 | Career | S2 | "Forfeit" in the pause menu didn't count as a loss: a champion could quit a losing title defence and keep the belt. | fixed: it is now "Retire (counts as a loss)", a TKO loss through the normal result flow |
| F8 | Retention | S2 | Achievements are synced to Play Games but nothing in the game ever awards one. | fixed: 21 achievements (`src/meta/achievements.ts`) awarded after fights, packs, star-ups, the daily login and the season, each paid once and pushed to Play Games at once; achievements screen; plus daily missions (`src/meta/missions.ts`) |
| F9 | Retention | S3 | The weekly tournament module (`src/meta/weekly.ts`) has no game mode. | fixed: an 8-fighter weekly bracket, the same for everyone (`src/meta/tournament.ts`), points for wins, finishes, speed and damage avoided, a Play Games board, prize tiers once a week, a free entry a day (+1 for a rewarded video), a loaner fighter for players without one in the week's division |
| F10 | UI | S3 | Tablet (1280x800) layout is stretched with big empty areas; at 640x360 the fighter detail and career screens cut text at the bottom. | fixed: menu redesign (scrolling shelves and tabs inside their own scrollers, tablet sizes, short tile names on narrow phones), checked at 640x360, 844x390 and 1280x800 |
| F11 | Career | S3 | After the first title the career is only title defences against harder and harder opponents (the economy sim's win rate falls to ~20 % over 60 days): a thin, frustrating loop. | fixed: defence opponents capped at a fair level, non-title super fights, Legacy ranks for defences, Prestige re-runs (1-5) and moving weight class; the sim's champion win rate is now 56-67 % (`docs/ECONOMY.md`) |
| F12 | UI | S4 | Pack art is a plain "2x" / "3x"; menus are functional but look generic. | fixed: foil pack art per tier, original line icons, metallic rarity frames, broadcast-style hub, result screen redesign |
| F13 | Graphics | S3 | The crowd is flat cut-out silhouettes; no image-based lighting, no post-processing (bloom, grading, vignette); materials look plasticky in places. | fixed: crowd rendered from CC0 MakeHuman people in Blender (`tools/crowd`), venue reflection lighting, post-processing by quality tier, leather / fabric / skin materials, contact shadows, camera flashes |

## Second pass (22-23 October 2026)

A read-only bug hunt of the money and save code (8 confirmed findings), all fixed with tests (`tests/bughunt.test.ts`,
`tests/season-clock.test.ts`):

| ID | Sev | Finding | Status |
|---|---|---|---|
| B1 | S1 | Flipping the phone clock months ahead and back re-created the season with a fresh daily xp cap (12 tier claims a day). | fixed: the day's xp count survives a re-created season |
| B2 | S2 | A clock that had run ahead and was fixed locked the free daily pack (and the offer card) for as long as it had been ahead. | fixed: the release caps them to today |
| B3 | S2 | Buying next month's Season Pass before the old season rolled over lost last month's unclaimed premium rewards. | fixed: the season rolls over on resume and before any purchase |
| B4 | S2 | Two quick taps on a "Watch ad" button: the ad played and paid nothing. | fixed: a second tap never cancels the first |
| B5 | S2 | Loading the cloud copy before Google Play answered took a bought, levelled bundle fighter (given back at level 1 later). | fixed: nothing paid is taken back until Play has answered this session |
| B6 | S2 | Retiring from a title fight paid 30 % of the purse every time: a quit-for-cash loop. | fixed: retiring pays nothing |
| B7 | S3 | Stepping the date a few days ahead and back roughly doubled the daily login rewards (the 7-day release forgave the borrowed days). | fixed: only an offset over a month is ever released |
| B8 | S3 | An ad break could follow a title win or a level up, against the pacing rules. | fixed |
| B9 | S2 | Billing calls could close each other's connection (the country check at start-up, a purchase on resume). | fixed: one queue with time-outs; the country check runs after billing is up and on resume |
| B10 | S3 | A pending Starter Pack payment that cleared days later paid only No Ads. | fixed: an unacknowledged purchase is always a new sale |
| B11 | S2 | Fighter portraits on cards (pack opening, Fighters list) stayed invisible after the redesign. | fixed |
| B12 | S3 | First launch: the daily reward card opened before the lesson and could stack with the cloud-save card. | fixed |

| B13 | S2 | Save codes could re-roll packs (export, open, re-import, open again); and no save recorded when it began. | fixed: the roll depends only on the save; `firstAt` is set at the first launch |

Left for later: the cloud copy is last-writer-wins between two phones used at the same time.
