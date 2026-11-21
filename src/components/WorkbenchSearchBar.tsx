import { useEffect, useState } from 'react';
import {
  Database,
  ExternalLink,
  Globe,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import type {
  GenomeCatalogResponse,
  GenomeGeneCatalogEntry,
  LiveLookupResponse,
  LocalDbStats,
  ToolSyncStatus,
} from '../types/variant';

interface WorkbenchSearchBarProps {
  searchQuery: string;
  activeGeneFilter: string;
  autoExpandedFromGene: string | null;
  isLiveSearching: boolean;
  liveError: string | null;
  liveResult: LiveLookupResponse | null;
  autoSyncEnabled: boolean;
  isAutoSyncing: boolean;
  localDbStats: LocalDbStats;
  toolStatuses: ToolSyncStatus[];
  lastSyncedBatchLabel: string | null;
  firewallBlockedCount: number;
  integrityVerified: boolean;
  onToggleAutoSync: () => void;
  onSyncToolsNow: () => void;
  onOpenSecurityModal: () => void;
  onSearchQueryChange: (nextQuery: string) => void;
  onLiveSearch: (customQuery?: string) => void;
  onClearSearch: () => void;
  onDismissLiveResult: () => void;
}

const QUICK_LIVE_QUERIES = ['PALB2', 'BRCA2', 'ATM', 'CHEK2', 'rs80357433'];

export function WorkbenchSearchBar({
  searchQuery,
  activeGeneFilter,
  autoExpandedFromGene,
  isLiveSearching,
  liveError,
  liveResult,
  autoSyncEnabled,
  isAutoSyncing,
  localDbStats,
  toolStatuses,
  lastSyncedBatchLabel,
  firewallBlockedCount,
  integrityVerified,
  onToggleAutoSync,
  onSyncToolsNow,
  onOpenSecurityModal,
  onSearchQueryChange,
  onLiveSearch,
  onClearSearch,
  onDismissLiveResult,
}: WorkbenchSearchBarProps) {
  const [suggestions, setSuggestions] = useState<GenomeGeneCatalogEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Live HGNC catalog autocomplete when typing gene symbol/name
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2 || q.includes(':') || /^rs\d+/i.test(q) || q.includes(' ')) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const resp = await fetch(`/api/genes?q=${encodeURIComponent(q)}&limit=8`);
        if (!resp.ok || cancelled) return;
        const data = (await resp.json()) as GenomeCatalogResponse;
        if (!cancelled) {
          setSuggestions(Array.isArray(data.genes) ? data.genes : []);
        }
      } catch {
        // Ignore typeahead network blips
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  const syncedToolCount = toolStatuses.filter((t) => t.status === 'synced').length;
  const earliestYear = localDbStats.earliestEvaluationDate.slice(0, 4);
  const latestYear = localDbStats.latestEvaluationDate.slice(0, 4);

  return (
    <section
      aria-label="Variant and local genomic database search"
      className="border border-slate-200 bg-white rounded-md p-4 space-y-3"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setShowSuggestions(false);
          onLiveSearch();
        }}
        className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
      >
        <label htmlFor="workbench-search-input" className="sr-only">
          Search local database or query external genomic tools
        </label>
        <div className="relative flex-1 min-w-0">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
            aria-hidden="true"
          />
          <input
            id="workbench-search-input"
            type="text"
            value={searchQuery}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => {
              window.setTimeout(() => setShowSuggestions(false), 160);
            }}
            onChange={(e) => {
              onSearchQueryChange(e.target.value);
              setShowSuggestions(true);
            }}
            placeholder="Filter coded Local DB or query live tools (gene e.g. PALB2, MYBPC3, FBN1; variant R158H; or rsID)"
            className="w-full rounded-md border border-slate-300 bg-white pl-9 pr-9 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
          />
          {searchQuery.length > 0 && (
            <button
              type="button"
              aria-label="Clear search query"
              onClick={() => {
                onClearSearch();
                setSuggestions([]);
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}

          {showSuggestions && suggestions.length > 0 && (
            <div
              role="listbox"
              aria-label="Matching HGNC protein-coding genes"
              className="absolute left-0 right-0 top-full z-30 mt-1 rounded-md border border-slate-300 bg-white shadow-lg overflow-hidden divide-y divide-slate-100"
            >
              <div className="bg-slate-50 px-3 py-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wide flex items-center justify-between">
                <span>HGNC Genome Catalog Matches</span>
                <span>Click to sync into Local DB</span>
              </div>
              {suggestions.map((entry) => (
                <button
                  key={entry.symbol}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setShowSuggestions(false);
                    onLiveSearch(entry.symbol);
                  }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-blue-50/70 cursor-pointer"
                >
                  <div className="min-w-0 truncate">
                    <span className="font-mono font-semibold text-slate-900">
                      {entry.symbol}
                    </span>{' '}
                    <span className="text-slate-500">{entry.name}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 font-mono text-[10px]">
                    {entry.clingenClassification && (
                      <span className="text-slate-600">
                        ClinGen {entry.clingenClassification}
                      </span>
                    )}
                    <span className="font-semibold text-blue-700">Sync &amp; View</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={isLiveSearching || searchQuery.trim().length < 2}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Globe className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{isLiveSearching ? 'Syncing External Tools...' : 'Sync & Search Tools'}</span>
        </button>
      </form>

      {/* Embedded Local Genomic Database & Multi-Tool Auto-Sync Bar */}
      <div className="rounded border border-slate-200 bg-slate-50/75 px-3 py-2 space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-2 text-slate-700 font-mono tabular-nums">
            <span className="font-semibold text-slate-900">
              Local Genomic DB: {localDbStats.totalGenes} Coded Genomes ·{' '}
              {localDbStats.totalVariants} VUS · {localDbStats.totalConditions} Known Conditions
            </span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-600">
              Dates {earliestYear}–{latestYear}
            </span>
            <span className="text-slate-400 hidden sm:inline">·</span>
            <span className="text-blue-700 font-semibold hidden sm:inline">
              {syncedToolCount}/{toolStatuses.length} Tools Synced
            </span>
            {lastSyncedBatchLabel && (
              <>
                <span className="text-slate-400 hidden xl:inline">·</span>
                <span className="text-slate-500 hidden xl:inline">
                  Delta: {lastSyncedBatchLabel}
                </span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              aria-pressed={autoSyncEnabled}
              onClick={onToggleAutoSync}
              className={`rounded border px-2 py-0.5 font-mono font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                autoSyncEnabled
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-slate-300 bg-white text-slate-600'
              }`}
            >
              Auto-Sync: {autoSyncEnabled ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              disabled={isAutoSyncing}
              onClick={onSyncToolsNow}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-700 hover:border-blue-700 hover:text-blue-700 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <RefreshCw
                className={`h-3 w-3 ${isAutoSyncing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{isAutoSyncing ? 'Syncing Tools...' : 'Sync Tools Now'}</span>
            </button>
            <button
              type="button"
              onClick={onOpenSecurityModal}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-700 hover:border-blue-700 hover:text-blue-700 cursor-pointer whitespace-nowrap"
              title="Inspect Firewall, AES-256-GCM Encryption Seal, Code Integrity Guard, and Tool Sync Log"
            >
              <ShieldCheck
                className={`h-3 w-3 ${integrityVerified ? 'text-emerald-700' : 'text-amber-700'}`}
                aria-hidden="true"
              />
              <span>
                Firewall &amp; Seal{firewallBlockedCount > 0 ? ` (${firewallBlockedCount})` : ''}
              </span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500 font-mono">
          {toolStatuses.map((tool) => (
            <span key={tool.id} className="inline-flex items-center gap-1">
              <span
                className={
                  tool.status === 'synced'
                    ? 'text-emerald-700 font-bold'
                    : 'text-amber-700 font-bold'
                }
              >
                {tool.status === 'synced' ? '✓' : '•'}
              </span>
              <span className="text-slate-700">{tool.name}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-slate-600">
            Quick live queries:
          </span>
          {QUICK_LIVE_QUERIES.map((term) => (
            <button
              key={term}
              type="button"
              disabled={isLiveSearching}
              onClick={() => onLiveSearch(term)}
              className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-700 hover:border-blue-700 hover:text-blue-700 disabled:opacity-50 cursor-pointer"
            >
              {term}
            </button>
          ))}
        </div>

        <div className="text-[11px] text-slate-500">
          {autoExpandedFromGene ? (
            <span>
              Expanded gene filter from{' '}
              <strong className="font-mono text-slate-700">{autoExpandedFromGene}</strong> to{' '}
              <strong className="text-slate-700">All Genes</strong> to show cross-cohort matches.
            </span>
          ) : (
            <span>
              Active cohort scope:{' '}
              <strong className="font-mono text-slate-700">
                {activeGeneFilter === 'ALL' ? 'All Coded Genomes' : activeGeneFilter}
              </strong>
              {localDbStats.lastSyncedAt
                ? ` · Last tool sync ${new Date(localDbStats.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : ''}
            </span>
          )}
        </div>
      </div>

      {liveError && (
        <div
          role="alert"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        >
          {liveError}
        </div>
      )}

      {liveResult && (
        <div className="border-t border-slate-200 pt-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-slate-800">
              <Database className="h-3.5 w-3.5 text-blue-700 shrink-0" aria-hidden="true" />
              <span>
                Tool sync for <strong className="font-mono">{liveResult.query}</strong>
                {liveResult.geneInfo?.fullName && (
                  <>
                    {' '}
                    · <span className="text-slate-600">{liveResult.geneInfo.fullName}</span>
                  </>
                )}
                {' '}· Merged <strong className="font-mono">{liveResult.variants.length}</strong> VUS into Local DB
              </span>
            </div>
            <button
              type="button"
              onClick={onDismissLiveResult}
              className="text-[11px] font-medium text-slate-500 hover:text-slate-900 cursor-pointer"
            >
              Hide summary
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {liveResult.sources.map((src) => (
              <div
                key={src.id}
                className="rounded border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{src.name}</span>
                  {src.url && src.url.startsWith('https://') ? (
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline"
                    >
                      <span>Open</span>
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="text-[11px] text-slate-500 capitalize">
                      {src.status}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-600 leading-snug">
                  {src.summary}
                </div>
              </div>
            ))}
          </div>

          {liveResult.pubmedArticles.length > 0 && (
            <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold text-slate-700">Recent PubMed VUS citations:</span>
              {liveResult.pubmedArticles.slice(0, 3).map((art) => (
                <a
                  key={art.pmid}
                  href={`https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(art.pmid)}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-700 hover:underline truncate max-w-xs"
                  title={art.title}
                >
                  PMID:{art.pmid} — {art.title}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
