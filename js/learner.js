import { preTrainedDb } from './pre_trained_db.js';

export const AdaptiveLearner = {
  STORAGE_KEY: 'storysplitter_learner_v2',
  MAX_SAMPLES: 120,

  // Load only local samples from localStorage
  loadLocal() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : { samples: [] };
    } catch (e) {
      return { samples: [] };
    }
  },

  // Load combined training database
  load() {
    const localDb = this.loadLocal();
    let pretrainedSamples = [];
    if (preTrainedDb && Array.isArray(preTrainedDb.samples)) {
      pretrainedSamples = preTrainedDb.samples;
    }
    return {
      samples: [...localDb.samples, ...pretrainedSamples]
    };
  },

  // Persist database
  save(db) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(db));
    } catch (e) {}
  },

  // Extract a feature vector from the current image
  extractFeatures(imageEl) {
    const W = 200;
    const H = Math.round(200 * imageEl.height / imageEl.width);
    const tmp = document.createElement('canvas');
    tmp.width = W;
    tmp.height = H;
    const tc = tmp.getContext('2d');
    tc.drawImage(imageEl, 0, 0, W, H);
    const d = tc.getImageData(0, 0, W, H).data;
    const N = W * H;

    let sumG = 0;
    let sumG2 = 0;
    let darkCount = 0;
    let brightCount = 0;
    const gray = new Float32Array(N);

    for (let i = 0; i < N; i++) {
      const g = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
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
      aspectRatio: imageEl.width / imageEl.height
    };
  },

  // Weighted Euclidean distance between two feature objects
  featureDistance(a, b) {
    const W = {
      meanGray: 2.0,
      stdGray: 1.5,
      darkRatio: 1.8,
      brightRatio: 1.2,
      edgeDensity: 2.5,
      aspectRatio: 0.8
    };
    let dist = 0;
    for (const k of Object.keys(W)) {
      const d = (a[k] || 0) - (b[k] || 0);
      dist += W[k] * d * d;
    }
    return Math.sqrt(dist);
  },

  // Given current image features, find k nearest neighbors and compute weighted suggestion
  suggest(features) {
    const db = this.load();
    if (db.samples.length === 0) return null;

    // Compute distances to all samples
    const scored = db.samples.map(s => ({
      sample: s,
      dist: this.featureDistance(features, s.features)
    }));
    scored.sort((a, b) => a.dist - b.dist);

    const k = Math.min(7, scored.length);
    const top = scored.slice(0, k);
    const maxDist = 0.8; // ignore neighbors that are too far

    // Filter by max distance
    const close = top.filter(t => t.dist < maxDist);
    if (close.length === 0) return null;

    // Weighted average (inverse distance weighting)
    let totalW = 0;
    let wSens = 0;
    let wMinSize = 0;
    const modeCounts = {};

    for (const { sample, dist } of close) {
      const w = 1 / (dist + 0.01);
      totalW += w;
      wSens += w * sample.sensitivity;
      wMinSize += w * sample.minSize;
      const modeKey = sample.mode || 'auto';
      modeCounts[modeKey] = (modeCounts[modeKey] || 0) + w;
    }

    const suggestedSens = Math.round(wSens / totalW);
    const suggestedMinSize = Math.round(wMinSize / totalW);
    const suggestedMode = Object.entries(modeCounts).sort((a, b) => b[1] - a[1])[0][0];

    // Confidence: 1.0 = very close neighbor, 0 = max distance
    const bestDist = close[0].dist;
    const confidence = Math.max(0, Math.min(1, 1 - bestDist / maxDist));

    return {
      suggestedSens,
      suggestedMinSize,
      suggestedMode,
      confidence,
      sampleCount: db.samples.length,
      neighborCount: close.length
    };
  },

  addSample(features, sensitivity, minSize, mode, panelCount) {
    const db = this.loadLocal();
    db.samples.push({
      features,
      sensitivity: parseInt(sensitivity),
      minSize: parseInt(minSize),
      mode: mode,
      panelCount: panelCount,
      positive: true,
      timestamp: Date.now()
    });
    if (db.samples.length > this.MAX_SAMPLES) {
      db.samples = db.samples.slice(db.samples.length - this.MAX_SAMPLES);
    }
    this.save(db);
  },

  // Add a NEGATIVE training sample (bad detection - avoid these settings for similar images)
  addNegativeSample(features, sensitivity, minSize, mode) {
    const db = this.loadLocal();
    db.samples.push({
      features,
      sensitivity: parseInt(sensitivity),
      minSize: parseInt(minSize),
      mode: mode,
      panelCount: 0,
      positive: false,
      timestamp: Date.now()
    });
    if (db.samples.length > this.MAX_SAMPLES) {
      db.samples = db.samples.slice(db.samples.length - this.MAX_SAMPLES);
    }
    this.save(db);
  },

  getCountInfo() {
    const localDb = this.loadLocal();
    const localCount = localDb.samples.filter(s => s.positive !== false).length;
    let pretrainedCount = 0;
    if (preTrainedDb && Array.isArray(preTrainedDb.samples)) {
      pretrainedCount = preTrainedDb.samples.filter(s => s.positive !== false).length;
    }
    return {
      total: localCount + pretrainedCount,
      local: localCount,
      pretrained: pretrainedCount
    };
  },

  getCount() {
    return this.getCountInfo().total;
  }
};
