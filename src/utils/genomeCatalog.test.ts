import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFallbackCatalogFromClinGen,
  paginateItems,
  parseHgncProteinCodingTsv,
  searchGenomeCatalog,
  selectNextUncrawledGenes,
} from './genomeCatalog';
import type { ClinGenCurationEntry } from './liveDatabaseMappers';

const MOCK_HGNC_TSV = [
  'hgnc_id\tsymbol\tname\tlocus_group\tstatus\tlocation\tensembl_gene_id',
  'HGNC:12403\tTTN\ttitin\tprotein-coding gene\tApproved\t2q31.2\tENSG00000155657',
  'HGNC:1100\tBRCA1\tBRCA1 DNA repair associated\tprotein-coding gene\tApproved\t17q21.31\tENSG00000012048',
  'HGNC:26144\tPALB2\tpartner and localizer of BRCA2\tprotein-coding gene\tApproved\t16p12.2\tENSG00000083093',
  'HGNC:99999\tMIR21\tmicroRNA 21\tnon-coding RNA\tApproved\t17q23.1\tENSG00000284190',
  'HGNC:88888\tOLDGENE\twithdrawn symbol\tprotein-coding gene\tWithdrawn\t1p11\t',
  'HGNC:583\tAPC\tAPC regulator of WNT signaling pathway\tprotein-coding gene\tApproved\t5q22.2\tENSG00000134982',
].join('\n');

const MOCK_CLINGEN = new Map<string, ClinGenCurationEntry[]>([
  [
    'PALB2',
    [
      {
        geneSymbol: 'PALB2',
        hgncId: 'HGNC:26144',
        diseaseLabel: 'Hereditary breast carcinoma',
        diseaseId: 'MONDO:0016419',
        moi: 'AD',
        classification: 'Definitive',
        reportUrl: null,
        expertPanel: 'HBOC',
      },
    ],
  ],
  [
    'TTN',
    [
      {
        geneSymbol: 'TTN',
        hgncId: 'HGNC:12403',
        diseaseLabel: 'Dilated cardiomyopathy',
        diseaseId: 'MONDO:0005021',
        moi: 'AD',
        classification: 'Strong',
        reportUrl: null,
        expertPanel: 'Cardio',
      },
    ],
  ],
]);

test('parseHgncProteinCodingTsv filters to approved protein-coding genes and prioritizes ClinGen curations', () => {
  const catalog = parseHgncProteinCodingTsv(MOCK_HGNC_TSV, MOCK_CLINGEN);
  assert.equal(catalog.length, 4);
  assert.equal(catalog.some((g) => g.symbol === 'MIR21'), false);
  assert.equal(catalog.some((g) => g.symbol === 'OLDGENE'), false);
  assert.deepEqual(
    catalog.map((g) => g.symbol),
    ['BRCA1', 'PALB2', 'TTN', 'APC'],
  );
  assert.equal(catalog[1].clingenClassification, 'Definitive');
  assert.equal(catalog[2].clingenClassification, 'Strong');
});

test('searchGenomeCatalog ranks exact symbol, prefix, and name/ID matches cleanly', () => {
  const catalog = parseHgncProteinCodingTsv(MOCK_HGNC_TSV, MOCK_CLINGEN);
  const res = searchGenomeCatalog(catalog, 'pal', 0, 10);
  assert.equal(res.totalMatching, 1);
  assert.equal(res.genes[0].symbol, 'PALB2');

  const resByName = searchGenomeCatalog(catalog, 'titin', 0, 10);
  assert.equal(resByName.totalMatching, 1);
  assert.equal(resByName.genes[0].symbol, 'TTN');

  const resByEnsembl = searchGenomeCatalog(catalog, 'ENSG00000134982', 0, 10);
  assert.equal(resByEnsembl.genes[0].symbol, 'APC');
});

test('selectNextUncrawledGenes skips already fetched genes and advances cursor cleanly', () => {
  const catalog = parseHgncProteinCodingTsv(MOCK_HGNC_TSV, MOCK_CLINGEN);
  const fetched = new Set(['BRCA1', 'TTN']);
  const batch = selectNextUncrawledGenes(catalog, fetched, 0, 2);
  assert.deepEqual(
    batch.selected.map((g) => g.symbol),
    ['PALB2', 'APC'],
  );
  assert.equal(batch.nextOffset, 0);
});

test('buildFallbackCatalogFromClinGen constructs ordered catalog if HGNC offline', () => {
  const fb = buildFallbackCatalogFromClinGen(MOCK_CLINGEN);
  assert.ok(fb.length >= 6);
  assert.equal(fb[0].symbol, 'BRCA1');
  assert.ok(fb.some((g) => g.symbol === 'PALB2'));
});

test('paginateItems clamps out-of-range pages and calculates indices cleanly', () => {
  const items = Array.from({ length: 120 }, (_, i) => i + 1);

  const page2 = paginateItems(items, 2, 50);
  assert.equal(page2.safePage, 2);
  assert.equal(page2.totalPages, 3);
  assert.equal(page2.startIndex, 51);
  assert.equal(page2.endIndex, 100);
  assert.equal(page2.pageItems.length, 50);

  const clamped = paginateItems(items, 99, 50);
  assert.equal(clamped.safePage, 3);
  assert.equal(clamped.startIndex, 101);
  assert.equal(clamped.endIndex, 120);
  assert.equal(clamped.pageItems.length, 20);

  const empty = paginateItems([], 1, 50);
  assert.equal(empty.safePage, 1);
  assert.equal(empty.totalPages, 1);
  assert.equal(empty.startIndex, 0);
  assert.equal(empty.endIndex, 0);
});
