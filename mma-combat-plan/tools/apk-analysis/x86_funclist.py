import sys
sys.path.insert(0, sys.argv[1])
from x86tool import X86Lib
lib = X86Lib(sys.argv[2]); lo = int(sys.argv[3], 16); hi = int(sys.argv[4], 16)
fs = [f for f in lib.funcs if lo <= f < hi]
for i, f in enumerate(fs):
    nxt = fs[i + 1] if i + 1 < len(fs) else hi
    print(f"{f:08x} size={nxt - f:5d}")
