import { useState } from 'react';
import type { EvaluationSummary } from '../types/variant';

interface EvaluationViewProps {
  evaluation: EvaluationSummary;
  availableGenes: string[];
  evalGene: string;
  evalVariantType: string;
  onEvalGeneChange: (gene: string) => void;
  onEvalVariantTypeChange: (variantType: string) => void;
  onEvaluateAll: () => void;
}

export function EvaluationView({
  evaluation,
  availableGenes,
  evalGene,
  evalVariantType,
  onEvalGeneChange,
  onEvalVariantTypeChange,
  onEvaluateAll,
}: EvaluationViewProps) {
  const [hoveredK, setHoveredK] = useState<number | null>(null);
  const scopeLabel = [
    evalGene === 'ALL' ? 'All Genes' : evalGene,
    evalVariantType === 'ALL' ? 'All Variant Types' : evalVariantType,
  ].join(' · ');
  const isFiltered = evalGene !== 'ALL' || evalVariantType !== 'ALL';

  const isSmallCohort = evaluation.totalEvaluated <= 12;
  const baseRate =
    evaluation.totalEvaluated > 0
      ? evaluation.totalPositiveTruth / evaluation.totalEvaluated
      : 0;
  const effectiveEnrichment = isSmallCohort
    ? baseRate > 0
      ? evaluation.precisionAt5Custom / baseRate
      : 0
    : evaluation.enrichmentAt10;

  const width = 760;
  const height = 270;
  const padLeft = 52;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 38;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const curve = evaluation.recallCurve;
  const maxK = Math.max(1, curve.length);

  const xForK = (k: number) =>
    padLeft + ((k - 1) / Math.max(1, maxK - 1)) * plotW;
  const yForRecall = (r: number) => padTop + (1 - r) * plotH;

  const customPath = curve
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xForK(pt.k)} ${yForRecall(pt.customRecall)}`)
    .join(' ');
  const baselinePath = curve
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xForK(pt.k)} ${yForRecall(pt.baselineRecall)}`)
    .join(' ');

  const hoveredPoint =
    curve.find((pt) => pt.k === hoveredK) ?? curve[Math.min(9, curve.length - 1)] ?? null;

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-6 space-y-6">
      {/* Intro & Evaluation Methodology */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Benchmark Evaluation vs. Rarity-Only Baseline
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-3xl">
            Evaluates whether your current custom weights across{' '}
            <strong className="font-semibold text-slate-900">{scopeLabel}</strong> surface
            held-out variants that were subsequently reclassified in ClinVar or confirmed in
            independent functional studies (labels excluded from scoring) earlier than ranking solely
            by gnomAD rarity.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2.5">
          <div>
            <label
              htmlFor="eval-gene-select"
              className="block text-[11px] font-medium text-slate-600 mb-1"
            >
              Gene Scope
            </label>
            <select
              id="eval-gene-select"
              value={evalGene}
              onChange={(e) => onEvalGeneChange(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 focus:border-blue-700 focus:outline-none"
            >
              <option value="ALL">All Genes (Benchmark Cohort)</option>
              {availableGenes.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="eval-type-select"
              className="block text-[11px] font-medium text-slate-600 mb-1"
            >
              Variant Type
            </label>
            <select
              id="eval-type-select"
              value={evalVariantType}
              onChange={(e) => onEvalVariantTypeChange(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 focus:border-blue-700 focus:outline-none"
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

          {isFiltered && (
            <button
              type="button"
              onClick={onEvaluateAll}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Reset to All Genes &amp; Types
            </button>
          )}
        </div>
      </div>

      {/* 4-column KPI comparison strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="border border-slate-200 bg-white rounded-md p-4">
          <div className="text-[11px] font-semibold text-slate-500">
            PRECISION @ TOP 5
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-blue-700 tabular-nums">
              {(evaluation.precisionAt5Custom * 100).toFixed(0)}%
            </span>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              vs {(evaluation.precisionAt5Baseline * 100).toFixed(0)}% baseline
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-600">
            Validated hits among Top 5 ranked VUS
          </div>
        </div>

        <div className="border border-slate-200 bg-white rounded-md p-4">
          <div className="text-[11px] font-semibold text-slate-500">
            {isSmallCohort ? 'PRECISION @ TOP 3' : 'PRECISION @ TOP 10'}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-blue-700 tabular-nums">
              {(
                (isSmallCohort
                  ? curve[2]?.customPrecision ?? evaluation.precisionAt5Custom
                  : evaluation.precisionAt10Custom) * 100
              ).toFixed(0)}
              %
            </span>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              vs{' '}
              {(
                (isSmallCohort
                  ? curve[2]?.baselinePrecision ?? evaluation.precisionAt5Baseline
                  : evaluation.precisionAt10Baseline) * 100
              ).toFixed(0)}
              % baseline
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-600">
            Validated hits among Top {isSmallCohort ? 3 : 10} ranked VUS
          </div>
        </div>

        <div className="border border-slate-200 bg-white rounded-md p-4">
          <div className="text-[11px] font-semibold text-slate-500">
            MEAN RECIPROCAL RANK (MRR)
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {evaluation.mrrCustom.toFixed(3)}
            </span>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              vs {evaluation.mrrBaseline.toFixed(3)} baseline
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-600">
            Higher indicates earlier discovery of positive VUS
          </div>
        </div>

        <div className="border border-slate-200 bg-white rounded-md p-4">
          <div className="text-[11px] font-semibold text-slate-500">
            {isSmallCohort ? 'TOP-5 ENRICHMENT VS RANDOM' : 'TOP-10 ENRICHMENT VS RANDOM'}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-emerald-700 tabular-nums">
              {effectiveEnrichment.toFixed(2)}x
            </span>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              ({evaluation.totalPositiveTruth}/{evaluation.totalEvaluated} positive)
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-600">
            Fold-improvement vs uniform random sampling
          </div>
        </div>
      </div>

      {/* Recall@K Comparison SVG Chart */}
      <section className="border border-slate-200 bg-white rounded-md p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-4 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Cumulative Recall-at-K Curve
            </h2>
            <p className="text-xs text-slate-500">
              Fraction of held-out reclassified or functionally confirmed variants recovered within the Top K ranked candidates
            </p>
          </div>
          <div className="flex items-center gap-5 text-xs text-slate-700">
            <span className="inline-flex items-center gap-2">
              <span className="inline-block w-5 h-0.5 bg-blue-700" />
              <span>Custom Multi-Evidence Model</span>
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="inline-block w-5 h-0.5 border-t-2 border-dashed border-amber-600" />
              <span>Rarity-Only Baseline (gnomAD AF)</span>
            </span>
          </div>
        </div>

        {curve.length >= 2 && evaluation.totalPositiveTruth > 0 ? (
          <div className="overflow-x-auto">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full min-w-[600px] h-auto"
              role="img"
              aria-label="Cumulative recall comparison chart between custom weighted model and rarity-only baseline"
            >
              {[0, 0.25, 0.5, 0.75, 1].map((yVal) => {
                const y = yForRecall(yVal);
                return (
                  <g key={yVal}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={width - padRight}
                      y2={y}
                      stroke="#E2E8F0"
                      strokeWidth={1}
                    />
                    <text
                      x={padLeft - 8}
                      y={y + 3}
                      textAnchor="end"
                      className="fill-slate-400 font-mono text-[10px]"
                    >
                      {Math.round(yVal * 100)}%
                    </text>
                  </g>
                );
              })}

              {/* Random diagonal reference */}
              <line
                x1={padLeft}
                y1={yForRecall(0)}
                x2={width - padRight}
                y2={yForRecall(
                  Math.min(1, curve.length / Math.max(1, evaluation.totalEvaluated)),
                )}
                stroke="#CBD5E1"
                strokeWidth={1}
                strokeDasharray="2 4"
              />

              {/* Baseline curve */}
              <path
                d={baselinePath}
                fill="none"
                stroke="#D97706"
                strokeWidth={2}
                strokeDasharray="6 4"
              />

              {/* Custom weighted curve */}
              <path
                d={customPath}
                fill="none"
                stroke="#1D4ED8"
                strokeWidth={2.5}
              />

              {/* Interactive points */}
              {curve.map((pt) => {
                const x = xForK(pt.k);
                const yC = yForRecall(pt.customRecall);
                const yB = yForRecall(pt.baselineRecall);
                const active = hoveredK === pt.k;
                return (
                  <g key={pt.k}>
                    <circle
                      cx={x}
                      cy={yB}
                      r={active ? 4 : 2.5}
                      fill="#D97706"
                    />
                    <circle
                      cx={x}
                      cy={yC}
                      r={active ? 4.5 : 3}
                      fill="#1D4ED8"
                    />
                    <rect
                      x={x - plotW / (maxK * 2)}
                      y={padTop}
                      width={plotW / maxK}
                      height={plotH}
                      fill="transparent"
                      onMouseEnter={() => setHoveredK(pt.k)}
                      onMouseLeave={() => setHoveredK(null)}
                    />
                  </g>
                );
              })}

              {/* X-axis ticks */}
              {curve
                .filter((pt) => pt.k === 1 || pt.k % 5 === 0 || pt.k === maxK)
                .map((pt) => (
                  <text
                    key={pt.k}
                    x={xForK(pt.k)}
                    y={height - 12}
                    textAnchor="middle"
                    className="fill-slate-500 font-mono text-[10px]"
                  >
                    Top {pt.k}
                  </text>
                ))}
            </svg>

            {hoveredPoint && (
              <div className="mt-2 flex flex-wrap items-center justify-between border-t border-slate-100 pt-2 font-mono text-xs text-slate-600 tabular-nums">
                <span>
                  Cutoff K = Top {hoveredPoint.k}: Custom Recall{' '}
                  <strong className="text-blue-700">
                    {(hoveredPoint.customRecall * 100).toFixed(1)}%
                  </strong>{' '}
                  (Precision {(hoveredPoint.customPrecision * 100).toFixed(0)}%)
                </span>
                <span>
                  Rarity Baseline Recall{' '}
                  <strong className="text-amber-700">
                    {(hoveredPoint.baselineRecall * 100).toFixed(1)}%
                  </strong>{' '}
                  (Precision {(hoveredPoint.baselinePrecision * 100).toFixed(0)}%)
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="py-6 text-center space-y-3">
            <p className="text-xs text-slate-600 max-w-lg mx-auto">
              Live-queried and narrow filtered cohorts do not contain held-out retrospective reclassification labels. Switch to the full 40-variant curated benchmark cohort to plot the Recall-at-K comparison curve.
            </p>
            <button
              type="button"
              onClick={onEvaluateAll}
              className="inline-flex items-center rounded-md bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
            >
              Evaluate All 40 Curated Benchmark Variants
            </button>
          </div>
        )}
      </section>

      {/* Per-variant Rank Gain Verification Table */}
      <section className="border border-slate-200 bg-white rounded-md overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Held-Out Reclassified &amp; Functionally Validated Variants ({evaluation.positiveVariantRows.length})
          </h2>
          <p className="text-xs text-slate-500">
            Positive rank gain means the multi-evidence model surfaced the variant earlier than ranking purely by gnomAD allele frequency.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 pl-5 pr-3">Variant</th>
                <th className="py-2.5 px-3 text-right">Custom Rank</th>
                <th className="py-2.5 px-3 text-right">Rarity Baseline</th>
                <th className="py-2.5 px-3 text-right">Rank Gain</th>
                <th className="py-2.5 px-3 text-right">Score</th>
                <th className="py-2.5 pl-3 pr-5">Held-Out Independent Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {evaluation.positiveVariantRows.map((row) => {
                const v = row.variant;
                return (
                  <tr key={v.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pl-5 pr-3 whitespace-nowrap">
                      <span className="font-mono font-semibold text-slate-900">
                        {v.gene}
                      </span>{' '}
                      <span className="font-medium text-slate-800">
                        {v.hgvsP !== 'p.?' ? v.hgvsP : v.hgvsC}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-blue-700 tabular-nums">
                      #{row.customRank}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600 tabular-nums">
                      #{row.baselineRank}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums">
                      {row.rankGain > 0 ? (
                        <span className="text-emerald-700">+{row.rankGain}</span>
                      ) : row.rankGain < 0 ? (
                        <span className="text-rose-700">{row.rankGain}</span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-800 tabular-nums">
                      {row.customScore.toFixed(1)}
                    </td>
                    <td className="py-2.5 pl-3 pr-5 text-slate-600">
                      <span className="font-medium text-slate-800">
                        {v.evaluationTruth === 'reclassified_lp_p'
                          ? 'Reclassified LP/P'
                          : 'Functional LOF Confirmed'}
                      </span>
                      <span aria-hidden="true"> · </span>
                      <span>{v.evaluationNote}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
