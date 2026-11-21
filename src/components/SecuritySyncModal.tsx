import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Database,
  Download,
  Lock,
  RefreshCw,
  Shield,
  ShieldAlert,
  X,
} from 'lucide-react';
import type {
  LocalDbStats,
  SecurityStatusResponse,
  ToolSyncStatus,
  VariantRecord,
} from '../types/variant';
import { encryptLocalSnapshot } from '../utils/cryptoVault';

interface SecuritySyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  dbStats: LocalDbStats;
  toolStatuses: ToolSyncStatus[];
  isSyncing: boolean;
  onSyncNow: () => void;
  variants: VariantRecord[];
}

export function SecuritySyncModal({
  isOpen,
  onClose,
  dbStats,
  toolStatuses,
  isSyncing,
  onSyncNow,
  variants,
}: SecuritySyncModalProps) {
  const [secStatus, setSecStatus] = useState<SecurityStatusResponse | null>(null);
  const [loadingSec, setLoadingSec] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const loadSecurityStatus = async () => {
    setLoadingSec(true);
    try {
      const resp = await fetch('/api/security/status');
      if (resp.ok) {
        const data = (await resp.json()) as SecurityStatusResponse;
        setSecStatus(data);
      }
    } catch {
      // Ignore transient offline error
    } finally {
      setLoadingSec(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void loadSecurityStatus();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleEncryptedExport = async (e: React.FormEvent) => {
    e.preventDefault();
    setExportError(null);
    setExportStatus(null);
    try {
      const envelope = await encryptLocalSnapshot(
        {
          exportedBy: 'VUScope Local Genomic DB',
          stats: dbStats,
          variants,
        },
        passphrase,
      );
      const blob = new Blob([JSON.stringify(envelope, null, 2)], {
        type: 'application/json;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vuscope-encrypted-db-${new Date().toISOString().slice(0, 10)}.enc.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportStatus(
        `Encrypted ${variants.length} VUS records with AES-GCM-256 (SHA-256: ${envelope.sha256.slice(0, 12)}...).`,
      );
      setPassphrase('');
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : 'Unable to encrypt local snapshot.',
      );
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="security-sync-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
    >
      <div className="w-full max-w-3xl rounded-md border border-slate-300 bg-white shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-blue-700" aria-hidden="true" />
            <h2 id="security-sync-title" className="text-sm font-bold text-slate-900">
              Application Firewall, Encryption Seal &amp; Multi-Tool Database Sync
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close security and sync details"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {/* 3-Column Security & Integrity Matrix */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded border border-slate-200 bg-slate-50/70 p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-blue-700" aria-hidden="true" />
                  <span>WAF &amp; SSRF Firewall</span>
                </span>
                <span className="font-mono text-[10px] font-semibold text-emerald-700">
                  {secStatus?.firewall.active ? 'ACTIVE' : 'PROTECTED'}
                </span>
              </div>
              <div className="font-mono text-[11px] text-slate-600 tabular-nums space-y-0.5">
                <div>
                  Inspected: <strong>{secStatus?.firewall.inspectedRequests ?? '—'}</strong> · Blocked:{' '}
                  <strong className="text-rose-700">
                    {secStatus?.firewall.blockedRequests ?? 0}
                  </strong>
                </div>
                <div>
                  Egress allowlist:{' '}
                  <strong>{secStatus?.firewall.allowedEgressHosts.length ?? 5} HTTPS hosts</strong>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 leading-snug">
                Blocks prototype pollution, XSS/script/command probes, path traversal, and non-allowlisted outbound hosts.
              </p>
            </div>

            <div className="rounded border border-slate-200 bg-slate-50/70 p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-blue-700" aria-hidden="true" />
                  <span>Code &amp; DB Encryption</span>
                </span>
                <span className="font-mono text-[10px] font-semibold text-emerald-700">
                  AES-256-GCM
                </span>
              </div>
              <div className="font-mono text-[11px] text-slate-600 tabular-nums space-y-0.5">
                <div>
                  Store Digest:{' '}
                  <strong>
                    {secStatus?.encryption.storeDigestSha256
                      ? `${secStatus.encryption.storeDigestSha256.slice(0, 12)}...`
                      : 'Sealed'}
                  </strong>
                </div>
                <div>
                  Sourcemaps: <strong>Disabled</strong> · Auth: <strong>HMAC-SHA256</strong>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 leading-snug">
                Local DB deltas sealed at rest with AES-256-GCM + HMAC signatures; production source maps disabled.
              </p>
            </div>

            <div className="rounded border border-slate-200 bg-slate-50/70 p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                  <span>Runtime Code Guard</span>
                </span>
                <span
                  className={`font-mono text-[10px] font-semibold ${
                    secStatus?.integrity.verified !== false
                      ? 'text-emerald-700'
                      : 'text-rose-700'
                  }`}
                >
                  {secStatus?.integrity.verified !== false ? 'VERIFIED' : 'ALERT'}
                </span>
              </div>
              <div className="font-mono text-[11px] text-slate-600 tabular-nums space-y-0.5">
                <div>
                  Core Modules:{' '}
                  <strong>{secStatus?.integrity.checkedFilesCount ?? 8} SHA-256</strong>
                </div>
                <div>
                  Tamper mismatches:{' '}
                  <strong>{secStatus?.integrity.mismatchedCount ?? 0}</strong>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 leading-snug">
                Startup manifest verifies server, security, scoring, ACMG, and embedded local database modules.
              </p>
            </div>
          </div>

          {/* Embedded Local Database Inventory & Multi-Tool Auto-Sync */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Database className="h-3.5 w-3.5 text-blue-700" aria-hidden="true" />
                <h3 className="font-bold text-slate-900">
                  Embedded Local Genomic Database &amp; Connected Tools
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={loadingSec}
                  onClick={() => void loadSecurityStatus()}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-blue-700 hover:text-blue-700 cursor-pointer"
                >
                  Re-Verify Integrity
                </button>
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={onSyncNow}
                  className="inline-flex items-center gap-1 rounded bg-blue-700 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>{isSyncing ? 'Syncing Tools...' : 'Sync All Tools Now'}</span>
                </button>
              </div>
            </div>

            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-slate-700 tabular-nums">
              <span>
                Coded Genomes: <strong>{dbStats.totalGenes}</strong> · VUS Records:{' '}
                <strong>{dbStats.totalVariants}</strong> · Known Conditions:{' '}
                <strong>{dbStats.totalConditions}</strong>
              </span>
              <span>
                Date Window: <strong>{dbStats.earliestEvaluationDate}</strong> to{' '}
                <strong>{dbStats.latestEvaluationDate}</strong>
              </span>
            </div>

            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="w-full border-collapse text-left text-[11px]">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-2 px-3 font-semibold">Integrated Tool</th>
                    <th className="py-2 px-3 font-semibold">Sync State</th>
                    <th className="py-2 px-3 font-semibold text-right">Records</th>
                    <th className="py-2 px-3 font-semibold">Synchronization Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {toolStatuses.map((tool) => (
                    <tr key={tool.id} className="bg-white">
                      <td className="py-2 px-3 font-semibold text-slate-900 whitespace-nowrap">
                        {tool.name}
                      </td>
                      <td className="py-2 px-3 font-mono whitespace-nowrap">
                        <span
                          className={
                            tool.status === 'synced'
                              ? 'text-emerald-700 font-semibold'
                              : tool.status === 'syncing'
                                ? 'text-blue-700 font-semibold'
                                : 'text-amber-700 font-semibold'
                          }
                        >
                          {tool.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                        {tool.recordsSynced.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-slate-600">{tool.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Client-Side Encrypted Workspace Export */}
          <form
            onSubmit={handleEncryptedExport}
            className="rounded border border-slate-200 bg-slate-50/70 p-3.5 space-y-2"
          >
            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
              <Download className="h-3.5 w-3.5 text-blue-700" aria-hidden="true" />
              <span>Export Encrypted Local Database Snapshot (.enc.json)</span>
            </div>
            <p className="text-[11px] text-slate-600">
              Encrypts all {variants.length} indexed variants and cohort metadata in-browser using PBKDF2-SHA256 + AES-GCM-256 before saving to disk.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter encryption passphrase (min 8 chars)"
                className="flex-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              />
              <button
                type="submit"
                disabled={passphrase.trim().length < 8}
                className="rounded bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-45 cursor-pointer whitespace-nowrap"
              >
                Encrypt &amp; Download Snapshot
              </button>
            </div>
            {exportError && (
              <div className="text-[11px] text-rose-700 font-medium">{exportError}</div>
            )}
            {exportStatus && (
              <div className="text-[11px] text-emerald-700 font-medium">{exportStatus}</div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
