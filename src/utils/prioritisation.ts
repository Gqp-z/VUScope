import { EXTENDED_GENE_METADATA } from '../data/extendedGenomes';
import { GENE_METADATA, RESEARCH_PRESETS } from '../data/genes';
import type {
  CohortSummaryStats,
  EvaluationComparisonRow,
  EvaluationSummary,
  FactorContribution,
  GeneMetadata,
  PrioritisationFilters,
  PrioritisationWeights,
  RecallPoint,
  ResearchPreset,
  ScoredVariant,
  ScoringConfig,
  VariantRecord,
  VariantType,
} from '../types/variant';
import { evaluateAcmgCriteria } from './acmgAutomation';

export const DEFAULT_WEIGHTS: PrioritisationWeights = {
  populationFrequency: 18,
  clinvarUncertainty: 18,
  functionalEvidence: 16,
  computationalPredictions: 22,
  similarVariantsTrend: 16,
  diseaseAssociation: 10,
};

export const DEFAULT_CONFIG: ScoringConfig = {
  frequencyObjective: 'rare_first',
  functionalObjective: 'gap_first',
};

export const DEFAULT_FILTERS: PrioritisationFilters = {
  gene: 'ALL',
  condition: 'ALL',
  variantType: 'ALL',
  clinvarConflict: 'ALL',
  functionalStatus: 'ALL',
  maxAf: null,
  searchQuery: '',
};

export const FACTOR_LABELS: Record<keyof PrioritisationWeights, string> = {
  populationFrequency: 'Population Frequency',
  clinvarUncertainty: 'ClinVar Conflict',
  functionalEvidence: 'Functional Study',
  computationalPredictions: 'In-Silico Consensus',
  similarVariantsTrend: 'Similar Variant Trend',
  diseaseAssociation: 'Disease Association',
};

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function computePopulationFrequencySubscore(
  af: number,
  objective: ScoringConfig['frequencyObjective'],
): { score: number; rationale: string } {
  if (objective === 'rare_first') {
    if (af <= 0) {
      return { score: 1.0, rationale: 'Absent from gnomAD v4 (AF = 0)' };
    }
    // Log10 scale: 1e-6 -> ~0.92, 1e-4 -> ~0.58, 1e-2 -> ~0.12
    const logAf = Math.log10(Math.max(af, 1e-7));
    const normalized = clamp01((-2 - logAf) / 5);
    return {
      score: Math.max(0.05, normalized),
      rationale: `Ultra-rare/rare AF (${af.toExponential(2)})`,
    };
  }

  // prevalent_first: elevates variants carried by larger human cohorts
  if (af <= 0) {
    return { score: 0.1, rationale: 'Absent in gnomAD v4 (low population prevalence)' };
  }
  const logAf = Math.log10(Math.min(af, 0.05));
  const normalized = clamp01((logAf + 6.5) / 4.8);
  return {
    score: Math.max(0.15, normalized),
    rationale: `Population prevalence AF (${af.toExponential(2)})`,
  };
}

export function computeClinvarUncertaintySubscore(variant: VariantRecord): {
  score: number;
  rationale: string;
} {
  const { total, vus, lpOrP, lbOrB } = variant.clinvarSubmissions;
  const safeTotal = Math.max(1, total);

  if (variant.clinvarStatus === 'Conflicting Interpretations') {
    if (lpOrP > 0 && lbOrB === 0) {
      const ratio = lpOrP / safeTotal;
      const volumeBoost = Math.min(0.15, safeTotal / 120);
      const score = clamp01(0.76 + ratio * 0.25 + volumeBoost);
      return {
        score,
        rationale: `Conflicting VUS (${vus}) vs LP/P (${lpOrP}) across ${total} labs`,
      };
    }
    const conflictSpread = 1 - Math.abs(lpOrP - lbOrB) / safeTotal;
    const score = clamp01(0.62 + conflictSpread * 0.22);
    return {
      score,
      rationale: `Split ClinVar conflict across ${total} submissions`,
    };
  }

  // Uniform VUS: higher submission count indicates recurring clinical ambiguity
  const recurrence = Math.min(0.25, safeTotal / 32);
  const score = clamp01(0.32 + recurrence);
  return {
    score,
    rationale: `Uniform VUS across ${total} ClinVar submission${total === 1 ? '' : 's'}`,
  };
}

export function computeFunctionalEvidenceSubscore(
  variant: VariantRecord,
  objective: ScoringConfig['functionalObjective'],
): { score: number; rationale: string } {
  if (objective === 'gap_first') {
    if (variant.functionalStatus === 'None') {
      const pubPenalty = Math.min(0.12, variant.pubmedCount * 0.03);
      return {
        score: clamp01(1.0 - pubPenalty),
        rationale: 'No functional assay published (high discovery gap)',
      };
    }
    if (variant.functionalStatus === 'Preliminary') {
      return {
        score: 0.52,
        rationale: `Preliminary assay only (${variant.pubmedCount} PubMed refs)`,
      };
    }
    return {
      score: 0.14,
      rationale: `Published functional assay exists (${variant.pubmedCount} PubMed refs)`,
    };
  }

  // studied_first: prioritises variants with existing preliminary/published signals
  if (variant.functionalStatus === 'Published Assay') {
    return {
      score: clamp01(0.85 + Math.min(0.15, variant.pubmedCount * 0.01)),
      rationale: `Published functional evidence (${variant.pubmedCount} PubMed refs)`,
    };
  }
  if (variant.functionalStatus === 'Preliminary') {
    return {
      score: 0.82,
      rationale: `Preliminary functional signal (${variant.pubmedCount} PubMed refs)`,
    };
  }
  return {
    score: 0.15,
    rationale: 'No prior functional literature',
  };
}

export function computeComputationalSubscore(variant: VariantRecord): {
  score: number;
  rationale: string;
} {
  const weightedParts: Array<{ value: number; weight: number; label: string }> = [];

  if (variant.revelScore !== null) {
    weightedParts.push({
      value: clamp01(variant.revelScore),
      weight: 0.36,
      label: `REVEL ${variant.revelScore.toFixed(2)}`,
    });
  }

  if (variant.alphaMissenseScore !== undefined && variant.alphaMissenseScore !== null) {
    weightedParts.push({
      value: clamp01(variant.alphaMissenseScore),
      weight: 0.24,
      label: `AlphaMissense ${variant.alphaMissenseScore.toFixed(2)}`,
    });
  }

  if (variant.caddPhred !== null) {
    // CADD Phred 10..35 mapped to 0..1
    const normCadd = clamp01((variant.caddPhred - 10) / 25);
    weightedParts.push({
      value: normCadd,
      weight: 0.2,
      label: `CADD ${variant.caddPhred.toFixed(1)}`,
    });
  }

  if (variant.siftScore !== null) {
    // SIFT is 0 = deleterious, 1 = tolerated
    weightedParts.push({
      value: clamp01(1 - variant.siftScore),
      weight: 0.1,
      label: `SIFT ${variant.siftScore.toFixed(2)}`,
    });
  }

  if (variant.polyphenScore !== null) {
    weightedParts.push({
      value: clamp01(variant.polyphenScore),
      weight: 0.1,
      label: `PolyPhen ${variant.polyphenScore.toFixed(2)}`,
    });
  }

  if (weightedParts.length === 0) {
    return { score: 0.4, rationale: 'No dbNSFP scores available (neutral fallback)' };
  }

  const totalW = weightedParts.reduce((acc, p) => acc + p.weight, 0);
  const score = clamp01(
    weightedParts.reduce((acc, p) => acc + p.value * (p.weight / totalW), 0),
  );

  return {
    score,
    rationale: weightedParts.map((p) => p.label).join(' · '),
  };
}

export function computeSimilarVariantsSubscore(variant: VariantRecord): {
  score: number;
  rationale: string;
} {
  let nearbyBoost = 0;
  let sameCodonPath = 0;
  let proximalPath = 0;
  let proximalBenign = 0;

  for (const ref of variant.similarClassifiedVariants) {
    const isPath = ref.classification === 'Pathogenic' || ref.classification === 'Likely Pathogenic';
    if (isPath) {
      if (ref.distanceAa === 0) {
        sameCodonPath += 1;
        nearbyBoost += 0.42;
      } else if (ref.distanceAa <= 15) {
        proximalPath += 1;
        nearbyBoost += 0.24;
      } else {
        nearbyBoost += 0.12;
      }
    } else {
      proximalBenign += 1;
      nearbyBoost -= 0.18;
    }
  }

  const domainTotal = variant.sameDomainPathogenicCount + variant.sameDomainBenignCount;
  const domainRatio =
    domainTotal > 0 ? (variant.sameDomainPathogenicCount + 0.5) / (domainTotal + 3) : 0.35;

  const score = clamp01(domainRatio * 0.52 + Math.max(-0.15, Math.min(0.6, nearbyBoost)));

  const details: string[] = [];
  if (sameCodonPath > 0) details.push(`${sameCodonPath} same-codon P/LP`);
  if (proximalPath > 0) details.push(`${proximalPath} nearby P/LP`);
  if (proximalBenign > 0) details.push(`${proximalBenign} nearby B/LB`);
  details.push(
    `domain ${variant.sameDomainPathogenicCount}P/${variant.sameDomainBenignCount}B`,
  );

  return {
    score,
    rationale: details.join(' · '),
  };
}

export function computeDiseaseAssociationSubscore(variant: VariantRecord): {
  score: number;
  rationale: string;
} {
  const validityMap: Record<VariantRecord['clingenValidity'], number> = {
    Definitive: 0.72,
    Strong: 0.58,
    Moderate: 0.38,
    Limited: 0.2,
  };

  const base = validityMap[variant.clingenValidity] ?? 0.35;
  const actionability = clamp01(variant.clingenActionabilityScore / 12) * 0.28;
  const score = clamp01(base + actionability);

  return {
    score,
    rationale: `ClinGen ${variant.clingenValidity} · Actionability ${variant.clingenActionabilityScore}/12`,
  };
}

export function normalizeWeights(weights: PrioritisationWeights): Record<keyof PrioritisationWeights, number> {
  const keys = Object.keys(weights) as Array<keyof PrioritisationWeights>;
  const rawSum = keys.reduce((sum, key) => sum + Math.max(0, weights[key]), 0);

  if (rawSum <= 0) {
    const equal = 1 / keys.length;
    return {
      populationFrequency: equal,
      clinvarUncertainty: equal,
      functionalEvidence: equal,
      computationalPredictions: equal,
      similarVariantsTrend: equal,
      diseaseAssociation: equal,
    };
  }

  return {
    populationFrequency: Math.max(0, weights.populationFrequency) / rawSum,
    clinvarUncertainty: Math.max(0, weights.clinvarUncertainty) / rawSum,
    functionalEvidence: Math.max(0, weights.functionalEvidence) / rawSum,
    computationalPredictions: Math.max(0, weights.computationalPredictions) / rawSum,
    similarVariantsTrend: Math.max(0, weights.similarVariantsTrend) / rawSum,
    diseaseAssociation: Math.max(0, weights.diseaseAssociation) / rawSum,
  };
}

const AA_1_TO_3: Record<string, string> = {
  A: 'Ala',
  R: 'Arg',
  N: 'Asn',
  D: 'Asp',
  C: 'Cys',
  Q: 'Gln',
  E: 'Glu',
  G: 'Gly',
  H: 'His',
  I: 'Ile',
  L: 'Leu',
  K: 'Lys',
  M: 'Met',
  F: 'Phe',
  P: 'Pro',
  S: 'Ser',
  T: 'Thr',
  W: 'Trp',
  Y: 'Tyr',
  V: 'Val',
  '*': 'Ter',
  X: 'Ter',
};

export function expandProteinShorthand(query: string): string[] {
  const trimmed = query.trim();
  const terms = [trimmed.toLowerCase()];
  // Match patterns like R158H, p.R158H, C61G, W1038*
  const match = /^(?:p\.)?([ARNDCQEGHILKMFPSTWYV])(\d+)([ARNDCQEGHILKMFPSTWYV*X])$/i.exec(
    trimmed,
  );
  if (match) {
    const ref3 = AA_1_TO_3[match[1].toUpperCase()];
    const pos = match[2];
    const alt3 = AA_1_TO_3[match[3].toUpperCase()];
    if (ref3 && alt3) {
      terms.push(`p.${ref3}${pos}${alt3}`.toLowerCase());
      terms.push(`${ref3}${pos}${alt3}`.toLowerCase());
    }
  }
  return terms;
}

export function getVariantConditions(
  variant: VariantRecord,
  extraGeneMeta?: Record<string, GeneMetadata>,
): string[] {
  const deduped = new Map<string, string>();
  const hasExplicitVariantConditions =
    Array.isArray(variant.associatedConditions) && variant.associatedConditions.length > 0;

  const fallbackGeneConditions = hasExplicitVariantConditions
    ? []
    : GENE_METADATA[variant.gene]?.primaryConditions ??
      EXTENDED_GENE_METADATA[variant.gene]?.primaryConditions ??
      extraGeneMeta?.[variant.gene]?.primaryConditions ??
      [];

  for (const cond of [
    variant.diseaseAssociation,
    ...(variant.associatedConditions ?? []),
    ...fallbackGeneConditions,
  ]) {
    const clean = cond.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, clean);
    }
  }
  return Array.from(deduped.values());
}

export function getAvailableConditionsForGene(
  variants: VariantRecord[],
  gene: string,
  currentCondition: string = 'ALL',
  extraGeneMeta?: Record<string, GeneMetadata>,
): string[] {
  const map = new Map<string, string>();
  const relevantGenes = new Set<string>();

  for (const v of variants) {
    if (gene !== 'ALL' && v.gene !== gene) continue;
    relevantGenes.add(v.gene);
    for (const cond of getVariantConditions(v, extraGeneMeta)) {
      const key = cond.toLowerCase();
      if (!map.has(key)) map.set(key, cond);
    }
  }

  if (gene !== 'ALL') {
    relevantGenes.add(gene);
  }

  for (const sym of relevantGenes) {
    const meta =
      GENE_METADATA[sym] ?? EXTENDED_GENE_METADATA[sym] ?? extraGeneMeta?.[sym];
    for (const cond of meta?.primaryConditions ?? []) {
      const key = cond.toLowerCase();
      if (!map.has(key)) map.set(key, cond);
    }
  }

  if (currentCondition !== 'ALL') {
    const key = currentCondition.toLowerCase();
    if (!map.has(key)) map.set(key, currentCondition);
  }

  return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
}

export function summarizeScoredCohort(scoredVariants: ScoredVariant[]): CohortSummaryStats {
  const total = scoredVariants.length;
  if (total === 0) {
    return {
      total: 0,
      conflicting: 0,
      unstudied: 0,
      topScore: 0,
      meanScore: 0,
      highInSilicoCount: 0,
    };
  }

  let conflicting = 0;
  let unstudied = 0;
  let highInSilicoCount = 0;
  let scoreSum = 0;

  for (const entry of scoredVariants) {
    scoreSum += entry.priorityScore;
    if (entry.variant.clinvarStatus === 'Conflicting Interpretations') {
      conflicting += 1;
    }
    if (entry.variant.functionalStatus === 'None') {
      unstudied += 1;
    }
    if (
      (entry.variant.revelScore !== null && entry.variant.revelScore >= 0.75) ||
      (entry.variant.caddPhred !== null && entry.variant.caddPhred >= 25)
    ) {
      highInSilicoCount += 1;
    }
  }

  return {
    total,
    conflicting,
    unstudied,
    topScore: scoredVariants[0].priorityScore,
    meanScore: Number((scoreSum / total).toFixed(1)),
    highInSilicoCount,
  };
}

export function findMatchingPresetId(
  weights: PrioritisationWeights,
  config: ScoringConfig,
  presets: ResearchPreset[] = RESEARCH_PRESETS,
): string | null {
  const matched = presets.find(
    (p) =>
      p.config.frequencyObjective === config.frequencyObjective &&
      p.config.functionalObjective === config.functionalObjective &&
      p.weights.populationFrequency === weights.populationFrequency &&
      p.weights.clinvarUncertainty === weights.clinvarUncertainty &&
      p.weights.functionalEvidence === weights.functionalEvidence &&
      p.weights.computationalPredictions === weights.computationalPredictions &&
      p.weights.similarVariantsTrend === weights.similarVariantsTrend &&
      p.weights.diseaseAssociation === weights.diseaseAssociation,
  );
  return matched ? matched.id : null;
}

export function filterVariants(
  variants: VariantRecord[],
  filters: PrioritisationFilters,
  extraGeneMeta?: Record<string, GeneMetadata>,
): VariantRecord[] {
  const query = filters.searchQuery.trim().toLowerCase();
  const tokenGroups =
    query.length > 0
      ? query
          .split(/\s+/)
          .filter(Boolean)
          .map((tok) => expandProteinShorthand(tok))
      : [];
  const conditionTarget =
    filters.condition && filters.condition !== 'ALL'
      ? filters.condition.trim().toLowerCase()
      : null;

  return variants.filter((variant) => {
    if (filters.gene !== 'ALL' && variant.gene !== filters.gene) {
      return false;
    }
    const allConditions = getVariantConditions(variant, extraGeneMeta);
    if (conditionTarget) {
      const hasCondition = allConditions.some((c) => {
        const lower = c.toLowerCase();
        return lower === conditionTarget || lower.includes(conditionTarget);
      });
      if (!hasCondition) {
        return false;
      }
    }
    if (filters.variantType !== 'ALL' && variant.variantType !== filters.variantType) {
      return false;
    }
    if (
      filters.clinvarConflict === 'CONFLICTING' &&
      variant.clinvarStatus !== 'Conflicting Interpretations'
    ) {
      return false;
    }
    if (
      filters.clinvarConflict === 'UNIFORM' &&
      variant.clinvarStatus !== 'Uniform VUS'
    ) {
      return false;
    }
    if (filters.functionalStatus === 'NONE' && variant.functionalStatus !== 'None') {
      return false;
    }
    if (filters.functionalStatus === 'HAS_STUDY' && variant.functionalStatus === 'None') {
      return false;
    }
    if (filters.maxAf !== null && variant.gnomadAf > filters.maxAf) {
      return false;
    }
    if (filters.hotVusOnly && !evaluateAcmgCriteria(variant).isHotVus) {
      return false;
    }
    if (filters.evaluatedAfter) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(variant.clinvarLastEvaluated) ||
        variant.clinvarLastEvaluated < filters.evaluatedAfter
      ) {
        return false;
      }
    }
    if (filters.evaluatedBefore) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(variant.clinvarLastEvaluated) ||
        variant.clinvarLastEvaluated > filters.evaluatedBefore
      ) {
        return false;
      }
    }
    if (tokenGroups.length > 0) {
      const haystack = [
        variant.gene,
        variant.hgvsC,
        variant.hgvsP,
        variant.rsId ?? '',
        variant.clinvarId,
        variant.variantType,
        variant.proteinDomain,
        ...allConditions,
        ...variant.pubmedIds,
      ]
        .join(' ')
        .toLowerCase();
      if (!tokenGroups.every((alts) => alts.some((term) => haystack.includes(term)))) {
        return false;
      }
    }
    return true;
  });
}

export function applySearchQueryWithSmartGeneScope(
  variants: VariantRecord[],
  currentFilters: PrioritisationFilters,
  nextQuery: string,
  extraGeneMeta?: Record<string, GeneMetadata>,
): { filters: PrioritisationFilters; autoExpandedFromGene: string | null } {
  const candidateFilters: PrioritisationFilters = {
    ...currentFilters,
    searchQuery: nextQuery,
  };

  if (nextQuery.trim().length === 0) {
    return { filters: candidateFilters, autoExpandedFromGene: null };
  }

  const inActiveScope = filterVariants(variants, candidateFilters, extraGeneMeta);
  if (inActiveScope.length > 0) {
    return { filters: candidateFilters, autoExpandedFromGene: null };
  }

  if (currentFilters.gene !== 'ALL') {
    const acrossAllGenes = filterVariants(
      variants,
      {
        ...candidateFilters,
        gene: 'ALL',
      },
      extraGeneMeta,
    );
    if (acrossAllGenes.length > 0) {
      return {
        filters: { ...candidateFilters, gene: 'ALL' },
        autoExpandedFromGene: currentFilters.gene,
      };
    }
  }

  if (currentFilters.condition !== 'ALL') {
    const acrossAllGenesAndConds = filterVariants(
      variants,
      {
        ...candidateFilters,
        gene: 'ALL',
        condition: 'ALL',
      },
      extraGeneMeta,
    );
    if (acrossAllGenesAndConds.length > 0) {
      return {
        filters: { ...candidateFilters, gene: 'ALL', condition: 'ALL' },
        autoExpandedFromGene: currentFilters.gene !== 'ALL' ? currentFilters.gene : null,
      };
    }
  }

  return { filters: candidateFilters, autoExpandedFromGene: null };
}

export function scoreVariant(
  variant: VariantRecord,
  weights: PrioritisationWeights,
  config: ScoringConfig,
): Omit<ScoredVariant, 'rank'> {
  const normW = normalizeWeights(weights);

  const pop = computePopulationFrequencySubscore(variant.gnomadAf, config.frequencyObjective);
  const clinvar = computeClinvarUncertaintySubscore(variant);
  const func = computeFunctionalEvidenceSubscore(variant, config.functionalObjective);
  const comp = computeComputationalSubscore(variant);
  const sim = computeSimilarVariantsSubscore(variant);
  const disease = computeDiseaseAssociationSubscore(variant);

  const contributions: FactorContribution[] = [
    {
      key: 'populationFrequency',
      label: FACTOR_LABELS.populationFrequency,
      rawSubscore: pop.score,
      normalizedWeight: normW.populationFrequency,
      weightedPoints: pop.score * normW.populationFrequency * 100,
      rationale: pop.rationale,
    },
    {
      key: 'clinvarUncertainty',
      label: FACTOR_LABELS.clinvarUncertainty,
      rawSubscore: clinvar.score,
      normalizedWeight: normW.clinvarUncertainty,
      weightedPoints: clinvar.score * normW.clinvarUncertainty * 100,
      rationale: clinvar.rationale,
    },
    {
      key: 'functionalEvidence',
      label: FACTOR_LABELS.functionalEvidence,
      rawSubscore: func.score,
      normalizedWeight: normW.functionalEvidence,
      weightedPoints: func.score * normW.functionalEvidence * 100,
      rationale: func.rationale,
    },
    {
      key: 'computationalPredictions',
      label: FACTOR_LABELS.computationalPredictions,
      rawSubscore: comp.score,
      normalizedWeight: normW.computationalPredictions,
      weightedPoints: comp.score * normW.computationalPredictions * 100,
      rationale: comp.rationale,
    },
    {
      key: 'similarVariantsTrend',
      label: FACTOR_LABELS.similarVariantsTrend,
      rawSubscore: sim.score,
      normalizedWeight: normW.similarVariantsTrend,
      weightedPoints: sim.score * normW.similarVariantsTrend * 100,
      rationale: sim.rationale,
    },
    {
      key: 'diseaseAssociation',
      label: FACTOR_LABELS.diseaseAssociation,
      rawSubscore: disease.score,
      normalizedWeight: normW.diseaseAssociation,
      weightedPoints: disease.score * normW.diseaseAssociation * 100,
      rationale: disease.rationale,
    },
  ];

  const priorityScore = Number(
    contributions.reduce((sum, c) => sum + c.weightedPoints, 0).toFixed(2),
  );

  return {
    variant,
    priorityScore,
    contributions,
  };
}

export function scoreAndRankVariants(
  variants: VariantRecord[],
  weights: PrioritisationWeights,
  filters: PrioritisationFilters = DEFAULT_FILTERS,
  config: ScoringConfig = DEFAULT_CONFIG,
  extraGeneMeta?: Record<string, GeneMetadata>,
): ScoredVariant[] {
  const filtered = filterVariants(variants, filters, extraGeneMeta);
  const scored = filtered.map((variant) => scoreVariant(variant, weights, config));

  scored.sort((a, b) => {
    if (Math.abs(b.priorityScore - a.priorityScore) > 1e-6) {
      return b.priorityScore - a.priorityScore;
    }
    const revelA = a.variant.revelScore ?? 0;
    const revelB = b.variant.revelScore ?? 0;
    if (revelB !== revelA) return revelB - revelA;
    if (a.variant.gnomadAf !== b.variant.gnomadAf) {
      return a.variant.gnomadAf - b.variant.gnomadAf;
    }
    return a.variant.id.localeCompare(b.variant.id);
  });

  return scored.map((entry, idx) => ({
    ...entry,
    rank: idx + 1,
  }));
}

export function isPositiveEvaluationTruth(variant: VariantRecord): boolean {
  return (
    variant.evaluationTruth === 'reclassified_lp_p' ||
    variant.evaluationTruth === 'functional_impact_confirmed'
  );
}

/**
 * Evaluates the current custom weighted model against a simple Rarity-Only Baseline
 * (ranking strictly by lowest gnomAD allele frequency, with deterministic ID tie-breaking)
 * using held-out evaluationTruth labels that are NEVER read by scoreVariant().
 */
export function evaluateAgainstBaseline(
  variants: VariantRecord[],
  weights: PrioritisationWeights,
  filters: PrioritisationFilters = DEFAULT_FILTERS,
  config: ScoringConfig = DEFAULT_CONFIG,
  extraGeneMeta?: Record<string, GeneMetadata>,
): EvaluationSummary {
  const filtered = filterVariants(variants, filters, extraGeneMeta);
  const customRanked = scoreAndRankVariants(
    filtered,
    weights,
    DEFAULT_FILTERS,
    config,
    extraGeneMeta,
  );

  // Rarity-only baseline: lower gnomAD AF ranks higher (ties broken neutrally by HGVS cDNA)
  const baselineRanked = [...filtered].sort((a, b) => {
    if (a.gnomadAf !== b.gnomadAf) {
      return a.gnomadAf - b.gnomadAf;
    }
    return a.hgvsC.localeCompare(b.hgvsC);
  });

  const customRankMap = new Map<string, { rank: number; score: number }>();
  customRanked.forEach((item) => {
    customRankMap.set(item.variant.id, { rank: item.rank, score: item.priorityScore });
  });

  const baselineRankMap = new Map<string, number>();
  baselineRanked.forEach((v, idx) => {
    baselineRankMap.set(v.id, idx + 1);
  });

  const totalEvaluated = filtered.length;
  const positiveVariants = filtered.filter(isPositiveEvaluationTruth);
  const totalPositiveTruth = positiveVariants.length;

  const precisionAtK = (rankedIds: string[], k: number): number => {
    const slice = rankedIds.slice(0, Math.min(k, rankedIds.length));
    if (slice.length === 0) return 0;
    const posSet = new Set(positiveVariants.map((v) => v.id));
    const hits = slice.filter((id) => posSet.has(id)).length;
    return hits / slice.length;
  };

  const customIds = customRanked.map((s) => s.variant.id);
  const baselineIds = baselineRanked.map((v) => v.id);

  const p5Custom = precisionAtK(customIds, 5);
  const p5Base = precisionAtK(baselineIds, 5);
  const p10Custom = precisionAtK(customIds, 10);
  const p10Base = precisionAtK(baselineIds, 10);

  const calcMrr = (ids: string[]): number => {
    if (totalPositiveTruth === 0) return 0;
    const posSet = new Set(positiveVariants.map((v) => v.id));
    let sum = 0;
    ids.forEach((id, idx) => {
      if (posSet.has(id)) {
        sum += 1 / (idx + 1);
      }
    });
    return sum / totalPositiveTruth;
  };

  const recallCurve: RecallPoint[] = [];
  const stepCount = Math.min(totalEvaluated, 25);
  const posSet = new Set(positiveVariants.map((v) => v.id));

  for (let k = 1; k <= stepCount; k++) {
    const cSlice = customIds.slice(0, k);
    const bSlice = baselineIds.slice(0, k);
    const cHits = cSlice.filter((id) => posSet.has(id)).length;
    const bHits = bSlice.filter((id) => posSet.has(id)).length;

    recallCurve.push({
      k,
      customRecall: totalPositiveTruth > 0 ? cHits / totalPositiveTruth : 0,
      baselineRecall: totalPositiveTruth > 0 ? bHits / totalPositiveTruth : 0,
      customPrecision: cHits / k,
      baselinePrecision: bHits / k,
    });
  }

  const positiveVariantRows: EvaluationComparisonRow[] = positiveVariants
    .map((variant) => {
      const customInfo = customRankMap.get(variant.id) ?? { rank: totalEvaluated, score: 0 };
      const baselineRank = baselineRankMap.get(variant.id) ?? totalEvaluated;
      return {
        variant,
        customRank: customInfo.rank,
        baselineRank,
        rankGain: baselineRank - customInfo.rank,
        customScore: customInfo.score,
      };
    })
    .sort((a, b) => a.customRank - b.customRank);

  const randomBaselineRate = totalEvaluated > 0 ? totalPositiveTruth / totalEvaluated : 0;
  const enrichmentAt10 = randomBaselineRate > 0 ? p10Custom / randomBaselineRate : 0;

  return {
    totalEvaluated,
    totalPositiveTruth,
    precisionAt5Custom: p5Custom,
    precisionAt5Baseline: p5Base,
    precisionAt10Custom: p10Custom,
    precisionAt10Baseline: p10Base,
    mrrCustom: calcMrr(customIds),
    mrrBaseline: calcMrr(baselineIds),
    enrichmentAt10,
    recallCurve,
    positiveVariantRows,
  };
}

export function formatAf(af: number): string {
  if (af <= 0) return '0 (Absent)';
  if (af < 0.0001) return af.toExponential(2);
  return af.toFixed(5);
}

function escapeCsvCell(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

export function variantsToCsv(
  scoredVariants: ScoredVariant[],
  weights: PrioritisationWeights,
): string {
  const norm = normalizeWeights(weights);
  const commentMeta = [
    `# VUScope Research Prioritisation Export`,
    `# Normalized Weights: PopulationFrequency=${(norm.populationFrequency * 100).toFixed(1)}%, ClinVarConflict=${(norm.clinvarUncertainty * 100).toFixed(1)}%, FunctionalStudy=${(norm.functionalEvidence * 100).toFixed(1)}%, InSilico=${(norm.computationalPredictions * 100).toFixed(1)}%, SimilarVariantTrend=${(norm.similarVariantsTrend * 100).toFixed(1)}%, DiseaseAssociation=${(norm.diseaseAssociation * 100).toFixed(1)}%`,
  ];

  const headers = [
    'Rank',
    'PriorityScore',
    'Gene',
    'HGVS_c',
    'HGVS_p',
    'ClinVar_ID',
    'Variant_Type',
    'Protein_Domain',
    'gnomAD_AF',
    'ClinVar_Status',
    'Functional_Status',
    'PubMed_Count',
    'REVEL',
    'AlphaMissense',
    'CADD_Phred',
    'SIFT',
    'PolyPhen2',
    'Same_Domain_Pathogenic',
    'Disease_Association',
    'Associated_Conditions',
    'ClinGen_Validity',
  ];

  const rows = scoredVariants.map((s) => {
    const v = s.variant;
    return [
      s.rank,
      s.priorityScore.toFixed(2),
      v.gene,
      v.hgvsC,
      v.hgvsP,
      v.clinvarId,
      v.variantType,
      v.proteinDomain,
      v.gnomadAf,
      v.clinvarStatus,
      v.functionalStatus,
      v.pubmedCount,
      v.revelScore ?? '',
      v.alphaMissenseScore ?? '',
      v.caddPhred ?? '',
      v.siftScore ?? '',
      v.polyphenScore ?? '',
      v.sameDomainPathogenicCount,
      v.diseaseAssociation,
      getVariantConditions(v).join('; '),
      v.clingenValidity,
    ]
      .map(escapeCsvCell)
      .join(',');
  });

  return [...commentMeta, headers.join(','), ...rows].join('\n');
}

const VALID_VARIANT_TYPES: VariantType[] = [
  'Missense',
  'Splice Region',
  'In-frame Indel',
  'Synonymous',
  'Regulatory / UTR',
  'Truncating VUS',
];

export function parseImportedCsv(rawText: string): {
  variants: VariantRecord[];
  errors: string[];
} {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length < 2) {
    return {
      variants: [],
      errors: ['Provide a header row plus at least one variant data row.'],
    };
  }

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const splitLine = (line: string): string[] => {
    if (delimiter === '\t') return line.split('\t').map((c) => c.trim());
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  const col = (names: string[]): number => {
    for (const n of names) {
      const idx = headers.indexOf(n);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const geneIdx = col(['gene', 'gene_symbol']);
  const hgvsCIdx = col(['hgvs_c', 'hgvsc', 'cdna']);
  if (geneIdx === -1 || hgvsCIdx === -1) {
    return {
      variants: [],
      errors: ['Required columns missing: must include "gene" and "hgvs_c" columns.'],
    };
  }

  const hgvsPIdx = col(['hgvs_p', 'hgvsp', 'protein']);
  const afIdx = col(['gnomad_af', 'af', 'allele_frequency']);
  const revelIdx = col(['revel', 'revel_score']);
  const caddIdx = col(['cadd', 'cadd_phred']);
  const typeIdx = col(['variant_type', 'type', 'consequence']);
  const domainIdx = col(['protein_domain', 'domain']);
  const clinvarIdx = col(['clinvar_id', 'clinvar']);
  const conflictIdx = col(['clinvar_status', 'conflict']);
  const funcIdx = col(['functional_status', 'functional']);
  const diseaseIdx = col(['disease_association', 'disease', 'condition']);

  const variants: VariantRecord[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const gene = (cells[geneIdx] ?? '').toUpperCase();
    const hgvsC = cells[hgvsCIdx] ?? '';
    if (!gene || !hgvsC) {
      errors.push(`Row ${i + 1}: missing gene or hgvs_c.`);
      continue;
    }

    const parseOptNum = (idx: number): number | null => {
      if (idx === -1 || !cells[idx]) return null;
      const n = Number(cells[idx]);
      return Number.isFinite(n) ? n : null;
    };

    const rawType = typeIdx !== -1 ? cells[typeIdx] : 'Missense';
    const matchedType =
      VALID_VARIANT_TYPES.find((t) => t.toLowerCase() === rawType.toLowerCase()) ?? 'Missense';

    const rawConflict = conflictIdx !== -1 ? (cells[conflictIdx] ?? '').toLowerCase() : '';
    const clinvarStatus = rawConflict.includes('conflict')
      ? 'Conflicting Interpretations'
      : 'Uniform VUS';

    const rawFunc = funcIdx !== -1 ? (cells[funcIdx] ?? '').toLowerCase() : '';
    const functionalStatus = rawFunc.includes('publish')
      ? 'Published Assay'
      : rawFunc.includes('prelim')
        ? 'Preliminary'
        : 'None';

    const afVal = Math.max(0, parseOptNum(afIdx) ?? 0);

    variants.push({
      id: `imported-${gene.toLowerCase()}-${i}-${Date.now()}`,
      gene,
      hgvsC,
      hgvsP: (hgvsPIdx !== -1 ? cells[hgvsPIdx] : '') || 'p.?',
      rsId: null,
      clinvarId: (clinvarIdx !== -1 ? cells[clinvarIdx] : '') || `IMP-${i}`,
      variantType: matchedType,
      aaPosition: null,
      proteinDomain: (domainIdx !== -1 ? cells[domainIdx] : '') || 'Unannotated Domain',
      gnomadAf: afVal,
      gnomadPopMaxLabel: afVal === 0 ? 'Absent in dataset' : `AF ${afVal.toExponential(2)}`,
      clinvarStatus,
      clinvarSubmissions: {
        total: clinvarStatus === 'Conflicting Interpretations' ? 6 : 2,
        vus: clinvarStatus === 'Conflicting Interpretations' ? 4 : 2,
        lpOrP: clinvarStatus === 'Conflicting Interpretations' ? 2 : 0,
        lbOrB: 0,
      },
      clinvarLastEvaluated: 'Imported',
      functionalStatus,
      pubmedCount: functionalStatus === 'None' ? 0 : 2,
      pubmedIds: [],
      functionalSummary: 'Imported user variant record.',
      revelScore: parseOptNum(revelIdx),
      caddPhred: parseOptNum(caddIdx),
      siftScore: null,
      polyphenScore: null,
      similarClassifiedVariants: [],
      sameDomainPathogenicCount: 0,
      sameDomainBenignCount: 0,
      diseaseAssociation:
        (diseaseIdx !== -1 ? cells[diseaseIdx] : '') || `${gene}-associated phenotype`,
      associatedConditions:
        diseaseIdx !== -1 && cells[diseaseIdx]
          ? cells[diseaseIdx]
              .split(/[;|]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
      clingenValidity: 'Moderate',
      clingenActionabilityScore: 6,
      evaluationTruth: 'unvalidated',
      evaluationNote: 'User-imported variant.',
      sourceType: 'imported',
    });
  }

  return { variants, errors };
}
