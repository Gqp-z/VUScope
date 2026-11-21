import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLocalDbStatistics,
  initializeLocalGenomicDb,
  queryLocalGenomicDatabase,
  reconcileExternalToolSync,
} from './localGenomicDb';
import { DEFAULT_FILTERS } from './prioritisation';

test('initializeLocalGenomicDb loads directly coded genomes, VUS, conditions, and dates', () => {
  const db = initializeLocalGenomicDb();
  const stats = getLocalDbStatistics(db);

  assert.ok(stats.totalGenes >= 65, `Expected >= 65 coded genes, got ${stats.totalGenes}`);
  assert.ok(stats.totalVariants >= 105, `Expected >= 105 coded VUS, got ${stats.totalVariants}`);
  assert.ok(stats.totalConditions >= 70, `Expected >= 70 coded conditions, got ${stats.totalConditions}`);
  assert.ok(stats.hotVusCount > 0, 'Expected Hot VUS records in local DB');
  assert.ok(stats.earliestEvaluationDate <= '2024-12-31');
  assert.ok(stats.latestEvaluationDate >= '2026-01-01');
  assert.equal(db.toolStatuses.length, 7);
});

test('queryLocalGenomicDatabase filters by Hot VUS, gene, condition, and ClinVar evaluation date', () => {
  const db = initializeLocalGenomicDb();

  const recent = queryLocalGenomicDatabase(db, {
    ...DEFAULT_FILTERS,
    evaluatedAfter: '2026-01-01',
  });
  assert.ok(recent.length > 0);
  assert.ok(recent.every((v) => v.clinvarLastEvaluated >= '2026-01-01'));

  const hotOnly = queryLocalGenomicDatabase(db, {
    ...DEFAULT_FILTERS,
    hotVusOnly: true,
  });
  assert.ok(hotOnly.length > 0 && hotOnly.length < db.variants.length);

  const marfan = queryLocalGenomicDatabase(db, {
    ...DEFAULT_FILTERS,
    condition: 'Marfan Syndrome',
  });
  assert.ok(marfan.some((v) => v.gene === 'FBN1'));
});

test('reconcileExternalToolSync merges live tool updates into local database and logs delta history', () => {
  const db = initializeLocalGenomicDb();
  const sampleCurated = db.variants.find((v) => v.gnomadAf === 0);
  assert.ok(sampleCurated);

  const nextDb = reconcileExternalToolSync(
    db,
    [
      {
        ...sampleCurated,
        id: 'live-delta-1',
        gnomadAf: 0.000014,
        gnomadPopMaxLabel: '0.000031 (NFE)',
        sourceType: 'live_api',
      },
      {
        ...sampleCurated,
        id: 'live-new-gene-var',
        gene: 'SOX9',
        hgvsC: 'c.412C>T',
        hgvsP: 'p.Arg138Cys',
        clinvarId: 'VCV000999888',
        diseaseAssociation: 'Campomelic Dysplasia',
        associatedConditions: ['Campomelic Dysplasia'],
        sourceType: 'live_api',
      },
    ],
    {
      SOX9: {
        symbol: 'SOX9',
        fullName: 'SRY-box transcription factor 9',
        chromosome: '17q24.3',
        proteinLengthAa: 509,
        transcriptId: 'NM_000346.4',
        primaryConditions: ['Campomelic Dysplasia'],
        clingenValidity: 'Definitive',
        clingenExpertPanel: 'ClinGen Skeletal GCEP',
        inheritance: 'Autosomal Dominant',
        vusBurdenNote: 'Synced',
        domains: [],
      },
    },
    [
      {
        id: 'clinvar',
        name: 'ClinVar (NCBI)',
        status: 'connected',
        summary: 'Synced SOX9 + delta',
      },
    ],
    '2026-04-01T12:00:00.000Z',
  );

  assert.equal(nextDb.totalSyncRuns, 1);
  assert.ok(nextDb.genesBySymbol.SOX9);
  assert.ok(nextDb.conditions.some((c) => c.name === 'Campomelic Dysplasia'));

  const updatedCurated = nextDb.variants.find((v) => v.id === sampleCurated.id);
  assert.ok(updatedCurated);
  assert.equal(updatedCurated.gnomadAf, 0.000014);
  assert.ok(
    updatedCurated.reclassificationHistory?.some((e) =>
      e.title.includes('gnomAD v4 live delta'),
    ),
  );
});
