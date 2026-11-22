import type { VariantRecord, VariantType } from '../types/variant.js';
import { evaluateAcmgCriteria } from './acmgAutomation.js';

export function parseBulkLookupInput(rawText: string): string[] {
  const lines = rawText
    .split(/\r?\n|[,;]+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 2 && !line.startsWith('#'));

  const seen = new Set<string>();
  const unique: string[] = [];

  for (const item of lines) {
    const normalized = item.replace(/\s+/g, ' ');
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(normalized);
    }
  }
  return unique.slice(0, 25);
}

export type PipelineFormat = 'vcf' | 'cma' | 'tsv';

export function detectPipelineFormat(rawText: string): PipelineFormat {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (
    lines.some(
      (l) =>
        l.startsWith('##fileformat=VCF') ||
        l.startsWith('#CHROM') ||
        /^(?:chr)?[0-9XYM]+\t\d+\t\S+\t[ACGTN]+\t[ACGTN.,]+/i.test(l),
    )
  ) {
    return 'vcf';
  }

  if (
    lines.some(
      (l) =>
        l.toLowerCase().includes('cnv') ||
        l.toLowerCase().includes('svtype') ||
        l.toLowerCase().includes('copy_number') ||
        /^(?:chr)?[0-9XYM]+\t\d+\t\d+\t[A-Z0-9-]+\t(DEL|DUP|LOSS|GAIN|CNV)/i.test(l),
    )
  ) {
    return 'cma';
  }

  return 'tsv';
}

function parseInfoTag(info: string, key: string): string | null {
  const regex = new RegExp(`(?:^|;)${key}=([^;]+)`, 'i');
  const match = regex.exec(info);
  return match ? decodeURIComponent(match[1]).trim() : null;
}

function mapVcfConsequence(raw: string | null): VariantType {
  const lower = (raw ?? '').toLowerCase();
  if (lower.includes('splice')) return 'Splice Region';
  if (lower.includes('stop_gained') || lower.includes('frameshift') || lower.includes('nonsense')) {
    return 'Truncating VUS';
  }
  if (lower.includes('inframe')) return 'In-frame Indel';
  if (lower.includes('synonymous')) return 'Synonymous';
  if (lower.includes('utr') || lower.includes('regulatory')) return 'Regulatory / UTR';
  return 'Missense';
}

function deriveAlphaMissenseClass(score: number | null): 'Pathogenic' | 'Ambiguous' | 'Benign' | null {
  if (score === null) return null;
  if (score >= 0.564) return 'Pathogenic';
  if (score < 0.34) return 'Benign';
  return 'Ambiguous';
}

export function parseVcfVariants(
  rawText: string,
  seqOrigin: 'WES' | 'WGS' = 'WES',
): { variants: VariantRecord[]; errors: string[] } {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('##'));

  const variants: VariantRecord[] = [];
  const errors: string[] = [];
  let rowNum = 0;

  for (const line of lines) {
    if (line.startsWith('#CHROM')) continue;
    rowNum += 1;
    const cols = line.split(/\t|\s{2,}/).map((c) => c.trim());
    if (cols.length < 5) {
      errors.push(`VCF row ${rowNum}: expected at least 5 columns (CHROM POS ID REF ALT).`);
      continue;
    }

    const [chrom, pos, idCol, ref, alt, , filterCol = 'PASS', info = ''] = cols;
    const gene = (parseInfoTag(info, 'GENE') ?? parseInfoTag(info, 'SYMBOL') ?? 'UNKNOWN').toUpperCase();
    if (gene === 'UNKNOWN') {
      errors.push(`VCF row ${rowNum} (${chrom}:${pos}): missing GENE= tag in INFO field.`);
      continue;
    }

    const hgvsC =
      parseInfoTag(info, 'HGVSC') ??
      `g.${chrom.replace(/^chr/i, '')}:${pos}${ref}>${alt}`;
    const hgvsP = parseInfoTag(info, 'HGVSP') ?? 'p.?';
    const rawDomain = parseInfoTag(info, 'DOMAIN');
    const domain = rawDomain
      ? rawDomain.replace(/_+/g, ' ').trim()
      : 'Exome / Genome Annotated';
    const rawConseq = parseInfoTag(info, 'CSQ') ?? parseInfoTag(info, 'CONSEQUENCE');
    const variantType = mapVcfConsequence(rawConseq);

    const afRaw = Number(parseInfoTag(info, 'AF') ?? parseInfoTag(info, 'GNOMAD_AF') ?? '0');
    const gnomadAf = Number.isFinite(afRaw) && afRaw >= 0 ? afRaw : 0;

    const revelRaw = Number(parseInfoTag(info, 'REVEL'));
    const revelScore = Number.isFinite(revelRaw) ? revelRaw : null;

    const caddRaw = Number(parseInfoTag(info, 'CADD'));
    const caddPhred = Number.isFinite(caddRaw) ? caddRaw : null;

    const amRaw = Number(parseInfoTag(info, 'AM') ?? parseInfoTag(info, 'ALPHAMISSENSE'));
    const alphaMissenseScore = Number.isFinite(amRaw) ? amRaw : null;

    const aaMatch = /(\d+)/.exec(hgvsP);
    const aaPosition = aaMatch ? Number(aaMatch[1]) : null;
    const rsId = /^rs\d+$/i.test(idCol) ? idCol : null;
    const clinvarId = parseInfoTag(info, 'CLINVAR') ?? `${seqOrigin}-${chrom}-${pos}`;
    const rawCondition = parseInfoTag(info, 'COND') ?? parseInfoTag(info, 'DISEASE');
    const condition = rawCondition
      ? rawCondition.replace(/_+/g, ' ').trim()
      : `${gene}-associated disorder`;

    const detectedSeqFormat: 'WES' | 'WGS' =
      rawText.toLowerCase().includes('wgs') ||
      variantType === 'Regulatory / UTR' ||
      info.toUpperCase().includes('WGS')
        ? 'WGS'
        : seqOrigin;

    variants.push({
      id: `${detectedSeqFormat.toLowerCase()}-${gene.toLowerCase()}-${pos}-${rowNum}`,
      gene,
      hgvsC,
      hgvsP,
      rsId,
      clinvarId,
      variantType,
      aaPosition,
      proteinDomain: domain,
      gnomadAf,
      gnomadPopMaxLabel:
        gnomadAf === 0 ? `Absent (${detectedSeqFormat})` : `AF ${gnomadAf.toExponential(2)}`,
      clinvarStatus: info.toLowerCase().includes('conflict')
        ? 'Conflicting Interpretations'
        : 'Uniform VUS',
      clinvarSubmissions: {
        total: info.toLowerCase().includes('conflict') ? 6 : 2,
        vus: info.toLowerCase().includes('conflict') ? 4 : 2,
        lpOrP: info.toLowerCase().includes('conflict') ? 2 : 0,
        lbOrB: 0,
      },
      clinvarLastEvaluated: `${detectedSeqFormat} Pipeline`,
      functionalStatus: 'None',
      pubmedCount: 0,
      pubmedIds: [],
      functionalSummary: `Batch consequence annotated from ${detectedSeqFormat} VCF (${chrom}:${pos} ${ref}>${alt}, FILTER=${filterCol}).`,
      revelScore,
      caddPhred,
      siftScore: null,
      polyphenScore: null,
      alphaMissenseScore,
      alphaMissenseClass: deriveAlphaMissenseClass(alphaMissenseScore),
      similarClassifiedVariants: [],
      sameDomainPathogenicCount: variantType === 'Truncating VUS' ? 18 : 6,
      sameDomainBenignCount: 2,
      diseaseAssociation: condition,
      associatedConditions: condition
        .split(/[;|]/)
        .map((s) => s.trim())
        .filter(Boolean),
      clingenValidity: 'Strong',
      clingenActionabilityScore: 8,
      sequencingFormat: detectedSeqFormat,
      evaluationTruth: 'unvalidated',
      evaluationNote: `Ingested via ${detectedSeqFormat} VCF pipeline parser.`,
      sourceType: 'imported',
    });
  }

  return { variants, errors };
}

export function parseCmaBedVariants(rawText: string): {
  variants: VariantRecord[];
  errors: string[];
} {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.toLowerCase().startsWith('chrom\t'));

  const variants: VariantRecord[] = [];
  const errors: string[] = [];

  lines.forEach((line, idx) => {
    const cols = line.split(/\t|,/).map((c) => c.trim());
    if (cols.length < 4) {
      errors.push(`CMA row ${idx + 1}: expected chrom, start, end, gene[, svtype, condition].`);
      return;
    }

    const [chrom, start, end, rawGene, svType = 'CNV_DUP', rawCond = ''] = cols;
    const gene = rawGene.toUpperCase();
    const spanKb = Math.max(
      1,
      Math.round((Number(end) - Number(start)) / 1000) || 45,
    );
    const isDeletion = svType.toUpperCase().includes('DEL') || svType.toUpperCase().includes('LOSS');

    variants.push({
      id: `cma-${gene.toLowerCase()}-${start}-${idx + 1}`,
      gene,
      hgvsC: `${chrom}:${start}-${end} (${svType}, ${spanKb} kb)`,
      hgvsP: isDeletion ? 'p.ExonDel?' : 'p.ExonDup?',
      rsId: null,
      clinvarId: `CMA-${gene}-${idx + 1}`,
      variantType: isDeletion ? 'Truncating VUS' : 'In-frame Indel',
      aaPosition: null,
      proteinDomain: `${spanKb} kb CMA Copy-Number Interval`,
      gnomadAf: 0,
      gnomadPopMaxLabel: 'Absent in gnomAD SV',
      clinvarStatus: 'Uniform VUS',
      clinvarSubmissions: { total: 1, vus: 1, lpOrP: 0, lbOrB: 0 },
      clinvarLastEvaluated: 'CMA Microarray',
      functionalStatus: 'None',
      pubmedCount: 0,
      pubmedIds: [],
      functionalSummary: `Chromosomal microarray (${svType}, ${spanKb} kb) overlapping ${gene} coding exons.`,
      revelScore: null,
      caddPhred: isDeletion ? 26.5 : 19.2,
      siftScore: null,
      polyphenScore: null,
      alphaMissenseScore: null,
      alphaMissenseClass: null,
      similarClassifiedVariants: [],
      sameDomainPathogenicCount: isDeletion ? 20 : 6,
      sameDomainBenignCount: 2,
      diseaseAssociation: rawCond || `${gene}-associated CNV syndrome`,
      associatedConditions: rawCond
        ? rawCond.split(/[;|]/).map((s) => s.trim()).filter(Boolean)
        : [`${gene}-associated CNV syndrome`],
      clingenValidity: 'Strong',
      clingenActionabilityScore: 8,
      sequencingFormat: 'CMA',
      evaluationTruth: 'unvalidated',
      evaluationNote: 'Ingested via CMA / CNV microarray BED pipeline.',
      sourceType: 'imported',
    });
  });

  return { variants, errors };
}

export function summarizeAcmgBatch(variants: VariantRecord[]) {
  let hotVusCount = 0;
  let likelyPathogenicCount = 0;
  let vusCount = 0;
  let likelyBenignCount = 0;

  for (const v of variants) {
    const res = evaluateAcmgCriteria(v);
    if (res.classification === 'Hot VUS') hotVusCount += 1;
    else if (res.classification === 'Likely Pathogenic' || res.classification === 'Pathogenic') {
      likelyPathogenicCount += 1;
    } else if (res.classification === 'Likely Benign' || res.classification === 'Benign') {
      likelyBenignCount += 1;
    } else {
      vusCount += 1;
    }
  }

  return {
    hotVusCount,
    likelyPathogenicCount,
    vusCount,
    likelyBenignCount,
  };
}
