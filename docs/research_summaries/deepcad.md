# DeepCAD

Source: https://www.cs.columbia.edu/cg/deepcad

- Modeling patterns: DeepCAD represents CAD models as ordered sketch and extrude command sequences, which map directly to solved sketches followed by feature operations.
- Recommended primitives: sketch loops made of lines/arcs/circles, then extrude commands with distances and operations.
- Failure modes: raw command data can include unknown units, unsupported feature types, and non-closed loops; direct ingestion of full archives is too heavy for git.
- Example shapes: simple spacers, plates, prismatic bodies, and multi-extrude mechanical parts from JSON/H5 samples.
- Implementation notes: sample archives into compact cad_memory rows with curve counts, operation counts, and template hints rather than committing raw model data.
