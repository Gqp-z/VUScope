import test from 'node:test';
import assert from 'node:assert/strict';
import { RESEARCH_PRESETS } from '../data/genes';
import { CURATED_VARIANTS } from '../data/variants';
import {
  computeNearbyClassifiedVariants,
  extractAllClinVarConditions,
  mapClinGenEntriesToConditions,
  mapMyVariantToRecord,
  parseClinGenValidityCsv,
  pickBestClinGenCuration,
} from './liveDatabaseMappers';
import {
  applySearchQueryWithSmartGeneScope,
  DEFAULT_CONFIG,
  DEFAULT_FILTERS,
  DEFAULT_WEIGHTS,
  evaluateAgainstBaseline,
  expandProteinShorthand,
  findMatchingPresetId,
  getAvailableConditionsForGene,
  normalizeWeights,
  parseImportedCsv,
  scoreAndRankVariants,
  summarizeScoredCohort,
  variantsToCsv,
} from './prioritisation';

test('normalizeWeights handles zero-sum gracefully and sums to 1', () => {
  const equal = normalizeWeights({
    populationFrequency: 0,
    clinvarUncertainty: 0,
    functionalEvidence: 0,
    computationalPredictions: 0,
    similarVariantsTrend: 0,
    diseaseAssociation: 0,
  });
  const sum = Object.values(equal).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6);

  const custom = normalizeWeights({
    populationFrequency: 50,
    clinvarUncertainty: 50,
    functionalEvidence: 0,
    computationalPredictions: 0,
    similarVariantsTrend: 0,
    diseaseAssociation: 0,
  });
  assert.equal(custom.populationFrequency, 0.5);
  assert.equal(custom.clinvarUncertainty, 0.5);
  assert.equal(custom.computationalPredictions, 0);
});

test('scoreAndRankVariants produces bounded scores sorted descending', () => {
  const ranked = scoreAndRankVariants(CURATED_VARIANTS, DEFAULT_WEIGHTS, DEFAULT_FILTERS, DEFAULT_CONFIG);
  assert.equal(ranked.length, CURATED_VARIANTS.length);

  for (let i = 0; i < ranked.length; i++) {
    assert.equal(ranked[i].rank, i + 1);
    assert.ok(ranked[i].priorityScore >= 0 && ranked[i].priorityScore <= 100);
    if (i > 0) {
      assert.ok(ranked[i - 1].priorityScore >= ranked[i].priorityScore);
    }
  }
});

test('adjusting research objective directionality changes rankings as expected', () => {
  const rareWeights = {
    populationFrequency: 100,
    clinvarUncertainty: 0,
    functionalEvidence: 0,
    computationalPredictions: 0,
    similarVariantsTrend: 0,
    diseaseAssociation: 0,
  };

  const rareFirst = scoreAndRankVariants(CURATED_VARIANTS, rareWeights, DEFAULT_FILTERS, {
    frequencyObjective: 'rare_first',
    functionalObjective: 'gap_first',
  });
  assert.equal(rareFirst[0].variant.gnomadAf, 0);

  const prevalentFirst = scoreAndRankVariants(CURATED_VARIANTS, rareWeights, DEFAULT_FILTERS, {
    frequencyObjective: 'prevalent_first',
    functionalObjective: 'gap_first',
  });
  assert.ok(prevalentFirst[0].variant.gnomadAf > 0.001);
});

test('filters correctly isolate gene, functional gap, and search queries including 1-letter shorthand', () => {
  const brca1Gap = scoreAndRankVariants(CURATED_VARIANTS, DEFAULT_WEIGHTS, {
    ...DEFAULT_FILTERS,
    gene: 'BRCA1',
    functionalStatus: 'NONE',
  });
  assert.ok(brca1Gap.length > 0);
  assert.ok(brca1Gap.every((s) => s.variant.gene === 'BRCA1' && s.variant.functionalStatus === 'None'));

  const searchR1699Q = scoreAndRankVariants(CURATED_VARIANTS, DEFAULT_WEIGHTS, {
    ...DEFAULT_FILTERS,
    searchQuery: 'Arg1699Gln',
  });
  assert.equal(searchR1699Q.length, 1);
  assert.equal(searchR1699Q[0].variant.id, 'brca1-r1699q');

  assert.ok(expandProteinShorthand('R158H').includes('p.arg158his'));
  const searchShort = scoreAndRankVariants(CURATED_VARIANTS, DEFAULT_WEIGHTS, {
    ...DEFAULT_FILTERS,
    searchQuery: 'R158H',
  });
  assert.ok(searchShort.some((s) => s.variant.gene === 'TP53' && s.variant.hgvsP.includes('Arg158His')));
});

test('applySearchQueryWithSmartGeneScope expands BRCA1 lock when searching another gene or variant', () => {
  const lockedFilters = { ...DEFAULT_FILTERS, gene: 'BRCA1' };

  // Searching within BRCA1 keeps BRCA1 locked
  const withinBrca1 = applySearchQueryWithSmartGeneScope(CURATED_VARIANTS, lockedFilters, 'BRCT');
  assert.equal(withinBrca1.filters.gene, 'BRCA1');
  assert.equal(withinBrca1.autoExpandedFromGene, null);

  // Searching TP53 or R158H expands to ALL so results appear immediately
  const crossGene = applySearchQueryWithSmartGeneScope(CURATED_VARIANTS, lockedFilters, 'R158H');
  assert.equal(crossGene.filters.gene, 'ALL');
  assert.equal(crossGene.autoExpandedFromGene, 'BRCA1');
});

test('multi-factor custom prioritisation outperforms Rarity-Only Baseline on held-out evaluation benchmark', () => {
  const evalSummary = evaluateAgainstBaseline(
    CURATED_VARIANTS,
    DEFAULT_WEIGHTS,
    DEFAULT_FILTERS,
    DEFAULT_CONFIG,
  );
  assert.ok(evalSummary.totalPositiveTruth > 10);
  assert.ok(evalSummary.precisionAt10Custom >= evalSummary.precisionAt10Baseline);
  assert.ok(evalSummary.mrrCustom >= evalSummary.mrrBaseline);
  assert.ok(evalSummary.enrichmentAt10 > 1.0);
});

test('CSV export and import round-trip preserves key variant fields', () => {
  const ranked = scoreAndRankVariants(CURATED_VARIANTS.slice(0, 5), DEFAULT_WEIGHTS);
  const csv = variantsToCsv(ranked, DEFAULT_WEIGHTS);
  const parsed = parseImportedCsv(csv);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.variants.length, 5);
  assert.equal(parsed.variants[0].gene, ranked[0].variant.gene);
  assert.equal(parsed.variants[0].hgvsC, ranked[0].variant.hgvsC);
});

test('parseClinGenValidityCsv skips banner lines and picks strongest curation', () => {
  const sampleCsv = [
    '"CLINGEN GENE DISEASE VALIDITY CURATIONS"',
    '"FILE CREATED: 2026-01-01"',
    '"WEBPAGE: https://search.clinicalgenome.org/kb/gene-validity"',
    '"++++++++++++++++++++++++++++++++++++++++++++++++++++++++"',
    '"GENE SYMBOL","GENE ID (HGNC)","DISEASE LABEL","DISEASE ID (MONDO)","MOI","SOP","CLASSIFICATION","ONLINE REPORT","CLASSIFICATION DATE","GCEP"',
    '"++++++++++++++++++++++++++++++++++++++++++++++++++++++++"',
    '"PALB2","HGNC:26144","hereditary breast carcinoma","MONDO:0016419","AD","SOP10","Definitive","https://search.clinicalgenome.org/kb/gene-validity/CGGV:assertion_1","2024-05-01","Hereditary Breast, Ovarian and Pancreatic Cancer GCEP"',
    '"PALB2","HGNC:26144","Fanconi anemia","MONDO:0019391","AR","SOP8","Limited","https://search.clinicalgenome.org/kb/gene-validity/CGGV:assertion_2","2022-01-01","Bone Marrow Failure GCEP"',
  ].join('\n');

  const map = parseClinGenValidityCsv(sampleCsv);
  const palb2Entries = map.get('PALB2');
  assert.ok(palb2Entries);
  assert.equal(palb2Entries.length, 2);

  const best = pickBestClinGenCuration(palb2Entries);
  assert.ok(best);
  assert.equal(best.classification, 'Definitive');
  assert.equal(best.diseaseLabel, 'hereditary breast carcinoma');
  assert.ok(best.reportUrl?.includes('CGGV:assertion_1'));
});

test('computeNearbyClassifiedVariants matches proximal pathogenic variants by residue distance', () => {
  const result = computeNearbyClassifiedVariants(1038, 'WD40 Repeat', [
    {
      hgvsP: 'p.Trp1038Ter',
      hgvsC: 'c.3113G>A',
      aaPos: 1038,
      classification: 'Pathogenic',
      clinvarId: 'VCV000128144',
      domain: 'WD40 Repeat',
    },
    {
      hgvsP: 'p.Leu1045Pro',
      hgvsC: 'c.3134T>C',
      aaPos: 1045,
      classification: 'Likely Pathogenic',
      clinvarId: 'VCV000999999',
      domain: 'WD40 Repeat',
    },
    {
      hgvsP: 'p.Ala200Val',
      hgvsC: 'c.599C>T',
      aaPos: 200,
      classification: 'Pathogenic',
      clinvarId: 'VCV000111111',
      domain: 'N-terminal',
    },
  ]);

  assert.equal(result.sameDomainPathogenicCount, 2);
  assert.equal(result.similarClassifiedVariants.length, 2);
  assert.equal(result.similarClassifiedVariants[0].distanceAa, 0);
  assert.equal(result.similarClassifiedVariants[1].distanceAa, 7);
});

test('mapMyVariantToRecord handles array-valued cadd.consequence, dbnsfp.genename, and RefSeq HGVS cleanly', () => {
  const rec = mapMyVariantToRecord(
    {
      _id: 'chr16:g.23649233T>G',
      clinvar: {
        variant_id: 141913,
        gene: { symbol: 'PALB2' },
        hgvs: {
          coding: ['LRG_308t1:c.149A>C', 'NM_024675.4:c.149A>C'],
          protein: ['LRG_308p1:p.Lys50Thr', 'NP_078951.2:p.Lys50Thr'],
        },
        rcv: {
          clinical_significance: 'Conflicting interpretations of pathogenicity',
          conditions: { name: 'Hereditary breast carcinoma' },
          last_evaluated: '2025-01-29',
          number_submitters: 3,
        },
      },
      gnomad_exome: { af: { af: 0.000012, af_popmax: 0.000038 } },
      dbsnp: { rsid: 'rs763598472' },
      dbnsfp: {
        genename: ['PALB2', 'PALB2'],
        revel: { score: [0.42, 0.44] },
        aapos: 50,
      },
      cadd: {
        phred: 24.6,
        consequence: ['NON_SYNONYMOUS', 'UPSTREAM'],
      },
    },
    0,
    {
      fallbackGene: 'PALB2',
      clingen: null,
      allGeneConditions: ['hereditary breast carcinoma', 'Fanconi anemia complementation group N'],
      ensemblGeneId: 'ENSG00000083093',
      geneInterproDomains: ['WD40-repeat-containing domain'],
      pubmedCount: 12,
      pubmedArticles: [{ pmid: '12345', title: 'PALB2 VUS assay' }],
      classifiedNeighbors: [],
    },
  );

  assert.equal(rec.gene, 'PALB2');
  assert.equal(rec.hgvsC, 'c.149A>C');
  assert.equal(rec.hgvsP, 'p.Lys50Thr');
  assert.equal(rec.variantType, 'Missense');
  assert.equal(rec.clinvarStatus, 'Conflicting Interpretations');
  assert.equal(rec.revelScore, 0.42);
  assert.equal(rec.caddPhred, 24.6);
  assert.equal(rec.ensemblGeneId, 'ENSG00000083093');
  assert.ok(rec.gnomadPopMaxLabel.includes('PopMax'));
  assert.ok(rec.associatedConditions?.includes('Fanconi anemia complementation group N'));
});

test('filters and searches across all conditions arising from curated genes', () => {
  const laing = scoreAndRankVariants(CURATED_VARIANTS, DEFAULT_WEIGHTS, {
    ...DEFAULT_FILTERS,
    condition: 'Laing Distal Myopathy',
  });
  assert.ok(laing.length > 0);
  assert.ok(laing.every((s) => s.variant.gene === 'MYH7'));

  const fanconiBrca1 = scoreAndRankVariants(CURATED_VARIANTS, DEFAULT_WEIGHTS, {
    ...DEFAULT_FILTERS,
    condition: 'Fanconi Anemia (Complementation Group S)',
  });
  assert.ok(fanconiBrca1.length > 0);
  assert.ok(fanconiBrca1.every((s) => s.variant.gene === 'BRCA1'));

  const cbavd = scoreAndRankVariants(CURATED_VARIANTS, DEFAULT_WEIGHTS, {
    ...DEFAULT_FILTERS,
    condition: 'CBAVD',
  });
  assert.ok(cbavd.length > 0);
  assert.ok(cbavd.every((s) => s.variant.gene === 'CFTR'));

  const pancreatitisSearch = scoreAndRankVariants(CURATED_VARIANTS, DEFAULT_WEIGHTS, {
    ...DEFAULT_FILTERS,
    searchQuery: 'Pancreatitis',
  });
  assert.ok(pancreatitisSearch.some((s) => s.variant.gene === 'CFTR'));

  const pancreaticSearch = scoreAndRankVariants(CURATED_VARIANTS, DEFAULT_WEIGHTS, {
    ...DEFAULT_FILTERS,
    searchQuery: 'Pancreatic',
  });
  assert.ok(pancreaticSearch.some((s) => s.variant.gene === 'BRCA1'));

  const adrenocorticalSearch = scoreAndRankVariants(CURATED_VARIANTS, DEFAULT_WEIGHTS, {
    ...DEFAULT_FILTERS,
    searchQuery: 'Adrenocortical',
  });
  assert.ok(adrenocorticalSearch.length > 0);
  assert.ok(adrenocorticalSearch.every((s) => s.variant.gene === 'TP53'));
});

test('mapClinGenEntriesToConditions and extractAllClinVarConditions preserve all non-generic phenotypes', () => {
  const conditions = mapClinGenEntriesToConditions([
    {
      geneSymbol: 'PALB2',
      hgncId: 'HGNC:26144',
      diseaseLabel: 'Fanconi anemia complementation group N',
      diseaseId: 'MONDO:0012711',
      moi: 'AR',
      classification: 'Definitive',
      reportUrl: 'https://search.clinicalgenome.org/kb/gene-validity/CGGV:2',
      expertPanel: 'Bone Marrow Failure GCEP',
    },
    {
      geneSymbol: 'PALB2',
      hgncId: 'HGNC:26144',
      diseaseLabel: 'PALB2-related cancer predisposition',
      diseaseId: 'MONDO:0016419',
      moi: 'AD',
      classification: 'Definitive',
      reportUrl: 'https://search.clinicalgenome.org/kb/gene-validity/CGGV:1',
      expertPanel: 'HBOP GCEP',
    },
  ]);

  assert.equal(conditions.length, 2);
  assert.equal(conditions[0].inheritance, 'Autosomal Dominant');
  assert.equal(conditions[1].inheritance, 'Autosomal Recessive');

  const clinvarConds = extractAllClinVarConditions([
    { conditions: [{ name: 'not provided' }, { name: 'Hereditary breast carcinoma' }] },
    { conditions: { name: 'Fanconi anemia, complementation group N' } },
  ]);
  assert.deepEqual(clinvarConds, [
    'Hereditary breast carcinoma',
    'Fanconi anemia, complementation group N',
  ]);
});

test('functional study directionality toggles invert rankings and findMatchingPresetId tracks presets', () => {
  const funcWeights = {
    populationFrequency: 0,
    clinvarUncertainty: 0,
    functionalEvidence: 100,
    computationalPredictions: 0,
    similarVariantsTrend: 0,
    diseaseAssociation: 0,
  };

  const gapFirst = scoreAndRankVariants(CURATED_VARIANTS, funcWeights, { ...DEFAULT_FILTERS, gene: 'BRCA1' }, {
    frequencyObjective: 'rare_first',
    functionalObjective: 'gap_first',
  });
  assert.equal(gapFirst[0].variant.functionalStatus, 'None');

  const studiedFirst = scoreAndRankVariants(CURATED_VARIANTS, funcWeights, { ...DEFAULT_FILTERS, gene: 'BRCA1' }, {
    frequencyObjective: 'rare_first',
    functionalObjective: 'studied_first',
  });
  assert.notEqual(studiedFirst[0].variant.functionalStatus, 'None');

  for (const preset of RESEARCH_PRESETS) {
    assert.equal(findMatchingPresetId(preset.weights, preset.config), preset.id);
  }
  assert.equal(
    findMatchingPresetId(RESEARCH_PRESETS[0].weights, {
      frequencyObjective: 'prevalent_first',
      functionalObjective: 'studied_first',
    }),
    null,
  );
});

test('getAvailableConditionsForGene and summarizeScoredCohort power Compare Cohorts and Triple-Pane metrics', () => {
  const brca1Conditions = getAvailableConditionsForGene(CURATED_VARIANTS, 'BRCA1');
  assert.ok(brca1Conditions.includes('Hereditary Breast and Ovarian Cancer Syndrome'));
  assert.ok(brca1Conditions.includes('Fanconi Anemia (Complementation Group S)'));

  const myh7Conditions = getAvailableConditionsForGene(CURATED_VARIANTS, 'MYH7');
  assert.ok(myh7Conditions.includes('Laing Distal Myopathy'));
  assert.ok(!myh7Conditions.includes('Hereditary Breast and Ovarian Cancer Syndrome'));

  const brca1Scored = scoreAndRankVariants(CURATED_VARIANTS, DEFAULT_WEIGHTS, {
    ...DEFAULT_FILTERS,
    gene: 'BRCA1',
  });
  const summary = summarizeScoredCohort(brca1Scored);
  assert.equal(summary.total, 10);
  assert.ok(summary.conflicting > 0 && summary.conflicting < summary.total);
  assert.ok(summary.unstudied > 0 && summary.unstudied < summary.total);
  assert.equal(summary.topScore, brca1Scored[0].priorityScore);
  assert.ok(summary.meanScore > 0 && summary.meanScore <= summary.topScore);

  const emptySummary = summarizeScoredCohort([]);
  assert.equal(emptySummary.total, 0);
  assert.equal(emptySummary.meanScore, 0);
});



