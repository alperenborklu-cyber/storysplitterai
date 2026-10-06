# StorySplitter AI - Sessions, Data Formats & Architecture

> Technical specifications for `.storysplitter` project archives, coordinate JSON layouts, IndexedDB persistence, and client-side privacy architecture.

## 1. Project Bundle Format (`.storysplitter`)

A `.storysplitter` file is a standard ZIP archive created and extracted via `JSZip` in the browser. It allows creators to save and resume complex storyboard projects without losing original image data or custom box annotations.

### Internal Bundle Structure:
```text
project.storysplitter (ZIP)
├── project.json              # Metadata, page IDs, active indices, settings
├── page_1.json               # Page 1 crop boxes, labels, and coordinate geometries
├── page_1.png (or .webp)     # Full-resolution original source image for Page 1
├── page_2.json               # Page 2 crop boxes and annotations
└── page_2.png                # Full-resolution original source image for Page 2
```

### `project.json` Schema:
```json
{
  "version": "1.0.4",
  "name": "project_name",
  "created": 1750000000000,
  "activePageIndex": 0,
  "pages": [
    {
      "id": "uuid-v4",
      "name": "Sheet_01",
      "imageFile": "page_1.png",
      "cropCount": 6
    }
  ]
}
```

---

## 2. Layout Coordinates JSON Schema

To enable automated CI/CD and scriptable workflows, StorySplitter AI supports importing and exporting crop box layout coordinates as JSON:

```json
{
  "version": "1.0.4",
  "aspectRatio": 1.7777777777777777,
  "boxes": [
    {
      "x": 48,
      "y": 62,
      "w": 640,
      "h": 360,
      "label": "Scene 1 Shot A"
    },
    {
      "x": 720,
      "y": 62,
      "w": 640,
      "h": 360,
      "label": "Scene 1 Shot B"
    }
  ]
}
```

---

## 3. Storage & Privacy Architecture

- **IndexedDB**: Autosaves project state, page records, and canvas geometry locally in the browser under the database `StorySplitterDB`.
- **Zero-Server Processing**: All canvas operations (`canvas.toBlob`, `getImageData`, edge detection, cropping) happen within client memory.
- **Offline Capable**: Once loaded, StorySplitter AI operates with zero network dependencies. No telemetry, analytics, or user images are transmitted to external servers.
