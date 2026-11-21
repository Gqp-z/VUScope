import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Loader2, Search, X } from 'lucide-react';
import type { GenomeCatalogResponse, GenomeGeneCatalogEntry } from '../types/variant';

interface GenomeGenePickerProps {
  id: string;
  label: string;
  value: string;
  loadedGeneCounts: Map<string, number>;
  totalCatalogGenes: number;
  isFetchingGene?: boolean;
  compact?: boolean;
  onSelectGene: (gene: string) => void;
}

export function GenomeGenePicker({
  id,
  label,
  value,
  loadedGeneCounts,
  totalCatalogGenes,
  isFetchingGene = false,
  compact = false,
  onSelectGene,
}: GenomeGenePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [remoteEntries, setRemoteEntries] = useState<GenomeGeneCatalogEntry[]>([]);
  const [isLoadingRemote, setIsLoadingRemote] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const idTimer = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(idTimer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsLoadingRemote(true);
      try {
        const resp = await fetch(
          `/api/genes?q=${encodeURIComponent(query.trim())}&limit=40`,
        );
        if (!resp.ok || cancelled) return;
        const data = (await resp.json()) as GenomeCatalogResponse;
        if (!cancelled && Array.isArray(data.genes)) {
          setRemoteEntries(data.genes);
        }
      } catch {
        // Fallback smoothly to loaded genes list
      } finally {
        if (!cancelled) setIsLoadingRemote(false);
      }
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, query]);

  const localLoadedMatches = useMemo<GenomeGeneCatalogEntry[]>(() => {
    const clean = query.trim().toLowerCase();
    return Array.from(loadedGeneCounts.keys())
      .filter((sym) => !clean || sym.toLowerCase().includes(clean))
      .sort()
      .map((symbol) => ({
        symbol,
        name: 'Indexed in active workspace',
        hgncId: null,
        ensemblGeneId: null,
        chromosome: 'GRCh38',
        locusGroup: 'protein-coding gene',
        clingenClassification: null,
        priorityRank: 0,
      }));
  }, [loadedGeneCounts, query]);

  const mergedEntries = useMemo(() => {
    const seen = new Set<string>();
    const combined: GenomeGeneCatalogEntry[] = [];

    if (!query.trim() && remoteEntries.length > 0) {
      for (const item of localLoadedMatches.slice(0, 12)) {
        if (!seen.has(item.symbol)) {
          seen.add(item.symbol);
          const remoteMatch = remoteEntries.find((r) => r.symbol === item.symbol);
          combined.push(remoteMatch ?? item);
        }
      }
      for (const item of remoteEntries) {
        if (!seen.has(item.symbol)) {
          seen.add(item.symbol);
          combined.push(item);
        }
      }
      return combined;
    }

    for (const item of remoteEntries) {
      if (!seen.has(item.symbol)) {
        seen.add(item.symbol);
        combined.push(item);
      }
    }
    for (const item of localLoadedMatches) {
      if (!seen.has(item.symbol)) {
        seen.add(item.symbol);
        combined.push(item);
      }
    }
    return combined;
  }, [localLoadedMatches, remoteEntries, query]);

  const activeCount = value !== 'ALL' ? loadedGeneCounts.get(value) : undefined;
  const catalogLabel =
    totalCatalogGenes > 0
      ? `${totalCatalogGenes.toLocaleString()} HGNC genes`
      : 'Genome catalog';

  return (
    <div ref={containerRef} className="relative">
      <label
        htmlFor={id}
        className={`block font-medium mb-1 ${
          compact ? 'text-[11px] text-slate-600' : 'text-xs font-semibold text-slate-700'
        }`}
      >
        {label}
      </label>

      <button
        id={id}
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-2 rounded-md border border-slate-300 bg-white text-left text-slate-900 hover:border-blue-700 focus:border-blue-700 focus:outline-none cursor-pointer ${
          compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-1.5 text-sm'
        }`}
      >
        <span className="truncate font-medium">
          {value === 'ALL' ? (
            'All Genes in Workspace'
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="font-mono font-semibold">{value}</span>
              {isFetchingGene ? (
                <span className="text-[11px] text-blue-700">Fetching live...</span>
              ) : activeCount !== undefined ? (
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                  ({activeCount} VUS)
                </span>
              ) : (
                <span className="text-[11px] text-slate-500">(Fetch live)</span>
              )}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1 shrink-0 text-slate-400">
          {isFetchingGene && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-700" />}
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label={`Search ${catalogLabel}`}
          className="absolute left-0 right-0 z-40 mt-1 rounded-md border border-slate-300 bg-white shadow-lg overflow-hidden min-w-[260px]"
        >
          <div className="border-b border-slate-200 bg-slate-50 p-2 space-y-1.5">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400"
                aria-hidden="true"
              />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${catalogLabel} (e.g. TTN, KCNQ1)...`}
                className="w-full rounded border border-slate-300 bg-white pl-8 pr-7 py-1 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear gene filter query"
                  onClick={() => setQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono tabular-nums">
              <span>{catalogLabel}</span>
              <span>{isLoadingRemote ? 'Searching HGNC...' : `${mergedEntries.length} shown`}</span>
            </div>
          </div>

          <ul role="listbox" className="max-h-60 overflow-y-auto divide-y divide-slate-100 text-xs">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={value === 'ALL'}
                onClick={() => {
                  onSelectGene('ALL');
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors cursor-pointer ${
                  value === 'ALL'
                    ? 'bg-blue-50 font-semibold text-blue-900'
                    : 'hover:bg-slate-50 text-slate-800'
                }`}
              >
                <span>All Genes in Workspace</span>
                <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                  {loadedGeneCounts.size} loaded
                </span>
              </button>
            </li>

            {mergedEntries.map((entry) => {
              const cachedCount = loadedGeneCounts.get(entry.symbol);
              const isSelected = value === entry.symbol;
              return (
                <li key={entry.symbol}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onSelectGene(entry.symbol);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-blue-50 text-blue-900'
                        : 'hover:bg-slate-50 text-slate-800'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-semibold text-slate-900">
                          {entry.symbol}
                        </span>
                        {entry.clingenClassification && (
                          <span className="rounded border border-slate-200 bg-slate-100 px-1 py-0.2 font-mono text-[9px] font-medium text-slate-700">
                            ClinGen {entry.clingenClassification}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[10px] text-slate-500">
                        {entry.name}
                      </div>
                    </div>

                    <span
                      className={`shrink-0 font-mono text-[10px] tabular-nums ${
                        cachedCount !== undefined
                          ? 'font-semibold text-emerald-700'
                          : 'text-blue-700'
                      }`}
                    >
                      {cachedCount !== undefined ? `${cachedCount} VUS` : 'Fetch live'}
                    </span>
                  </button>
                </li>
              );
            })}

            {mergedEntries.length === 0 && !isLoadingRemote && (
              <li className="px-3 py-4 text-center text-[11px] text-slate-500">
                No HGNC protein-coding gene matched &ldquo;{query}&rdquo;.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
