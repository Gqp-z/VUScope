export type VariantType =
  | 'Missense'
  | 'Splice Region'
  | 'In-frame Indel'
  | 'Synonymous'
  | 'Regulatory / UTR'
  | 'Truncating VUS';

export type ClinVarConflictStatus =
  | 'Uniform VUS'
  | 'Conflicting Interpretations';

export type FunctionalStudyStatus =
  | 'None'
  | 'Preliminary'
  | 'Published Assay';

export type EvaluationTruthStatus =
  | 'reclassified_lp_p'
  | 'functional_impact_confirmed'
  | 'functional_benign_confirmed'
  | 'unvalidated';

export interface SimilarVariantRef {
  hgvs: string;
  aaPos: number;
  classification: 'Pathogenic' | 'Likely Pathogenic' | 'Benign' | 'Likely Benign';
  clinvarId: string;
  distanceAa: number;
}

export interface PubMedArticleRef {
  pmid: string;
  title: string;
  pubdate?: string;
  source?: string;
}

export interface LiveDatabaseConnectionInfo {
  id: 'clinvar' | 'gnomad' | 'pubmed' | 'clingen' | 'ensembl' | 'dbnsfp';
  name: string;
  status: 'connected' | 'partial' | 'unavailable';
  summary: string;
  url?: string;
}

export interface GeneConditionAssociation {
  condition: string;
  inheritance: string;
  clingenValidity: 'Definitive' | 'Strong' | 'Moderate' | 'Limited';
  identifier?: string;
  clinicalSpectrumNote?: string;
  reportUrl?: string | null;
  expertPanel?: string;
}

export interface LiveLookupResponse {
  query: string;
  resolvedGene: string | null;
  totalMatches: number;
  clinvarTotalVus: number | null;
  pubmedArticleCount: number;
  pubmedArticles: PubMedArticleRef[];
  clingenSummary: {
    gene: string;
    classification: 'Definitive' | 'Strong' | 'Moderate' | 'Limited';
    diseaseLabel: string;
    moi: string;
    expertPanel: string;
    reportUrl: string | null;
    actionabilityScore: number;
  } | null;
  geneConditions?: GeneConditionAssociation[];
  geneInfo: {
    symbol: string;
    fullName: string;
    ensemblGeneId: string | null;
    hgncId: string | null;
    interproDomains: string[];
  } | null;
  sources: LiveDatabaseConnectionInfo[];
  variants: VariantRecord[];
}

export interface VariantRecord {
  id: string;
  gene: string;
  hgvsC: string;
  hgvsP: string;
  rsId: string | null;
  clinvarId: string;
  variantType: VariantType;
  aaPosition: number | null;
  proteinDomain: string;
  gnomadAf: number;
  gnomadPopMaxLabel: string;
  clinvarStatus: ClinVarConflictStatus;
  clinvarSubmissions: {
    total: number;
    vus: number;
    lpOrP: number;
    lbOrB: number;
  };
  clinvarLastEvaluated: string;
  functionalStatus: FunctionalStudyStatus;
  pubmedCount: number;
  pubmedIds: string[];
  pubmedArticles?: PubMedArticleRef[];
  functionalSummary: string;
  revelScore: number | null;
  caddPhred: number | null;
  siftScore: number | null;
  polyphenScore: number | null;
  alphaMissenseScore?: number | null;
  alphaMissenseClass?: 'Pathogenic' | 'Ambiguous' | 'Benign' | null;
  similarClassifiedVariants: SimilarVariantRef[];
  sameDomainPathogenicCount: number;
  sameDomainBenignCount: number;
  diseaseAssociation: string;
  associatedConditions?: string[];
  clingenValidity: 'Definitive' | 'Strong' | 'Moderate' | 'Limited';
  clingenActionabilityScore: number;
  clingenReportUrl?: string | null;
  clingenExpertPanel?: string | null;
  ensemblGeneId?: string | null;
  sequencingFormat?: 'Curated' | 'WES' | 'WGS' | 'CMA' | 'Live API' | 'Imported';
  reclassificationHistory?: ReclassificationEvent[];
  evaluationTruth: EvaluationTruthStatus;
  evaluationNote: string;
  sourceType: 'curated' | 'live_api' | 'imported';
}

export type AcmgRuleDirection = 'pathogenic' | 'benign';

export type AcmgEvidenceStrength =
  | 'Very Strong'
  | 'Strong'
  | 'Moderate'
  | 'Supporting'
  | 'Stand-Alone';

export interface AcmgCriterion {
  code: string;
  label: string;
  direction: AcmgRuleDirection;
  strength: AcmgEvidenceStrength;
  points: number;
  autoTriggered: boolean;
  active: boolean;
  rationale: string;
}

export type AcmgClassification =
  | 'Pathogenic'
  | 'Likely Pathogenic'
  | 'Hot VUS'
  | 'VUS'
  | 'Likely Benign'
  | 'Benign';

export interface AcmgAssessment {
  classification: AcmgClassification;
  isHotVus: boolean;
  netPoints: number;
  pathogenicPoints: number;
  benignPoints: number;
  pointsToLikelyPathogenic: number;
  criteria: AcmgCriterion[];
  summary: string;
}

export interface ReclassificationEvent {
  id: string;
  date: string;
  source: 'ClinVar' | 'gnomAD' | 'dbNSFP / AlphaMissense' | 'PubMed Functional' | 'ACMG Curation' | 'Lab Update';
  title: string;
  detail: string;
  impactDirection: 'up' | 'down' | 'neutral';
}

export interface BatchLookupQueryStatus {
  query: string;
  resolvedGene: string | null;
  matchedCount: number;
  status: 'ok' | 'empty' | 'error';
  message?: string;
}

export interface BatchLookupResponse {
  queries: string[];
  results: BatchLookupQueryStatus[];
  variants: VariantRecord[];
  resolvedGenes: string[];
  geneMeta: Record<string, GeneMetadata>;
  sources: LiveDatabaseConnectionInfo[];
  nextOffset?: number;
  totalCatalogGenes?: number;
  rateLimited?: boolean;
  catalogSource?: 'hgnc_live' | 'clingen_fallback';
}

export interface BatchAnnotateResponse {
  format: 'vcf' | 'cma' | 'tsv';
  totalParsed: number;
  variants: VariantRecord[];
  acmgSummary: {
    hotVusCount: number;
    likelyPathogenicCount: number;
    vusCount: number;
    likelyBenignCount: number;
  };
  errors: string[];
}

export interface GenomeGeneCatalogEntry {
  symbol: string;
  name: string;
  hgncId: string | null;
  ensemblGeneId: string | null;
  chromosome: string;
  locusGroup: string;
  clingenClassification: 'Definitive' | 'Strong' | 'Moderate' | 'Limited' | null;
  priorityRank: number;
}

export interface GenomeCatalogResponse {
  totalGenes: number;
  clingenCuratedCount: number;
  source: 'hgnc_live' | 'clingen_fallback';
  offset: number;
  limit: number;
  query: string;
  genes: GenomeGeneCatalogEntry[];
}

export interface GenomeBatchSyncResponse {
  batchGenes: string[];
  resolvedGenes: string[];
  results: BatchLookupQueryStatus[];
  variants: VariantRecord[];
  geneMeta: Record<string, GeneMetadata>;
  totalCatalogGenes: number;
  nextOffset: number;
  rateLimited: boolean;
}

export interface PrioritisationWeights {
  populationFrequency: number;
  clinvarUncertainty: number;
  functionalEvidence: number;
  computationalPredictions: number;
  similarVariantsTrend: number;
  diseaseAssociation: number;
}

export interface ScoringConfig {
  frequencyObjective: 'rare_first' | 'prevalent_first';
  functionalObjective: 'gap_first' | 'studied_first';
}

export interface PrioritisationFilters {
  gene: string;
  condition: string;
  variantType: string;
  clinvarConflict: 'ALL' | 'CONFLICTING' | 'UNIFORM';
  functionalStatus: 'ALL' | 'NONE' | 'HAS_STUDY';
  maxAf: number | null;
  searchQuery: string;
  hotVusOnly?: boolean;
  evaluatedAfter?: string;
  evaluatedBefore?: string;
}

export interface FactorContribution {
  key: keyof PrioritisationWeights;
  label: string;
  rawSubscore: number; // 0..1
  normalizedWeight: number; // 0..1
  weightedPoints: number; // 0..100
  rationale: string;
}

export interface ScoredVariant {
  variant: VariantRecord;
  rank: number;
  priorityScore: number; // 0..100
  contributions: FactorContribution[];
}

export interface ProteinDomain {
  name: string;
  startAa: number;
  endAa: number;
  pathogenicHotspot: boolean;
  description: string;
}

export interface GeneMetadata {
  symbol: string;
  fullName: string;
  chromosome: string;
  proteinLengthAa: number;
  transcriptId: string;
  primaryConditions: string[];
  conditionDetails?: GeneConditionAssociation[];
  clingenValidity: 'Definitive' | 'Strong' | 'Moderate' | 'Limited';
  clingenExpertPanel: string;
  inheritance: string;
  vusBurdenNote: string;
  domains: ProteinDomain[];
}

export interface ResearchPreset {
  id: string;
  name: string;
  description: string;
  weights: PrioritisationWeights;
  config: ScoringConfig;
}

export interface RecallPoint {
  k: number;
  customRecall: number;
  baselineRecall: number;
  customPrecision: number;
  baselinePrecision: number;
}

export interface EvaluationComparisonRow {
  variant: VariantRecord;
  customRank: number;
  baselineRank: number;
  rankGain: number; // positive = custom model ranked it higher (smaller rank number) than baseline
  customScore: number;
}

export interface EvaluationSummary {
  totalEvaluated: number;
  totalPositiveTruth: number;
  precisionAt5Custom: number;
  precisionAt5Baseline: number;
  precisionAt10Custom: number;
  precisionAt10Baseline: number;
  mrrCustom: number;
  mrrBaseline: number;
  enrichmentAt10: number;
  recallCurve: RecallPoint[];
  positiveVariantRows: EvaluationComparisonRow[];
}

export interface CohortSummaryStats {
  total: number;
  conflicting: number;
  unstudied: number;
  topScore: number;
  meanScore: number;
  highInSilicoCount: number;
}

export interface GenomeSyncProgress {
  totalCatalogGenes: number;
  clingenCuratedCount: number;
  fetchedGeneCount: number;
  nextOffset: number;
  isCrawling: boolean;
  rateLimitedUntil: number | null;
  lastBatchLabel: string | null;
  lastSyncedAt: string | null;
  catalogSource: 'hgnc_live' | 'clingen_fallback' | 'loading';
}

export type WorkbenchViewMode = 'all' | 'split' | 'triage' | 'visuals' | 'conditions';

export type ExternalDatabaseToolId =
  | 'clinvar'
  | 'gnomad'
  | 'pubmed'
  | 'clingen'
  | 'ensembl'
  | 'dbnsfp'
  | 'hgnc';

export interface ToolSyncStatus {
  id: ExternalDatabaseToolId;
  name: string;
  status: 'synced' | 'syncing' | 'partial' | 'standby';
  lastSyncedAt: string | null;
  recordsSynced: number;
  detail: string;
}

export interface CodedConditionRecord {
  id: string;
  name: string;
  identifier: string;
  inheritance: string;
  clingenValidity: 'Definitive' | 'Strong' | 'Moderate' | 'Limited';
  genes: string[];
  clinicalSpectrumNote: string;
  curatedDate: string;
}

export interface LocalDbStats {
  totalGenes: number;
  totalVariants: number;
  totalConditions: number;
  hotVusCount: number;
  earliestEvaluationDate: string;
  latestEvaluationDate: string;
  lastSyncedAt: string | null;
  encryptedStoreActive: boolean;
}

export interface LocalDbStateResponse {
  syncedVariants: VariantRecord[];
  syncedGeneMeta: Record<string, GeneMetadata>;
  toolStatuses: ToolSyncStatus[];
  lastSyncedAt: string | null;
  totalSyncRuns: number;
  syncedGenes: string[];
  encryptedAtRest: boolean;
  storeDigestSha256: string;
}

export interface LocalDbSyncResponse {
  syncedGenesBatch: string[];
  addedOrUpdatedVariants: VariantRecord[];
  geneMeta: Record<string, GeneMetadata>;
  toolStatuses: ToolSyncStatus[];
  lastSyncedAt: string;
  totalSyncedVariants: number;
  totalSyncRuns: number;
  rateLimited: boolean;
  storeDigestSha256: string;
}

export interface SecurityStatusResponse {
  firewall: {
    active: boolean;
    inspectedRequests: number;
    blockedRequests: number;
    rateLimitedRequests: number;
    allowedEgressHosts: string[];
    recentBlocks: Array<{
      timestamp: string;
      method: string;
      path: string;
      reason: string;
    }>;
  };
  encryption: {
    cipher: 'AES-256-GCM';
    hmacAlgorithm: 'HMAC-SHA256';
    encryptedAtRest: boolean;
    persistentKeyConfigured: boolean;
    storeDigestSha256: string;
    sourcemapDisabled: boolean;
  };
  integrity: {
    verified: boolean;
    checkedFilesCount: number;
    mismatchedCount: number;
    missingCount: number;
    manifestDigest: string;
    signatureValid: boolean;
    lastCheckedAt: string;
  };
}
