import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { CohortTriplePaneView } from './components/CohortTriplePaneView';
import { CompareCohortsView } from './components/CompareCohortsView';
import { ConditionVariantOverlapPanel } from './components/ConditionVariantOverlapPanel';
import { ControlSidebar } from './components/ControlSidebar';
import { DomainLollipopChart } from './components/DomainLollipopChart';
import { EvaluationView } from './components/EvaluationView';
import { Header, type ActiveTab } from './components/Header';
import { LookupImportModal } from './components/LookupImportModal';
import { MethodologyView } from './components/MethodologyView';
import { SecuritySyncModal } from './components/SecuritySyncModal';
import { VariantCorrelationHeatmap } from './components/VariantCorrelationHeatmap';
import { VariantDossier } from './components/VariantDossier';
import { VariantRankingTable } from './components/VariantRankingTable';
import { WorkbenchSearchBar } from './components/WorkbenchSearchBar';
import { GENE_METADATA, RESEARCH_PRESETS } from './data/genes';
import type {
  BatchLookupResponse,
  GeneMetadata,
  GenomeCatalogResponse,
  LiveLookupResponse,
  LocalDbStateResponse,
  LocalDbSyncResponse,
  PrioritisationFilters,
  PrioritisationWeights,
  ReclassificationEvent,
  ScoringConfig,
  SecurityStatusResponse,
  VariantRecord,
  WorkbenchViewMode,
} from './types/variant';
import type { AcmgRuleOverrides } from './utils/acmgAutomation';
import {
  getLocalDbStatistics,
  initializeLocalGenomicDb,
  mergeVariantIntoLocalList,
  reconcileExternalToolSync,
  type LocalGenomicDatabase,
} from './utils/localGenomicDb';
import {
  applySearchQueryWithSmartGeneScope,
  DEFAULT_CONFIG,
  DEFAULT_FILTERS,
  DEFAULT_WEIGHTS,
  evaluateAgainstBaseline,
  findMatchingPresetId,
  getAvailableConditionsForGene,
  scoreAndRankVariants,
  summarizeScoredCohort,
  variantsToCsv,
} from './utils/prioritisation';

const VIEW_MODES: Array<{ id: WorkbenchViewMode; label: string }> = [
  { id: 'all', label: 'All Panels' },
  { id: 'split', label: 'Queue + Dossier Split' },
  { id: 'triage', label: 'Triple-Pane Triage' },
  { id: 'visuals', label: 'Domains & Heatmap' },
  { id: 'conditions', label: 'Conditions & Overlap' },
];

export default function App() {
  const [localDb, setLocalDb] = useState<LocalGenomicDatabase>(() =>
    initializeLocalGenomicDb(),
  );
  const [activeTab, setActiveTab] = useState<ActiveTab>('workbench');
  const [viewMode, setViewMode] = useState<WorkbenchViewMode>('all');
  const [weights, setWeights] = useState<PrioritisationWeights>(DEFAULT_WEIGHTS);
  const [config, setConfig] = useState<ScoringConfig>(DEFAULT_CONFIG);
  const [filters, setFilters] = useState<PrioritisationFilters>(DEFAULT_FILTERS);
  const [evalGene, setEvalGene] = useState<string>('ALL');
  const [evalVariantType, setEvalVariantType] = useState<string>('ALL');
  const [autoExpandedFromGene, setAutoExpandedFromGene] = useState<string | null>(null);
  const [activePresetId, setActivePresetId] = useState<string | null>('balanced');
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [isLookupOpen, setIsLookupOpen] = useState(false);
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState(false);

  const [isLiveSearching, setIsLiveSearching] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveResult, setLiveResult] = useState<LiveLookupResponse | null>(null);
  const [isRefreshingDossier, setIsRefreshingDossier] = useState(false);

  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  const [totalCatalogGenes, setTotalCatalogGenes] = useState(0);
  const [lastSyncedBatchLabel, setLastSyncedBatchLabel] = useState<string | null>(null);
  const [firewallBlockedCount, setFirewallBlockedCount] = useState(0);
  const [integrityVerified, setIntegrityVerified] = useState(true);

  const syncedGenesRef = useRef<Set<string>>(new Set());
  const syncedVariantsRef = useRef<Set<string>>(new Set());

  const [acmgOverridesByVariant, setAcmgOverridesByVariant] = useState<
    Record<string, AcmgRuleOverrides>
  >({});

  const variants = localDb.variants;
  const mergedGeneMeta = localDb.genesBySymbol;
  const localDbStats = useMemo(() => getLocalDbStatistics(localDb), [localDb]);

  const availableGenes = useMemo(() => {
    const set = new Set<string>(variants.map((v) => v.gene));
    return Array.from(set).sort();
  }, [variants]);

  const { geneIndexCounts, fetchedGeneCounts } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of variants) {
      counts.set(v.gene, (counts.get(v.gene) ?? 0) + 1);
    }
    const list = Array.from(counts.entries())
      .map(([gene, count]) => ({ gene, count }))
      .sort((a, b) => b.count - a.count || a.gene.localeCompare(b.gene));
    const record: Record<string, number> = {};
    counts.forEach((count, gene) => {
      record[gene] = count;
    });
    return { geneIndexCounts: list, fetchedGeneCounts: record };
  }, [variants]);

  const availableConditions = useMemo(
    () =>
      getAvailableConditionsForGene(
        variants,
        filters.gene,
        filters.condition,
        mergedGeneMeta,
      ),
    [variants, filters.gene, filters.condition, mergedGeneMeta],
  );

  const scoredVariants = useMemo(
    () => scoreAndRankVariants(variants, weights, filters, config, mergedGeneMeta),
    [variants, weights, filters, config, mergedGeneMeta],
  );

  const selectedScoredVariant = useMemo(() => {
    if (scoredVariants.length === 0) return null;
    return (
      scoredVariants.find((s) => s.variant.id === selectedVariantId) ?? scoredVariants[0]
    );
  }, [scoredVariants, selectedVariantId]);

  const activeLollipopGene = useMemo(() => {
    if (filters.gene !== 'ALL') {
      return filters.gene;
    }
    const selGene = selectedScoredVariant?.variant.gene;
    if (selGene) {
      return selGene;
    }
    return 'BRCA1';
  }, [filters.gene, selectedScoredVariant]);

  const evaluationSummary = useMemo(
    () =>
      evaluateAgainstBaseline(
        variants,
        weights,
        {
          ...DEFAULT_FILTERS,
          gene: evalGene,
          variantType: evalVariantType,
        },
        config,
        mergedGeneMeta,
      ),
    [variants, weights, evalGene, evalVariantType, config, mergedGeneMeta],
  );

  const stats = useMemo(
    () => summarizeScoredCohort(scoredVariants),
    [scoredVariants],
  );

  const mergeIncomingVariants = useCallback(
    (incoming: VariantRecord[], preserveCuratedOrder = false) => {
      if (incoming.length === 0) return;
      const nowIso = new Date().toISOString();
      setLocalDb((prev) => ({
        ...prev,
        variants: mergeVariantIntoLocalList(
          prev.variants,
          incoming,
          nowIso,
          preserveCuratedOrder,
        ),
      }));
    },
    [],
  );

  const mergeLiveGeneMetadata = useCallback((payload: LiveLookupResponse) => {
    const sym = payload.resolvedGene;
    if (!sym || GENE_METADATA[sym]) return;
    const maxAa = payload.variants.reduce(
      (m, v) => Math.max(m, v.aaPosition ?? 0),
      0,
    );
    const liveConditions =
      payload.geneConditions && payload.geneConditions.length > 0
        ? payload.geneConditions.map((c) => c.condition)
        : payload.clingenSummary
          ? [payload.clingenSummary.diseaseLabel]
          : [`${sym}-associated phenotype`];

    setLocalDb((prev) => {
      const existing = prev.genesBySymbol[sym];
      const nextMeta: GeneMetadata = existing
        ? {
            ...existing,
            primaryConditions: Array.from(
              new Set([...existing.primaryConditions, ...liveConditions]),
            ),
            conditionDetails:
              existing.conditionDetails && existing.conditionDetails.length > 0
                ? existing.conditionDetails
                : payload.geneConditions,
          }
        : {
            symbol: sym,
            fullName: payload.geneInfo?.fullName || `${sym} (Synced Local DB)`,
            chromosome: 'GRCh38',
            proteinLengthAa: Math.max(
              400,
              Math.ceil(((maxAa || 500) * 1.15) / 50) * 50,
            ),
            transcriptId: payload.geneInfo?.ensemblGeneId || 'Ensembl Live',
            primaryConditions: liveConditions,
            conditionDetails: payload.geneConditions,
            clingenValidity: payload.clingenSummary?.classification || 'Moderate',
            clingenExpertPanel:
              payload.clingenSummary?.expertPanel || 'ClinGen Live Curation',
            inheritance: payload.clingenSummary?.moi || 'Curated',
            vusBurdenNote:
              payload.clinvarTotalVus !== null
                ? `${payload.clinvarTotalVus.toLocaleString()} VUS in ClinVar`
                : 'Synced into Local Genomic DB',
            domains: [],
          };

      return {
        ...prev,
        genesBySymbol: {
          ...prev.genesBySymbol,
          [sym]: nextMeta,
        },
      };
    });
  }, []);

  const syncLocalDatabaseWithTools = useCallback(
    async (requestedGenes?: string[]) => {
      setIsAutoSyncing(true);
      try {
        const resp = await fetch('/api/local-db/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            requestedGenes && requestedGenes.length > 0
              ? { genes: requestedGenes }
              : {},
          ),
        });
        if (!resp.ok) return;
        const payload = (await resp.json()) as LocalDbSyncResponse;
        for (const g of payload.syncedGenesBatch) {
          syncedGenesRef.current.add(g.toUpperCase());
        }
        setLastSyncedBatchLabel(payload.syncedGenesBatch.join(', '));
        setLocalDb((prev) => {
          const reconciled = reconcileExternalToolSync(
            prev,
            payload.addedOrUpdatedVariants,
            payload.geneMeta,
            [],
            payload.lastSyncedAt,
          );
          return {
            ...reconciled,
            toolStatuses:
              payload.toolStatuses.length > 0
                ? payload.toolStatuses
                : reconciled.toolStatuses,
            totalSyncRuns: payload.totalSyncRuns,
            encryptedStoreActive: true,
          };
        });
      } catch {
        // Offline / rate-limit silent fallback keeps embedded Local DB operational
      } finally {
        setIsAutoSyncing(false);
      }
    },
    [],
  );

  // Hydrate encrypted server Local DB state, HGNC catalog count, and security posture on mount
  useEffect(() => {
    let cancelled = false;
    const hydrateLocalDatabase = async () => {
      try {
        const [stateResp, catalogResp, secResp] = await Promise.all([
          fetch('/api/local-db/state').catch(() => null),
          fetch('/api/genes?limit=50').catch(() => null),
          fetch('/api/security/status').catch(() => null),
        ]);

        if (cancelled) return;

        let serverSyncRuns = 0;
        if (stateResp && stateResp.ok) {
          const stateData = (await stateResp.json()) as LocalDbStateResponse;
          serverSyncRuns = stateData.totalSyncRuns;
          for (const g of stateData.syncedGenes ?? []) {
            syncedGenesRef.current.add(g.toUpperCase());
          }
          setLocalDb((prev) => {
            const reconciled = reconcileExternalToolSync(
              prev,
              stateData.syncedVariants ?? [],
              stateData.syncedGeneMeta ?? {},
              [],
              stateData.lastSyncedAt ?? new Date().toISOString(),
            );
            return {
              ...reconciled,
              toolStatuses:
                stateData.toolStatuses && stateData.toolStatuses.length > 0
                  ? stateData.toolStatuses
                  : reconciled.toolStatuses,
              lastSyncedAt: stateData.lastSyncedAt,
              totalSyncRuns: stateData.totalSyncRuns,
              encryptedStoreActive: stateData.encryptedAtRest,
            };
          });
        }

        if (catalogResp && catalogResp.ok) {
          const catData = (await catalogResp.json()) as GenomeCatalogResponse;
          if (!cancelled) {
            setTotalCatalogGenes(catData.totalGenes ?? 0);
          }
        }

        if (secResp && secResp.ok) {
          const secData = (await secResp.json()) as SecurityStatusResponse;
          if (!cancelled) {
            setFirewallBlockedCount(secData.firewall.blockedRequests);
            setIntegrityVerified(secData.integrity.verified);
          }
        }

        // Kick off an automatic multi-tool sync immediately if none has completed yet
        if (!cancelled && serverSyncRuns === 0) {
          void syncLocalDatabaseWithTools();
        }
      } catch {
        // Embedded local database continues working seamlessly offline
      }
    };

    void hydrateLocalDatabase();
    return () => {
      cancelled = true;
    };
  }, [syncLocalDatabaseWithTools]);

  // Automatic periodic synchronization with ClinVar, gnomAD, PubMed, ClinGen, Ensembl, dbNSFP & HGNC
  useEffect(() => {
    if (!autoSyncEnabled) return;
    const intervalId = window.setInterval(() => {
      void syncLocalDatabaseWithTools();
    }, 90_000);
    return () => window.clearInterval(intervalId);
  }, [autoSyncEnabled, syncLocalDatabaseWithTools]);

  const requestLiveGeneFetch = useCallback(
    async (geneSymbol: string) => {
      const geneUpper = geneSymbol.trim().toUpperCase();
      if (!geneUpper || geneUpper === 'ALL') return;
      if (syncedGenesRef.current.has(geneUpper)) return;
      syncedGenesRef.current.add(geneUpper);

      setIsAutoSyncing(true);
      try {
        const resp = await fetch(`/api/lookup?q=${encodeURIComponent(geneUpper)}`);
        if (!resp.ok) {
          syncedGenesRef.current.delete(geneUpper);
          return;
        }
        const full = (await resp.json()) as LiveLookupResponse;
        mergeLiveGeneMetadata(full);
        if (full.variants.length > 0) {
          mergeIncomingVariants(full.variants, true);
        }
        setLastSyncedBatchLabel(geneUpper);
        setLocalDb((prev) => ({
          ...prev,
          lastSyncedAt: new Date().toISOString(),
        }));
      } catch {
        syncedGenesRef.current.delete(geneUpper);
      } finally {
        setIsAutoSyncing(false);
      }
    },
    [mergeIncomingVariants, mergeLiveGeneMetadata],
  );

  // Instant tool sync whenever user selects any gene not yet externally synced
  useEffect(() => {
    if (filters.gene === 'ALL') return;
    void requestLiveGeneFetch(filters.gene);
  }, [filters.gene, requestLiveGeneFetch]);

  const handleRefreshVariantLive = useCallback(
    async (variant: VariantRecord, silent = false) => {
      const lookupTerm = variant.rsId || `${variant.gene} ${variant.hgvsC}`;
      if (!silent) setIsRefreshingDossier(true);
      try {
        let resp = await fetch(`/api/lookup?q=${encodeURIComponent(lookupTerm)}`);
        let payload = (await resp.json()) as Partial<LiveLookupResponse>;
        if (!resp.ok || !payload.variants || payload.variants.length === 0) {
          resp = await fetch(`/api/lookup?q=${encodeURIComponent(variant.gene)}`);
          payload = (await resp.json()) as Partial<LiveLookupResponse>;
        }
        if (!resp.ok) return;
        const full = payload as LiveLookupResponse;
        mergeLiveGeneMetadata(full);

        const matchedHit =
          full.variants.find((lv) => lv.clinvarId === variant.clinvarId) ??
          full.variants.find((lv) => lv.hgvsC === variant.hgvsC) ??
          full.variants.find((lv) => variant.rsId && lv.rsId === variant.rsId) ??
          null;

        const nowIso = new Date().toISOString();
        setLocalDb((prev) => ({
          ...prev,
          lastSyncedAt: nowIso,
          variants: prev.variants.map((item) => {
            if (item.id !== variant.id) return item;
            const nextAf =
              matchedHit && matchedHit.gnomadAf > 0
                ? matchedHit.gnomadAf
                : item.gnomadAf;
            return {
              ...item,
              gnomadAf: nextAf,
              gnomadPopMaxLabel:
                matchedHit && matchedHit.gnomadAf > 0
                  ? matchedHit.gnomadPopMaxLabel
                  : item.gnomadPopMaxLabel,
              revelScore:
                item.sourceType === 'curated'
                  ? (item.revelScore ?? matchedHit?.revelScore ?? null)
                  : (matchedHit?.revelScore ?? item.revelScore),
              caddPhred:
                item.sourceType === 'curated'
                  ? (item.caddPhred ?? matchedHit?.caddPhred ?? null)
                  : (matchedHit?.caddPhred ?? item.caddPhred),
              siftScore:
                item.sourceType === 'curated'
                  ? (item.siftScore ?? matchedHit?.siftScore ?? null)
                  : (matchedHit?.siftScore ?? item.siftScore),
              polyphenScore:
                item.sourceType === 'curated'
                  ? (item.polyphenScore ?? matchedHit?.polyphenScore ?? null)
                  : (matchedHit?.polyphenScore ?? item.polyphenScore),
              alphaMissenseScore:
                item.sourceType === 'curated'
                  ? (item.alphaMissenseScore ?? matchedHit?.alphaMissenseScore ?? null)
                  : (matchedHit?.alphaMissenseScore ?? item.alphaMissenseScore),
              alphaMissenseClass:
                item.sourceType === 'curated'
                  ? (item.alphaMissenseClass ?? matchedHit?.alphaMissenseClass ?? null)
                  : (matchedHit?.alphaMissenseClass ?? item.alphaMissenseClass),
              pubmedCount: Math.max(item.pubmedCount, full.pubmedArticleCount),
              pubmedIds:
                full.pubmedArticles.length > 0
                  ? full.pubmedArticles.map((a) => a.pmid)
                  : item.pubmedIds,
              pubmedArticles:
                full.pubmedArticles.length > 0 ? full.pubmedArticles : item.pubmedArticles,
              clingenValidity:
                full.clingenSummary?.classification ?? item.clingenValidity,
              clingenActionabilityScore:
                full.clingenSummary?.actionabilityScore ?? item.clingenActionabilityScore,
              clingenReportUrl:
                full.clingenSummary?.reportUrl ?? item.clingenReportUrl,
              clingenExpertPanel:
                full.clingenSummary?.expertPanel ?? item.clingenExpertPanel,
              associatedConditions:
                item.associatedConditions && item.associatedConditions.length > 0
                  ? item.associatedConditions
                  : full.geneConditions && full.geneConditions.length > 0
                    ? full.geneConditions.map((c) => c.condition)
                    : item.associatedConditions,
              ensemblGeneId: full.geneInfo?.ensemblGeneId ?? item.ensemblGeneId,
            };
          }),
        }));
      } catch {
        // Preserve embedded Local DB data silently if offline
      } finally {
        if (!silent) setIsRefreshingDossier(false);
      }
    },
    [mergeLiveGeneMetadata],
  );

  // Automatic dossier tool-evidence enrichment when selecting a new variant
  useEffect(() => {
    if (!autoSyncEnabled || !selectedScoredVariant) return;
    const v = selectedScoredVariant.variant;
    if (syncedVariantsRef.current.has(v.id)) return;
    syncedVariantsRef.current.add(v.id);
    void handleRefreshVariantLive(v, true);
  }, [autoSyncEnabled, selectedScoredVariant, handleRefreshVariantLive]);

  const handleSelectPreset = (presetId: string) => {
    const preset = RESEARCH_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setWeights({ ...preset.weights });
    setConfig({ ...preset.config });
    setActivePresetId(preset.id);
  };

  const handleWeightChange = (key: keyof PrioritisationWeights, value: number) => {
    const nextWeights = { ...weights, [key]: value };
    setWeights(nextWeights);
    setActivePresetId(findMatchingPresetId(nextWeights, config));
  };

  const handleConfigChange = (next: ScoringConfig) => {
    setConfig(next);
    setActivePresetId(findMatchingPresetId(weights, next));
  };

  const handleResetWeights = () => {
    setWeights(DEFAULT_WEIGHTS);
    setConfig(DEFAULT_CONFIG);
    setActivePresetId('balanced');
  };

  const handleResetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setAutoExpandedFromGene(null);
    setLiveError(null);
  };

  const handleSearchQueryChange = (nextQuery: string) => {
    const resolved = applySearchQueryWithSmartGeneScope(
      variants,
      filters,
      nextQuery,
      mergedGeneMeta,
    );
    setFilters(resolved.filters);
    setAutoExpandedFromGene(resolved.autoExpandedFromGene);
    setLiveError(null);
  };

  const handleClearSearch = () => {
    setFilters((prev) => ({ ...prev, searchQuery: '' }));
    setAutoExpandedFromGene(null);
    setLiveError(null);
  };

  const handleSelectCondition = (condition: string) => {
    setFilters((prev) => ({
      ...prev,
      condition: prev.condition === condition ? 'ALL' : condition,
    }));
  };

  const handleSelectDomainFilter = (domainName: string) => {
    setFilters((prev) => ({
      ...prev,
      searchQuery:
        prev.searchQuery.trim().toLowerCase() === domainName.toLowerCase()
          ? ''
          : domainName,
    }));
    setAutoExpandedFromGene(null);
  };

  const handleAddVariants = (incoming: VariantRecord[]) => {
    mergeIncomingVariants(incoming, false);
    if (incoming.length > 0) {
      setFilters((prev) => ({
        ...prev,
        gene: 'ALL',
        condition: 'ALL',
        searchQuery: '',
      }));
      setAutoExpandedFromGene(null);
      setSelectedVariantId(incoming[0].id);
      setActiveTab('workbench');
    }
  };

  const handleAddBatchLookup = (payload: BatchLookupResponse) => {
    if (payload.variants && payload.variants.length > 0) {
      setLocalDb((prev) =>
        reconcileExternalToolSync(
          prev,
          payload.variants,
          payload.geneMeta ?? {},
          payload.sources ?? [],
          new Date().toISOString(),
        ),
      );
      setFilters((prev) => ({
        ...prev,
        gene: 'ALL',
        condition: 'ALL',
        searchQuery: '',
      }));
      setAutoExpandedFromGene(null);
      setSelectedVariantId(payload.variants[0].id);
      setActiveTab('workbench');
    }
    for (const g of payload.resolvedGenes ?? []) {
      syncedGenesRef.current.add(g.toUpperCase());
    }
    setLastSyncedBatchLabel((payload.resolvedGenes ?? []).slice(0, 4).join(', ') || null);
  };

  const handleLiveSearch = async (customQuery?: string) => {
    const q = (customQuery ?? filters.searchQuery).trim();
    if (q.length < 2) {
      setLiveError('Enter at least 2 characters (e.g. PALB2, BRCA2, TP53, or rs80357433).');
      return;
    }

    if (customQuery !== undefined) {
      setFilters((prev) => ({ ...prev, searchQuery: customQuery }));
    }

    setIsLiveSearching(true);
    setLiveError(null);
    try {
      const resp = await fetch(`/api/lookup?q=${encodeURIComponent(q)}`);
      const payload = (await resp.json()) as Partial<LiveLookupResponse> & {
        error?: string;
      };
      if (!resp.ok) {
        setLiveError(payload.error || 'Failed to sync with external genomic tools.');
        return;
      }
      const full = payload as LiveLookupResponse;
      setLiveResult(full);
      mergeLiveGeneMetadata(full);
      if (full.resolvedGene) {
        syncedGenesRef.current.add(full.resolvedGene.toUpperCase());
        setLastSyncedBatchLabel(full.resolvedGene.toUpperCase());
        setLocalDb((prev) => ({
          ...prev,
          lastSyncedAt: new Date().toISOString(),
        }));
      }

      if (full.variants.length === 0) {
        setLiveError(
          `Synced with ClinVar, PubMed & ClinGen, but 0 additional VUS matched "${q}".`,
        );
        return;
      }

      mergeIncomingVariants(full.variants, false);
      const targetGene = full.resolvedGene || full.variants[0].gene;
      const qUpper = q.toUpperCase();
      setFilters((prev) => ({
        ...prev,
        gene: qUpper === targetGene ? targetGene : 'ALL',
        condition: 'ALL',
        searchQuery: customQuery ?? q,
      }));
      setAutoExpandedFromGene(null);
      setSelectedVariantId(full.variants[0].id);
    } catch {
      setLiveError('Network error reaching external tools. Embedded Local Genomic DB remains active.');
    } finally {
      setIsLiveSearching(false);
    }
  };

  const handleToggleAcmgRule = (
    variantId: string,
    code: string,
    nextActive: boolean,
  ) => {
    setAcmgOverridesByVariant((prev) => ({
      ...prev,
      [variantId]: {
        ...(prev[variantId] ?? {}),
        [code]: nextActive,
      },
    }));
  };

  const handleResetAcmgRules = (variantId: string) => {
    setAcmgOverridesByVariant((prev) => {
      const next = { ...prev };
      delete next[variantId];
      return next;
    });
  };

  const handleAddReclassificationNote = (
    variantId: string,
    event: Omit<ReclassificationEvent, 'id'>,
  ) => {
    const newEvent: ReclassificationEvent = {
      ...event,
      id: `lab-${Date.now()}`,
    };
    setLocalDb((prev) => ({
      ...prev,
      variants: prev.variants.map((item) => {
        if (item.id !== variantId) return item;
        return {
          ...item,
          reclassificationHistory: [newEvent, ...(item.reclassificationHistory ?? [])],
        };
      }),
    }));
  };

  const handleExportCsv = () => {
    const csv = variantsToCsv(scoredVariants, weights);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `vuscope-${filters.gene.toLowerCase()}-prioritised.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const hasAnyActiveFilter =
    filters.gene !== 'ALL' ||
    filters.condition !== 'ALL' ||
    filters.variantType !== 'ALL' ||
    filters.clinvarConflict !== 'ALL' ||
    filters.functionalStatus !== 'ALL' ||
    filters.maxAf !== null ||
    filters.searchQuery.trim().length > 0 ||
    Boolean(filters.hotVusOnly) ||
    Boolean(filters.evaluatedAfter) ||
    Boolean(filters.evaluatedBefore);

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-slate-900">
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenLookup={() => setIsLookupOpen(true)}
        onExportCsv={handleExportCsv}
        exportCount={scoredVariants.length}
      />

      {activeTab === 'workbench' && (
        <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col lg:flex-row">
          <ControlSidebar
            availableGenes={availableGenes}
            fetchedGeneCounts={fetchedGeneCounts}
            totalCatalogGenes={totalCatalogGenes}
            availableConditions={availableConditions}
            weights={weights}
            config={config}
            filters={filters}
            activePresetId={activePresetId}
            onSelectPreset={handleSelectPreset}
            onWeightChange={handleWeightChange}
            onConfigChange={handleConfigChange}
            onFilterChange={(next) => {
              setFilters(next);
              setAutoExpandedFromGene(null);
            }}
            onResetWeights={handleResetWeights}
            onResetFilters={handleResetFilters}
          />

          <div className="flex-1 min-w-0 p-5 sm:p-6 space-y-4">
            {/* Workspace Context & 4-KPI Summary Strip */}
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  VUS Research Prioritisation Workbench
                </h1>
                <p className="mt-1 text-xs text-slate-600 max-w-2xl">
                  Directly embedded multi-genome VUS &amp; condition database automatically synchronized with ClinVar, gnomAD v4, PubMed, ClinGen, Ensembl, dbNSFP / AlphaMissense, and HGNC.
                </p>
              </div>
              <div className="flex items-center gap-5 sm:gap-6 font-mono tabular-nums">
                <div>
                  <div className="text-[10px] font-semibold text-slate-400">
                    FILTERED VUS
                  </div>
                  <div className="text-lg font-bold text-slate-900">{stats.total}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-slate-400">
                    CONFLICTING
                  </div>
                  <div className="text-lg font-bold text-amber-700">
                    {stats.conflicting}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-slate-400">
                    UNSTUDIED GAP
                  </div>
                  <div className="text-lg font-bold text-teal-700">
                    {stats.unstudied}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-slate-400">
                    HOT VUS
                  </div>
                  <div className="text-lg font-bold text-rose-700">
                    {localDbStats.hotVusCount}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-slate-400">
                    TOP PRIORITY
                  </div>
                  <div className="text-lg font-bold text-blue-700">
                    {stats.topScore.toFixed(1)}
                  </div>
                </div>
              </div>
            </div>

            <WorkbenchSearchBar
              searchQuery={filters.searchQuery}
              activeGeneFilter={filters.gene}
              autoExpandedFromGene={autoExpandedFromGene}
              isLiveSearching={isLiveSearching}
              liveError={liveError}
              liveResult={liveResult}
              autoSyncEnabled={autoSyncEnabled}
              isAutoSyncing={isAutoSyncing}
              localDbStats={localDbStats}
              toolStatuses={localDb.toolStatuses}
              lastSyncedBatchLabel={lastSyncedBatchLabel}
              firewallBlockedCount={firewallBlockedCount}
              integrityVerified={integrityVerified}
              onToggleAutoSync={() => setAutoSyncEnabled((prev) => !prev)}
              onSyncToolsNow={() => {
                if (!isAutoSyncing) {
                  void syncLocalDatabaseWithTools(
                    filters.gene !== 'ALL' ? [filters.gene] : undefined,
                  );
                }
              }}
              onOpenSecurityModal={() => setIsSecurityModalOpen(true)}
              onSearchQueryChange={handleSearchQueryChange}
              onLiveSearch={handleLiveSearch}
              onClearSearch={handleClearSearch}
              onDismissLiveResult={() => setLiveResult(null)}
            />

            {/* Researcher Workspace Bar: View Mode Switcher & Quick Triage Filters */}
            <div className="rounded-md border border-slate-200 bg-white px-3.5 py-2.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div
                  role="tablist"
                  aria-label="Workbench layout view mode"
                  className="flex flex-wrap items-center gap-1"
                >
                  {VIEW_MODES.map((mode) => {
                    const active = viewMode === mode.id;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setViewMode(mode.id)}
                        className={`rounded border px-2.5 py-1 text-xs transition-colors whitespace-nowrap cursor-pointer ${
                          active
                            ? 'border-blue-700 bg-blue-700 text-white font-semibold'
                            : 'border-slate-200 bg-slate-50 text-slate-700 font-medium hover:border-slate-300 hover:bg-white'
                        }`}
                      >
                        {mode.label}
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-slate-500 font-medium mr-0.5">Quick Triage:</span>
                  <button
                    type="button"
                    aria-pressed={Boolean(filters.hotVusOnly)}
                    onClick={() =>
                      setFilters((prev) => ({
                        ...prev,
                        hotVusOnly: !prev.hotVusOnly,
                      }))
                    }
                    className={`rounded border px-2 py-0.5 font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      filters.hotVusOnly
                        ? 'border-amber-400 bg-amber-50 text-amber-900 font-semibold'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    Hot VUS
                  </button>
                  <button
                    type="button"
                    aria-pressed={filters.clinvarConflict === 'CONFLICTING'}
                    onClick={() =>
                      setFilters((prev) => ({
                        ...prev,
                        clinvarConflict:
                          prev.clinvarConflict === 'CONFLICTING' ? 'ALL' : 'CONFLICTING',
                      }))
                    }
                    className={`rounded border px-2 py-0.5 font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      filters.clinvarConflict === 'CONFLICTING'
                        ? 'border-amber-400 bg-amber-50 text-amber-900 font-semibold'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    Conflicting
                  </button>
                  <button
                    type="button"
                    aria-pressed={filters.functionalStatus === 'NONE'}
                    onClick={() =>
                      setFilters((prev) => ({
                        ...prev,
                        functionalStatus:
                          prev.functionalStatus === 'NONE' ? 'ALL' : 'NONE',
                      }))
                    }
                    className={`rounded border px-2 py-0.5 font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      filters.functionalStatus === 'NONE'
                        ? 'border-teal-400 bg-teal-50 text-teal-900 font-semibold'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    Unstudied Gap
                  </button>
                  <button
                    type="button"
                    aria-pressed={filters.evaluatedAfter === '2025-01-01'}
                    onClick={() =>
                      setFilters((prev) => ({
                        ...prev,
                        evaluatedAfter:
                          prev.evaluatedAfter === '2025-01-01' ? undefined : '2025-01-01',
                        evaluatedBefore: undefined,
                      }))
                    }
                    className={`rounded border px-2 py-0.5 font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      filters.evaluatedAfter === '2025-01-01'
                        ? 'border-blue-400 bg-blue-50 text-blue-900 font-semibold'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    2025–2026 Evaluated
                  </button>
                </div>
              </div>

              {hasAnyActiveFilter && (
                <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2 text-[11px]">
                  <span className="text-slate-500 font-medium">Active Filters:</span>
                  {filters.gene !== 'ALL' && (
                    <button
                      type="button"
                      onClick={() =>
                        setFilters((prev) => ({ ...prev, gene: 'ALL', condition: 'ALL' }))
                      }
                      className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 font-mono text-blue-800 hover:bg-blue-100 cursor-pointer"
                    >
                      <span>Gene: {filters.gene}</span>
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                  {filters.condition !== 'ALL' && (
                    <button
                      type="button"
                      onClick={() =>
                        setFilters((prev) => ({ ...prev, condition: 'ALL' }))
                      }
                      className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-800 hover:bg-blue-100 cursor-pointer"
                    >
                      <span>Condition: {filters.condition}</span>
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                  {filters.variantType !== 'ALL' && (
                    <button
                      type="button"
                      onClick={() =>
                        setFilters((prev) => ({ ...prev, variantType: 'ALL' }))
                      }
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      <span>Type: {filters.variantType}</span>
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                  {filters.maxAf !== null && (
                    <button
                      type="button"
                      onClick={() =>
                        setFilters((prev) => ({ ...prev, maxAf: null }))
                      }
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-2 py-0.5 font-mono text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      <span>AF &le; {filters.maxAf}</span>
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                  {(filters.evaluatedAfter || filters.evaluatedBefore) && (
                    <button
                      type="button"
                      onClick={() =>
                        setFilters((prev) => ({
                          ...prev,
                          evaluatedAfter: undefined,
                          evaluatedBefore: undefined,
                        }))
                      }
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-2 py-0.5 font-mono text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      <span>
                        Dates: {filters.evaluatedAfter ?? '2021'}–{filters.evaluatedBefore ?? '2026'}
                      </span>
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                  {filters.searchQuery.trim() && (
                    <button
                      type="button"
                      onClick={handleClearSearch}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-2 py-0.5 font-mono text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      <span>Query: {filters.searchQuery}</span>
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="ml-auto text-[11px] font-semibold text-blue-700 hover:underline cursor-pointer"
                  >
                    Clear All Filters
                  </button>
                </div>
              )}
            </div>

            {(viewMode === 'all' || viewMode === 'triage') && (
              <CohortTriplePaneView
                scoredVariants={scoredVariants}
                filters={filters}
                selectedVariantId={selectedScoredVariant?.variant.id ?? null}
                onSelectVariant={setSelectedVariantId}
                onFilterChange={(next) => {
                  setFilters(next);
                  setAutoExpandedFromGene(null);
                }}
              />
            )}

            {(viewMode === 'all' || viewMode === 'visuals') && (
              <>
                <DomainLollipopChart
                  geneSymbol={activeLollipopGene}
                  scoredVariants={scoredVariants}
                  selectedVariantId={selectedScoredVariant?.variant.id ?? null}
                  onSelectVariant={setSelectedVariantId}
                  liveGeneMeta={mergedGeneMeta}
                  activeConditionFilter={filters.condition}
                  onSelectCondition={handleSelectCondition}
                  activeSearchQuery={filters.searchQuery}
                  onSelectDomainFilter={handleSelectDomainFilter}
                />

                <VariantCorrelationHeatmap
                  scoredVariants={scoredVariants}
                  selectedVariantId={selectedScoredVariant?.variant.id ?? null}
                  onSelectVariant={setSelectedVariantId}
                />
              </>
            )}

            {(viewMode === 'all' || viewMode === 'conditions') && (
              <ConditionVariantOverlapPanel
                scoredVariants={scoredVariants}
                liveGeneMeta={mergedGeneMeta}
                selectedVariantId={selectedScoredVariant?.variant.id ?? null}
                activeConditionFilter={filters.condition}
                onSelectVariant={setSelectedVariantId}
                onSelectConditionFilter={handleSelectCondition}
              />
            )}

            {viewMode === 'split' ? (
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
                <div className="xl:col-span-7 min-w-0">
                  <VariantRankingTable
                    scoredVariants={scoredVariants}
                    allIndexedVariantsCount={variants.length}
                    geneIndexCounts={geneIndexCounts}
                    activeGeneFilter={filters.gene}
                    onSelectGeneFilter={(gene) => {
                      setFilters((prev) => ({
                        ...prev,
                        gene,
                        condition: 'ALL',
                      }));
                      setAutoExpandedFromGene(null);
                    }}
                    acmgOverridesByVariant={acmgOverridesByVariant}
                    selectedVariantId={selectedScoredVariant?.variant.id ?? null}
                    onSelectVariant={setSelectedVariantId}
                    onResetFilters={handleResetFilters}
                  />
                </div>
                <div className="xl:col-span-5 min-w-0 xl:sticky xl:top-4">
                  <VariantDossier
                    scoredVariant={selectedScoredVariant}
                    liveGeneMeta={mergedGeneMeta}
                    activeConditionFilter={filters.condition}
                    onSelectCondition={handleSelectCondition}
                    onRefreshLive={(v) => void handleRefreshVariantLive(v, false)}
                    isRefreshingLive={isRefreshingDossier}
                    acmgOverrides={
                      selectedScoredVariant
                        ? acmgOverridesByVariant[selectedScoredVariant.variant.id]
                        : undefined
                    }
                    onToggleAcmgRule={handleToggleAcmgRule}
                    onResetAcmgRules={handleResetAcmgRules}
                    onAddReclassificationNote={handleAddReclassificationNote}
                  />
                </div>
              </div>
            ) : (
              <>
                <VariantRankingTable
                  scoredVariants={scoredVariants}
                  allIndexedVariantsCount={variants.length}
                  geneIndexCounts={geneIndexCounts}
                  activeGeneFilter={filters.gene}
                  onSelectGeneFilter={(gene) => {
                    setFilters((prev) => ({
                      ...prev,
                      gene,
                      condition: 'ALL',
                    }));
                    setAutoExpandedFromGene(null);
                  }}
                  acmgOverridesByVariant={acmgOverridesByVariant}
                  selectedVariantId={selectedScoredVariant?.variant.id ?? null}
                  onSelectVariant={setSelectedVariantId}
                  onResetFilters={handleResetFilters}
                />

                <VariantDossier
                  scoredVariant={selectedScoredVariant}
                  liveGeneMeta={mergedGeneMeta}
                  activeConditionFilter={filters.condition}
                  onSelectCondition={handleSelectCondition}
                  onRefreshLive={(v) => void handleRefreshVariantLive(v, false)}
                  isRefreshingLive={isRefreshingDossier}
                  acmgOverrides={
                    selectedScoredVariant
                      ? acmgOverridesByVariant[selectedScoredVariant.variant.id]
                      : undefined
                  }
                  onToggleAcmgRule={handleToggleAcmgRule}
                  onResetAcmgRules={handleResetAcmgRules}
                  onAddReclassificationNote={handleAddReclassificationNote}
                />
              </>
            )}
          </div>
        </main>
      )}

      {activeTab === 'compare' && (
        <main className="flex-1">
          <CompareCohortsView
            variants={variants}
            availableGenes={availableGenes}
            fetchedGeneCounts={fetchedGeneCounts}
            totalCatalogGenes={totalCatalogGenes}
            liveGeneMeta={mergedGeneMeta}
            weights={weights}
            config={config}
            activePresetId={activePresetId}
            onSelectPreset={handleSelectPreset}
            onConfigChange={handleConfigChange}
            onRequestGeneFetch={(geneSymbol) => void requestLiveGeneFetch(geneSymbol)}
            onInspectVariantInWorkbench={(variant, paneFilters) => {
              setFilters(paneFilters);
              setAutoExpandedFromGene(null);
              setSelectedVariantId(variant.id);
              setActiveTab('workbench');
            }}
          />
        </main>
      )}

      {activeTab === 'evaluation' && (
        <main className="flex-1">
          <EvaluationView
            evaluation={evaluationSummary}
            availableGenes={availableGenes}
            evalGene={evalGene}
            evalVariantType={evalVariantType}
            onEvalGeneChange={setEvalGene}
            onEvalVariantTypeChange={setEvalVariantType}
            onEvaluateAll={() => {
              setEvalGene('ALL');
              setEvalVariantType('ALL');
            }}
          />
        </main>
      )}

      {activeTab === 'methodology' && (
        <main className="flex-1">
          <MethodologyView />
        </main>
      )}

      <footer className="border-t border-slate-200 bg-white px-6 py-3 text-xs text-slate-500">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2">
          <span>
            VUScope · Embedded Local Genomic Database ({localDbStats.totalGenes} Genomes, {localDbStats.totalVariants} VUS, {localDbStats.totalConditions} Conditions)
          </span>
          <span>
            Auto-Synced with ClinVar · gnomAD v4 · PubMed · ClinGen · Ensembl / InterPro · dbNSFP · AlphaMissense
          </span>
        </div>
      </footer>

      <LookupImportModal
        isOpen={isLookupOpen}
        onClose={() => setIsLookupOpen(false)}
        onAddVariants={handleAddVariants}
        onAddBatchLookup={handleAddBatchLookup}
      />

      <SecuritySyncModal
        isOpen={isSecurityModalOpen}
        onClose={() => setIsSecurityModalOpen(false)}
        dbStats={localDbStats}
        toolStatuses={localDb.toolStatuses}
        isSyncing={isAutoSyncing}
        onSyncNow={() => void syncLocalDatabaseWithTools()}
        variants={variants}
      />
    </div>
  );
}
