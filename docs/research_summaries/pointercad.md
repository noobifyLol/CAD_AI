# Pointer-CAD: Pointer-Based B-Rep & Command Sequence CAD

Sources:
- https://arxiv.org/abs/2603.04337
- https://github.com/Snitro/Pointer-CAD

- Core idea: generate CAD models step-by-step by conditioning on both a natural language prompt and the current intermediate B-Rep geometry.
- Innovation: use pointer heads to explicitly select faces or edges for operations that require entity references, such as fillet or chamfer.
- Architecture: Qwen2.5-Instruct backbone fine-tuned with LoRA, UV-Net B-Rep encoder, and separate heads for command tokens, numeric values, pointer selection, and scale prediction.
- Dataset: roughly 575k annotated CAD models with expert-level natural language descriptions.
- Practical insight: geometry-aware command generation reduces the topological errors introduced by earlier token-only representations and improves complex CAD operation support.
- Technical takeaway: for advanced CAD AI, combining text, B-Rep context, and explicit entity-selection outputs is more robust than sequence-only models.
