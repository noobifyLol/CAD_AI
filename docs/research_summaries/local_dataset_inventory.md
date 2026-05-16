# Local Dataset Inventory

Sources:
- `data/Omni-CAD.zip`
- `data/data/cad_json.tar.gz`
- `data/data/cad_vec.tar.gz`
- `data/data/train_val_test_split.json`

- Modeling patterns: the local datasets are large compressed sources, so ingestion is conservative and metadata-first. Full extraction is intentionally not committed.
- Available data: `Omni-CAD.zip` contains 605,431 `json` entries and 101 `txt` caption shards by archive listing. `cad_json.tar.gz` lists 215,194 paths; `cad_vec.tar.gz` lists 179,234 paths.
- Example extracted descriptor: Omni-CAD captions describe CAD models as combinations of bases, holes, protrusions, flanges, hollow interiors, arms, and frames. DeepCAD JSON exposes `Sketch` and `ExtrudeFeature` entities with bounding boxes.
- Failure modes: accidentally committing raw archives, unpacking multi-GB data into git, using dataset ids as code identifiers, or assuming captions contain exact dimensions.
- Implementation pulled into repo: `.gitignore` now excludes the raw archives and extracted dataset folders while keeping CSV/FS artifacts tracked.
