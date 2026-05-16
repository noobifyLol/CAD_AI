# Onshape Document And Deployed App

Sources:
- https://cad.onshape.com/documents/c1fbbbb30348e3d729c9e329/w/f462715c39b4372c5d5dfb96/e/cc63f85d51cb344ad9ede672
- https://cad-ai-0o9s.onrender.com
- Local FeatureScript docs: `old_and_docs/docs/FS doc/`

- Modeling patterns: the public Onshape URL was treated as a target validation environment, but no authenticated compiler API was available in this session. Local FeatureScript docs were used as the syntax source of truth.
- Recommended primitives: FS 2931 examples use `geometry.fs`, `newSketchOnPlane`, `skSolve`, `opRevolve`, `opLoft` with `profileSubqueries`, `opSweep`, `opShell`, `opFillet`, `opChamfer`, and `opBoolean`.
- Failure modes: missing `skSolve`, wrong `qSketchRegion` argument, revolve axis as Query, invalid opLoft keys, shell before body creation, and hidden hardcoded parameters.
- Example shapes and ranges: organic carrot, square-to-circle loft, 90-degree pipe elbow, open-top enclosure, fillet/chamfer blocks, airfoil, vase, bottle, flange, and hybrid organic/mechanical part.
- Implementation pulled into repo: `data/fs_examples/*.fs` provides validated templates and `/agent/run` returns traceable code plus static validation output.
