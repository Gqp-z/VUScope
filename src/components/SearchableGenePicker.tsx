import { Check, ChevronDown, Search, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GENE_METADATA } from '../data/genes';
import type { GenomeCatalogResponse, GenomeGeneCatalogEntry } from '../types/variant';

interface SearchableGenePickerProps {
  id: string;
  value: string;
  availableGenes: string[];
  fetchedGeneCounts?: Record<string, number>;
  totalCatalogGenes?: number;
  onChange: (geneSymbol: string) => void;
  compact?: boolean;
}

export function SearchableGenePicker({
  id,
  value,
  availableGenes,
  fetchedGeneCounts = {},
  totalCatalogGenes = 0,
  onChange,
  compact = false,
}: SearchableGenePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [remoteGenes, setRemoteGenes] = useState<GenomeGeneCatalogEntry[]>([]);
  const [totalMatched, setTotalMatched] = useState<number>(totalCatalogGenes);
  const [isLoading, setIsLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        const resp = await fetch(
          `/api/genes?q=${encodeURIComponent(query.trim())}&limit=30`,
        );
        if (!resp.ok || cancelled) return;
        const data = (await resp.json()) as GenomeCatalogResponse;
        if (cancelled) return;
        setRemoteGenes(data.genes ?? []);
        setTotalMatched(data.totalGenes ?? 0);
      } catch {
        // Offline fallback handled below via local availableGenes
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }, 140);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, query]);

  const fallbackLocalGenes = useMemo<GenomeGeneCatalogEntry[]>(() => {
    const clean = query.trim().toLowerCase();
    return availableGenes
      .filter((sym) => {
        if (!clean) return true;
        const meta = GENE_METADATA[sym];
        return (
          sym.toLowerCase().includes(clean) ||
          (meta?.fullName.toLowerCase().includes(clean) ?? false)
        );
      })
      .slice(0, 30)
      .map((sym) => ({
        symbol: sym,
        name: GENE_METADATA[sym]?.fullName ?? `${sym} indexed cohort`,
        hgncId: null,
        ensemblGeneId: null,
        chromosome: GENE_METADATA[sym]?.chromosome ?? 'GRCh38',
        locusGroup: 'protein-coding gene',
        clingenClassification: GENE_METADATA[sym]?.clingenValidity ?? null,
        priorityRank: 0,
      }));
  }, [availableGenes, query]);

  const displayedGenes = remoteGenes.length > 0 ? remoteGenes : fallbackLocalGenes;

  const selectedCount = value !== 'ALL' ? (fetchedGeneCounts[value] ?? 0) : 0;
  const triggerLabel =
    value === 'ALL'
      ? `All Genes in Workspace (${availableGenes.length} fetched)`
      : selectedCount > 0
        ? `${value} (${selectedCount} VUS)`
        : `${value} (Fetching live...)`;

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-2 rounded-md border border-slate-300 bg-white text-left text-slate-900 hover:border-slate-400 focus:border-blue-700 focus:outline-none cursor-pointer ${
          compact ? 'px-2.5 py-1.5 text-xs font-medium' : 'px-3 py-1.5 text-sm'
        }`}
      >
        <span className="truncate font-mono sm:font-sans">{triggerLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Search human protein-coding gene catalog"
          className="absolute left-0 right-0 z-40 mt-1 rounded-md border border-slate-300 bg-white shadow-lg overflow-hidden min-w-[270px]"
        >
          <div className="border-b border-slate-200 bg-slate-50 p-2">
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
                placeholder="Type any human gene (e.g. PALB2, TTN, APC)..."
                aria-label="Filter human gene catalog"
                className="w-full rounded border border-slate-300 bg-white pl-8 pr-2.5 py-1 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
              />
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500 font-mono tabular-nums">
              <span>
                {query.trim()
                  ? `${totalMatched.toLocaleString()} matches`
                  : `${(totalCatalogGenes || availableGenes.length).toLocaleString()} protein-coding genes`}
              </span>
              <span>{isLoading ? 'Searching HGNC...' : 'Instant live fetch on select'}</span>
            </div>
          </div>

          <ul role="listbox" className="max-h-64 overflow-y-auto divide-y divide-slate-100">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={value === 'ALL'}
                onClick={() => {
                  onChange('ALL');
                  setIsOpen(false);
                  setQuery('');
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                  value === 'ALL'
                    ? 'bg-blue-50 text-blue-900 font-semibold'
                    : 'text-slate-800 hover:bg-slate-50'
                }`}
              >
                <span>All Genes in Workspace ({availableGenes.length} fetched)</span>
                {value === 'ALL' && <Check className="h-3.5 w-3.5 text-blue-700 shrink-0" />}
              </button>
            </li>

            {displayedGenes.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-slate-500">
                No matching HGNC protein-coding gene for &ldquo;{query}&rdquo;.
              </li>
            ) : (
              displayedGenes.map((entry) => {
                const count = fetchedGeneCounts[entry.symbol] ?? 0;
                const isSelected = value === entry.symbol;
                return (
                  <li key={entry.symbol}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onChange(entry.symbol);
                        setIsOpen(false);
                        setQuery('');
                      }}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors cursor-pointer ${
                        isSelected ? 'bg-blue-50 text-blue-900' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-mono font-semibold text-slate-900">
                            {entry.symbol}
                          </span>
                          <span className="text-[10px] font-mono text-slate-500">
                            {entry.chromosome}
                          </span>
                          {entry.clingenClassification && (
                            <span className="text-[10px] font-medium text-blue-700">
                              · ClinGen {entry.clingenClassification}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">
                          {entry.name}
                        </div>
                      </div>

                      <div className="shrink-0 text-right font-mono text-[10px] tabular-nums">
                        {count > 0 ? (
                          <span className="font-semibold text-emerald-700">
                            {count} VUS
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-blue-700 font-medium">
                            <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
                            <span>Fetch Live</span>
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
