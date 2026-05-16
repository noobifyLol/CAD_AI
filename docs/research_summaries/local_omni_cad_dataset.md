# Local Omni-CAD / DeepCAD-Style Archives

- Modeling patterns: the local data folder contains compressed command-history JSON and vector archives; each JSON file can be converted into operation descriptors and retrieval snippets.
- Recommended primitives: detected Sketch, ExtrudeFeature, Circle3D, Arc3D, and Line3D entries map naturally to FeatureScript sketches, profile regions, and opExtrude templates.
- Failure modes: raw STEP/H5/vector assets are too large for direct prompt use and must be ignored by git; snippets should keep only semantic operation summaries.
- Example shapes and ranges: this import samples dataset entries into cad_memory rows and creates at least 50 adaptive training vectors labeled from static validation outcomes.
- Operational lesson: keep the heavy archives local while committing only small CSV/JSON/FS derivatives that improve retrieval.
