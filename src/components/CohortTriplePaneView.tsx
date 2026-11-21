import type { PrioritisationFilters, ScoredVariant } from '../types/variant';
import { formatAf, summarizeScoredCohort } from '../utils/prioritisation';

interface CohortTriplePaneViewProps {
  scoredVariants: ScoredVariant[];
  filters: PrioritisationFilters;
  selectedVariantId: string | null;
  onSelectVariant: (id: string) => void;
  onFilterChange: (next: PrioritisationFilters) => void;
}

export function CohortTriplePaneView({
  scoredVariants,
  filters,
  selectedVariantId,
  onSelectVariant,
  onFilterChange,
}: CohortTriplePaneViewProps) {
  const conflictingVariants = scoredVariants.filter(
    (s) => s.variant.clinvarStatus === 'Conflicting Interpretations',
  );
  const unstudiedVariants = scoredVariants.filter(
    (s) => s.variant.functionalStatus === 'None',
  );

  const allStats = summarizeScoredCohort(scoredVariants);
  const conflictingOnlyActive = filters.clinvarConflict === 'CONFLICTING';
  const unstudiedOnlyActive = filters.functionalStatus === 'NONE';
  const hasNarrowSubFilter = conflictingOnlyActive || unstudiedOnlyActive;

  const conflictingPct =
    allStats.total > 0 ? Math.round((conflictingVariants.length / allStats.total) * 100) : 0;
  const unstudiedPct =
    allStats.total > 0 ? Math.round((unstudiedVariants.length / allStats.total) * 100) : 0;

  const totalDiscordantLpP = conflictingVariants.reduce(
    (sum, s) => sum + s.variant.clinvarSubmissions.lpOrP,
    0,
  );
  const highInSilicoUnstudied = unstudiedVariants.filter(
    (s) =>
      (s.variant.revelScore !== null && s.variant.revelScore >= 0.75) ||
      (s.variant.caddPhred !== null && s.variant.caddPhred >= 25),
  ).length;
  const absentAfCount = scoredVariants.filter((s) => s.variant.gnomadAf === 0).length;

  return (
    <section
      aria-label="Triple-pane cohort breakdown: Filtered VUS, Conflicting, and Unstudied Gaps"
      className="space-y-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Cohort Triage Breakdown — Triple-Pane View
          </h2>
          <p className="text-xs text-slate-500">
            Inspect all filtered VUS alongside discordant ClinVar submissions and unstudied functional assay gaps. Click any variant to open its dossier below.
          </p>
        </div>
        {hasNarrowSubFilter && (
          <button
            type="button"
            onClick={() =>
              onFilterChange({
                ...filters,
                clinvarConflict: 'ALL',
                functionalStatus: 'ALL',
              })
            }
            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-blue-700 hover:text-blue-700 cursor-pointer"
          >
            Show All Filtered VUS
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Pane 1: Filtered VUS */}
        <article
          aria-label="Filtered VUS pane"
          className="flex flex-col border border-slate-200 bg-white rounded-md overflow-hidden"
        >
          <div className="border-b border-slate-200 bg-slate-50/80 px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-800">
                  Filtered VUS
                </h3>
                <span className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px] font-bold text-slate-900 tabular-nums">
                  {allStats.total}
                </span>
              </div>
              <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                Mean {allStats.meanScore.toFixed(1)} · Top {allStats.topScore.toFixed(1)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
              <span>{absentAfCount} absent in gnomAD</span>
              <span aria-hidden="true">·</span>
              <span>{allStats.highInSilicoCount} high in-silico</span>
            </div>
          </div>

          {scoredVariants.length === 0 ? (
            <div className="p-5 text-center text-xs text-slate-500">
              No VUS match the current cohort filters.
            </div>
          ) : (
            <>
              <ul className="divide-y divide-slate-100 max-h-[264px] overflow-y-auto">
                {scoredVariants.slice(0, 60).map((entry) => {
                  const v = entry.variant;
                  const isSelected = v.id === selectedVariantId;
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => onSelectVariant(v.id)}
                        aria-pressed={isSelected}
                        className={`w-full text-left px-3.5 py-2.5 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-blue-700 ${
                          isSelected ? 'bg-blue-50/80' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="text-xs font-semibold text-slate-900 truncate">
                            <span className="font-mono text-slate-500 mr-1.5">
                              #{entry.rank}
                            </span>
                            <span className="font-mono">{v.gene}</span>{' '}
                            <span>{v.hgvsP !== 'p.?' ? v.hgvsP : v.hgvsC}</span>
                          </div>
                          <span className="font-mono text-xs font-bold text-blue-700 tabular-nums shrink-0">
                            {entry.priorityScore.toFixed(1)}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-600 truncate">
                          <span className="font-mono">{v.hgvsC}</span>
                          <span aria-hidden="true"> · </span>
                          <span>{v.variantType}</span>
                          <span aria-hidden="true"> · </span>
                          <span>{v.proteinDomain}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-slate-500 tabular-nums">
                          <span>AF {formatAf(v.gnomadAf)}</span>
                          <span>
                            REVEL {v.revelScore !== null ? v.revelScore.toFixed(2) : '—'} · CADD{' '}
                            {v.caddPhred !== null ? v.caddPhred.toFixed(1) : '—'} · ClinGen{' '}
                            {v.clingenValidity}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {scoredVariants.length > 60 && (
                <div className="border-t border-slate-100 bg-slate-50/60 px-3.5 py-1.5 text-[10px] font-mono text-slate-500">
                  Top 60 shown · use paginated queue below for all {scoredVariants.length.toLocaleString()}
                </div>
              )}
            </>
          )}
        </article>

        {/* Pane 2: Conflicting ClinVar */}
        <article
          aria-label="Conflicting interpretations pane"
          className="flex flex-col border border-slate-200 bg-white rounded-md overflow-hidden"
        >
          <div className="border-b border-slate-200 bg-amber-50/50 px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-amber-900">
                  Conflicting
                </h3>
                <span className="rounded border border-amber-300 bg-white px-1.5 py-0.5 font-mono text-[11px] font-bold text-amber-800 tabular-nums">
                  {conflictingVariants.length}
                </span>
                <span className="font-mono text-[11px] text-amber-700 tabular-nums">
                  ({conflictingPct}%)
                </span>
              </div>
              <button
                type="button"
                aria-pressed={conflictingOnlyActive}
                onClick={() =>
                  onFilterChange({
                    ...filters,
                    clinvarConflict: conflictingOnlyActive ? 'ALL' : 'CONFLICTING',
                  })
                }
                className={`rounded border px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
                  conflictingOnlyActive
                    ? 'border-amber-700 bg-amber-700 text-white'
                    : 'border-amber-300 bg-white text-amber-800 hover:bg-amber-50'
                }`}
              >
                {conflictingOnlyActive ? 'Filtering Only' : 'Filter Only'}
              </button>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-amber-900/80">
              <span>{totalDiscordantLpP} LP/P conflicting assertions</span>
              <span aria-hidden="true">·</span>
              <span>ClinVar lab discordance</span>
            </div>
          </div>

          {conflictingVariants.length === 0 ? (
            <div className="p-5 text-center text-xs text-slate-500 space-y-2">
              <p>No conflicting ClinVar interpretations in the current filtered slice.</p>
              {filters.clinvarConflict === 'UNIFORM' && (
                <button
                  type="button"
                  onClick={() =>
                    onFilterChange({ ...filters, clinvarConflict: 'ALL' })
                  }
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-blue-700 hover:text-blue-700 cursor-pointer"
                >
                  Include Conflicting Variants
                </button>
              )}
            </div>
          ) : (
            <>
              <ul className="divide-y divide-slate-100 max-h-[264px] overflow-y-auto">
                {conflictingVariants.slice(0, 60).map((entry) => {
                  const v = entry.variant;
                  const isSelected = v.id === selectedVariantId;
                  const subs = v.clinvarSubmissions;
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => onSelectVariant(v.id)}
                        aria-pressed={isSelected}
                        className={`w-full text-left px-3.5 py-2.5 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-blue-700 ${
                          isSelected ? 'bg-amber-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="text-xs font-semibold text-slate-900 truncate">
                            <span className="font-mono text-slate-500 mr-1.5">
                              #{entry.rank}
                            </span>
                            <span className="font-mono">{v.gene}</span>{' '}
                            <span>{v.hgvsP !== 'p.?' ? v.hgvsP : v.hgvsC}</span>
                          </div>
                          <span className="font-mono text-xs font-bold text-amber-700 tabular-nums shrink-0">
                            {entry.priorityScore.toFixed(1)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] font-mono tabular-nums">
                          <span className="font-semibold text-amber-800">
                            {subs.lpOrP} LP/P
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-700">{subs.vus} VUS</span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-600">{subs.lbOrB} LB/B</span>
                          <span className="text-slate-400">({subs.total} labs)</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
                          <span className="truncate">{v.proteinDomain}</span>
                          <span className="font-mono shrink-0">
                            Eval: {v.clinvarLastEvaluated} · AF {formatAf(v.gnomadAf)}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {conflictingVariants.length > 60 && (
                <div className="border-t border-slate-100 bg-amber-50/30 px-3.5 py-1.5 text-[10px] font-mono text-amber-800">
                  Top 60 shown · Filter Only to page all {conflictingVariants.length.toLocaleString()}
                </div>
              )}
            </>
          )}
        </article>

        {/* Pane 3: Unstudied Functional Gaps */}
        <article
          aria-label="Unstudied functional gaps pane"
          className="flex flex-col border border-slate-200 bg-white rounded-md overflow-hidden"
        >
          <div className="border-b border-slate-200 bg-teal-50/50 px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-teal-900">
                  Unstudied Gaps
                </h3>
                <span className="rounded border border-teal-300 bg-white px-1.5 py-0.5 font-mono text-[11px] font-bold text-teal-800 tabular-nums">
                  {unstudiedVariants.length}
                </span>
                <span className="font-mono text-[11px] text-teal-700 tabular-nums">
                  ({unstudiedPct}%)
                </span>
              </div>
              <button
                type="button"
                aria-pressed={unstudiedOnlyActive}
                onClick={() =>
                  onFilterChange({
                    ...filters,
                    functionalStatus: unstudiedOnlyActive ? 'ALL' : 'NONE',
                  })
                }
                className={`rounded border px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
                  unstudiedOnlyActive
                    ? 'border-teal-700 bg-teal-700 text-white'
                    : 'border-teal-300 bg-white text-teal-800 hover:bg-teal-50'
                }`}
              >
                {unstudiedOnlyActive ? 'Filtering Only' : 'Filter Only'}
              </button>
            </div>
            <div className="mt-1 flex items-center gap-x-2 text-[11px] text-teal-900/80 whitespace-nowrap overflow-hidden">
              <span className="truncate">{highInSilicoUnstudied} high in-silico (REVEL≥0.75)</span>
              <span aria-hidden="true">·</span>
              <span className="shrink-0">No assay published</span>
            </div>
          </div>

          {unstudiedVariants.length === 0 ? (
            <div className="p-5 text-center text-xs text-slate-500 space-y-2">
              <p>No unstudied functional gap variants in the current filtered slice.</p>
              {filters.functionalStatus === 'HAS_STUDY' && (
                <button
                  type="button"
                  onClick={() =>
                    onFilterChange({ ...filters, functionalStatus: 'ALL' })
                  }
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-blue-700 hover:text-blue-700 cursor-pointer"
                >
                  Include Unstudied Variants
                </button>
              )}
            </div>
          ) : (
            <>
              <ul className="divide-y divide-slate-100 max-h-[264px] overflow-y-auto">
                {unstudiedVariants.slice(0, 60).map((entry) => {
                  const v = entry.variant;
                  const isSelected = v.id === selectedVariantId;
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => onSelectVariant(v.id)}
                        aria-pressed={isSelected}
                        className={`w-full text-left px-3.5 py-2.5 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-blue-700 ${
                          isSelected ? 'bg-teal-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="text-xs font-semibold text-slate-900 truncate">
                            <span className="font-mono text-slate-500 mr-1.5">
                              #{entry.rank}
                            </span>
                            <span className="font-mono">{v.gene}</span>{' '}
                            <span>{v.hgvsP !== 'p.?' ? v.hgvsP : v.hgvsC}</span>
                          </div>
                          <span className="font-mono text-xs font-bold text-teal-700 tabular-nums shrink-0">
                            {entry.priorityScore.toFixed(1)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-snug text-slate-600 line-clamp-2">
                          {v.functionalSummary}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-slate-500 tabular-nums">
                          <span className="text-teal-800 font-medium">
                            No Assay · {v.pubmedCount} {v.pubmedCount === 1 ? 'ref' : 'refs'}
                          </span>
                          <span>
                            REVEL {v.revelScore !== null ? v.revelScore.toFixed(2) : '—'} · CADD{' '}
                            {v.caddPhred !== null ? v.caddPhred.toFixed(1) : '—'}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {unstudiedVariants.length > 60 && (
                <div className="border-t border-slate-100 bg-teal-50/30 px-3.5 py-1.5 text-[10px] font-mono text-teal-800">
                  Top 60 shown · Filter Only to page all {unstudiedVariants.length.toLocaleString()}
                </div>
              )}
            </>
          )}
        </article>
      </div>
    </section>
  );
}
