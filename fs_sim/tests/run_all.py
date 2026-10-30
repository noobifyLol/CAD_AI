"""Simulator test suite: run with `npm run test:sim` (or python -m fs_sim.tests.run_all [corpus_dir]).

1. Mutation tests: known Onshape mistakes must be rejected.
2. Every library example in data/fs_examples must build exactly one solid part.
3. Every example must still build with each parameter at its min and its max.
4. Every FeatureScript in the optional corpus dir (generator outputs dumped by the
   Node tests with FS_DUMP_DIR) must build, and survive the same min/max sweep.
"""
import glob
import os
import sys

from fs_sim.run import run_feature
from fs_sim.sweep import sweep
from fs_sim.tests import mutations

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def check_files(files, label):
    failures = 0
    for path in files:
        name = os.path.basename(path)
        code = open(path, encoding="utf8").read()
        result = run_feature(code)
        result.pop("_shapes", None)
        if not (result["ok"] and len(result["parts"]) == 1):
            failures += 1
            why = (result["errors"] + result["gaps"] + [f"{len(result['parts'])} parts"])[0]
            print(f"FAIL {label} {name}: {why}")
            continue
        bad = [(case, r) for case, ok, r in sweep(code, n_random=0) if not ok]
        if bad:
            failures += 1
            case, r = bad[0]
            print(f"FAIL {label} {name}: {case} -> {(r['errors'] + r['gaps'] + ['no part'])[0][:160]}")
        else:
            part = result["parts"][0]
            print(f"PASS {label} {name}: {part['size_in']} in, {part['volume_in3']} in^3, min/max of every parameter OK")
    return failures


def main():
    failures = 0
    print("== mutation tests")
    failures += mutations.main()
    print("\n== library examples")
    failures += check_files(sorted(glob.glob(os.path.join(ROOT, "data", "fs_examples", "*.fs"))), "example")
    if len(sys.argv) > 1 and os.path.isdir(sys.argv[1]):
        print("\n== generated corpus")
        failures += check_files(sorted(glob.glob(os.path.join(sys.argv[1], "*.fs"))), "generated")
    print("\nALL SIMULATOR CHECKS PASSED" if not failures else f"\n{failures} SIMULATOR CHECK(S) FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
