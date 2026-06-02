# CADFS: FeatureScript-Based Generative CAD

Sources:
- https://arxiv.org/pdf/2605.01925
- https://voyleg.github.io/cadfs

- Core idea: represent CAD design histories as executable FeatureScript programs rather than simplified sketch+extrude token sequences.
- Dataset: reconstructed 450k real-world Onshape CAD models with 15 modeling operations, including fillet, chamfer, loft, revolve, pattern, shell, and advanced feature queries.
- Value for AI: FeatureScript preserves parametric fidelity, supports explicit entity selection, and is directly aligned with engineering workflows.
- Approach: reconstruct clean, executable FeatureScript from Onshape internals, unify parameters, remove redundancies, resolve implicit references, and attach multimodal annotations (text, images, point clouds).
- Benefits: enables more complex CAD generation and image-conditioned reconstruction, improves accuracy and diversity, and avoids the limitations of prior CAD datasets that only used sketch/extrude.
- Key lesson: for a CAD AI, native CAD scripting representations plus rich operation vocabularies are more powerful than artificial compact tokens.
