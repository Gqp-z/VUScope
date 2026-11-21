import { Download } from 'lucide-react';

export type ActiveTab = 'workbench' | 'compare' | 'evaluation' | 'methodology';

interface HeaderProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  onOpenLookup: () => void;
  onExportCsv: () => void;
  exportCount: number;
}

export function Header({
  activeTab,
  onTabChange,
  onOpenLookup,
  onExportCsv,
  exportCount,
}: HeaderProps) {
  return (
    <header className="md:sticky md:top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1440px] flex-wrap md:flex-nowrap items-center justify-between gap-x-8 gap-y-2 px-4 sm:px-6 py-3">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => onTabChange('workbench')}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          VUScope
        </button>

        {/* Zone 2: Clean navigation links (wraps cleanly on narrow phones, single-line on sm+) */}
        <nav
          aria-label="Primary"
          className="order-last md:order-none w-full md:w-auto flex flex-wrap sm:flex-nowrap items-center justify-start gap-x-4 gap-y-1 sm:gap-6 border-t border-slate-100 pt-2 md:border-t-0 md:pt-0"
        >
          <button
            type="button"
            onClick={() => onTabChange('workbench')}
            className={`py-1.5 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'workbench'
                ? 'border-blue-700 text-slate-900'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Workbench
          </button>
          <button
            type="button"
            onClick={() => onTabChange('compare')}
            className={`py-1.5 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'compare'
                ? 'border-blue-700 text-slate-900'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Compare Cohorts
          </button>
          <button
            type="button"
            onClick={() => onTabChange('evaluation')}
            className={`py-1.5 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'evaluation'
                ? 'border-blue-700 text-slate-900'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Evaluation
          </button>
          <button
            type="button"
            onClick={() => onTabChange('methodology')}
            className={`py-1.5 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'methodology'
                ? 'border-blue-700 text-slate-900'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Methodology
          </button>
          <button
            type="button"
            onClick={onOpenLookup}
            className="py-1.5 text-xs sm:text-sm font-medium border-b-2 border-transparent text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Import Cohort
          </button>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onExportCsv}
            disabled={exportCount === 0}
            className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-3.5 sm:px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Export CSV ({exportCount})</span>
          </button>
        </div>
      </div>
    </header>
  );
}
