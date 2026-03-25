import { useState, useCallback, useEffect, useRef } from "react";
import {
  ComposedChart, Area, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";

// ─── MATH UTILITIES ───────────────────────────────────────────────────────────

function randn() {
  let u, v;
  do { u = Math.random(); } while (u === 0);
  do { v = Math.random(); } while (v === 0);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function poisson(λ) {
  if (λ <= 0) return 0;
  const L = Math.exp(-Math.min(λ, 500));
  let p = 1, k = 0;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

// Marsaglia-Tsang gamma sampler (shape, scale parameterisation)
function sampleGamma(shape, scale = 1) {
  if (shape < 1) return sampleGamma(1 + shape, scale) * Math.pow(Math.random(), 1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x = randn(), v = 1 + c * x;
    if (v <= 0) continue;
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

function pctile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.max(0, Math.min(s.length - 1, Math.round(p * (s.length - 1))))];
}

function skewness(arr) {
  const n = arr.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const s2 = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const s3 = arr.reduce((a, b) => a + (b - mean) ** 3, 0) / n;
  return s3 / Math.pow(s2, 1.5);
}

function excessKurtosis(arr) {
  const n = arr.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const s2 = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const s4 = arr.reduce((a, b) => a + (b - mean) ** 4, 0) / n;
  return s4 / (s2 * s2) - 3;
}

// ─── MONTE CARLO ENGINE ───────────────────────────────────────────────────────

const N_PATHS         = 800;
const N_PATHS_COMPARE = 400;
const STEPS_PER_MONTH = 16;

function simulate(cfg, nPaths = N_PATHS) {
  const {
    S0, horizon, model,
    drift, vol,
    kappa = 0.45, longRun = 70,
    jumpLambda = 4, jumpMu = -6, jumpSig = 16,
    backwardation = 7,
    hestonV0 = 0.14, hestonThetaV = 0.14, hestonSigmaV = 0.40, hestonRho = -0.60,
    ssKappa = 3.0, ssSigmaChi = 0.25, ssSigmaXi = 0.15, ssRho = 0.30,
    vgNu = 0.20, vgTheta = -0.10,
    fedDelta = 0, spxMood = 0, geoRisk = 3.5, opecTight = 5, vix = 20,
    dxy = 0, realRate = 0, inflation = 0, inventory = 0,
    seasonal = false, seasonalAmp = 4, startMonth = 0,
  } = cfg;

  const μ0 = drift / 100;
  const σ0 = Math.max(vol / 100, 0.01);
  const dt = 1 / (12 * STEPS_PER_MONTH);

  // ── VIX channels (three independent pathways) ─────────────────────────────
  const VIX_NEUTRAL  = 20;
  const vixExcess    = Math.max(0, vix - VIX_NEUTRAL);
  const σ_vix_scale  = 1 + (vixExcess / 10) * 0.08;           // vol scaling
  const λ_vix_scale  = Math.pow(Math.max(vix, 1) / VIX_NEUTRAL, 1.4); // jump amp
  const Δμ_vix       = -vixExcess * 0.018;                     // demand-fear drift

  // ── Composite macro drift adjustment ──────────────────────────────────────
  const Δμ = (
    -(fedDelta / 100) * 0.35          // Fed → USD strength
    + (spxMood  / 100) * 0.42         // risk-on / risk-off
    + (geoRisk  / 10)  * 0.065        // geopolitical premium
    + (opecTight / 10) * 0.055        // OPEC supply discipline
    + Δμ_vix                           // VIX demand-fear
    - (dxy       / 100) * 0.90        // DXY appreciation
    - (realRate  / 100) * 0.28        // real rate opportunity cost
    + (inflation / 100) * 0.35        // inflation hedge demand
    - (inventory / 100) * 0.08        // EIA inventory excess
  );

  const μ   = μ0 + Δμ;
  const σ   = σ0 * (1 + (geoRisk / 10) * 0.55) * σ_vix_scale;
  const λ_y = jumpLambda * (1 + (geoRisk / 10) * 1.8) * λ_vix_scale;

  const paths = [];

  for (let i = 0; i < nPaths; i++) {
    const path = [S0];
    let S      = S0;
    let lnS    = Math.log(S0);
    let regime = Math.random() < 0.65 ? 0 : 1;
    let v      = Math.max(hestonV0, 1e-6);   // Heston variance
    let chi    = 0;                           // SS2 short-run factor
    let xi     = Math.log(S0);               // SS2 long-run factor

    for (let step = 1; step <= horizon * STEPS_PER_MONTH; step++) {
      const z = randn();
      const monthFrac   = startMonth + step / STEPS_PER_MONTH;
      const seasonDrift = seasonal
        ? (seasonalAmp / 100) * Math.sin(2 * Math.PI * monthFrac / 12) * dt
        : 0;

      switch (model) {
        // ── 1. GBM ──────────────────────────────────────────────────────────
        case 'gbm': {
          S *= Math.exp((μ - 0.5 * σ * σ) * dt + seasonDrift + σ * Math.sqrt(dt) * z);
          break;
        }
        // ── 2. Schwartz mean-reversion (log-OU) ─────────────────────────────
        case 'ou': {
          const lnθ = Math.log(Math.max(longRun, 1));
          lnS += kappa * (lnθ - lnS) * dt + seasonDrift + σ * Math.sqrt(dt) * z;
          S = Math.exp(lnS);
          break;
        }
        // ── 3. Merton jump-diffusion ─────────────────────────────────────────
        case 'jump': {
          const λ_dt = λ_y * dt;                           // Poisson param for this sub-step
          const nJ   = poisson(λ_dt);
          const jMu  = jumpMu / 100, jSig = jumpSig / 100;
          let J = 0;
          for (let j = 0; j < nJ; j++) J += jMu + jSig * randn();
          // FIX: comp is the *annual* compensation rate; it multiplies dt inside the exponent
          const comp = λ_y * (Math.exp(jMu + 0.5 * jSig * jSig) - 1);
          S *= Math.exp((μ - 0.5 * σ * σ - comp) * dt + seasonDrift + σ * Math.sqrt(dt) * z + J);
          break;
        }
        // ── 4. Hamilton regime-switching ─────────────────────────────────────
        case 'regime': {
          const rp = [
            { μ: μ + 0.22, σ: σ * 0.62 },
            { μ: μ - 0.10, σ: σ * 1.28 },
            { μ: μ - 0.52, σ: σ * 2.90 },
          ];
          const P = [
            [0.934, 0.061, 0.005],
            [0.055, 0.895, 0.050],
            [0.048, 0.168, 0.784],
          ];
          const r = Math.random();
          let c = 0;
          for (let s = 0; s < 3; s++) { c += P[regime][s]; if (r < c) { regime = s; break; } }
          const { μ: rμ, σ: rσ } = rp[regime];
          S *= Math.exp((rμ - 0.5 * rσ * rσ) * dt + seasonDrift + rσ * Math.sqrt(dt) * z);
          break;
        }
        // ── 5. Futures-implied forward curve ─────────────────────────────────
        case 'futures': {
          // FIX: rollYield is an *annual* rate; no /12 — the * dt inside the exp handles scaling
          const rollYield = -(backwardation / 100);
          S *= Math.exp((μ + rollYield - 0.5 * σ * σ) * dt + seasonDrift + σ * Math.sqrt(dt) * z);
          break;
        }
        // ── 6. Heston stochastic volatility ──────────────────────────────────
        case 'heston': {
          const vPos = Math.max(v, 1e-6);
          const rhoH = Math.max(-0.999, Math.min(0.999, hestonRho));
          const z2   = rhoH * z + Math.sqrt(1 - rhoH * rhoH) * randn();
          S *= Math.exp((μ - 0.5 * vPos) * dt + seasonDrift + Math.sqrt(vPos * dt) * z);
          v  += 2.0 * (hestonThetaV - vPos) * dt + hestonSigmaV * Math.sqrt(vPos * dt) * z2;
          v   = Math.max(v, 1e-6);
          lnS = Math.log(Math.max(S, 0.5));
          break;
        }
        // ── 7. Schwartz-Smith two-factor ─────────────────────────────────────
        case 'ss2': {
          const rhoS = Math.max(-0.999, Math.min(0.999, ssRho));
          const z2   = rhoS * z + Math.sqrt(1 - rhoS * rhoS) * randn();
          chi += -ssKappa * chi * dt + ssSigmaChi * Math.sqrt(dt) * z;
          xi  += (μ - 0.5 * ssSigmaXi * ssSigmaXi) * dt + seasonDrift + ssSigmaXi * Math.sqrt(dt) * z2;
          S    = Math.exp(chi + xi);
          lnS  = chi + xi;
          break;
        }
        // ── 8. Variance-Gamma (skewness + excess kurtosis) ───────────────────
        case 'vg': {
          const sigVG   = Math.max(σ, 0.01);
          const nuVG    = Math.max(vgNu, 0.01);
          const thetaVG = vgTheta;
          const safeArg = 1 - thetaVG * nuVG - 0.5 * sigVG * sigVG * nuVG;
          if (safeArg <= 0) { S *= Math.exp(μ * dt + σ * Math.sqrt(dt) * z); break; }
          // FIX: Jensen correction ω = +ln(safeArg)/ν so E[S(t+dt)/S(t)] = exp(μ·dt)
          const omega = Math.log(safeArg) / nuVG;
          const G     = sampleGamma(dt / nuVG, nuVG);
          const X     = thetaVG * G + sigVG * Math.sqrt(G) * z;
          S *= Math.exp((μ + omega) * dt + seasonDrift + X);
          lnS = Math.log(Math.max(S, 0.5));
          break;
        }
      }

      S   = Math.max(S, 0.5);
      lnS = Math.log(S);
      if (step % STEPS_PER_MONTH === 0) path.push(S);
    }
    paths.push(path);
  }

  // ── Fan chart percentile bands ────────────────────────────────────────────
  const fanData = Array.from({ length: horizon + 1 }, (_, m) => {
    const vals = paths.map(p => p[m]);
    const p5   = pctile(vals, 0.05), p10 = pctile(vals, 0.10);
    const p25  = pctile(vals, 0.25), p50 = pctile(vals, 0.50);
    const p75  = pctile(vals, 0.75), p90 = pctile(vals, 0.90);
    const p95  = pctile(vals, 0.95);
    return {
      m, label: m === 0 ? 'Spot' : `M${m}`,
      p5, p10, p25, p50, p75, p90, p95,
      base: p5,
      d1: p10 - p5, d2: p25 - p10, d3: p50 - p25,
      d4: p75 - p50, d5: p90 - p75, d6: p95 - p90,
    };
  });

  // ── Terminal histogram ────────────────────────────────────────────────────
  const term = paths.map(p => p[horizon]);
  const tLo  = Math.max(1, pctile(term, 0.005));
  const tHi  = pctile(term, 0.995) * 1.02;
  const BINS = 44;
  const bw   = (tHi - tLo) / BINS;
  const histData = Array.from({ length: BINS }, (_, i) => {
    const lo = tLo + i * bw, hi = lo + bw;
    return { price: lo + bw / 2, freq: term.filter(v => v >= lo && v < hi).length / nPaths * 100 };
  });

  const sorted = [...term].sort((a, b) => a - b);
  const mean   = term.reduce((a, b) => a + b, 0) / nPaths;
  const p5t    = pctile(term, 0.05);
  const p10t   = pctile(term, 0.10);
  const p25t   = pctile(term, 0.25);
  const p50t   = pctile(term, 0.50);
  const p75t   = pctile(term, 0.75);
  const p90t   = pctile(term, 0.90);
  const p95t   = pctile(term, 0.95);
  const cvar5  = sorted.slice(0, Math.max(1, Math.floor(0.05 * nPaths))).reduce((a, b) => a + b, 0)
                 / Math.max(1, Math.floor(0.05 * nPaths));
  const cvar10 = sorted.slice(0, Math.max(1, Math.floor(0.10 * nPaths))).reduce((a, b) => a + b, 0)
                 / Math.max(1, Math.floor(0.10 * nPaths));
  const probUp   = term.filter(v => v > S0).length / nPaths * 100;
  const crash20  = term.filter(v => v < S0 * 0.80).length / nPaths * 100;
  const rally20  = term.filter(v => v > S0 * 1.20).length / nPaths * 100;
  const skew     = skewness(term);
  const kurt     = excessKurtosis(term);

  return {
    fanData, histData, term,
    stats: { mean, median: p50t, p5t, p10t, p25t, p75t, p90t, p95t,
             cvar5, cvar10, probUp, crash20, rally20, skew, kurt },
  };
}

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────

const C = {
  bg0:    '#050b1a', bg1: '#080f22', bg2: '#0b1630', card: '#0e1c3a',
  border: '#17305e', border2: '#1e3f7a',
  amber: '#f5a623', amberD: '#c8830f', amberL: '#fde68a',
  blue:  '#38bdf8', blueD: '#0284c7',
  green: '#10b981', red: '#f43f5e',
  violet:'#a78bfa', orange:'#fb923c', emerald:'#34d399', pink:'#f472b6',
  t1: '#e2e8f0', t2: '#94a3b8', t3: '#475569', t4: '#2d3f5f',
};

const MODEL_COLORS = {
  gbm: C.blue, ou: C.green, jump: C.red, regime: C.violet,
  futures: C.amber, heston: C.orange, ss2: C.emerald, vg: C.pink,
};

// ─── MODELS ───────────────────────────────────────────────────────────────────

const MODELS = [
  { id: 'gbm',     short: 'GBM',       name: 'Black-Scholes GBM',          refs: 'Black & Scholes (1973)' },
  { id: 'ou',      short: 'Mean-Rev',  name: 'Schwartz Mean-Reversion',     refs: 'Schwartz (1997)' },
  { id: 'jump',    short: 'Jump-Diff', name: 'Merton Jump-Diffusion',       refs: 'Merton (1976)' },
  { id: 'regime',  short: 'Regime-Sw', name: 'Hamilton Regime-Switching',   refs: 'Hamilton (1989)' },
  { id: 'futures', short: 'Futures',   name: 'Futures-Implied Fwd Curve',   refs: 'Brennan & Schwartz (1985)' },
  { id: 'heston',  short: 'Heston',    name: 'Heston Stochastic Vol',       refs: 'Heston (1993)' },
  { id: 'ss2',     short: 'SS2-Factor',name: 'Schwartz-Smith Two-Factor',   refs: 'Schwartz & Smith (2000)' },
  { id: 'vg',      short: 'Var-Gamma', name: 'Variance-Gamma (Skewness)',   refs: 'Madan et al. (1998)' },
];

// ─── PADD REGIONAL DATA ─────────────────────────────────────────────────────

const PADDS = [
  { id: 'national', short: 'US Avg',   label: 'National Average',      color: C.amber,   wtiLinkage: 0.92, taxMargin: 0.820, spreadPassThrough: 0.60, notes: 'Weighted average of all PADD districts' },
  { id: 'padd1',    short: 'East Coast',label: 'PADD 1 — East Coast',  color: C.blue,    wtiLinkage: 0.78, taxMargin: 0.920, spreadPassThrough: 0.35, notes: 'Brent-linked imports; highest state taxes (NY, PA, CT)' },
  { id: 'padd2',    short: 'Midwest',   label: 'PADD 2 — Midwest',     color: C.green,   wtiLinkage: 0.97, taxMargin: 0.760, spreadPassThrough: 0.80, notes: 'Cushing hub; near-pure WTI linkage; moderate taxes' },
  { id: 'padd3',    short: 'Gulf Coast',label: 'PADD 3 — Gulf Coast',  color: C.orange,  wtiLinkage: 0.98, taxMargin: 0.680, spreadPassThrough: 0.85, notes: 'Refinery corridor; lowest taxes (TX, LA); highest WTI linkage' },
  { id: 'padd4',    short: 'Rockies',   label: 'PADD 4 — Rocky Mtn',   color: C.violet,  wtiLinkage: 0.94, taxMargin: 0.790, spreadPassThrough: 0.70, notes: 'Landlocked; WTI-Cushing + pipeline basis; thin margins' },
  { id: 'padd5',    short: 'West Coast',label: 'PADD 5 — West Coast',  color: C.pink,    wtiLinkage: 0.65, taxMargin: 1.180, spreadPassThrough: 0.25, notes: 'ANS/Brent-linked; CA LCFS + cap-and-trade; highest retail' },
];

// ─── HISTORICAL SCENARIOS ────────────────────────────────────────────────────

const SCENARIOS = [
  {
    id: 's1973', era: '1973', label: 'Arab Oil Embargo',
    date: 'Oct 1973 – Mar 1974', impact: '+280%',
    desc: 'OAPEC embargo following Yom Kippur War. Production cut of ~5 Mb/d; WTI equivalent tripled to ~$12/bbl.',
    params: { model: 'jump', drift: 35, vol: 70, jumpLambda: 14, jumpMu: 38, jumpSig: 22, geoRisk: 9.5, opecTight: 1, vix: 46, spxMood: -24, fedDelta: 200, dxy: 5, inventory: -80 },
  },
  {
    id: 's1979', era: '1979', label: 'Iranian Revolution',
    date: 'Jan 1979 – Oct 1980', impact: '+130%',
    desc: 'Iranian production collapse (−4.8 Mb/d) followed by Iran-Iraq war. WTI from ~$14 to ~$35/bbl.',
    params: { model: 'jump', drift: 22, vol: 62, jumpLambda: 12, jumpMu: 30, jumpSig: 20, geoRisk: 9, opecTight: 2, vix: 42, spxMood: -12, fedDelta: 1100, inventory: -65 },
  },
  {
    id: 's1982', era: '1980s', label: 'Volcker Tightening / Demand Bust',
    date: '1980 – 1986', impact: '−68%',
    desc: 'Record real interest rates crushed demand; non-OPEC supply surged; OPEC quota war. WTI fell from $35 to $11.',
    params: { model: 'ou', drift: -18, vol: 55, kappa: 0.8, longRun: 18, geoRisk: 2, opecTight: 1, vix: 28, fedDelta: 2000, realRate: 8, inflation: 10, dxy: 18, inventory: 120 },
  },
  {
    id: 's1990', era: '1990', label: 'Gulf War',
    date: 'Aug – Oct 1990', impact: '+115%',
    desc: 'Iraq invasion of Kuwait removed ~4.3 Mb/d. WTI spiked from $17 to $46 in two months.',
    params: { model: 'jump', drift: 10, vol: 58, jumpLambda: 10, jumpMu: 32, jumpSig: 18, geoRisk: 8.5, opecTight: 6, vix: 38, spxMood: -15, fedDelta: 0, inventory: -55 },
  },
  {
    id: 's1998', era: '1997-98', label: 'Asian Financial Crisis',
    date: 'Nov 1997 – Dec 1998', impact: '−55%',
    desc: 'Demand implosion across Asia; OPEC raised production into the downturn. WTI from $22 to $11.',
    params: { model: 'regime', drift: -22, vol: 48, geoRisk: 1.5, opecTight: 1, vix: 44, spxMood: -30, fedDelta: 0, inventory: 110, dxy: 12 },
  },
  {
    id: 's2001', era: '2001', label: 'Post-9/11 Shock',
    date: 'Sep – Dec 2001', impact: '−38%',
    desc: 'Travel and industrial demand collapsed; geopolitical uncertainty spiked. WTI from $30 to $18.',
    params: { model: 'jump', drift: -14, vol: 52, jumpLambda: 8, jumpMu: -22, jumpSig: 18, geoRisk: 8.5, opecTight: 4, vix: 43, spxMood: -34, fedDelta: -475 },
  },
  {
    id: 's2003', era: '2003', label: 'Iraq War Invasion',
    date: 'Mar – May 2003', impact: '+45%',
    desc: 'Pre-war supply-disruption premium; WTI hit $40 on eve of invasion then fell as war ended quickly.',
    params: { model: 'jump', drift: 12, vol: 44, jumpLambda: 8, jumpMu: 22, jumpSig: 15, geoRisk: 7.5, opecTight: 5, vix: 33, spxMood: 8, fedDelta: -50, inventory: -40 },
  },
  {
    id: 's2008', era: '2008', label: 'Financial Crisis',
    date: 'Jul – Dec 2008', impact: '−78%',
    desc: 'Lehman collapse triggered the largest demand shock in oil history. WTI from $147 to $32 in five months.',
    params: { model: 'jump', drift: -38, vol: 88, jumpLambda: 15, jumpMu: -38, jumpSig: 32, geoRisk: 4, opecTight: 1, vix: 78, spxMood: -45, fedDelta: 425, inventory: 145, dxy: 15 },
  },
  {
    id: 's2011', era: '2011', label: 'Arab Spring / Libya',
    date: 'Feb – Apr 2011', impact: '+35%',
    desc: 'Libyan output (~1.6 Mb/d) halted; regional contagion fears. WTI hit $114. Brent premium widened to $20+.',
    params: { model: 'jump', drift: 18, vol: 42, jumpLambda: 8, jumpMu: 22, jumpSig: 14, geoRisk: 8, opecTight: 6, vix: 30, spxMood: 6, fedDelta: 0, inventory: -48 },
  },
  {
    id: 's2014', era: '2014-16', label: 'OPEC Supply Glut',
    date: 'Jun 2014 – Jan 2016', impact: '−76%',
    desc: 'Saudi Arabia refused to cut as US shale surged. Record inventory builds; WTI from $107 to $26.',
    params: { model: 'futures', drift: -28, vol: 48, backwardation: -22, geoRisk: 1.5, opecTight: 1, vix: 26, spxMood: -12, fedDelta: 25, inventory: 175, dxy: 20 },
  },
  {
    id: 's2020', era: '2020', label: 'COVID-19 Collapse',
    date: 'Feb – Apr 2020', impact: '−130%',
    desc: 'Global lockdowns cut demand by 30 Mb/d; WTI spot briefly negative (−$37). Worst supply glut in history.',
    params: { model: 'jump', drift: -45, vol: 95, jumpLambda: 16, jumpMu: -48, jumpSig: 35, geoRisk: 2.5, opecTight: 1, vix: 66, spxMood: -38, fedDelta: -150, inventory: 210, backwardation: -30 },
  },
  {
    id: 's2022', era: '2022', label: 'Russia-Ukraine War',
    date: 'Feb – Jun 2022', impact: '+75%',
    desc: 'Russian invasion removed ~3 Mb/d from global supply; sanctions fragmented the market. WTI from $78 to $130.',
    params: { model: 'jump', drift: 22, vol: 56, jumpLambda: 10, jumpMu: 32, jumpSig: 20, geoRisk: 9, opecTight: 6, vix: 37, spxMood: -18, fedDelta: 450, inventory: -70, dxy: 14 },
  },
];

// ─── GASOLINE CONVERSION (3-2-1 crack spread) ─────────────────────────────────

function wtiToGasoline(wti, regionId = 'national', brentSpread = 0) {
  const r = PADDS.find(d => d.id === regionId) ?? PADDS[0];
  const crudeInput = (wti + 27) / 42;
  const spreadAdj  = r.wtiLinkage * brentSpread * r.spreadPassThrough / 42;
  return crudeInput + spreadAdj + r.taxMargin;
}
function fmtGas(wti, regionId = 'national', brentSpread = 0) {
  return `$${wtiToGasoline(wti, regionId, brentSpread).toFixed(2)}`;
}

// ─── CSV EXPORT ───────────────────────────────────────────────────────────────

function downloadCSV(fanData) {
  const hdr = 'Month,P5,P10,P25,Median,P75,P90,P95,Gas_P5,Gas_Median,Gas_P95\n';
  const rows = fanData.map(d =>
    [d.label,
     d.p5?.toFixed(2), d.p10?.toFixed(2), d.p25?.toFixed(2),
     d.p50?.toFixed(2), d.p75?.toFixed(2), d.p90?.toFixed(2), d.p95?.toFixed(2),
     wtiToGasoline(d.p5 ?? 0).toFixed(3),
     wtiToGasoline(d.p50 ?? 0).toFixed(3),
     wtiToGasoline(d.p95 ?? 0).toFixed(3),
    ].join(',')
  ).join('\n');
  const blob = new Blob([hdr + rows], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'oil-price-forecast.csv'; a.click();
  URL.revokeObjectURL(url);
}

// ─── TOOLTIP COMPONENTS ───────────────────────────────────────────────────────

function FanTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: '10px 14px', fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5,
      boxShadow: '0 8px 32px rgba(0,0,0,0.65)' }}>
      <div style={{ color: C.amber, fontWeight: 600, marginBottom: 8, fontSize: 13 }}>{d.label}</div>
      {[['95th', d.p95, C.t3], ['75th', d.p75, C.t2], ['Median', d.p50, C.amberL],
        ['25th', d.p25, C.t2], ['5th', d.p5, C.t3]].map(([k, v, clr]) => (
        <div key={k} style={{ color: clr, display: 'flex', justifyContent: 'space-between', gap: 20, marginBottom: 2 }}>
          <span>{k}</span><span>${v?.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

function HistTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { price, freq } = payload[0]?.payload || {};
  return (
    <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: '8px 12px', fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5,
      boxShadow: '0 8px 32px rgba(0,0,0,0.65)' }}>
      <div style={{ color: C.t1 }}>${price?.toFixed(2)}/bbl</div>
      <div style={{ color: C.amber }}>{freq?.toFixed(2)}%</div>
    </div>
  );
}

function CompareTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: '10px 14px', fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
      boxShadow: '0 8px 32px rgba(0,0,0,0.65)' }}>
      <div style={{ color: C.t2, marginBottom: 7, fontSize: 12 }}>{label}</div>
      {payload.filter(p => p.dataKey.endsWith('_p50')).map(p => (
        <div key={p.dataKey} style={{ color: p.color, display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 2 }}>
          <span>{p.dataKey.replace('_p50', '').toUpperCase()}</span>
          <span>${p.value?.toFixed(1)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── UI PRIMITIVES ────────────────────────────────────────────────────────────

function SectionLabel({ children }) {
  return (
    <div style={{ color: C.t3, fontSize: 9.5, fontFamily: "'DM Sans', sans-serif",
      fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
      marginBottom: 12, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>
      {children}
    </div>
  );
}

function SliderRow({ label, value, min, max, step = 1, onChange, fmt, hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ color: C.t2, fontSize: 11.5, fontFamily: "'DM Sans', sans-serif" }}>{label}</span>
        <span style={{ color: C.amber, fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }}>
          {fmt ? fmt(value) : value}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', cursor: 'pointer', accentColor: C.amber }} />
      {hint && <div style={{ color: C.t4, fontSize: 10, fontFamily: "'DM Sans', sans-serif", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function StatBox({ label, value, sub, color = C.amber }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 14px' }}>
      <div style={{ color: C.t3, fontSize: 9.5, fontFamily: "'DM Sans', sans-serif",
        fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 5 }}>{label}</div>
      <div style={{ color, fontSize: 18, fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ color: C.t3, fontSize: 10, fontFamily: "'DM Sans', sans-serif", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function TabBtn({ id, active, onClick, children }) {
  return (
    <button onClick={() => onClick(id)} style={{
      background: 'transparent',
      color: active ? C.amber : C.t3,
      border: 'none', borderBottom: `2px solid ${active ? C.amber : 'transparent'}`,
      padding: '7px 14px', cursor: 'pointer', fontSize: 12,
      fontFamily: "'DM Sans', sans-serif", fontWeight: active ? 600 : 400,
      marginBottom: -1, whiteSpace: 'nowrap', transition: 'color 0.15s',
    }}>
      {children}
    </button>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

export default function OilPriceCalc() {

  const defaultP = {
    S0: 72.50, horizon: 12, model: 'gbm',
    drift: 2.5, vol: 38,
    kappa: 0.45, longRun: 70,
    jumpLambda: 4, jumpMu: -6, jumpSig: 16,
    backwardation: 7,
    hestonV0: 0.14, hestonThetaV: 0.14, hestonSigmaV: 0.40, hestonRho: -0.60,
    ssKappa: 3.0, ssSigmaChi: 0.25, ssSigmaXi: 0.15, ssRho: 0.30,
    vgNu: 0.20, vgTheta: -0.10,
    fedDelta: 0, spxMood: 0, geoRisk: 3.5, opecTight: 5, vix: 20,
    dxy: 0, realRate: 0, inflation: 0, inventory: 0,
    seasonal: false, seasonalAmp: 4, startMonth: 0,
    brentSpread: -3.5, selectedRegion: 'national',
    priceTarget: 90,
    compareModels: ['gbm', 'ou', 'jump', 'regime', 'futures'],
  };

  const [p, setP]                 = useState(defaultP);
  const [results, setResults]     = useState(null);
  const [compareRes, setCompareRes] = useState(null);
  const [busy, setBusy]           = useState(false);
  const [busyCmp, setBusyCmp]     = useState(false);
  const [sideTab, setSideTab]     = useState('params');
  const [chartTab, setChartTab]   = useState('fan');
  const [appliedScenario, setAppliedScenario] = useState(null);
  const [fetchStatus, setFetchStatus] = useState('idle'); // idle | loading | ok | err
  const [lastFetched, setLastFetched] = useState(null);   // { wti, vix, ts }
  const debMain = useRef(null);
  const debCmp  = useRef(null);

  const set = useCallback((key, val) => setP(prev => ({ ...prev, [key]: val })), []);

  // Main simulation
  useEffect(() => {
    clearTimeout(debMain.current);
    debMain.current = setTimeout(() => {
      setBusy(true);
      setTimeout(() => {
        try { setResults(simulate(p)); } catch (e) { console.error(e); }
        setBusy(false);
      }, 20);
    }, 300);
    return () => clearTimeout(debMain.current);
  }, [p]);

  // Comparison simulation (only when Compare tab is active)
  useEffect(() => {
    if (chartTab !== 'compare') return;
    clearTimeout(debCmp.current);
    debCmp.current = setTimeout(() => {
      setBusyCmp(true);
      setTimeout(() => {
        try {
          const cmpResults = {};
          for (const mId of p.compareModels) {
            const r = simulate({ ...p, model: mId }, N_PATHS_COMPARE);
            cmpResults[mId] = r.fanData;
          }
          // Merge into single array for recharts
          const merged = Array.from({ length: p.horizon + 1 }, (_, i) => {
            const obj = { label: i === 0 ? 'Spot' : `M${i}` };
            for (const mId of p.compareModels) {
              const fd = cmpResults[mId]?.[i];
              if (fd) {
                obj[`${mId}_p50`] = fd.p50;
                obj[`${mId}_p25`] = fd.p25;
                obj[`${mId}_p75`] = fd.p75;
                obj[`${mId}_base`] = fd.p25;
                obj[`${mId}_band`] = fd.p75 - fd.p25;
              }
            }
            return obj;
          });
          setCompareRes(merged);
        } catch (e) { console.error(e); }
        setBusyCmp(false);
      }, 20);
    }, 500);
    return () => clearTimeout(debCmp.current);
  }, [p, chartTab]);

  function applyScenario(sc) {
    setP(prev => ({ ...prev, ...sc.params }));
    setAppliedScenario(sc.id);
    setSideTab('params');
  }

  function toggleCompareModel(mId) {
    setP(prev => {
      const arr = prev.compareModels.includes(mId)
        ? prev.compareModels.filter(m => m !== mId)
        : [...prev.compareModels, mId];
      return { ...prev, compareModels: arr.length ? arr : prev.compareModels };
    });
  }

  // ── Live price fetch via Yahoo Finance (CORS proxy) ───────────────────────
  // Fetches: CL=F (WTI spot), ^OVX (crude oil implied vol),
  //          ^VIX (equity fear), WTI M1+M6 contracts (futures curve slope)

  function getWTIContractTicker(monthsOut) {
    // Returns Yahoo Finance ticker for WTI futures N months forward
    // e.g. CL=F=M1, CLM26.NYM=June 2026
    const CODES = 'FGHJKMNQUVXZ'; // Jan–Dec month codes
    const now   = new Date();
    const tgt   = new Date(now.getFullYear(), now.getMonth() + monthsOut, 1);
    return `CL${CODES[tgt.getMonth()]}${String(tgt.getFullYear()).slice(-2)}.NYM`;
  }

  async function fetchLivePrices() {
    setFetchStatus('loading');
    const proxy = 'https://corsproxy.io/?';

    const fetchQuote = async (ticker) => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`;
      const res  = await fetch(proxy + encodeURIComponent(url));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const meta = json?.chart?.result?.[0]?.meta;
      if (!meta) throw new Error('No data for ' + ticker);
      const price = meta.regularMarketPrice ?? meta.previousClose;
      if (!price || price <= 0) throw new Error('Zero price for ' + ticker);
      return parseFloat(price);
    };

    try {
      // ── Core fetch: spot, OVX, equity VIX ───────────────────────────────
      const [wtiRaw, ovxRaw, vixRaw] = await Promise.all([
        fetchQuote('CL=F'),
        fetchQuote('^OVX'),
        fetchQuote('^VIX'),
      ]);

      const wti = parseFloat(wtiRaw.toFixed(2));
      const ovx = parseFloat(ovxRaw.toFixed(1));   // CBOE Crude Oil VIX, %
      const vix = Math.round(vixRaw);

      // ── Futures curve: try M1 vs M6, fall back to M3 ─────────────────────
      let curveSlopePct = null;  // annualised %/yr, + = backwardation
      let curveLabel    = null;
      try {
        const m6Ticker = getWTIContractTicker(6);
        const m6Price  = await fetchQuote(m6Ticker);
        // Annualised convenience yield from 5-month spread
        curveSlopePct  = (Math.log(wtiRaw / m6Price) / (5 / 12)) * 100;
        curveLabel     = `M6 (${m6Ticker.slice(2, 5)})`;
      } catch {
        try {
          const m3Ticker = getWTIContractTicker(3);
          const m3Price  = await fetchQuote(m3Ticker);
          curveSlopePct  = (Math.log(wtiRaw / m3Price) / (2 / 12)) * 100;
          curveLabel     = `M3 (${m3Ticker.slice(2, 5)})`;
        } catch {
          // Curve fetch failed — leave backwardation slider unchanged
        }
      }

      // ── Heston V₀ from OVX: V₀ = (OVX/100)² ─────────────────────────────
      const hestonV0fromOVX    = parseFloat(Math.pow(ovx / 100, 2).toFixed(3));
      // Long-run variance: blend current OVX² with historical mean (~35%² = 0.1225)
      const hestonThetaFromOVX = parseFloat(((hestonV0fromOVX + 0.1225) / 2).toFixed(3));

      // ── Apply to params ───────────────────────────────────────────────────
      setP(prev => {
        const updates = {
          S0:           wti,
          vix:          Math.min(80, Math.max(9, vix)),
          hestonV0:     Math.min(0.80, Math.max(0.01, hestonV0fromOVX)),
          hestonThetaV: Math.min(0.80, Math.max(0.01, hestonThetaFromOVX)),
        };
        if (curveSlopePct !== null) {
          updates.backwardation = Math.round(Math.max(-30, Math.min(30, curveSlopePct)));
        }
        return { ...prev, ...updates };
      });

      setLastFetched({
        wti, ovx, vix,
        curveSlopePct: curveSlopePct !== null ? parseFloat(curveSlopePct.toFixed(1)) : null,
        curveLabel,
        ts: new Date().toLocaleTimeString(),
      });
      setFetchStatus('ok');

    } catch (e) {
      console.error('Live fetch failed:', e);
      setFetchStatus('err');
      setTimeout(() => setFetchStatus('idle'), 4000);
    }
  }

  const model     = MODELS.find(m => m.id === p.model);
  const fmtD      = v => `$${v.toFixed(2)}`;
  const fmtPct    = v => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  const pTarget   = parseFloat(p.priceTarget) || 90;
  const probAbove = results ? (results.term.filter(v => v > pTarget).length / results.term.length * 100) : null;
  const probBelow = results ? (results.term.filter(v => v < pTarget).length / results.term.length * 100) : null;

  // Effective parameter display
  const vixExcess = Math.max(0, p.vix - 20);
  const effDrift  = p.drift
    - (p.fedDelta / 100) * 35
    + p.spxMood * 0.42
    + (p.geoRisk / 10) * 6.5
    + (p.opecTight / 10) * 5.5
    - vixExcess * 1.8
    - (p.dxy / 100) * 90
    - (p.realRate / 100) * 28
    + (p.inflation / 100) * 35
    - (p.inventory / 100) * 8;
  const effVol    = p.vol * (1 + (p.geoRisk / 10) * 0.55) * (1 + (vixExcess / 10) * 0.08);

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: C.bg0, color: C.t1, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        input[type=range]{-webkit-appearance:none;width:100%;height:3px;background:${C.border};border-radius:2px;outline:none}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:${C.amber};cursor:pointer;border:2px solid ${C.bg0}}
        input[type=range]::-moz-range-thumb{width:13px;height:13px;border-radius:50%;background:${C.amber};cursor:pointer;border:2px solid ${C.bg0}}
        input[type=number]{background:${C.bg2};border:1px solid ${C.border};color:${C.t1};border-radius:7px;padding:9px 13px;font-family:'JetBrains Mono',monospace;font-size:20px;width:100%;outline:none}
        input[type=number]:focus{border-color:${C.amber}}
        input[type=text]{background:${C.bg2};border:1px solid ${C.border};color:${C.t1};border-radius:7px;padding:7px 11px;font-family:'JetBrains Mono',monospace;font-size:14px;width:100%;outline:none}
        input[type=text]:focus{border-color:${C.amber}}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:${C.bg1}}
        ::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        .pulse{animation:pulse 1.2s ease-in-out infinite}
        @keyframes fadein{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        .fadein{animation:fadein .3s ease forwards}
        .sc-card{transition:border-color .18s,background .18s}
        .sc-card:hover{border-color:${C.amber}!important;background:${C.card}!important;cursor:pointer}
        .btn-amber{transition:all .15s;cursor:pointer}
        .btn-amber:hover{background:${C.amberD}!important}
        @media(max-width:800px){.layout{flex-direction:column!important}.sidebar{width:100%!important;border-right:none!important;border-bottom:1px solid ${C.border}!important}}
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ background: C.bg1, borderBottom: `1px solid ${C.border}`,
        padding: '13px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 38, height: 38, borderRadius: 9,
          background: `linear-gradient(135deg,${C.amberD},${C.amber})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
          ⛽
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700,
            color: C.t1, letterSpacing: 0.2, lineHeight: 1.2 }}>
            Oil & Gasoline Price Expectations
          </h1>
          <div style={{ color: C.t3, fontSize: 10, letterSpacing: '0.09em', marginTop: 1 }}>
            8 Models · Monte Carlo · VIX-Integrated · 12 Historical Scenarios · Model Comparison
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {(busy || busyCmp) && (
            <div className="pulse" style={{ display: 'flex', alignItems: 'center', gap: 5,
              color: C.amber, fontSize: 11, fontFamily: "'DM Sans',sans-serif" }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.amber }} />
              {busyCmp ? 'Comparing…' : 'Simulating…'}
            </div>
          )}
          <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 6,
            padding: '4px 10px', color: C.t3, fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace" }}>
            n={N_PATHS} paths
          </div>
        </div>
      </div>

      {/* ── MAIN LAYOUT ── */}
      <div className="layout" style={{ display: 'flex', minHeight: 'calc(100vh - 66px)' }}>

        {/* ═══ SIDEBAR ═══ */}
        <div className="sidebar" style={{ width: 310, background: C.bg1, borderRight: `1px solid ${C.border}`,
          display: 'flex', flexDirection: 'column', flexShrink: 0 }}>

          {/* Sidebar Tab Bar */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, background: C.bg2, flexShrink: 0 }}>
            {[['params','⚙ Parameters'],['scenarios','📅 Scenarios'],['compare','📊 Compare']].map(([id,lbl]) => (
              <button key={id} onClick={() => setSideTab(id)} style={{
                flex: 1, background: 'transparent', border: 'none',
                borderBottom: `2px solid ${sideTab === id ? C.amber : 'transparent'}`,
                color: sideTab === id ? C.amber : C.t3, padding: '9px 4px',
                cursor: 'pointer', fontSize: 11, fontFamily: "'DM Sans',sans-serif",
                fontWeight: sideTab === id ? 600 : 400, transition: 'color .15s',
              }}>
                {lbl}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>

            {/* ══ PARAMETERS TAB ══ */}
            {sideTab === 'params' && (
              <div>
                {/* WTI Spot */}
                <div style={{ marginBottom: 18 }}>
                  <SectionLabel>WTI Crude Oil Spot (USD / bbl)</SectionLabel>
                  {/* Live fetch row */}
                  <div style={{ display: 'flex', gap: 7, marginBottom: 8, alignItems: 'stretch' }}>
                    <button onClick={fetchLivePrices} disabled={fetchStatus === 'loading'}
                      style={{
                        background: fetchStatus === 'ok'  ? `${C.green}22`
                                  : fetchStatus === 'err' ? `${C.red}22`
                                  : C.bg2,
                        border: `1px solid ${fetchStatus === 'ok'  ? C.green
                                           : fetchStatus === 'err' ? C.red
                                           : C.border2}`,
                        color:  fetchStatus === 'ok'  ? C.green
                              : fetchStatus === 'err' ? C.red
                              : C.amber,
                        borderRadius: 7, padding: '6px 11px', cursor: fetchStatus === 'loading' ? 'wait' : 'pointer',
                        fontSize: 11.5, fontFamily: "'DM Sans',sans-serif", fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
                        transition: 'all .2s', whiteSpace: 'nowrap',
                      }}>
                      <span style={{ display: 'inline-block',
                        animation: fetchStatus === 'loading' ? 'spin 0.8s linear infinite' : 'none',
                        fontSize: 13 }}>
                        {fetchStatus === 'loading' ? '↻'
                       : fetchStatus === 'ok'      ? '✓'
                       : fetchStatus === 'err'     ? '✕'
                       : '↻'}
                      </span>
                      {fetchStatus === 'loading' ? 'Fetching…'
                     : fetchStatus === 'ok'      ? 'Updated'
                     : fetchStatus === 'err'     ? 'Failed'
                     : 'Live Price'}
                    </button>
                    <div style={{ flex: 1, background: C.bg2, border: `1px solid ${C.border}`,
                      borderRadius: 7, padding: '5px 9px', display: 'flex', flexDirection: 'column',
                      justifyContent: 'center' }}>
                      {lastFetched ? (
                        <>
                          <div style={{ color: C.t2, fontSize: 10, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.6 }}>
                            <span>WTI <span style={{ color: C.amber }}>${lastFetched.wti}</span></span>
                            {' · '}
                            <span>OVX <span style={{ color: C.orange }}>{lastFetched.ovx}%</span></span>
                            {' · '}
                            <span>VIX <span style={{ color: C.blue }}>{lastFetched.vix}</span></span>
                          </div>
                          {lastFetched.curveSlopePct !== null && (
                            <div style={{ color: C.t4, fontSize: 9.5, fontFamily: "'JetBrains Mono',monospace", marginTop: 1 }}>
                              Curve vs {lastFetched.curveLabel}:{' '}
                              <span style={{ color: lastFetched.curveSlopePct >= 0 ? C.green : C.red }}>
                                {lastFetched.curveSlopePct >= 0 ? '+' : ''}{lastFetched.curveSlopePct}%/yr
                                {' '}{lastFetched.curveSlopePct >= 0 ? '(backwardation)' : '(contango)'}
                              </span>
                            </div>
                          )}
                          <div style={{ color: C.t4, fontSize: 9, marginTop: 1 }}>as of {lastFetched.ts}</div>
                        </>
                      ) : (
                        <div style={{ color: C.t4, fontSize: 10 }}>CL=F · ^OVX · ^VIX · futures curve</div>
                      )}
                    </div>
                  </div>
                  <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                  <input type="number" value={p.S0} min={10} max={300} step={0.5}
                    onChange={e => set('S0', parseFloat(e.target.value) || 72.5)} />
                  <div style={{ color: C.t3, fontSize: 10, marginTop: 5 }}>
                    Retail gasoline ≈ <span style={{ color: C.green, fontFamily: "'JetBrains Mono',monospace" }}>{fmtGas(p.S0)}/gal</span>
                  </div>
                </div>

                {/* Forecast Params */}
                <div style={{ marginBottom: 18 }}>
                  <SectionLabel>Forecast Parameters</SectionLabel>
                  <SliderRow label="Horizon" value={p.horizon} min={1} max={24} step={1}
                    onChange={v => set('horizon', v)} fmt={v => `${v}M`} />
                  <SliderRow label="Annual Drift (μ)" value={p.drift} min={-40} max={40} step={0.5}
                    onChange={v => set('drift', v)} fmt={v => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`} />
                  <SliderRow label="Annual Volatility (σ)" value={p.vol} min={8} max={100} step={1}
                    onChange={v => set('vol', v)} fmt={v => `${v}%`}
                    hint="Hist. WTI vol ≈ 35–45%. VIX & geo scale this further." />
                </div>

                {/* Model Selection */}
                <div style={{ marginBottom: 18 }}>
                  <SectionLabel>Forecasting Model</SectionLabel>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                    {MODELS.map(m => (
                      <button key={m.id} onClick={() => set('model', m.id)} style={{
                        background: p.model === m.id ? `linear-gradient(135deg,${C.amberD},${C.amber})` : 'transparent',
                        color: p.model === m.id ? C.bg0 : C.t2,
                        border: `1px solid ${p.model === m.id ? C.amber : C.border}`,
                        borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
                        fontSize: 11, fontFamily: "'DM Sans',sans-serif", fontWeight: 600,
                        whiteSpace: 'nowrap', transition: 'all .15s',
                      }}>
                        {m.short}
                      </button>
                    ))}
                  </div>
                  <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px' }}>
                    <div style={{ color: C.amber, fontSize: 11.5, fontWeight: 600, marginBottom: 3 }}>{model?.name}</div>
                    <div style={{ color: C.t4, fontSize: 9.5, fontStyle: 'italic' }}>{model?.refs}</div>
                  </div>
                </div>

                {/* Model-Specific Params */}
                {p.model === 'ou' && (
                  <div style={{ marginBottom: 18 }}>
                    <SectionLabel>Mean-Reversion Parameters</SectionLabel>
                    <SliderRow label="Reversion Speed (κ)" value={p.kappa} min={0.05} max={3} step={0.05}
                      onChange={v => set('kappa', v)} fmt={v => v.toFixed(2)}
                      hint={`Half-life ≈ ${(Math.log(2)/p.kappa*12).toFixed(1)} months`} />
                    <SliderRow label="Long-Run Mean (θ)" value={p.longRun} min={20} max={200} step={1}
                      onChange={v => set('longRun', v)} fmt={v => `$${v}`} />
                  </div>
                )}
                {p.model === 'jump' && (
                  <div style={{ marginBottom: 18 }}>
                    <SectionLabel>Jump-Diffusion Parameters</SectionLabel>
                    <SliderRow label="Jump Frequency (λ)" value={p.jumpLambda} min={0} max={24} step={0.5}
                      onChange={v => set('jumpLambda', v)} fmt={v => `${v}/yr`} />
                    <SliderRow label="Mean Jump Size" value={p.jumpMu} min={-50} max={50} step={1}
                      onChange={v => set('jumpMu', v)} fmt={v => `${v > 0 ? '+' : ''}${v}%`} />
                    <SliderRow label="Jump Volatility" value={p.jumpSig} min={1} max={60} step={1}
                      onChange={v => set('jumpSig', v)} fmt={v => `${v}%`} />
                  </div>
                )}
                {p.model === 'futures' && (
                  <div style={{ marginBottom: 18 }}>
                    <SectionLabel>Term Structure</SectionLabel>
                    {lastFetched?.curveSlopePct !== null && lastFetched?.curveSlopePct !== undefined && (
                      <div style={{ background: `${C.green}18`, border: `1px solid ${C.green}40`,
                        borderRadius: 6, padding: '6px 10px', marginBottom: 10, fontSize: 10.5,
                        fontFamily: "'DM Sans',sans-serif", color: C.green }}>
                        ↻ Live curve: M1 vs {lastFetched.curveLabel} =&nbsp;
                        <strong>{lastFetched.curveSlopePct >= 0 ? '+' : ''}{lastFetched.curveSlopePct}%/yr</strong>
                        &nbsp;({lastFetched.curveSlopePct >= 0 ? 'backwardation' : 'contango'})
                      </div>
                    )}
                    <SliderRow label="Backwardation(+)/Contango(−)" value={p.backwardation} min={-30} max={30} step={1}
                      onChange={v => set('backwardation', v)} fmt={v => `${v > 0 ? '+' : ''}${v}%/yr`}
                      hint="Auto-set from live WTI futures curve. WTI typically +7–12%/yr backwardated." />
                  </div>
                )}
                {p.model === 'heston' && (
                  <div style={{ marginBottom: 18 }}>
                    <SectionLabel>Heston SV Parameters</SectionLabel>
                    {lastFetched?.ovx && (
                      <div style={{ background: `${C.orange}18`, border: `1px solid ${C.orange}40`,
                        borderRadius: 6, padding: '6px 10px', marginBottom: 10, fontSize: 10.5,
                        fontFamily: "'DM Sans',sans-serif", color: C.orange }}>
                        ↻ OVX {lastFetched.ovx}% → V₀ = {Math.pow(lastFetched.ovx/100,2).toFixed(3)}
                        &nbsp;· θᵥ = {((Math.pow(lastFetched.ovx/100,2)+0.1225)/2).toFixed(3)} (blended long-run)
                      </div>
                    )}
                    <SliderRow label="Initial Variance (V₀)" value={p.hestonV0} min={0.01} max={0.80} step={0.01}
                      onChange={v => set('hestonV0', v)} fmt={v => `${v.toFixed(2)} (σ≈${(Math.sqrt(v)*100).toFixed(0)}%)`}
                      hint="Auto-set from live OVX: V₀ = (OVX/100)²" />
                    <SliderRow label="Long-Run Variance (θᵥ)" value={p.hestonThetaV} min={0.01} max={0.80} step={0.01}
                      onChange={v => set('hestonThetaV', v)} fmt={v => `${v.toFixed(2)} (σ≈${(Math.sqrt(v)*100).toFixed(0)}%)`}
                      hint="Auto-set as blend of OVX² and hist. mean (35%² = 0.1225)" />
                    <SliderRow label="Vol-of-Vol (σᵥ)" value={p.hestonSigmaV} min={0.05} max={1.5} step={0.05}
                      onChange={v => set('hestonSigmaV', v)} fmt={v => v.toFixed(2)} />
                    <SliderRow label="Price-Vol Correlation (ρ)" value={p.hestonRho} min={-0.99} max={0.99} step={0.01}
                      onChange={v => set('hestonRho', v)} fmt={v => v.toFixed(2)}
                      hint="Leverage effect: oil typically −0.4 to −0.7" />
                  </div>
                )}
                {p.model === 'ss2' && (
                  <div style={{ marginBottom: 18 }}>
                    <SectionLabel>Schwartz-Smith Two-Factor</SectionLabel>
                    <SliderRow label="Short-Run Rev. Speed (κχ)" value={p.ssKappa} min={0.1} max={8} step={0.1}
                      onChange={v => set('ssKappa', v)} fmt={v => v.toFixed(1)}
                      hint={`Short-run half-life ≈ ${(Math.log(2)/p.ssKappa*12).toFixed(1)} months`} />
                    <SliderRow label="Short-Run Vol (σχ)" value={p.ssSigmaChi} min={0.01} max={0.80} step={0.01}
                      onChange={v => set('ssSigmaChi', v)} fmt={v => `${(v*100).toFixed(0)}%`} />
                    <SliderRow label="Long-Run Vol (σξ)" value={p.ssSigmaXi} min={0.01} max={0.60} step={0.01}
                      onChange={v => set('ssSigmaXi', v)} fmt={v => `${(v*100).toFixed(0)}%`} />
                    <SliderRow label="Factor Correlation (ρ)" value={p.ssRho} min={-0.99} max={0.99} step={0.01}
                      onChange={v => set('ssRho', v)} fmt={v => v.toFixed(2)} />
                  </div>
                )}
                {p.model === 'vg' && (
                  <div style={{ marginBottom: 18 }}>
                    <SectionLabel>Variance-Gamma Parameters</SectionLabel>
                    <SliderRow label="Variance Rate (ν) — Kurtosis" value={p.vgNu} min={0.01} max={1.0} step={0.01}
                      onChange={v => set('vgNu', v)} fmt={v => v.toFixed(2)}
                      hint="Higher ν → fatter tails. VG → GBM as ν → 0" />
                    <SliderRow label="Skewness Param (θᵥᵍ)" value={p.vgTheta} min={-0.50} max={0.20} step={0.01}
                      onChange={v => set('vgTheta', v)} fmt={v => v.toFixed(2)}
                      hint="Negative → left skew (crash-prone). Oil market: −0.05 to −0.20" />
                  </div>
                )}

                {/* Macro Environment */}
                <div style={{ marginBottom: 18 }}>
                  <SectionLabel>Economic Environment</SectionLabel>
                  <SliderRow label="VIX (CBOE Equity Implied Vol)" value={p.vix} min={9} max={80} step={1}
                    onChange={v => set('vix', v)}
                    fmt={v => {
                      if (v < 15) return `${v} — calm`;
                      if (v < 25) return `${v} — normal`;
                      if (v < 35) return `${v} — elevated`;
                      if (v < 50) return `${v} — stressed`;
                      return `${v} — crisis`;
                    }}
                    hint={`Equity fear index — drives jump λ, drift suppression, vol scaling. ${lastFetched?.ovx ? `OVX (crude oil vol) = ${lastFetched.ovx}% — used for Heston V₀.` : 'OVX (crude oil vol) auto-sets Heston V₀ on fetch.'}`} />
                  <SliderRow label="Fed Rate Change" value={p.fedDelta} min={-300} max={500} step={25}
                    onChange={v => set('fedDelta', v)} fmt={v => `${v > 0 ? '+' : ''}${v} bps`}
                    hint="USD strength channel (β ≈ −0.35)" />
                  <SliderRow label="DXY Change" value={p.dxy} min={-20} max={25} step={0.5}
                    onChange={v => set('dxy', v)} fmt={v => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`}
                    hint="Direct USD level channel (β ≈ −0.90)" />
                  <SliderRow label="Real Interest Rate" value={p.realRate} min={-4} max={12} step={0.25}
                    onChange={v => set('realRate', v)} fmt={v => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`}
                    hint="Opportunity cost channel; separate from inflation hedge" />
                  <SliderRow label="Inflation Expectations" value={p.inflation} min={0} max={15} step={0.25}
                    onChange={v => set('inflation', v)} fmt={v => `${v.toFixed(1)}%`}
                    hint="Oil as inflation hedge; commodity demand channel" />
                  <SliderRow label="Equity Market Trend" value={p.spxMood} min={-50} max={50} step={1}
                    onChange={v => set('spxMood', v)} fmt={v => `${v > 0 ? '+' : ''}${v}%`}
                    hint="Risk-on/off proxy (oil–SPX β ≈ 0.42)" />
                  <SliderRow label="EIA Inventory Deviation" value={p.inventory} min={-150} max={250} step={5}
                    onChange={v => set('inventory', v)} fmt={v => `${v > 0 ? '+' : ''}${v} Mb`}
                    hint="Deviation from 5-yr avg; +100Mb surplus → −8% drift" />
                  <SliderRow label="Geopolitical Risk Index" value={p.geoRisk} min={0} max={10} step={0.5}
                    onChange={v => set('geoRisk', v)} fmt={v => `${v.toFixed(1)} / 10`}
                    hint="Amplifies σ (+55% max) and λ (+180% max)" />
                  <SliderRow label="OPEC Supply Tightness" value={p.opecTight} min={0} max={10} step={0.5}
                    onChange={v => set('opecTight', v)} fmt={v => `${v.toFixed(1)} / 10`} />
                  {lastFetched?.spread !== undefined && (
                    <div style={{ background: `${C.blue}18`, border: `1px solid ${C.blue}40`,
                      borderRadius: 6, padding: '6px 10px', marginBottom: 10, fontSize: 10.5,
                      fontFamily: "'DM Sans',sans-serif", color: C.blue }}>
                      ↻ Live: WTI ${lastFetched.wti} · Brent ${lastFetched.brent} · Spread{' '}
                      <strong>{lastFetched.spread > 0 ? '+' : ''}{lastFetched.spread?.toFixed(2)}</strong>
                    </div>
                  )}
                  <SliderRow
                    label="WTI–Brent Spread"
                    value={p.brentSpread}
                    min={-15} max={5} step={0.5}
                    onChange={v => set('brentSpread', v)}
                    fmt={v => `${v > 0 ? '+' : ''}${v.toFixed(1)} $/bbl`}
                    hint={
                      p.brentSpread < -5
                        ? `${p.brentSpread.toFixed(1)} — significant friction / segmentation`
                        : p.brentSpread < -2
                        ? `${p.brentSpread.toFixed(1)} — moderate discount (normal)`
                        : p.brentSpread < 0
                        ? `${p.brentSpread.toFixed(1)} — near parity`
                        : `${p.brentSpread.toFixed(1)} — WTI premium (rare)`
                    }
                  />
                </div>

                {/* Seasonal */}
                <div style={{ marginBottom: 8 }}>
                  <SectionLabel>Seasonal Adjustment</SectionLabel>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ width: 36, height: 20, borderRadius: 10, cursor: 'pointer',
                      background: p.seasonal ? C.amber : C.border, position: 'relative',
                      transition: 'background .2s' }}
                      onClick={() => set('seasonal', !p.seasonal)}>
                      <div style={{ position: 'absolute', top: 2, width: 16, height: 16,
                        borderRadius: '50%', background: C.bg0, transition: 'left .2s',
                        left: p.seasonal ? 18 : 2 }} />
                    </div>
                    <span style={{ color: C.t2, fontSize: 11.5 }}>
                      {p.seasonal ? 'Seasonal drift active' : 'No seasonal adjustment'}
                    </span>
                  </div>
                  {p.seasonal && (
                    <>
                      <SliderRow label="Amplitude" value={p.seasonalAmp} min={1} max={20} step={0.5}
                        onChange={v => set('seasonalAmp', v)} fmt={v => `±${v.toFixed(1)}%/yr`}
                        hint="Peak in winter (heating demand), trough in spring" />
                      <SliderRow label="Start Month" value={p.startMonth} min={0} max={11} step={1}
                        onChange={v => set('startMonth', v)}
                        fmt={v => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][v]} />
                    </>
                  )}
                </div>

                {/* Reset */}
                <button className="btn-amber" onClick={() => { setP(defaultP); setAppliedScenario(null); }}
                  style={{ width: '100%', marginTop: 10, background: C.border, border: `1px solid ${C.border2}`,
                    color: C.t2, borderRadius: 7, padding: '8px', cursor: 'pointer',
                    fontSize: 11.5, fontFamily: "'DM Sans',sans-serif" }}>
                  Reset to Defaults
                </button>
              </div>
            )}

            {/* ══ SCENARIOS TAB ══ */}
            {sideTab === 'scenarios' && (
              <div>
                <div style={{ color: C.t3, fontSize: 10.5, marginBottom: 14, lineHeight: 1.5 }}>
                  Click any scenario to load its calibrated parameters. Your current settings will be overwritten.
                </div>
                {SCENARIOS.map(sc => (
                  <div key={sc.id} className="sc-card"
                    style={{ background: appliedScenario === sc.id ? C.card : C.bg2,
                      border: `1px solid ${appliedScenario === sc.id ? C.amber : C.border}`,
                      borderRadius: 9, padding: '11px 12px', marginBottom: 9 }}
                    onClick={() => applyScenario(sc)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                      <div>
                        <span style={{ color: C.amber, fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace",
                          fontWeight: 600, marginRight: 6 }}>{sc.era}</span>
                        <span style={{ color: C.t1, fontSize: 12, fontWeight: 600 }}>{sc.label}</span>
                      </div>
                      <span style={{ color: sc.impact.startsWith('+') ? C.green : C.red,
                        fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, flexShrink: 0 }}>
                        {sc.impact}
                      </span>
                    </div>
                    <div style={{ color: C.t4, fontSize: 10, marginBottom: 4, fontStyle: 'italic' }}>{sc.date}</div>
                    <div style={{ color: C.t3, fontSize: 10.5, lineHeight: 1.5 }}>{sc.desc}</div>
                    {appliedScenario === sc.id && (
                      <div style={{ color: C.amber, fontSize: 10, marginTop: 6, fontWeight: 600 }}>✓ Active</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ══ COMPARE TAB ══ */}
            {sideTab === 'compare' && (
              <div>
                <div style={{ marginBottom: 18 }}>
                  <SectionLabel>Model Comparison Selection</SectionLabel>
                  <div style={{ color: C.t3, fontSize: 10.5, marginBottom: 12, lineHeight: 1.5 }}>
                    Select models to overlay in the Comparison chart. All share current macro parameters.
                    Uses {N_PATHS_COMPARE} paths per model.
                  </div>
                  {MODELS.map(m => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10,
                      marginBottom: 9, cursor: 'pointer' }}
                      onClick={() => toggleCompareModel(m.id)}>
                      <div style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                        background: p.compareModels.includes(m.id) ? MODEL_COLORS[m.id] : C.border,
                        border: `2px solid ${MODEL_COLORS[m.id]}`, transition: 'background .15s' }} />
                      <div style={{ flex: 1 }}>
                        <span style={{ color: p.compareModels.includes(m.id) ? C.t1 : C.t3,
                          fontSize: 11.5, fontFamily: "'DM Sans',sans-serif" }}>{m.name}</span>
                      </div>
                      <div style={{ width: 22, height: 3, borderRadius: 2,
                        background: p.compareModels.includes(m.id) ? MODEL_COLORS[m.id] : C.border }} />
                    </div>
                  ))}
                </div>

                <div style={{ marginBottom: 18 }}>
                  <SectionLabel>Price Target (Risk Tab)</SectionLabel>
                  <div style={{ color: C.t3, fontSize: 10.5, marginBottom: 8 }}>
                    Enter a WTI price to compute breach probabilities.
                  </div>
                  <input type="text" value={p.priceTarget}
                    onChange={e => set('priceTarget', e.target.value)}
                    placeholder="e.g. 90" />
                  <div style={{ color: C.t3, fontSize: 10, marginTop: 6 }}>
                    Breach probs computed from current active model simulation.
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* ═══ RESULTS PANEL ═══ */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, minWidth: 0 }}>

          {results ? (
            <div className="fadein">

              {/* ── STAT GRID ── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 8, marginBottom: 14 }}>
                <StatBox label="Mean" value={fmtD(results.stats.mean)} sub={`${p.horizon}M`} />
                <StatBox label="Median" value={fmtD(results.stats.median)} />
                <StatBox label="90% CI"
                  value={`${fmtD(results.stats.p5t)}–${fmtD(results.stats.p95t)}`}
                  color={C.blue} sub="5th–95th" />
                <StatBox label="CVaR 5%" value={fmtD(results.stats.cvar5)} color={C.red} sub="Expected shortfall" />
                <StatBox label="P(Bullish)"
                  value={`${results.stats.probUp.toFixed(0)}%`}
                  color={results.stats.probUp >= 50 ? C.green : C.red} sub="P(price > spot)" />
                <StatBox label="Crash Risk" value={`${results.stats.crash20.toFixed(1)}%`}
                  color={results.stats.crash20 > 15 ? C.red : C.amber} sub="P(−20%+)" />
                <StatBox label="Rally" value={`${results.stats.rally20.toFixed(1)}%`}
                  color={results.stats.rally20 > 20 ? C.green : C.amber} sub="P(+20%+)" />
                <StatBox label="Skewness" value={results.stats.skew.toFixed(2)}
                  color={results.stats.skew < -0.5 ? C.red : C.t2} sub="Neg. = left tail" />
              </div>

              {/* ── CHART TAB BAR ── */}
              <div style={{ display: 'flex', gap: 0, marginBottom: 14,
                borderBottom: `1px solid ${C.border}`, overflowX: 'auto' }}>
                {[['fan','Fan Chart'],['hist','Distribution'],['gas','Gasoline'],['compare','Comparison'],['risk','Risk'],['regional','Regional']].map(([id,lbl]) => (
                  <TabBtn key={id} id={id} active={chartTab === id} onClick={setChartTab}>{lbl}</TabBtn>
                ))}
                {chartTab === 'fan' && results && (
                  <button className="btn-amber" onClick={() => downloadCSV(results.fanData)}
                    style={{ marginLeft: 'auto', background: C.bg2, border: `1px solid ${C.border}`,
                      color: C.t2, borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
                      fontSize: 11, fontFamily: "'DM Sans',sans-serif", flexShrink: 0 }}>
                    ↓ CSV
                  </button>
                )}
              </div>

              {/* ─── FAN CHART ─── */}
              {chartTab === 'fan' && (
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 12px 10px' }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, fontWeight: 600, color: C.t1, marginBottom: 2 }}>
                    Price Path Fan Chart · <span style={{ fontStyle: 'italic', fontWeight: 500, fontSize: 15 }}>WTI $/bbl</span>
                  </div>
                  <div style={{ color: C.t3, fontSize: 10, marginBottom: 14 }}>
                    Bands: outer 5–95% · inner 25–75% · amber line = median · blue dashed = spot
                  </div>
                  <ResponsiveContainer width="100%" height={290}>
                    <ComposedChart data={results.fanData} margin={{ top: 4, right: 12, bottom: 2, left: 0 }}>
                      <CartesianGrid stroke={C.border} strokeDasharray="2 4" strokeOpacity={0.5} />
                      <XAxis dataKey="label" tick={{ fill: C.t3, fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace" }}
                        axisLine={{ stroke: C.border }} tickLine={false} />
                      <YAxis tick={{ fill: C.t3, fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace" }}
                        axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} width={50} />
                      <Tooltip content={<FanTooltip />} />
                      <ReferenceLine y={p.S0} stroke={C.blue} strokeDasharray="5 4" strokeOpacity={0.6} strokeWidth={1.2} />
                      <Area type="monotone" dataKey="base"  stackId="f" fill="transparent" stroke="none" isAnimationActive={false} />
                      <Area type="monotone" dataKey="d1"    stackId="f" fill={`${C.amber}12`} stroke="none" isAnimationActive={false} />
                      <Area type="monotone" dataKey="d2"    stackId="f" fill={`${C.amber}28`} stroke="none" isAnimationActive={false} />
                      <Area type="monotone" dataKey="d3"    stackId="f" fill={`${C.amber}46`} stroke="none" isAnimationActive={false} />
                      <Area type="monotone" dataKey="d4"    stackId="f" fill={`${C.amber}46`} stroke="none" isAnimationActive={false} />
                      <Area type="monotone" dataKey="d5"    stackId="f" fill={`${C.amber}28`} stroke="none" isAnimationActive={false} />
                      <Area type="monotone" dataKey="d6"    stackId="f" fill={`${C.amber}12`} stroke="none" isAnimationActive={false} />
                      <Line type="monotone" dataKey="p50" stroke={C.amber} strokeWidth={2.2} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="p95" stroke={`${C.amber}45`} strokeWidth={1} dot={false} strokeDasharray="3 5" isAnimationActive={false} />
                      <Line type="monotone" dataKey="p5"  stroke={`${C.amber}45`} strokeWidth={1} dot={false} strokeDasharray="3 5" isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                    {[
                      { bg: `${C.amber}12`, bdr: `${C.amber}40`, lbl: '5–95%' },
                      { bg: `${C.amber}44`, bdr: `${C.amber}80`, lbl: '25–75%' },
                      { line: C.amber, lbl: 'Median' },
                      { line: C.blue,  lbl: 'Spot' },
                    ].map(({ bg, bdr, line, lbl }) => (
                      <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 5,
                        color: C.t3, fontSize: 10, fontFamily: "'DM Sans',sans-serif" }}>
                        {line
                          ? <div style={{ width: 16, height: 2, background: line, borderRadius: 1 }} />
                          : <div style={{ width: 13, height: 9, borderRadius: 2, background: bg, border: `1px solid ${bdr}` }} />
                        }
                        {lbl}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ─── HISTOGRAM ─── */}
              {chartTab === 'hist' && (
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 12px 10px' }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, fontWeight: 600, color: C.t1, marginBottom: 2 }}>
                    Terminal Distribution · <span style={{ fontStyle: 'italic', fontWeight: 500, fontSize: 15 }}>Month {p.horizon}</span>
                  </div>
                  <div style={{ color: C.t3, fontSize: 10, marginBottom: 14 }}>
                    {N_PATHS} paths · IQR ${results.stats.p25t?.toFixed(1)}–${results.stats.p75t?.toFixed(1)}
                    · Skewness {results.stats.skew?.toFixed(2)} · Ex. Kurtosis {results.stats.kurt?.toFixed(2)}
                  </div>
                  <ResponsiveContainer width="100%" height={270}>
                    <ComposedChart data={results.histData} margin={{ top: 4, right: 12, bottom: 2, left: 0 }}>
                      <CartesianGrid stroke={C.border} strokeDasharray="2 4" strokeOpacity={0.4} vertical={false} />
                      <XAxis dataKey="price" type="number" domain={['auto','auto']}
                        tick={{ fill: C.t3, fontSize: 10, fontFamily: "'JetBrains Mono',monospace" }}
                        axisLine={{ stroke: C.border }} tickLine={false}
                        tickFormatter={v => `$${v.toFixed(0)}`} scale="linear" />
                      <YAxis tick={{ fill: C.t3, fontSize: 10, fontFamily: "'JetBrains Mono',monospace" }}
                        axisLine={false} tickLine={false} tickFormatter={v => `${v.toFixed(1)}%`} width={40} />
                      <Tooltip content={<HistTooltip />} />
                      <ReferenceLine x={p.S0} stroke={C.blue} strokeWidth={1.5} strokeDasharray="5 4" />
                      <ReferenceLine x={results.stats.median} stroke={C.amber} strokeWidth={1.5} strokeDasharray="4 4" />
                      <Bar dataKey="freq" barSize={12} radius={[2,2,0,0]} isAnimationActive={false}>
                        {results.histData.map((entry, i) => {
                          const clr = entry.price < p.S0 * 0.80 ? C.red
                            : entry.price > p.S0 * 1.20 ? C.green : C.amber;
                          return <Cell key={i} fill={clr} fillOpacity={0.76} />;
                        })}
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 12 }}>
                    {[
                      { lbl: 'P(−20%+ crash)', val: `${results.stats.crash20.toFixed(1)}%`, clr: C.red },
                      { lbl: 'P(within ±20%)',  val: `${(100-results.stats.crash20-results.stats.rally20).toFixed(1)}%`, clr: C.amber },
                      { lbl: 'P(+20%+ rally)',  val: `${results.stats.rally20.toFixed(1)}%`, clr: C.green },
                    ].map(({ lbl, val, clr }) => (
                      <div key={lbl} style={{ background: C.bg2, border: `1px solid ${C.border}`,
                        borderRadius: 7, padding: '9px 10px', textAlign: 'center' }}>
                        <div style={{ color: clr, fontSize: 19, fontFamily: "'JetBrains Mono',monospace" }}>{val}</div>
                        <div style={{ color: C.t3, fontSize: 9.5, marginTop: 3 }}>{lbl}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ─── GASOLINE ─── */}
              {chartTab === 'gas' && (
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 14px' }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, fontWeight: 600, color: C.t1, marginBottom: 2 }}>
                    Implied Retail Gasoline · <span style={{ fontStyle: 'italic', fontWeight: 500, fontSize: 15 }}>$/gallon</span>
                  </div>
                  <div style={{ color: C.t3, fontSize: 10.5, marginBottom: 12 }}>
                    3-2-1 crack spread formula · region-specific taxes & WTI-linkage · WTI–Brent spread adjusted
                  </div>
                  {/* Region selector */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 16 }}>
                    {PADDS.map(r => (
                      <button key={r.id} onClick={() => set('selectedRegion', r.id)}
                        style={{
                          background: p.selectedRegion === r.id ? r.color : 'transparent',
                          color: p.selectedRegion === r.id ? C.bg0 : C.t3,
                          border: `1px solid ${p.selectedRegion === r.id ? r.color : C.border}`,
                          borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                          fontSize: 11, fontFamily: "'DM Sans',sans-serif", fontWeight: 600,
                          transition: 'all .15s', whiteSpace: 'nowrap',
                        }}>
                        {r.short}
                      </button>
                    ))}
                  </div>
                  {/* Active region note */}
                  {(() => {
                    const r = PADDS.find(d => d.id === p.selectedRegion) ?? PADDS[0];
                    return (
                      <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 7,
                        padding: '7px 12px', marginBottom: 14, fontSize: 10.5, color: C.t3, lineHeight: 1.5 }}>
                        <span style={{ color: r.color, fontWeight: 600 }}>{r.label}</span>
                        {' — '}{r.notes}
                        {' · '}WTI-linkage: <span style={{ color: C.t1 }}>{(r.wtiLinkage * 100).toFixed(0)}%</span>
                        {' · '}Tax+margin: <span style={{ color: C.t1 }}>${r.taxMargin.toFixed(3)}/gal</span>
                        {p.brentSpread < -2 && (
                          <span> · Spread adj: <span style={{ color: C.green }}>
                            −${Math.abs(r.wtiLinkage * p.brentSpread * r.spreadPassThrough / 42).toFixed(3)}/gal
                          </span></span>
                        )}
                      </div>
                    );
                  })()}
                  {/* Percentile cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 8, marginBottom: 18 }}>
                    {[
                      { lbl: '5th Pct',  wti: results.stats.p5t,    sub: 'Bearish' },
                      { lbl: '25th Pct', wti: results.stats.p25t,   sub: 'Below base' },
                      { lbl: 'Median',   wti: results.stats.median,  sub: 'Base case' },
                      { lbl: 'Mean',     wti: results.stats.mean,    sub: 'Expected' },
                      { lbl: '75th Pct', wti: results.stats.p75t,   sub: 'Above base' },
                      { lbl: '95th Pct', wti: results.stats.p95t,   sub: 'Bullish' },
                    ].map(({ lbl, wti, sub }) => (
                      <div key={lbl} style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px' }}>
                        <div style={{ color: C.t3, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em',
                          textTransform: 'uppercase', marginBottom: 5 }}>{lbl}</div>
                        <div style={{ color: C.green, fontSize: 20, fontFamily: "'JetBrains Mono',monospace" }}>
                          {fmtGas(wti, p.selectedRegion, p.brentSpread)}
                        </div>
                        <div style={{ color: C.t4, fontSize: 10, fontFamily: "'JetBrains Mono',monospace", marginTop: 3 }}>
                          WTI ${wti.toFixed(2)}
                        </div>
                        <div style={{ color: C.t3, fontSize: 10, marginTop: 2 }}>{sub}</div>
                      </div>
                    ))}
                  </div>
                  {/* Price decomposition */}
                  {(() => {
                    const r    = PADDS.find(d => d.id === p.selectedRegion) ?? PADDS[0];
                    const wti  = results.stats.median;
                    const spreadAdj = r.wtiLinkage * p.brentSpread * r.spreadPassThrough / 42;
                    return (
                      <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ color: C.amber, fontSize: 12, fontWeight: 600, marginBottom: 9 }}>
                          Price Decomposition · Median WTI ${wti.toFixed(2)} · {r.short}
                        </div>
                        {[
                          ['WTI crude input',             (wti / 42 * r.wtiLinkage).toFixed(3),    C.t1],
                          ['Non-WTI crude input',         (wti / 42 * (1 - r.wtiLinkage)).toFixed(3), C.t3],
                          ['3-2-1 crack spread',           (27 / 42).toFixed(3),                    C.amber],
                          ['WTI–Brent spread adj.',        spreadAdj.toFixed(3),                    spreadAdj < 0 ? C.green : C.red],
                          ['Tax + dist. + retail margin', r.taxMargin.toFixed(3),                   C.t2],
                          ['─── Total retail ───',        wtiToGasoline(wti, r.id, p.brentSpread).toFixed(3), C.green],
                        ].map(([item, val, clr]) => (
                          <div key={item} style={{ display: 'flex', justifyContent: 'space-between',
                            padding: '4px 0', borderBottom: `1px solid ${C.border}` }}>
                            <span style={{ color: C.t3, fontSize: 11 }}>{item}</span>
                            <span style={{ color: clr, fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5 }}>
                              {parseFloat(val) >= 0 ? '$' : '−$'}{Math.abs(parseFloat(val)).toFixed(3)}/gal
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ─── COMPARISON ─── */}
              {chartTab === 'compare' && (
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 12px 10px' }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, fontWeight: 600, color: C.t1, marginBottom: 2 }}>
                    Model Comparison · <span style={{ fontStyle: 'italic', fontWeight: 500, fontSize: 15 }}>Median paths overlaid</span>
                  </div>
                  <div style={{ color: C.t3, fontSize: 10.5, marginBottom: 14 }}>
                    All models share current macro parameters. Shaded bands = 25th–75th percentile per model.
                    {busyCmp && <span className="pulse" style={{ color: C.amber, marginLeft: 10 }}>Computing…</span>}
                  </div>
                  {compareRes ? (
                    <>
                      <ResponsiveContainer width="100%" height={290}>
                        <ComposedChart data={compareRes} margin={{ top: 4, right: 12, bottom: 2, left: 0 }}>
                          <CartesianGrid stroke={C.border} strokeDasharray="2 4" strokeOpacity={0.4} />
                          <XAxis dataKey="label" tick={{ fill: C.t3, fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace" }}
                            axisLine={{ stroke: C.border }} tickLine={false} />
                          <YAxis tick={{ fill: C.t3, fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace" }}
                            axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} width={50} />
                          <Tooltip content={<CompareTooltip />} />
                          <ReferenceLine y={p.S0} stroke={`${C.blue}60`} strokeDasharray="5 4" strokeWidth={1} />
                          {p.compareModels.map(mId => (
                            <Line key={`${mId}_p50`} type="monotone" dataKey={`${mId}_p50`}
                              stroke={MODEL_COLORS[mId]} strokeWidth={2} dot={false}
                              isAnimationActive={false} strokeDasharray={mId === 'gbm' ? 'none' : 'none'} />
                          ))}
                        </ComposedChart>
                      </ResponsiveContainer>
                      {/* Legend */}
                      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                        {p.compareModels.map(mId => {
                          const m = MODELS.find(x => x.id === mId);
                          return (
                            <div key={mId} style={{ display: 'flex', alignItems: 'center', gap: 5,
                              color: C.t3, fontSize: 10.5 }}>
                              <div style={{ width: 20, height: 3, background: MODEL_COLORS[mId], borderRadius: 2 }} />
                              {m?.short}
                            </div>
                          );
                        })}
                      </div>
                      {/* Comparison table */}
                      <div style={{ marginTop: 14, overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11,
                          fontFamily: "'JetBrains Mono',monospace" }}>
                          <thead>
                            <tr>
                              {['Model','Median','Mean','P5','P95','Crash%','Rally%'].map(h => (
                                <th key={h} style={{ color: C.t3, fontFamily: "'DM Sans',sans-serif",
                                  fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                                  padding: '4px 8px', borderBottom: `1px solid ${C.border}`, textAlign: 'left' }}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {p.compareModels.map(mId => {
                              const r = simulate({ ...p, model: mId }, 400);
                              const m = MODELS.find(x => x.id === mId);
                              return (
                                <tr key={mId}>
                                  <td style={{ color: MODEL_COLORS[mId], padding: '5px 8px',
                                    borderBottom: `1px solid ${C.border}` }}>{m?.short}</td>
                                  <td style={{ color: C.t1, padding: '5px 8px', borderBottom: `1px solid ${C.border}` }}>
                                    ${r.stats.median.toFixed(1)}</td>
                                  <td style={{ color: C.t2, padding: '5px 8px', borderBottom: `1px solid ${C.border}` }}>
                                    ${r.stats.mean.toFixed(1)}</td>
                                  <td style={{ color: C.red, padding: '5px 8px', borderBottom: `1px solid ${C.border}` }}>
                                    ${r.stats.p5t.toFixed(1)}</td>
                                  <td style={{ color: C.green, padding: '5px 8px', borderBottom: `1px solid ${C.border}` }}>
                                    ${r.stats.p95t.toFixed(1)}</td>
                                  <td style={{ color: r.stats.crash20 > 15 ? C.red : C.t2,
                                    padding: '5px 8px', borderBottom: `1px solid ${C.border}` }}>
                                    {r.stats.crash20.toFixed(1)}%</td>
                                  <td style={{ color: r.stats.rally20 > 20 ? C.green : C.t2,
                                    padding: '5px 8px', borderBottom: `1px solid ${C.border}` }}>
                                    {r.stats.rally20.toFixed(1)}%</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: C.t3, fontSize: 12 }}>
                      {busyCmp ? 'Running comparison simulations…' : 'Select models in the Compare sidebar tab'}
                    </div>
                  )}
                </div>
              )}

              {/* ─── RISK TAB ─── */}
              {chartTab === 'risk' && (
                <div>
                  {/* Price Target Breach */}
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
                    padding: '16px 14px', marginBottom: 12 }}>
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, fontWeight: 600,
                      color: C.t1, marginBottom: 12 }}>
                      Price Target Breach Probabilities
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
                      <span style={{ color: C.t2, fontSize: 12 }}>Target ($/bbl):</span>
                      <input type="text" value={p.priceTarget}
                        onChange={e => set('priceTarget', e.target.value)}
                        style={{ width: 100 }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8 }}>
                      <div style={{ background: C.bg2, border: `1px solid ${C.green}40`,
                        borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ color: C.t3, fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase',
                          letterSpacing: '0.1em', marginBottom: 6 }}>P(S_T &gt; ${pTarget})</div>
                        <div style={{ color: C.green, fontSize: 24, fontFamily: "'JetBrains Mono',monospace" }}>
                          {probAbove?.toFixed(1)}%
                        </div>
                        <div style={{ color: C.t3, fontSize: 10, marginTop: 4 }}>Probability of exceeding target</div>
                      </div>
                      <div style={{ background: C.bg2, border: `1px solid ${C.red}40`,
                        borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ color: C.t3, fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase',
                          letterSpacing: '0.1em', marginBottom: 6 }}>P(S_T &lt; ${pTarget})</div>
                        <div style={{ color: C.red, fontSize: 24, fontFamily: "'JetBrains Mono',monospace" }}>
                          {probBelow?.toFixed(1)}%
                        </div>
                        <div style={{ color: C.t3, fontSize: 10, marginTop: 4 }}>Probability of breaching downside</div>
                      </div>
                    </div>
                  </div>

                  {/* CVaR Breakdown */}
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
                    padding: '16px 14px', marginBottom: 12 }}>
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 16, fontWeight: 600,
                      color: C.t1, marginBottom: 12 }}>
                      Risk Metrics (Month {p.horizon})
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 8 }}>
                      {[
                        { lbl: 'CVaR 5%',    val: fmtD(results.stats.cvar5),  clr: C.red,   sub: 'Avg. worst 5%' },
                        { lbl: 'CVaR 10%',   val: fmtD(results.stats.cvar10), clr: C.orange, sub: 'Avg. worst 10%' },
                        { lbl: 'P10 (VaR)',  val: fmtD(results.stats.p10t),  clr: C.amber,  sub: '10th percentile' },
                        { lbl: 'P90',        val: fmtD(results.stats.p90t),  clr: C.green,  sub: '90th percentile' },
                        { lbl: 'Skewness',   val: results.stats.skew.toFixed(2), clr: results.stats.skew < -0.5 ? C.red : C.t1, sub: 'Return distribution' },
                        { lbl: 'Ex. Kurtosis',val: results.stats.kurt.toFixed(2), clr: results.stats.kurt > 2 ? C.orange : C.t1, sub: 'Fat-tail measure' },
                      ].map(({ lbl, val, clr, sub }) => (
                        <StatBox key={lbl} label={lbl} value={val} color={clr} sub={sub} />
                      ))}
                    </div>
                  </div>

                  {/* Scenario Stress Table */}
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 14px' }}>
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 16, fontWeight: 600,
                      color: C.t1, marginBottom: 4 }}>
                      Historical Stress Test — Percentile at Scenario Parameters
                    </div>
                    <div style={{ color: C.t3, fontSize: 10.5, marginBottom: 12 }}>
                      Each row shows the median and crash probability if you loaded that scenario's macro environment
                      into the current model ({model?.short}) at a 6-month horizon.
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                          <tr>
                            {['Scenario','Impact','Median','P5','P95','Crash%'].map(h => (
                              <th key={h} style={{ color: C.t3, fontFamily: "'DM Sans',sans-serif",
                                fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                                padding: '4px 8px', borderBottom: `1px solid ${C.border}`, textAlign: 'left' }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {SCENARIOS.slice(0, 8).map(sc => {
                            const r = simulate({ ...p, ...sc.params, S0: p.S0, horizon: 6 }, 300);
                            return (
                              <tr key={sc.id}>
                                <td style={{ color: C.t1, padding: '5px 8px', borderBottom: `1px solid ${C.border}`,
                                  fontSize: 10.5 }}>{sc.era} {sc.label}</td>
                                <td style={{ color: sc.impact.startsWith('+') ? C.green : C.red,
                                  padding: '5px 8px', borderBottom: `1px solid ${C.border}`,
                                  fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5 }}>{sc.impact}</td>
                                <td style={{ color: C.amber, padding: '5px 8px', borderBottom: `1px solid ${C.border}`,
                                  fontFamily: "'JetBrains Mono',monospace" }}>${r.stats.median.toFixed(1)}</td>
                                <td style={{ color: C.red, padding: '5px 8px', borderBottom: `1px solid ${C.border}`,
                                  fontFamily: "'JetBrains Mono',monospace" }}>${r.stats.p5t.toFixed(1)}</td>
                                <td style={{ color: C.green, padding: '5px 8px', borderBottom: `1px solid ${C.border}`,
                                  fontFamily: "'JetBrains Mono',monospace" }}>${r.stats.p95t.toFixed(1)}</td>
                                <td style={{ color: r.stats.crash20 > 20 ? C.red : C.t2,
                                  padding: '5px 8px', borderBottom: `1px solid ${C.border}`,
                                  fontFamily: "'JetBrains Mono',monospace" }}>{r.stats.crash20.toFixed(1)}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* ─── REGIONAL COMPARISON ─── */}
              {chartTab === 'regional' && (
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 14px' }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, fontWeight: 600, color: C.t1, marginBottom: 2 }}>
                    Regional Gasoline Price Divergence
                  </div>
                  <div style={{ color: C.t3, fontSize: 10.5, marginBottom: 16 }}>
                    Implied retail price across all PADD districts at median WTI forecast · WTI–Brent spread adjusted
                  </div>
                  {/* Bar chart — one bar per region, at 5 percentile points */}
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart
                      data={PADDS.map(r => {
                        const pts = ['p5t','p25t','median','p75t','p95t'].reduce((acc, k) => {
                          acc[k] = parseFloat(wtiToGasoline(results.stats[k] ?? results.stats.median, r.id, p.brentSpread).toFixed(3));
                          return acc;
                        }, {});
                        return { region: r.short, ...pts, color: r.color };
                      })}
                      layout="vertical"
                      margin={{ top: 4, right: 60, bottom: 2, left: 0 }}
                    >
                      <CartesianGrid stroke={C.border} strokeDasharray="2 4" strokeOpacity={0.4} horizontal={false} />
                      <XAxis type="number" domain={['auto','auto']}
                        tick={{ fill: C.t3, fontSize: 10, fontFamily: "'JetBrains Mono',monospace" }}
                        axisLine={{ stroke: C.border }} tickLine={false}
                        tickFormatter={v => `$${v.toFixed(2)}`} />
                      <YAxis type="category" dataKey="region" width={80}
                        tick={{ fill: C.t2, fontSize: 10.5, fontFamily: "'DM Sans',monospace" }}
                        axisLine={false} tickLine={false} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0]?.payload;
                          if (!d) return null;
                          return (
                            <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8,
                              padding: '10px 14px', fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
                              <div style={{ color: d.color, fontWeight: 600, marginBottom: 6 }}>{d.region}</div>
                              {[['P5',d.p5t],['P25',d.p25t],['Median',d.median],['P75',d.p75t],['P95',d.p95t]].map(([k,v]) => (
                                <div key={k} style={{ display:'flex', justifyContent:'space-between', gap: 16, marginBottom: 2 }}>
                                  <span style={{ color: C.t3 }}>{k}</span>
                                  <span style={{ color: k === 'Median' ? C.amber : C.t2 }}>${v?.toFixed(3)}</span>
                                </div>
                              ))}
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="median" barSize={18} radius={[0,3,3,0]} isAnimationActive={false}>
                        {PADDS.map((r, i) => <Cell key={i} fill={r.color} fillOpacity={0.82} />)}
                      </Bar>
                      <Line type="monotone" dataKey="p5t"  stroke={`${C.red}70`}   strokeWidth={1.5} dot={{ r: 3, fill: C.red, strokeWidth: 0 }}   isAnimationActive={false} />
                      <Line type="monotone" dataKey="p95t" stroke={`${C.green}70`} strokeWidth={1.5} dot={{ r: 3, fill: C.green, strokeWidth: 0 }} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                    {[
                      { line: C.amber,  lbl: 'Median (bar height)' },
                      { dot: C.green,   lbl: 'P95 (dot)' },
                      { dot: C.red,     lbl: 'P5 (dot)' },
                    ].map(({ line, dot, lbl }) => (
                      <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 5,
                        color: C.t3, fontSize: 10, fontFamily: "'DM Sans',sans-serif" }}>
                        {line && <div style={{ width: 16, height: 3, background: line, borderRadius: 1 }} />}
                        {dot  && <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />}
                        {lbl}
                      </div>
                    ))}
                  </div>
                  {/* Regional comparison table */}
                  <div style={{ marginTop: 14, overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: "'JetBrains Mono',monospace" }}>
                      <thead>
                        <tr>
                          {['Region','WTI-Link','Tax+Marg','P5','Median','P95','vs US Avg'].map(h => (
                            <th key={h} style={{ color: C.t3, fontFamily: "'DM Sans',sans-serif",
                              fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                              padding: '4px 8px', borderBottom: `1px solid ${C.border}`, textAlign: 'left' }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {PADDS.map(r => {
                          const med    = wtiToGasoline(results.stats.median, r.id, p.brentSpread);
                          const natMed = wtiToGasoline(results.stats.median, 'national', p.brentSpread);
                          const diff   = med - natMed;
                          return (
                            <tr key={r.id}>
                              <td style={{ color: r.color, padding: '5px 8px', borderBottom: `1px solid ${C.border}`, fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}>{r.short}</td>
                              <td style={{ color: C.t2, padding: '5px 8px', borderBottom: `1px solid ${C.border}` }}>{(r.wtiLinkage * 100).toFixed(0)}%</td>
                              <td style={{ color: C.t2, padding: '5px 8px', borderBottom: `1px solid ${C.border}` }}>${r.taxMargin.toFixed(3)}</td>
                              <td style={{ color: C.red,   padding: '5px 8px', borderBottom: `1px solid ${C.border}` }}>${wtiToGasoline(results.stats.p5t, r.id, p.brentSpread).toFixed(2)}</td>
                              <td style={{ color: C.amber, padding: '5px 8px', borderBottom: `1px solid ${C.border}` }}>${med.toFixed(2)}</td>
                              <td style={{ color: C.green, padding: '5px 8px', borderBottom: `1px solid ${C.border}` }}>${wtiToGasoline(results.stats.p95t, r.id, p.brentSpread).toFixed(2)}</td>
                              <td style={{ color: Math.abs(diff) < 0.01 ? C.t3 : diff > 0 ? C.red : C.green,
                                padding: '5px 8px', borderBottom: `1px solid ${C.border}` }}>
                                {diff >= 0 ? '+' : ''}{diff.toFixed(3)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* Spread friction note */}
                  <div style={{ marginTop: 14, background: C.bg2, border: `1px solid ${C.border}`,
                    borderRadius: 7, padding: '10px 12px', fontSize: 10.5, color: C.t3, lineHeight: 1.6 }}>
                    <span style={{ color: C.t2, fontWeight: 600 }}>WTI–Brent spread: </span>
                    {p.brentSpread > 0 ? '+' : ''}{p.brentSpread.toFixed(1)} $/bbl.
                    {' '}
                    {p.brentSpread < -5
                      ? 'Significant segmentation. Gulf Coast refiners see the largest margin expansion. East Coast and West Coast consumers see minimal benefit due to lower WTI linkage.'
                      : p.brentSpread < -2
                      ? 'Moderate WTI discount. Midwest (PADD 2) and Gulf Coast consumers benefit most; California least.'
                      : p.brentSpread >= 0
                      ? 'WTI at parity or premium — no differential advantage for WTI-linked regions.'
                      : 'Near parity. Regional spread differentials are driven primarily by taxes and logistics.'}
                  </div>
                </div>
              )}

              {/* ── MODEL SUMMARY FOOTER ── */}
              <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: '11px 14px', marginTop: 12,
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 8 }}>
                {[
                  ['Active Model', model?.name, C.amber],
                  ['Effective Drift', `${effDrift > 0 ? '+' : ''}${effDrift.toFixed(1)}%/yr`, C.t1],
                  ['Effective Vol', `${effVol.toFixed(1)}%/yr`, C.t1],
                  ['Paths × Steps', `${N_PATHS} × ${p.horizon * STEPS_PER_MONTH}`, C.t2],
                ].map(([lbl, val, clr]) => (
                  <div key={lbl}>
                    <div style={{ color: C.t3, fontSize: 9.5, fontFamily: "'DM Sans',sans-serif",
                      fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 3 }}>{lbl}</div>
                    <div style={{ color: clr, fontSize: 12, fontFamily: "'JetBrains Mono',monospace" }}>{val}</div>
                  </div>
                ))}
              </div>

            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: 360, flexDirection: 'column', gap: 12 }}>
              <div style={{ color: C.amber, fontSize: 30 }}>⛽</div>
              <div style={{ color: C.t3 }}>Initializing simulation…</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
