# Onshape Document

Source: https://cad.onshape.com/documents/c1fbbbb30348e3d729c9e329/w/f462715c39b4372c5d5dfb96/e/cc63f85d51cb344ad9ede672

- Modeling patterns: this source is a live Onshape document, so access may require account permissions; local FeatureScript docs are used as the reliable API reference.
- Recommended primitives: FeatureScript 2931 with geometry.fs import, editable preconditions, solved sketches, and standard operations.
- Failure modes: browser-only or permission-gated CAD documents cannot be used as unattended import sources; store reusable code snippets locally instead.
- Example shapes: use local FS examples for carrot revolve, loft transition, sweep elbow, shell enclosure, fillet/chamfer, hybrid flange, vase, and airfoil.
- Implementation notes: `/generate` returns the active FeatureScript output path, and the result can be pasted into Onshape for final compile verification.
