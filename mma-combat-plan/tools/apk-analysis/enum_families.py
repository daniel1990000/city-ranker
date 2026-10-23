"""Group lowercase snake_case identifiers (>=3 segments) by their first N segments."""
import sys, re, collections
path, nseg, minc = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
rx = re.compile(r'^[a-z][a-z0-9]*(?:_[a-z0-9]+){2,}$')
fam = collections.defaultdict(set)
for line in open(path, encoding='utf-8', errors='replace'):
    s = line.strip()
    if rx.match(s) and not s.startswith(('basetypes_', 'assetlist_', 'dynassetlist_', 'standup_', 'strike_', 'submission_')):
        key = '_'.join(s.split('_')[:nseg])
        fam[key].add(s)
rows = sorted(fam.items(), key=lambda kv: -len(kv[1]))
for k, v in rows:
    if len(v) >= minc:
        ex = sorted(v)[:3]
        print(f"{len(v):5d}  {k:40s} e.g. {', '.join(e[len(k)+1:] for e in ex)}")
