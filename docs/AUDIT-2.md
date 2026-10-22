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
