# Releases

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
- **Money and platform**: Google Play purchases (grant once, acknowledge after saving, refunds revoke; the Champion
  Bundle's fighter, Mateo Lozano, comes with it and goes with a refund), save codes and cloud copies never carry paid
  items, a reward clock that moving the phone's date can't cheat, AdMob with
  the consent form first (Google test ads until the owner's ids are set), interstitial pacing behind an "Ad break"
  card, rewarded "Watch ad" offers, Play Games, opt-in analytics, remote tuning.
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
  low graphics after a graphics crash.
- **Sound**: synthesised hits, blocks, whooshes, bell, crowd that follows the action, menu and pack sounds.

## Known gaps (next)
- Fixed before release (found by checking every platform piece is connected): interstitials could never show
  (launches were not counted), the cloud save could upload before reading, the Champion Bundle's fighter was
  missing, save codes could carry paid items, the clock protection was off.
- Animation is keyframed by code; a licensed motion-capture pack (or Mixamo clips from the owner's account) would
  make it look closer to a console game. Ground and submission poses are the roughest.
- Performance has been checked only in a software-rendered browser; a real-phone pass (mid and low end) is needed.
- Store listing assets: screenshots and a short video from the real game; the feature graphic is a placeholder.
- Owner tasks: Play Console app `com.danielspurr.cagekings`, products (`no_ads`, `starter_pack`, `season_pass`,
  `gems_1`..`gems_5`, `bundle_champion`), AdMob app and ad units, Play Games leaderboards (weekly, wins, knockouts),
  an upload keystore and the four `ANDROID_KEY*` secrets, privacy policy hosting, content rating questionnaire,
  Data safety form, closed test (12 testers, 14 days).
