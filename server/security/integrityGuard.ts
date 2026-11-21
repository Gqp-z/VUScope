import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeSha256, signDataRecord, verifyDataRecord } from './cryptoVault.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const CORE_CODE_FILES = [
  'server.ts',
  'server/security/cryptoVault.ts',
  'server/security/firewall.ts',
  'server/security/integrityGuard.ts',
  'src/utils/prioritisation.ts',
  'src/utils/acmgAutomation.ts',
  'src/utils/localGenomicDb.ts',
  'src/data/extendedGenomes.ts',
] as const;

interface IntegrityManifest {
  createdAt: string;
  files: Record<string, string>;
  manifestDigest: string;
  signature: string;
}

export interface IntegrityReport {
  verified: boolean;
  checkedFilesCount: number;
  mismatchedCount: number;
  missingCount: number;
  manifestDigest: string;
  signatureValid: boolean;
  lastCheckedAt: string;
}

let baselineManifest: IntegrityManifest | null = null;

function hashTrackedFiles(): {
  files: Record<string, string>;
  missingCount: number;
  manifestDigest: string;
} {
  const files: Record<string, string> = {};
  let missingCount = 0;

  for (const relPath of CORE_CODE_FILES) {
    const absPath = path.join(PROJECT_ROOT, relPath);
    if (fs.existsSync(absPath)) {
      const content = fs.readFileSync(absPath);
      files[relPath] = computeSha256(content);
    } else {
      missingCount += 1;
    }
  }

  const canonical = Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join('|');
  const manifestDigest = computeSha256(canonical);

  return { files, missingCount, manifestDigest };
}

export function initializeIntegrityManifest(): IntegrityManifest {
  const { files, manifestDigest } = hashTrackedFiles();
  const createdAt = new Date().toISOString();
  const signature = signDataRecord(`${createdAt}:${manifestDigest}`);

  baselineManifest = {
    createdAt,
    files,
    manifestDigest,
    signature,
  };
  return baselineManifest;
}

export function getIntegrityReport(): IntegrityReport {
  if (!baselineManifest) {
    initializeIntegrityManifest();
  }
  const baseline = baselineManifest!;
  const current = hashTrackedFiles();

  const signatureValid = verifyDataRecord(
    `${baseline.createdAt}:${baseline.manifestDigest}`,
    baseline.signature,
  );

  let mismatchedCount = 0;
  for (const [relPath, expectedHash] of Object.entries(baseline.files)) {
    if (current.files[relPath] !== expectedHash) {
      mismatchedCount += 1;
    }
  }

  return {
    verified:
      signatureValid &&
      mismatchedCount === 0 &&
      current.missingCount === 0 &&
      current.manifestDigest === baseline.manifestDigest,
    checkedFilesCount: Object.keys(baseline.files).length,
    mismatchedCount,
    missingCount: current.missingCount,
    manifestDigest: current.manifestDigest,
    signatureValid,
    lastCheckedAt: new Date().toISOString(),
  };
}
