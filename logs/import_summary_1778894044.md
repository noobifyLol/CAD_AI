# Import Summary 1778894044

- Knowledge rows added: 11
- Pruning rules added: 11
- CAD memory/example rows ready: 44
- FeatureScript examples created: 10
- FeatureScript files: bottle_revolve_loft.fs, fillet_and_chamfer_example.fs, flange_pattern.fs, hybrid_organic_flange.fs, loft_transition_square_to_circle.fs, lofted_airfoil.fs, revolve_carrot.fs, shell_enclosure_open_top.fs, sweep_pipe_elbow.fs, vase_multi_profile_loft.fs
- Diagnostics log: logs/learning_diagnostics_1778893977.txt and logs/learning_diagnostics_1778893879.json
- Smoke generation log: logs/generations_20260516011105.json

## Diagnostics Summary

- Static smoke success rate: 100% (6/6)
- Supabase cad_memory import: succeeded; cad_knowledge upsert is blocked by missing unique constraint on title, so local CSV retrieval is enabled as fallback.
- Adaptive network trained steps: 1224

## Next Recommended Actions

- Add the missing cad_knowledge(title) unique constraint or use a service-role import path if you want DB cad_knowledge rows populated directly.
- Add more Onshape-compiled organic and loft examples with real compile feedback.
- Add render-based visual inspection once automated Onshape compile/render access is available.
