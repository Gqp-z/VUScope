import test from 'node:test';
import assert from 'node:assert/strict';
import { CURATED_VARIANTS } from '../data/variants';
import {
  buildDefaultReclassificationTimeline,
  evaluateAcmgCriteria,
} from './acmgAutomation';
import {
  buildConditionVariantIndex,
  buildPairwiseVariantCorrelationMatrix,
  buildScoreFrequencyMatrix,
  computeCohortPairOverlap,
  computeConditionPairOverlap,
} from './heatmapAnalysis';
import {
  detectPipelineFormat,
  parseBulkLookupInput,
  parseCmaBedVariants,
  parseVcfVariants,
  summarizeAcmgBatch,
} from './pipelineParsers';
import { DEFAULT_FILTERS, DEFAULT_WEIGHTS, scoreAndRankVariants } from './prioritisation';

test('evaluateAcmgCriteria detects Hot VUS, Likely Pathogenic, Benign BA1, and supports manual overrides', () => {
  // Find a BRCA1 variant that scores as Hot VUS or LP automatically
  const r1699q = CURATED_VARIANTS.find((v) => v.id === 'brca1-r1699q');
  assert.ok(r1699q);
  const autoEval = evaluateAcmgCriteria(r1699q);
  assert.ok(autoEval.netPoints >= 4);
  assert.ok(autoEval.criteria.some((c) => c.code === 'PM1' && c.active));
  assert.ok(autoEval.criteria.some((c) => c.code === 'PM2_Supporting' && c.active));

  // Verify Hot VUS classification (4-5 pts) when netPoints is 4 or 5
  const hotCandidate = CURATED_VARIANTS.find((v) => evaluateAcmgCriteria(v).isHotVus);
  assert.ok(hotCandidate, 'Expected at least one Hot VUS in curated benchmark');
  const hotEval = evaluateAcmgCriteria(hotCandidate);
  assert.equal(hotEval.classification, 'Hot VUS');
  assert.ok(hotEval.netPoints === 4 || hotEval.netPoints === 5);
  assert.ok(hotEval.pointsToLikelyPathogenic >= 1 && hotEval.pointsToLikelyPathogenic <= 2);

  // Overriding PS3 to true on a Hot VUS promotes it to Likely Pathogenic / Pathogenic
  const promoted = evaluateAcmgCriteria(hotCandidate, { PS3: true });
  assert.ok(promoted.netPoints >= 8);
  assert.ok(
    promoted.classification === 'Likely Pathogenic' || promoted.classification === 'Pathogenic',
  );

  // High AF benign variant triggers BA1 or BS1
  const highAfVariant = {
    ...r1699q,
    gnomadAf: 0.008,
    functionalStatus: 'None' as const,
    revelScore: 0.15,
    alphaMissenseScore: 0.12,
    caddPhred: 11,
  };
  const benignEval = evaluateAcmgCriteria(highAfVariant);
  assert.equal(benignEval.classification, 'Benign');
  assert.ok(benignEval.criteria.some((c) => c.code === 'BA1' && c.active));
});

test('buildDefaultReclassificationTimeline combines multi-database events and custom lab history', () => {
  const sample = {
    ...CURATED_VARIANTS[0],
    reclassificationHistory: [
      {
        id: 'lab-1',
        date: '2026-02-01',
        source: 'Lab Update' as const,
        title: 'Segregation verified in 3 affected carriers',
        detail: 'LOD > 1.5 supporting co-segregation',
        impactDirection: 'up' as const,
      },
    ],
  };

  const timeline = buildDefaultReclassificationTimeline(sample);
  assert.ok(timeline.length >= 5);
  assert.equal(timeline[0].source, 'Lab Update');
  assert.ok(timeline.some((e) => e.source === 'ClinVar'));
  assert.ok(timeline.some((e) => e.source === 'gnomAD'));
  assert.ok(timeline.some((e) => e.source === 'dbNSFP / AlphaMissense'));
  assert.ok(timeline.some((e) => e.source === 'ACMG Curation'));
});

test('parseBulkLookupInput, parseVcfVariants, and parseCmaBedVariants handle multi-line and sequencing formats', () => {
  const bulk = parseBulkLookupInput('PALB2\nBRCA2, ATM\n# comment\nBRCA1 c.5096G>A\nPALB2');
  assert.deepEqual(bulk, ['PALB2', 'BRCA2', 'ATM', 'BRCA1 c.5096G>A']);

  const vcfText = [
    '##fileformat=VCFv4.2',
    '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO',
    'chr16\t23646262\trs180177102\tG\tA\t99\tPASS\tGENE=PALB2;HGVSC=c.1676A>G;HGVSP=p.Gln559Arg;CSQ=missense_variant;DOMAIN=ChAM_Domain;AF=0.000018;REVEL=0.612;CADD=23.4;AM=0.581;COND=PALB2-related_cancer_predisposition',
  ].join('\n');
  assert.equal(detectPipelineFormat(vcfText), 'vcf');
  const vcfParsed = parseVcfVariants(vcfText, 'WES');
  assert.equal(vcfParsed.errors.length, 0);
  assert.equal(vcfParsed.variants.length, 1);
  assert.equal(vcfParsed.variants[0].gene, 'PALB2');
  assert.equal(vcfParsed.variants[0].sequencingFormat, 'WES');
  assert.equal(vcfParsed.variants[0].alphaMissenseScore, 0.581);

  const bedText = [
    'chrom\tstart\tend\tgene\tsvtype\tcondition',
    'chr17\t43091434\t43095922\tBRCA1\tCNV_DEL\tHereditary Breast and Ovarian Cancer Syndrome',
  ].join('\n');
  assert.equal(detectPipelineFormat(bedText), 'cma');
  const bedParsed = parseCmaBedVariants(bedText);
  assert.equal(bedParsed.errors.length, 0);
  assert.equal(bedParsed.variants.length, 1);
  assert.equal(bedParsed.variants[0].sequencingFormat, 'CMA');
  assert.equal(bedParsed.variants[0].variantType, 'Truncating VUS');

  const summary = summarizeAcmgBatch([...vcfParsed.variants, ...bedParsed.variants]);
  assert.equal(
    summary.hotVusCount + summary.likelyPathogenicCount + summary.vusCount + summary.likelyBenignCount,
    2,
  );
});

test('heatmapAnalysis builds Score x gnomAD AF matrix, pairwise clustering, and condition/cohort overlaps', () => {
  const scoredAll = scoreAndRankVariants(CURATED_VARIANTS, DEFAULT_WEIGHTS, DEFAULT_FILTERS);

  const matrixAm = buildScoreFrequencyMatrix(scoredAll, 'alphamissense');
  assert.equal(matrixAm.afLabels.length, 5);
  assert.equal(matrixAm.scoreLabels.length, 4);
  assert.equal(matrixAm.cells.length, 20);
  assert.ok(matrixAm.evaluatedCount >= 30);
  const totalInCells = matrixAm.cells.reduce((acc, c) => acc + c.count, 0);
  assert.equal(totalInCells, matrixAm.evaluatedCount);

  const pairwise = buildPairwiseVariantCorrelationMatrix(scoredAll, 10);
  assert.equal(pairwise.items.length, 10);
  assert.equal(pairwise.cells.length, 100);
  assert.equal(pairwise.cells[0].similarity, 1);

  const condIndex = buildConditionVariantIndex(scoredAll);
  assert.ok(condIndex.length >= 10);
  assert.ok(condIndex.some((c) => c.condition === 'Hereditary Breast and Ovarian Cancer Syndrome'));

  const overlapCond = computeConditionPairOverlap(
    scoredAll,
    'Hereditary Breast and Ovarian Cancer Syndrome',
    'Fanconi Anemia (Complementation Group S)',
  );
  assert.ok(overlapCond.shared.length > 0 || overlapCond.onlyA.length > 0);
  assert.ok(overlapCond.shared.every((s) => s.variant.gene === 'BRCA1'));

  const cohortA = scoreAndRankVariants(CURATED_VARIANTS, DEFAULT_WEIGHTS, {
    ...DEFAULT_FILTERS,
    gene: 'BRCA1',
  });
  const cohortB = scoreAndRankVariants(CURATED_VARIANTS, DEFAULT_WEIGHTS, {
    ...DEFAULT_FILTERS,
    clinvarConflict: 'CONFLICTING',
  });
  const cohortOverlap = computeCohortPairOverlap(cohortA, cohortB);
  assert.ok(cohortOverlap.shared.length > 0);
  assert.ok(cohortOverlap.onlyA.length > 0);
  assert.ok(cohortOverlap.onlyB.length > 0);
  assert.ok(cohortOverlap.sharedConditions.includes('Hereditary Breast and Ovarian Cancer Syndrome'));
});
