"""Summarise functions in a VA range: size, 'return imm' value, and referenced .rodata strings (code order).
   usage: x86_tu.py <scripts_dir> <lib> <lo_hex> <hi_hex>"""
import re, sys
sys.path.insert(0, sys.argv[1])
from x86tool import X86Lib
lib = X86Lib(sys.argv[2]); lo = int(sys.argv[3], 16); hi = int(sys.argv[4], 16)
fs = [f for f in lib.funcs if lo <= f < hi]
for i, f in enumerate(fs):
    end = fs[i + 1] if i + 1 < len(fs) else hi
    start, end2, lines = lib.disasm(f, end=end)
    strs = []
    ret_imm = None
    for ln in lines[:3]:
        m = re.search(r'mov\s+eax, (0x[0-9a-f]+|\d+)$', ln)
        if m: ret_imm = int(m.group(1), 0)
    for ln in lines:
        m = re.search(r'; str "(.*)"$', ln)
        if m: strs.append(m.group(1))
    tag = f'returns {ret_imm}' if (ret_imm is not None and end - f <= 16) else ''
    print(f"{f:08x} size={end - f:5d} {tag} {('strings=' + repr(strs)) if strs else ''}")
