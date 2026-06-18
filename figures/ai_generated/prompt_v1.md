# External Render Prompt v1

Create a publication-quality academic paper figure on a clean white background.

Figure type:
Method pipeline diagram for a lightweight retrieval-augmented interview assistant.

Layout:
Use a left-to-right horizontal pipeline with five main modules, evenly spaced and aligned on a central baseline. Use subtle grouping boxes only where helpful. Keep generous whitespace between modules so arrows and labels remain readable after scaling in a paper.

Content:
Show these modules in order:

1. "User Question"
2. "Intent Parsing"
3. "Knowledge Retrieval"
4. "Answer Reasoning"
5. "Structured Response"

Use thick dark arrows from left to right between all modules. Label the arrow from "Intent Parsing" to "Knowledge Retrieval" as "query terms". Label the arrow from "Knowledge Retrieval" to "Answer Reasoning" as "evidence snippets". Label the final arrow as "ranked answer".

Inside "Knowledge Retrieval", show three small stacked sources labeled "Resume", "Project Notes", and "FAQ". Keep these as simple mini blocks, not decorative icons.

Add a small secondary feedback arrow from "Structured Response" back to "Intent Parsing", routed below the main pipeline, labeled "clarification if needed". This arrow should be thinner than the main arrows but still readable.

Style:
Use a restrained academic palette with 3-5 coordinated colors: soft blue for input, light teal for parsing/retrieval, muted green for reasoning, and pale warm gray for output. Use clean sans-serif typography, thick dark arrows with clear arrowheads, consistent rounded rectangles, balanced whitespace, and print-friendly contrast. The diagram should remain understandable in grayscale.

Avoid:
Tiny text, wrong arrow directions, crossed arrows, decorative clip-art icons, heavy shadows, glow effects, rainbow gradients, 3D perspective, dark backgrounds, and slide-deck style.

Output:
A single crisp PNG suitable for inclusion in a CVPR/ICLR/NeurIPS-style paper. Use English labels exactly as specified.
