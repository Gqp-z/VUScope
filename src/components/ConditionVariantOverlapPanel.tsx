import { useMemo, useState } from 'react';
import type { GeneMetadata, ScoredVariant } from '../types/variant';
import { evaluateAcmgCriteria } from '../utils/acmgAutomation';
import {
  buildConditionVariantIndex,
  computeConditionPairOverlap,
} from '../utils/heatmapAnalysis';

interface ConditionVariantOverlapPanelProps {
  scoredVariants: ScoredVariant[];
  liveGeneMeta?: Record<string, GeneMetadata>;
  selectedVariantId: string | null;
  activeConditionFilter: string;
  onSelectVariant: (id: string) => void;
  onSelectConditionFilter: (condition: string) => void;
}

export function ConditionVariantOverlapPanel({
  scoredVariants,
  liveGeneMeta,
  selectedVariantId,
  activeConditionFilter,
  onSelectVariant,
  onSelectConditionFilter,
}: ConditionVariantOverlapPanelProps) {
  const conditionGroups = useMemo(
    () => buildConditionVariantIndex(scoredVariants, liveGeneMeta),
    [scoredVariants, liveGeneMeta],
  );

  const [condASelection, setCondASelection] = useState<string>('');
  const [condBSelection, setCondBSelection] = useState<string>('');
  const [showAllConditions, setShowAllConditions] = useState(false);

  const effectiveCondA = useMemo(() => {
    if (
      condASelection &&
      conditionGroups.some((g) => g.condition === condASelection)
    ) {
      return condASelection;
    }
    return conditionGroups[0]?.condition ?? '';
  }, [condASelection, conditionGroups]);

  const effectiveCondB = useMemo(() => {
    if (
      condBSelection &&
      conditionGroups.some((g) => g.condition === condBSelection)
    ) {
      return condBSelection;
    }
    const groupA = conditionGroups.find((g) => g.condition === effectiveCondA);
    const idsA = new Set((groupA?.variants ?? []).map((s) => s.variant.id));

    const partialOverlap = conditionGroups.find((g) => {
      if (g.condition === effectiveCondA) return false;
      const sharedCount = g.variants.filter((s) => idsA.has(s.variant.id)).length;
      const isIdenticalSet =
        sharedCount === idsA.size && g.variants.length === idsA.size;
      return sharedCount > 0 && !isIdenticalSet;
    });

    const distinctSetFallback = conditionGroups.find((g) => {
      if (g.condition === effectiveCondA) return false;
      const sharedCount = g.variants.filter((s) => idsA.has(s.variant.id)).length;
      return !(sharedCount === idsA.size && g.variants.length === idsA.size);
    });

    return (
      partialOverlap?.condition ??
      distinctSetFallback?.condition ??
      conditionGroups.find((g) => g.condition !== effectiveCondA)?.condition ??
      ''
    );
  }, [condBSelection, conditionGroups, effectiveCondA]);

  const overlap = useMemo(() => {
    if (!effectiveCondA || !effectiveCondB) return null;
    return computeConditionPairOverlap(
      scoredVariants,
      effectiveCondA,
      effectiveCondB,
      liveGeneMeta,
    );
  }, [scoredVariants, effectiveCondA, effectiveCondB, liveGeneMeta]);

  if (conditionGroups.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Clinical conditions with causative variants and overlap comparison panel"
      className="border border-slate-200 bg-white rounded-md p-4 space-y-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Conditions, Causative Variants &amp; Overlap Comparison Panel
          </h3>
          <p className="text-xs text-slate-500">
            Every clinical condition mapped to the exact variants driving risk, alongside a side-by-side condition overlap breakdown.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
            {conditionGroups.length} indexed conditions across {scoredVariants.length} VUS
          </span>
          {conditionGroups.length > 30 && (
            <button
              type="button"
              onClick={() => setShowAllConditions((prev) => !prev)}
              className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:border-blue-700 cursor-pointer"
            >
              {showAllConditions ? 'Show top 30' : `Show all ${conditionGroups.length}`}
            </button>
          )}
        </div>
      </div>

      {/* Condition -> Respective Causative Variants Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[310px] overflow-y-auto pr-1">
        {(showAllConditions ? conditionGroups : conditionGroups.slice(0, 30)).map((group) => {
          const isFilterActive =
            activeConditionFilter !== 'ALL' &&
            activeConditionFilter.toLowerCase() === group.condition.toLowerCase();

          return (
            <div
              key={group.condition}
              className={`rounded border p-3 space-y-2 ${
                isFilterActive
                  ? 'border-blue-700 bg-blue-50/40'
                  : 'border-slate-200 bg-slate-50/50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() =>
                      onSelectConditionFilter(
                        isFilterActive ? 'ALL' : group.condition,
                      )
                    }
                    className={`text-left text-xs font-semibold hover:underline cursor-pointer ${
                      isFilterActive ? 'text-blue-700' : 'text-slate-900'
                    }`}
                  >
                    {group.condition}
                  </button>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    <span className="font-mono font-semibold text-slate-700">
                      {group.genes.join(', ')}
                    </span>
                    <span aria-hidden="true"> · </span>
                    <span>ClinGen {group.clingenValidity}</span>
                    <span aria-hidden="true"> · </span>
                    <span>{group.inheritance}</span>
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[11px] font-bold text-slate-700 tabular-nums">
                  {group.variants.length}{' '}
                  {group.variants.length === 1 ? 'variant' : 'variants'}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {group.variants.map((entry) => {
                  const v = entry.variant;
                  const isSelected = v.id === selectedVariantId;
                  const acmg = evaluateAcmgCriteria(v);
                  const label = v.hgvsP !== 'p.?' ? v.hgvsP : v.hgvsC;
                  return (
                    <button
                      key={`${group.condition}-${v.id}`}
                      type="button"
                      onClick={() => onSelectVariant(v.id)}
                      className={`rounded border px-2 py-0.5 text-[11px] font-mono transition-colors cursor-pointer ${
                        isSelected
                          ? 'border-blue-700 bg-blue-700 text-white font-semibold'
                          : acmg.isHotVus
                            ? 'border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-600'
                            : 'border-slate-300 bg-white text-slate-800 hover:border-blue-700 hover:text-blue-700'
                      }`}
                      title={`Rank #${entry.rank} · Priority ${entry.priorityScore.toFixed(1)} · ACMG ${acmg.classification}`}
                    >
                      {v.gene} {label}
                      {acmg.isHotVus ? ' ★' : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Interactive Condition Overlap Comparison Panel */}
      {conditionGroups.length >= 2 && overlap && (
        <div className="border-t border-slate-200 pt-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-semibold text-slate-900">
              Condition Variant Overlap Comparison
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="cond-overlap-a" className="sr-only">
                Condition A
              </label>
              <select
                id="cond-overlap-a"
                value={effectiveCondA}
                onChange={(e) => setCondASelection(e.target.value)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-800 max-w-xs focus:border-blue-700 focus:outline-none"
              >
                {conditionGroups.map((g) => (
                  <option key={g.condition} value={g.condition}>
                    A: {g.condition} ({g.variants.length})
                  </option>
                ))}
              </select>

              <span className="text-xs text-slate-400 font-mono">∩</span>

              <label htmlFor="cond-overlap-b" className="sr-only">
                Condition B
              </label>
              <select
                id="cond-overlap-b"
                value={effectiveCondB}
                onChange={(e) => setCondBSelection(e.target.value)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-800 max-w-xs focus:border-blue-700 focus:outline-none"
              >
                {conditionGroups.map((g) => (
                  <option key={g.condition} value={g.condition}>
                    B: {g.condition} ({g.variants.length})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Only Condition A */}
            <div className="rounded border border-slate-200 bg-slate-50/60 p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-slate-800 truncate">
                  Only in A ({overlap.onlyA.length})
                </span>
                <span className="font-mono text-slate-500 shrink-0">Unique A</span>
              </div>
              {overlap.onlyA.length === 0 ? (
                <p className="text-[11px] text-slate-500">No unique variants in Condition A.</p>
              ) : (
                <ul className="space-y-1 max-h-36 overflow-y-auto">
                  {overlap.onlyA.slice(0, 30).map((s) => (
                    <li key={`onlya-${s.variant.id}`}>
                      <button
                        type="button"
                        onClick={() => onSelectVariant(s.variant.id)}
                        className="w-full text-left flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] hover:border-blue-700 cursor-pointer"
                      >
                        <span className="font-mono text-slate-800 truncate">
                          {s.variant.gene}{' '}
                          {s.variant.hgvsP !== 'p.?' ? s.variant.hgvsP : s.variant.hgvsC}
                        </span>
                        <span className="font-mono font-semibold text-slate-600 tabular-nums">
                          {s.priorityScore.toFixed(1)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Shared Overlap */}
            <div className="rounded border border-blue-200 bg-blue-50/40 p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-blue-900 truncate">
                  Shared Causative Overlap ({overlap.shared.length})
                </span>
                <span className="font-mono text-blue-700 shrink-0">A ∩ B</span>
              </div>
              {overlap.shared.length === 0 ? (
                <p className="text-[11px] text-slate-500">
                  No shared variants between these two conditions.
                </p>
              ) : (
                <ul className="space-y-1 max-h-36 overflow-y-auto">
                  {overlap.shared.slice(0, 30).map((s) => (
                    <li key={`shared-${s.variant.id}`}>
                      <button
                        type="button"
                        onClick={() => onSelectVariant(s.variant.id)}
                        className="w-full text-left flex items-center justify-between gap-2 rounded border border-blue-200 bg-white px-2 py-1 text-[11px] hover:border-blue-700 cursor-pointer"
                      >
                        <span className="font-mono font-semibold text-blue-900 truncate">
                          {s.variant.gene}{' '}
                          {s.variant.hgvsP !== 'p.?' ? s.variant.hgvsP : s.variant.hgvsC}
                        </span>
                        <span className="font-mono font-bold text-blue-700 tabular-nums">
                          {s.priorityScore.toFixed(1)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Only Condition B */}
            <div className="rounded border border-slate-200 bg-slate-50/60 p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-slate-800 truncate">
                  Only in B ({overlap.onlyB.length})
                </span>
                <span className="font-mono text-slate-500 shrink-0">Unique B</span>
              </div>
              {overlap.onlyB.length === 0 ? (
                <p className="text-[11px] text-slate-500">No unique variants in Condition B.</p>
              ) : (
                <ul className="space-y-1 max-h-36 overflow-y-auto">
                  {overlap.onlyB.slice(0, 30).map((s) => (
                    <li key={`onlyb-${s.variant.id}`}>
                      <button
                        type="button"
                        onClick={() => onSelectVariant(s.variant.id)}
                        className="w-full text-left flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] hover:border-blue-700 cursor-pointer"
                      >
                        <span className="font-mono text-slate-800 truncate">
                          {s.variant.gene}{' '}
                          {s.variant.hgvsP !== 'p.?' ? s.variant.hgvsP : s.variant.hgvsC}
                        </span>
                        <span className="font-mono font-semibold text-slate-600 tabular-nums">
                          {s.priorityScore.toFixed(1)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
