"""Read float32 constants at GOT-relative displacements: x86_floats.py <scripts_dir> <lib> <hexdisp>[ ...]  (disp is subtracted: GOT - disp)"""
import struct, sys
sys.path.insert(0, sys.argv[1])
from x86tool import X86Lib
lib = X86Lib(sys.argv[2])
for a in sys.argv[3:]:
    neg = a.startswith('-')
    d = int(a.lstrip('-'), 16)
    va = lib.got + d if neg else lib.got - d
    w = lib.u32(va)
    f = struct.unpack('<f', struct.pack('<I', w))[0]
    print(f"GOT{'+' if neg else '-'}{d:#x} = {va:#x}: raw={w:#010x} float={f!r}")
