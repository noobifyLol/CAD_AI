# Cambridge Design Society Paper

Source: https://www.cambridge.org/core/journals/proceedings-of-the-design-society/article/from-text-to-design-a-framework-to-leverage-llm-agents-for-automated-cAD-generation/5BD8D63CFCED28BDD7A01313162FFBE7

- Modeling patterns: LLM function calls generate CAD primitives and booleans inside agent workflows; step planning and visual inspection are the most relevant reusable patterns.
- Recommended primitives: block, cylinder, boolean addition/subtraction, and generated code for geometric calculation; for this repo, map those ideas to sketch + opExtrude, opRevolve, opLoft, opSweep, and opBoolean.
- Failure modes: spatial ambiguity, prompt dependency, hallucinated operations, and limited spatial reasoning; ask-back can distract when prompts are already specific.
- Example shapes: box, corner plate, U-profile, toy car, and FCRC bracket; visual inspection improved success more than plain step planning.
- Implementation notes: preserve conversation and function-call logs, record workflow selection, and use validation/repair loops before final CAD assembly.
