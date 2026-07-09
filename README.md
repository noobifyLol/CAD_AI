# CAD_AI

CAD_AI is an experimental FeatureScript generation system for Onshape-style CAD workflows. It combines prompt parsing, retrieval context, local heuristics, and a deterministic fallback path so the pipeline can still produce a usable FeatureScript file even when the AI path is uncertain or partially fails.

> Status: this project is still a work in progress. It is not complete, it has known rough edges, and it should be treated as a research and prototyping codebase rather than a production-ready CAD platform.

## What this project tries to do

- Turn a natural-language CAD request into an editable FeatureScript file.
- Use retrieved knowledge, examples, and local rules to guide generation.
- Preserve a strong default path that never returns an empty or omitted result.
- Provide a contributor-friendly starting point for further work on validation, repair, and model orchestration.

## Current guarantees

The current implementation is designed to avoid the worst failure mode: returning no usable FeatureScript.

- The generator now uses a deterministic guaranteed fallback when the main AI path is weak, invalid, or incomplete.
- That fallback always produces a FeatureScript payload with a valid header, a defineFeature block, and editable parameters.
- The system is intentionally conservative in that mode so it can always deliver something usable instead of silently omitting output.

## Repository layout

- [ai.js](ai.js) — core generation, validation, repair, and deterministic fallback logic.
- [server.js](server.js) — HTTP API entry point for generation and debugging.
- [Auth.js](Auth.js) — authentication and Supabase-related helpers.
- [learning.js](learning.js) — learning and memory orchestration helpers.
- [scripts/](scripts/) — data import, training, pruning, and smoke-test utilities.
- [data/](data/) — knowledge, memory, and dataset assets.
- [docs/](docs/) — architecture notes and research summaries.

## Getting started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a local environment file if needed with your Groq API keys.
3. Start the server:
   ```bash
   npm start
   ```
4. Send a request to the generation endpoint or run the built-in smoke test:
   ```bash
   npm run test:guaranteed
   ```

## Important notes for contributors

- The project is still incomplete and there are many open issues.
- Some parts are experimental and may change frequently.
- The generator has been intentionally biased toward producing a usable FeatureScript rather than failing silently.
- If you change generation behavior, keep that guarantee in mind and test it carefully.

## Known areas that still need work

- Better shape-specific FeatureScript generation for more CAD forms.
- Stronger validation and repair quality.
- More robust prompt interpretation and dimension extraction.
- Cleaner separation of runtime logic, knowledge handling, and UI/API concerns.
- More thorough testing and regression coverage.

## Development guidance

If you want to help improve this project:

- Keep the core generation path understandable and modular.
- Prefer small, testable changes over broad rewrites.
- Preserve the guarantee that a FeatureScript result is always emitted when possible.
- Document new behavior, assumptions, and limitations clearly.

## Summary

This system is a promising starting point for AI-assisted CAD generation, but it is still rough and evolving. The main design principle now is simple: do not fail silently. When the model is uncertain, the system should still return a concrete FeatureScript rather than omitting the result.
