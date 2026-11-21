import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  History,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { EXTENDED_GENE_METADATA } from '../data/extendedGenomes';
import { GENE_METADATA } from '../data/genes';
import type {
  GeneConditionAssociation,
  GeneMetadata,
  ReclassificationEvent,
  ScoredVariant,
  VariantRecord,
} from '../types/variant';
import {
  buildDefaultReclassificationTimeline,
  evaluateAcmgCriteria,
  type AcmgRuleOverrides,
} from '../utils/acmgAutomation';
import { formatAf, getVariantConditions } from '../utils/prioritisation';

interface VariantDossierProps {
  scoredVariant: ScoredVariant | null;
  liveGeneMeta?: Record<string, GeneMetadata>;
  activeConditionFilter?: string;
  onSelectCondition?: (condition: string) => void;
  onRefreshLive?: (variant: VariantRecord) => void;
  isRefreshingLive?: boolean;
  acmgOverrides?: AcmgRuleOverrides;
  onToggleAcmgRule?: (variantId: string, code: string, nextActive: boolean) => void;
  onResetAcmgRules?: (variantId: string) => void;
  onAddReclassificationNote?: (
    variantId: string,
    event: Omit<ReclassificationEvent, 'id'>,
  ) => void;
}

const ACMG_BADGE_STYLE: Record<string, string> = {
  Pathogenic: 'border-rose-300 bg-rose-50 text-rose-800',
  'Likely Pathogenic': 'border-rose-200 bg-rose-50/70 text-rose-700',
  'Hot VUS': 'border-amber-300 bg-amber-50 text-amber-800',
  VUS: 'border-slate-300 bg-slate-100 text-slate-700',
  'Likely Benign': 'border-emerald-200 bg-emerald-50/70 text-emerald-700',
  Benign: 'border-emerald-300 bg-emerald-50 text-emerald-800',
};

export function VariantDossier({
  scoredVariant,
  liveGeneMeta,
  activeConditionFilter = 'ALL',
  onSelectCondition,
  onRefreshLive,
  isRefreshingLive = false,
  acmgOverrides = {},
  onToggleAcmgRule,
  onResetAcmgRules,
  onAddReclassificationNote,
}: VariantDossierProps) {
  const [noteTitle, setNoteTitle] = useState('');
  const [noteDetail, setNoteDetail] = useState('');
  const [noteDirection, setNoteDirection] =
    useState<ReclassificationEvent['impactDirection']>('up');
  const [showAllCriteria, setShowAllCriteria] = useState(false);
  const [copiedNote, setCopiedNote] = useState(false);

  if (!scoredVariant) {
    return (
      <section className="border border-slate-200 bg-white rounded-md p-6 text-center text-xs text-slate-500">
        Select any variant row from the table above to inspect its multi-database evidence dossier.
      </section>
    );
  }

  const { variant: v, rank, priorityScore, contributions } = scoredVariant;
  const acmg = evaluateAcmgCriteria(v, acmgOverrides);
  const timeline = buildDefaultReclassificationTimeline(v, acmg);
  const hasManualOverrides = Object.keys(acmgOverrides).length > 0;
  const variantLinkedKeys = new Set(
    getVariantConditions(v, liveGeneMeta).map((c) => c.trim().toLowerCase()),
  );

  const clinvarNumeric = v.clinvarId.replace(/^VCV0*/i, '');
  const clinvarUrl = v.clinvarId.startsWith('VCV')
    ? `https://www.ncbi.nlm.nih.gov/clinvar/variation/${encodeURIComponent(clinvarNumeric)}/`
    : `https://www.ncbi.nlm.nih.gov/clinvar/?term=${encodeURIComponent(`${v.gene} ${v.hgvsC}`)}`;
  const gnomadUrl = v.rsId
    ? `https://gnomad.broadinstitute.org/variant/${encodeURIComponent(v.rsId)}?dataset=gnomad_r4`
    : `https://gnomad.broadinstitute.org/gene/${encodeURIComponent(v.gene)}?dataset=gnomad_r4`;
  const ensemblUrl = v.ensemblGeneId
    ? `https://www.ensembl.org/Homo_sapiens/Gene/Summary?g=${encodeURIComponent(v.ensemblGeneId)}`
    : `https://www.ensembl.org/Homo_sapiens/Search/Results?q=${encodeURIComponent(v.gene)}`;
  const rawClingenUrl =
    v.clingenReportUrl ||
    `https://search.clinicalgenome.org/kb/genes?search=${encodeURIComponent(v.gene)}`;
  const clingenUrl = rawClingenUrl.startsWith('https://')
    ? rawClingenUrl
    : `https://search.clinicalgenome.org/kb/genes?search=${encodeURIComponent(v.gene)}`;

  const handleCopyLabNote = async () => {
    const activeRules = acmg.criteria
      .filter((c) => c.active)
      .map((c) => c.code)
      .join(', ');
    const note = [
      `VUScope Curation Summary — ${v.gene} ${v.hgvsC} (${v.hgvsP})`,
      `Priority Score: ${priorityScore.toFixed(1)}/100 (Rank #${rank}) | ACMG: ${acmg.classification} (${acmg.netPoints >= 0 ? `+${acmg.netPoints}` : acmg.netPoints} pts${activeRules ? `: ${activeRules}` : ''})`,
      `ClinVar: ${v.clinvarId} (${v.clinvarStatus}; last eval ${v.clinvarLastEvaluated})`,
      `gnomAD v4 AF: ${formatAf(v.gnomadAf)} (${v.gnomadPopMaxLabel})`,
      `In Silico: REVEL=${v.revelScore ?? 'NA'}, AlphaMissense=${v.alphaMissenseScore ?? 'NA'}, CADD=${v.caddPhred ?? 'NA'}`,
      `Functional: ${v.functionalStatus} (${v.pubmedCount} refs) — ${v.functionalSummary}`,
      `Condition: ${v.diseaseAssociation} (ClinGen ${v.clingenValidity})`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(note);
      setCopiedNote(true);
      window.setTimeout(() => setCopiedNote(false), 2000);
    } catch {
      // Clipboard blocked in restricted headless context
    }
  };

  const visibleCriteria = showAllCriteria
    ? acmg.criteria
    : acmg.criteria.filter(
        (c) =>
          c.active ||
          c.autoTriggered ||
          ['PVS1', 'PS3', 'PM1', 'PM2_Supporting', 'PM5', 'PP3', 'BA1', 'BS1', 'BS3', 'BP4'].includes(
            c.code,
          ),
      );

  const handleSubmitNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAddReclassificationNote) return;
    const cleanTitle = noteTitle.trim();
    const cleanDetail = noteDetail.trim();
    if (!cleanTitle) return;
    onAddReclassificationNote(v.id, {
      date: new Date().toISOString().slice(0, 10),
      source: 'Lab Update',
      title: cleanTitle,
      detail: cleanDetail || 'Logged during VUScope reassessment review.',
      impactDirection: noteDirection,
    });
    setNoteTitle('');
    setNoteDetail('');
  };

  return (
    <section
      aria-label="Selected variant evidence dossier"
      className="scroll-mt-20 border border-slate-200 bg-white rounded-md overflow-hidden"
    >
      {/* Dossier Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-slate-50/70 px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
            <span>
              Selected Variant Dossier · Rank #{rank} ·{' '}
              {v.sourceType === 'live_api'
                ? 'Live API Record'
                : v.sourceType === 'imported'
                  ? 'Imported Record'
                  : 'Curated Benchmark Cohort'}
            </span>
            <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
              Pipeline: {v.sequencingFormat ?? (v.sourceType === 'live_api' ? 'Live API' : v.sourceType === 'imported' ? 'Imported' : 'Curated')}
            </span>
            <span
              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                ACMG_BADGE_STYLE[acmg.classification] ?? ACMG_BADGE_STYLE.VUS
              }`}
            >
              ACMG: {acmg.classification} ({acmg.netPoints >= 0 ? `+${acmg.netPoints}` : acmg.netPoints} pts)
            </span>
          </div>
          <h3 className="mt-1 text-lg font-bold text-slate-900">
            <span className="font-mono">{v.gene}</span>{' '}
            <span>{v.hgvsP !== 'p.?' ? v.hgvsP : v.hgvsC}</span>
            <span className="ml-2 font-mono text-sm font-normal text-slate-500">
              ({v.hgvsC})
            </span>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span>{v.variantType}</span>
            <span aria-hidden="true">·</span>
            <span>Domain: {v.proteinDomain}</span>
            {v.rsId && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{v.rsId}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <a
              href={clinvarUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-blue-700 hover:underline"
            >
              <span>{v.clinvarId}</span>
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
            <span aria-hidden="true">·</span>
            <a
              href={gnomadUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-blue-700 hover:underline"
            >
              <span>gnomAD</span>
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
            <span aria-hidden="true">·</span>
            <a
              href={ensemblUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-blue-700 hover:underline"
            >
              <span>{v.ensemblGeneId ? `Ensembl (${v.ensemblGeneId})` : 'Ensembl'}</span>
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
            <span aria-hidden="true">·</span>
            <a
              href={clingenUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-blue-700 hover:underline"
            >
              <span>ClinGen</span>
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-2.5">
          <button
            type="button"
            onClick={() => void handleCopyLabNote()}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-700 hover:text-blue-700 cursor-pointer whitespace-nowrap"
          >
            {copiedNote ? (
              <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{copiedNote ? 'Copied Lab Note' : 'Copy Lab Note'}</span>
          </button>
          {onRefreshLive && (
            <button
              type="button"
              disabled={isRefreshingLive}
              onClick={() => onRefreshLive(v)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-700 hover:text-blue-700 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefreshingLive ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{isRefreshingLive ? 'Syncing...' : 'Sync Tool Record'}</span>
            </button>
          )}
          <div className="text-right pl-1">
            <div className="text-[11px] font-semibold text-slate-500">
              RESEARCH PRIORITY SCORE
            </div>
            <div className="font-mono text-3xl font-bold text-blue-700 tabular-nums">
              {priorityScore.toFixed(1)}
              <span className="ml-1 text-xs font-normal text-slate-400">/ 100</span>
            </div>
          </div>
        </div>
      </div>

      {/* ACMG/AMP Guideline Automation & Structured Curation */}
      <div className="border-b border-slate-200 px-5 py-4 bg-white space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-700" aria-hidden="true" />
            <h4 className="text-xs font-semibold text-slate-900">
              ACMG/AMP Guideline Automation &amp; Bayesian Curation
            </h4>
            {acmg.isHotVus && (
              <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                Hot VUS · {acmg.pointsToLikelyPathogenic} pt{acmg.pointsToLikelyPathogenic === 1 ? '' : 's'} from Likely Pathogenic (6 pts)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAllCriteria((prev) => !prev)}
              className="text-[11px] font-medium text-slate-600 hover:text-blue-700 cursor-pointer"
            >
              {showAllCriteria ? 'Compact Rules' : `All ${acmg.criteria.length} Rules`}
            </button>
            {hasManualOverrides && onResetAcmgRules && (
              <button
                type="button"
                onClick={() => onResetAcmgRules(v.id)}
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:border-blue-700 hover:text-blue-700 cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                <span>Reset Auto Rules</span>
              </button>
            )}
          </div>
        </div>

        {/* Bayesian Points Scale */}
        <div className="rounded border border-slate-200 bg-slate-50/70 px-3 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="text-slate-700">{acmg.summary}</div>
          <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums">
            <span className="text-rose-700 font-semibold">
              Pathogenic: +{acmg.pathogenicPoints}
            </span>
            <span className="text-emerald-700 font-semibold">
              Benign: {acmg.benignPoints}
            </span>
            <span className="font-bold text-slate-900">
              Net: {acmg.netPoints >= 0 ? `+${acmg.netPoints}` : acmg.netPoints} / 10
            </span>
          </div>
        </div>

        {/* Interactive Criterion Toggles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {visibleCriteria.map((criterion) => {
            const isOverridden = acmgOverrides[criterion.code] !== undefined;
            const activeClass =
              criterion.direction === 'pathogenic'
                ? 'border-rose-300 bg-rose-50/70 text-rose-900'
                : 'border-emerald-300 bg-emerald-50/70 text-emerald-900';
            const inactiveClass =
              'border-slate-200 bg-white text-slate-600 hover:border-slate-300';

            return (
              <button
                key={criterion.code}
                type="button"
                aria-pressed={criterion.active}
                disabled={!onToggleAcmgRule}
                onClick={() =>
                  onToggleAcmgRule?.(v.id, criterion.code, !criterion.active)
                }
                title={criterion.rationale}
                className={`rounded border px-2.5 py-2 text-left transition-colors ${
                  criterion.active ? activeClass : inactiveClass
                } ${onToggleAcmgRule ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold">
                    {criterion.code}
                    {isOverridden && (
                      <span className="ml-1 text-[10px] font-normal text-blue-700">
                        (manual)
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[11px] font-semibold tabular-nums">
                    {criterion.points > 0 ? `+${criterion.points}` : criterion.points} pt ·{' '}
                    {criterion.active ? 'ON' : 'OFF'}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] font-medium truncate">
                  {criterion.label}
                </div>
                <div className="mt-0.5 text-[10px] opacity-80 line-clamp-2">
                  {criterion.rationale}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Transparent Mathematical Score Breakdown */}
      <div className="border-b border-slate-200 px-5 py-4">
        <h4 className="text-xs font-semibold text-slate-900 mb-2.5">
          Transparent Priority Score Decomposition
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                <th className="py-1.5 pr-3 text-left font-medium">Factor</th>
                <th className="py-1.5 px-3 text-right font-medium">Sub-Score (0–1)</th>
                <th className="py-1.5 px-3 text-right font-medium">Active Weight</th>
                <th className="py-1.5 px-3 text-right font-medium">Points Added</th>
                <th className="py-1.5 pl-3 text-left font-medium">Empirical Rationale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contributions.map((c) => (
                <tr key={c.key}>
                  <td className="py-2 pr-3 font-medium text-slate-800 whitespace-nowrap">
                    {c.label}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                    {c.rawSubscore.toFixed(2)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-500">
                    {(c.normalizedWeight * 100).toFixed(1)}%
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                    +{c.weightedPoints.toFixed(2)}
                  </td>
                  <td className="py-2 pl-3 text-slate-600">{c.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Multi-Database Evidence Grid (6 integrated resources) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 divide-y md:divide-y-0 md:grid-flow-row border-b border-slate-200">
        {/* ClinVar */}
        <div className="p-4 border-b border-slate-200 md:border-r">
          <div className="text-[11px] font-semibold text-slate-500">
            CLINVAR INTERPRETATIONS
          </div>
          <div className="mt-1.5 text-sm font-semibold text-slate-900">
            {v.clinvarStatus}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
            <div>
              <div className="text-[10px] text-slate-400">VUS</div>
              <div className="font-semibold text-slate-800">{v.clinvarSubmissions.vus}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">LP / P</div>
              <div className="font-semibold text-amber-700">{v.clinvarSubmissions.lpOrP}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">LB / B</div>
              <div className="font-semibold text-slate-600">{v.clinvarSubmissions.lbOrB}</div>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            Last evaluated: {v.clinvarLastEvaluated}
          </div>
        </div>

        {/* gnomAD v4 */}
        <div className="p-4 border-b border-slate-200 xl:border-r">
          <div className="text-[11px] font-semibold text-slate-500">
            GNOMAD v4 POPULATION FREQUENCY
          </div>
          <div className="mt-1.5 font-mono text-lg font-semibold text-slate-900 tabular-nums">
            {formatAf(v.gnomadAf)}
          </div>
          <div className="mt-1 text-xs text-slate-600">
            PopMax: <span className="font-mono">{v.gnomadPopMaxLabel}</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            Population prevalence informs penetrance bounds and cohort impact.
          </div>
        </div>

        {/* dbNSFP / Ensembl VEP / AlphaMissense */}
        <div className="p-4 border-b border-slate-200">
          <div className="text-[11px] font-semibold text-slate-500">
            dbNSFP, VEP &amp; ALPHAMISSENSE SCORES
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs tabular-nums">
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 whitespace-nowrap">REVEL</span>
              <span className="font-semibold text-slate-900 whitespace-nowrap">
                {v.revelScore !== null ? v.revelScore.toFixed(3) : '—'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 whitespace-nowrap">AlphaMissense</span>
              <span
                className={`font-semibold whitespace-nowrap ${
                  (v.alphaMissenseScore ?? 0) >= 0.564
                    ? 'text-rose-700'
                    : (v.alphaMissenseScore ?? 1) < 0.34
                      ? 'text-emerald-700'
                      : 'text-slate-900'
                }`}
              >
                {v.alphaMissenseScore !== undefined && v.alphaMissenseScore !== null
                  ? v.alphaMissenseScore.toFixed(3)
                  : '—'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 whitespace-nowrap">CADD</span>
              <span className="font-semibold text-slate-900 whitespace-nowrap">
                {v.caddPhred !== null ? v.caddPhred.toFixed(1) : '—'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 whitespace-nowrap">PolyPhen</span>
              <span className="font-semibold text-slate-900 whitespace-nowrap">
                {v.polyphenScore !== null ? v.polyphenScore.toFixed(3) : '—'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 whitespace-nowrap">SIFT</span>
              <span className="font-semibold text-slate-900 whitespace-nowrap">
                {v.siftScore !== null ? v.siftScore.toFixed(2) : '—'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 whitespace-nowrap">AM Class</span>
              <span className="font-semibold text-slate-700 whitespace-nowrap">
                {v.alphaMissenseClass ?? '—'}
              </span>
            </div>
          </div>
        </div>

        {/* PubMed Functional Evidence */}
        <div className="p-4 border-b md:border-b-0 md:border-r border-slate-200">
          <div className="text-[11px] font-semibold text-slate-500">
            PUBMED &amp; FUNCTIONAL ASSAYS
          </div>
          <div className="mt-1.5 text-sm font-semibold text-slate-900">
            {v.functionalStatus === 'None'
              ? 'No Published Functional Study'
              : `${v.functionalStatus} (${v.pubmedCount} citations)`}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            {v.functionalSummary}
          </p>
          {v.pubmedArticles && v.pubmedArticles.length > 0 ? (
            <ul className="mt-2 space-y-1 text-[11px]">
              {v.pubmedArticles.slice(0, 3).map((art) => (
                <li key={art.pmid} className="truncate">
                  <a
                    href={`https://pubmed.ncbi.nlm.nih.gov/${art.pmid}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-700 hover:underline"
                    title={art.title}
                  >
                    <span className="font-mono">PMID:{art.pmid}</span> — {art.title}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            v.pubmedIds.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-mono">
                {v.pubmedIds.map((pmid) => (
                  <a
                    key={pmid}
                    href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-700 hover:underline"
                  >
                    PMID:{pmid}
                  </a>
                ))}
              </div>
            )
          )}
        </div>

        {/* Similar Classified Variants */}
        <div className="p-4 border-b md:border-b-0 xl:border-r border-slate-200">
          <div className="text-[11px] font-semibold text-slate-500">
            CLASSIFICATION OF SIMILAR VARIANTS
          </div>
          <div className="mt-1.5 text-xs text-slate-700">
            Domain context ({v.proteinDomain}):{' '}
            <span className="font-mono font-semibold text-rose-700">
              {v.sameDomainPathogenicCount} P/LP
            </span>{' '}
            /{' '}
            <span className="font-mono text-slate-600">
              {v.sameDomainBenignCount} B/LB
            </span>
          </div>
          {v.similarClassifiedVariants.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs">
              {v.similarClassifiedVariants.map((sim) => {
                const simNum = sim.clinvarId.replace(/^VCV0*/i, '');
                const simUrl = sim.clinvarId.startsWith('VCV')
                  ? `https://www.ncbi.nlm.nih.gov/clinvar/variation/${simNum}/`
                  : `https://www.ncbi.nlm.nih.gov/clinvar/?term=${encodeURIComponent(`${v.gene} ${sim.hgvs}`)}`;
                return (
                  <li
                    key={sim.clinvarId}
                    className="flex items-center justify-between gap-2 text-slate-700"
                  >
                    <a
                      href={simUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-blue-700 hover:underline"
                    >
                      <span>
                        {sim.hgvs} ({sim.distanceAa === 0 ? 'same codon' : `±${sim.distanceAa} aa`})
                      </span>
                      <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
                    </a>
                    <span
                      className={
                        sim.classification.includes('Pathogenic')
                          ? 'font-semibold text-rose-700'
                          : 'text-slate-600'
                      }
                    >
                      {sim.classification}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              No proximal classified variants curated at this residue.
            </p>
          )}
        </div>

        {/* ClinGen & Variant-Linked vs Gene Spectrum Conditions */}
        {(() => {
          const geneMeta =
            GENE_METADATA[v.gene] ??
            EXTENDED_GENE_METADATA[v.gene] ??
            liveGeneMeta?.[v.gene];
          const conditionList: GeneConditionAssociation[] = [];
          const seen = new Set<string>();

          for (const condStr of [v.diseaseAssociation, ...(v.associatedConditions ?? [])]) {
            const clean = condStr.trim();
            if (!clean) continue;
            const key = clean.toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);
              const detail = geneMeta?.conditionDetails?.find(
                (d) => d.condition.toLowerCase() === key,
              );
              conditionList.push(
                detail ?? {
                  condition: clean,
                  inheritance: geneMeta?.inheritance || 'Curated / ClinVar',
                  clingenValidity: v.clingenValidity,
                },
              );
            }
          }

          for (const detail of geneMeta?.conditionDetails ?? []) {
            const key = detail.condition.trim().toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);
              conditionList.push(detail);
            }
          }

          for (const condStr of geneMeta?.primaryConditions ?? []) {
            const clean = condStr.trim();
            if (!clean) continue;
            const key = clean.toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);
              conditionList.push({
                condition: clean,
                inheritance: geneMeta?.inheritance || 'Curated / ClinVar',
                clingenValidity: v.clingenValidity,
              });
            }
          }

          return (
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="text-[11px] font-semibold text-slate-500">
                  GENE CONDITIONS &amp; CLINGEN SPECTRUM ({conditionList.length})
                </div>
                <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-slate-500 tabular-nums">
                  {v.clingenValidity} · {v.clingenActionabilityScore}/12
                </span>
              </div>
              <ul className="mt-2 space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {conditionList.map((item) => {
                  const isActive =
                    activeConditionFilter !== 'ALL' &&
                    activeConditionFilter.toLowerCase() === item.condition.toLowerCase();
                  const isVariantLinked = variantLinkedKeys.has(
                    item.condition.trim().toLowerCase(),
                  );
                  return (
                    <li
                      key={item.condition}
                      className={`rounded border px-2.5 py-1.5 text-xs ${
                        isVariantLinked
                          ? 'border-blue-200 bg-blue-50/40'
                          : 'border-slate-100 bg-slate-50/70'
                      }`}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {onSelectCondition ? (
                            <button
                              type="button"
                              onClick={() =>
                                onSelectCondition(isActive ? 'ALL' : item.condition)
                              }
                              className={`text-left font-semibold hover:underline cursor-pointer ${
                                isActive ? 'text-blue-700' : 'text-slate-900'
                              }`}
                            >
                              {item.condition}
                            </button>
                          ) : (
                            <span className="font-semibold text-slate-900">
                              {item.condition}
                            </span>
                          )}
                          <span
                            className={`rounded border px-1 py-0 text-[9px] font-semibold uppercase ${
                              isVariantLinked
                                ? 'border-blue-200 bg-white text-blue-700'
                                : 'border-slate-200 bg-white text-slate-500'
                            }`}
                          >
                            {isVariantLinked ? 'Variant-Linked' : 'Gene Spectrum'}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] text-slate-500">
                          {item.clingenValidity}
                          {item.identifier ? ` · ${item.identifier}` : ''}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-600">
                        <span>{item.inheritance}</span>
                        {item.clinicalSpectrumNote && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span>{item.clinicalSpectrumNote}</span>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {v.clingenExpertPanel && (
                <div className="mt-2 text-[11px] text-slate-500">
                  Panel: {v.clingenExpertPanel} · Research prioritisation only.
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Evidence Aggregation & Reclassification Tracking Timeline */}
      <div className="px-5 py-4 bg-slate-50/40 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-slate-700" aria-hidden="true" />
            <h4 className="text-xs font-semibold text-slate-900">
              Evidence Aggregation &amp; Reclassification Tracking ({timeline.length} events)
            </h4>
          </div>
          <span className="text-[11px] text-slate-500">
            Tracks computational scores, literature, ClinVar updates &amp; lab reassessments
          </span>
        </div>

        <ol className="space-y-2">
          {timeline.map((evt) => (
            <li
              key={evt.id}
              className="flex flex-wrap items-start justify-between gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                    {evt.date}
                  </span>
                  <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0 text-[10px] font-semibold text-slate-700">
                    {evt.source}
                  </span>
                  <span className="font-semibold text-slate-900">{evt.title}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-600">{evt.detail}</p>
              </div>
              <span
                className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                  evt.impactDirection === 'up'
                    ? 'border-rose-200 bg-rose-50 text-rose-700'
                    : evt.impactDirection === 'down'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-slate-50 text-slate-600'
                }`}
              >
                {evt.impactDirection === 'up'
                  ? 'Escalates'
                  : evt.impactDirection === 'down'
                    ? 'Mitigates'
                    : 'Neutral'}
              </span>
            </li>
          ))}
        </ol>

        {onAddReclassificationNote && (
          <form
            onSubmit={handleSubmitNote}
            className="rounded border border-slate-200 bg-white p-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-end"
          >
            <div className="sm:col-span-4">
              <label
                htmlFor="reclass-note-title"
                className="block text-[10px] font-medium text-slate-500 mb-0.5"
              >
                Log Lab Reassessment Update
              </label>
              <input
                id="reclass-note-title"
                type="text"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder="e.g. Segregation confirmed in proband kindred"
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-4">
              <label
                htmlFor="reclass-note-detail"
                className="block text-[10px] font-medium text-slate-500 mb-0.5"
              >
                Evidence Detail (optional)
              </label>
              <input
                id="reclass-note-detail"
                type="text"
                value={noteDetail}
                onChange={(e) => setNoteDetail(e.target.value)}
                placeholder="Assay / family / ClinVar accession detail"
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor="reclass-note-direction"
                className="block text-[10px] font-medium text-slate-500 mb-0.5"
              >
                Impact
              </label>
              <select
                id="reclass-note-direction"
                value={noteDirection}
                onChange={(e) =>
                  setNoteDirection(
                    e.target.value as ReclassificationEvent['impactDirection'],
                  )
                }
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 focus:border-blue-700 focus:outline-none"
              >
                <option value="up">Escalates</option>
                <option value="neutral">Neutral</option>
                <option value="down">Mitigates</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={!noteTitle.trim()}
                className="w-full inline-flex items-center justify-center gap-1 rounded bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-40 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Log Event</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
