# StorySplitter AI - Features & Tooling

> Detailed breakdown of all slicing modes, canvas controls, export pipelines, and adaptive algorithms in StorySplitter AI.

## Slicing Modes

### 1. Smart Auto-Detection
The auto-detection engine uses client-side computer vision algorithms to isolate panels on a sheet:
- **Sensitivity Slider**: Adjusts edge and luminance gradient thresholds to distinguish panel frames from backgrounds.
- **Minimum Panel Size**: Discards fine noise, logos, and tiny graphic artifacts.
- **Detection Mask Overlay**: Visualizes binary detection masks directly in the viewport for fine-tuning.
- **Whitespace & Caption Trimmer**: Strips outer blank padding and bottom text captions automatically.
- **Adaptive Learner (k-NN)**: Evaluates image features (mean brightness, variance, contrast, edge density) and retrieves optimal settings from a built-in pre-trained database and user feedback.

### 2. Uniform Grid Mode
Designed for sheets organized in regular matrices (e.g., 2x2, 3x3, 4x2):
- **Columns & Rows**: Set arbitrary grid counts.
- **Cell Dimensions (Width & Height)**: Both interactive range sliders and manual numeric inputs for pixel precision.
- **Inter-Cell Gaps (Gap X & Gap Y)**: Adjust vertical and horizontal gutters between frames.
- **Canvas Offsets (Offset X & Offset Y)**: Shift the entire grid across the canvas to match asymmetrical margins.
- **Auto Resize**: Automatically calculates cell dimensions based on canvas proportions.

### 3. Custom / Manual Cropping
For hand-drawn storyboards, asymmetrical AI collages, or dynamic shot lists:
- **Interactive Bounding Boxes**: Click "Add Crop Box" to instantiate boxes anywhere on the sheet.
- **8-Point Transform Handles**: Drag corners and side handles to resize.
- **In-Canvas Label Editing**: Double-click any frame badge on the canvas to rename (e.g. "Scene 1 Shot 4B").
- **Quick Deletion & Clear**: Delete individual boxes with handle controls or clear page boxes with one click.

---

## Aspect Ratio Locking

Video generation models (e.g. Runway, Pika, Luma, Kling) require strict frame proportions:
- **16:9 (Widescreen)**: Standard cinematic format for film and YouTube.
- **9:16 (Vertical)**: Optimized for TikTok, Instagram Reels, and YouTube Shorts.
- **1:1 (Square)**: Traditional square framing.
- **4:3 (Classic)**: Vintage film and retro television ratios.
- **Freeform**: Unconstrained custom bounding boxes for irregular artwork or dialogue panels.

When aspect ratio lock is enabled, adjusting box width automatically recalibrates box height (and vice-versa) across canvas dragging and slider adjustments.

---

## Canvas Controls & Interaction

- **Smooth Pan & Zoom**: Mouse wheel zoom and click-and-drag panning across giant high-resolution images (4K+ supported).
- **Zoom Preset Buttons**: Zoom In, Zoom Out, and Reset View (100% fit).
- **Undo Stack**: Up to 50 levels of history per page (`Ctrl+Z` keyboard shortcut and toolbar button).
- **Burn-In Labels**: Option to permanently stamp panel names into the exported frame images for client review.

---

## Exporting & Data Portability

- **Batch ZIP Export**: Packages all frames across all pages into a structured `.zip` archive via client-side `JSZip`.
- **Formats**: Lossless PNG or high-quality JPEG.
- **Project Bundles (`.storysplitter`)**: Binary zip archive containing project JSON state, canvas coordinates, labels, and original source images.
- **JSON Coordinate Layouts**: Export or import standard JSON bounding box coordinates for integration with external pipelines.
