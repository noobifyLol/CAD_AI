# Deployed CAD-AI App

Source: https://cad-ai-0o9s.onrender.com

- Modeling patterns: the deployed API mirrors this repo's `/generate`, `/debug`, and `/learning/diagnostics` workflow when current code is deployed.
- Recommended primitives: retrieval-augmented FeatureScript generation using local knowledge, pruning rules, memory rows, and FS docs.
- Failure modes: deployment may lag local code, database schema may be missing adaptive tables, and external LLM calls can rate-limit.
- Example shapes: smoke prompts cover organic revolve, loft transition, sweep elbow, shell enclosure, hybrid flange, and edge-case loft.
- Implementation notes: diagnostics and generation logs are written under logs/ for repeatable inspection.
