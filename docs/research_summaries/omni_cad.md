# Omni-CAD Dataset

Source: https://huggingface.co/datasets/jingwei-xu-00/Omni-CAD

- Modeling patterns: large multimodal CAD data can provide retrieval examples for command order, shape classification, and profile descriptors.
- Recommended primitives: use dataset examples as template hints for extrude, revolve, loft, sweep, shell, and boolean workflows.
- Failure modes: raw datasets are large, heterogeneous, and unsuitable for direct git storage; ingestion should be capped and metadata-only by default.
- Example shapes: dataset entries are converted into cad_memory snippets when extracted locally; zip-only archives are logged as available but skipped until extracted or sampled by tooling.
- Implementation notes: keep data/Omni-CAD.zip ignored and store compact summaries, training vectors, and high-quality FS templates in tracked files.
