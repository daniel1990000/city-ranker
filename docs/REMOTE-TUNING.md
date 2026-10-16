# Remote tuning

Some numbers can change without an app update: the game reads a small JSON file from the owner's website at start-up
(URL from the `REMOTE_CONFIG_URL` repository secret, baked in at build time). Unknown keys and values outside the safe
ranges are ignored, so a typo can never break the game or take away something a player paid for.

Example `tuning.json` (every key is optional):

```json
{
  "adMinPlaySec": 600,
  "adCooldownSec": 240,
  "adEveryFights": 3,
  "doubleCashCap": 5000,
  "gemPacks": { "gems_1": 100, "gems_2": 550, "gems_3": 1200, "gems_4": 2600, "gems_5": 7000 },
  "starterGems": 500,
  "starterCash": 10000,
  "seasonFightXpCap": 150,
  "seasonDayXpCap": 600,
  "paidPacksBlockedCountries": ["BE"]
}
```

| key | what it does | allowed |
|---|---|---|
| `adMinPlaySec` | no interstitial before this much fight time (all sessions) | 0 – 7200 |
| `adCooldownSec` | minimum seconds between interstitials | 60 – 3600 |
| `adEveryFights` | at most one interstitial every N fights | 1 – 20 |
| `doubleCashCap` | most cash a "Watch ad: double cash" can add | 500 – 10,000,000 |
| `gemPacks` | gems in each bundle (never below half the launch size) | 50 % – 100x |
| `starterGems` / `starterCash` | what a new Starter Pack sale adds | 100+ / 1000+ |
| `seasonFightXpCap` / `seasonDayXpCap` | season xp per fight / per day from fights | 10 – 5000 / 100 – 100,000 |
| `paidPacksBlockedCountries` | Play Store countries where packs bought with gems are off (Belgium always stays) | 2-letter codes |

Host the file with `Content-Type: application/json` and CORS allowing the app (`Access-Control-Allow-Origin: *` is
fine: it holds nothing secret). The game keeps the last good copy and falls back to the built-in defaults.
