"""Tiny ELF helper: VA<->file-offset, read words/strings. Usage: python -I elfmap.py <lib> <hexVA> [nwords]"""
import sys, struct
from elftools.elf.elffile import ELFFile

class Lib:
    def __init__(self, path):
        self.f = open(path, 'rb')
        self.elf = ELFFile(self.f)
        self.loads = [(s['p_vaddr'], s['p_offset'], s['p_filesz'], s['p_memsz'], s['p_flags'])
                      for s in self.elf.iter_segments() if s['p_type'] == 'PT_LOAD']
        self.sections = {s.name: (s['sh_addr'], s['sh_offset'], s['sh_size']) for s in self.elf.iter_sections()}
        self.data = open(path, 'rb').read()
    def off(self, va):
        for v, o, fs, ms, fl in self.loads:
            if v <= va < v + fs:
                return o + (va - v)
        return None
    def u32(self, va):
        o = self.off(va)
        return None if o is None else struct.unpack_from('<I', self.data, o)[0]
    def cstr(self, va, maxlen=200):
        o = self.off(va)
        if o is None: return None
        e = self.data.find(b'\0', o, o + maxlen)
        if e < 0: return None
        b = self.data[o:e]
        try: s = b.decode('ascii')
        except UnicodeDecodeError: return None
        return s if s and all(32 <= ord(c) < 127 for c in s) else None
    def section_of(self, va):
        for n, (a, o, s) in self.sections.items():
            if a and a <= va < a + s:
                return n
        return None

if __name__ == '__main__':
    lib = Lib(sys.argv[1]); va = int(sys.argv[2], 16); n = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    for i in range(n):
        a = va + 4 * i
        w = lib.u32(a)
        sec = lib.section_of(w) if w else None
        s = lib.cstr(w) if w and sec in ('.rodata', '.data', '.data.rel.ro') else None
        print(f"  [{a:08x}] = {w:08x}  sec={sec}  str={s!r}")
