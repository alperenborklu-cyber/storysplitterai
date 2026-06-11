import fs from 'fs';
import path from 'path';
import { Jimp } from 'jimp';

const DATASET_DIR = './storyboard_dataset_500';
const OUTPUT_FILE = './js/pre_trained_db.js';
const ASPECT_RATIO = 16 / 9;

// Extract features same as learner.js
function extractFeatures(jimpImg) {
  const W = 200;
  const H = Math.round(200 * jimpImg.bitmap.height / jimpImg.bitmap.width);
  
  // Clone and resize
  const resized = jimpImg.clone().resize({ w: W, h: H });
  const data = resized.bitmap.data;
  const N = W * H;

  let sumG = 0;
  let sumG2 = 0;
  let darkCount = 0;
  let brightCount = 0;
  const gray = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    const r = data[i * 4];
    const gVal = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const g = 0.299 * r + 0.587 * gVal + 0.114 * b;
    gray[i] = g;
    sumG += g;
    sumG2 += g * g;
    if (g < 80) darkCount++;
    if (g > 200) brightCount++;
  }
  const meanG = sumG / N;
  const varG = sumG2 / N - meanG * meanG;
  const stdG = Math.sqrt(Math.max(0, varG));

  // Edge density via Sobel-like sum
  let edgeSum = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const gx = gray[y * W + x + 1] - gray[y * W + x - 1];
      const gy = gray[(y + 1) * W + x] - gray[(y - 1) * W + x];
      edgeSum += Math.sqrt(gx * gx + gy * gy);
    }
  }
  const edgeDensity = edgeSum / (N * 255);

  return {
    meanGray: meanG / 255,
    stdGray: stdG / 255,
    darkRatio: darkCount / N,
    brightRatio: brightCount / N,
    edgeDensity: edgeDensity,
    aspectRatio: jimpImg.bitmap.width / jimpImg.bitmap.height
  };
}

function getOtsuThreshold(grayData) {
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

// Simplified version of the NMS box merging
function mergeOverlappingBoxes(boxes, threshold) {
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
      boxes.splice(j, 1);
      boxes.splice(i, 1);
      boxes.push({ x: nx, y: ny, w: nw, h: nh });
      merged = true;
    }
  }
  return boxes;
}

// Run CV edge/enclosure detection
function runDetectionNode(jimpImg, mode, sensitivity, minSize) {
  const imgWidth = jimpImg.bitmap.width;
  const imgHeight = jimpImg.bitmap.height;
  
  const procWidth = 600;
  const scale = procWidth / imgWidth;
  const procHeight = Math.round(imgHeight * scale);

  const resized = jimpImg.clone().resize({ w: procWidth, h: procHeight });
  const data = resized.bitmap.data;
  const len = data.length;

  const gray = new Uint8Array(procWidth * procHeight);
  for (let i = 0; i < len; i += 4) {
    gray[i / 4] = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
  }

  // Edge background detection
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
  const isDarkBackground = (edgeLumSum / edgeSampleCount) < 60;
  const otsuThreshold = getOtsuThreshold(gray);

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
  const minSz = parseInt(minSize);

  let panelInteriors;

  if (mode === 'drawings') {
    const C = Math.max(2, 22 - (sens - 50) * (18 / 48));
    const binary = new Uint8Array(procWidth * procHeight);
    for (let y = 0; y < procHeight; y++) {
      for (let x = 0; x < procWidth; x++) {
        const idx = y * procWidth + x;
        const x1 = Math.max(0, x - halfS), y1 = Math.max(0, y - halfS);
        const x2 = Math.min(procWidth - 1, x + halfS), y2 = Math.min(procHeight - 1, y + halfS);
        const cnt = (x2 - x1 + 1) * (y2 - y1 + 1);
        const iA = y1 > 0 && x1 > 0 ? integral[(y1-1)*procWidth+(x1-1)] : 0;
        const iB = y1 > 0 ? integral[(y1-1)*procWidth+x2] : 0;
        const iC = x1 > 0 ? integral[y2*procWidth+(x1-1)] : 0;
        const iD = integral[y2*procWidth+x2];
        const avg = (iD - iB - iC + iA) / cnt;
        binary[idx] = (gray[idx] < (avg - C) || gray[idx] < 45) ? 1 : 0;
      }
    }

    const R_draw = Math.max(3, Math.min(10, Math.floor(minSz * 0.06)));
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
      // Light background
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

  // Find components
  const componentVisited = new Uint8Array(procWidth * procHeight);
  const detectedBoxes = [];
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

        if (boxW >= minSz && boxH >= (minSz / ASPECT_RATIO)) {
          if (mode === 'enclosed') {
            const pad = R + 1;
            const x1 = Math.max(0, minBoxX - pad);
            const y1 = Math.max(0, minBoxY - pad);
            const x2 = Math.min(procWidth, maxBoxX + pad + 1);
            const y2 = Math.min(procHeight, maxBoxY + pad + 1);
            detectedBoxes.push({
              x: x1 / scale,
              y: y1 / scale,
              w: (x2 - x1) / scale,
              h: (y2 - y1) / scale
            });
          } else {
            detectedBoxes.push({
              x: minBoxX / scale,
              y: minBoxY / scale,
              w: (boxW + 1) / scale,
              h: (boxH + 1) / scale
            });
          }
        }
      }
    }
  }

  return mergeOverlappingBoxes(detectedBoxes, 0.3);
}

// Score function based on CV and coverage
function scoreLayout(boxes, imgWidth, imgHeight) {
  if (boxes.length === 0) return -1000;
  if (boxes.length > 20) return -500;
  if (boxes.length < 2) return -200;

  const imgArea = imgWidth * imgHeight;
  const areas = boxes.map(b => b.w * b.h);
  const totalArea = areas.reduce((s, a) => s + a, 0);
  const coverage = totalArea / imgArea;

  if (coverage < 0.15 || coverage > 0.95) return -300;

  const meanArea = totalArea / boxes.length;
  const varianceArea = areas.reduce((s, a) => s + Math.pow(a - meanArea, 2), 0) / boxes.length;
  const cvArea = meanArea > 0 ? Math.sqrt(varianceArea) / meanArea : 10;

  const ratios = boxes.map(b => b.w / b.h);
  const meanRatio = ratios.reduce((s, r) => s + r, 0) / boxes.length;
  const varianceRatio = ratios.reduce((s, r) => s + Math.pow(r - meanRatio, 2), 0) / boxes.length;
  const cvRatio = meanRatio > 0 ? Math.sqrt(varianceRatio) / meanRatio : 10;

  const cvPenalty = (cvArea * 2.0) + (cvRatio * 1.5);
  const coverageScore = coverage * 100;

  return coverageScore - cvPenalty * 40;
}

// Grid search params for optimal edge detection
async function trainOnImage(filePath) {
  try {
    const jimpImg = await Jimp.read(filePath);
    
    // Check dimensions
    if (jimpImg.bitmap.width < 100 || jimpImg.bitmap.height < 100) return null;

    const features = extractFeatures(jimpImg);

    // Grid search parameters
    const modes = ['enclosed', 'drawings'];
    const sensitivities = [80, 88, 94];
    const minSizes = [80, 130];

    let bestScore = -99999;
    let bestParams = { mode: 'enclosed', sensitivity: 88, minSize: 80, panelCount: 0 };

    for (const mode of modes) {
      for (const sensitivity of sensitivities) {
        for (const minSize of minSizes) {
          const boxes = runDetectionNode(jimpImg, mode, sensitivity, minSize);
          const score = scoreLayout(boxes, jimpImg.bitmap.width, jimpImg.bitmap.height);
          
          if (score > bestScore) {
            bestScore = score;
            bestParams = {
              mode,
              sensitivity,
              minSize,
              panelCount: boxes.length
            };
          }
        }
      }
    }

    if (bestScore > -100) {
      return {
        features,
        sensitivity: bestParams.sensitivity,
        minSize: bestParams.minSize,
        mode: bestParams.mode,
        panelCount: bestParams.panelCount,
        positive: true,
        timestamp: Date.now()
      };
    }
    return null;
  } catch (err) {
    console.error(`Error processing ${filePath}:`, err.message);
    return null;
  }
}

async function main() {
  const datasetDirs = [
    './storyboard_dataset_500',
    './storyboard_dataset',
    './MANGA/train/images',
    './MANGA/valid/images',
    './MANGA/test/images'
  ];

  const allFiles = [];

  for (const dir of datasetDirs) {
    if (!fs.existsSync(dir)) {
      console.log(`Directory ${dir} does not exist. Skipping...`);
      continue;
    }
    const files = fs.readdirSync(dir)
      .filter(f => {
        const ext = path.extname(f).toLowerCase();
        return ext === '.jpg' || ext === '.jpeg' || ext === '.png';
      })
      .map(f => path.join(dir, f));
    
    // Take up to 25 images from each directory to ensure diversity and speed
    const chosen = files.slice(0, 25);
    allFiles.push(...chosen);
    console.log(`Found ${files.length} images in ${dir}, selected ${chosen.length} for training.`);
  }

  console.log(`Total images selected for training: ${allFiles.length}`);

  const samples = [];
  let processed = 0;

  for (const filePath of allFiles) {
    const fileBasename = path.basename(filePath);
    const result = await trainOnImage(filePath);
    processed++;
    
    if (result) {
      samples.push(result);
      console.log(`[${processed}/${allFiles.length}] Trained on ${fileBasename} -> Mode: ${result.mode}, Sens: ${result.sensitivity}%, Panels: ${result.panelCount}`);
    } else {
      console.log(`[${processed}/${allFiles.length}] Skipped ${fileBasename} (No clean panel structure found)`);
    }
  }

  console.log(`Training complete! Collected ${samples.length} high-quality samples.`);

  // Write pre-trained database JS module
  const dbData = {
    samples: samples
  };

  fs.writeFileSync(OUTPUT_FILE, `export const preTrainedDb = ${JSON.stringify(dbData, null, 2)};`);
  console.log(`Saved pre-trained database to ${OUTPUT_FILE}`);
}

main();

