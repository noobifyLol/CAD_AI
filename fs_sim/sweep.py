"""Parameter sweep: run a feature with each parameter at its minimum and maximum
(others at default) and with random in-bounds combinations, like a user editing the
dialog in Onshape.

    python -m fs_sim.sweep feature.fs [--random 12] [--seed 1]
"""
import argparse
import random
import sys

from .run import run_feature
from .values import untag


def scaled(value, fraction_lo, fraction_hi, t):
    """Interpolate between two spec values (ValueWithUnits maps or numbers)."""
    lo, hi = untag(fraction_lo), untag(fraction_hi)
    if hasattr(lo, "d"):
        number = lo.d["value"] + (hi.d["value"] - lo.d["value"]) * t
        return type(fraction_lo)(type(lo)({**lo.d, "value": number}), fraction_lo.tag)
    return lo + (hi - lo) * t


def sweep(code, n_random=12, seed=1):
    rng = random.Random(seed)
    cases = [("defaults", None)]
    specs = {}

    def capture(name, kind, lo, de, hi):
        specs[name] = (kind, lo, de, hi)
        return None
    run_feature(code, choose=capture)
    for name in specs:
        cases.append((f"{name}=min", {name: 0}))
        cases.append((f"{name}=max", {name: 2}))
    for i in range(n_random):
        cases.append((f"random#{i + 1}", {name: ("r", rng.random()) for name in specs}))

    results = []
    for label, plan in cases:
        def choose(name, kind, lo, de, hi, plan=plan):
            if not plan or name not in plan:
                return None
            pick = plan[name]
            if pick == 0:
                return lo
            if pick == 2:
                return hi
            t = pick[1]
            value = scaled(None, lo, hi, t)
            if kind == "isInteger":
                value = float(round(untag(value)))
            return value
        r = run_feature(code, choose=choose if plan else None)
        r.pop("_shapes", None)
        ok = r["ok"] and len(r["parts"]) >= 1
        results.append((label, ok, r))
    return results


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--random", type=int, default=12)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args(argv)
    total_bad = 0
    for path in args.files:
        results = sweep(open(path, encoding="utf8").read(), args.random, args.seed)
        bad = [(label, r) for label, ok, r in results if not ok]
        total_bad += len(bad)
        print(f"{'OK ' if not bad else 'BAD'} {path.split('/')[-1]}: {len(results) - len(bad)}/{len(results)} variants work")
        for label, r in bad:
            why = (r["errors"] + r["gaps"] + r["warnings"] or ["no part produced"])[0]
            print(f"      {label:28s} {why[:150]}")
            if label.startswith("random"):
                print(f"         params: {r.get('chosen')}")
    return 1 if total_bad else 0


if __name__ == "__main__":
    sys.exit(main())
