import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPersistentKeyConfigured } from './server/security/cryptoVault.js';
import {
  createRateLimitMiddleware,
  getFirewallTelemetry,
  safeExternalFetch,
  securityHeadersMiddleware,
  wafInspectionMiddleware,
} from './server/security/firewall.js';
import {
  getIntegrityReport,
  initializeIntegrityManifest,
} from './server/security/integrityGuard.js';
import {
  getEncryptedLocalDbStateResponse,
  getLocalDbRotationCursor,
  loadEncryptedLocalDbFromDisk,
  saveSyncedBatchToEncryptedStore,
} from './server/security/localDbStore.js';
import type {
  BatchAnnotateResponse,
  BatchLookupQueryStatus,
  BatchLookupResponse,
  GeneConditionAssociation,
  GeneMetadata,
  GenomeCatalogResponse,
  GenomeGeneCatalogEntry,
  LiveDatabaseConnectionInfo,
  LiveLookupResponse,
  LocalDbSyncResponse,
  PubMedArticleRef,
  SecurityStatusResponse,
  VariantRecord,
} from './src/types/variant.js';
import {
  buildFallbackCatalogFromClinGen,
  parseHgncProteinCodingTsv,
  searchGenomeCatalog,
  selectNextUncrawledGenes,
} from './src/utils/genomeCatalog.js';
import { getPrioritySyncGeneSequence } from './src/utils/localGenomicDb.js';
import {
  asString,
  clingenTierToActionability,
  extractAllClinVarConditions,
  extractClassifiedNeighbors,
  firstScalar,
  formatInheritanceLabel,
  mapClinGenEntriesToConditions,
  mapMyVariantToRecord,
  parseClinGenValidityCsv,
  pickBestClinGenCuration,
  type ClinGenCurationEntry,
  type MyVariantHit,
} from './src/utils/liveDatabaseMappers.js';
import {
  detectPipelineFormat,
  parseCmaBedVariants,
  parseVcfVariants,
  summarizeAcmgBatch,
} from './src/utils/pipelineParsers.js';
import { parseImportedCsv } from './src/utils/prioritisation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLINGEN_CSV_URL = 'https://search.clinicalgenome.org/kb/gene-validity/download';
const CLINGEN_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const HGNC_PROTEIN_CODING_URL =
  'https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/locus_groups/protein-coding_gene.txt';
const HGNC_COMPLETE_URL =
  'https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/hgnc_complete_set.txt';
const HGNC_DISK_CACHE_PATH = '/tmp/vuscope-hgnc-protein-coding.tsv';
const GENOME_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const LOOKUP_CACHE_TTL_MS = 30 * 60 * 1000;
const LOOKUP_CACHE_MAX_ENTRIES = 2500;

let clingenCache: {
  loadedAt: number;
  byGene: Map<string, ClinGenCurationEntry[]>;
} | null = null;
let clingenLoadPromise: Promise<Map<string, ClinGenCurationEntry[]>> | null = null;

async function getClinGenMap(): Promise<Map<string, ClinGenCurationEntry[]>> {
  if (clingenCache && Date.now() - clingenCache.loadedAt < CLINGEN_CACHE_TTL_MS) {
    return clingenCache.byGene;
  }
  if (clingenLoadPromise) {
    return clingenLoadPromise;
  }

  clingenLoadPromise = (async () => {
    try {
      const resp = await safeExternalFetch(CLINGEN_CSV_URL, {
        timeoutMs: 9000,
      });
      if (!resp.ok) {
        return clingenCache?.byGene ?? new Map();
      }
      const csvText = await resp.text();
      const byGene = parseClinGenValidityCsv(csvText);
      clingenCache = {
        loadedAt: Date.now(),
        byGene,
      };
      return byGene;
    } catch {
      return clingenCache?.byGene ?? new Map();
    } finally {
      clingenLoadPromise = null;
    }
  })();

  return clingenLoadPromise;
}

interface GenomeCatalogCacheState {
  loadedAt: number;
  entries: GenomeGeneCatalogEntry[];
  source: 'hgnc_live' | 'clingen_fallback';
  clingenCuratedCount: number;
}

let genomeCatalogCache: GenomeCatalogCacheState | null = null;
let genomeCatalogLoadPromise: Promise<GenomeCatalogCacheState> | null = null;

async function readOrFetchHgncTsv(): Promise<string | null> {
  try {
    if (fs.existsSync(HGNC_DISK_CACHE_PATH)) {
      const stat = fs.statSync(HGNC_DISK_CACHE_PATH);
      if (Date.now() - stat.mtimeMs < GENOME_CATALOG_TTL_MS && stat.size > 50_000) {
        return fs.readFileSync(HGNC_DISK_CACHE_PATH, 'utf8');
      }
    }
  } catch {
    // Ignore disk cache read issues
  }

  for (const url of [HGNC_PROTEIN_CODING_URL, HGNC_COMPLETE_URL]) {
    try {
      const resp = await safeExternalFetch(url, { timeoutMs: 15000 });
      if (!resp.ok) continue;
      const tsv = await resp.text();
      if (tsv && tsv.includes('\tsymbol\t') && tsv.length > 50_000) {
        try {
          fs.writeFileSync(HGNC_DISK_CACHE_PATH, tsv, 'utf8');
        } catch {
          // Ignore write failures in read-only dirs
        }
        return tsv;
      }
    } catch {
      // Try next HGNC source URL
    }
  }
  return null;
}

async function getGenomeCatalog(): Promise<GenomeCatalogCacheState> {
  if (
    genomeCatalogCache &&
    Date.now() - genomeCatalogCache.loadedAt < GENOME_CATALOG_TTL_MS
  ) {
    return genomeCatalogCache;
  }
  if (genomeCatalogLoadPromise) {
    return genomeCatalogLoadPromise;
  }

  genomeCatalogLoadPromise = (async () => {
    const [clingenMap, hgncTsv] = await Promise.all([
      getClinGenMap(),
      readOrFetchHgncTsv(),
    ]);

    let entries: GenomeGeneCatalogEntry[] = [];
    let source: 'hgnc_live' | 'clingen_fallback' = 'clingen_fallback';

    if (hgncTsv) {
      const parsed = parseHgncProteinCodingTsv(hgncTsv, clingenMap);
      if (parsed.length > 1000) {
        entries = parsed;
        source = 'hgnc_live';
      }
    }

    if (entries.length === 0) {
      entries = buildFallbackCatalogFromClinGen(clingenMap);
    }

    const clingenCuratedCount = entries.filter(
      (g) => g.clingenClassification !== null,
    ).length;

    const state: GenomeCatalogCacheState = {
      loadedAt: Date.now(),
      entries,
      source,
      clingenCuratedCount,
    };
    if (!genomeCatalogCache || source === 'hgnc_live' || genomeCatalogCache.source === 'clingen_fallback') {
      genomeCatalogCache = state;
    }
    return genomeCatalogCache ?? state;
  })().finally(() => {
    genomeCatalogLoadPromise = null;
  });

  return genomeCatalogLoadPromise;
}

const lookupResultCache = new Map<
  string,
  { storedAt: number; payload: LiveLookupResponse }
>();
const inFlightLookups = new Map<string, Promise<LiveLookupResponse>>();

function isRateLimitErrorMessage(msg: string): boolean {
  return /\b(429|503|rate limit|too many requests)\b/i.test(msg);
}

interface MyGeneDoc {
  symbol?: string;
  name?: string;
  HGNC?: string;
  ensembl?: { gene?: string } | Array<{ gene?: string }>;
  interpro?: Array<{ id?: string; desc?: string; short_desc?: string }> | { id?: string; desc?: string; short_desc?: string };
}

async function fetchMyGeneInfo(geneSymbol: string) {
  const url = `https://mygene.info/v3/query?q=symbol:${encodeURIComponent(geneSymbol)}&species=human&fields=symbol,name,ensembl.gene,interpro,HGNC&size=1`;
  const resp = await safeExternalFetch(url, { timeoutMs: 6000 });
  if (!resp.ok) return null;
  const data = (await resp.json()) as { hits?: MyGeneDoc[] };
  const doc = data.hits?.[0];
  if (!doc) return null;

  const ensemblObj = firstScalar(doc.ensembl);
  const ensemblGeneId = ensemblObj?.gene ?? null;

  const interproList = doc.interpro
    ? Array.isArray(doc.interpro)
      ? doc.interpro
      : [doc.interpro]
    : [];
  const interproDomains = Array.from(
    new Set(
      interproList
        .map((ip) => ip.short_desc || ip.desc || '')
        .filter(Boolean),
    ),
  ).slice(0, 8);

  return {
    symbol: (doc.symbol || geneSymbol).toUpperCase(),
    fullName: doc.name || `${geneSymbol} gene`,
    ensemblGeneId,
    hgncId: doc.HGNC ? `HGNC:${doc.HGNC}` : null,
    interproDomains,
  };
}

async function fetchClinVarTotalVusCount(geneSymbol: string): Promise<number | null> {
  const term = `${geneSymbol}[gene] AND "uncertain significance"[clinsig]`;
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&retmode=json&retmax=0&term=${encodeURIComponent(term)}`;
  const resp = await safeExternalFetch(url, { timeoutMs: 6000 });
  if (!resp.ok) return null;
  const data = (await resp.json()) as { esearchresult?: { count?: string } };
  const n = Number(data.esearchresult?.count);
  return Number.isFinite(n) ? n : null;
}

async function fetchPubMedEvidence(
  queryTerm: string,
): Promise<{ count: number; articles: PubMedArticleRef[] }> {
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=4&term=${encodeURIComponent(queryTerm)}`;
  const searchResp = await safeExternalFetch(searchUrl, { timeoutMs: 6000 });
  if (!searchResp.ok) {
    return { count: 0, articles: [] };
  }
  const searchData = (await searchResp.json()) as {
    esearchresult?: { count?: string; idlist?: string[] };
  };
  const count = Number(searchData.esearchresult?.count ?? 0) || 0;
  const pmids = searchData.esearchresult?.idlist ?? [];
  if (pmids.length === 0) {
    return { count, articles: [] };
  }

  const sumUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${encodeURIComponent(pmids.join(','))}`;
  const sumResp = await safeExternalFetch(sumUrl, { timeoutMs: 6000 });
  if (!sumResp.ok) {
    return {
      count,
      articles: pmids.map((pmid) => ({ pmid, title: `PubMed PMID:${pmid}` })),
    };
  }
  const sumData = (await sumResp.json()) as {
    result?: Record<string, { title?: string; pubdate?: string; source?: string }>;
  };

  const articles: PubMedArticleRef[] = pmids
    .map((pmid) => {
      const rec = sumData.result?.[pmid];
      return {
        pmid,
        title: rec?.title || `PubMed PMID:${pmid}`,
        pubdate: rec?.pubdate,
        source: rec?.source,
      };
    })
    .filter((a) => Boolean(a.pmid));

  return { count, articles };
}

const MYVARIANT_FIELDS = [
  'clinvar.variant_id',
  'clinvar.rcv.clinical_significance',
  'clinvar.rcv.conditions.name',
  'clinvar.rcv.last_evaluated',
  'clinvar.rcv.number_submitters',
  'clinvar.hgvs',
  'clinvar.gene.symbol',
  'gnomad_exome.af.af',
  'gnomad_exome.af.af_popmax',
  'gnomad_genome.af.af',
  'gnomad_genome.af.af_popmax',
  'dbsnp.rsid',
  'dbnsfp.genename',
  'dbnsfp.revel.score',
  'dbnsfp.sift.score',
  'dbnsfp.polyphen2.hdiv.score',
  'dbnsfp.hgvsp',
  'dbnsfp.hgvsc',
  'dbnsfp.aapos',
  'dbnsfp.interpro_domain',
  'dbnsfp.alphamissense.am_pathogenicity',
  'dbnsfp.alphamissense.am_class',
  'cadd.phred',
  'cadd.consequence',
].join(',');

async function fetchMyVariant(query: string, size: number) {
  const url = `https://myvariant.info/v1/query?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(MYVARIANT_FIELDS)}&size=${size}`;
  const resp = await safeExternalFetch(url, { timeoutMs: 15000 });
  if (!resp.ok) {
    throw new Error(`MyVariant.info returned status ${resp.status}`);
  }
  return (await resp.json()) as { hits?: MyVariantHit[]; total?: number };
}

function parseLookupInput(rawQuery: string) {
  const trimmed = rawQuery.trim();
  const tokens = trimmed.split(/\s+/).filter(Boolean);

  if (tokens.length === 1) {
    const clean = tokens[0].replace(/[^a-zA-Z0-9_.:>*+-]/g, '');
    const isRsId = /^rs\d+$/i.test(clean);
    const isHgvs =
      clean.includes(':') ||
      clean.startsWith('c.') ||
      clean.startsWith('p.') ||
      /^[ARNDCQEGHILKMFPSTWYV]\d+[ARNDCQEGHILKMFPSTWYV*X]$/i.test(clean);

    return {
      isRsId,
      isHgvs,
      geneHint: !isRsId && !isHgvs ? clean.toUpperCase() : null,
      variantToken: isRsId || isHgvs ? clean : null,
      cleanQ: clean,
    };
  }

  const maybeGene = tokens[0].replace(/[^a-zA-Z0-9-]/g, '').toUpperCase();
  const restVariant = tokens.slice(1).join(' ').replace(/[^a-zA-Z0-9_.:>*+-]/g, '');
  return {
    isRsId: /^rs\d+$/i.test(restVariant),
    isHgvs: true,
    geneHint: maybeGene.length >= 2 ? maybeGene : null,
    variantToken: restVariant || null,
    cleanQ: trimmed,
  };
}

export async function createApp() {
  initializeIntegrityManifest();
  loadEncryptedLocalDbFromDisk();

  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeadersMiddleware);
  app.use(express.json({ limit: '1mb' }));
  app.use(wafInspectionMiddleware);

  const generalApiLimiter = createRateLimitMiddleware({
    windowMs: 60_000,
    maxRequests: 200,
    label: 'api-general',
  });
  const heavySyncLimiter = createRateLimitMiddleware({
    windowMs: 60_000,
    maxRequests: 30,
    label: 'api-heavy-sync',
  });
  app.use('/api', generalApiLimiter);

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'vuscope-api' });
  });

  app.get('/api/security/status', (_req: Request, res: Response) => {
    const dbState = getEncryptedLocalDbStateResponse();
    const payload: SecurityStatusResponse = {
      firewall: getFirewallTelemetry(),
      encryption: {
        cipher: 'AES-256-GCM',
        hmacAlgorithm: 'HMAC-SHA256',
        encryptedAtRest: dbState.encryptedAtRest,
        persistentKeyConfigured: isPersistentKeyConfigured(),
        storeDigestSha256: dbState.storeDigestSha256,
        sourcemapDisabled: true,
      },
      integrity: getIntegrityReport(),
    };
    res.json(payload);
  });

  app.get('/api/databases', async (_req: Request, res: Response) => {
    const [clingenMap, catalog] = await Promise.all([
      getClinGenMap(),
      getGenomeCatalog(),
    ]);
    res.json({
      databases: [
        {
          id: 'hgnc',
          name: 'HGNC Human Genome Catalog',
          provider: `${catalog.entries.length.toLocaleString()} protein-coding genes (${catalog.source === 'hgnc_live' ? 'Official HGNC TSV' : 'ClinGen fallback'})`,
          status: catalog.source === 'hgnc_live' ? 'connected' : 'partial',
        },
        {
          id: 'clinvar',
          name: 'ClinVar (NCBI)',
          provider: 'MyVariant.info + NCBI E-utilities',
          status: 'connected',
        },
        {
          id: 'gnomad',
          name: 'gnomAD v4',
          provider: 'MyVariant.info Exome/Genome AF mirror',
          status: 'connected',
        },
        {
          id: 'pubmed',
          name: 'PubMed (NCBI)',
          provider: 'NCBI E-utilities esearch + esummary',
          status: 'connected',
        },
        {
          id: 'clingen',
          name: 'ClinGen Gene-Disease Validity',
          provider: `Official CSV curations (${clingenMap.size} genes indexed)`,
          status: clingenMap.size > 0 ? 'connected' : 'partial',
        },
        {
          id: 'ensembl',
          name: 'Ensembl / InterPro',
          provider: 'MyGene.info + dbNSFP InterPro annotations',
          status: 'connected',
        },
        {
          id: 'dbnsfp',
          name: 'dbNSFP & CADD',
          provider: 'REVEL, SIFT, PolyPhen-2, CADD Phred via MyVariant.info',
          status: 'connected',
        },
      ],
    });
  });

  app.get('/api/genes', async (req: Request, res: Response) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

      const catalog = await getGenomeCatalog();
      const matched = searchGenomeCatalog(catalog.entries, q, offset, limit);

      const payload: GenomeCatalogResponse = {
        totalGenes: q ? matched.totalMatching : catalog.entries.length,
        clingenCuratedCount: catalog.clingenCuratedCount,
        source: catalog.source,
        offset,
        limit,
        query: q,
        genes: matched.genes,
      };
      res.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load genome catalog';
      res.status(503).json({ error: message });
    }
  });

  const runLocalDbToolSync = async (
    requestedGenes?: string[],
  ): Promise<LocalDbSyncResponse> => {
    const priorityGenes = getPrioritySyncGeneSequence();
    const cursor = getLocalDbRotationCursor();

    let batchSymbols: string[];
    let nextCursor = cursor;
    if (requestedGenes && requestedGenes.length > 0) {
      batchSymbols = Array.from(
        new Set(
          requestedGenes
            .map((g) => g.trim().toUpperCase())
            .filter((g) => /^[A-Z0-9-]{2,15}$/.test(g)),
        ),
      ).slice(0, 6);
    } else {
      const batchSize = 4;
      batchSymbols = [];
      for (let i = 0; i < batchSize; i++) {
        batchSymbols.push(priorityGenes[(cursor + i) % priorityGenes.length]);
      }
      nextCursor = (cursor + batchSize) % priorityGenes.length;
    }

    const settled = await Promise.allSettled(
      batchSymbols.map((sym) => executeSingleLookup(sym, 12)),
    );

    const variants: VariantRecord[] = [];
    const seenKeys = new Set<string>();
    const geneMeta: Record<string, GeneMetadata> = {};
    let latestSources: LiveDatabaseConnectionInfo[] = [];
    let rateLimited = false;

    settled.forEach((outcome, idx) => {
      const sym = batchSymbols[idx];
      if (outcome.status === 'fulfilled') {
        const payload = outcome.value;
        if (payload.sources.length > 0) latestSources = payload.sources;
        const resolvedSym = payload.resolvedGene || sym;
        const meta = buildGeneMetadataFromLookup({
          ...payload,
          resolvedGene: resolvedSym,
        });
        if (meta) geneMeta[resolvedSym] = meta;
        for (const v of payload.variants) {
          const key = `${v.gene}:${v.clinvarId}:${v.hgvsC}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            variants.push(v);
          }
        }
      } else {
        const msg =
          outcome.reason instanceof Error ? outcome.reason.message : 'Lookup error';
        if (isRateLimitErrorMessage(msg)) {
          rateLimited = true;
        }
      }
    });

    const nextState = saveSyncedBatchToEncryptedStore({
      variants,
      geneMeta,
      sources: latestSources,
      syncedGenesBatch: batchSymbols,
      nextRotationIndex: nextCursor,
    });

    return {
      syncedGenesBatch: batchSymbols,
      addedOrUpdatedVariants: variants,
      geneMeta,
      toolStatuses: nextState.toolStatuses,
      lastSyncedAt: nextState.lastSyncedAt ?? new Date().toISOString(),
      totalSyncedVariants: nextState.syncedVariants.length,
      totalSyncRuns: nextState.totalSyncRuns,
      rateLimited,
      storeDigestSha256: nextState.storeDigestSha256,
    };
  };

  app.get('/api/local-db/state', (_req: Request, res: Response) => {
    res.json(getEncryptedLocalDbStateResponse());
  });

  app.post('/api/local-db/sync', heavySyncLimiter, async (req: Request, res: Response) => {
    try {
      const requested = Array.isArray(req.body?.genes)
        ? req.body.genes.filter((g: unknown): g is string => typeof g === 'string')
        : undefined;
      const syncResult = await runLocalDbToolSync(requested);
      res.json(syncResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Local database sync error';
      res.status(isRateLimitErrorMessage(message) ? 429 : 503).json({ error: message });
    }
  });

async function executeSingleLookup(
  rawQuery: string,
  size = 18,
): Promise<LiveLookupResponse> {
  const cacheKey = `${rawQuery.trim().toUpperCase()}::${size}`;
  const cached = lookupResultCache.get(cacheKey);
  if (cached && Date.now() - cached.storedAt < LOOKUP_CACHE_TTL_MS) {
    return cached.payload;
  }

  const pending = inFlightLookups.get(cacheKey);
  if (pending) {
    return pending;
  }

  const runPromise = (async () => {
    const parsed = parseLookupInput(rawQuery);
    let myVariantQuery: string;

  if (parsed.isRsId && parsed.variantToken) {
    myVariantQuery = `dbsnp.rsid:${parsed.variantToken}`;
  } else if (parsed.geneHint && parsed.variantToken) {
    myVariantQuery = `(clinvar.gene.symbol:${parsed.geneHint} OR dbnsfp.genename:${parsed.geneHint}) AND "${parsed.variantToken}"`;
  } else if (parsed.isHgvs && parsed.variantToken) {
    myVariantQuery = `"${parsed.variantToken}"`;
  } else {
    const gene = parsed.geneHint || parsed.cleanQ.toUpperCase();
    myVariantQuery = `(clinvar.gene.symbol:${gene} OR dbnsfp.genename:${gene}) AND (clinvar.rcv.clinical_significance:"Uncertain significance" OR clinvar.rcv.clinical_significance:"Conflicting")`;
  }

  const initialGene = parsed.geneHint;
  const [
    mvResult,
    clingenMapResult,
    myGeneInitialResult,
    clinvarCountInitialResult,
    pubmedInitialResult,
    pathNeighborsInitialResult,
  ] = await Promise.allSettled([
    fetchMyVariant(myVariantQuery, size),
    getClinGenMap(),
    initialGene ? fetchMyGeneInfo(initialGene) : Promise.resolve(null),
    initialGene ? fetchClinVarTotalVusCount(initialGene) : Promise.resolve(null),
    fetchPubMedEvidence(
      parsed.isRsId && parsed.variantToken
        ? parsed.variantToken
        : initialGene
          ? `${initialGene}[Title/Abstract] AND ("variant of uncertain significance"[Title/Abstract] OR VUS[Title/Abstract] OR functional[Title/Abstract])`
          : `${rawQuery}[Title/Abstract]`,
    ),
    initialGene
      ? fetchMyVariant(
          `(clinvar.gene.symbol:${initialGene} OR dbnsfp.genename:${initialGene}) AND (clinvar.rcv.clinical_significance:"Pathogenic" OR clinvar.rcv.clinical_significance:"Likely pathogenic")`,
          25,
        )
      : Promise.resolve(null),
  ]);

  if (mvResult.status === 'rejected') {
    throw new Error(
      mvResult.reason instanceof Error ? mvResult.reason.message : 'MyVariant request failed',
    );
  }

  const data = mvResult.value;
  const hits = data.hits ?? [];

  const hitGene =
    asString(firstScalar(hits[0]?.clinvar?.gene)?.symbol) ||
    asString(hits[0]?.dbnsfp?.genename) ||
    null;
  const resolvedGene = (initialGene || hitGene || '').toUpperCase() || null;

  let geneInfo =
    myGeneInitialResult.status === 'fulfilled' ? myGeneInitialResult.value : null;
  let clinvarTotalVus =
    clinvarCountInitialResult.status === 'fulfilled' ? clinvarCountInitialResult.value : null;
  let neighborData =
    pathNeighborsInitialResult.status === 'fulfilled'
      ? pathNeighborsInitialResult.value
      : null;

  if (!initialGene && resolvedGene) {
    const [mgRes, cvRes, nbRes] = await Promise.allSettled([
      fetchMyGeneInfo(resolvedGene),
      fetchClinVarTotalVusCount(resolvedGene),
      fetchMyVariant(
        `(clinvar.gene.symbol:${resolvedGene} OR dbnsfp.genename:${resolvedGene}) AND (clinvar.rcv.clinical_significance:"Pathogenic" OR clinvar.rcv.clinical_significance:"Likely pathogenic")`,
        25,
      ),
    ]);
    if (mgRes.status === 'fulfilled') geneInfo = mgRes.value;
    if (cvRes.status === 'fulfilled') clinvarTotalVus = cvRes.value;
    if (nbRes.status === 'fulfilled') neighborData = nbRes.value;
  }

  const clingenMap =
    clingenMapResult.status === 'fulfilled'
      ? clingenMapResult.value
      : new Map<string, ClinGenCurationEntry[]>();
  const clingenEntries: ClinGenCurationEntry[] = resolvedGene
    ? clingenMap.get(resolvedGene) ?? []
    : [];
  const clingenEntry = pickBestClinGenCuration(clingenEntries);

  const geneConditions: GeneConditionAssociation[] =
    mapClinGenEntriesToConditions(clingenEntries);
  const seenCondKeys = new Set(
    geneConditions.map((c) => c.condition.toLowerCase()),
  );

  for (const hit of hits) {
    for (const cvCond of extractAllClinVarConditions(hit.clinvar?.rcv)) {
      const key = cvCond.toLowerCase();
      if (!seenCondKeys.has(key) && geneConditions.length < 10) {
        seenCondKeys.add(key);
        geneConditions.push({
          condition: cvCond,
          inheritance: clingenEntry
            ? formatInheritanceLabel(clingenEntry.moi)
            : 'ClinVar Reported',
          clingenValidity: clingenEntry?.classification ?? 'Moderate',
          clinicalSpectrumNote:
            'Associated phenotype reported across ClinVar variant submissions for this gene.',
        });
      }
    }
  }

  const allGeneConditions = geneConditions.map((c) => c.condition);

  const pubmedEvidence =
    pubmedInitialResult.status === 'fulfilled'
      ? pubmedInitialResult.value
      : { count: 0, articles: [] };

  const classifiedNeighbors = extractClassifiedNeighbors(neighborData?.hits ?? []);

  const variants = hits.map((hit, idx) =>
    mapMyVariantToRecord(hit, idx, {
      fallbackGene: resolvedGene || 'QUERY',
      clingen: clingenEntry,
      allGeneConditions,
      ensemblGeneId: geneInfo?.ensemblGeneId ?? null,
      geneInterproDomains: geneInfo?.interproDomains ?? [],
      pubmedCount: pubmedEvidence.count,
      pubmedArticles: pubmedEvidence.articles,
      classifiedNeighbors,
    }),
  );

  const hasGnomad = variants.some((v) => v.gnomadAf > 0);
  const hasDbnsfp = variants.some(
    (v) =>
      v.revelScore !== null ||
      v.caddPhred !== null ||
      v.siftScore !== null ||
      (v.alphaMissenseScore !== undefined && v.alphaMissenseScore !== null),
  );

  const sources: LiveDatabaseConnectionInfo[] = [
    {
      id: 'clinvar',
      name: 'ClinVar (NCBI)',
      status: 'connected',
      summary:
        clinvarTotalVus !== null
          ? `${clinvarTotalVus.toLocaleString()} gene VUS indexed · ${variants.length} fetched`
          : `${variants.length} variant records fetched`,
      url: resolvedGene
        ? `https://www.ncbi.nlm.nih.gov/clinvar/?term=${encodeURIComponent(`${resolvedGene}[gene]`)}`
        : undefined,
    },
    {
      id: 'gnomad',
      name: 'gnomAD v4',
      status: variants.length > 0 ? 'connected' : 'partial',
      summary:
        variants.length > 0
          ? hasGnomad
            ? 'Allele frequencies & PopMax annotated via MyVariant'
            : 'Checked (fetched alleles absent / AF = 0)'
          : 'No variants returned to annotate',
      url: resolvedGene
        ? `https://gnomad.broadinstitute.org/gene/${encodeURIComponent(resolvedGene)}`
        : undefined,
    },
    {
      id: 'pubmed',
      name: 'PubMed (NCBI)',
      status: pubmedInitialResult.status === 'fulfilled' ? 'connected' : 'unavailable',
      summary:
        pubmedEvidence.count > 0
          ? `${pubmedEvidence.count.toLocaleString()} VUS/functional citations`
          : '0 matching VUS citations',
      url: resolvedGene
        ? `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(`${resolvedGene} variant of uncertain significance`)}`
        : undefined,
    },
    {
      id: 'clingen',
      name: 'ClinGen Validity',
      status: clingenMap.size > 0 ? 'connected' : 'unavailable',
      summary: clingenEntry
        ? clingenEntries.length > 1
          ? `${clingenEntries.length} ClinGen curations (${clingenEntry.classification}: ${clingenEntries.map((e) => e.diseaseLabel).slice(0, 2).join('; ')})`
          : `${clingenEntry.classification} (${clingenEntry.diseaseLabel})`
        : resolvedGene
          ? `No ClinGen validity curation for ${resolvedGene}`
          : 'Curated gene-disease table loaded',
      url: clingenEntry?.reportUrl ?? 'https://search.clinicalgenome.org/kb/gene-validity',
    },
    {
      id: 'ensembl',
      name: 'Ensembl / InterPro',
      status: geneInfo?.ensemblGeneId ? 'connected' : 'partial',
      summary: geneInfo?.ensemblGeneId
        ? `${geneInfo.ensemblGeneId} · ${geneInfo.interproDomains.length} InterPro domains`
        : 'Domain annotations via dbNSFP',
      url: geneInfo?.ensemblGeneId
        ? `https://www.ensembl.org/Homo_sapiens/Gene/Summary?g=${encodeURIComponent(geneInfo.ensemblGeneId)}`
        : undefined,
    },
    {
      id: 'dbnsfp',
      name: 'dbNSFP & CADD',
      status: hasDbnsfp ? 'connected' : 'partial',
      summary: hasDbnsfp
        ? 'REVEL, AlphaMissense, CADD Phred, SIFT & PolyPhen-2 loaded'
        : 'Scores unavailable for non-missense hits',
    },
  ];

    const payload: LiveLookupResponse = {
      query: rawQuery,
      resolvedGene,
      totalMatches: data.total ?? variants.length,
      clinvarTotalVus,
      pubmedArticleCount: pubmedEvidence.count,
      pubmedArticles: pubmedEvidence.articles,
      clingenSummary: clingenEntry
        ? {
            gene: clingenEntry.geneSymbol,
            classification: clingenEntry.classification,
            diseaseLabel: clingenEntry.diseaseLabel,
            moi: clingenEntry.moi,
            expertPanel: clingenEntry.expertPanel,
            reportUrl: clingenEntry.reportUrl,
            actionabilityScore: clingenTierToActionability(clingenEntry.classification),
          }
        : null,
      geneConditions,
      geneInfo,
      sources,
      variants,
    };

    if (lookupResultCache.size >= LOOKUP_CACHE_MAX_ENTRIES) {
      const oldestKey = lookupResultCache.keys().next().value;
      if (oldestKey) lookupResultCache.delete(oldestKey);
    }
    lookupResultCache.set(cacheKey, { storedAt: Date.now(), payload });
    return payload;
  })();

  inFlightLookups.set(cacheKey, runPromise);
  try {
    return await runPromise;
  } finally {
    inFlightLookups.delete(cacheKey);
  }
}

function buildGeneMetadataFromLookup(payload: LiveLookupResponse): GeneMetadata | null {
  const sym = payload.resolvedGene;
  if (!sym) return null;
  const maxAa = payload.variants.reduce((m, v) => Math.max(m, v.aaPosition ?? 0), 0);
  const liveConditions =
    payload.geneConditions && payload.geneConditions.length > 0
      ? payload.geneConditions.map((c) => c.condition)
      : payload.clingenSummary
        ? [payload.clingenSummary.diseaseLabel]
        : [`${sym}-associated phenotype`];

  return {
    symbol: sym,
    fullName: payload.geneInfo?.fullName || `${sym} (Live Cohort)`,
    chromosome: 'GRCh38',
    proteinLengthAa: Math.max(400, Math.ceil(((maxAa || 500) * 1.15) / 50) * 50),
    transcriptId: payload.geneInfo?.ensemblGeneId || 'Ensembl Live',
    primaryConditions: liveConditions,
    conditionDetails: payload.geneConditions,
    clingenValidity: payload.clingenSummary?.classification || 'Moderate',
    clingenExpertPanel: payload.clingenSummary?.expertPanel || 'ClinGen Live Curation',
    inheritance: payload.clingenSummary?.moi || 'Curated',
    vusBurdenNote:
      payload.clinvarTotalVus !== null
        ? `${payload.clinvarTotalVus.toLocaleString()} VUS in ClinVar`
        : 'Live database cohort',
    domains: [],
  };
}

  app.get('/api/lookup', async (req: Request, res: Response) => {
    const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const size = Math.min(25, Math.max(5, Number(req.query.size) || 18));
    if (!rawQuery || rawQuery.length < 2) {
      res.status(400).json({
        error: 'Provide a gene symbol (e.g. PALB2, BRCA2), HGVS notation, or rsID (e.g. rs80357433).',
      });
      return;
    }

    try {
      const payload = await executeSingleLookup(rawQuery, size);
      res.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error querying public APIs';
      res.status(503).json({
        error: `Unable to reach public genomic databases (${message}). Curated local gene cohorts remain available.`,
      });
    }
  });

  app.post('/api/lookup/batch', async (req: Request, res: Response) => {
    const rawQueries: unknown[] = Array.isArray(req.body?.queries) ? req.body.queries : [];
    const requestedOffset =
      typeof req.body?.offset === 'number' && Number.isFinite(req.body.offset)
        ? Math.max(0, Math.floor(req.body.offset))
        : null;
    const requestedLimit =
      typeof req.body?.limit === 'number' && Number.isFinite(req.body.limit)
        ? Math.min(12, Math.max(1, Math.floor(req.body.limit)))
        : 4;
    const excludeSet = new Set<string>(
      Array.isArray(req.body?.excludeGenes)
        ? req.body.excludeGenes
            .filter((g: unknown): g is string => typeof g === 'string')
            .map((g: string) => g.trim().toUpperCase())
            .filter(Boolean)
        : [],
    );

    let cleaned: string[] = Array.from(
      new Set<string>(
        rawQueries
          .filter((q): q is string => typeof q === 'string')
          .map((q) => q.trim())
          .filter((q) => q.length >= 2),
      ),
    ).slice(0, 25);

    let nextOffset: number | undefined;
    let totalCatalogGenes: number | undefined;
    let catalogSource: 'hgnc_live' | 'clingen_fallback' | undefined;

    if (cleaned.length === 0 && requestedOffset !== null) {
      const catalog = await getGenomeCatalog();
      totalCatalogGenes = catalog.entries.length;
      catalogSource = catalog.source;

      const selectedBatch = selectNextUncrawledGenes(
        catalog.entries,
        excludeSet,
        requestedOffset,
        requestedLimit,
      );
      cleaned = selectedBatch.selected.map((g) => g.symbol);
      nextOffset = selectedBatch.nextOffset;

      if (cleaned.length === 0) {
        const emptyPayload: BatchLookupResponse = {
          queries: [],
          results: [],
          variants: [],
          resolvedGenes: [],
          geneMeta: {},
          sources: [],
          nextOffset,
          totalCatalogGenes,
          rateLimited: false,
          catalogSource,
        };
        res.json(emptyPayload);
        return;
      }
    }

    if (cleaned.length === 0) {
      res.status(400).json({
        error: 'Provide an array of 1 to 25 gene symbols, HGVS strings, or rsIDs in "queries", or an "offset" for genome batch crawling.',
      });
      return;
    }

    const sizePerQuery =
      typeof req.body?.limitPerQuery === 'number'
        ? Math.min(18, Math.max(4, Math.floor(req.body.limitPerQuery)))
        : cleaned.length > 6
          ? 10
          : 15;
    const results: BatchLookupQueryStatus[] = [];
    const allVariants: VariantRecord[] = [];
    const seenVariantKey = new Set<string>();
    const resolvedGenes = new Set<string>();
    const geneMeta: Record<string, GeneMetadata> = {};
    let latestSources: LiveDatabaseConnectionInfo[] = [];
    let rateLimited = false;

    // Process in bounded chunks of 4 to respect NCBI / MyVariant rate limits
    for (let i = 0; i < cleaned.length; i += 4) {
      const chunk = cleaned.slice(i, i + 4);
      const settled = await Promise.allSettled(
        chunk.map((q) => executeSingleLookup(q, sizePerQuery)),
      );

      settled.forEach((outcome, idx) => {
        const q = chunk[idx];
        if (outcome.status === 'fulfilled') {
          const payload = outcome.value;
          if (payload.sources.length > 0) latestSources = payload.sources;
          const canonicalGene = payload.resolvedGene || q.toUpperCase();
          resolvedGenes.add(canonicalGene);
          const meta = buildGeneMetadataFromLookup({
            ...payload,
            resolvedGene: canonicalGene,
          });
          if (meta) geneMeta[canonicalGene] = meta;

          for (const v of payload.variants) {
            const key = `${v.gene}:${v.clinvarId}:${v.hgvsC}`;
            if (!seenVariantKey.has(key)) {
              seenVariantKey.add(key);
              allVariants.push(v);
            }
          }
          results.push({
            query: q,
            resolvedGene: payload.resolvedGene ?? canonicalGene,
            matchedCount: payload.variants.length,
            status: payload.variants.length > 0 ? 'ok' : 'empty',
            message:
              payload.variants.length > 0
                ? `${payload.variants.length} VUS fetched`
                : 'Connected, 0 VUS matched',
          });
        } else {
          const errMsg =
            outcome.reason instanceof Error
              ? outcome.reason.message
              : 'Lookup error';
          if (isRateLimitErrorMessage(errMsg)) {
            rateLimited = true;
          }
          results.push({
            query: q,
            resolvedGene: null,
            matchedCount: 0,
            status: 'error',
            message: errMsg,
          });
        }
      });
    }

    const batchPayload: BatchLookupResponse = {
      queries: cleaned,
      results,
      variants: allVariants,
      resolvedGenes: Array.from(resolvedGenes).sort(),
      geneMeta,
      sources: latestSources,
      ...(nextOffset !== undefined ? { nextOffset } : {}),
      ...(totalCatalogGenes !== undefined ? { totalCatalogGenes } : {}),
      ...(requestedOffset !== null ? { rateLimited } : {}),
      ...(catalogSource !== undefined ? { catalogSource } : {}),
    };

    res.json(batchPayload);
  });

  app.post('/api/annotate/batch', (req: Request, res: Response) => {
    const rawPayload = typeof req.body?.payload === 'string' ? req.body.payload : '';
    const requestedFormat = req.body?.format;

    if (!rawPayload.trim()) {
      res.status(400).json({ error: 'Provide non-empty sequencing payload text.' });
      return;
    }

    const format =
      requestedFormat === 'vcf' || requestedFormat === 'cma' || requestedFormat === 'tsv'
        ? requestedFormat
        : detectPipelineFormat(rawPayload);

    const parsed =
      format === 'vcf'
        ? parseVcfVariants(rawPayload)
        : format === 'cma'
          ? parseCmaBedVariants(rawPayload)
          : parseImportedCsv(rawPayload);

    const acmgSummary = summarizeAcmgBatch(parsed.variants);
    const response: BatchAnnotateResponse = {
      format,
      totalParsed: parsed.variants.length,
      variants: parsed.variants,
      acmgSummary,
      errors: parsed.errors,
    };

    res.json(response);
  });

  return { app, runLocalDbToolSync };
}

if (!process.env.VERCEL) {
  createApp()
    .then(async ({ app, runLocalDbToolSync }) => {
      const httpServer = http.createServer(app);

if (!process.env.VERCEL) {
  createApp()
    .then(async ({ app, runLocalDbToolSync }) => {
      const httpServer = http.createServer(app);

      if (process.env.NODE_ENV !== 'production') {
        const { createServer: createViteServer } = await import('vite');
        const vite = await createViteServer({
          server: {
            middlewareMode: true,
            ws: { server: httpServer },
            hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
          },
          appType: 'spa',
        });
        app.use(vite.middlewares);
      } else {
        const distDir = path.resolve(__dirname, 'dist');
        app.use(express.static(distDir));
        app.get('*', (_req: Request, res: Response) => {
          const indexFile = path.join(distDir, 'index.html');
          if (fs.existsSync(indexFile)) {
            res.sendFile(indexFile);
          } else {
            res.status(404).send('Build output not found.');
          }
        });
      }

      const port = Number(process.env.PORT ?? 3000);
      httpServer.listen(port, '0.0.0.0', () => {
        console.log(`VUScope server running on http://localhost:${port}`);
        setTimeout(() => {
          void runLocalDbToolSync().catch(() => {});
        }, 1200);
      });
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}
