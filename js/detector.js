// ASPECT_RATIO is dynamic property passed to runDetection

export function getOtsuThreshold(grayData) {
  const histogram = new Int32Array(256);
  for (let i = 0; i < grayData.length; i++) {
    histogram[grayData[i]]++;
  }
  const total = grayData.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let sumB = 0, wB = 0, wF = 0, varMax = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    wF = total - wB;
    if (wF === 0) break;
    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > varMax) {
      varMax = varBetween;
      threshold = t;
    }
  }
  return threshold;
}

export function updateDetectionMask(img, mode, sensitivity, minSize) {
  if (!img || !img.src || img.width === 0) return null;

  const procWidth = 1000;
  const scale = procWidth / img.width;
  const procHeight = Math.round(img.height * scale);

  const detectionMaskCanvas = document.createElement('canvas');
  detectionMaskCanvas.width = procWidth;
  detectionMaskCanvas.height = procHeight;
  const pCtx = detectionMaskCanvas.getContext('2d');
  pCtx.drawImage(img, 0, 0, procWidth, procHeight);

  const imgData = pCtx.getImageData(0, 0, procWidth, procHeight);
  const data = imgData.data;
  const len = data.length;

  const gray = new Uint8Array(procWidth * procHeight);
  for (let i = 0; i < len; i += 4) {
    gray[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  let edgeLumSum = 0, edgeSampleCount = 0;
  const edgeThickness = 3;
  for (let x = 0; x < procWidth; x++) {
    for (let t = 0; t < edgeThickness; t++) {
      edgeLumSum += gray[t * procWidth + x]; // top rows
      edgeLumSum += gray[(procHeight - 1 - t) * procWidth + x]; // bottom rows
      edgeSampleCount += 2;
    }
  }
  for (let y = edgeThickness; y < procHeight - edgeThickness; y++) {
    for (let t = 0; t < edgeThickness; t++) {
      edgeLumSum += gray[y * procWidth + t]; // left cols
      edgeLumSum += gray[y * procWidth + (procWidth - 1 - t)]; // right cols
      edgeSampleCount += 2;
    }
  }
  const meanEdgeLum = edgeLumSum / edgeSampleCount;
  const isDarkBackground = meanEdgeLum < 60;

  const otsuThreshold = getOtsuThreshold(gray);

  let count = 0;
  let maxGray = 255;
  const targetCount = gray.length * 0.98;
  const histogram = new Int32Array(256);
  for (let i = 0; i < gray.length; i++) histogram[gray[i]]++;
  for (let i = 0; i < 256; i++) {
    count += histogram[i];
    if (count >= targetCount) {
      maxGray = i;
      break;
    }
  }

  const integral = new Uint32Array(procWidth * procHeight);
  for (let y = 0; y < procHeight; y++) {
    let sum = 0;
    for (let x = 0; x < procWidth; x++) {
      const idx = y * procWidth + x;
      sum += gray[idx];
      integral[idx] = y > 0 ? integral[(y - 1) * procWidth + x] + sum : sum;
    }
  }

  const S = 31;
  const halfS = Math.floor(S / 2);
  const sens = parseInt(sensitivity);

  const activeMode = mode === 'auto' ? 'enclosed' : mode;

  let panelInteriors;

  if (activeMode === 'drawings') {
    const C = Math.max(2, 22 - (sens - 50) * (18 / 48));
    const binary = new Uint8Array(procWidth * procHeight);
    for (let y = 0; y < procHeight; y++) {
      for (let x = 0; x < procWidth; x++) {
        const idx = y * procWidth + x;
        const x1 = Math.max(0, x - halfS), y1 = Math.max(0, y - halfS);
        const x2 = Math.min(procWidth - 1, x + halfS), y2 = Math.min(procHeight - 1, y + halfS);
        const cnt = (x2 - x1 + 1) * (y2 - y1 + 1);
        const iA = y1 > 0 && x1 > 0 ? integral[(y1 - 1) * procWidth + (x1 - 1)] : 0;
        const iB = y1 > 0 ? integral[(y1 - 1) * procWidth + x2] : 0;
        const iC = x1 > 0 ? integral[y2 * procWidth + (x1 - 1)] : 0;
        const iD = integral[y2 * procWidth + x2];
        const avg = (iD - iB - iC + iA) / cnt;
        binary[idx] = (gray[idx] < (avg - C) || gray[idx] < 45) ? 1 : 0;
      }
    }

    const R_draw = Math.max(3, Math.min(10, Math.floor(parseInt(minSize) * 0.06)));
    const dilatedH = new Uint8Array(procWidth * procHeight);
    for (let y = 0; y < procHeight; y++) {
      let lastActive = -10000;
      for (let x = 0; x < procWidth; x++) {
        const idx = y * procWidth + x;
        if (binary[idx] === 1) lastActive = x;
        if (x - lastActive <= R_draw) dilatedH[idx] = 1;
      }
      lastActive = 100000;
      for (let x = procWidth - 1; x >= 0; x--) {
        const idx = y * procWidth + x;
        if (binary[idx] === 1) lastActive = x;
        if (lastActive - x <= R_draw) dilatedH[idx] = 1;
      }
    }

    panelInteriors = new Uint8Array(procWidth * procHeight);
    for (let x = 0; x < procWidth; x++) {
      let lastActive = -10000;
      for (let y = 0; y < procHeight; y++) {
        const idx = y * procWidth + x;
        if (dilatedH[idx] === 1) lastActive = y;
        if (y - lastActive <= R_draw) panelInteriors[idx] = 1;
      }
      lastActive = 100000;
      for (let y = procHeight - 1; y >= 0; y--) {
        const idx = y * procWidth + x;
        if (dilatedH[idx] === 1) lastActive = y;
        if (lastActive - y <= R_draw) panelInteriors[idx] = 1;
      }
    }
  } else {
    // Enclosed Mode
    if (isDarkBackground) {
      const sensT = sens / 98.0;
      const brightThreshold = Math.round(otsuThreshold * (1.0 - sensT * 0.4) + 60 * sensT * 0.4);
      const brightMask = new Uint8Array(procWidth * procHeight);
      for (let i = 0; i < gray.length; i++) {
        brightMask[i] = gray[i] >= brightThreshold ? 1 : 0;
      }

      const R_close = Math.max(4, Math.round(procWidth * 0.004));
      const dilH = new Uint8Array(procWidth * procHeight);
      for (let y = 0; y < procHeight; y++) {
        let lastActive = -R_close - 1;
        for (let x = 0; x < procWidth; x++) {
          if (brightMask[y * procWidth + x] === 1) lastActive = x;
          if (x - lastActive <= R_close) dilH[y * procWidth + x] = 1;
        }
        lastActive = procWidth + R_close;
        for (let x = procWidth - 1; x >= 0; x--) {
          if (brightMask[y * procWidth + x] === 1) lastActive = x;
          if (lastActive - x <= R_close) dilH[y * procWidth + x] = 1;
        }
      }

      const dilV = new Uint8Array(procWidth * procHeight);
      for (let x = 0; x < procWidth; x++) {
        let lastActive = -R_close - 1;
        for (let y = 0; y < procHeight; y++) {
          if (dilH[y * procWidth + x] === 1) lastActive = y;
          if (y - lastActive <= R_close) dilV[y * procWidth + x] = 1;
        }
        lastActive = procHeight + R_close;
        for (let y = procHeight - 1; y >= 0; y--) {
          if (dilH[y * procWidth + x] === 1) lastActive = y;
          if (lastActive - y <= R_close) dilV[y * procWidth + x] = 1;
        }
      }

      const bgVisited = new Uint8Array(procWidth * procHeight);
      const queue = [];

      for (let x = 0; x < procWidth; x++) {
        if (dilV[x] === 0) { bgVisited[x] = 1; queue.push(x); }
        const bot = (procHeight - 1) * procWidth + x;
        if (dilV[bot] === 0) { bgVisited[bot] = 1; queue.push(bot); }
      }
      for (let y = 1; y < procHeight - 1; y++) {
        if (dilV[y * procWidth] === 0) { bgVisited[y * procWidth] = 1; queue.push(y * procWidth); }
        const r = y * procWidth + (procWidth - 1);
        if (dilV[r] === 0) { bgVisited[r] = 1; queue.push(r); }
      }

      let head = 0;
      while (head < queue.length) {
        const curIdx = queue[head++];
        const cx = curIdx % procWidth;
        const cy = Math.floor(curIdx / procWidth);
        const neighbors = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < procWidth && ny >= 0 && ny < procHeight) {
            const nIdx = ny * procWidth + nx;
            if (dilV[nIdx] === 0 && bgVisited[nIdx] === 0) {
              bgVisited[nIdx] = 1;
              queue.push(nIdx);
            }
          }
        }
      }

      panelInteriors = new Uint8Array(procWidth * procHeight);
      for (let i = 0; i < panelInteriors.length; i++) {
        if (dilV[i] === 1 && bgVisited[i] === 0) panelInteriors[i] = 1;
      }
    } else {
      // Light background path
      const C = Math.max(2, 22 - (sens - 50) * (18 / 48));
      const binary = new Uint8Array(procWidth * procHeight);
      for (let y = 0; y < procHeight; y++) {
        for (let x = 0; x < procWidth; x++) {
          const idx = y * procWidth + x;
          const x1 = Math.max(0, x - halfS), y1 = Math.max(0, y - halfS);
          const x2 = Math.min(procWidth - 1, x + halfS), y2 = Math.min(procHeight - 1, y + halfS);
          const cnt = (x2 - x1 + 1) * (y2 - y1 + 1);
          const iA = y1 > 0 && x1 > 0 ? integral[(y1 - 1) * procWidth + (x1 - 1)] : 0;
          const iB = y1 > 0 ? integral[(y1 - 1) * procWidth + x2] : 0;
          const iC = x1 > 0 ? integral[y2 * procWidth + (x1 - 1)] : 0;
          const iD = integral[y2 * procWidth + x2];
          const avg = (iD - iB - iC + iA) / cnt;
          binary[idx] = (gray[idx] < (avg - C) || gray[idx] < 45) ? 1 : 0;
        }
      }

      const R = 4;
      const dilatedH = new Uint8Array(procWidth * procHeight);
      for (let y = 0; y < procHeight; y++) {
        let lastActive = -10000;
        for (let x = 0; x < procWidth; x++) {
          const idx = y * procWidth + x;
          if (binary[idx] === 1) lastActive = x;
          if (x - lastActive <= R) dilatedH[idx] = 1;
        }
        lastActive = 100000;
        for (let x = procWidth - 1; x >= 0; x--) {
          const idx = y * procWidth + x;
          if (binary[idx] === 1) lastActive = x;
          if (lastActive - x <= R) dilatedH[idx] = 1;
        }
      }

      const dilatedBorders = new Uint8Array(procWidth * procHeight);
      for (let x = 0; x < procWidth; x++) {
        let lastActive = -10000;
        for (let y = 0; y < procHeight; y++) {
          const idx = y * procWidth + x;
          if (dilatedH[idx] === 1) lastActive = y;
          if (y - lastActive <= R) dilatedBorders[idx] = 1;
        }
        lastActive = 100000;
        for (let y = procHeight - 1; y >= 0; y--) {
          const idx = y * procWidth + x;
          if (dilatedH[idx] === 1) lastActive = y;
          if (lastActive - y <= R) dilatedBorders[idx] = 1;
        }
      }

      const visited = new Uint8Array(procWidth * procHeight);
      const queue = [];
      for (let x = 0; x < procWidth; x++) {
        const topIdx = x;
        if (dilatedBorders[topIdx] === 0) { visited[topIdx] = 1; queue.push(topIdx); }
        const botIdx = (procHeight - 1) * procWidth + x;
        if (dilatedBorders[botIdx] === 0) { visited[botIdx] = 1; queue.push(botIdx); }
      }
      for (let y = 0; y < procHeight; y++) {
        const leftIdx = y * procWidth;
        if (dilatedBorders[leftIdx] === 0 && visited[leftIdx] === 0) { visited[leftIdx] = 1; queue.push(leftIdx); }
        const rightIdx = y * procWidth + (procWidth - 1);
        if (dilatedBorders[rightIdx] === 0 && visited[rightIdx] === 0) { visited[rightIdx] = 1; queue.push(rightIdx); }
      }

      for (let x = 0; x < procWidth; x++) {
        dilatedBorders[x] = 1;
        dilatedBorders[(procHeight - 1) * procWidth + x] = 1;
      }
      for (let y = 0; y < procHeight; y++) {
        dilatedBorders[y * procWidth] = 1;
        dilatedBorders[y * procWidth + (procWidth - 1)] = 1;
      }

      let head = 0;
      while (head < queue.length) {
        const curIdx = queue[head++];
        const cx = curIdx % procWidth;
        const cy = Math.floor(curIdx / procWidth);
        const neighbors = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < procWidth && ny >= 0 && ny < procHeight) {
            const nIdx = ny * procWidth + nx;
            if (dilatedBorders[nIdx] === 0 && visited[nIdx] === 0) {
              visited[nIdx] = 1;
              queue.push(nIdx);
            }
          }
        }
      }

      panelInteriors = new Uint8Array(procWidth * procHeight);
      for (let i = 0; i < panelInteriors.length; i++) {
        if (dilatedBorders[i] === 0 && visited[i] === 0) panelInteriors[i] = 1;
      }
    }
  }

  // Draw mask
  const outData = pCtx.createImageData(procWidth, procHeight);
  for (let i = 0; i < panelInteriors.length; i++) {
    const val = panelInteriors[i] === 1 ? 0 : 255;
    const idx = i * 4;
    outData.data[idx] = outData.data[idx + 1] = outData.data[idx + 2] = val;
    outData.data[idx + 3] = 255;
  }
  pCtx.putImageData(outData, 0, 0);

  return {
    maskCanvas: detectionMaskCanvas,
    panelInteriors,
    scale,
    procWidth,
    procHeight,
    detectedMode: activeMode,
    isDarkBackground
  };
}

function histogramCount(gray, val) {
  let count = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] === val) count++;
  }
  return count;
}

export function mergeOverlappingBoxes(boxes, threshold) {
  let merged = true;
  while (merged) {
    merged = false;
    const n = boxes.length;
    let toMerge = null;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const x1 = Math.max(a.x, b.x);
        const y1 = Math.max(a.y, b.y);
        const x2 = Math.min(a.x + a.w, b.x + b.w);
        const y2 = Math.min(a.y + a.h, b.y + b.h);
        if (x2 > x1 && y2 > y1) {
          const interArea = (x2 - x1) * (y2 - y1);
          const minArea = Math.min(a.w * a.h, b.w * b.h);
          if (interArea / minArea > threshold) {
            toMerge = [i, j];
            break;
          }
        }
      }
      if (toMerge) break;
    }
    if (toMerge) {
      const i = toMerge[0];
      const j = toMerge[1];
      const a = boxes[i];
      const b = boxes[j];
      const nx = Math.min(a.x, b.x);
      const ny = Math.min(a.y, b.y);
      const nw = Math.max(a.x + a.w, b.x + b.w) - nx;
      const nh = Math.max(a.y + a.h, b.y + b.h) - ny;
      const type = a.type || b.type;
      boxes.splice(j, 1);
      boxes.splice(i, 1);
      boxes.push({ x: nx, y: ny, w: nw, h: nh, type: type });
      merged = true;
    }
  }
  return boxes;
}

export function generateGrid(cols, rows, width, height, gapX, gapY, offsetX, offsetY) {
  const cropBoxes = [];
  const c = parseInt(cols) || 1;
  const r = parseInt(rows) || 1;
  const w = parseInt(width) || 320;
  const h = parseInt(height) || 180;
  const gX = parseInt(gapX) || 0;
  const gY = parseInt(gapY) || 0;
  const offX = parseInt(offsetX) || 0;
  const offY = parseInt(offsetY) || 0;

  let id = 1;
  for (let ri = 0; ri < r; ri++) {
    for (let ci = 0; ci < c; ci++) {
      const x = offX + ci * (w + gX);
      const y = offY + ri * (h + gY);
      cropBoxes.push({
        id: id++,
        x: x,
        y: y,
        w: w,
        h: h,
        name: `Panel ${id - 1}`
      });
    }
  }
  return cropBoxes;
}

export function detectGrid(img, sensitivity, minSize, trimTextBoxes) {
  if (!img || !img.src || img.width === 0) return [];

  const procWidth = 600;
  const scale = procWidth / img.width;
  const procHeight = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = procWidth;
  canvas.height = procHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, procWidth, procHeight);

  const imgData = ctx.getImageData(0, 0, procWidth, procHeight);
  const data = imgData.data;

  const gray = new Uint8Array(procWidth * procHeight);
  for (let i = 0; i < data.length; i += 4) {
    gray[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
  }

  let edgeLumSum = 0, edgeSampleCount = 0;
  const edgeThickness = 3;
  for (let x = 0; x < procWidth; x++) {
    for (let t = 0; t < edgeThickness; t++) {
      edgeLumSum += gray[t * procWidth + x];
      edgeLumSum += gray[(procHeight - 1 - t) * procWidth + x];
      edgeSampleCount += 2;
    }
  }
  for (let y = edgeThickness; y < procHeight - edgeThickness; y++) {
    for (let t = 0; t < edgeThickness; t++) {
      edgeLumSum += gray[y * procWidth + t];
      edgeLumSum += gray[y * procWidth + (procWidth - 1 - t)];
      edgeSampleCount += 2;
    }
  }
  const meanEdgeLum = edgeLumSum / edgeSampleCount;
  const isDarkBackground = meanEdgeLum < 60;
  const sens = parseInt(sensitivity);

  const bgLimit = Math.max(220, Math.min(254, 210 + (sens - 50) * 1.1));
  const bgLimit_dark = Math.max(15, Math.min(90, 75 - (sens - 50) * 1.2));

  const isNonBg = (val) => isDarkBackground ? (val > bgLimit_dark) : (val < bgLimit);

  const rowActiveCount = new Int32Array(procHeight);
  for (let y = 0; y < procHeight; y++) {
    let active = 0;
    for (let x = 0; x < procWidth; x++) {
      if (isNonBg(gray[y * procWidth + x])) active++;
    }
    rowActiveCount[y] = active;
  }

  const rowThresh = procWidth * 0.03;
  const rowSegments = [];
  let inRow = false;
  let rowStart = 0;
  for (let y = 0; y < procHeight; y++) {
    if (rowActiveCount[y] > rowThresh) {
      if (!inRow) {
        rowStart = y;
        inRow = true;
      }
    } else {
      if (inRow) {
        rowSegments.push({ start: rowStart, end: y - 1 });
        inRow = false;
      }
    }
  }
  if (inRow) rowSegments.push({ start: rowStart, end: procHeight - 1 });

  const minRowHeight = Math.max(25, Math.floor(parseInt(minSize) * scale * 0.5));
  const filteredRows = rowSegments.filter(r => (r.end - r.start) >= minRowHeight);

  const detectedBoxes = [];

  for (const row of filteredRows) {
    const rowH = row.end - row.start + 1;
    
    const colGutterScore = new Float32Array(procWidth);
    for (let x = 0; x < procWidth; x++) {
      let bgPixels = 0;
      for (let y = row.start; y <= row.end; y++) {
        if (!isNonBg(gray[y * procWidth + x])) bgPixels++;
      }
      colGutterScore[x] = bgPixels / rowH;
    }

    const colActive = new Uint8Array(procWidth);
    for (let x = 0; x < procWidth; x++) {
      colActive[x] = (colGutterScore[x] < 0.90) ? 1 : 0;
    }

    let colSegments = [];
    let inCol = false;
    let colStart = 0;
    for (let x = 0; x < procWidth; x++) {
      if (colActive[x] === 1) {
        if (!inCol) {
          colStart = x;
          inCol = true;
        }
      } else {
        if (inCol) {
          colSegments.push({ start: colStart, end: x - 1 });
          inCol = false;
        }
      }
    }
    if (inCol) colSegments.push({ start: colStart, end: procWidth - 1 });

    const minColWidth = Math.max(15, Math.floor(parseInt(minSize) * scale * 0.3));
    let filteredCols = colSegments.filter(c => (c.end - c.start) >= minColWidth);

    if (filteredCols.length > 0) {
      const trueWCols = filteredCols.filter(c => (c.end - c.start + 1) >= Math.max(30, minColWidth * 2));
      const widths = trueWCols.map(c => c.end - c.start + 1);
      
      if (widths.length > 0) {
        widths.sort((a, b) => a - b);
        const medianW = widths[Math.floor(widths.length / 2)];

        let merged = true;
        while (merged) {
          merged = false;
          for (let i = 0; i < filteredCols.length - 1; i++) {
            const gap = filteredCols[i+1].start - filteredCols[i].end - 1;
            if (gap <= Math.max(3, medianW * 0.08)) {
              filteredCols[i].end = filteredCols[i+1].end;
              filteredCols.splice(i + 1, 1);
              merged = true;
              break;
            }
          }
        }

        const finalCols = [];
        for (const col of filteredCols) {
          const colW = col.end - col.start + 1;
          if (colW < medianW * 0.4) {
            continue;
          }
          
          if (colW > medianW * 1.4) {
            const numPanels = Math.max(2, Math.round(colW / medianW));
            let currentStart = col.start;
            const step = colW / numPanels;
            
            for (let p = 1; p < numPanels; p++) {
              const expectedSplitIdx = Math.round(col.start + p * step);
              const searchWin = Math.max(5, Math.round(medianW * 0.15));
              let bestSplitX = expectedSplitIdx;
              let maxScore = -1;
              
              for (let x = expectedSplitIdx - searchWin; x <= expectedSplitIdx + searchWin; x++) {
                if (x >= col.start && x <= col.end) {
                  if (colGutterScore[x] > maxScore) {
                    maxScore = colGutterScore[x];
                    bestSplitX = x;
                  }
                }
              }
              
              finalCols.push({ start: currentStart, end: bestSplitX - 1 });
              currentStart = bestSplitX;
            }
            finalCols.push({ start: currentStart, end: col.end });
          } else {
            finalCols.push(col);
          }
        }
        filteredCols = finalCols;
      }
    }

    for (const col of filteredCols) {
      const colW = col.end - col.start + 1;
      let photoStartY = row.start;
      let photoEndY = row.end;

      if (trimTextBoxes) {
        const topSearchLimit = Math.min(row.end, row.start + Math.round(rowH * 0.45));
        
        // Cache ratios for the entire row to avoid redundant calculation
        const ratios = [];
        for (let y = row.start; y <= row.end; y++) {
          let activeCount = 0;
          for (let x = col.start; x <= col.end; x++) {
            if (isNonBg(gray[y * procWidth + x])) activeCount++;
          }
          ratios.push(activeCount / colW);
        }

        // Downward scan for photo start
        for (let y = row.start; y <= topSearchLimit; y++) {
          const idx = y - row.start;
          if (ratios[idx] >= 0.55) {
            // Check if next 5 rows also have high ratio on average (sustained image region)
            let sum = 0;
            let count = 0;
            for (let dy = 1; dy <= 5; dy++) {
              if (idx + dy < ratios.length) {
                sum += ratios[idx + dy];
                count++;
              }
            }
            if (count > 0 && (sum / count) >= 0.55) {
              photoStartY = y;
              break;
            }
          }
        }

        // Upward scan for photo end
        for (let y = row.end; y >= photoStartY + 20; y--) {
          const idx = y - row.start;
          if (idx < ratios.length && ratios[idx] >= 0.55) {
            // Check if previous 5 rows (above this one) also have high ratio on average
            let sum = 0;
            let count = 0;
            for (let dy = 1; dy <= 5; dy++) {
              if (idx - dy >= 0) {
                sum += ratios[idx - dy];
                count++;
              }
            }
            if (count > 0 && (sum / count) >= 0.55) {
              photoEndY = y;
              break;
            }
          }
        }
      }

      detectedBoxes.push({
        x: col.start / scale,
        y: photoStartY / scale,
        w: colW / scale,
        h: (photoEndY - photoStartY + 1) / scale,
        type: 'grid'
      });
    }
  }

  return detectedBoxes;
}

export function runDetection(img, mode, sensitivity, minSize, trimTextBoxes, aspectRatioValue = 16 / 9) {
  if (!img || !img.src || img.width === 0) return [];

  let finalBoxes = [];
  let finalScale = 1.0;
  let finalModeUsed = 'enclosed';

  function detectEnclosed() {
    const result = updateDetectionMask(img, 'enclosed', sensitivity, minSize);
    if (!result) return [];
    const { panelInteriors, scale, procWidth, procHeight, isDarkBackground } = result;
    const componentVisited = new Uint8Array(procWidth * procHeight);
    const detectedBoxes = [];
    const minSz = parseInt(minSize);
    const R = 4;

    for (let y = 0; y < procHeight; y++) {
      for (let x = 0; x < procWidth; x++) {
        const idx = y * procWidth + x;
        if (panelInteriors[idx] === 1 && componentVisited[idx] === 0) {
          let minBoxX = x, maxBoxX = x;
          let minBoxY = y, maxBoxY = y;

          const compQueue = [idx];
          componentVisited[idx] = 1;
          let compHead = 0;

          while (compHead < compQueue.length) {
            const curIdx = compQueue[compHead++];
            const cx = curIdx % procWidth;
            const cy = Math.floor(curIdx / procWidth);

            if (cx < minBoxX) minBoxX = cx;
            if (cx > maxBoxX) maxBoxX = cx;
            if (cy < minBoxY) minBoxY = cy;
            if (cy > maxBoxY) maxBoxY = cy;

            const neighbors = [
              [cx - 1, cy],
              [cx + 1, cy],
              [cx, cy - 1],
              [cx, cy + 1]
            ];
            for (const [nx, ny] of neighbors) {
              if (nx >= 0 && nx < procWidth && ny >= 0 && ny < procHeight) {
                const nIdx = ny * procWidth + nx;
                if (panelInteriors[nIdx] === 1 && componentVisited[nIdx] === 0) {
                  componentVisited[nIdx] = 1;
                  compQueue.push(nIdx);
                }
              }
            }
          }

          const boxW = maxBoxX - minBoxX;
          const boxH = maxBoxY - minBoxY;

          if (boxW >= minSz && boxH >= (minSz / aspectRatioValue)) {
            const R_close = Math.max(4, Math.round(procWidth * 0.004));
            const pad = isDarkBackground ? -R_close : (R + 1);
            const x1 = Math.max(0, minBoxX - pad);
            const y1 = Math.max(0, minBoxY - pad);
            const x2 = Math.min(procWidth, maxBoxX + pad + 1);
            const y2 = Math.min(procHeight, maxBoxY + pad + 1);
            detectedBoxes.push({
              x: x1 / scale,
              y: y1 / scale,
              w: (x2 - x1) / scale,
              h: (y2 - y1) / scale,
              type: 'enclosed'
            });
          }
        }
      }
    }
    finalScale = scale;
    return detectedBoxes;
  }

  function detectDrawings() {
    const result = updateDetectionMask(img, 'drawings', sensitivity, minSize);
    if (!result) return [];
    const { panelInteriors, scale, procWidth, procHeight } = result;
    const componentVisited = new Uint8Array(procWidth * procHeight);
    const detectedBoxes = [];
    const minSz = parseInt(minSize);

    for (let y = 0; y < procHeight; y++) {
      for (let x = 0; x < procWidth; x++) {
        const idx = y * procWidth + x;
        if (panelInteriors[idx] === 1 && componentVisited[idx] === 0) {
          let minBoxX = x, maxBoxX = x;
          let minBoxY = y, maxBoxY = y;

          const compQueue = [idx];
          componentVisited[idx] = 1;
          let compHead = 0;

          while (compHead < compQueue.length) {
            const curIdx = compQueue[compHead++];
            const cx = curIdx % procWidth;
            const cy = Math.floor(curIdx / procWidth);

            if (cx < minBoxX) minBoxX = cx;
            if (cx > maxBoxX) maxBoxX = cx;
            if (cy < minBoxY) minBoxY = cy;
            if (cy > maxBoxY) maxBoxY = cy;

            const neighbors = [
              [cx - 1, cy],
              [cx + 1, cy],
              [cx, cy - 1],
              [cx, cy + 1]
            ];
            for (const [nx, ny] of neighbors) {
              if (nx >= 0 && nx < procWidth && ny >= 0 && ny < procHeight) {
                const nIdx = ny * procWidth + nx;
                if (panelInteriors[nIdx] === 1 && componentVisited[nIdx] === 0) {
                  componentVisited[nIdx] = 1;
                  compQueue.push(nIdx);
                }
              }
            }
          }

          const boxW = maxBoxX - minBoxX;
          const boxH = maxBoxY - minBoxY;

          if (boxW >= minSz && boxH >= (minSz / aspectRatioValue)) {
            detectedBoxes.push({
              x: minBoxX / scale,
              y: minBoxY / scale,
              w: (boxW + 1) / scale,
              h: (boxH + 1) / scale,
              type: 'drawings'
            });
          }
        }
      }
    }
    finalScale = scale;
    return detectedBoxes;
  }

  if (mode === 'grid') {
    finalBoxes = detectGrid(img, sensitivity, minSize, trimTextBoxes);
    finalModeUsed = 'grid';
  } else if (mode === 'enclosed') {
    finalBoxes = detectEnclosed();
    finalModeUsed = 'enclosed';
  } else if (mode === 'drawings') {
    finalBoxes = detectDrawings();
    finalModeUsed = 'drawings';
  } else {
    // Auto Hybrid - Try Structured Grid first, fallback if less than 2 panels found
    const gridBoxes = detectGrid(img, sensitivity, minSize, trimTextBoxes);
    if (gridBoxes.length >= 2) {
      finalBoxes = gridBoxes;
      finalModeUsed = 'grid';
    } else {
      const enclosed = detectEnclosed();
      const drawings = detectDrawings();

    const getCVScore = (boxes) => {
      const areas = boxes.map(b => b.w * b.h);
      const ratios = boxes.map(b => b.w / b.h);
      const meanArea = areas.reduce((s, val) => s + val, 0) / areas.length;
      const stdArea = Math.sqrt(areas.reduce((s, val) => s + Math.pow(val - meanArea, 2), 0) / areas.length);
      const cvArea = meanArea > 0 ? (stdArea / meanArea) : 999;

      const meanRatio = ratios.reduce((s, val) => s + val, 0) / ratios.length;
      const stdRatio = Math.sqrt(ratios.reduce((s, val) => s + Math.pow(val - meanRatio, 2), 0) / ratios.length);
      const cvRatio = meanRatio > 0 ? (stdRatio / meanRatio) : 999;

      return cvArea * 1.5 + cvRatio;
    };

    if (enclosed.length === 0 && drawings.length === 0) {
      finalBoxes = [];
      finalModeUsed = 'enclosed';
    } else if (enclosed.length > 0 && drawings.length === 0) {
      finalBoxes = enclosed;
      finalModeUsed = 'enclosed';
    } else if (drawings.length > 0 && enclosed.length === 0) {
      finalBoxes = drawings;
      finalModeUsed = 'drawings';
    } else {
      if (enclosed.length >= 2 && drawings.length < 2) {
        finalBoxes = enclosed;
        finalModeUsed = 'enclosed';
      } else if (drawings.length >= 2 && enclosed.length < 2) {
        finalBoxes = drawings;
        finalModeUsed = 'drawings';
      } else {
        const diff = Math.abs(enclosed.length - drawings.length);
        if (diff >= 2) {
          if (enclosed.length > drawings.length) {
            finalBoxes = enclosed;
            finalModeUsed = 'enclosed';
          } else {
            finalBoxes = drawings;
            finalModeUsed = 'drawings';
          }
        } else {
          const scoreEnc = getCVScore(enclosed);
          const scoreDraw = getCVScore(drawings);
          if (scoreDraw < scoreEnc) {
            finalBoxes = drawings;
            finalModeUsed = 'drawings';
          } else {
            finalBoxes = enclosed;
            finalModeUsed = 'enclosed';
          }
        }
      }
    }
  }
}

  // Filter out any box that represents the entire grid/sheet (i.e. too large)
  finalBoxes = finalBoxes.filter(box => {
    return !(box.w > img.width * 0.85 && box.h > img.height * 0.85);
  });

  // Overlap NMS
  finalBoxes = mergeOverlappingBoxes(finalBoxes, 0.3);

  // Sorting
  finalBoxes.sort((a, b) => a.y - b.y);
  const rowsList = [];
  if (finalBoxes.length > 0) {
    const avgH = finalBoxes.reduce((sum, box) => sum + box.h, 0) / finalBoxes.length;
    const tolerance = avgH * 0.5;

    let currentRow = [finalBoxes[0]];
    rowsList.push(currentRow);

    for (let i = 1; i < finalBoxes.length; i++) {
      const box = finalBoxes[i];
      const prevBox = finalBoxes[i - 1];
      if (Math.abs(box.y - prevBox.y) <= tolerance) {
        currentRow.push(box);
      } else {
        currentRow = [box];
        rowsList.push(currentRow);
      }
    }
  }
  rowsList.forEach(row => row.sort((a, b) => a.x - b.x));
  finalBoxes = rowsList.flat();

  // Whitespace bottom trimmer setup
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = img.width;
  tempCanvas.height = img.height;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(img, 0, 0);
  const fullImgData = tempCtx.getImageData(0, 0, img.width, img.height);

  function isRowWhite(startX, endX, y) {
    let whiteCount = 0;
    const total = endX - startX + 1;
    for (let x = startX; x <= endX; x++) {
      const idx = (y * img.width + x) * 4;
      const r = fullImgData.data[idx];
      const g = fullImgData.data[idx + 1];
      const b = fullImgData.data[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum > 220) whiteCount++;
    }
    return (whiteCount / total) > 0.95;
  }

  const results = finalBoxes.map((box, i) => {
    let w = box.w;
    let h = box.h;
    let x = box.x;
    let y = box.y;

    if (box.type === 'enclosed' && trimTextBoxes) {
      const imgX = Math.round(x);
      const imgY = Math.round(y);
      const imgW = Math.round(w);
      const imgH = Math.round(h);

      let trimmedH = imgH;
      let consecutiveWhiteRows = 0;
      const minGapRows = Math.max(3, Math.floor(imgH * 0.04));

      for (let curY = imgY + imgH - 1; curY >= imgY + imgH * 0.25; curY--) {
        if (curY >= img.height || curY < 0) continue;
        if (isRowWhite(imgX, imgX + imgW - 1, curY)) {
          consecutiveWhiteRows++;
        } else {
          if (consecutiveWhiteRows >= minGapRows) {
            trimmedH = (curY - imgY) + 1;
            break;
          }
          consecutiveWhiteRows = 0;
        }
      }
      h = Math.min(imgH, trimmedH + 2);
    }

    return {
      id: i + 1,
      x: Math.max(0, Math.min(x, img.width - w)),
      y: Math.max(0, Math.min(y, img.height - h)),
      w: w,
      h: h,
      name: `Panel ${i + 1}`,
      type: box.type
    };
  });

  return {
    boxes: results,
    modeUsed: finalModeUsed
  };
}
