# Images

This site references two decorative images that are NOT required for the
build or tests to pass — both are CSS `background-image` slots that 404
silently, so the page renders identically without them. Drop the generated
file at the exact path below and rebuild; no code changes needed.

| File | Used by | Placed size | Role |
|---|---|---|---|
| `hero-aurora.png` | `src/components/Hero.astro` (`.hero-aurora`) | right 60% of the hero section, `cover` | atmospheric backdrop behind the terminal window |
| `merge-nebula.png` | `src/components/MentalModel.astro` (`.mm-nebula`) | ≤420px wide, `contain`, desktop only | glow behind the two-stream merge node |

`og.jpg` (1200×630) is a styled screenshot of the built page, regenerated
from the design itself — not an AI illustration. Re-shoot it after dropping
the images in, so the social card picks up the backdrop.

## Prompts (OpenAI image generation)

Shared style constraints for both: cinematic soft volumetric glow, high-end
minimal developer-tool aesthetic, no text, no UI elements, no lens flare,
no stars/space clichés. The site's exact colors: background `#0A0E14`,
electric orange `#FF7A45`, neon green `#3DDC84`.

**`hero-aurora.png`** — generate at 1536×1024 (or closest landscape size);
solid background, NOT transparent:

> Abstract dark cinematic backdrop for a developer tool website. Two thin
> ribbons of light — one electric orange (#FF7A45), one neon green
> (#3DDC84) — flow horizontally from the left and gently converge toward
> the right center, dissolving into fine particles and hair-thin filaments.
> Deep ink-blue-black background, exactly #0A0E14, with all four edges
> fading fully into that solid color. Soft volumetric glow, subtle particle
> dust, no lens flare, no text, no UI, no stars. Very dark overall — bright
> highlights occupy less than 15% of the frame.

Why the edge-fade matters: the image sits on a flat `#0A0E14` page; if the
edges aren't that exact solid color, a visible rectangle seam appears.

**`merge-nebula.png`** — generate at 1536×1024 landscape, transparent
background (alpha PNG):

> A small luminous energy node glowing neon green (#3DDC84), right of
> center, with two hair-thin light filaments feeding into it from the left
> — one electric orange (#FF7A45), one neon green — dissolving into fine
> particles around the node. Transparent background (alpha PNG), soft
> additive glow, dark high-end developer aesthetic, minimal, no text, no
> lens flare. The glow is subtle and tight around the node, not a large
> bloom.

Keep both SUBTLE and dark: they sit behind real text/labels; the site's
own crisp SVG strokes and terminal panels must stay the protagonists. If a
result looks bright or busy, regenerate darker rather than dimming in CSS.
