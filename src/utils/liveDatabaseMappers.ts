import type {
  GeneConditionAssociation,
  PubMedArticleRef,
  SimilarVariantRef,
  VariantRecord,
  VariantType,
} from '../types/variant';

export interface ClinGenCurationEntry {
  geneSymbol: string;
  hgncId: string;
  diseaseLabel: string;
  diseaseId: string;
  moi: string;
  classification: 'Definitive' | 'Strong' | 'Moderate' | 'Limited';
  reportUrl: string | null;
  expertPanel: string;
}

export interface MyVariantHit {
  _id?: string;
  clinvar?: {
    variant_id?: number | string;
    rcv?:
      | Array<{
          clinical_significance?: string;
          conditions?: { name?: string } | Array<{ name?: string }>;
          last_evaluated?: string;
          number_submitters?: number;
        }>
      | {
          clinical_significance?: string;
          conditions?: { name?: string } | Array<{ name?: string }>;
          last_evaluated?: string;
          number_submitters?: number;
        };
    hgvs?: {
      coding?: string | string[];
      protein?: string | string[];
    };
    gene?: { symbol?: string } | Array<{ symbol?: string }>;
  };
  gnomad_exome?: { af?: { af?: number; af_popmax?: number } };
  gnomad_genome?: { af?: { af?: number; af_popmax?: number } };
  dbsnp?: { rsid?: string };
  dbnsfp?: {
    genename?: string | string[];
    revel?: { score?: number | number[] };
    sift?: { score?: number | number[] };
    polyphen2?: { hdiv?: { score?: number | number[] } };
    hgvsp?: string | string[];
    hgvsc?: string | string[];
    aapos?: number | number[];
    interpro_domain?: string | string[];
    alphamissense?: {
      am_pathogenicity?: number | number[];
      am_class?: string | string[];
    };
  };
  cadd?: {
    phred?: number | number[];
    consequence?: string | string[];
  };
}

export interface ClassifiedNeighborHit {
  hgvsP: string;
  hgvsC: string;
  aaPos: number;
  classification: 'Pathogenic' | 'Likely Pathogenic';
  clinvarId: string;
  domain: string | null;
}

export function firstScalar<T>(val: T | T[] | undefined | null): T | null {
  if (val === undefined || val === null) return null;
  if (Array.isArray(val)) return val.length > 0 ? val[0] : null;
  return val;
}

export function asString(val: unknown): string {
  const s = firstScalar(val as unknown);
  return typeof s === 'string' ? s : typeof s === 'number' ? String(s) : '';
}

export function asStringList(val: unknown): string[] {
  if (val === undefined || val === null) return [];
  if (Array.isArray(val)) {
    return val
      .map((item) => (typeof item === 'string' ? item : typeof item === 'number' ? String(item) : ''))
      .filter(Boolean);
  }
  if (typeof val === 'string') return [val];
  if (typeof val === 'number') return [String(val)];
  return [];
}

function pickCleanHgvs(raw: unknown, fallback: string): string {
  const items = asStringList(raw);
  if (items.length === 0) return fallback;
  const preferred =
    items.find((s) => /^N[MP]_/i.test(s)) ||
    items.find((s) => /^[cp]\./i.test(s)) ||
    items[0];
  const colonIdx = preferred.indexOf(':');
  return colonIdx !== -1 ? preferred.slice(colonIdx + 1) : preferred;
}

export function extractAaPosFromHgvsP(hgvsP: string): number | null {
  const match = /^p\.[A-Za-z*]{1,3}(\d+)/.exec(hgvsP.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function humanizeDomain(raw: string): string {
  return raw
    .replace(/_dom_sf$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toNumberOrNull(val: unknown): number | null {
  const s = firstScalar(val as number | number[] | null);
  if (typeof s === 'number' && Number.isFinite(s)) return s;
  if (typeof s === 'string') {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function splitCsvRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function normalizeClinGenTier(
  raw: string,
): 'Definitive' | 'Strong' | 'Moderate' | 'Limited' {
  const lower = raw.trim().toLowerCase();
  if (lower.includes('definitive')) return 'Definitive';
  if (lower.includes('strong')) return 'Strong';
  if (lower.includes('moderate')) return 'Moderate';
  return 'Limited';
}

export function clingenTierRank(
  tier: 'Definitive' | 'Strong' | 'Moderate' | 'Limited',
): number {
  switch (tier) {
    case 'Definitive':
      return 4;
    case 'Strong':
      return 3;
    case 'Moderate':
      return 2;
    case 'Limited':
      return 1;
  }
}

export function clingenTierToActionability(
  tier: 'Definitive' | 'Strong' | 'Moderate' | 'Limited',
): number {
  switch (tier) {
    case 'Definitive':
      return 10;
    case 'Strong':
      return 8;
    case 'Moderate':
      return 6;
    case 'Limited':
      return 4;
  }
}

export function parseClinGenValidityCsv(
  csvText: string,
): Map<string, ClinGenCurationEntry[]> {
  const map = new Map<string, ClinGenCurationEntry[]>();
  const lines = csvText.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (
      !line ||
      line.startsWith('"CLINGEN') ||
      line.startsWith('"FILE CREATED') ||
      line.startsWith('"WEBPAGE') ||
      line.startsWith('"+++') ||
      line.startsWith('"GENE SYMBOL"') ||
      line.startsWith('GENE SYMBOL,')
    ) {
      continue;
    }

    const cols = splitCsvRow(line);
    if (cols.length < 7) continue;

    const geneSymbol = (cols[0] || '').toUpperCase();
    if (!geneSymbol || geneSymbol.startsWith('+++')) continue;

    const classification = normalizeClinGenTier(cols[6] || '');
    const entry: ClinGenCurationEntry = {
      geneSymbol,
      hgncId: cols[1] || '',
      diseaseLabel: cols[2] || `${geneSymbol}-associated disorder`,
      diseaseId: cols[3] || '',
      moi: cols[4] || '',
      classification,
      reportUrl: cols[7] && cols[7].startsWith('http') ? cols[7] : null,
      expertPanel: cols[9] || 'ClinGen Gene Curation Expert Panel',
    };

    const existing = map.get(geneSymbol);
    if (existing) {
      existing.push(entry);
    } else {
      map.set(geneSymbol, [entry]);
    }
  }

  return map;
}

export function formatInheritanceLabel(moi: string): string {
  const clean = moi.trim().toUpperCase();
  if (!clean) return 'Curated MOI';
  if (clean === 'AD') return 'Autosomal Dominant';
  if (clean === 'AR') return 'Autosomal Recessive';
  if (clean === 'XLD') return 'X-Linked Dominant';
  if (clean === 'XLR') return 'X-Linked Recessive';
  if (clean === 'XL') return 'X-Linked';
  if (clean === 'SD') return 'Semidominant';
  if (clean === 'MT') return 'Mitochondrial';
  return moi.trim();
}

export function mapClinGenEntriesToConditions(
  entries: ClinGenCurationEntry[] | undefined,
): GeneConditionAssociation[] {
  if (!entries || entries.length === 0) return [];
  const sorted = [...entries].sort((a, b) => {
    const tierDiff = clingenTierRank(b.classification) - clingenTierRank(a.classification);
    if (tierDiff !== 0) return tierDiff;
    const aAd = a.moi.toUpperCase() === 'AD' ? 1 : 0;
    const bAd = b.moi.toUpperCase() === 'AD' ? 1 : 0;
    return bAd - aAd;
  });

  const deduped = new Map<string, GeneConditionAssociation>();
  for (const entry of sorted) {
    const label = entry.diseaseLabel.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const mapped: GeneConditionAssociation = {
      condition: label,
      inheritance: formatInheritanceLabel(entry.moi),
      clingenValidity: entry.classification,
      identifier: entry.diseaseId || undefined,
      reportUrl: entry.reportUrl,
      expertPanel: entry.expertPanel,
    };
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, mapped);
    } else if (!existing.reportUrl && mapped.reportUrl) {
      deduped.set(key, mapped);
    }
  }
  return Array.from(deduped.values());
}

const GENERIC_CLINVAR_CONDITIONS = new Set([
  'not provided',
  'not specified',
  'see cases',
  'inborn genetic diseases',
  'allhighlypenetrant',
]);

export type MyVariantRcv = NonNullable<MyVariantHit['clinvar']>['rcv'];

export function extractAllClinVarConditions(
  rcvInput: MyVariantRcv,
): string[] {
  const rcvList = rcvInput
    ? Array.isArray(rcvInput)
      ? rcvInput
      : [rcvInput]
    : [];

  const deduped = new Map<string, string>();
  for (const rcv of rcvList) {
    const condRaw = rcv?.conditions;
    const condArr = condRaw ? (Array.isArray(condRaw) ? condRaw : [condRaw]) : [];
    for (const c of condArr) {
      const name = asString(c?.name).trim();
      if (!name) continue;
      const lower = name.toLowerCase();
      if (GENERIC_CLINVAR_CONDITIONS.has(lower)) continue;
      if (!deduped.has(lower)) {
        deduped.set(lower, name);
      }
    }
  }
  return Array.from(deduped.values());
}

export function pickBestClinGenCuration(
  entries: ClinGenCurationEntry[] | undefined,
): ClinGenCurationEntry | null {
  if (!entries || entries.length === 0) return null;
  return [...entries].sort((a, b) => {
    const tierDiff = clingenTierRank(b.classification) - clingenTierRank(a.classification);
    if (tierDiff !== 0) return tierDiff;
    const aAd = a.moi.toUpperCase() === 'AD' ? 1 : 0;
    const bAd = b.moi.toUpperCase() === 'AD' ? 1 : 0;
    return bAd - aAd;
  })[0];
}

export function extractClassifiedNeighbors(
  hits: MyVariantHit[],
): ClassifiedNeighborHit[] {
  const out: ClassifiedNeighborHit[] = [];

  for (const hit of hits) {
    const hgvsC = pickCleanHgvs(
      hit.clinvar?.hgvs?.coding ?? hit.dbnsfp?.hgvsc,
      '',
    );
    const hgvsP = pickCleanHgvs(
      hit.clinvar?.hgvs?.protein ?? hit.dbnsfp?.hgvsp,
      '',
    );
    const aaPos = toNumberOrNull(hit.dbnsfp?.aapos) ?? extractAaPosFromHgvsP(hgvsP);
    if (aaPos === null) continue;

    const rcvList = hit.clinvar?.rcv
      ? Array.isArray(hit.clinvar.rcv)
        ? hit.clinvar.rcv
        : [hit.clinvar.rcv]
      : [];
    const sigText = rcvList
      .map((r) => asString(r.clinical_significance).toLowerCase())
      .join(' ');

    const isLikelyPath = sigText.includes('likely pathogenic');
    const isPath = sigText.includes('pathogenic') && !sigText.includes('conflicting');
    if (!isPath && !isLikelyPath) continue;

    const clinvarId = hit.clinvar?.variant_id
      ? `VCV${String(hit.clinvar.variant_id).padStart(9, '0')}`
      : hit._id || 'ClinVar';

    const rawDom = asString(hit.dbnsfp?.interpro_domain);
    const domain = rawDom ? humanizeDomain(rawDom) : null;

    out.push({
      hgvsP: hgvsP || `p.Pos${aaPos}`,
      hgvsC,
      aaPos,
      classification: isLikelyPath && !sigText.includes('pathogenic;') ? 'Likely Pathogenic' : 'Pathogenic',
      clinvarId,
      domain,
    });
  }

  return out;
}

export function computeNearbyClassifiedVariants(
  aaPos: number | null,
  domain: string,
  neighbors: ClassifiedNeighborHit[],
): {
  similarClassifiedVariants: SimilarVariantRef[];
  sameDomainPathogenicCount: number;
} {
  if (neighbors.length === 0) {
    return { similarClassifiedVariants: [], sameDomainPathogenicCount: 0 };
  }

  const normalizedDomain = domain.toLowerCase();
  const sameDomainMatches = neighbors.filter((n) => {
    if (n.domain && normalizedDomain && normalizedDomain !== 'live api annotated') {
      return n.domain.toLowerCase() === normalizedDomain;
    }
    return aaPos !== null && Math.abs(n.aaPos - aaPos) <= 100;
  });

  if (aaPos === null) {
    return {
      similarClassifiedVariants: [],
      sameDomainPathogenicCount: sameDomainMatches.length,
    };
  }

  const seenClinvar = new Set<string>();
  const nearest = neighbors
    .map((n) => ({
      ...n,
      distanceAa: Math.abs(n.aaPos - aaPos),
    }))
    .filter((n) => n.distanceAa <= 60)
    .sort((a, b) => a.distanceAa - b.distanceAa)
    .filter((n) => {
      if (seenClinvar.has(n.clinvarId)) return false;
      seenClinvar.add(n.clinvarId);
      return true;
    })
    .slice(0, 3)
    .map<SimilarVariantRef>((n) => ({
      hgvs: n.hgvsP !== 'p.?' ? n.hgvsP : n.hgvsC || `aa ${n.aaPos}`,
      aaPos: n.aaPos,
      classification: n.classification,
      clinvarId: n.clinvarId,
      distanceAa: n.distanceAa,
    }));

  return {
    similarClassifiedVariants: nearest,
    sameDomainPathogenicCount: sameDomainMatches.length,
  };
}

export interface LiveEnrichmentContext {
  fallbackGene: string;
  clingen: ClinGenCurationEntry | null;
  allGeneConditions?: string[];
  ensemblGeneId: string | null;
  geneInterproDomains: string[];
  pubmedCount: number;
  pubmedArticles: PubMedArticleRef[];
  classifiedNeighbors: ClassifiedNeighborHit[];
}

export function mapMyVariantToRecord(
  hit: MyVariantHit,
  idx: number,
  ctx: LiveEnrichmentContext,
): VariantRecord {
  const geneObj = firstScalar(hit.clinvar?.gene);
  const geneFromClinvar = asString(geneObj?.symbol);
  const geneFromDbnsfp = asString(hit.dbnsfp?.genename);
  const gene = (geneFromClinvar || geneFromDbnsfp || ctx.fallbackGene).toUpperCase();

  const hgvsC = pickCleanHgvs(
    hit.clinvar?.hgvs?.coding ?? hit.dbnsfp?.hgvsc,
    hit._id || `var-${idx + 1}`,
  );
  const hgvsP = pickCleanHgvs(
    hit.clinvar?.hgvs?.protein ?? hit.dbnsfp?.hgvsp,
    'p.?',
  );

  const rcvList = hit.clinvar?.rcv
    ? Array.isArray(hit.clinvar.rcv)
      ? hit.clinvar.rcv
      : [hit.clinvar.rcv]
    : [];

  const sigTexts = rcvList
    .map((r) => asString(r.clinical_significance).toLowerCase())
    .filter(Boolean);
  const hasConflict = sigTexts.some((s) => s.includes('conflict'));
  const hasPath = sigTexts.some(
    (s) => s.includes('pathogenic') && !s.includes('benign'),
  );
  const hasBenign = sigTexts.some((s) => s.includes('benign'));

  const submitterTotal = rcvList.reduce(
    (acc, r) => acc + (typeof r.number_submitters === 'number' ? r.number_submitters : 1),
    0,
  );

  const rcvConditions = extractAllClinVarConditions(hit.clinvar?.rcv);
  const firstCond = rcvConditions[0] || '';

  const af =
    toNumberOrNull(hit.gnomad_exome?.af?.af) ??
    toNumberOrNull(hit.gnomad_genome?.af?.af) ??
    0;
  const afPopmax =
    toNumberOrNull(hit.gnomad_exome?.af?.af_popmax) ??
    toNumberOrNull(hit.gnomad_genome?.af?.af_popmax);

  const clinvarVarId = hit.clinvar?.variant_id
    ? `VCV${String(hit.clinvar.variant_id).padStart(9, '0')}`
    : `MV-${idx + 1}`;

  const aaPos = toNumberOrNull(hit.dbnsfp?.aapos) ?? extractAaPosFromHgvsP(hgvsP);
  const revel = toNumberOrNull(hit.dbnsfp?.revel?.score);
  const cadd = toNumberOrNull(hit.cadd?.phred);
  const sift = toNumberOrNull(hit.dbnsfp?.sift?.score);
  const polyphen = toNumberOrNull(hit.dbnsfp?.polyphen2?.hdiv?.score);
  const amRaw = toNumberOrNull(hit.dbnsfp?.alphamissense?.am_pathogenicity);
  const alphaMissenseScore = amRaw !== null ? Number(amRaw.toFixed(3)) : null;
  const rawAmClass = asString(hit.dbnsfp?.alphamissense?.am_class).toLowerCase();
  const alphaMissenseClass: 'Pathogenic' | 'Ambiguous' | 'Benign' | null =
    alphaMissenseScore !== null
      ? rawAmClass.includes('pathogenic') || alphaMissenseScore >= 0.564
        ? 'Pathogenic'
        : rawAmClass.includes('benign') || alphaMissenseScore < 0.34
          ? 'Benign'
          : 'Ambiguous'
      : null;

  const hitDomain = asString(hit.dbnsfp?.interpro_domain);
  const rawDomain =
    hitDomain ||
    (ctx.geneInterproDomains.length > 0
      ? ctx.geneInterproDomains[0]
      : 'InterPro Unmapped');
  const proteinDomain = humanizeDomain(rawDomain);

  const rawConsequence = asStringList(hit.cadd?.consequence)
    .join(' ')
    .toUpperCase();
  const variantType: VariantType = rawConsequence.includes('SPLICE')
    ? 'Splice Region'
    : rawConsequence.includes('STOP_GAINED') || rawConsequence.includes('FRAMESHIFT')
      ? 'Truncating VUS'
      : rawConsequence.includes('INFRAME')
        ? 'In-frame Indel'
        : /\bSYNONYMOUS\b/.test(rawConsequence) && !rawConsequence.includes('NON_SYNONYMOUS')
          ? 'Synonymous'
          : 'Missense';

  const { similarClassifiedVariants, sameDomainPathogenicCount } =
    computeNearbyClassifiedVariants(aaPos, proteinDomain, ctx.classifiedNeighbors);

  const functionalStatus = ctx.pubmedCount > 0 ? 'Preliminary' : 'None';

  const clingenValidity = ctx.clingen?.classification ?? 'Moderate';
  const clingenActionabilityScore = ctx.clingen
    ? clingenTierToActionability(ctx.clingen.classification)
    : 6;

  const primaryDisease =
    ctx.clingen?.diseaseLabel ||
    firstCond ||
    `${gene}-associated phenotype`;

  const conditionMap = new Map<string, string>();
  for (const cond of [
    primaryDisease,
    ...(ctx.allGeneConditions ?? []),
    ...rcvConditions,
  ]) {
    const clean = cond.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!conditionMap.has(key)) {
      conditionMap.set(key, clean);
    }
  }
  const associatedConditions = Array.from(conditionMap.values());

  return {
    id: `live-${(hit._id || clinvarVarId).replace(/[^a-zA-Z0-9_-]/g, '')}-${idx}`,
    gene,
    hgvsC,
    hgvsP,
    rsId: hit.dbsnp?.rsid ?? null,
    clinvarId: clinvarVarId,
    variantType,
    aaPosition: aaPos,
    proteinDomain,
    gnomadAf: typeof af === 'number' && Number.isFinite(af) ? af : 0,
    gnomadPopMaxLabel:
      afPopmax !== null && afPopmax > 0
        ? `PopMax ${afPopmax.toExponential(2)}`
        : typeof af === 'number' && af > 0
          ? `gnomAD ${af.toExponential(2)}`
          : 'Absent / Low AF',
    clinvarStatus: hasConflict ? 'Conflicting Interpretations' : 'Uniform VUS',
    clinvarSubmissions: {
      total: Math.max(1, submitterTotal),
      vus: Math.max(
        1,
        rcvList.filter((r) =>
          (r.clinical_significance || '').toLowerCase().includes('uncertain'),
        ).length,
      ),
      lpOrP: hasPath ? 1 : 0,
      lbOrB: hasBenign ? 1 : 0,
    },
    clinvarLastEvaluated: rcvList[0]?.last_evaluated || 'ClinVar Live',
    functionalStatus,
    pubmedCount: ctx.pubmedCount,
    pubmedIds: ctx.pubmedArticles.map((a) => a.pmid),
    pubmedArticles: ctx.pubmedArticles,
    functionalSummary:
      ctx.pubmedArticles.length > 0
        ? `Found ${ctx.pubmedCount} PubMed VUS/functional references for ${gene} (latest: ${ctx.pubmedArticles[0].title}).`
        : `No VUS functional assay abstracts returned in PubMed query for ${gene}; annotated via ClinVar, gnomAD & dbNSFP.`,
    revelScore: revel !== null ? Number(revel.toFixed(3)) : null,
    caddPhred: cadd !== null ? Number(cadd.toFixed(1)) : null,
    siftScore: sift !== null ? Number(sift.toFixed(3)) : null,
    polyphenScore: polyphen !== null ? Number(polyphen.toFixed(3)) : null,
    alphaMissenseScore,
    alphaMissenseClass,
    similarClassifiedVariants,
    sameDomainPathogenicCount,
    sameDomainBenignCount: 0,
    diseaseAssociation: primaryDisease,
    associatedConditions,
    clingenValidity,
    clingenActionabilityScore,
    clingenReportUrl: ctx.clingen?.reportUrl ?? null,
    clingenExpertPanel: ctx.clingen?.expertPanel ?? null,
    ensemblGeneId: ctx.ensemblGeneId,
    sequencingFormat: 'Live API',
    evaluationTruth: 'unvalidated',
    evaluationNote:
      'Retrieved dynamically from MyVariant.info (ClinVar + gnomAD + dbNSFP + CADD), NCBI PubMed, ClinGen, and MyGene/Ensembl.',
    sourceType: 'live_api',
  };
}
