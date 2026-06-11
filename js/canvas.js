// Dynamic aspect ratio property is used on StoryboardCanvas instance
const HANDLE_SIZE = 8;

export class StoryboardCanvas {
  constructor(canvas, container, callbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.container = container;
    this.callbacks = callbacks || {};
    
    // View state
    this.img = null;
    this.cropBoxes = [];
    this.selectedBoxId = null;
    this.showDetectMask = false;
    this.detectionMaskCanvas = null;
    this.lockAspectRatio = true;
    this.aspectRatioValue = 16 / 9;
    
    this.zoomLevel = 1.0;
    this.panX = 0;
    this.panY = 0;
    
    // Interaction states
    this.isPanning = false;
    this.isDraggingBox = false;
    this.isResizingBox = false;
    this.isDraggingGrid = false;
    this.isAltDragging = false;
    this.activeBox = null;
    this.resizeHandle = null;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.boxStartPos = {};
    this.gridStartOffsetX = 0;
    this.gridStartOffsetY = 0;
    this.alignSourceX = 0;
    this.alignSourceY = 0;
    this.copiedBox = null;
    
    // Pan start coordinates
    this.startPanX = 0;
    this.startPanY = 0;

    // Mobile Pinch zoom state
    this.touchStartDist = 0;
    this.touchStartZoom = 1.0;
    this.touchStartPanX = 0;
    this.touchStartPanY = 0;
    this.touchStartMid = { x: 0, y: 0 };
    this.isPinching = false;

    this.initEvents();
  }

  setImage(img) {
    this.img = img;
    this.canvas.width = img.width;
    this.canvas.height = img.height;
    this.resetZoom();
  }

  setCropBoxes(boxes) {
    this.cropBoxes = boxes;
    this.draw();
  }

  setSelectedBoxId(id) {
    this.selectedBoxId = id;
    this.draw();
  }

  setMaskState(showMask, maskCanvas) {
    this.showDetectMask = showMask;
    this.detectionMaskCanvas = maskCanvas;
    this.draw();
  }

  resetZoom() {
    if (!this.img) return;
    const workspaceWidth = this.container.parentElement.clientWidth - 40;
    const workspaceHeight = this.container.parentElement.clientHeight - 40;
    const scaleX = workspaceWidth / this.img.width;
    const scaleY = workspaceHeight / this.img.height;
    this.zoomLevel = Math.min(1.0, scaleX, scaleY, 0.95);
    this.panX = 0;
    this.panY = 0;
    this.applyViewTransform();
    this.draw();
  }

  zoomIn() {
    this.zoomLevel = Math.min(this.zoomLevel + 0.1, 5.0);
    this.applyViewTransform();
  }

  zoomOut() {
    this.zoomLevel = Math.max(this.zoomLevel - 0.1, 0.1);
    this.applyViewTransform();
  }

  applyViewTransform() {
    this.container.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;
    if (this.callbacks.onZoomChange) {
      this.callbacks.onZoomChange(this.zoomLevel);
    }
  }

  initEvents() {
    // Mouse Event Listeners
    this.container.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    
    // Listen to mousemove on the parent element for smooth dragging/panning outside canvas
    this.container.parentElement.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    window.addEventListener('mouseup', () => this.handleMouseUp());
    this.container.addEventListener('dblclick', (e) => this.handleDoubleClick(e));

    // Handle middle-click panning anywhere in the workspace (including background)
    this.container.parentElement.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.isPanning = true;
        this.startPanX = e.clientX - this.panX;
        this.startPanY = e.clientY - this.panY;
      }
    });

    // Disable default browser middle click autoscroll icon
    this.container.parentElement.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
      }
    });

    // Touch Event Listeners (Mobile support)
    this.container.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
    this.container.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
    window.addEventListener('touchend', () => this.handleTouchEnd());

    // Scroll Wheel Zoom
    this.container.parentElement.addEventListener('wheel', (e) => {
      if (!this.img) return;
      e.preventDefault();
      
      const zoomFactor = 1.1;
      let newZoom;
      if (e.deltaY < 0) {
        newZoom = Math.min(this.zoomLevel * zoomFactor, 5.0);
      } else {
        newZoom = Math.max(this.zoomLevel / zoomFactor, 0.1);
      }
      
      const rect = this.container.parentElement.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      const canvasX = (mouseX - this.panX) / this.zoomLevel;
      const canvasY = (mouseY - this.panY) / this.zoomLevel;
      
      this.zoomLevel = newZoom;
      this.panX = mouseX - canvasX * this.zoomLevel;
      this.panY = mouseY - canvasY * this.zoomLevel;
      
      this.applyViewTransform();
    }, { passive: false });
  }

  getCanvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    let clientX, clientY;

    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const clickX = (clientX - rect.left) / (rect.right - rect.left) * this.canvas.width;
    const clickY = (clientY - rect.top) / (rect.bottom - rect.top) * this.canvas.height;
    return { x: clickX, y: clickY };
  }

  handleMouseDown(e) {
    if (!this.img) return;

    // Force middle-click panning and bypass box dragging/resizing
    if (e.button === 1) {
      e.preventDefault();
      this.isPanning = true;
      this.startPanX = e.clientX - this.panX;
      this.startPanY = e.clientY - this.panY;
      return;
    }

    const coords = this.getCanvasCoords(e);
    const mouseX = coords.x;
    const mouseY = coords.y;

    let clickedOnBoxOrHandle = false;

    // 1. Check if clicked on resize handle of SELECTED box
    if (this.selectedBoxId) {
      const box = this.cropBoxes.find(b => b.id === this.selectedBoxId);
      if (box) {
        const H = HANDLE_SIZE;
        const tol = Math.max(H * 2, H / (this.zoomLevel * 0.4));
        const mx = box.x + box.w / 2;
        const my = box.y + box.h / 2;
        const handleDefs = [
          { name: 'nw', hx: box.x,         hy: box.y },
          { name: 'n',  hx: mx,            hy: box.y },
          { name: 'ne', hx: box.x + box.w, hy: box.y },
          { name: 'e',  hx: box.x + box.w, hy: my },
          { name: 'se', hx: box.x + box.w, hy: box.y + box.h },
          { name: 's',  hx: mx,            hy: box.y + box.h },
          { name: 'sw', hx: box.x,         hy: box.y + box.h },
          { name: 'w',  hx: box.x,         hy: my },
        ];
        for (const { name, hx, hy } of handleDefs) {
          if (Math.abs(mouseX - hx) <= tol && Math.abs(mouseY - hy) <= tol) {
            clickedOnBoxOrHandle = true;
            this.isResizingBox = true;
            this.resizeHandle = name;
            this.activeBox = box;
            this.boxStartPos = { x: box.x, y: box.y, w: box.w, h: box.h };
            this.dragStartX = mouseX;
            this.dragStartY = mouseY;
            e.stopPropagation();
            e.preventDefault();
            return;
          }
        }
      }
    }

    // 2. Check if clicked inside any box to drag it (or Alt-duplicate it)
    if (!clickedOnBoxOrHandle) {
      for (let i = this.cropBoxes.length - 1; i >= 0; i--) {
        const box = this.cropBoxes[i];
        if (mouseX >= box.x && mouseX <= box.x + box.w &&
            mouseY >= box.y && mouseY <= box.y + box.h) {
          
          clickedOnBoxOrHandle = true;
          const activeTab = this.callbacks.getActiveTab ? this.callbacks.getActiveTab() : 'manual-controls';
          if (activeTab === 'grid-controls') {
            this.isDraggingGrid = true;
            this.gridStartOffsetX = this.callbacks.getGridOffset ? this.callbacks.getGridOffset().x : 0;
            this.gridStartOffsetY = this.callbacks.getGridOffset ? this.callbacks.getGridOffset().y : 0;
            this.dragStartX = mouseX;
            this.dragStartY = mouseY;
          } else {
            // Alt drag duplicate
            if (e.altKey) {
              const duplicated = {
                id: this.callbacks.getNextBoxId ? this.callbacks.getNextBoxId() : Date.now(),
                x: box.x,
                y: box.y,
                w: box.w,
                h: box.h,
                name: `${box.name} (Copy)`
              };
              this.cropBoxes.push(duplicated);
              this.selectedBoxId = duplicated.id;
              this.activeBox = duplicated;
              this.isAltDragging = true;
              this.alignSourceX = box.x;
              this.alignSourceY = box.y;
              if (this.callbacks.onBoxesChanged) this.callbacks.onBoxesChanged();
            } else {
              this.selectedBoxId = box.id;
              this.activeBox = box;
              this.isAltDragging = false;
            }

            this.isDraggingBox = true;
            this.boxStartPos = { x: this.activeBox.x, y: this.activeBox.y };
            this.dragStartX = mouseX;
            this.dragStartY = mouseY;
          }
          this.draw();
          if (this.callbacks.onSelectBox) {
            this.callbacks.onSelectBox(this.selectedBoxId);
          }
          
          e.stopPropagation();
          e.preventDefault();
          return;
        }
      }
    }

    // 3. Fallback to panning if clicked outside
    if (e.button === 1 || e.altKey || e.shiftKey || !clickedOnBoxOrHandle) {
      this.isPanning = true;
      this.startPanX = e.clientX - this.panX;
      this.startPanY = e.clientY - this.panY;
    }
  }

  handleMouseMove(e) {
    if (this.isPanning) {
      this.panX = e.clientX - this.startPanX;
      this.panY = e.clientY - this.startPanY;
      this.applyViewTransform();
      return;
    }

    const coords = this.getCanvasCoords(e);
    const mouseX = coords.x;
    const mouseY = coords.y;

    if (this.isDraggingGrid) {
      const dx = mouseX - this.dragStartX;
      const dy = mouseY - this.dragStartY;
      if (this.callbacks.onGridMoved) {
        this.callbacks.onGridMoved(this.gridStartOffsetX + dx, this.gridStartOffsetY + dy);
      }
      return;
    }

    if (this.isDraggingBox && this.activeBox) {
      const dx = mouseX - this.dragStartX;
      const dy = mouseY - this.dragStartY;
      
      let newX, newY;
      if (this.isAltDragging) {
        if (Math.abs(dx) > Math.abs(dy)) {
          newX = this.alignSourceX + dx;
          newY = this.alignSourceY;
        } else {
          newX = this.alignSourceX;
          newY = this.alignSourceY + dy;
        }
      } else {
        newX = this.boxStartPos.x + dx;
        newY = this.boxStartPos.y + dy;
      }

      newX = Math.max(0, Math.min(newX, this.img.width - this.activeBox.w));
      newY = Math.max(0, Math.min(newY, this.img.height - this.activeBox.h));

      this.activeBox.x = newX;
      this.activeBox.y = newY;
      this.draw();
      if (this.callbacks.onBoxDragUpdate) this.callbacks.onBoxDragUpdate(this.activeBox);
    } else if (this.isResizingBox && this.activeBox) {
      const dx = mouseX - this.dragStartX;
      const dy = mouseY - this.dragStartY;
      const locked = this.lockAspectRatio;

      if (locked) {
        let newW = this.boxStartPos.w;
        let newH = this.boxStartPos.h;
        let newX = this.boxStartPos.x;
        let newY = this.boxStartPos.y;

        let handle = this.resizeHandle;
        if (handle === 'e') handle = 'se';
        if (handle === 'w') handle = 'sw';
        if (handle === 's') handle = 'se';
        if (handle === 'n') handle = 'ne';

        if (handle === 'se') {
          newW = Math.max(50, this.boxStartPos.w + dx);
          newW = Math.min(newW, this.img.width - this.boxStartPos.x, (this.img.height - this.boxStartPos.y) * this.aspectRatioValue);
          newH = newW / this.aspectRatioValue;
          this.activeBox.w = newW;
          this.activeBox.h = newH;
        } else if (handle === 'ne') {
          newW = Math.max(50, this.boxStartPos.w + dx);
          newW = Math.min(newW, this.img.width - this.boxStartPos.x, (this.boxStartPos.y + this.boxStartPos.h) * this.aspectRatioValue);
          newH = newW / this.aspectRatioValue;
          newY = this.boxStartPos.y + this.boxStartPos.h - newH;
          this.activeBox.w = newW;
          this.activeBox.h = newH;
          this.activeBox.y = newY;
        } else if (handle === 'sw') {
          newW = Math.max(50, this.boxStartPos.w - dx);
          newW = Math.min(newW, this.boxStartPos.x + this.boxStartPos.w, (this.img.height - this.boxStartPos.y) * this.aspectRatioValue);
          newH = newW / this.aspectRatioValue;
          newX = this.boxStartPos.x + this.boxStartPos.w - newW;
          this.activeBox.w = newW;
          this.activeBox.h = newH;
          this.activeBox.x = newX;
        } else if (handle === 'nw') {
          newW = Math.max(50, this.boxStartPos.w - dx);
          newW = Math.min(newW, this.boxStartPos.x + this.boxStartPos.w, (this.boxStartPos.y + this.boxStartPos.h) * this.aspectRatioValue);
          newH = newW / this.aspectRatioValue;
          newX = this.boxStartPos.x + this.boxStartPos.w - newW;
          newY = this.boxStartPos.y + this.boxStartPos.h - newH;
          this.activeBox.w = newW;
          this.activeBox.h = newH;
          this.activeBox.x = newX;
          this.activeBox.y = newY;
        }
      } else {
        if (this.resizeHandle === 'se' || this.resizeHandle === 'e' || this.resizeHandle === 'ne') {
          let newW = this.boxStartPos.w + dx;
          newW = Math.max(50, Math.min(newW, this.img.width - this.boxStartPos.x));
          this.activeBox.w = newW;
          if (this.resizeHandle !== 'e') {
            const newH = Math.max(28, this.boxStartPos.h + (this.resizeHandle === 'ne' ? -dy : dy));
            if (this.resizeHandle === 'ne') {
              const newY = this.boxStartPos.y + this.boxStartPos.h - newH;
              if (newY >= 0) { this.activeBox.h = newH; this.activeBox.y = newY; }
            } else {
              if (this.boxStartPos.y + newH <= this.img.height) this.activeBox.h = newH;
            }
          }
        } else if (this.resizeHandle === 'sw' || this.resizeHandle === 'w' || this.resizeHandle === 'nw') {
          let newW = this.boxStartPos.w - dx;
          newW = Math.max(50, newW);
          const newX = this.boxStartPos.x + this.boxStartPos.w - newW;
          if (newX >= 0) {
            this.activeBox.w = newW;
            this.activeBox.x = newX;
            if (this.resizeHandle !== 'w') {
              const newH = Math.max(28, this.boxStartPos.h + (this.resizeHandle === 'nw' ? -dy : dy));
              if (this.resizeHandle === 'nw') {
                const newY = this.boxStartPos.y + this.boxStartPos.h - newH;
                if (newY >= 0) { this.activeBox.h = newH; this.activeBox.y = newY; }
              } else {
                if (this.boxStartPos.y + newH <= this.img.height) this.activeBox.h = newH;
              }
            }
          }
        } else if (this.resizeHandle === 's') {
          const newH = Math.max(28, Math.min(this.boxStartPos.h + dy, this.img.height - this.boxStartPos.y));
          this.activeBox.h = newH;
        } else if (this.resizeHandle === 'n') {
          const newH = Math.max(28, this.boxStartPos.h - dy);
          const newY = this.boxStartPos.y + this.boxStartPos.h - newH;
          if (newY >= 0) {
            this.activeBox.h = newH;
            this.activeBox.y = newY;
          }
        }
      }
      this.draw();
      if (this.callbacks.onBoxDragUpdate) this.callbacks.onBoxDragUpdate(this.activeBox);
    }

    // Update cursor based on hover
    if (!this.isDraggingBox && !this.isResizingBox && !this.isDraggingGrid && !this.isPanning) {
      let cursor = 'grab';
      if (this.selectedBoxId) {
        const box = this.cropBoxes.find(b => b.id === this.selectedBoxId);
        if (box) {
          const H = HANDLE_SIZE;
          const tol = Math.max(H * 2, H / (this.zoomLevel * 0.4));
          const mx2 = box.x + box.w / 2;
          const my2 = box.y + box.h / 2;
          const cursorMap = {
            nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize',
            e: 'e-resize', se: 'se-resize', s: 's-resize',
            sw: 'sw-resize', w: 'w-resize'
          };
          const hdls = [
            { name: 'nw', hx: box.x,         hy: box.y },
            { name: 'n',  hx: mx2,            hy: box.y },
            { name: 'ne', hx: box.x + box.w,  hy: box.y },
            { name: 'e',  hx: box.x + box.w,  hy: my2 },
            { name: 'se', hx: box.x + box.w,  hy: box.y + box.h },
            { name: 's',  hx: mx2,            hy: box.y + box.h },
            { name: 'sw', hx: box.x,          hy: box.y + box.h },
            { name: 'w',  hx: box.x,          hy: my2 },
          ];
          for (const { name, hx, hy } of hdls) {
            if (Math.abs(mouseX - hx) <= tol && Math.abs(mouseY - hy) <= tol) {
              cursor = cursorMap[name];
              break;
            }
          }
        }
      }
      
      if (cursor === 'grab') {
        for (let i = this.cropBoxes.length - 1; i >= 0; i--) {
          const box = this.cropBoxes[i];
          if (mouseX >= box.x && mouseX <= box.x + box.w &&
              mouseY >= box.y && mouseY <= box.y + box.h) {
            cursor = 'move';
            break;
          }
        }
      }
      this.container.style.cursor = cursor;
    }
  }

  handleMouseUp() {
    if (this.isDraggingBox || this.isResizingBox || this.isDraggingGrid) {
      if (this.callbacks.onStateChange) this.callbacks.onStateChange();
    }
    this.isPanning = false;
    this.isDraggingBox = false;
    this.isResizingBox = false;
    this.isDraggingGrid = false;
    this.isAltDragging = false;
    this.activeBox = null;
    this.resizeHandle = null;
  }

  handleDoubleClick(e) {
    if (!this.img) return;
    const coords = this.getCanvasCoords(e);
    const mouseX = coords.x;
    const mouseY = coords.y;

    // Check if double clicked inside a crop box's label overlay
    for (let i = this.cropBoxes.length - 1; i >= 0; i--) {
      const box = this.cropBoxes[i];
      // Check if click was in the label area (box.x to box.x + 100, box.y - 20 to box.y)
      if (mouseX >= box.x && mouseX <= box.x + 120 &&
          mouseY >= box.y - 20 && mouseY <= box.y) {
        e.stopPropagation();
        this.showInlineEditor(box);
        return;
      }
    }
  }

  showInlineEditor(box) {
    // Determine screen position of the canvas crop box's label
    const rect = this.canvas.getBoundingClientRect();
    
    // Scale canvas coordinates to client screen coordinates
    const labelScreenX = rect.left + (box.x / this.canvas.width) * rect.width;
    const labelScreenY = rect.top + ((box.y - 20) / this.canvas.height) * rect.height;

    // Create a temporary input element
    const input = document.createElement('input');
    input.type = 'text';
    input.value = box.name;
    input.className = 'inline-editor-input';
    
    // Position the input exactly on top of the canvas label
    input.style.left = `${labelScreenX}px`;
    input.style.top = `${labelScreenY}px`;
    input.style.width = `${Math.max(120, box.w * this.zoomLevel)}px`;
    
    document.body.appendChild(input);
    input.focus();
    input.select();

    const commitRename = () => {
      const newName = input.value.trim();
      if (newName && newName !== box.name) {
        box.name = newName;
        this.draw();
        if (this.callbacks.onStateChange) this.callbacks.onStateChange();
        if (this.callbacks.onRenameBox) this.callbacks.onRenameBox(box.id, newName);
      }
      cleanup();
    };

    const cleanup = () => {
      input.removeEventListener('blur', commitRename);
      input.removeEventListener('keydown', handleKey);
      if (input.parentNode) {
        document.body.removeChild(input);
      }
    };

    const handleKey = (ev) => {
      if (ev.key === 'Enter') {
        commitRename();
      } else if (ev.key === 'Escape') {
        cleanup();
      }
    };

    input.addEventListener('blur', commitRename);
    input.addEventListener('keydown', handleKey);
  }

  // Touch handlers for mobile
  handleTouchStart(e) {
    if (!this.img) return;
    
    if (e.touches.length === 2) {
      // Pinch to Zoom initial state
      e.preventDefault();
      this.isPinching = true;
      this.touchStartDist = this.getTouchDistance(e);
      this.touchStartZoom = this.zoomLevel;
      
      const rect = this.container.parentElement.getBoundingClientRect();
      const mid = this.getTouchMidpoint(e);
      const mouseX = mid.x - rect.left;
      const mouseY = mid.y - rect.top;
      
      this.touchStartMid = { x: mouseX, y: mouseY };
      this.touchStartPanX = this.panX;
      this.touchStartPanY = this.panY;
    } else if (e.touches.length === 1) {
      // Single touch - treated as mouse down
      this.handleMouseDown(e);
    }
  }

  handleTouchMove(e) {
    if (!this.img) return;
    
    if (e.touches.length === 2 && this.isPinching) {
      e.preventDefault();
      const dist = this.getTouchDistance(e);
      const zoomFactor = dist / this.touchStartDist;
      
      // Calculate new zoom level
      const newZoom = Math.max(0.1, Math.min(this.touchStartZoom * zoomFactor, 5.0));
      
      // Zoom center calculations (keep midpoint steady)
      const workspaceX = this.touchStartMid.x;
      const workspaceY = this.touchStartMid.y;
      
      const canvasX = (workspaceX - this.touchStartPanX) / this.touchStartZoom;
      const canvasY = (workspaceY - this.touchStartPanY) / this.touchStartZoom;
      
      this.zoomLevel = newZoom;
      this.panX = workspaceX - canvasX * this.zoomLevel;
      this.panY = workspaceY - canvasY * this.zoomLevel;
      
      this.applyViewTransform();
    } else if (e.touches.length === 1 && !this.isPinching) {
      this.handleMouseMove(e);
    }
  }

  handleTouchEnd() {
    this.isPinching = false;
    this.handleMouseUp();
  }

  getTouchDistance(e) {
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  }

  getTouchMidpoint(e) {
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    return {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2
    };
  }

  draw() {
    if (!this.img) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    if (this.showDetectMask && this.detectionMaskCanvas) {
      this.ctx.drawImage(this.detectionMaskCanvas, 0, 0, this.canvas.width, this.canvas.height);
    } else {
      this.ctx.drawImage(this.img, 0, 0);
    }

    // Draw all crop boxes
    this.cropBoxes.forEach(box => {
      const isSelected = box.id === this.selectedBoxId;
      
      // Box border
      this.ctx.strokeStyle = isSelected ? '#ef4444' : 'rgba(239, 68, 68, 0.6)';
      this.ctx.lineWidth = isSelected ? 4 / this.zoomLevel : 2 / this.zoomLevel;
      this.ctx.strokeRect(box.x, box.y, box.w, box.h);

      // Box ID text label overlay
      this.ctx.fillStyle = isSelected ? '#ef4444' : 'rgba(185, 28, 28, 0.8)';
      
      const labelHeight = 20 / this.zoomLevel;
      const fontSize = Math.max(10, Math.round(12 / this.zoomLevel));
      this.ctx.font = `bold ${fontSize}px sans-serif`;
      
      const txt = box.name;
      const textWidth = this.ctx.measureText(txt).width;
      const padding = 8 / this.zoomLevel;
      
      this.ctx.fillRect(box.x, box.y - labelHeight, textWidth + padding * 2, labelHeight);
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillText(txt, box.x + padding, box.y - labelHeight / 3);

      // Draw resize handles on selected box: 4 corners + 4 edge midpoints
      if (isSelected) {
        const H = HANDLE_SIZE / this.zoomLevel;
        const mx = box.x + box.w / 2;
        const my = box.y + box.h / 2;
        const handles = [
          { x: box.x,           y: box.y },           // nw
          { x: mx,              y: box.y },           // n
          { x: box.x + box.w,   y: box.y },           // ne
          { x: box.x + box.w,   y: my },              // e
          { x: box.x + box.w,   y: box.y + box.h },   // se
          { x: mx,              y: box.y + box.h },   // s
          { x: box.x,           y: box.y + box.h },   // sw
          { x: box.x,           y: my },              // w
        ];
        handles.forEach(({ x: hx, y: hy }) => {
          this.ctx.fillStyle = '#ffffff';
          this.ctx.strokeStyle = '#ef4444';
          this.ctx.lineWidth = 2 / this.zoomLevel;
          this.ctx.beginPath();
          this.ctx.rect(hx - H, hy - H, H * 2, H * 2);
          this.ctx.fill();
          this.ctx.stroke();
        });
      }
    });
  }
}
