import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Flame, RotateCcw } from 'lucide-react';
import { RESEARCH_PRESETS } from '../data/genes';
import type {
  PrioritisationFilters,
  PrioritisationWeights,
  ScoringConfig,
} from '../types/variant';
import { normalizeWeights } from '../utils/prioritisation';
import { SearchableGenePicker } from './SearchableGenePicker';

interface ControlSidebarProps {
  availableGenes: string[];
  fetchedGeneCounts?: Record<string, number>;
  totalCatalogGenes?: number;
  availableConditions: string[];
  weights: PrioritisationWeights;
  config: ScoringConfig;
  filters: PrioritisationFilters;
  activePresetId: string | null;
  onSelectPreset: (presetId: string) => void;
  onWeightChange: (key: keyof PrioritisationWeights, value: number) => void;
  onConfigChange: (next: ScoringConfig) => void;
  onFilterChange: (next: PrioritisationFilters) => void;
  onResetWeights: () => void;
  onResetFilters: () => void;
}

interface WeightSliderMeta {
  key: keyof PrioritisationWeights;
  label: string;
  sourceHint: string;
}

const SLIDER_DEFS: WeightSliderMeta[] = [
  {
    key: 'populationFrequency',
    label: 'Population Frequency',
    sourceHint: 'gnomAD v4 AF',
  },
  {
    key: 'clinvarUncertainty',
    label: 'ClinVar Conflict',
    sourceHint: 'Lab discordance & submission count',
  },
  {
    key: 'functionalEvidence',
    label: 'Functional Studies',
    sourceHint: 'PubMed / MAVE coverage',
  },
  {
    key: 'computationalPredictions',
    label: 'In-Silico Consensus',
    sourceHint: 'dbNSFP: REVEL, CADD, SIFT, PolyPhen',
  },
  {
    key: 'similarVariantsTrend',
    label: 'Similar Variant Trend',
    sourceHint: 'Same-codon & domain P/LP density',
  },
  {
    key: 'diseaseAssociation',
    label: 'Disease Association',
    sourceHint: 'ClinGen validity & actionability',
  },
];

function getDateWindowValue(filters: PrioritisationFilters): string {
  if (filters.evaluatedAfter === '2025-01-01' && !filters.evaluatedBefore) return '2025+';
  if (filters.evaluatedAfter === '2024-01-01' && !filters.evaluatedBefore) return '2024+';
  if (filters.evaluatedAfter === '2023-01-01' && !filters.evaluatedBefore) return '2023+';
  if (!filters.evaluatedAfter && filters.evaluatedBefore === '2024-12-31') return 'legacy';
  return 'ALL';
}

export function ControlSidebar({
  availableGenes,
  fetchedGeneCounts = {},
  totalCatalogGenes = 0,
  availableConditions,
  weights,
  config,
  filters,
  activePresetId,
  onSelectPreset,
  onWeightChange,
  onConfigChange,
  onFilterChange,
  onResetWeights,
  onResetFilters,
}: ControlSidebarProps) {
  const [presetsOpen, setPresetsOpen] = useState(true);
  const [weightsOpen, setWeightsOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const norm = normalizeWeights(weights);

  return (
    <aside className="w-full lg:w-[328px] shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 bg-white">
      <div className="divide-y divide-slate-200">
        {/* Section 1: Target Gene Cohort */}
        <div className="p-4 space-y-2">
          <div>
            <label
              htmlFor="gene-select"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Target Gene Cohort
            </label>
            <SearchableGenePicker
              id="gene-select"
              value={filters.gene}
              availableGenes={availableGenes}
              fetchedGeneCounts={fetchedGeneCounts}
              totalCatalogGenes={totalCatalogGenes}
              onChange={(geneSymbol) =>
                onFilterChange({
                  ...filters,
                  gene: geneSymbol,
                  condition: 'ALL',
                })
              }
            />
          </div>
          <p className="text-[11px] leading-snug text-slate-500">
            Includes{' '}
            <span className="font-mono font-semibold text-slate-700">
              {availableGenes.length}
            </span>{' '}
            directly coded &amp; synced genes, plus instant lookup across{' '}
            <span className="font-mono font-semibold text-slate-700">
              {totalCatalogGenes > 0 ? totalCatalogGenes.toLocaleString() : '20,000'}
            </span>{' '}
            HGNC loci.
          </p>
        </div>

        {/* Section 2: Research Objective Presets */}
        <div className="p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setPresetsOpen((prev) => !prev)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-900 cursor-pointer"
            >
              {presetsOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              )}
              <span>Research Objective Presets</span>
            </button>
            <button
              type="button"
              onClick={onResetWeights}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-blue-700 cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              <span>Reset</span>
            </button>
          </div>

          {presetsOpen && (
            <div role="group" aria-label="Research Objective Presets" className="grid grid-cols-1 gap-1.5">
              {RESEARCH_PRESETS.map((preset) => {
                const isActive = activePresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => onSelectPreset(preset.id)}
                    className={`text-left rounded-md border px-2.5 py-1.5 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-700 ${
                      isActive
                        ? 'border-blue-700 bg-blue-50 text-slate-900 ring-1 ring-blue-700/20'
                        : 'border-slate-200 bg-slate-50/60 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-xs font-semibold leading-snug ${isActive ? 'text-blue-900' : 'text-slate-800'}`}>
                        {preset.name}
                      </span>
                      {isActive && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-blue-700 px-1.5 py-0.5 text-[10px] font-semibold text-white shrink-0">
                          <Check className="h-2.5 w-2.5" aria-hidden="true" />
                          <span>Active</span>
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-tight text-slate-500 line-clamp-2">
                      {preset.description}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Section 3: Custom Factor Weights & Directionality */}
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setWeightsOpen((prev) => !prev)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-900 cursor-pointer"
            >
              {weightsOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              )}
              <span>Factor Weights (Normalized %)</span>
            </button>
            <span className="text-[10px] font-mono text-slate-400">6 criteria</span>
          </div>

          {weightsOpen && (
            <div className="space-y-3.5">
              {SLIDER_DEFS.map((def) => {
                const rawVal = weights[def.key];
                const pct = (norm[def.key] * 100).toFixed(1);
                return (
                  <div key={def.key} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <label
                        htmlFor={`weight-${def.key}`}
                        className="text-xs font-medium text-slate-800"
                      >
                        {def.label}
                      </label>
                      <span className="font-mono text-xs font-semibold text-blue-700 tabular-nums shrink-0">
                        {pct}%
                      </span>
                    </div>
                    <input
                      id={`weight-${def.key}`}
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={rawVal}
                      onChange={(e) =>
                        onWeightChange(def.key, Number(e.target.value))
                      }
                      className="scientific-slider w-full"
                    />
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>{def.sourceHint}</span>
                      <span className="font-mono tabular-nums text-slate-400">
                        w={rawVal}
                      </span>
                    </div>

                    {def.key === 'populationFrequency' && (
                      <div
                        role="group"
                        aria-label="Population frequency priority direction"
                        className="mt-1.5 grid grid-cols-2 gap-1 rounded-md border border-slate-200 bg-slate-100 p-0.5"
                      >
                        <button
                          type="button"
                          aria-pressed={config.frequencyObjective === 'rare_first'}
                          onClick={() =>
                            onConfigChange({
                              ...config,
                              frequencyObjective: 'rare_first',
                            })
                          }
                          className={`rounded px-2 py-1 text-[11px] transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-700 ${
                            config.frequencyObjective === 'rare_first'
                              ? 'bg-blue-700 text-white font-semibold shadow-xs'
                              : 'text-slate-600 font-medium hover:bg-white/80 hover:text-slate-900'
                          }`}
                        >
                          Ultra-Rare First
                        </button>
                        <button
                          type="button"
                          aria-pressed={config.frequencyObjective === 'prevalent_first'}
                          onClick={() =>
                            onConfigChange({
                              ...config,
                              frequencyObjective: 'prevalent_first',
                            })
                          }
                          className={`rounded px-2 py-1 text-[11px] transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-700 ${
                            config.frequencyObjective === 'prevalent_first'
                              ? 'bg-blue-700 text-white font-semibold shadow-xs'
                              : 'text-slate-600 font-medium hover:bg-white/80 hover:text-slate-900'
                          }`}
                        >
                          Higher AF Impact
                        </button>
                      </div>
                    )}

                    {def.key === 'functionalEvidence' && (
                      <div
                        role="group"
                        aria-label="Functional study priority direction"
                        className="mt-1.5 grid grid-cols-2 gap-1 rounded-md border border-slate-200 bg-slate-100 p-0.5"
                      >
                        <button
                          type="button"
                          aria-pressed={config.functionalObjective === 'gap_first'}
                          onClick={() =>
                            onConfigChange({
                              ...config,
                              functionalObjective: 'gap_first',
                            })
                          }
                          className={`rounded px-2 py-1 text-[11px] transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-700 ${
                            config.functionalObjective === 'gap_first'
                              ? 'bg-blue-700 text-white font-semibold shadow-xs'
                              : 'text-slate-600 font-medium hover:bg-white/80 hover:text-slate-900'
                          }`}
                        >
                          Unstudied Gap
                        </button>
                        <button
                          type="button"
                          aria-pressed={config.functionalObjective === 'studied_first'}
                          onClick={() =>
                            onConfigChange({
                              ...config,
                              functionalObjective: 'studied_first',
                            })
                          }
                          className={`rounded px-2 py-1 text-[11px] transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-700 ${
                            config.functionalObjective === 'studied_first'
                              ? 'bg-blue-700 text-white font-semibold shadow-xs'
                              : 'text-slate-600 font-medium hover:bg-white/80 hover:text-slate-900'
                          }`}
                        >
                          Prior Assay Signal
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Section 4: Criteria Filters */}
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setFiltersOpen((prev) => !prev)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-900 cursor-pointer"
            >
              {filtersOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              )}
              <span>Cohort Filters</span>
            </button>
            <button
              type="button"
              onClick={onResetFilters}
              className="text-xs font-medium text-slate-600 hover:text-blue-700 cursor-pointer"
            >
              Reset Filters
            </button>
          </div>

          {filtersOpen && (
            <div className="space-y-2.5">
              {/* Quick Hot VUS Filter Toggle */}
              <button
                type="button"
                aria-pressed={Boolean(filters.hotVusOnly)}
                onClick={() =>
                  onFilterChange({
                    ...filters,
                    hotVusOnly: !filters.hotVusOnly,
                  })
                }
                className={`w-full flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  filters.hotVusOnly
                    ? 'border-amber-400 bg-amber-50 text-amber-900 font-semibold'
                    : 'border-slate-300 bg-slate-50/70 text-slate-700 hover:border-amber-300'
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Flame className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                  <span>Hot VUS Only (4–5 ACMG pts)</span>
                </span>
                <span className="font-mono text-[10px]">
                  {filters.hotVusOnly ? 'ON' : 'OFF'}
                </span>
              </button>

              <div>
                <label
                  htmlFor="filter-condition"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Associated Condition / Spectrum
                </label>
                <select
                  id="filter-condition"
                  value={filters.condition}
                  onChange={(e) =>
                    onFilterChange({ ...filters, condition: e.target.value })
                  }
                  className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                >
                  <option value="ALL">All Conditions &amp; Syndromes ({availableConditions.length})</option>
                  {availableConditions.map((cond) => (
                    <option key={cond} value={cond}>
                      {cond}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="filter-eval-date"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  ClinVar Evaluation Date Window
                </label>
                <select
                  id="filter-eval-date"
                  value={getDateWindowValue(filters)}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '2025+') {
                      onFilterChange({ ...filters, evaluatedAfter: '2025-01-01', evaluatedBefore: undefined });
                    } else if (val === '2024+') {
                      onFilterChange({ ...filters, evaluatedAfter: '2024-01-01', evaluatedBefore: undefined });
                    } else if (val === '2023+') {
                      onFilterChange({ ...filters, evaluatedAfter: '2023-01-01', evaluatedBefore: undefined });
                    } else if (val === 'legacy') {
                      onFilterChange({ ...filters, evaluatedAfter: undefined, evaluatedBefore: '2024-12-31' });
                    } else {
                      onFilterChange({ ...filters, evaluatedAfter: undefined, evaluatedBefore: undefined });
                    }
                  }}
                  className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                >
                  <option value="ALL">All Evaluation Dates (2021–2026)</option>
                  <option value="2025+">2025–2026 Recent Reassessments</option>
                  <option value="2024+">2024 or Newer</option>
                  <option value="2023+">2023 or Newer</option>
                  <option value="legacy">Older Reviews (Through 2024)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="filter-type"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Variant Consequence Type
                </label>
                <select
                  id="filter-type"
                  value={filters.variantType}
                  onChange={(e) =>
                    onFilterChange({ ...filters, variantType: e.target.value })
                  }
                  className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                >
                  <option value="ALL">All Variant Types</option>
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
                  htmlFor="filter-clinvar"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  ClinVar Classification Status
                </label>
                <select
                  id="filter-clinvar"
                  value={filters.clinvarConflict}
                  onChange={(e) =>
                    onFilterChange({
                      ...filters,
                      clinvarConflict: e.target.value as PrioritisationFilters['clinvarConflict'],
                    })
                  }
                  className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                >
                  <option value="ALL">All ClinVar VUS</option>
                  <option value="CONFLICTING">Conflicting Interpretations Only</option>
                  <option value="UNIFORM">Uniform VUS Only</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="filter-functional"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Functional Assay Status
                </label>
                <select
                  id="filter-functional"
                  value={filters.functionalStatus}
                  onChange={(e) =>
                    onFilterChange({
                      ...filters,
                      functionalStatus: e.target.value as PrioritisationFilters['functionalStatus'],
                    })
                  }
                  className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                >
                  <option value="ALL">All Functional Statuses</option>
                  <option value="NONE">No Functional Study (Gap)</option>
                  <option value="HAS_STUDY">Has Preliminary / Published Study</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="filter-af"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  gnomAD Allele Frequency Ceiling
                </label>
                <select
                  id="filter-af"
                  value={filters.maxAf === null ? 'ALL' : String(filters.maxAf)}
                  onChange={(e) =>
                    onFilterChange({
                      ...filters,
                      maxAf: e.target.value === 'ALL' ? null : Number(e.target.value),
                    })
                  }
                  className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                >
                  <option value="ALL">Any Allele Frequency</option>
                  <option value="0">Absent in gnomAD (AF = 0)</option>
                  <option value="0.00001">Ultra-Rare (AF &le; 1e-5)</option>
                  <option value="0.0001">Rare (AF &le; 1e-4)</option>
                  <option value="0.001">Low Frequency (AF &le; 1e-3)</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

