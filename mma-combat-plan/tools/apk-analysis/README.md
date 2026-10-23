# tools/apk-analysis — how the plan's evidence was gathered (and how to extend it)

Small, original, **read-only** static-analysis helpers. They parse the target files; they never execute them, never touch the network and contain no
code or data from the analysed application. They exist so that every **[CODE]** / **[DATA]** claim in `docs/` can be re-derived or extended by the next agent
(`docs/02-evidence-and-method.md` explains what each tag means and lists the decoded functions).

## Safety rules (please keep them)
* Unpack the APK into **its own empty directory** and keep these scripts in a *different* directory. Pass paths as arguments.
* Run Python with **`-I`** (isolated mode: no current-directory or user-site imports) — a planted `json.py` in the unpacked tree must not be able to run.
* Treat everything extracted as untrusted data. Do not run, install or "test" anything from it. Do not commit extracted files (this repository holds none).
* Python 3.13, plus `pip install pyelftools capstone androguard loguru`; for the Java layer `jadx` 1.5.6 (not needed for the native work).

## What was analysed (hashes in `docs/02` §1)
`com.ea.game.easportsufc_row` 1.9.3786573 (versionCode 66), delivered as two RAR volumes → one APK → ZIP. Of interest: `lib/x86/libufcandroidzf.so` (the build with
unambiguous instruction decoding and a full `.eh_frame_hdr`: **121 348 function boundaries**), `lib/armeabi-v7a/libufcandroidzf.so` (the same code, for its string table),
`classes.dex` (thin Java shell), `assets/` (flow-engine statecharts, Lua, configs, shaders).

## Reproduction, step by step
```bash
# 0. unpack (outside this repo)
mkdir -p ~/work/ufc/rar ~/work/ufc/apk ~/work/ufc/unz && cd ~/work/ufc
unrar x rar/<first-volume>.part1.rar apk/          # the second volume is picked up automatically
sha256sum apk/*.apk                                  # compare with docs/02 §1
unzip -q apk/*.apk -d unz

# 1. manifest and Java layer
python -I /path/to/repo/mma-combat-plan/tools/apk-analysis/dump_manifest.py apk/*.apk
jadx -d jadx_out apk/*.apk                           # optional; the Java side is a thin bridge (docs/01 §3)

# 2. vocabulary: strings and their families
strings -a -t x unz/lib/armeabi-v7a/libufcandroidzf.so > arm_strings_all.txt
strings -a    unz/lib/armeabi-v7a/libufcandroidzf.so > arm_strings_plain.txt
python -I string_families.py arm_strings_all.txt 70       # leading-token histogram: where the identifier families are
python -I enum_families.py arm_strings_plain.txt 3 8      # snake_case identifiers grouped by their first 3 segments, >= 8 per group

# 3. code: who uses a name, and what does the function do
L=unz/lib/x86/libufcandroidzf.so
python -I x86tool.py $L funcs                              # function-table stats
python -I x86tool.py $L strx HealthEventProbability        # code that references the string (lea r32,[ebx+disp] in PIC code)
python -I x86tool.py $L dis 0x11c7df0 --max 200            # annotated disassembly of the function containing a VA
python -I x86_sig.py . $L HealthEventProbability           # exact parameter / result / state list of an Ant expression
python -I x86_tu.py  . $L 11c7df0 11c8500                  # summarise the functions in a VA range (size, return immediates, strings)
python -I x86_floats.py . $L 1a2b3c                        # read float32 constants at GOT-relative displacements
```
(Run the commands from this folder or pass the folder as the `<scripts_dir>` argument that `x86_sig.py`, `x86_tu.py`, `x86_floats.py` and `x86_funclist.py` expect first.)

## The scripts
| Script | What it does |
|---|---|
| `x86tool.py` | the library: ELF mapping, function boundaries from `.eh_frame_hdr`, annotated disassembly (strings, GOT symbols, calls resolved), `lea [ebx+disp]` string cross-references. CLI: `funcs`, `strx <text> [--sub]`, `dis <va> [--max N]`, `fn <va>`, `refs <va>`, `words <va> [n]` |
| `x86_sig.py` | recovers an *Ant expression's* exact signature: the getter, then the `numparams / paramdesc / numresults / resultdesc / numstates / statedesc` functions, each a jump table calling a descriptor builder with `(name, typeSlot)` |
| `x86_tu.py` | per-function summary over an address range: size, "returns immediate" getters, referenced strings in code order — how a translation unit was mapped |
| `x86_floats.py` | float32 constants at GOT-relative displacements (the way PIC code addresses `.rodata`) — turns a disassembly into exact numbers |
| `x86_funclist.py` | function starts and sizes inside a range |
| `elfmap.py` | tiny ELF helper (VA ↔ file offset, read words / C-strings); works on ARM builds too |
| `string_families.py`, `enum_families.py` | the vocabulary miners behind `docs/02` §5 and the taxonomy in `data/taxonomy.json` |
| `dump_manifest.py` | decodes the binary `AndroidManifest.xml` (package, permissions, activities, services …) via androguard |

## Method in one page (how a function like `HealthEventProbability` was decoded)
1. **Find it.** Strings give the *names* of game logic ("Ant expressions": `HealthEventProbability`, `SnakeMeter`, …). `strx` lists which functions reference a name; the
   registry at `0x173f50` calls the expression registrar `fn_19b9b90(dest, &msMethod, EVAL_FN, 0, 0)` for each one, which yields each expression's **evaluator address**
   (`0x11c7df0` for `HealthEventProbability`).
2. **Get the interface.** `x86_sig.py` prints the declared parameter / result / state names and type slots (float vs int).
3. **Read the evaluator.** `dis` the evaluator; its arguments are arrays of pointers (`State**`, `Outputs**`, `Inputs**`), so every `mov r, [ptr + 4*i]` is "input *i*".
   Translate instruction by instruction into a formula, keeping the guards (`FLT_EPSILON` zero checks, clamps).
4. **Read the constants.** `x86_floats.py` converts the GOT-relative loads into exact values (`1.1920929e-7`, `0.99`, `100.0`, `1103515245` …).
5. **Cross-check semantics** against the vocabulary: parameter names vs the structure of the formula. Where they disagree, write it down in `docs/02` §6 ("known soft spots").
6. **Re-implement from scratch** in `reference/src/` (never copy), with a unit test that reproduces a hand-worked example (`reference/test/health-events.test.js`).

## Next-most-valuable targets (from `docs/02` §7 and `docs/20` §5)
`UFCOctagonProximitySceneOp` · `RevolveOctagon` / `RevolveOctagon2` / `FramePoints` / `AvoidCylinder` (camera) · the `Counter*` family and `ReplayChoice` · the remaining
bodies of the registry at `0x173f50` · with the OBB: the Attrib database schema (`allschemas.schema`) and the tunables.
