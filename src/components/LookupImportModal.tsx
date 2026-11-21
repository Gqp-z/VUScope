import { useMemo, useState, type ChangeEvent } from 'react';
import { CheckCircle2, Terminal, Upload, X } from 'lucide-react';
import type {
  BatchAnnotateResponse,
  BatchLookupResponse,
  VariantRecord,
} from '../types/variant';
import {
  detectPipelineFormat,
  parseBulkLookupInput,
  parseCmaBedVariants,
  parseVcfVariants,
  summarizeAcmgBatch,
} from '../utils/pipelineParsers';
import { parseImportedCsv } from '../utils/prioritisation';

interface LookupImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddVariants: (variants: VariantRecord[]) => void;
  onAddBatchLookup?: (payload: BatchLookupResponse) => void;
}

type ModalMode = 'bulk_lookup' | 'pipeline_import' | 'api_access';

const SAMPLE_BULK_LIST = `PALB2
BRCA2
ATM
BRCA1 c.5096G>A
TP53 p.Arg158His
rs80357433`;

const SAMPLE_WES_VCF = `##fileformat=VCFv4.2
##source=WES_Germline_Pipeline_v3
#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO
chr16\t23646262\trs180177102\tG\tA\t99\tPASS\tGENE=PALB2;HGVSC=c.1676A>G;HGVSP=p.Gln559Arg;CSQ=missense_variant;DOMAIN=ChAM_Domain;AF=0.000018;REVEL=0.612;CADD=23.4;AM=0.581;COND=PALB2-related_cancer_predisposition
chr11\t108200961\trs587779850\tC\tT\t99\tPASS\tGENE=ATM;HGVSC=c.7271T>G;HGVSP=p.Val2424Gly;CSQ=missense_variant;DOMAIN=FAT_Domain;AF=0.000006;REVEL=0.914;CADD=28.7;AM=0.943;CLINVAR=VCV000003021;COND=Ataxia-Telangiectasia;Hereditary_Breast_Cancer
chr2\t47702181\t.\tG\tA\t95\tPASS\tGENE=MSH2;HGVSC=c.1865C>T;HGVSP=p.Pro622Leu;CSQ=missense_variant;DOMAIN=ATPase_Domain;AF=0.0;REVEL=0.891;CADD=28.1;AM=0.922;COND=Lynch_Syndrome`;

const SAMPLE_CMA_BED = `chrom\tstart\tend\tgene\tsvtype\tcondition
chr17\t43091434\t43095922\tBRCA1\tCNV_DEL\tHereditary Breast and Ovarian Cancer Syndrome
chr7\t117548628\t117595002\tCFTR\tCNV_DUP\tCystic Fibrosis; CBAVD`;

const SAMPLE_TSV = `gene\thgvs_c\thgvs_p\tvariant_type\tprotein_domain\tgnomad_af\trevel\tcadd_phred\tclinvar_status\tfunctional_status\tdisease_association
PALB2\tc.3113G>A\tp.Trp1038*\tTruncating VUS\tWD40 Repeat\t0.000012\t0.91\t34.0\tConflicting\tNone\tPALB2-related cancer predisposition; Fanconi anemia complementation group N
BRCA2\tc.8167G>C\tp.Asp2723His\tMissense\tDNA-Binding OB1\t0.000003\t0.94\t29.4\tConflicting\tPreliminary\tHereditary Breast and Ovarian Cancer Syndrome; Fanconi Anemia Group D1
MSH2\tc.1865C>T\tp.Pro622Leu\tMissense\tATPase Domain\t0.000000\t0.89\t28.1\tUniform VUS\tNone\tLynch Syndrome; Muir-Torre Syndrome`;

export function LookupImportModal({
  isOpen,
  onClose,
  onAddVariants,
  onAddBatchLookup,
}: LookupImportModalProps) {
  const [mode, setMode] = useState<ModalMode>('bulk_lookup');
  const [bulkText, setBulkText] = useState('');
  const [isFetchingBulk, setIsFetchingBulk] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkReport, setBulkReport] = useState<BatchLookupResponse | null>(null);

  const [pipelineText, setPipelineText] = useState('');
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [pipelineReport, setPipelineReport] = useState<BatchAnnotateResponse | null>(null);
  const [isAnnotating, setIsAnnotating] = useState(false);

  const [apiTestResult, setApiTestResult] = useState<string | null>(null);
  const [isTestingApi, setIsTestingApi] = useState(false);

  const parsedBulkQueries = useMemo(() => parseBulkLookupInput(bulkText), [bulkText]);
  const detectedFormat = useMemo(
    () => (pipelineText.trim() ? detectPipelineFormat(pipelineText) : null),
    [pipelineText],
  );

  if (!isOpen) return null;

  const handleBulkLookupSubmit = async () => {
    if (parsedBulkQueries.length === 0) {
      setBulkError('Paste one or more gene symbols, HGVS strings, or rsIDs (one per line).');
      return;
    }

    setIsFetchingBulk(true);
    setBulkError(null);
    setBulkReport(null);

    try {
      const resp = await fetch('/api/lookup/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: parsedBulkQueries }),
      });
      const payload = (await resp.json()) as Partial<BatchLookupResponse> & {
        error?: string;
      };
      if (!resp.ok) {
        setBulkError(payload.error || 'Bulk live database lookup failed.');
        return;
      }
      const full = payload as BatchLookupResponse;
      setBulkReport(full);
      if (full.variants.length > 0) {
        if (onAddBatchLookup) {
          onAddBatchLookup(full);
        } else {
          onAddVariants(full.variants);
        }
      } else {
        setBulkError('Connected to public databases, but 0 matching VUS were returned.');
      }
    } catch {
      setBulkError('Network error calling /api/lookup/batch.');
    } finally {
      setIsFetchingBulk(false);
    }
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPipelineText(reader.result);
        setPipelineError(null);
        setPipelineReport(null);
      }
    };
    reader.readAsText(file);
  };

  const handlePipelineAnnotateAndImport = async () => {
    if (!pipelineText.trim()) {
      setPipelineError('Paste or upload WES/WGS VCF, CMA BED, or CSV/TSV variant rows.');
      return;
    }

    setIsAnnotating(true);
    setPipelineError(null);
    try {
      const resp = await fetch('/api/annotate/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'auto', payload: pipelineText }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as BatchAnnotateResponse;
        setPipelineReport(data);
        if (data.variants.length === 0) {
          setPipelineError(data.errors[0] || 'No valid variant records parsed.');
          return;
        }
        onAddVariants(data.variants);
        return;
      }
    } catch {
      // Fallback cleanly to client-side batch parser if API unreachable
    } finally {
      setIsAnnotating(false);
    }

    const format = detectPipelineFormat(pipelineText);
    const local =
      format === 'vcf'
        ? parseVcfVariants(pipelineText)
        : format === 'cma'
          ? parseCmaBedVariants(pipelineText)
          : parseImportedCsv(pipelineText);

    if (local.variants.length === 0) {
      setPipelineError(local.errors[0] || 'No valid variant rows found.');
      return;
    }
    setPipelineReport({
      format,
      totalParsed: local.variants.length,
      variants: local.variants,
      acmgSummary: summarizeAcmgBatch(local.variants),
      errors: local.errors,
    });
    onAddVariants(local.variants);
  };

  const handleTestBatchApi = async () => {
    setIsTestingApi(true);
    setApiTestResult(null);
    try {
      const resp = await fetch('/api/annotate/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'vcf', payload: SAMPLE_WES_VCF }),
      });
      const json = await resp.json();
      setApiTestResult(JSON.stringify(json, null, 2));
    } catch {
      setApiTestResult('Error contacting /api/annotate/batch');
    } finally {
      setIsTestingApi(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
    >
      <div className="w-full max-w-3xl rounded-md border border-slate-200 bg-white overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div>
            <h2 id="import-modal-title" className="text-sm font-bold text-slate-900">
              Bulk Database Lookup &amp; Sequencing Pipeline Support
            </h2>
            <p className="text-xs text-slate-500">
              Batch-fetch multiple genes/HGVS strings live or ingest WES, WGS, CMA, and TSV files with automated ACMG/AMP &amp; consequence annotation.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close modal"
            onClick={onClose}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="flex flex-wrap border-b border-slate-200 bg-slate-50 px-5 pt-2 gap-2">
          <button
            type="button"
            onClick={() => setMode('bulk_lookup')}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              mode === 'bulk_lookup'
                ? 'border-blue-700 text-blue-700 bg-white rounded-t'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Bulk Gene / HGVS Lookup
          </button>
          <button
            type="button"
            onClick={() => setMode('pipeline_import')}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              mode === 'pipeline_import'
                ? 'border-blue-700 text-blue-700 bg-white rounded-t'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            WES / WGS / CMA / TSV Import
          </button>
          <button
            type="button"
            onClick={() => setMode('api_access')}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              mode === 'api_access'
                ? 'border-blue-700 text-blue-700 bg-white rounded-t'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Batch API &amp; Pipeline Specs
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 max-h-[75vh] overflow-y-auto space-y-4">
          {mode === 'bulk_lookup' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-slate-600">
                  Paste multiple gene symbols (<code className="font-mono">PALB2</code>,{' '}
                  <code className="font-mono">BRCA2</code>), HGVS nomenclature (
                  <code className="font-mono">BRCA1 c.5096G&gt;A</code>,{' '}
                  <code className="font-mono">TP53 p.Arg158His</code>), or rsIDs (one per line).
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setBulkText(SAMPLE_BULK_LIST);
                    setBulkError(null);
                    setBulkReport(null);
                  }}
                  className="text-xs font-medium text-blue-700 hover:underline cursor-pointer shrink-0"
                >
                  Load Sample List
                </button>
              </div>

              <div>
                <label
                  htmlFor="bulk-lookup-textarea"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Multi-Line Gene / HGVS / rsID Input ({parsedBulkQueries.length} parsed queries, max 25)
                </label>
                <textarea
                  id="bulk-lookup-textarea"
                  rows={7}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={SAMPLE_BULK_LIST}
                  className="w-full rounded-md border border-slate-300 p-2.5 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </div>

              {parsedBulkQueries.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-slate-500 font-medium">Queued queries:</span>
                  {parsedBulkQueries.map((q) => (
                    <span
                      key={q}
                      className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-slate-800"
                    >
                      {q}
                    </span>
                  ))}
                </div>
              )}

              {bulkError && (
                <div className="rounded border border-rose-300 bg-rose-50 p-2.5 text-xs text-rose-800">
                  {bulkError}
                </div>
              )}

              {bulkReport && (
                <div className="rounded border border-emerald-200 bg-emerald-50/70 p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2 font-semibold text-emerald-900">
                    <span className="inline-flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                      Added {bulkReport.variants.length} VUS across{' '}
                      {bulkReport.resolvedGenes.join(', ') || 'queried targets'}
                    </span>
                    <button
                      type="button"
                      onClick={onClose}
                      className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                    >
                      View in Workbench
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {bulkReport.results.map((r) => (
                      <div
                        key={r.query}
                        className="flex items-center justify-between rounded border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px]"
                      >
                        <span className="text-slate-900 truncate">{r.query}</span>
                        <span
                          className={
                            r.status === 'ok'
                              ? 'text-emerald-700 font-semibold'
                              : r.status === 'empty'
                                ? 'text-amber-700'
                                : 'text-rose-700'
                          }
                        >
                          {r.message}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={isFetchingBulk || parsedBulkQueries.length === 0}
                  onClick={handleBulkLookupSubmit}
                  className="rounded-md bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-45 cursor-pointer"
                >
                  {isFetchingBulk
                    ? `Fetching ${parsedBulkQueries.length} Queries...`
                    : `Fetch & Add All (${parsedBulkQueries.length})`}
                </button>
              </div>
            </>
          )}

          {mode === 'pipeline_import' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="csv-upload"
                  className="inline-flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Choose .vcf, .bed, .csv, or .tsv</span>
                  <input
                    id="csv-upload"
                    type="file"
                    accept=".vcf,.bed,.csv,.tsv,.txt"
                    onChange={handleFileUpload}
                    className="sr-only"
                  />
                </label>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setPipelineText(SAMPLE_WES_VCF);
                      setPipelineError(null);
                      setPipelineReport(null);
                    }}
                    className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                  >
                    Load Sample WES VCF
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPipelineText(SAMPLE_CMA_BED);
                      setPipelineError(null);
                      setPipelineReport(null);
                    }}
                    className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                  >
                    Load Sample CMA BED
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPipelineText(SAMPLE_TSV);
                      setPipelineError(null);
                      setPipelineReport(null);
                    }}
                    className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                  >
                    Load Sample TSV
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="csv-paste-area"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Paste Sequencing Output (WES/WGS VCF, CMA CNV BED, or CSV/TSV)
                  </label>
                  {detectedFormat && (
                    <span className="font-mono text-[11px] font-semibold text-blue-700 uppercase">
                      Detected Format: {detectedFormat}
                    </span>
                  )}
                </div>
                <textarea
                  id="csv-paste-area"
                  rows={8}
                  value={pipelineText}
                  onChange={(e) => setPipelineText(e.target.value)}
                  placeholder={SAMPLE_WES_VCF}
                  className="w-full rounded-md border border-slate-300 p-2.5 font-mono text-xs text-slate-900 whitespace-pre overflow-x-auto focus:border-blue-700 focus:outline-none"
                />
              </div>

              {pipelineError && (
                <div className="rounded border border-rose-300 bg-rose-50 p-2.5 text-xs text-rose-800">
                  {pipelineError}
                </div>
              )}

              {pipelineReport && (
                <div className="rounded border border-emerald-200 bg-emerald-50/70 p-3 text-xs space-y-1">
                  <div className="font-semibold text-emerald-900">
                    Batch annotated {pipelineReport.totalParsed} variants ({pipelineReport.format.toUpperCase()} pipeline)
                  </div>
                  <div className="font-mono text-[11px] text-slate-700 tabular-nums">
                    ACMG Pre-Triage: {pipelineReport.acmgSummary.hotVusCount} Hot VUS ·{' '}
                    {pipelineReport.acmgSummary.likelyPathogenicCount} LP/P ·{' '}
                    {pipelineReport.acmgSummary.vusCount} Standard VUS ·{' '}
                    {pipelineReport.acmgSummary.likelyBenignCount} LB/B
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={isAnnotating || !pipelineText.trim()}
                  onClick={handlePipelineAnnotateAndImport}
                  className="rounded-md bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-45 cursor-pointer"
                >
                  {isAnnotating ? 'Annotating...' : 'Batch Annotate & Add to Queue'}
                </button>
              </div>
            </>
          )}

          {mode === 'api_access' && (
            <div className="space-y-3 text-xs text-slate-700">
              <p>
                Connect high-throughput clinical or bioinformatics pipelines (WES, WGS, CMA) directly to VUScope&apos;s REST endpoints for batch consequence annotation and multi-database VUS triage.
              </p>

              <div className="space-y-2">
                <div className="rounded border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] space-y-1">
                  <div className="font-semibold text-slate-900">
                    POST /api/lookup/batch — Bulk Live Multi-Database Enrichment
                  </div>
                  <div className="text-slate-600 overflow-x-auto whitespace-pre">
                    {`curl -X POST /api/lookup/batch -H "Content-Type: application/json" \\\n  -d '{"queries": ["PALB2", "BRCA2", "TP53 p.Arg158His"]}'`}
                  </div>
                </div>

                <div className="rounded border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] space-y-1">
                  <div className="font-semibold text-slate-900">
                    POST /api/annotate/batch — Batch Consequence &amp; ACMG/AMP Annotation (VCF / CMA / TSV)
                  </div>
                  <div className="text-slate-600 overflow-x-auto whitespace-pre">
                    {`curl -X POST /api/annotate/batch -H "Content-Type: application/json" \\\n  -d '{"format": "vcf", "payload": "..."}'`}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  disabled={isTestingApi}
                  onClick={handleTestBatchApi}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:border-blue-700 hover:text-blue-700 cursor-pointer"
                >
                  <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{isTestingApi ? 'Running Sample API Call...' : 'Test POST /api/annotate/batch'}</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Close
                </button>
              </div>

              {apiTestResult && (
                <pre className="rounded border border-slate-200 bg-slate-900 p-3 font-mono text-[10px] text-slate-100 max-h-48 overflow-auto">
                  {apiTestResult}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
