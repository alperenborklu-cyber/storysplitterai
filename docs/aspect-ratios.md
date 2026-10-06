# StorySplitter AI - Aspect Ratios Guide

> Understanding aspect ratio constraints, composition standards, and mathematical proportions for AI video generation.

## Supported Aspect Ratios

| Ratio | Value | Common Name | Primary Use Case |
| :--- | :--- | :--- | :--- |
| **16:9** | 1.777:1 | Cinematic Widescreen | YouTube, Television, Feature Films, Desktop Video |
| **9:16** | 0.5625:1 | Vertical Portrait | TikTok, Instagram Reels, YouTube Shorts, Mobile Ads |
| **1:1** | 1.000:1 | Square | Instagram Grid, Profile Avatars, Thumbnail Previews |
| **4:3** | 1.333:1 | Academy / Classic TV | Retro Aesthetic, Vintage Television, Archival Footage |
| **Freeform** | Variable | Unlocked Custom | Non-standard bounding boxes, caption-inclusive cropping |

---

## Why Aspect Lock is Critical for Generative Video

Modern generative video models (such as Runway Gen-3 Alpha, Luma Dream Machine, Kling AI, and Minimax) operate on fixed native canvas tensors (commonly 1280x720, 1920x1080, 720x1280, or 1080x1920).

When an input image with irregular proportions is passed into these video pipelines, the pipeline must either:
1. **Stretch or squash the image**: Warping actors, faces, and backgrounds.
2. **Center-crop automatically**: Truncating critical action or focal points.
3. **Pillarbox or letterbox with black bars**: Causing the video model to attempt hallucinating animations into the black margin areas, leading to visual flickering and edge noise.

By locking the aspect ratio directly in StorySplitter AI during initial panel extraction, every exported panel matches downstream generation parameters with zero distortion.

---

## Technical Implementation in StorySplitter AI

- **Grid Slicing**: When an aspect ratio (e.g. 16:9) is active in the Grid panel, modifying the `Cell Width` slider dynamically recalculates `Cell Height = Math.round(width / ratio)` automatically.
- **Canvas Dragging**: When resizing crop boxes using corner or edge transform handles, delta transformations are projected along the aspect ratio vector, preserving exact proportions regardless of pointer trajectory.
