import { GENE_METADATA } from '../data/genes';
import type { GeneMetadata, ScoredVariant } from '../types/variant';
import {
  computeComputationalSubscore,
  getVariantConditions,
} from './prioritisation';

export type HeatmapMetric = 'revel' | 'cadd' | 'alphamissense' | 'consensus';

export interface ScoreFrequencyCell {
  afBinIndex: number;
  afLabel: string;
  scoreBinIndex: number;
  scoreLabel: string;
  count: number;
  meanPriorityScore: number;
  conflictingCount: number;
  unstudiedCount: number;
  variants: ScoredVariant[];
}

export interface ScoreFrequencyMatrix {
  metric: HeatmapMetric;
  metricLabel: string;
  afLabels: string[];
  scoreLabels: string[];
  cells: ScoreFrequencyCell[];
  maxCount: number;
  pearsonR: number | null;
  evaluatedCount: number;
}

const AF_BINS: Array<{ label: string; match: (af: number) => boolean }> = [
  { label: 'AF = 0', match: (af) => af <= 0 },
  { label: '≤ 1e-5', match: (af) => af > 0 && af <= 1e-5 },
  { label: '1e-5 – 1e-4', match: (af) => af > 1e-5 && af <= 1e-4 },
  { label: '1e-4 – 1e-3', match: (af) => af > 1e-4 && af <= 1e-3 },
  { label: '> 1e-3', match: (af) => af > 1e-3 },
];

function getMetricValue(
  entry: ScoredVariant,
  metric: HeatmapMetric,
): number | null {
  const v = entry.variant;
  if (metric === 'revel') return v.revelScore;
  if (metric === 'cadd') return v.caddPhred;
  if (metric === 'alphamissense') return v.alphaMissenseScore ?? null;
  return Number(computeComputationalSubscore(v).score.toFixed(3));
}

function getScoreBinConfig(metric: HeatmapMetric): {
  metricLabel: string;
  bins: Array<{ label: string; match: (val: number) => boolean }>;
} {
  if (metric === 'cadd') {
    return {
      metricLabel: 'CADD Phred',
      bins: [
        { label: 'CADD ≥ 28', match: (x) => x >= 28 },
        { label: '24 – 27.9', match: (x) => x >= 24 && x < 28 },
        { label: '18 – 23.9', match: (x) => x >= 18 && x < 24 },
        { label: 'CADD < 18', match: (x) => x < 18 },
      ],
    };
  }
  const title =
    metric === 'revel'
      ? 'REVEL Score'
      : metric === 'alphamissense'
        ? 'AlphaMissense'
        : 'In-Silico Consensus';
  return {
    metricLabel: title,
    bins: [
      { label: '0.80 – 1.00', match: (x) => x >= 0.8 },
      { label: '0.56 – 0.79', match: (x) => x >= 0.56 && x < 0.8 },
      { label: '0.30 – 0.55', match: (x) => x >= 0.3 && x < 0.56 },
      { label: '0.00 – 0.29', match: (x) => x < 0.3 },
    ],
  };
}

function computePearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const denom = Math.sqrt(denX * denY);
  if (denom === 0) return null;
  return Number((num / denom).toFixed(3));
}

export function buildScoreFrequencyMatrix(
  scoredVariants: ScoredVariant[],
  metric: HeatmapMetric,
): ScoreFrequencyMatrix {
  const { metricLabel, bins } = getScoreBinConfig(metric);
  const cells: ScoreFrequencyCell[] = [];
  const xs: number[] = [];
  const ys: number[] = [];

  for (let sIdx = 0; sIdx < bins.length; sIdx++) {
    for (let aIdx = 0; aIdx < AF_BINS.length; aIdx++) {
      cells.push({
        afBinIndex: aIdx,
        afLabel: AF_BINS[aIdx].label,
        scoreBinIndex: sIdx,
        scoreLabel: bins[sIdx].label,
        count: 0,
        meanPriorityScore: 0,
        conflictingCount: 0,
        unstudiedCount: 0,
        variants: [],
      });
    }
  }

  let evaluatedCount = 0;

  for (const entry of scoredVariants) {
    const val = getMetricValue(entry, metric);
    if (val === null) continue;
    evaluatedCount += 1;

    const logNegAf = -Math.log10(Math.max(entry.variant.gnomadAf, 1e-7));
    xs.push(logNegAf);
    ys.push(val);

    const aIdx = AF_BINS.findIndex((b) => b.match(entry.variant.gnomadAf));
    const sIdx = bins.findIndex((b) => b.match(val));
    if (aIdx === -1 || sIdx === -1) continue;

    const cell = cells[sIdx * AF_BINS.length + aIdx];
    cell.variants.push(entry);
    cell.count += 1;
    if (entry.variant.clinvarStatus === 'Conflicting Interpretations') {
      cell.conflictingCount += 1;
    }
    if (entry.variant.functionalStatus === 'None') {
      cell.unstudiedCount += 1;
    }
  }

  let maxCount = 0;
  for (const cell of cells) {
    if (cell.count > 0) {
      const sum = cell.variants.reduce((acc, s) => acc + s.priorityScore, 0);
      cell.meanPriorityScore = Number((sum / cell.count).toFixed(1));
      if (cell.count > maxCount) maxCount = cell.count;
    }
  }

  return {
    metric,
    metricLabel,
    afLabels: AF_BINS.map((b) => b.label),
    scoreLabels: bins.map((b) => b.label),
    cells,
    maxCount,
    pearsonR: computePearson(xs, ys),
    evaluatedCount,
  };
}

export interface PairwiseSimilarityCell {
  rowIdx: number;
  colIdx: number;
  rowLabel: string;
  colLabel: string;
  similarity: number; // 0..1
  rowEntry: ScoredVariant;
  colEntry: ScoredVariant;
}

export interface PairwiseVariantMatrix {
  items: Array<{ label: string; entry: ScoredVariant }>;
  cells: PairwiseSimilarityCell[];
}

function extractEvidenceVector(entry: ScoredVariant): number[] {
  const v = entry.variant;
  const revel = v.revelScore ?? computeComputationalSubscore(v).score;
  const cadd = v.caddPhred !== null ? Math.max(0, Math.min(1, (v.caddPhred - 10) / 25)) : revel;
  const am = v.alphaMissenseScore ?? revel;
  const rarity = Math.max(0, Math.min(1, (-2 - Math.log10(Math.max(v.gnomadAf, 1e-7))) / 5));
  const conflict = v.clinvarStatus === 'Conflicting Interpretations' ? 1 : 0.25;
  const gap = v.functionalStatus === 'None' ? 1 : v.functionalStatus === 'Preliminary' ? 0.5 : 0.1;
  return [revel, cadd, am, rarity, conflict, gap];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : Number((dot / denom).toFixed(3));
}

export function buildPairwiseVariantCorrelationMatrix(
  scoredVariants: ScoredVariant[],
  maxItems = 12,
): PairwiseVariantMatrix {
  const slice = scoredVariants.slice(0, maxItems);
  if (slice.length === 0) return { items: [], cells: [] };

  // Greedy nearest-neighbor seriation starting from top-ranked variant to cluster similar evidence profiles
  const remaining = [...slice];
  const ordered: ScoredVariant[] = [remaining.shift()!];
  while (remaining.length > 0) {
    const lastVec = extractEvidenceVector(ordered[ordered.length - 1]);
    let bestIdx = 0;
    let bestSim = -1;
    for (let i = 0; i < remaining.length; i++) {
      const sim = cosineSimilarity(lastVec, extractEvidenceVector(remaining[i]));
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }
    ordered.push(remaining.splice(bestIdx, 1)[0]);
  }

  const items = ordered.map((entry) => {
    const v = entry.variant;
    const prot = v.hgvsP !== 'p.?' ? v.hgvsP : v.hgvsC;
    return {
      label: `${v.gene} ${prot}`,
      entry,
    };
  });

  const vectors = ordered.map(extractEvidenceVector);
  const cells: PairwiseSimilarityCell[] = [];

  for (let r = 0; r < items.length; r++) {
    for (let c = 0; c < items.length; c++) {
      cells.push({
        rowIdx: r,
        colIdx: c,
        rowLabel: items[r].label,
        colLabel: items[c].label,
        similarity: r === c ? 1 : cosineSimilarity(vectors[r], vectors[c]),
        rowEntry: items[r].entry,
        colEntry: items[c].entry,
      });
    }
  }

  return { items, cells };
}

export interface ConditionVariantGroup {
  condition: string;
  variants: ScoredVariant[];
  genes: string[];
  clingenValidity: string;
  inheritance: string;
  conflictingCount: number;
  unstudiedCount: number;
}

export function buildConditionVariantIndex(
  scoredVariants: ScoredVariant[],
  extraGeneMeta?: Record<string, GeneMetadata>,
): ConditionVariantGroup[] {
  const byCondition = new Map<
    string,
    {
      display: string;
      variants: ScoredVariant[];
      genes: Set<string>;
      clingenValidity: string;
      inheritance: string;
      conflictingCount: number;
      unstudiedCount: number;
    }
  >();

  for (const entry of scoredVariants) {
    const v = entry.variant;
    const conditions = getVariantConditions(v, extraGeneMeta);
    const meta = GENE_METADATA[v.gene] ?? extraGeneMeta?.[v.gene];

    for (const cond of conditions) {
      const key = cond.trim().toLowerCase();
      if (!key) continue;

      let group = byCondition.get(key);
      if (!group) {
        const detail = meta?.conditionDetails?.find(
          (d) => d.condition.toLowerCase() === key,
        );
        group = {
          display: cond,
          variants: [],
          genes: new Set<string>(),
          clingenValidity: detail?.clingenValidity ?? v.clingenValidity,
          inheritance: detail?.inheritance ?? meta?.inheritance ?? 'Curated',
          conflictingCount: 0,
          unstudiedCount: 0,
        };
        byCondition.set(key, group);
      }

      if (!group.variants.some((existing) => existing.variant.id === v.id)) {
        group.variants.push(entry);
        group.genes.add(v.gene);
        if (v.clinvarStatus === 'Conflicting Interpretations') {
          group.conflictingCount += 1;
        }
        if (v.functionalStatus === 'None') {
          group.unstudiedCount += 1;
        }
      }
    }
  }

  return Array.from(byCondition.values())
    .map((g) => ({
      condition: g.display,
      variants: g.variants.sort((a, b) => a.rank - b.rank),
      genes: Array.from(g.genes).sort(),
      clingenValidity: g.clingenValidity,
      inheritance: g.inheritance,
      conflictingCount: g.conflictingCount,
      unstudiedCount: g.unstudiedCount,
    }))
    .sort((a, b) => {
      if (b.variants.length !== a.variants.length) {
        return b.variants.length - a.variants.length;
      }
      return a.condition.localeCompare(b.condition);
    });
}

export interface ConditionPairOverlap {
  conditionA: string;
  conditionB: string;
  onlyA: ScoredVariant[];
  shared: ScoredVariant[];
  onlyB: ScoredVariant[];
}

export function computeConditionPairOverlap(
  scoredVariants: ScoredVariant[],
  conditionA: string,
  conditionB: string,
  extraGeneMeta?: Record<string, GeneMetadata>,
): ConditionPairOverlap {
  const keyA = conditionA.trim().toLowerCase();
  const keyB = conditionB.trim().toLowerCase();

  const matchesCondition = (entry: ScoredVariant, targetKey: string): boolean => {
    if (!targetKey) return false;
    return getVariantConditions(entry.variant, extraGeneMeta).some(
      (c) => c.trim().toLowerCase() === targetKey,
    );
  };

  const onlyA: ScoredVariant[] = [];
  const shared: ScoredVariant[] = [];
  const onlyB: ScoredVariant[] = [];

  for (const entry of scoredVariants) {
    const inA = matchesCondition(entry, keyA);
    const inB = matchesCondition(entry, keyB);
    if (inA && inB) {
      shared.push(entry);
    } else if (inA) {
      onlyA.push(entry);
    } else if (inB) {
      onlyB.push(entry);
    }
  }

  return {
    conditionA,
    conditionB,
    onlyA,
    shared,
    onlyB,
  };
}

export interface CohortOverlapComparison {
  onlyA: ScoredVariant[];
  shared: Array<{
    entryA: ScoredVariant;
    entryB: ScoredVariant;
    rankDiff: number;
  }>;
  onlyB: ScoredVariant[];
  conditionsOnlyA: string[];
  sharedConditions: string[];
  conditionsOnlyB: string[];
}

export function computeCohortPairOverlap(
  cohortAScored: ScoredVariant[],
  cohortBScored: ScoredVariant[],
  extraGeneMeta?: Record<string, GeneMetadata>,
): CohortOverlapComparison {
  const mapA = new Map<string, ScoredVariant>(
    cohortAScored.map((s) => [s.variant.id, s]),
  );
  const mapB = new Map<string, ScoredVariant>(
    cohortBScored.map((s) => [s.variant.id, s]),
  );

  const onlyA: ScoredVariant[] = [];
  const shared: Array<{
    entryA: ScoredVariant;
    entryB: ScoredVariant;
    rankDiff: number;
  }> = [];
  const onlyB: ScoredVariant[] = [];

  for (const entryA of cohortAScored) {
    const entryB = mapB.get(entryA.variant.id);
    if (entryB) {
      shared.push({
        entryA,
        entryB,
        rankDiff: entryB.rank - entryA.rank,
      });
    } else {
      onlyA.push(entryA);
    }
  }

  for (const entryB of cohortBScored) {
    if (!mapA.has(entryB.variant.id)) {
      onlyB.push(entryB);
    }
  }

  const condSetA = new Map<string, string>();
  const condSetB = new Map<string, string>();
  for (const s of cohortAScored) {
    for (const c of getVariantConditions(s.variant, extraGeneMeta)) {
      const k = c.toLowerCase();
      if (!condSetA.has(k)) condSetA.set(k, c);
    }
  }
  for (const s of cohortBScored) {
    for (const c of getVariantConditions(s.variant, extraGeneMeta)) {
      const k = c.toLowerCase();
      if (!condSetB.has(k)) condSetB.set(k, c);
    }
  }

  const conditionsOnlyA: string[] = [];
  const sharedConditions: string[] = [];
  const conditionsOnlyB: string[] = [];

  for (const [k, label] of condSetA.entries()) {
    if (condSetB.has(k)) sharedConditions.push(label);
    else conditionsOnlyA.push(label);
  }
  for (const [k, label] of condSetB.entries()) {
    if (!condSetA.has(k)) conditionsOnlyB.push(label);
  }

  return {
    onlyA,
    shared,
    onlyB,
    conditionsOnlyA: conditionsOnlyA.sort(),
    sharedConditions: sharedConditions.sort(),
    conditionsOnlyB: conditionsOnlyB.sort(),
  };
}
