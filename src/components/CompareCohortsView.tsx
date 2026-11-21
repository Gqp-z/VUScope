import { useMemo, useState } from 'react';
import { ArrowLeftRight, ArrowUpRight, Check } from 'lucide-react';
import { GENE_METADATA, RESEARCH_PRESETS } from '../data/genes';
import type {
  GeneMetadata,
  PrioritisationFilters,
  PrioritisationWeights,
  ScoredVariant,
  ScoringConfig,
  VariantRecord,
} from '../types/variant';
import {
  buildConditionVariantIndex,
  computeCohortPairOverlap,
} from '../utils/heatmapAnalysis';
import {
  DEFAULT_FILTERS,
  formatAf,
  getAvailableConditionsForGene,
  scoreAndRankVariants,
  summarizeScoredCohort,
} from '../utils/prioritisation';
import { SearchableGenePicker } from './SearchableGenePicker';

interface CompareCohortsViewProps {
  variants: VariantRecord[];
  availableGenes: string[];
  fetchedGeneCounts?: Record<string, number>;
  totalCatalogGenes?: number;
  liveGeneMeta: Record<string, GeneMetadata>;
  weights: PrioritisationWeights;
  config: ScoringConfig;
  activePresetId: string | null;
  onSelectPreset: (presetId: string) => void;
  onConfigChange: (next: ScoringConfig) => void;
  onRequestGeneFetch?: (geneSymbol: string) => void;
  onInspectVariantInWorkbench: (variant: VariantRecord, filters: PrioritisationFilters) => void;
}

const FACTOR_COLORS: Record<keyof PrioritisationWeights, string> = {
  populationFrequency: '#0284C7',
  clinvarUncertainty: '#D97706',
  functionalEvidence: '#0D9488',
  computationalPredictions: '#1D4ED8',
  similarVariantsTrend: '#7C3AED',
  diseaseAssociation: '#475569',
};

function makeCohortDefaults(gene: string): PrioritisationFilters {
  return {
    ...DEFAULT_FILTERS,
    gene,
    condition: 'ALL',
  };
}

export function CompareCohortsView({
  variants,
  availableGenes,
  fetchedGeneCounts = {},
  totalCatalogGenes = 0,
  liveGeneMeta,
  weights,
  config,
  activePresetId,
  onSelectPreset,
  onConfigChange,
  onRequestGeneFetch,
  onInspectVariantInWorkbench,
}: CompareCohortsViewProps) {
  const [cohortAFilters, setCohortAFilters] = useState<PrioritisationFilters>(() =>
    makeCohortDefaults('BRCA1'),
  );
  const [cohortBFilters, setCohortBFilters] = useState<PrioritisationFilters>(() =>
    makeCohortDefaults(availableGenes.includes('TP53') ? 'TP53' : 'ALL'),
  );
  const [topLimit, setTopLimit] = useState<5 | 10 | 999>(10);

  const cohortAConditions = useMemo(
    () =>
      getAvailableConditionsForGene(
        variants,
        cohortAFilters.gene,
        cohortAFilters.condition,
        liveGeneMeta,
      ),
    [variants, cohortAFilters.gene, cohortAFilters.condition, liveGeneMeta],
  );

  const cohortBConditions = useMemo(
    () =>
      getAvailableConditionsForGene(
        variants,
        cohortBFilters.gene,
        cohortBFilters.condition,
        liveGeneMeta,
      ),
    [variants, cohortBFilters.gene, cohortBFilters.condition, liveGeneMeta],
  );

  const cohortAScored = useMemo(
    () => scoreAndRankVariants(variants, weights, cohortAFilters, config, liveGeneMeta),
    [variants, weights, cohortAFilters, config, liveGeneMeta],
  );

  const cohortBScored = useMemo(
    () => scoreAndRankVariants(variants, weights, cohortBFilters, config, liveGeneMeta),
    [variants, weights, cohortBFilters, config, liveGeneMeta],
  );

  const statsA = useMemo(() => summarizeScoredCohort(cohortAScored), [cohortAScored]);
  const statsB = useMemo(() => summarizeScoredCohort(cohortBScored), [cohortBScored]);

  const rankMapA = useMemo(() => {
    const map = new Map<string, number>();
    cohortAScored.forEach((s) => map.set(s.variant.id, s.rank));
    return map;
  }, [cohortAScored]);

  const rankMapB = useMemo(() => {
    const map = new Map<string, number>();
    cohortBScored.forEach((s) => map.set(s.variant.id, s.rank));
    return map;
  }, [cohortBScored]);

  const overlapCount = useMemo(() => {
    let count = 0;
    rankMapA.forEach((_, id) => {
      if (rankMapB.has(id)) count += 1;
    });
    return count;
  }, [rankMapA, rankMapB]);

  const cohortOverlap = useMemo(
    () => computeCohortPairOverlap(cohortAScored, cohortBScored, liveGeneMeta),
    [cohortAScored, cohortBScored, liveGeneMeta],
  );

  const conditionIndexA = useMemo(
    () => buildConditionVariantIndex(cohortAScored, liveGeneMeta),
    [cohortAScored, liveGeneMeta],
  );

  const conditionIndexB = useMemo(
    () => buildConditionVariantIndex(cohortBScored, liveGeneMeta),
    [cohortBScored, liveGeneMeta],
  );

  const handleSwapCohorts = () => {
    setCohortAFilters(cohortBFilters);
    setCohortBFilters(cohortAFilters);
  };

  const renderPane = (
    paneId: 'a' | 'b',
    label: string,
    accentClass: string,
    paneFilters: PrioritisationFilters,
    setPaneFilters: (next: PrioritisationFilters) => void,
    conditions: string[],
    conditionGroups: ReturnType<typeof buildConditionVariantIndex>,
    scored: ScoredVariant[],
    stats: ReturnType<typeof summarizeScoredCohort>,
    otherRankMap: Map<string, number>,
    otherLabel: string,
  ) => {
    const visibleRows = scored.slice(0, topLimit);
    const meta =
      paneFilters.gene !== 'ALL'
        ? GENE_METADATA[paneFilters.gene] ?? liveGeneMeta[paneFilters.gene]
        : undefined;

    return (
      <section
        aria-label={`${label} configuration and top-ranked variants`}
        className="flex flex-col border border-slate-200 bg-white rounded-md overflow-hidden"
      >
        {/* Pane Header & Independent Gene / Condition / Criteria Selectors */}
        <div className="border-b border-slate-200 bg-slate-50/80 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${accentClass}`}
              >
                {label}
              </span>
              <span className="text-xs font-semibold text-slate-900">
                {paneFilters.gene === 'ALL' ? 'All Genes' : paneFilters.gene}
                {paneFilters.condition !== 'ALL' ? ` · ${paneFilters.condition}` : ''}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setPaneFilters(makeCohortDefaults(paneFilters.gene))}
              className="text-[11px] font-medium text-slate-600 hover:text-blue-700 cursor-pointer"
            >
              Reset {label}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label
                htmlFor={`compare-${paneId}-gene`}
                className="block text-[11px] font-medium text-slate-600 mb-1"
              >
                Gene Cohort
              </label>
              <SearchableGenePicker
                id={`compare-${paneId}-gene`}
                value={paneFilters.gene}
                availableGenes={availableGenes}
                fetchedGeneCounts={fetchedGeneCounts}
                totalCatalogGenes={totalCatalogGenes}
                compact
                onChange={(geneSymbol) => {
                  if (geneSymbol !== 'ALL') {
                    onRequestGeneFetch?.(geneSymbol);
                  }
                  setPaneFilters({
                    ...paneFilters,
                    gene: geneSymbol,
                    condition: 'ALL',
                  });
                }}
              />
            </div>

            <div>
              <label
                htmlFor={`compare-${paneId}-condition`}
                className="block text-[11px] font-medium text-slate-600 mb-1"
              >
                Condition / Spectrum
              </label>
              <select
                id={`compare-${paneId}-condition`}
                value={paneFilters.condition}
                onChange={(e) =>
                  setPaneFilters({
                    ...paneFilters,
                    condition: e.target.value,
                  })
                }
                className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900 focus:border-blue-700 focus:outline-none"
              >
                <option value="ALL">All Conditions ({conditions.length})</option>
                {conditions.map((cond) => (
                  <option key={cond} value={cond}>
                    {cond}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label
                htmlFor={`compare-${paneId}-type`}
                className="block text-[10px] font-medium text-slate-500 mb-0.5"
              >
                Variant Type
              </label>
              <select
                id={`compare-${paneId}-type`}
                value={paneFilters.variantType}
                onChange={(e) =>
                  setPaneFilters({ ...paneFilters, variantType: e.target.value })
                }
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-800 focus:border-blue-700 focus:outline-none"
              >
                <option value="ALL">All Types</option>
                <option value="Missense">Missense</option>
                <option value="Splice Region">Splice Region</option>
                <option value="In-frame Indel">In-frame Indel</option>
                <option value="Truncating VUS">Truncating VUS</option>
                <option value="Synonymous">Synonymous</option>
                <option value="Regulatory / UTR">Regulatory / UTR</option>
              </select>
            </div>

            <div>
              <label
                htmlFor={`compare-${paneId}-clinvar`}
                className="block text-[10px] font-medium text-slate-500 mb-0.5"
              >
                ClinVar Status
              </label>
              <select
                id={`compare-${paneId}-clinvar`}
                value={paneFilters.clinvarConflict}
                onChange={(e) =>
                  setPaneFilters({
                    ...paneFilters,
                    clinvarConflict: e.target.value as PrioritisationFilters['clinvarConflict'],
                  })
                }
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-800 focus:border-blue-700 focus:outline-none"
              >
                <option value="ALL">All ClinVar VUS</option>
                <option value="CONFLICTING">Conflicting Only</option>
                <option value="UNIFORM">Uniform VUS Only</option>
              </select>
            </div>

            <div>
              <label
                htmlFor={`compare-${paneId}-functional`}
                className="block text-[10px] font-medium text-slate-500 mb-0.5"
              >
                Functional Status
              </label>
              <select
                id={`compare-${paneId}-functional`}
                value={paneFilters.functionalStatus}
                onChange={(e) =>
                  setPaneFilters({
                    ...paneFilters,
                    functionalStatus: e.target.value as PrioritisationFilters['functionalStatus'],
                  })
                }
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-800 focus:border-blue-700 focus:outline-none"
              >
                <option value="ALL">All Functional</option>
                <option value="NONE">Unstudied Gap Only</option>
                <option value="HAS_STUDY">Has Study</option>
              </select>
            </div>
          </div>

          {meta && (
            <div className="text-[11px] text-slate-600">
              <span className="font-semibold text-slate-800">{meta.fullName}</span>
              <span aria-hidden="true"> · </span>
              <span>ClinGen {meta.clingenValidity}</span>
              <span aria-hidden="true"> · </span>
              <span>{meta.inheritance}</span>
            </div>
          )}

          {/* Pane KPI Strip */}
          <div className="grid grid-cols-4 gap-2 border-t border-slate-200 pt-2.5 font-mono tabular-nums">
            <div>
              <div className="text-[10px] text-slate-400">VUS COUNT</div>
              <div className="text-sm font-bold text-slate-900">{stats.total}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">TOP SCORE</div>
              <div className="text-sm font-bold text-blue-700">
                {stats.topScore.toFixed(1)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">MEAN SCORE</div>
              <div className="text-sm font-bold text-slate-800">
                {stats.meanScore.toFixed(1)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">CONFLICT / GAP</div>
              <div className="text-sm font-bold text-slate-800">
                <span className="text-amber-700">{stats.conflicting}</span>
                <span className="text-slate-400"> / </span>
                <span className="text-teal-700">{stats.unstudied}</span>
              </div>
            </div>
          </div>

          {/* Conditions Represented & Causative Variants in this Cohort */}
          {conditionGroups.length > 0 && (
            <div className="border-t border-slate-200 pt-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                Conditions Represented ({conditionGroups.length}) &amp; Causative Variants
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {conditionGroups.slice(0, 8).map((cg) => {
                  const isCondActive = paneFilters.condition === cg.condition;
                  return (
                    <button
                      key={cg.condition}
                      type="button"
                      onClick={() =>
                        setPaneFilters({
                          ...paneFilters,
                          condition: isCondActive ? 'ALL' : cg.condition,
                        })
                      }
                      title={cg.variants
                        .map((s) => `${s.variant.gene} ${s.variant.hgvsP !== 'p.?' ? s.variant.hgvsP : s.variant.hgvsC}`)
                        .join(', ')}
                      className={`rounded border px-2 py-0.5 text-[10px] transition-colors cursor-pointer ${
                        isCondActive
                          ? 'border-blue-700 bg-blue-50 text-blue-800 font-semibold'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <span>{cg.condition}</span>
                      <span className="ml-1 font-mono text-slate-500">
                        ({cg.variants.length})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Top-Ranked Variants List */}
        {visibleRows.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <p className="text-xs text-slate-600">
              No VUS match this configuration in {label}.
            </p>
            <button
              type="button"
              onClick={() => setPaneFilters(makeCohortDefaults('ALL'))}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:border-blue-700 hover:text-blue-700 cursor-pointer"
            >
              Show All Genes in {label}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 flex-1">
            {visibleRows.map((entry) => {
              const v = entry.variant;
              const isConflicting = v.clinvarStatus === 'Conflicting Interpretations';
              const sharedRank = otherRankMap.get(v.id);

              return (
                <div
                  key={v.id}
                  className="p-3.5 hover:bg-slate-50/70 transition-colors space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="font-mono font-bold text-slate-500">
                          #{entry.rank}
                        </span>
                        <span className="font-mono font-semibold text-slate-900">
                          {v.gene}
                        </span>
                        <span className="font-semibold text-slate-900">
                          {v.hgvsP !== 'p.?' ? v.hgvsP : v.hgvsC}
                        </span>
                        {sharedRank !== undefined && (
                          <span className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-700">
                            Shared (#{sharedRank} in {otherLabel})
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        <span className="font-mono">{v.hgvsC}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{v.variantType}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{v.proteinDomain}</span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="font-mono text-base font-bold text-blue-700 tabular-nums">
                        {entry.priorityScore.toFixed(1)}
                      </div>
                      <button
                        type="button"
                        onClick={() => onInspectVariantInWorkbench(v, paneFilters)}
                        className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-700 hover:underline cursor-pointer"
                      >
                        <span>Inspect</span>
                        <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {/* Factor Contribution Bar + Evidence Details */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono tabular-nums text-slate-600">
                      <span>AF {formatAf(v.gnomadAf)}</span>
                      <span>
                        REVEL {v.revelScore !== null ? v.revelScore.toFixed(2) : '—'} / CADD{' '}
                        {v.caddPhred !== null ? v.caddPhred.toFixed(1) : '—'}
                      </span>
                      <span
                        className={
                          isConflicting ? 'font-semibold text-amber-700' : 'text-slate-600'
                        }
                      >
                        {isConflicting
                          ? `▲ Conflicting (${v.clinvarSubmissions.lpOrP}/${v.clinvarSubmissions.total})`
                          : `● Uniform (${v.clinvarSubmissions.total})`}
                      </span>
                      <span
                        className={
                          v.functionalStatus === 'None'
                            ? 'font-semibold text-teal-700'
                            : 'text-slate-600'
                        }
                      >
                        {v.functionalStatus === 'None'
                          ? 'Gap (0 refs)'
                          : `${v.functionalStatus} (${v.pubmedCount} refs)`}
                      </span>
                    </div>

                    <div
                      className="flex h-2 w-24 overflow-hidden rounded-xs bg-slate-100 shrink-0"
                      title={entry.contributions
                        .map((c) => `${c.label}: +${c.weightedPoints.toFixed(1)}`)
                        .join(' | ')}
                    >
                      {entry.contributions.map((c) => (
                        <div
                          key={c.key}
                          style={{
                            width: `${Math.max(0, c.weightedPoints)}%`,
                            backgroundColor: FACTOR_COLORS[c.key],
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
            {scored.length > visibleRows.length && (
              <div className="bg-slate-50/70 px-3.5 py-2 text-[11px] text-slate-500 flex items-center justify-between">
                <span>
                  Showing top {visibleRows.length} of {scored.length} ranked VUS
                </span>
                <button
                  type="button"
                  onClick={() => setTopLimit(999)}
                  className="font-medium text-blue-700 hover:underline cursor-pointer"
                >
                  Show all {scored.length}
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="mx-auto max-w-[1440px] px-4 sm:px-6 py-6 space-y-5">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Compare Cohorts — Dual-Pane Prioritisation
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-600 max-w-3xl">
            Select any two gene, condition, or criteria configurations side-by-side to compare top-ranked VUS, score distributions, conflicting ClinVar burden, and unstudied functional gaps.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Top variants display limit"
            className="inline-flex rounded-md border border-slate-300 bg-white p-0.5"
          >
            {([5, 10, 999] as const).map((limit) => {
              const active = topLimit === limit;
              return (
                <button
                  key={limit}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTopLimit(limit)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                    active
                      ? 'bg-blue-700 text-white font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {limit === 999 ? 'All' : `Top ${limit}`}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleSwapCohorts}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:border-blue-700 hover:text-blue-700 cursor-pointer"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Swap Cohorts</span>
          </button>
        </div>
      </div>

      {/* Shared Scoring Objective Bar (synced with Workbench presets & toggles) */}
      <section
        aria-label="Active scoring objective controls for cohort comparison"
        className="border border-slate-200 bg-white rounded-md p-3.5 flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-700 mr-1">
            Research Objective:
          </span>
          {RESEARCH_PRESETS.map((preset) => {
            const isActive = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => onSelectPreset(preset.id)}
                className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  isActive
                    ? 'border-blue-700 bg-blue-50 text-blue-800 font-semibold'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300'
                }`}
              >
                {isActive && <Check className="h-3 w-3" aria-hidden="true" />}
                <span>{preset.name}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Comparison population frequency direction"
            className="inline-flex gap-1 rounded border border-slate-200 bg-slate-100 p-0.5"
          >
            <button
              type="button"
              aria-pressed={config.frequencyObjective === 'rare_first'}
              onClick={() =>
                onConfigChange({ ...config, frequencyObjective: 'rare_first' })
              }
              className={`rounded px-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
                config.frequencyObjective === 'rare_first'
                  ? 'bg-blue-700 text-white font-semibold'
                  : 'text-slate-600 font-medium hover:text-slate-900'
              }`}
            >
              Ultra-Rare First
            </button>
            <button
              type="button"
              aria-pressed={config.frequencyObjective === 'prevalent_first'}
              onClick={() =>
                onConfigChange({ ...config, frequencyObjective: 'prevalent_first' })
              }
              className={`rounded px-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
                config.frequencyObjective === 'prevalent_first'
                  ? 'bg-blue-700 text-white font-semibold'
                  : 'text-slate-600 font-medium hover:text-slate-900'
              }`}
            >
              Higher AF Impact
            </button>
          </div>

          <div
            role="group"
            aria-label="Comparison functional study direction"
            className="inline-flex gap-1 rounded border border-slate-200 bg-slate-100 p-0.5"
          >
            <button
              type="button"
              aria-pressed={config.functionalObjective === 'gap_first'}
              onClick={() =>
                onConfigChange({ ...config, functionalObjective: 'gap_first' })
              }
              className={`rounded px-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
                config.functionalObjective === 'gap_first'
                  ? 'bg-blue-700 text-white font-semibold'
                  : 'text-slate-600 font-medium hover:text-slate-900'
              }`}
            >
              Unstudied Gap
            </button>
            <button
              type="button"
              aria-pressed={config.functionalObjective === 'studied_first'}
              onClick={() =>
                onConfigChange({ ...config, functionalObjective: 'studied_first' })
              }
              className={`rounded px-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
                config.functionalObjective === 'studied_first'
                  ? 'bg-blue-700 text-white font-semibold'
                  : 'text-slate-600 font-medium hover:text-slate-900'
              }`}
            >
              Prior Assay Signal
            </button>
          </div>
        </div>
      </section>

      {/* Head-to-Head Summary Strip */}
      <section
        aria-label="Cohort A vs Cohort B head-to-head summary"
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
      >
        <div className="border border-slate-200 bg-white rounded-md px-3.5 py-2.5">
          <div className="text-[10px] font-semibold text-slate-400">TOP PRIORITY DELTA</div>
          <div className="mt-0.5 font-mono text-sm font-bold text-slate-900 tabular-nums">
            <span className="text-blue-700">{statsA.topScore.toFixed(1)}</span>
            <span className="text-slate-400 mx-1.5">vs</span>
            <span className="text-indigo-700">{statsB.topScore.toFixed(1)}</span>
          </div>
        </div>
        <div className="border border-slate-200 bg-white rounded-md px-3.5 py-2.5">
          <div className="text-[10px] font-semibold text-slate-400">MEAN SCORE (A vs B)</div>
          <div className="mt-0.5 font-mono text-sm font-bold text-slate-900 tabular-nums">
            <span className="text-blue-700">{statsA.meanScore.toFixed(1)}</span>
            <span className="text-slate-400 mx-1.5">vs</span>
            <span className="text-indigo-700">{statsB.meanScore.toFixed(1)}</span>
          </div>
        </div>
        <div className="border border-slate-200 bg-white rounded-md px-3.5 py-2.5">
          <div className="text-[10px] font-semibold text-slate-400">UNSTUDIED GAPS (A vs B)</div>
          <div className="mt-0.5 font-mono text-sm font-bold text-teal-700 tabular-nums">
            {statsA.unstudied} <span className="text-slate-400 font-normal">vs</span>{' '}
            {statsB.unstudied}
          </div>
        </div>
        <div className="border border-slate-200 bg-white rounded-md px-3.5 py-2.5">
          <div className="text-[10px] font-semibold text-slate-400">SHARED OVERLAP</div>
          <div className="mt-0.5 font-mono text-sm font-bold text-slate-900 tabular-nums">
            {overlapCount} {overlapCount === 1 ? 'variant' : 'variants'}
          </div>
        </div>
      </section>

      {/* Dual-Pane Side-by-Side Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {renderPane(
          'a',
          'Cohort A',
          'bg-blue-700 text-white',
          cohortAFilters,
          setCohortAFilters,
          cohortAConditions,
          conditionIndexA,
          cohortAScored,
          statsA,
          rankMapB,
          'Cohort B',
        )}
        {renderPane(
          'b',
          'Cohort B',
          'bg-indigo-700 text-white',
          cohortBFilters,
          setCohortBFilters,
          cohortBConditions,
          conditionIndexB,
          cohortBScored,
          statsB,
          rankMapA,
          'Cohort A',
        )}
      </div>

      {/* Cohort & Condition Overlap Comparison Panel */}
      <section
        aria-label="Cohort and condition overlap comparison panel"
        className="border border-slate-200 bg-white rounded-md p-4 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Cohort &amp; Condition Overlap Comparison Panel
            </h2>
            <p className="text-xs text-slate-500">
              Separates variants and disease conditions unique to Cohort A, shared across A ∩ B, and unique to Cohort B.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums">
            <span className="text-blue-700 font-semibold">
              Only A: {cohortOverlap.onlyA.length}
            </span>
            <span className="text-indigo-700 font-semibold">
              Shared A ∩ B: {cohortOverlap.shared.length}
            </span>
            <span className="text-slate-700 font-semibold">
              Only B: {cohortOverlap.onlyB.length}
            </span>
          </div>
        </div>

        {/* Variant Set Overlap (3 Columns) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded border border-slate-200 bg-slate-50/60 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700 mb-2">
              Unique to Cohort A ({cohortOverlap.onlyA.length})
            </div>
            {cohortOverlap.onlyA.length === 0 ? (
              <p className="text-xs text-slate-500">No Cohort A-exclusive variants.</p>
            ) : (
              <ul className="space-y-1 max-h-48 overflow-y-auto pr-1 text-xs">
                {cohortOverlap.onlyA.slice(0, 15).map((entry) => (
                  <li key={entry.variant.id}>
                    <button
                      type="button"
                      onClick={() => onInspectVariantInWorkbench(entry.variant, cohortAFilters)}
                      className="w-full flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-left hover:border-blue-600 cursor-pointer"
                    >
                      <span className="font-mono font-semibold text-slate-900 truncate">
                        #{entry.rank} {entry.variant.gene}{' '}
                        {entry.variant.hgvsP !== 'p.?' ? entry.variant.hgvsP : entry.variant.hgvsC}
                      </span>
                      <span className="font-mono text-[11px] text-blue-700 shrink-0 tabular-nums">
                        {entry.priorityScore.toFixed(1)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded border border-indigo-200 bg-indigo-50/40 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-800 mb-2">
              Shared Variant Overlap A ∩ B ({cohortOverlap.shared.length})
            </div>
            {cohortOverlap.shared.length === 0 ? (
              <p className="text-xs text-slate-500">
                No overlapping variants between Cohort A and Cohort B under current gene/condition filters.
              </p>
            ) : (
              <ul className="space-y-1 max-h-48 overflow-y-auto pr-1 text-xs">
                {cohortOverlap.shared.slice(0, 15).map(({ entryA, entryB }) => (
                  <li key={entryA.variant.id}>
                    <button
                      type="button"
                      onClick={() => onInspectVariantInWorkbench(entryA.variant, cohortAFilters)}
                      className="w-full flex items-center justify-between gap-2 rounded border border-indigo-200 bg-white px-2 py-1 text-left hover:border-indigo-600 cursor-pointer"
                    >
                      <span className="font-mono font-semibold text-slate-900 truncate">
                        {entryA.variant.gene}{' '}
                        {entryA.variant.hgvsP !== 'p.?' ? entryA.variant.hgvsP : entryA.variant.hgvsC}
                      </span>
                      <span className="font-mono text-[10px] text-indigo-700 shrink-0 tabular-nums">
                        A #{entryA.rank} · B #{entryB.rank} ({entryA.priorityScore.toFixed(1)})
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded border border-slate-200 bg-slate-50/60 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-700 mb-2">
              Unique to Cohort B ({cohortOverlap.onlyB.length})
            </div>
            {cohortOverlap.onlyB.length === 0 ? (
              <p className="text-xs text-slate-500">No Cohort B-exclusive variants.</p>
            ) : (
              <ul className="space-y-1 max-h-48 overflow-y-auto pr-1 text-xs">
                {cohortOverlap.onlyB.slice(0, 15).map((entry) => (
                  <li key={entry.variant.id}>
                    <button
                      type="button"
                      onClick={() => onInspectVariantInWorkbench(entry.variant, cohortBFilters)}
                      className="w-full flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-left hover:border-indigo-600 cursor-pointer"
                    >
                      <span className="font-mono font-semibold text-slate-900 truncate">
                        #{entry.rank} {entry.variant.gene}{' '}
                        {entry.variant.hgvsP !== 'p.?' ? entry.variant.hgvsP : entry.variant.hgvsC}
                      </span>
                      <span className="font-mono text-[11px] text-indigo-700 shrink-0 tabular-nums">
                        {entry.priorityScore.toFixed(1)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Disease / Condition Overlap (3 Columns) */}
        <div className="border-t border-slate-200 pt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-[11px] font-semibold text-slate-600 mb-1.5">
              Conditions Only in A ({cohortOverlap.conditionsOnlyA.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cohortOverlap.conditionsOnlyA.length === 0 ? (
                <span className="text-slate-400">None</span>
              ) : (
                cohortOverlap.conditionsOnlyA.map((c) => (
                  <span
                    key={c}
                    className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700"
                  >
                    {c}
                  </span>
                ))
              )}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold text-indigo-800 mb-1.5">
              Shared Conditions A ∩ B ({cohortOverlap.sharedConditions.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cohortOverlap.sharedConditions.length === 0 ? (
                <span className="text-slate-400">No shared conditions</span>
              ) : (
                cohortOverlap.sharedConditions.map((c) => (
                  <span
                    key={c}
                    className="rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-800"
                  >
                    {c}
                  </span>
                ))
              )}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold text-slate-600 mb-1.5">
              Conditions Only in B ({cohortOverlap.conditionsOnlyB.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cohortOverlap.conditionsOnlyB.length === 0 ? (
                <span className="text-slate-400">None</span>
              ) : (
                cohortOverlap.conditionsOnlyB.map((c) => (
                  <span
                    key={c}
                    className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700"
                  >
                    {c}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
