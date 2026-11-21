import {
  CODED_CONDITIONS,
  EXTENDED_CODED_VUS,
  EXTENDED_GENE_METADATA,
} from '../data/extendedGenomes';
import { GENE_METADATA } from '../data/genes';
import { CURATED_VARIANTS } from '../data/variants';
import type {
  CodedConditionRecord,
  ExternalDatabaseToolId,
  GeneMetadata,
  LiveDatabaseConnectionInfo,
  LocalDbStats,
  PrioritisationFilters,
  ReclassificationEvent,
  ToolSyncStatus,
  VariantRecord,
} from '../types/variant';
import { evaluateAcmgCriteria } from './acmgAutomation';
import { filterVariants } from './prioritisation';

export interface LocalGenomicDatabase {
  genesBySymbol: Record<string, GeneMetadata>;
  variants: VariantRecord[];
  conditions: CodedConditionRecord[];
  toolStatuses: ToolSyncStatus[];
  lastSyncedAt: string | null;
  totalSyncRuns: number;
  encryptedStoreActive: boolean;
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

function buildCoreConditionsFromGeneMeta(): CodedConditionRecord[] {
  const seen = new Map<string, CodedConditionRecord>();

  for (const cond of CODED_CONDITIONS) {
    seen.set(cond.name.toLowerCase(), {
      ...cond,
      genes: [...cond.genes],
    });
  }

  for (const meta of Object.values(GENE_METADATA)) {
    const details = meta.conditionDetails ?? [];
    if (details.length > 0) {
      for (const d of details) {
        const key = d.condition.trim().toLowerCase();
        const existing = seen.get(key);
        if (existing) {
          if (!existing.genes.includes(meta.symbol)) {
            existing.genes.push(meta.symbol);
          }
        } else {
          seen.set(key, {
            id: `cond-core-${seen.size + 1}-${meta.symbol.toLowerCase()}`,
            name: d.condition,
            identifier: d.identifier ?? `CLINGEN:${meta.symbol}`,
            inheritance: d.inheritance,
            clingenValidity: d.clingenValidity,
            genes: [meta.symbol],
            clinicalSpectrumNote:
              d.clinicalSpectrumNote ?? `${meta.symbol} primary curated spectrum`,
            curatedDate: '2026-01-15',
          });
        }
      }
    } else {
      for (const condName of meta.primaryConditions) {
        const key = condName.trim().toLowerCase();
        if (!seen.has(key)) {
          seen.set(key, {
            id: `cond-core-${seen.size + 1}-${meta.symbol.toLowerCase()}`,
            name: condName,
            identifier: `CLINGEN:${meta.symbol}`,
            inheritance: meta.inheritance,
            clingenValidity: meta.clingenValidity,
            genes: [meta.symbol],
            clinicalSpectrumNote: meta.vusBurdenNote,
            curatedDate: '2026-01-15',
          });
        }
      }
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export const INITIAL_TOOL_SYNC_STATUSES: ToolSyncStatus[] = [
  {
    id: 'clinvar',
    name: 'ClinVar (NCBI)',
    status: 'synced',
    lastSyncedAt: null,
    recordsSynced: CURATED_VARIANTS.length + EXTENDED_CODED_VUS.length,
    detail: 'Embedded archive indexed; ready for live NCBI ClinVar delta sync',
  },
  {
    id: 'gnomad',
    name: 'gnomAD v4',
    status: 'synced',
    lastSyncedAt: null,
    recordsSynced: CURATED_VARIANTS.length + EXTENDED_CODED_VUS.length,
    detail: 'Exome/Genome allele frequencies & PopMax baselines embedded',
  },
  {
    id: 'pubmed',
    name: 'PubMed (NCBI)',
    status: 'synced',
    lastSyncedAt: null,
    recordsSynced: CURATED_VARIANTS.length + EXTENDED_CODED_VUS.length,
    detail: 'Curated functional assay PMIDs; auto-queries NCBI E-utilities',
  },
  {
    id: 'clingen',
    name: 'ClinGen Validity',
    status: 'synced',
    lastSyncedAt: null,
    recordsSynced: Object.keys(GENE_METADATA).length + Object.keys(EXTENDED_GENE_METADATA).length,
    detail: 'Expert panel gene-disease curations & MONDO/OMIM identifiers loaded',
  },
  {
    id: 'ensembl',
    name: 'Ensembl / InterPro',
    status: 'synced',
    lastSyncedAt: null,
    recordsSynced: Object.keys(GENE_METADATA).length + Object.keys(EXTENDED_GENE_METADATA).length,
    detail: 'GRCh38 Ensembl IDs & functional protein domain coordinates coded',
  },
  {
    id: 'dbnsfp',
    name: 'dbNSFP & AlphaMissense',
    status: 'synced',
    lastSyncedAt: null,
    recordsSynced: CURATED_VARIANTS.length + EXTENDED_CODED_VUS.length,
    detail: 'REVEL, AlphaMissense, CADD Phred, SIFT & PolyPhen-2 calibrated',
  },
  {
    id: 'hgnc',
    name: 'HGNC Genome Catalog',
    status: 'synced',
    lastSyncedAt: null,
    recordsSynced: Object.keys(GENE_METADATA).length + Object.keys(EXTENDED_GENE_METADATA).length,
    detail: 'Approved human protein-coding gene nomenclature aligned',
  },
];

const IMMUTABLE_SEED_GENES = deepFreeze<Record<string, GeneMetadata>>({
  ...EXTENDED_GENE_METADATA,
  ...GENE_METADATA,
});

const IMMUTABLE_SEED_VARIANTS = deepFreeze<VariantRecord[]>([
  ...CURATED_VARIANTS,
  ...EXTENDED_CODED_VUS,
]);

const IMMUTABLE_SEED_CONDITIONS = deepFreeze<CodedConditionRecord[]>(
  buildCoreConditionsFromGeneMeta(),
);

export function initializeLocalGenomicDb(): LocalGenomicDatabase {
  const genesCopy: Record<string, GeneMetadata> = {};
  for (const [sym, meta] of Object.entries(IMMUTABLE_SEED_GENES)) {
    genesCopy[sym] = {
      ...meta,
      primaryConditions: [...meta.primaryConditions],
      conditionDetails: meta.conditionDetails ? [...meta.conditionDetails] : undefined,
      domains: [...meta.domains],
    };
  }

  return {
    genesBySymbol: genesCopy,
    variants: IMMUTABLE_SEED_VARIANTS.map((v) => ({ ...v })),
    conditions: IMMUTABLE_SEED_CONDITIONS.map((c) => ({
      ...c,
      genes: [...c.genes],
    })),
    toolStatuses: INITIAL_TOOL_SYNC_STATUSES.map((t) => ({ ...t })),
    lastSyncedAt: null,
    totalSyncRuns: 0,
    encryptedStoreActive: false,
  };
}

export function queryLocalGenomicDatabase(
  db: LocalGenomicDatabase,
  filters: PrioritisationFilters,
): VariantRecord[] {
  return filterVariants(db.variants, filters, db.genesBySymbol);
}

export function mergeVariantIntoLocalList(
  existingVariants: VariantRecord[],
  incoming: VariantRecord[],
  syncedAtIso?: string,
  preserveOrder = true,
): VariantRecord[] {
  if (incoming.length === 0) return existingVariants;

  const incomingByClinvar = new Map<string, VariantRecord>();
  const incomingByHgvs = new Map<string, VariantRecord>();
  for (const inc of incoming) {
    if (inc.clinvarId && inc.clinvarId !== 'ClinVar-Pending') {
      incomingByClinvar.set(`${inc.gene}:${inc.clinvarId}`, inc);
    }
    if (inc.hgvsC) {
      incomingByHgvs.set(`${inc.gene}:${inc.hgvsC}`, inc);
    }
  }

  const matchedKeys = new Set<string>();
  const syncDate = (syncedAtIso ?? new Date().toISOString()).slice(0, 10);

  const updatedPrev = existingVariants.map((existing) => {
    const hit =
      incomingByClinvar.get(`${existing.gene}:${existing.clinvarId}`) ??
      incomingByHgvs.get(`${existing.gene}:${existing.hgvsC}`);
    if (!hit) return existing;
    matchedKeys.add(`${hit.gene}:${hit.clinvarId}:${hit.hgvsC}`);

    if (existing.sourceType === 'curated') {
      const extraHistory: ReclassificationEvent[] = [...(existing.reclassificationHistory ?? [])];
      if (
        existing.gnomadAf === 0 &&
        hit.gnomadAf > 0 &&
        !extraHistory.some((e) => e.title.includes('gnomAD v4 live delta'))
      ) {
        extraHistory.unshift({
          id: `sync-af-${existing.id}-${syncDate}`,
          date: syncDate,
          source: 'gnomAD',
          title: 'gnomAD v4 live delta synchronized',
          detail: `Updated allele frequency to ${hit.gnomadAf.toExponential(2)} (${hit.gnomadPopMaxLabel}).`,
          impactDirection: hit.gnomadAf > 0.001 ? 'down' : 'neutral',
        });
      }

      return {
        ...existing,
        gnomadAf:
          existing.gnomadAf === 0 && hit.gnomadAf > 0 ? hit.gnomadAf : existing.gnomadAf,
        gnomadPopMaxLabel:
          existing.gnomadAf === 0 && hit.gnomadAf > 0
            ? hit.gnomadPopMaxLabel
            : existing.gnomadPopMaxLabel,
        alphaMissenseScore: existing.alphaMissenseScore ?? hit.alphaMissenseScore,
        alphaMissenseClass: existing.alphaMissenseClass ?? hit.alphaMissenseClass,
        pubmedCount: Math.max(existing.pubmedCount, hit.pubmedCount),
        pubmedArticles:
          hit.pubmedArticles && hit.pubmedArticles.length > 0
            ? hit.pubmedArticles
            : existing.pubmedArticles,
        ensemblGeneId: existing.ensemblGeneId ?? hit.ensemblGeneId,
        clingenReportUrl: existing.clingenReportUrl ?? hit.clingenReportUrl,
        clingenExpertPanel: existing.clingenExpertPanel ?? hit.clingenExpertPanel,
        reclassificationHistory: extraHistory.length > 0 ? extraHistory : existing.reclassificationHistory,
      };
    }

    return hit;
  });

  const brandNew = incoming.filter(
    (inc) => !matchedKeys.has(`${inc.gene}:${inc.clinvarId}:${inc.hgvsC}`),
  );

  return preserveOrder ? [...updatedPrev, ...brandNew] : [...brandNew, ...updatedPrev];
}

export function reconcileExternalToolSync(
  db: LocalGenomicDatabase,
  incomingVariants: VariantRecord[],
  incomingGeneMeta: Record<string, GeneMetadata>,
  sources: LiveDatabaseConnectionInfo[],
  syncedAtIso: string,
): LocalGenomicDatabase {
  const nextGenesBySymbol: Record<string, GeneMetadata> = {
    ...db.genesBySymbol,
  };
  for (const [sym, meta] of Object.entries(incomingGeneMeta)) {
    const existing = nextGenesBySymbol[sym];
    if (!existing) {
      nextGenesBySymbol[sym] = meta;
    } else {
      const mergedConds = Array.from(
        new Set([...existing.primaryConditions, ...meta.primaryConditions]),
      );
      nextGenesBySymbol[sym] = {
        ...existing,
        primaryConditions: mergedConds,
        conditionDetails:
          existing.conditionDetails && existing.conditionDetails.length > 0
            ? existing.conditionDetails
            : meta.conditionDetails,
        vusBurdenNote: meta.vusBurdenNote || existing.vusBurdenNote,
      };
    }
  }

  const nextVariants = mergeVariantIntoLocalList(
    db.variants,
    incomingVariants,
    syncedAtIso,
    true,
  );

  const condMap = new Map<string, CodedConditionRecord>();
  for (const c of db.conditions) {
    condMap.set(c.name.toLowerCase(), { ...c, genes: [...c.genes] });
  }
  for (const meta of Object.values(nextGenesBySymbol)) {
    for (const condName of meta.primaryConditions) {
      const key = condName.trim().toLowerCase();
      if (!key) continue;
      const hit = condMap.get(key);
      if (hit) {
        if (!hit.genes.includes(meta.symbol)) hit.genes.push(meta.symbol);
      } else {
        condMap.set(key, {
          id: `cond-sync-${condMap.size + 1}`,
          name: condName,
          identifier: `CLINVAR:${meta.symbol}`,
          inheritance: meta.inheritance,
          clingenValidity: meta.clingenValidity,
          genes: [meta.symbol],
          clinicalSpectrumNote: meta.vusBurdenNote,
          curatedDate: syncedAtIso.slice(0, 10),
        });
      }
    }
  }

  const sourceById = new Map<ExternalDatabaseToolId, LiveDatabaseConnectionInfo>();
  for (const src of sources) {
    sourceById.set(src.id, src);
  }

  const totalVariantsCount = nextVariants.length;
  const totalGenesCount = Object.keys(nextGenesBySymbol).length;

  const nextToolStatuses: ToolSyncStatus[] = db.toolStatuses.map((tool) => {
    const live = sourceById.get(tool.id);
    if (!live && tool.id !== 'hgnc') {
      return {
        ...tool,
        lastSyncedAt: syncedAtIso,
        recordsSynced:
          tool.id === 'clingen' || tool.id === 'ensembl'
            ? totalGenesCount
            : totalVariantsCount,
      };
    }
    if (tool.id === 'hgnc') {
      return {
        ...tool,
        status: 'synced',
        lastSyncedAt: syncedAtIso,
        recordsSynced: totalGenesCount,
        detail: `${totalGenesCount} clinical & synced protein-coding genes indexed`,
      };
    }
    return {
      ...tool,
      status: live?.status === 'connected' ? 'synced' : 'partial',
      lastSyncedAt: syncedAtIso,
      recordsSynced:
        tool.id === 'clingen' || tool.id === 'ensembl'
          ? totalGenesCount
          : totalVariantsCount,
      detail: live?.summary || tool.detail,
    };
  });

  return {
    genesBySymbol: nextGenesBySymbol,
    variants: nextVariants,
    conditions: Array.from(condMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    toolStatuses: nextToolStatuses,
    lastSyncedAt: syncedAtIso,
    totalSyncRuns: db.totalSyncRuns + 1,
    encryptedStoreActive: db.encryptedStoreActive,
  };
}

export function getLocalDbStatistics(db: LocalGenomicDatabase): LocalDbStats {
  let earliest = '9999-99-99';
  let latest = '0000-00-00';
  let hotVusCount = 0;

  for (const v of db.variants) {
    if (evaluateAcmgCriteria(v).isHotVus) {
      hotVusCount += 1;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(v.clinvarLastEvaluated)) {
      if (v.clinvarLastEvaluated < earliest) earliest = v.clinvarLastEvaluated;
      if (v.clinvarLastEvaluated > latest) latest = v.clinvarLastEvaluated;
    }
  }

  return {
    totalGenes: Object.keys(db.genesBySymbol).length,
    totalVariants: db.variants.length,
    totalConditions: db.conditions.length,
    hotVusCount,
    earliestEvaluationDate: earliest === '9999-99-99' ? '2021-01-01' : earliest,
    latestEvaluationDate: latest === '0000-00-00' ? '2026-04-01' : latest,
    lastSyncedAt: db.lastSyncedAt,
    encryptedStoreActive: db.encryptedStoreActive,
  };
}

export function getPrioritySyncGeneSequence(): string[] {
  return Object.keys(IMMUTABLE_SEED_GENES);
}
