# StorySplitter AI - Workflows & Integrations

> Recommended end-to-end production pipelines connecting generative AI art tools with AI video generation engines.

## 1. Midjourney to Video Workflow

Midjourney excels at concept art and cinematic pre-visualization. Often, creators prompt for multi-panel grids:
```text
/imagine prompt: cinematic storyboard sequence of a detective entering an abandoned cyberpunk warehouse, 4-panel sequence, shot progression, dynamic lighting, cinematic color grading --ar 16:9 --v 6.1
```

### Steps:
1. **Download the full generated sheet** from Midjourney.
2. **Open StorySplitter AI** and drag the image into the workspace.
3. **Choose Slicing Mode**:
   - For regular 2x2 grids, select the **Grid** tab, set Columns to 2 and Rows to 2, and click **Auto Resize**.
   - Alternatively, switch to **Auto-Detect** and click **Detect Frames**.
4. **Enforce 16:9 Ratio**: Set Aspect Lock to `16:9` so all crops match video resolution.
5. **Rename Panels**: Double-click frame badges to rename them sequentially (e.g., `Scene1_01_Exterior`, `Scene1_02_DoorOpen`, `Scene1_03_Flashlight`).
6. **Download ZIP**: Click **Download ZIP** to export clean, individually named panels.
7. **Ingest to Video AI**: Drag each panel into Runway Gen-3, Luma Dream Machine, or Kling AI as keyframes or initial image prompts.

---

## 2. Stable Diffusion & ComfyUI Pipeline

When running ComfyUI or SD WebUI with ControlNet or custom storyboard LoRAs:
1. Export your batch contact sheet.
2. Drag multiple sheets simultaneously into StorySplitter AI. They populate the **Pages** sidebar automatically.
3. Configure crop layouts per page, or reuse identical grid coordinates across uniform render batches using **Export/Import Layout JSON**.
4. Use **Burn Labels** if sending review sheets to a client or director to confirm camera angles before committing GPU compute to video rendering.

---

## 3. Video Pipeline Optimization Tips

- **Avoid Letterbox Artifacts**: AI video generators produce black bars or distorted motion if input frames do not match target aspect ratios. Keeping `16:9` locked prevents distortion.
- **Save Project Bundles**: Save a `.storysplitter` bundle alongside your video project files. If a director requests re-cropping a shot with tighter framing, reload the `.storysplitter` file in one second without starting over.
