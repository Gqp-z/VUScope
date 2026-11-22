import { GENE_METADATA } from '../data/genes.js';
import type { GenomeGeneCatalogEntry } from '../types/variant.js';
import {
  pickBestClinGenCuration,
  type ClinGenCurationEntry,
} from './liveDatabaseMappers.js';

const CORE_BENCHMARK_GENES = new Set(['BRCA1', 'TP53', 'MYH7', 'SCN5A', 'CFTR']);

const VALIDITY_PRIORITY: Record<string, number> = {
  Definitive: 1,
  Strong: 2,
  Moderate: 3,
  Limited: 4,
};

function stripOuterQuotes(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function computePriorityRank(
  symbol: string,
  clingenClassification: GenomeGeneCatalogEntry['clingenClassification'],
): number {
  if (CORE_BENCHMARK_GENES.has(symbol)) return 0;
  if (clingenClassification) {
    return VALIDITY_PRIORITY[clingenClassification] ?? 5;
  }
  return 10;
}

export function sortGenomeCatalog(
  entries: GenomeGeneCatalogEntry[],
): GenomeGeneCatalogEntry[] {
  return [...entries].sort((a, b) => {
    if (a.priorityRank !== b.priorityRank) {
      return a.priorityRank - b.priorityRank;
    }
    return a.symbol.localeCompare(b.symbol);
  });
}

export function parseHgncProteinCodingTsv(
  tsvText: string,
  clingenByGene?: Map<string, ClinGenCurationEntry[]>,
): GenomeGeneCatalogEntry[] {
  const lines = tsvText.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split('\t').map((h) => h.trim().toLowerCase());
  const idxSymbol = headers.indexOf('symbol');
  const idxName = headers.indexOf('name');
  const idxHgncId = headers.indexOf('hgnc_id');
  const idxLocusGroup = headers.indexOf('locus_group');
  const idxStatus = headers.indexOf('status');
  const idxLocation = headers.indexOf('location');
  const idxEnsembl = headers.indexOf('ensembl_gene_id');

  if (idxSymbol === -1 || idxName === -1) return [];

  const bySymbol = new Map<string, GenomeGeneCatalogEntry>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split('\t');

    const status = idxStatus !== -1 ? (cols[idxStatus] ?? '').trim() : 'Approved';
    if (status && status !== 'Approved') continue;

    const locusGroup =
      idxLocusGroup !== -1
        ? stripOuterQuotes(cols[idxLocusGroup] ?? '') || 'protein-coding gene'
        : 'protein-coding gene';
    if (!locusGroup.toLowerCase().includes('protein-coding')) continue;

    const symbol = stripOuterQuotes(cols[idxSymbol] ?? '').toUpperCase();
    if (!symbol) continue;

    const name = stripOuterQuotes(cols[idxName] ?? '') || `${symbol} gene`;
    const hgncId =
      idxHgncId !== -1 ? stripOuterQuotes(cols[idxHgncId] ?? '') || null : null;
    const chromosome =
      idxLocation !== -1 ? stripOuterQuotes(cols[idxLocation] ?? '') || 'GRCh38' : 'GRCh38';
    const ensemblGeneId =
      idxEnsembl !== -1 ? stripOuterQuotes(cols[idxEnsembl] ?? '') || null : null;

    const clingenEntries = clingenByGene?.get(symbol) ?? [];
    const bestClinGen = pickBestClinGenCuration(clingenEntries);
    const clingenClassification = bestClinGen?.classification ?? null;

    bySymbol.set(symbol, {
      symbol,
      name,
      hgncId,
      ensemblGeneId,
      chromosome,
      locusGroup,
      clingenClassification,
      priorityRank: computePriorityRank(symbol, clingenClassification),
    });
  }

  // Merge any ClinGen-curated genes not already represented in the TSV
  if (clingenByGene) {
    clingenByGene.forEach((entries, sym) => {
      const symbol = sym.toUpperCase();
      if (bySymbol.has(symbol)) return;
      const best = pickBestClinGenCuration(entries);
      if (!best) return;
      bySymbol.set(symbol, {
        symbol,
        name: best.diseaseLabel ? `${symbol} — ${best.diseaseLabel}` : `${symbol} gene`,
        hgncId: best.hgncId || null,
        ensemblGeneId: null,
        chromosome: 'GRCh38',
        locusGroup: 'protein-coding gene',
        clingenClassification: best.classification,
        priorityRank: computePriorityRank(symbol, best.classification),
      });
    });
  }

  return sortGenomeCatalog(Array.from(bySymbol.values()));
}

export function buildFallbackCatalogFromClinGen(
  clingenByGene?: Map<string, ClinGenCurationEntry[]>,
  curatedSymbols?: string[],
): GenomeGeneCatalogEntry[] {
  const bySymbol = new Map<string, GenomeGeneCatalogEntry>();

  const seedSymbols = curatedSymbols ?? Object.keys(GENE_METADATA);
  for (const sym of seedSymbols) {
    const symbol = sym.toUpperCase();
    const meta = GENE_METADATA[symbol];
    const clingenClassification = meta?.clingenValidity ?? 'Definitive';
    bySymbol.set(symbol, {
      symbol,
      name: meta?.fullName ?? `${symbol} gene`,
      hgncId: null,
      ensemblGeneId: null,
      chromosome: meta?.chromosome ?? 'GRCh38',
      locusGroup: 'protein-coding gene',
      clingenClassification,
      priorityRank: computePriorityRank(symbol, clingenClassification),
    });
  }

  if (clingenByGene) {
    clingenByGene.forEach((entries, sym) => {
      const symbol = sym.toUpperCase();
      if (bySymbol.has(symbol)) return;
      const best = pickBestClinGenCuration(entries);
      if (!best) return;
      bySymbol.set(symbol, {
        symbol,
        name: best.diseaseLabel ? `${symbol} — ${best.diseaseLabel}` : `${symbol} gene`,
        hgncId: best.hgncId || null,
        ensemblGeneId: null,
        chromosome: 'GRCh38',
        locusGroup: 'protein-coding gene',
        clingenClassification: best.classification,
        priorityRank: computePriorityRank(symbol, best.classification),
      });
    });
  }

  return sortGenomeCatalog(Array.from(bySymbol.values()));
}

export function searchGenomeCatalog(
  catalog: GenomeGeneCatalogEntry[],
  rawQuery: string,
  offset = 0,
  limit = 50,
): { totalMatching: number; genes: GenomeGeneCatalogEntry[] } {
  const clean = rawQuery.trim().toLowerCase();
  if (!clean) {
    return {
      totalMatching: catalog.length,
      genes: catalog.slice(offset, offset + limit),
    };
  }

  const exactMatches: GenomeGeneCatalogEntry[] = [];
  const prefixMatches: GenomeGeneCatalogEntry[] = [];
  const containsMatches: GenomeGeneCatalogEntry[] = [];

  for (const entry of catalog) {
    const symLower = entry.symbol.toLowerCase();
    const nameLower = entry.name.toLowerCase();
    const hgncLower = (entry.hgncId ?? '').toLowerCase();
    const ensemblLower = (entry.ensemblGeneId ?? '').toLowerCase();

    if (symLower === clean) {
      exactMatches.push(entry);
    } else if (symLower.startsWith(clean)) {
      prefixMatches.push(entry);
    } else if (
      symLower.includes(clean) ||
      nameLower.includes(clean) ||
      hgncLower.includes(clean) ||
      ensemblLower.includes(clean)
    ) {
      containsMatches.push(entry);
    }
  }

  const merged = [...exactMatches, ...prefixMatches, ...containsMatches];
  return {
    totalMatching: merged.length,
    genes: merged.slice(offset, offset + limit),
  };
}

export function selectNextUncrawledGenes(
  catalog: GenomeGeneCatalogEntry[],
  fetchedGenes: Set<string>,
  offsetHint = 0,
  batchSize = 5,
): { selected: GenomeGeneCatalogEntry[]; nextOffset: number } {
  if (catalog.length === 0 || batchSize <= 0) {
    return { selected: [], nextOffset: 0 };
  }

  const safeStart = ((offsetHint % catalog.length) + catalog.length) % catalog.length;
  const selected: GenomeGeneCatalogEntry[] = [];
  let scanned = 0;
  let cursor = safeStart;

  while (scanned < catalog.length && selected.length < batchSize) {
    const candidate = catalog[cursor];
    if (!fetchedGenes.has(candidate.symbol.toUpperCase())) {
      selected.push(candidate);
    }
    cursor = (cursor + 1) % catalog.length;
    scanned += 1;
  }

  return {
    selected,
    nextOffset: cursor,
  };
}

export function paginateItems<T>(
  items: T[],
  page: number,
  pageSize: number,
): {
  pageItems: T[];
  safePage: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  totalItems: number;
} {
  const totalItems = items.length;
  const safeSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(totalItems / safeSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * safeSize;
  const end = Math.min(totalItems, start + safeSize);

  return {
    pageItems: items.slice(start, end),
    safePage,
    totalPages,
    startIndex: totalItems === 0 ? 0 : start + 1,
    endIndex: end,
    totalItems,
  };
}
