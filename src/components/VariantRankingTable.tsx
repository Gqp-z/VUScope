import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import type { PrioritisationWeights, ScoredVariant } from '../types/variant';
import { evaluateAcmgCriteria, type AcmgRuleOverrides } from '../utils/acmgAutomation';
import { paginateItems } from '../utils/genomeCatalog';
import { formatAf } from '../utils/prioritisation';

interface VariantRankingTableProps {
  scoredVariants: ScoredVariant[];
  allIndexedVariantsCount?: number;
  geneIndexCounts?: Array<{ gene: string; count: number }>;
  activeGeneFilter?: string;
  onSelectGeneFilter?: (gene: string) => void;
  acmgOverridesByVariant?: Record<string, AcmgRuleOverrides>;
  selectedVariantId: string | null;
  onSelectVariant: (id: string) => void;
  onResetFilters: () => void;
}

const FACTOR_COLORS: Record<keyof PrioritisationWeights, string> = {
  populationFrequency: '#0284C7',
  clinvarUncertainty: '#D97706',
  functionalEvidence: '#0D9488',
  computationalPredictions: '#1D4ED8',
  similarVariantsTrend: '#7C3AED',
  diseaseAssociation: '#475569',
};

export function VariantRankingTable({
  scoredVariants,
  allIndexedVariantsCount,
  geneIndexCounts = [],
  activeGeneFilter = 'ALL',
  onSelectGeneFilter,
  acmgOverridesByVariant = {},
  selectedVariantId,
  onSelectVariant,
  onResetFilters,
}: VariantRankingTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(50);
  const [showAllIndexedGenes, setShowAllIndexedGenes] = useState(false);
  const [geneChipSearch, setGeneChipSearch] = useState('');

  // Reset to page 1 when gene filter or cohort length changes substantially
  const cohortSignature = `${activeGeneFilter}:${scoredVariants[0]?.variant.id ?? ''}:${Math.floor(scoredVariants.length / 5)}`;
  useEffect(() => {
    setCurrentPage(1);
  }, [cohortSignature, pageSize]);

  const hotVusCount = useMemo(() => {
    return scoredVariants.filter((s) =>
      evaluateAcmgCriteria(s.variant, acmgOverridesByVariant[s.variant.id]).isHotVus,
    ).length;
  }, [scoredVariants, acmgOverridesByVariant]);

  const pagination = useMemo(
    () => paginateItems(scoredVariants, currentPage, pageSize),
    [scoredVariants, currentPage, pageSize],
  );

  const visibleGeneChips = useMemo(() => {
    const cleanSearch = geneChipSearch.trim().toLowerCase();
    const filtered = cleanSearch
      ? geneIndexCounts.filter((item) => item.gene.toLowerCase().includes(cleanSearch))
      : geneIndexCounts;

    if (showAllIndexedGenes || cleanSearch) {
      return filtered.slice(0, 120);
    }

    const topTen = filtered.slice(0, 10);
    if (
      activeGeneFilter !== 'ALL' &&
      !topTen.some((item) => item.gene === activeGeneFilter)
    ) {
      const activeItem = filtered.find((item) => item.gene === activeGeneFilter);
      if (activeItem) {
        return [...topTen, activeItem];
      }
    }
    return topTen;
  }, [geneIndexCounts, showAllIndexedGenes, geneChipSearch, activeGeneFilter]);

  if (scoredVariants.length === 0) {
    return (
      <section className="border border-slate-200 bg-white rounded-md p-10 text-center">
        <h3 className="text-sm font-semibold text-slate-900">
          No variants match the active criteria
        </h3>
        <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
          Adjust your allele frequency ceiling, consequence type, or search terms to restore matching VUS records.
        </p>
        <button
          type="button"
          onClick={onResetFilters}
          className="mt-4 inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
        >
          Reset Filters
        </button>
      </section>
    );
  }

  return (
    <section
      aria-label="Prioritised VUS ranking table"
      className="border border-slate-200 bg-white rounded-md overflow-hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Prioritised Variant Queue
          </h3>
          <p className="text-xs text-slate-500">
            Showing{' '}
            <span className="font-mono font-semibold text-slate-700 tabular-nums">
              {pagination.startIndex}–{pagination.endIndex}
            </span>{' '}
            of{' '}
            <span className="font-mono font-semibold text-slate-700 tabular-nums">
              {scoredVariants.length}
            </span>
            {allIndexedVariantsCount !== undefined && allIndexedVariantsCount > scoredVariants.length
              ? ` (${allIndexedVariantsCount} total indexed)`
              : ' indexed'}{' '}
            VUS ranked by active factor weights ·{' '}
            <span className="font-mono font-semibold text-amber-700">
              {hotVusCount} Hot VUS
            </span>{' '}
            near ACMG/AMP reclassification
          </p>
        </div>

        {/* Compact inline contribution legend */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-xs bg-[#1D4ED8]" />
            <span>In-Silico</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-xs bg-[#0284C7]" />
            <span>Frequency</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-xs bg-[#D97706]" />
            <span>Conflict</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-xs bg-[#0D9488]" />
            <span>Functional</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-xs bg-[#7C3AED]" />
            <span>Similar</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-xs bg-[#475569]" />
            <span>Disease</span>
          </span>
        </div>
      </div>

      {/* Bounded Indexed Gene Coverage Strip */}
      {geneIndexCounts.length > 0 && onSelectGeneFilter && (
        <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-[11px] space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-slate-600 mr-1">
              Fetched Genes ({geneIndexCounts.length}):
            </span>
            <button
              type="button"
              onClick={() => onSelectGeneFilter('ALL')}
              className={`rounded border px-2 py-0.5 font-mono transition-colors cursor-pointer ${
                activeGeneFilter === 'ALL'
                  ? 'border-blue-700 bg-blue-700 text-white font-semibold'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-blue-700'
              }`}
            >
              All ({allIndexedVariantsCount ?? scoredVariants.length})
            </button>
            {visibleGeneChips.map((item) => {
              const isActive = activeGeneFilter === item.gene;
              return (
                <button
                  key={item.gene}
                  type="button"
                  onClick={() => onSelectGeneFilter(isActive ? 'ALL' : item.gene)}
                  className={`rounded border px-2 py-0.5 font-mono transition-colors cursor-pointer ${
                    isActive
                      ? 'border-blue-700 bg-blue-700 text-white font-semibold'
                      : 'border-slate-300 bg-white text-slate-700 hover:border-blue-700'
                  }`}
                >
                  {item.gene} ({item.count})
                </button>
              );
            })}

            {geneIndexCounts.length > 10 && (
              <button
                type="button"
                onClick={() => {
                  setShowAllIndexedGenes((prev) => !prev);
                  setGeneChipSearch('');
                }}
                className="ml-1 rounded border border-slate-200 bg-white px-2 py-0.5 font-medium text-blue-700 hover:border-blue-700 cursor-pointer"
              >
                {showAllIndexedGenes
                  ? 'Collapse gene strip'
                  : `Show all ${geneIndexCounts.length} fetched genes`}
              </button>
            )}
          </div>

          {showAllIndexedGenes && (
            <div className="flex items-center gap-2 pt-0.5">
              <label htmlFor="fetched-gene-chip-filter" className="sr-only">
                Filter fetched gene chips
              </label>
              <input
                id="fetched-gene-chip-filter"
                type="text"
                value={geneChipSearch}
                onChange={(e) => setGeneChipSearch(e.target.value)}
                placeholder="Filter fetched gene symbols..."
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-800 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none w-52"
              />
              {geneIndexCounts.length > 120 && (
                <span className="text-[10px] text-slate-500">
                  Showing first 120 matching fetched genes — use Target Gene Cohort search for full 20,000-gene index.
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
              <th className="py-2.5 pl-4 pr-2 w-14">Rank</th>
              <th className="py-2.5 px-3">Variant &amp; Domain</th>
              <th className="py-2.5 px-3 whitespace-nowrap">Type</th>
              <th className="py-2.5 px-3 text-right whitespace-nowrap">gnomAD AF</th>
              <th className="py-2.5 px-3 text-right whitespace-nowrap">REVEL / AM / CADD</th>
              <th className="py-2.5 px-3 whitespace-nowrap">ACMG/AMP</th>
              <th className="py-2.5 px-3 whitespace-nowrap">ClinVar Status</th>
              <th className="py-2.5 px-3 whitespace-nowrap">Functional</th>
              <th className="py-2.5 px-3 w-32 whitespace-nowrap">Contribution</th>
              <th className="py-2.5 pl-3 pr-4 text-right whitespace-nowrap">Priority</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {pagination.pageItems.map((entry) => {
              const v = entry.variant;
              const isSelected = v.id === selectedVariantId;
              const isConflicting = v.clinvarStatus === 'Conflicting Interpretations';
              const acmg = evaluateAcmgCriteria(v, acmgOverridesByVariant[v.id]);

              return (
                <tr
                  key={v.id}
                  aria-selected={isSelected}
                  onClick={() => onSelectVariant(v.id)}
                  className={`transition-colors cursor-pointer ${
                    isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="py-2.5 pl-4 pr-2 font-mono font-semibold text-slate-700 tabular-nums">
                    #{entry.rank}
                  </td>
                  <td className="py-2.5 px-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectVariant(v.id);
                      }}
                      className="text-left focus-visible:outline-2 focus-visible:outline-blue-700 rounded cursor-pointer"
                    >
                      <div className="font-semibold text-slate-900">
                        <span className="font-mono">{v.gene}</span>{' '}
                        <span>{v.hgvsP !== 'p.?' ? v.hgvsP : v.hgvsC}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        <span className="font-mono">{v.hgvsC}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{v.proteinDomain}</span>
                      </div>
                    </button>
                  </td>
                  <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                    {v.variantType}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap">
                    {formatAf(v.gnomadAf)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap">
                    <span>{v.revelScore !== null ? v.revelScore.toFixed(2) : '—'}</span>
                    <span className="text-slate-400"> / </span>
                    <span
                      className={
                        v.alphaMissenseScore !== undefined &&
                        v.alphaMissenseScore !== null &&
                        v.alphaMissenseScore >= 0.564
                          ? 'text-rose-700 font-semibold'
                          : ''
                      }
                    >
                      {v.alphaMissenseScore !== undefined && v.alphaMissenseScore !== null
                        ? v.alphaMissenseScore.toFixed(2)
                        : '—'}
                    </span>
                    <span className="text-slate-400"> / </span>
                    <span>{v.caddPhred !== null ? v.caddPhred.toFixed(1) : '—'}</span>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap tabular-nums">
                    <span
                      className={
                        acmg.classification === 'Hot VUS'
                          ? 'font-bold text-amber-700'
                          : acmg.classification === 'Likely Pathogenic' ||
                              acmg.classification === 'Pathogenic'
                            ? 'font-bold text-rose-700'
                            : acmg.classification === 'Likely Benign' ||
                                acmg.classification === 'Benign'
                              ? 'text-emerald-700'
                              : 'text-slate-700'
                      }
                      title={acmg.summary}
                    >
                      {acmg.classification} ({acmg.netPoints >= 0 ? `+${acmg.netPoints}` : acmg.netPoints})
                    </span>
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {isConflicting ? (
                      <span className="font-medium text-amber-700">
                        ▲ Conflicting ({v.clinvarSubmissions.lpOrP}/{v.clinvarSubmissions.total})
                      </span>
                    ) : (
                      <span className="text-slate-600">
                        ● Uniform VUS ({v.clinvarSubmissions.total})
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {v.functionalStatus === 'None' ? (
                      <span className="font-medium text-teal-700">
                        Gap (0 refs)
                      </span>
                    ) : v.functionalStatus === 'Preliminary' ? (
                      <span className="text-slate-700">
                        Prelim ({v.pubmedCount} refs)
                      </span>
                    ) : (
                      <span className="text-slate-500">
                        Assay ({v.pubmedCount} refs)
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    <div
                      className="flex h-2 w-28 overflow-hidden rounded-xs bg-slate-100"
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
                  </td>
                  <td className="py-2.5 pl-3 pr-4 text-right font-mono text-sm font-bold text-slate-900 tabular-nums whitespace-nowrap">
                    {entry.priorityScore.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-600">
        <div className="flex items-center gap-3">
          <span className="font-mono tabular-nums">
            Showing {pagination.startIndex}–{pagination.endIndex} of {pagination.totalItems}
          </span>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
            <span>Rows:</span>
            <select
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value) as 25 | 50 | 100)}
              className="rounded border border-slate-300 bg-white px-2 py-0.5 font-mono text-xs text-slate-800 focus:border-blue-700 focus:outline-none"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={pagination.safePage <= 1}
            onClick={() => setCurrentPage(1)}
            aria-label="First page"
            className="inline-flex items-center rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-blue-700 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronsLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only sm:ml-0.5">First</span>
          </button>
          <button
            type="button"
            disabled={pagination.safePage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            aria-label="Previous page"
            className="inline-flex items-center rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-blue-700 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Prev</span>
          </button>

          <span className="px-2.5 font-mono text-[11px] font-semibold text-slate-800 tabular-nums">
            Page {pagination.safePage} of {pagination.totalPages}
          </span>

          <button
            type="button"
            disabled={pagination.safePage >= pagination.totalPages}
            onClick={() =>
              setCurrentPage((p) => Math.min(pagination.totalPages, p + 1))
            }
            aria-label="Next page"
            className="inline-flex items-center rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-blue-700 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <span>Next</span>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={pagination.safePage >= pagination.totalPages}
            onClick={() => setCurrentPage(pagination.totalPages)}
            aria-label="Last page"
            className="inline-flex items-center rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-blue-700 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <span className="sr-only sm:not-sr-only sm:mr-0.5">Last</span>
            <ChevronsRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
