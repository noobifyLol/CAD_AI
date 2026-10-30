# fs_sim — offline FeatureScript simulator

`fs_sim` runs an Onshape custom feature the way a Part Studio does, without Onshape:

- **Real Onshape standard library.** The interpreter executes Onshape's own `std`
  FeatureScript (v2960, MIT-licensed, fetched by `fetch_std.sh`). That covers unit
  arithmetic, vectors, planes, queries, sketch helpers, every precondition and
  bound check, and `regenError` handling. So a unit mismatch, a failed
  `isLength` precondition or `PARAMETER_OUT_OF_RANGE` fails exactly where Onshape
  fails, with Onshape's own message.
- **OpenCascade geometry kernel** (`geom.py`) for the native operations Onshape
  runs in Parasolid:
  - sketches: lines, arcs, circles, splines, ellipses and region solving
  - `opExtrude`, `opRevolve`, `opLoft`, `opSweep`, `opBoolean`, `opPattern`,
    `opShell`, `opFillet`, `opChamfer`, `opTransform`, `opDeleteBodies`
  - query evaluation, with "created by" provenance merged the way
    Onshape documents it
- **Dialog defaults.** Each parameter gets the value Onshape would give it when the
  feature is first added: the bound-spec default, the `Default` annotation, an empty
  query, `false`, or the first enum value.

It is a simulator, not Onshape. Parasolid and OpenCascade can still disagree on
hard geometry, and operations it doesn't implement are reported as *gaps*, never as
errors in your code. Within that scope it catches what the static validator can't:
code that parses but fails when it runs.

## Use

```bash
pip install -r fs_sim/requirements.txt     # Python 3.11+; needs libGL/libX11 on Linux
bash fs_sim/fetch_std.sh                   # Onshape std library -> fs_sim/std
python -m fs_sim.run data/fs_examples/wheel_with_spokes.fs --png wheel.png
python -m fs_sim.sweep data/fs_examples/*.fs --random 10   # every parameter at min/max + random combos
npm run test:sim                           # whole suite (mutations, examples, generator outputs)
```

The web app uses it automatically when `FS_SIM_PYTHON` points at a Python with these
packages (the Dockerfile sets this up):

- `/verify` and the website's *Verify* button execute the feature and show a rendered
  preview.
- Without Onshape API keys, the AI generate → test → fix loop feeds simulator errors
  back to the model for repair.

## Layout

| File | Purpose |
| --- | --- |
| `lexer.py`, `parser.py` | FeatureScript tokenizer and parser (parses all 268 std modules) |
| `interp.py`, `values.py` | Interpreter: value semantics, type tags, overloads, operators, preconditions |
| `natives.py` | Non-geometric `@builtins` (math, containers, strings, regex, matrices) |
| `geom.py` | Context, bodies, provenance, queries, sketch solving, operations (OpenCascade) |
| `run.py` | Builds the dialog definition and runs a feature; CLI |
| `sweep.py` | Parameter sweep (min/max per parameter + random in-bounds combinations) |
| `render.py` | Two-view PNG preview and STL export |
| `worker.py` | Long-lived JSON-lines worker used by `../simulatorClient.js` |
| `tests/` | Mutation tests and the full suite |
