"""
x86tool.py - small static-analysis helper for the 32-bit x86 PIC build of a stripped Android .so.

Original analysis tooling. It reads (never executes) the target library.

Commands
  funcs                      print function-table stats (from .eh_frame_hdr)
  strx  <text> [--sub]       find .rodata strings equal to <text> (or containing it with --sub) and
                             list code locations that reference them via  lea r32,[ebx+disp32]
  dis   <va> [--max N]       disassemble the function containing <va> (annotated)
  fn    <va>                 print function start/end containing <va>
  refs  <va>                 list code locations that reference <va> via lea [ebx+disp]
  words <va> [n]             dump n 32-bit words at <va> (resolves relocations if in .data.rel.ro)

Usage:  python -I x86tool.py <lib.so> <command> [args]
"""
import bisect
import re
import struct
import sys

from capstone import CS_ARCH_X86, CS_MODE_32, Cs
from elftools.elf.elffile import ELFFile
from elftools.elf.relocation import RelocationSection


class X86Lib:
    def __init__(self, path):
        self.path = path
        with open(path, 'rb') as f:
            self.data = f.read()
        self.elf = ELFFile(open(path, 'rb'))
        self.secs = {s.name: s for s in self.elf.iter_sections()}
        self.loads = [(s['p_vaddr'], s['p_offset'], s['p_filesz'], s['p_memsz'])
                      for s in self.elf.iter_segments() if s['p_type'] == 'PT_LOAD']
        dyn = self.secs['.dynamic']
        self.got = None
        for t in dyn.iter_tags():
            if t.entry.d_tag == 'DT_PLTGOT':
                self.got = t.entry.d_val
        text = self.secs['.text']
        self.text_lo, self.text_hi = text['sh_addr'], text['sh_addr'] + text['sh_size']
        ro = self.secs['.rodata']
        self.ro_lo, self.ro_hi = ro['sh_addr'], ro['sh_addr'] + ro['sh_size']
        self._funcs = None
        self._exports = None
        self._got_syms = None
        self._plt = None

    # ---- address mapping -------------------------------------------------
    def off(self, va):
        for v, o, fs, ms in self.loads:
            if v <= va < v + fs:
                return o + (va - v)
        return None

    def u32(self, va):
        o = self.off(va)
        return None if o is None else struct.unpack_from('<I', self.data, o)[0]

    def cstr(self, va, maxlen=300):
        o = self.off(va)
        if o is None:
            return None
        e = self.data.find(b'\0', o, o + maxlen)
        if e < 0:
            return None
        raw = self.data[o:e]
        try:
            s = raw.decode('utf-8')
        except UnicodeDecodeError:
            return None
        if s and all(c.isprintable() or c in '\t\n' for c in s):
            return s
        return None

    # ---- function table ---------------------------------------------------
    @property
    def funcs(self):
        if self._funcs is None:
            sec = self.secs['.eh_frame_hdr']
            base = sec['sh_addr']
            o = sec['sh_offset']
            ver, ptr_enc, cnt_enc, tab_enc = struct.unpack_from('BBBB', self.data, o)
            assert ver == 1 and tab_enc == 0x3B, (ver, ptr_enc, cnt_enc, tab_enc)
            count = struct.unpack_from('<I', self.data, o + 8)[0]
            starts = []
            p = o + 12
            for i in range(count):
                loc, _fde = struct.unpack_from('<ii', self.data, p + 8 * i)
                starts.append((base + loc) & 0xFFFFFFFF)
            starts.sort()
            self._funcs = starts
        return self._funcs

    def func_of(self, va):
        i = bisect.bisect_right(self.funcs, va) - 1
        if i < 0:
            return None
        start = self.funcs[i]
        end = self.funcs[i + 1] if i + 1 < len(self.funcs) else self.text_hi
        return start, end

    # ---- symbols ----------------------------------------------------------
    @property
    def exports(self):
        """address -> demangled-or-raw name for defined dynsym entries"""
        if self._exports is None:
            ex = {}
            for s in self.secs['.dynsym'].iter_symbols():
                if s['st_shndx'] != 'SHN_UNDEF' and s['st_value']:
                    ex.setdefault(s['st_value'], s.name)
            self._exports = ex
        return self._exports

    @property
    def got_syms(self):
        """GOT slot VA -> symbol name (from R_386_GLOB_DAT / JUMP_SLOT)"""
        if self._got_syms is None:
            m = {}
            dynsym = self.secs['.dynsym']
            for sname in ('.rel.dyn', '.rel.plt'):
                rel = self.secs[sname]
                for r in rel.iter_relocations():
                    t = r['r_info_type']
                    if t in (6, 7):  # GLOB_DAT, JUMP_SLOT
                        sym = dynsym.get_symbol(r['r_info_sym'])
                        m[r['r_offset']] = sym.name
            self._got_syms = m
        return self._got_syms

    @property
    def plt(self):
        """plt stub VA -> import name"""
        if self._plt is None:
            m = {}
            plt = self.secs['.plt']
            base = plt['sh_addr']
            o = plt['sh_offset']
            # stubs are 16 bytes: jmp *[ebx+disp] / jmp *abs ; resolve via the GOT slot used
            for i in range(0, plt['sh_size'], 16):
                b = self.data[o + i:o + i + 16]
                # jmp dword ptr [ebx+disp32] = FF A3 disp32
                if len(b) >= 6 and b[0] == 0xFF and b[1] == 0xA3:
                    disp = struct.unpack_from('<i', b, 2)[0]
                    slot = (self.got + disp) & 0xFFFFFFFF
                    m[base + i] = self.got_syms.get(slot, '?')
            self._plt = m
        return self._plt

    # ---- xref scan ---------------------------------------------------------
    _LEA_MODRM = (0x83, 0x8B, 0x93, 0x9B, 0xA3, 0xAB, 0xB3, 0xBB)

    def refs_to(self, target):
        """code VAs of `lea r32,[ebx+disp32]` instructions whose effective address == target"""
        disp = (target - self.got) & 0xFFFFFFFF
        pat = struct.pack('<I', disp)
        lo = self.off(self.text_lo)
        hi = lo + (self.text_hi - self.text_lo)
        out = []
        pos = lo
        while True:
            pos = self.data.find(pat, pos, hi)
            if pos < 0:
                break
            if pos >= 2 and self.data[pos - 2] == 0x8D and self.data[pos - 1] in self._LEA_MODRM:
                out.append(self.text_lo + (pos - 2 - lo))
            pos += 1
        return out

    def find_strings(self, text, sub=False):
        needle = text.encode()
        res = []
        lo = self.off(self.ro_lo)
        hi = lo + (self.ro_hi - self.ro_lo)
        pos = lo
        while True:
            pos = self.data.find(needle, pos, hi)
            if pos < 0:
                break
            va = self.ro_lo + (pos - lo)
            start = pos
            while start > lo and self.data[start - 1] != 0:
                start -= 1
            end = self.data.find(b'\0', pos)
            full = self.data[start:end]
            if sub or full == needle:
                if sub or start == pos:
                    res.append((self.ro_lo + (start - lo), full.decode('latin-1')))
            pos += 1
        return res

    # ---- disassembly --------------------------------------------------------
    def disasm(self, va, end=None, maxbytes=4096):
        f = self.func_of(va)
        if f is None:
            raise SystemExit('no function')
        start, fend = f
        if end is None:
            end = min(fend, start + maxbytes)
        o = self.off(start)
        code = self.data[o:o + (end - start)]
        md = Cs(CS_ARCH_X86, CS_MODE_32)
        md.detail = False
        lines = []
        for ins in md.disasm(code, start):
            note = ''
            m = re.search(r'\[ebx ([+-]) (0x[0-9a-f]+)\]', ins.op_str)
            if m:
                d = int(m.group(2), 16) * (1 if m.group(1) == '+' else -1)
                tgt = (self.got + d) & 0xFFFFFFFF
                if ins.mnemonic == 'lea':
                    s = self.cstr(tgt) if self.ro_lo <= tgt < self.ro_hi else None
                    if s is not None:
                        note = f'  ; str "{s[:70]}"'
                    elif tgt in self.exports:
                        note = f'  ; &{self.exports[tgt]}'
                    else:
                        note = f'  ; @{tgt:#x}'
                else:
                    if tgt in self.got_syms:
                        note = f'  ; GOT[{self.got_syms[tgt]}]'
                    else:
                        note = f'  ; @{tgt:#x}'
            if ins.mnemonic == 'call':
                try:
                    tgt = int(ins.op_str, 16)
                    nm = self.plt.get(tgt) or self.exports.get(tgt)
                    note = f'  ; {nm}' if nm else f'  ; fn_{tgt:x}'
                except ValueError:
                    pass
            lines.append(f'{ins.address:08x}: {ins.mnemonic:7s} {ins.op_str}{note}')
        return start, end, lines


def main():
    lib = X86Lib(sys.argv[1])
    cmd = sys.argv[2]
    if cmd == 'funcs':
        print('functions:', len(lib.funcs), 'GOT:', hex(lib.got))
    elif cmd == 'strx':
        sub = '--sub' in sys.argv
        text = [a for a in sys.argv[3:] if not a.startswith('--')][0]
        for va, s in lib.find_strings(text, sub):
            refs = lib.refs_to(va)
            fl = sorted({lib.func_of(r)[0] for r in refs})
            print(f'{va:08x} "{s[:80]}"  refs={len(refs)} funcs={[hex(x) for x in fl[:8]]}')
    elif cmd == 'refs':
        va = int(sys.argv[3], 16)
        for r in lib.refs_to(va):
            f = lib.func_of(r)
            print(f'{r:08x} in fn {f[0]:08x}')
    elif cmd == 'fn':
        va = int(sys.argv[3], 16)
        f = lib.func_of(va)
        print(f'{f[0]:08x} - {f[1]:08x} (size {f[1] - f[0]})')
    elif cmd == 'dis':
        va = int(sys.argv[3], 16)
        mx = int(sys.argv[sys.argv.index('--max') + 1]) if '--max' in sys.argv else 4096
        start, end, lines = lib.disasm(va, maxbytes=mx)
        print(f'; function {start:08x}-{end:08x}')
        print('\n'.join(lines))
    elif cmd == 'words':
        va = int(sys.argv[3], 16)
        n = int(sys.argv[4]) if len(sys.argv) > 4 else 8
        for i in range(n):
            a = va + 4 * i
            w = lib.u32(a)
            print(f'{a:08x}: ' + ('(bss)' if w is None else f'{w:08x}'))
    else:
        print(__doc__)


if __name__ == '__main__':
    main()
