# CAD-MLLM

Source: https://github.com/CAD-MLLM/CAD-MLLM and https://cad-mllm.github.io/

- Modeling patterns: CAD commands are treated as structured sequences conditioned by text and visual inputs; useful repo mapping is prompt -> command plan -> FeatureScript sketches/operations.
- Recommended primitives: sequence-level sketch, extrusion, revolve, loft, and sweep patterns; retrieval snippets should describe operation order and profile geometry.
- Failure modes: multimodal shape understanding can fail when image-to-command alignment is weak; generated command sequences need closed sketches, valid constraints, and correct operation order.
- Example shapes: dataset-style CAD samples with sketches, extrudes, STEP-like geometry, and command histories; compact metadata is safer than importing raw archives into prompts.
- Implementation notes: add silhouette/profile descriptors, dataset-derived memory rows, adaptive reranking, and trace logs with retrieved rows and scores.
