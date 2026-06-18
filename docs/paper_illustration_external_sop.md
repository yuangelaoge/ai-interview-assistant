# Paper Illustration External Render SOP

Use this SOP when the `codex-image2` native rendering bridge is unavailable.
Codex handles planning, prompt writing, visual review, refinement feedback,
finalization, and verification. The user manually renders the image in an
external image tool and returns a PNG.

## Roles

- Codex: figure brief, final image prompt, layout/style checks, image review,
  refinement instructions, final artifact packaging.
- User: render the prompt externally and provide the generated PNG.

## Output Directory

All artifacts stay under:

```text
figures/ai_generated/
```

Expected final artifacts:

```text
figures/ai_generated/
  preflight_external.json
  prompt_v1.md
  external_render_v1.png
  external_render_v2.png
  figure_final.png
  latex_include.tex
  review_log.json
  verify.json
```

## Workflow

### Step 0: External Preflight

Run:

```powershell
python tools/paper_illustration_image2.py preflight-external --workspace . --json-out figures/ai_generated/preflight_external.json
```

This confirms the helper and output directory are available, without requiring
the `codex-image2` bridge.

### Step 1: Figure Brief

Codex turns the user's method, architecture, or paper paragraph into a concise
figure brief:

- figure type
- modules and stages
- left-to-right or top-to-bottom flow
- exact labels
- arrows and data flow
- visual hierarchy

Figure text should be English unless the user requests another language.

### Step 2: Layout Plan

Codex writes a concrete layout plan before any rendering:

- module order
- grouping
- relative sizes
- arrow routing
- expected collision risks
- whitespace and alignment rules

### Step 3: Style Check

Codex checks the prompt against paper-figure standards:

- clean white background
- restrained 3-5 color palette
- thick dark arrows with clear arrowheads
- readable sans-serif labels
- print-friendly grayscale readability
- no glow, rainbow gradients, heavy shadows, or slide-deck decoration

### Step 4: External Render

Codex saves the prompt as:

```text
figures/ai_generated/prompt_vN.md
```

The user renders it externally and provides the PNG. Save each returned image as:

```text
figures/ai_generated/external_render_vN.png
```

### Step 5: Strict Review

Codex reviews the PNG:

- all major components present
- logical flow is obvious
- labels are readable
- arrows point in the correct direction
- visual style is paper-ready, not slide-ready

Score from 1 to 10. Accept only score >= 9.

### Step 6: Refinement Loop

If score < 9, Codex writes targeted refinement feedback and a new prompt:

```text
figures/ai_generated/prompt_v2.md
figures/ai_generated/prompt_v3.md
```

The user re-renders externally and returns the next PNG.

### Step 7: Finalize And Verify

When a PNG is accepted, Codex runs:

```powershell
python tools/paper_illustration_image2.py finalize --workspace . --best-image figures/ai_generated/external_render_vN.png --score 9 --review-summary "Accepted after strict review; labels and arrows are paper-ready."

python tools/paper_illustration_image2.py verify --workspace . --json-out figures/ai_generated/verify.json
```

This emits:

- `figure_final.png`
- `latex_include.tex`
- `review_log.json`
- `verify.json`

## Prompt Template

```text
Create a publication-quality academic paper figure on a clean white background.

Figure type:
[architecture / method pipeline / conceptual workflow]

Layout:
[specific layout plan]

Content:
[modules, labels, arrows, data flow]

Style:
Use a restrained academic palette with 3-5 coordinated colors. Use clean
sans-serif typography, thick dark arrows with clear arrowheads, consistent
module sizing, balanced whitespace, and print-friendly contrast.

Avoid:
Tiny text, wrong arrow directions, crossed arrows, decorative icons, heavy
shadows, glow effects, rainbow gradients, 3D perspective, and slide-deck style.

Output:
A single crisp PNG suitable for inclusion in a CVPR/ICLR/NeurIPS-style paper.
```
