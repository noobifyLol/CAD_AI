# Adaptive CAD Learning

The app now uses an adaptive memory layer instead of pretending the hosted LLM retrains itself in real time.

## How It Learns

1. `generations` stores prompts, extracted dimensions, generated FeatureScript, reasoning, ratings, and feedback.
2. `cad_memory` stores reusable CAD skills: modeling patterns, parameter hints, failure modes, and validation rules.
3. `cad_generation_memory_matches` links each generation to the memory rows that influenced it.
4. `cad_feedback_events` stores signals such as copied output, debug requests, compile errors, and ratings.
5. Feedback updates `cad_memory.quality_score`, promoting useful skills and demoting weak ones.
6. `prune_cad_memory()` deactivates repeatedly bad memory rows without deleting them.

## Retrieval Flow

Before generation, `learning.js` extracts keywords, infers a shape hint, searches scored CAD memory, searches similar prior generations, and adds compact context to `AI.js`. The model sees only the most useful few rows so Groq token-per-minute usage stays controlled.

## Database Setup

Run the SQL in:

```text
supabase/migrations/20260505213000_adaptive_cad_memory.sql
```

Then seed the CAD foundation:

```bash
npm run seed:knowledge
```

Inspect the current database state:

```bash
npm run db:learning-report
```
