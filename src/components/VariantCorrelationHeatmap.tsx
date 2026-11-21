import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { ScoredVariant } from '../types/variant';
import {
  buildPairwiseVariantCorrelationMatrix,
  buildScoreFrequencyMatrix,
  type HeatmapMetric,
  type ScoreFrequencyCell,
} from '../utils/heatmapAnalysis';
import { formatAf } from '../utils/prioritisation';

interface VariantCorrelationHeatmapProps {
  scoredVariants: ScoredVariant[];
  selectedVariantId: string | null;
  onSelectVariant: (id: string) => void;
}

type HeatmapMode = 'score_vs_af' | 'pairwise';

const METRIC_OPTIONS: Array<{ id: HeatmapMetric; label: string }> = [
  { id: 'revel', label: 'REVEL' },
  { id: 'alphamissense', label: 'AlphaMissense' },
  { id: 'cadd', label: 'CADD Phred' },
  { id: 'consensus', label: 'In-Silico Consensus' },
];

export function VariantCorrelationHeatmap({
  scoredVariants,
  selectedVariantId,
  onSelectVariant,
}: VariantCorrelationHeatmapProps) {
  const [mode, setMode] = useState<HeatmapMode>('score_vs_af');
  const [metric, setMetric] = useState<HeatmapMetric>('revel');
  const [selectedCellKey, setSelectedCellKey] = useState<string | null>(null);
  const [hoverInfo, setHoverInfo] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const scoreAfMatrix = useMemo(
    () => buildScoreFrequencyMatrix(scoredVariants, metric),
    [scoredVariants, metric],
  );

  const pairwiseMatrix = useMemo(
    () => buildPairwiseVariantCorrelationMatrix(scoredVariants, 12),
    [scoredVariants],
  );

  const activeScoreCell: ScoreFrequencyCell | null = useMemo(() => {
    if (mode !== 'score_vs_af') return null;
    if (selectedCellKey) {
      const found = scoreAfMatrix.cells.find(
        (c) => `${c.scoreBinIndex}-${c.afBinIndex}` === selectedCellKey,
      );
      if (found && found.count > 0) return found;
    }
    return (
      [...scoreAfMatrix.cells]
        .filter((c) => c.count > 0)
        .sort((a, b) => b.count - a.count)[0] ?? null
    );
  }, [mode, scoreAfMatrix.cells, selectedCellKey]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    if (mode === 'score_vs_af') {
      const width = 760;
      const height = 270;
      const margin = { top: 24, right: 24, bottom: 52, left: 122 };
      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;

      svg.attr('viewBox', `0 0 ${width} ${height}`);
      const g = svg
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

      const xScale = d3
        .scaleBand<string>()
        .domain(scoreAfMatrix.afLabels)
        .range([0, innerW])
        .padding(0.04);

      const yScale = d3
        .scaleBand<string>()
        .domain(scoreAfMatrix.scoreLabels)
        .range([0, innerH])
        .padding(0.06);

      const maxVal = Math.max(1, scoreAfMatrix.maxCount);
      const colorScale = d3
        .scaleSequential(d3.interpolateYlGnBu)
        .domain([0, maxVal]);

      // Bottom X axis (gnomAD AF tiers)
      const xAxisG = g
        .append('g')
        .attr('transform', `translate(0,${innerH})`)
        .call(d3.axisBottom(xScale).tickSize(0));
      xAxisG.select('.domain').attr('stroke', '#CBD5E1');
      xAxisG
        .selectAll('text')
        .attr('dy', '1.1em')
        .style('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
        .style('font-size', '10px')
        .style('fill', '#334155');

      // Left Y axis (Functional Score tiers)
      const yAxisG = g.append('g').call(d3.axisLeft(yScale).tickSize(0));
      yAxisG.select('.domain').attr('stroke', '#CBD5E1');
      yAxisG
        .selectAll('text')
        .attr('dx', '-0.5em')
        .style('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
        .style('font-size', '10px')
        .style('fill', '#334155');

      // Axis titles
      svg
        .append('text')
        .attr('x', margin.left + innerW / 2)
        .attr('y', height - 8)
        .attr('text-anchor', 'middle')
        .style('font-size', '10px')
        .style('font-weight', '600')
        .style('fill', '#64748B')
        .text('gnomAD v4 Population Allele Frequency Tier');

      svg
        .append('text')
        .attr('transform', `translate(16,${margin.top + innerH / 2}) rotate(-90)`)
        .attr('text-anchor', 'middle')
        .style('font-size', '10px')
        .style('font-weight', '600')
        .style('fill', '#64748B')
        .text(scoreAfMatrix.metricLabel);

      const cellGroup = g
        .selectAll('g.heat-cell')
        .data(scoreAfMatrix.cells)
        .enter()
        .append('g')
        .attr('class', 'heat-cell')
        .style('cursor', (d) => (d.count > 0 ? 'pointer' : 'default'))
        .on('mouseenter', (_event, d) => {
          setHoverInfo(
            d.count > 0
              ? `${d.scoreLabel} × ${d.afLabel}: ${d.count} VUS (Mean Priority ${d.meanPriorityScore.toFixed(1)}, ${d.conflictingCount} conflicting, ${d.unstudiedCount} unstudied)`
              : `${d.scoreLabel} × ${d.afLabel}: 0 variants`,
          );
        })
        .on('mouseleave', () => setHoverInfo(null))
        .on('click', (_event, d) => {
          if (d.count === 0) return;
          setSelectedCellKey(`${d.scoreBinIndex}-${d.afBinIndex}`);
        });

      cellGroup
        .append('rect')
        .attr('x', (d) => xScale(d.afLabel) ?? 0)
        .attr('y', (d) => yScale(d.scoreLabel) ?? 0)
        .attr('width', xScale.bandwidth())
        .attr('height', yScale.bandwidth())
        .attr('rx', 2)
        .attr('fill', (d) => (d.count === 0 ? '#F8FAFC' : colorScale(d.count)))
        .attr('stroke', (d) => {
          const isSelected =
            activeScoreCell &&
            activeScoreCell.scoreBinIndex === d.scoreBinIndex &&
            activeScoreCell.afBinIndex === d.afBinIndex;
          return isSelected ? '#1D4ED8' : '#E2E8F0';
        })
        .attr('stroke-width', (d) => {
          const isSelected =
            activeScoreCell &&
            activeScoreCell.scoreBinIndex === d.scoreBinIndex &&
            activeScoreCell.afBinIndex === d.afBinIndex;
          return isSelected ? 2 : 1;
        });

      cellGroup
        .append('text')
        .attr('x', (d) => (xScale(d.afLabel) ?? 0) + xScale.bandwidth() / 2)
        .attr('y', (d) => (yScale(d.scoreLabel) ?? 0) + yScale.bandwidth() / 2 - 4)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .style('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
        .style('font-size', '12px')
        .style('font-weight', '700')
        .style('fill', (d) => {
          if (d.count === 0) return '#CBD5E1';
          return d.count / maxVal > 0.55 ? '#FFFFFF' : '#0F172A';
        })
        .text((d) => (d.count > 0 ? String(d.count) : '0'));

      cellGroup
        .filter((d) => d.count > 0)
        .append('text')
        .attr('x', (d) => (xScale(d.afLabel) ?? 0) + xScale.bandwidth() / 2)
        .attr('y', (d) => (yScale(d.scoreLabel) ?? 0) + yScale.bandwidth() / 2 + 12)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .style('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
        .style('font-size', '9px')
        .style('fill', (d) => (d.count / maxVal > 0.55 ? '#E2E8F0' : '#475569'))
        .text((d) => `μ ${d.meanPriorityScore.toFixed(0)}`);
      return;
    }

    // Mode 2: Pairwise Variant Profile Similarity Clustering Heatmap
    const labels = pairwiseMatrix.items.map((it) => it.label);
    const width = 760;
    const height = Math.max(260, labels.length * 22 + 115);
    const margin = { top: 20, right: 20, bottom: 90, left: 155 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    if (labels.length === 0) {
      return;
    }

    const xScale = d3.scaleBand<string>().domain(labels).range([0, innerW]).padding(0.03);
    const yScale = d3.scaleBand<string>().domain(labels).range([0, innerH]).padding(0.03);

    const simColor = d3.scaleSequential(d3.interpolateYlGnBu).domain([0.4, 1]);

    const xAxisG = g
      .append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(xScale).tickSize(0));
    xAxisG.select('.domain').remove();
    xAxisG
      .selectAll('text')
      .attr('transform', 'rotate(-32)')
      .style('text-anchor', 'end')
      .attr('dx', '-0.4em')
      .attr('dy', '0.3em')
      .style('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .style('font-size', '9px')
      .style('fill', '#334155');

    const yAxisG = g.append('g').call(d3.axisLeft(yScale).tickSize(0));
    yAxisG.select('.domain').remove();
    yAxisG
      .selectAll('text')
      .style('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .style('font-size', '9px')
      .style('fill', '#334155');

    g.selectAll('rect.pair-cell')
      .data(pairwiseMatrix.cells)
      .enter()
      .append('rect')
      .attr('class', 'pair-cell')
      .attr('x', (d) => xScale(d.colLabel) ?? 0)
      .attr('y', (d) => yScale(d.rowLabel) ?? 0)
      .attr('width', xScale.bandwidth())
      .attr('height', yScale.bandwidth())
      .attr('rx', 1.5)
      .attr('fill', (d) => simColor(Math.max(0.4, d.similarity)))
      .attr('stroke', (d) =>
        d.rowEntry.variant.id === selectedVariantId ? '#1D4ED8' : '#FFFFFF',
      )
      .attr('stroke-width', (d) =>
        d.rowEntry.variant.id === selectedVariantId ? 1.5 : 0.75,
      )
      .style('cursor', 'pointer')
      .on('mouseenter', (_event, d) => {
        setHoverInfo(
          `${d.rowLabel} ↔ ${d.colLabel}: Cosine evidence similarity ${d.similarity.toFixed(2)} (REVEL + AlphaMissense + CADD + AF + ClinVar + Functional)`,
        );
      })
      .on('mouseleave', () => setHoverInfo(null))
      .on('click', (_event, d) => {
        onSelectVariant(d.rowEntry.variant.id);
      });
  }, [
    mode,
    scoreAfMatrix,
    pairwiseMatrix,
    activeScoreCell,
    selectedVariantId,
    onSelectVariant,
  ]);

  const maxLegendCount = Math.max(1, scoreAfMatrix.maxCount);
  const midLegendCount = Math.max(1, Math.round(maxLegendCount / 2));

  return (
    <section
      aria-label="D3 variant functional score and population frequency correlation heatmap"
      className="border border-slate-200 bg-white rounded-md p-4 space-y-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Variant Evidence Correlation Heatmap (D3)
          </h3>
          <p className="text-xs text-slate-500">
            Visualises functional prediction scores (REVEL, AlphaMissense, CADD, Consensus) against gnomAD population frequency or pairwise evidence-profile clustering.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Heatmap analysis mode"
            className="inline-flex rounded border border-slate-300 bg-slate-50 p-0.5"
          >
            <button
              type="button"
              aria-pressed={mode === 'score_vs_af'}
              onClick={() => setMode('score_vs_af')}
              className={`rounded px-2.5 py-1 text-[11px] font-medium cursor-pointer ${
                mode === 'score_vs_af'
                  ? 'bg-blue-700 text-white font-semibold'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              Score × gnomAD AF
            </button>
            <button
              type="button"
              aria-pressed={mode === 'pairwise'}
              onClick={() => setMode('pairwise')}
              className={`rounded px-2.5 py-1 text-[11px] font-medium cursor-pointer ${
                mode === 'pairwise'
                  ? 'bg-blue-700 text-white font-semibold'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              Pairwise Variant Clusters
            </button>
          </div>

          {mode === 'score_vs_af' && (
            <div
              role="group"
              aria-label="Functional score metric"
              className="inline-flex flex-wrap rounded border border-slate-300 bg-white p-0.5"
            >
              {METRIC_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={metric === opt.id}
                  onClick={() => {
                    setMetric(opt.id);
                    setSelectedCellKey(null);
                  }}
                  className={`rounded px-2 py-1 text-[11px] font-medium cursor-pointer ${
                    metric === opt.id
                      ? 'bg-slate-900 text-white font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quantitative Summary & Explicit Color Scale Legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-2.5 text-[11px]">
        <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums text-slate-600">
          {mode === 'score_vs_af' ? (
            <>
              <span>
                Evaluated: <strong className="text-slate-900">{scoreAfMatrix.evaluatedCount}</strong> VUS
              </span>
              <span>
                Rarity-Score Pearson <em>r</em>:{' '}
                <strong className="text-blue-700">
                  {scoreAfMatrix.pearsonR !== null
                    ? scoreAfMatrix.pearsonR.toFixed(3)
                    : 'N/A'}
                </strong>
              </span>
            </>
          ) : (
            <span>
              Seriated cluster matrix across top{' '}
              <strong className="text-slate-900">{pairwiseMatrix.items.length}</strong>{' '}
              ranked variants
            </span>
          )}
        </div>

        {/* Continuous Color Scale Legend */}
        <div className="flex items-center gap-2 font-mono text-[10px] text-slate-500 tabular-nums">
          <span>{mode === 'score_vs_af' ? 'Count: 0' : 'Sim: 0.40'}</span>
          <div
            className="h-2.5 w-28 rounded-xs border border-slate-200"
            style={{
              background:
                'linear-gradient(90deg, #ffffd9 0%, #c7e9b4 25%, #41b6c4 55%, #225ea8 80%, #081d58 100%)',
            }}
          />
          <span>
            {mode === 'score_vs_af'
              ? `${midLegendCount} · Max ${maxLegendCount}`
              : '0.70 · 1.00'}
          </span>
        </div>
      </div>

      {/* D3 SVG Container */}
      <div className="overflow-x-auto">
        <svg
          ref={svgRef}
          role="img"
          aria-label="D3 variant correlation heatmap"
          className="w-full min-w-[600px] h-auto select-none"
        />
      </div>

      {/* Live Hover Readout Strip */}
      <div className="border-t border-slate-100 pt-2 text-[11px] font-mono text-slate-600 min-h-[20px]">
        {hoverInfo ??
          (mode === 'score_vs_af'
            ? 'Hover or click any heatmap bin to inspect clustered variants sharing that functional score & AF profile.'
            : 'Click any cell in the similarity matrix to jump directly to that variant dossier.')}
      </div>

      {/* Clicked Cluster Variant List */}
      {mode === 'score_vs_af' && activeScoreCell && (
        <div className="rounded border border-slate-200 bg-slate-50/70 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="font-semibold text-slate-900">
              Cluster Inspector: <span className="font-mono text-blue-700">{activeScoreCell.scoreLabel}</span>{' '}
              × <span className="font-mono text-slate-800">{activeScoreCell.afLabel}</span>{' '}
              ({activeScoreCell.count} {activeScoreCell.count === 1 ? 'variant' : 'variants'})
            </div>
            <div className="font-mono text-[11px] text-slate-600 tabular-nums">
              Mean Priority {activeScoreCell.meanPriorityScore.toFixed(1)} ·{' '}
              {activeScoreCell.conflictingCount} conflicting ·{' '}
              {activeScoreCell.unstudiedCount} unstudied
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {activeScoreCell.variants.map((entry) => {
              const v = entry.variant;
              const isSelected = v.id === selectedVariantId;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onSelectVariant(v.id)}
                  className={`rounded border px-2 py-1 text-[11px] font-mono transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-blue-700 bg-blue-700 text-white font-semibold'
                      : 'border-slate-300 bg-white text-slate-800 hover:border-blue-700 hover:text-blue-700'
                  }`}
                >
                  #{entry.rank} {v.gene} {v.hgvsP !== 'p.?' ? v.hgvsP : v.hgvsC} · AF{' '}
                  {formatAf(v.gnomadAf)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
