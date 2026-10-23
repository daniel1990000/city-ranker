"""Group strings (from `strings -t x` output) by leading token to see data families."""
import sys, re, collections
path = sys.argv[1]
fam = collections.Counter()
examples = {}
for line in open(path, encoding='utf-8', errors='replace'):
    line = line.rstrip('\n')
    m = re.match(r'\s*([0-9a-f]+) (.*)$', line)
    if not m:
        continue
    off, s = m.group(1), m.group(2)
    if s.startswith('_ZN') or s.startswith('_ZT') or s.startswith('_Z'):
        key = '_Z (mangled)'
    else:
        mm = re.match(r'^([A-Za-z0-9]+)[_:.\- /]', s)
        key = mm.group(1).lower() if mm else '(other)'
        if len(key) > 24: key = key[:24]
    fam[key] += 1
    examples.setdefault(key, s[:90])
for k, v in fam.most_common(int(sys.argv[2]) if len(sys.argv) > 2 else 70):
    print(f"{v:6d}  {k:26s} e.g. {examples[k]}")
