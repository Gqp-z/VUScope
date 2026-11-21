import { useState } from 'react';
import { GENE_METADATA } from '../data/genes';
import type { GeneMetadata, ScoredVariant } from '../types/variant';

interface DomainLollipopChartProps {
  geneSymbol: string;
  scoredVariants: ScoredVariant[];
  selectedVariantId: string | null;
  onSelectVariant: (id: string) => void;
  liveGeneMeta?: Record<string, GeneMetadata>;
  activeConditionFilter?: string;
  onSelectCondition?: (condition: string) => void;
  activeSearchQuery?: string;
  onSelectDomainFilter?: (domainName: string) => void;
}

function compactMoi(inheritance: string): string {
  const lower = inheritance.toLowerCase();
  if (lower.includes('dominant') && lower.includes('recessive')) return 'AD/AR';
  if (lower.includes('recessive')) return 'AR';
  if (lower.includes('dominant')) return 'AD';
  if (lower.includes('x-linked')) return 'XL';
  return inheritance;
}

export function DomainLollipopChart({
  geneSymbol,
  scoredVariants,
  selectedVariantId,
  onSelectVariant,
  liveGeneMeta,
  activeConditionFilter = 'ALL',
  onSelectCondition,
  activeSearchQuery = '',
  onSelectDomainFilter,
}: DomainLollipopChartProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const geneVariants = scoredVariants.filter(
    (s) => s.variant.gene === geneSymbol && s.variant.aaPosition !== null,
  );

  const staticMeta = GENE_METADATA[geneSymbol] ?? liveGeneMeta?.[geneSymbol];
  const maxAa = geneVariants.reduce(
    (max, item) => Math.max(max, item.variant.aaPosition ?? 0),
    0,
  );

  const geneMeta: GeneMetadata | null =
    staticMeta ??
    (geneVariants.length > 0 && maxAa > 0
      ? {
          symbol: geneSymbol,
          fullName: `${geneSymbol} (Live Database Cohort)`,
          chromosome: 'GRCh38',
          proteinLengthAa: Math.max(400, Math.ceil((maxAa * 1.15) / 50) * 50),
          transcriptId: geneVariants[0]?.variant.ensemblGeneId || 'Ensembl / ClinVar Live',
          primaryConditions:
            geneVariants[0]?.variant.associatedConditions ??
            [geneVariants[0]?.variant.diseaseAssociation || `${geneSymbol}-associated condition`],
          clingenValidity: geneVariants[0]?.variant.clingenValidity || 'Moderate',
          clingenExpertPanel: geneVariants[0]?.variant.clingenExpertPanel || 'ClinGen Live Curation',
          inheritance: 'Curated',
          vusBurdenNote: 'Live coordinates mapped from dbNSFP/ClinVar',
          domains: [],
        }
      : null);

  if (!geneMeta) {
    return (
      <section className="border border-slate-200 bg-white rounded-md px-4 py-3 text-xs text-slate-600">
        Protein residue coordinates are mapped automatically when variants include amino-acid positions. Select a gene cohort or click any variant row below to inspect its multi-database dossier.
      </section>
    );
  }

  const width = 920;
  const height = 210;
  const padLeft = 44;
  const padRight = 28;
  const plotWidth = width - padLeft - padRight;
  const backboneY = 148;

  const scaleX = (aa: number) =>
    padLeft + (Math.max(0, Math.min(aa, geneMeta.proteinLengthAa)) / geneMeta.proteinLengthAa) * plotWidth;

  const scoreToY = (score: number) => {
    const minStemTop = 32;
    const maxStemBase = backboneY - 18;
    const ratio = Math.max(0, Math.min(1, score / 100));
    return maxStemBase - ratio * (maxStemBase - minStemTop);
  };

  const selectedEntry =
    geneVariants.find((s) => s.variant.id === selectedVariantId) ?? geneVariants[0] ?? null;
  const activeHover =
    geneVariants.find((s) => s.variant.id === hoveredId) ?? selectedEntry;
  const neighborRefs = selectedEntry?.variant.similarClassifiedVariants ?? [];

  const conditionItems =
    geneMeta.conditionDetails && geneMeta.conditionDetails.length > 0
      ? geneMeta.conditionDetails
      : geneMeta.primaryConditions.map((condition) => ({
          condition,
          inheritance: geneMeta.inheritance,
          clingenValidity: geneMeta.clingenValidity,
          clinicalSpectrumNote: undefined,
        }));

  const tickStep = geneMeta.proteinLengthAa > 1200 ? 400 : 100;
  const ticks: number[] = [1];
  for (let t = tickStep; t < geneMeta.proteinLengthAa; t += tickStep) {
    ticks.push(t);
  }
  ticks.push(geneMeta.proteinLengthAa);

  return (
    <section
      aria-label={`${geneMeta.symbol} protein domain and VUS priority map`}
      className="border border-slate-200 bg-white rounded-md p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-4 mb-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {geneMeta.symbol} — Protein Domain &amp; Priority Map
          </h3>
          <p className="text-xs text-slate-500">
            {geneMeta.fullName} · {geneMeta.transcriptId} · {geneMeta.proteinLengthAa} aa ·{' '}
            {geneMeta.clingenExpertPanel}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-3.5 rounded-xs bg-cyan-600/20 border border-cyan-600" />
            <span>Pathogenic Hotspot Domain</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-600" />
            <span>Conflicting ClinVar</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-700" />
            <span>Uniform VUS</span>
          </span>
          {neighborRefs.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rotate-45 bg-rose-600" />
              <span>ClinVar P/LP Neighbor</span>
            </span>
          )}
        </div>
      </div>

      {conditionItems.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
          <span className="text-[11px] font-semibold text-slate-600 mr-1">
            Arising conditions ({conditionItems.length}):
          </span>
          {conditionItems.map((item) => {
            const isActive =
              activeConditionFilter !== 'ALL' &&
              activeConditionFilter.toLowerCase() === item.condition.toLowerCase();
            return (
              <button
                key={item.condition}
                type="button"
                title={
                  item.clinicalSpectrumNote ||
                  `${item.condition} (${item.inheritance}, ClinGen ${item.clingenValidity})`
                }
                onClick={() => onSelectCondition?.(isActive ? 'ALL' : item.condition)}
                className={`rounded border px-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
                  isActive
                    ? 'border-blue-700 bg-blue-50 font-semibold text-blue-800'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-700 hover:text-blue-700'
                }`}
              >
                <span>{item.condition}</span>
                <span className="ml-1 font-mono text-[10px] text-slate-500">
                  ({compactMoi(item.inheritance)} · {item.clingenValidity})
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full min-w-[680px] h-auto select-none"
          role="img"
          aria-label={`Lollipop plot of ${geneVariants.length} variants across ${geneMeta.symbol} domains`}
        >
          {/* Y-axis reference gridlines for Priority Score */}
          {[0, 50, 100].map((scoreVal) => {
            const y = scoreVal === 0 ? backboneY : scoreToY(scoreVal);
            return (
              <g key={scoreVal}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="#E2E8F0"
                  strokeWidth={1}
                  strokeDasharray={scoreVal === 0 ? undefined : '3 3'}
                />
                <text
                  x={padLeft - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-slate-400 font-mono text-[10px]"
                >
                  {scoreVal}
                </text>
              </g>
            );
          })}

          <text
            x={12}
            y={82}
            transform={`rotate(-90, 12, 82)`}
            textAnchor="middle"
            className="fill-slate-400 font-mono text-[9px]"
          >
            PRIORITY
          </text>

          {/* Protein backbone track */}
          <rect
            x={padLeft}
            y={backboneY - 5}
            width={plotWidth}
            height={10}
            rx={2}
            fill="#E2E8F0"
          />

          {/* Functional domains (clickable to filter queue by domain) */}
          {geneMeta.domains.map((dom) => {
            const x1 = scaleX(dom.startAa);
            const x2 = scaleX(dom.endAa);
            const domW = Math.max(8, x2 - x1);
            const domainToken = dom.name.split(/\s+/)[0].toLowerCase();
            const isDomainActive =
              activeSearchQuery.trim().length > 0 &&
              (activeSearchQuery.toLowerCase() === dom.name.toLowerCase() ||
                activeSearchQuery.toLowerCase() === domainToken);
            return (
              <g
                key={dom.name}
                role={onSelectDomainFilter ? 'button' : undefined}
                tabIndex={onSelectDomainFilter ? 0 : undefined}
                aria-label={`Filter by ${dom.name} domain (${dom.startAa}-${dom.endAa} aa)`}
                onClick={() => onSelectDomainFilter?.(dom.name)}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && onSelectDomainFilter) {
                    e.preventDefault();
                    onSelectDomainFilter(dom.name);
                  }
                }}
                className={onSelectDomainFilter ? 'cursor-pointer focus:outline-none' : undefined}
              >
                <title>
                  {`${dom.name} (${dom.startAa}–${dom.endAa} aa): ${dom.description}${onSelectDomainFilter ? ' · Click to filter domain' : ''}`}
                </title>
                <rect
                  x={x1}
                  y={backboneY - 8}
                  width={domW}
                  height={16}
                  rx={2}
                  fill={
                    isDomainActive
                      ? '#DBEAFE'
                      : dom.pathogenicHotspot
                        ? '#CFFAFE'
                        : '#F1F5F9'
                  }
                  stroke={
                    isDomainActive
                      ? '#1D4ED8'
                      : dom.pathogenicHotspot
                        ? '#0891B2'
                        : '#94A3B8'
                  }
                  strokeWidth={isDomainActive ? 2 : 1}
                />
                {domW > 46 && (
                  <text
                    x={x1 + domW / 2}
                    y={backboneY + 21}
                    textAnchor="middle"
                    className={`font-sans text-[10px] font-medium ${
                      isDomainActive ? 'fill-blue-800 font-semibold' : 'fill-slate-700'
                    }`}
                  >
                    {dom.name}
                  </text>
                )}
              </g>
            );
          })}

          {/* ClinVar Classified Neighbors for the selected variant */}
          {neighborRefs.map((ref) => {
            const nx = scaleX(ref.aaPos);
            const ny = backboneY + 10;
            const isPath = ref.classification.includes('Pathogenic');
            return (
              <g key={`${ref.clinvarId}-${ref.aaPos}`}>
                <title>
                  {`ClinVar ${ref.classification}: ${ref.hgvs} (aa ${ref.aaPos}, ${ref.clinvarId})`}
                </title>
                <polygon
                  points={`${nx},${ny - 4} ${nx + 4},${ny} ${nx},${ny + 4} ${nx - 4},${ny}`}
                  fill={isPath ? '#E11D48' : '#059669'}
                  stroke="#FFFFFF"
                  strokeWidth={0.8}
                />
              </g>
            );
          })}

          {/* Amino acid coordinate ticks */}
          {ticks.map((t) => {
            const x = scaleX(t);
            return (
              <g key={t}>
                <line
                  x1={x}
                  y1={backboneY + 8}
                  x2={x}
                  y2={backboneY + 12}
                  stroke="#94A3B8"
                  strokeWidth={1}
                />
                <text
                  x={x}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-slate-400 font-mono text-[9px]"
                >
                  {t}
                </text>
              </g>
            );
          })}

          {/* Lollipops for each variant */}
          {geneVariants.map((entry) => {
            const v = entry.variant;
            const cx = scaleX(v.aaPosition ?? 1);
            const cy = scoreToY(entry.priorityScore);
            const isSelected = v.id === selectedVariantId;
            const isHovered = v.id === hoveredId;
            const isConflicting = v.clinvarStatus === 'Conflicting Interpretations';
            const fillColor = isConflicting ? '#D97706' : '#1D4ED8';

            return (
              <g
                key={v.id}
                role="button"
                tabIndex={0}
                aria-label={`Select ${v.hgvsP}, priority ${entry.priorityScore.toFixed(1)}`}
                onClick={() => onSelectVariant(v.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectVariant(v.id);
                  }
                }}
                onMouseEnter={() => setHoveredId(v.id)}
                onMouseLeave={() => setHoveredId(null)}
                className="cursor-pointer focus:outline-none"
              >
                <line
                  x1={cx}
                  y1={backboneY - 8}
                  x2={cx}
                  y2={cy}
                  stroke={isSelected ? '#0F172A' : '#94A3B8'}
                  strokeWidth={isSelected ? 2 : 1.25}
                />
                {isSelected && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={9.5}
                    fill="none"
                    stroke="#0F172A"
                    strokeWidth={1.5}
                  />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={isSelected || isHovered ? 6 : 4.75}
                  fill={fillColor}
                  stroke="#FFFFFF"
                  strokeWidth={1.5}
                />
                {(isSelected || isHovered) && (
                  <text
                    x={cx}
                    y={Math.max(14, cy - 11)}
                    textAnchor="middle"
                    className="fill-slate-900 font-mono text-[10px] font-semibold"
                  >
                    #{entry.rank} {v.hgvsP === 'p.?' ? v.hgvsC : v.hgvsP}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Interactive coordinate readout strip */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
        {activeHover ? (
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tabular-nums">
            <span className="font-semibold text-slate-900">
              Rank #{activeHover.rank} · {activeHover.variant.hgvsP} ({activeHover.variant.hgvsC})
            </span>
            <span>aa {activeHover.variant.aaPosition}</span>
            <span>{activeHover.variant.proteinDomain}</span>
            <span className="text-blue-700 font-semibold">
              Score {activeHover.priorityScore.toFixed(1)}
            </span>
            <span>
              REVEL {activeHover.variant.revelScore !== null ? activeHover.variant.revelScore.toFixed(2) : '—'}
            </span>
          </div>
        ) : (
          <span className="text-[11px] text-slate-500">
            Click any lollipop marker to inspect multi-database evidence in the dossier below.
          </span>
        )}
        <span className="text-[11px] text-slate-500">
          {geneVariants.length} mapped variants in {geneMeta.symbol}
        </span>
      </div>
    </section>
  );
}
