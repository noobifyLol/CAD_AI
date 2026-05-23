# CAD-MLLM And Omni-CAD

Sources:
- https://github.com/CAD-MLLM/CAD-MLLM
- https://cad-mllm.github.io
- https://arxiv.org/abs/2411.04954
- https://huggingface.co/datasets/jingwei-xu-00/Omni-CAD

- Modeling patterns: CAD-MLLM aligns multimodal inputs with CAD command sequences. For this repo, the useful abstraction is multimodal conditioning -> profile descriptors -> editable FeatureScript templates.
- Recommended primitives: use command-sequence retrieval to select sketch/extrude, revolve, loft, sweep, shell, Boolean, and pattern operations rather than trying to emit opaque model tokens directly.
- Failure modes: raw h5/vector tokens are not FeatureScript, captions can overfit visual appearance, missing dimensions must not become hardcoded guesses, and dataset examples need traceability back to retrieved rows.
- Example shapes and ranges: Omni-CAD captions include blocks with holes, cylindrical bases with protrusions, flanges, arms, frames, and hollow prisms. Local `Omni-CAD.zip` contains `txt/*.json` caption files and `json/` construction data.
- Implementation pulled into repo: `scripts/ingest_cad_mllm_dataset.js` creates dataset memory rows, while the active runtime now stays focused on Groq prompt reasoning plus FeatureScript docs and learned memory.
