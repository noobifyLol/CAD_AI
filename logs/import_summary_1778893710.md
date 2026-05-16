# Import Summary 1778893710

- Knowledge rows added: 11
- Pruning rules added: 11
- CAD memory/example rows ready: 398
- FeatureScript examples created: 10
- FeatureScript files: bottle_revolve_loft.fs, fillet_and_chamfer_example.fs, flange_pattern.fs, hybrid_organic_flange.fs, loft_transition_square_to_circle.fs, lofted_airfoil.fs, revolve_carrot.fs, shell_enclosure_open_top.fs, sweep_pipe_elbow.fs, vase_multi_profile_loft.fs
- Diagnostics log: logs/learning_diagnostics_1778893716.txt
- Smoke generation log: logs/generations_1778893654.json

## Diagnostics Summary

- Static smoke success rate: 100% (6/6)
- Average quality score: 0.93
- Pruning rule trigger rate: 83.33%
- Adaptive network trained steps: 1224
- Supabase cad_memory import: succeeded; cad_knowledge database insert is blocked by missing unique constraint/RLS, so local CSV retrieval is enabled as fallback.

## Next Recommended Actions

- Add the missing cad_knowledge(title) unique constraint or use a service-role key for seed imports if you want DB cad_knowledge populated directly.
- Add 20+ more organic silhouette and loft examples with real Onshape compile feedback.
- Add render-based visual inspection once an automated Onshape compile/render service is available.
