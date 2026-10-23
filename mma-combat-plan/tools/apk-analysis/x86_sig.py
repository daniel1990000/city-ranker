"""
x86_sig.py - recover the exact (index -> name, type-slot) signature of an Ant expression from the x86 build.

An expression's translation unit has this function layout (observed):
    getter (refs the expression name), numparams, paramdesc, noop, numresults, resultdesc, numstates, statedesc, ...
Each *desc function switches on an index (jump table) and calls a descriptor builder with (name, typeSlot, ...).

usage: x86_sig.py <scripts_dir> <lib.so> <ExpressionName> [<ExpressionName> ...]
"""
import re
import struct
import sys

sys.path.insert(0, sys.argv[1])
from x86tool import X86Lib  # noqa: E402

LINE = re.compile(r'^([0-9a-f]{8}): (\S+)\s*(.*)$')


def parse_lines(lib, fva):
    start, end, lines = lib.disasm(fva)
    out = []
    for ln in lines:
        m = LINE.match(ln)
        if not m:
            continue
        addr = int(m.group(1), 16)
        rest = m.group(3)
        note = ''
        if ';' in rest:
            rest, note = rest.split(';', 1)
        out.append((addr, m.group(2), rest.strip(), note.strip()))
    return out


def ebx_base(ins):
    for i, (a, mn, op, note) in enumerate(ins):
        if mn == 'pop' and op == 'ebx' and i > 0 and ins[i - 1][1] == 'call':
            m = re.match(r'add\s+ebx, (0x[0-9a-f]+)', f'{ins[i + 1][1]} {ins[i + 1][2]}')
            if m:
                return (a + int(m.group(1), 16)) & 0xFFFFFFFF
    return None


def case_info(ins, start_addr, max_ins=14):
    """first string ref (and the type slot loaded just before it) at/after start_addr"""
    idxs = [i for i, x in enumerate(ins) if x[0] >= start_addr]
    if not idxs:
        return None, None
    i0 = idxs[0]
    slot = None
    for k in range(i0, min(i0 + max_ins, len(ins))):
        a, mn, op, note = ins[k]
        if mn == 'lea' and note.startswith('@'):
            slot = int(note[1:], 16)
        m = re.match(r'str "(.*)"$', note)
        if m:
            return m.group(1), slot
    return None, slot


def describe(lib, fva):
    ins = parse_lines(lib, fva)
    base = ebx_base(ins)
    jt = None
    for i, (a, mn, op, note) in enumerate(ins):
        m = re.match(r'dword ptr \[ebx \+ eax\*4 - (0x[0-9a-f]+)\]', op)
        if mn == 'mov' and m is None:
            m2 = re.match(r'eax, dword ptr \[ebx \+ eax\*4 - (0x[0-9a-f]+)\]', op)
            if m2:
                jt = int(m2.group(1), 16)
        # normal form: "eax, dword ptr [ebx + eax*4 - 0x...]"
    n = None
    for a, mn, op, note in ins:
        m = re.match(r'eax, (0x[0-9a-f]+)$', op)
        if mn == 'cmp' and m:
            n = int(m.group(1), 16)
            break
    res = []
    if jt is not None and base is not None and n is not None:
        table = (base - jt) & 0xFFFFFFFF
        for idx in range(n + 1):
            ent = lib.u32(table + 4 * idx)
            case = (base + ent) & 0xFFFFFFFF
            name, slot = case_info(ins, case)
            res.append((idx, name, slot))
    else:
        # linear: collect all str refs in order, with the nearest preceding type slot
        slot = None
        for a, mn, op, note in ins:
            if mn == 'lea' and note.startswith('@'):
                slot = int(note[1:], 16)
            m = re.match(r'str "(.*)"$', note)
            if m:
                res.append((len(res), m.group(1), slot))
    return res


def ret_imm(lib, fva):
    ins = parse_lines(lib, fva)
    for a, mn, op, note in ins[:3]:
        m = re.match(r'eax, (0x[0-9a-f]+|\d+)$', op)
        if mn == 'mov' and m:
            return int(m.group(1), 0)
    return None


def signature(lib, name):
    refs = [va for va, s in lib.find_strings(name)]
    getter = None
    for va in refs:
        for r in lib.refs_to(va):
            f, e = lib.func_of(r)
            if e - f <= 160:  # the small static getter
                getter = f
    if getter is None:
        return None
    i = lib.funcs.index(getter)
    fs = lib.funcs
    return {
        'getter': getter,
        'numparams': ret_imm(lib, fs[i + 1]),
        'params': describe(lib, fs[i + 2]),
        'numresults': ret_imm(lib, fs[i + 4]),
        'results': describe(lib, fs[i + 5]),
        'numstates': ret_imm(lib, fs[i + 6]),
        'states': describe(lib, fs[i + 7]),
    }


if __name__ == '__main__':
    lib = X86Lib(sys.argv[2])
    for nm in sys.argv[3:]:
        sig = signature(lib, nm)
        if not sig:
            print(nm, ': getter not found')
            continue
        print(f"=== {nm}  (getter {sig['getter']:#x})")
        for key in ('params', 'results', 'states'):
            cnt = sig['num' + key]
            print(f"  {key} (declared {cnt}):")
            for idx, name, slot in sig[key]:
                print(f"    [{idx:2d}] {name}   type_slot={slot:#x}" if slot else f"    [{idx:2d}] {name}")
