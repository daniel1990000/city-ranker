# Releases

## 0.3.0 (20 October 2026): fixes from the first phone playtest

The owner played 0.2.0 on a phone: the submission bar didn't fill, mashing punches always won, fights were only
knockouts with no stuns, and the AI kept taking them down and holding them there.
- **Submission bar**: the coloured fill had no width, so it never showed (the taps were counted all along). It now
  fills gold when you have the hold and red when you're caught, and thumps on every tap. The AI taps at a human
  pace (4.3 to 7.5 taps a second); you finish holds on most opponents and escape most of theirs by tapping fast.
- **Mashing loses**: long strings of punches stop locking the opponent in place and they shell up after four; a
  blocked punch leaves you a beat late; tired punches barely stun. The AI covers up under a barrage and hits back.
  Measured: a pure button-masher beats a beginner ~85 % of the time and a champion ~25 %.
- **Health events**: fighters get rocked (banner, slow motion, pulsing red or gold screen edge, wobbling, guard
  weak) several times a fight and can recover; a strong body shot doubles a fighter over ("Hurt to the body"); a
  worn leg makes them limp. Knockdowns more often let the fighter get back up.
- **Takedowns and getting up**: the AI rests 9-16 s between takedown attempts; the sprawl window is longer and a
  sprawl pressed as the shot comes in counts (any downward swipe works); in ground scrambles the AI reads the arrow
  at a person's speed; the referee stands the fighters up after 8 s without progress and after 20 s on the ground in
  any case; an on-screen hint says how to get up, escape, pass or submit.
- Balance re-measured (`docs/FIGHT-DESIGN.md`): styles 37-59 % against the field; decisions 39 %, KO 24 %, TKO 17 %,
  submissions 20 %. New tests pin each playtest problem (`tests/fight-sim.test.ts`, `tests/touch.test.ts`).

## 0.2.0 (16 October 2026): launch features and fixes

- **First fight lesson**: six steps (jab, power punch, block, slip, kick, takedown) against a sparring partner, with
  a coach card and a Skip button; then the easy opponent fights back for real.
- **Auto graphics**: on "Auto", the game watches the frame rate in fights and lowers the resolution (then the scene
  detail) on phones that can't keep up, and gives resolution back to phones that run fast.
- **Leaderboards**: wins, knockouts and best win (each win gets a fight score; Play Games shows the best of the day,
  week and all time), opened from the home screen. Set up three leaderboards in Play Console ("Best win", "Wins",
  "Knockouts") and put their ids in the `PGS_LEADERBOARDS` secret.
- **Safe cloud save**: the game reads the Play Games copy before it ever uploads; if the copy holds more progress it
  asks "Load cloud progress?", and if it can't be read it uploads nothing.
- **Phone behaviour**: the fight pauses when the app is switched away or a call comes in, the screen stays on during
  fights, vibration on knockdowns and big hits, Google Play's review card once after a title or the 5th win, a
  "Privacy options" button where the ad consent rules require it, a warning when the phone's storage is full, and
  low graphics after a graphics crash. The Starter Pack offer pops up at most once a day on the home screen, from
  the 4th fight on, only while it can be bought.
- **Looks**: fighters keep a realistic distance on screen (no bodies passing through each other), a guard glove is
  never placed inside the head or neck, fighters start in their corners and the camera starts in place (no slide in
  from the middle on a slow phone).
- **Settings that work**: left-handed controls (attack on the left, the lesson says so too), reduced motion (no
  camera shake, punch-ins or flashes), vibration, graphics (from the next fight), opt-in reminders (free pack ready,
  training finished; offered once after the first free pack).
- **Champion Bundle**: its epic fighter (Mateo Lozano) comes with it, and goes with a refund unless the player also
  earned him from a pack. Save codes and cloud copies never carry paid items.
- **Fixed before release** (found by checking that every platform piece is connected): interstitials could never
  show (launches were not counted), the cloud save could upload before reading, the Champion Bundle's fighter was
  missing, save codes could carry paid items, the clock protection was off, the reminder icon was missing (and was
  Cartstronaut's cart), left-handed and reduced-motion settings did nothing.

## 0.1.0 (16 October 2026): first playable build

What is in it:
- **Fighting**: a deterministic 60 Hz simulation with 9 strikes and 3 specials, blocks, slips and sways with counter
  windows, stamina, head / body / leg damage, stuns, knockdowns, KO / TKO / submission / judges' decisions, takedowns
  and sprawls, guard and mount, ground-and-pound, direction scrambles and the submission tap battle. Five AI styles
  with a difficulty dial. Replays from input logs (ready for online play later).
- **Fighters**: realistic bodies built from CC0 MakeHuman assets, generated from a seed: build, ethnic facial
  structure, face shape, skin tone, hair or buzz cut, stubble, tattoos, shorts and gloves. Bruising, swelling and
  sweat build up during a fight. Every move animated (about 50 clips), timed to land on the simulation's hit.
- **Arena**: six venues (back-street gym, county fair, nightclub, stadium, beach, rooftop), an eight-sided cage that
  fades where the camera looks through it, lighting rig with beams, a reacting crowd, broadcast camera with shake,
  punch-ins and slow motion on knockdowns.
- **Game**: hub, career (5 tiers x 10 fights + boss per weight class, then the title and defences), 48 original
  fighters with levels, training and stars, packs with odds, pity counters and a free daily pack, shop (gems, No Ads,
  Starter Pack, Season Pass, Champion Bundle), Season Pass track, daily login rewards, settings, save codes.
- **Money and platform**: Google Play purchases (grant once, acknowledge after saving, refunds revoke), AdMob with
  the consent form first (Google test ads until the owner's ids are set), interstitial pacing behind an "Ad break"
  card, rewarded "Watch ad" offers, Play Games, opt-in analytics, remote tuning.
- **Sound**: synthesised hits, blocks, whooshes, bell, crowd that follows the action, menu and pack sounds.

## Known gaps (next)
- Animation is keyframed by code; a licensed motion-capture pack (or Mixamo clips from the owner's account) would
  make it look closer to a console game. Ground and submission poses are the roughest.
- Performance has been checked only in a software-rendered browser; a real-phone pass (mid and low end) is needed.
- Store listing: six screenshots from the real game are in `docs/store/` (`node scripts/store.mjs` remakes them);
  the feature graphic (`docs/feature-graphic.png`) is made the same way. Still to make: a short video.
- Owner tasks: Play Console app `com.danielspurr.cagekings`, products (`no_ads`, `starter_pack`, `season_pass`,
  `gems_1`..`gems_5`, `bundle_champion`), AdMob app and ad units, Play Games leaderboards ("Best win", "Wins", "Knockouts"),
  an upload keystore and the four `ANDROID_KEY*` secrets, privacy policy hosting, content rating questionnaire,
  Data safety form, closed test (12 testers, 14 days).
