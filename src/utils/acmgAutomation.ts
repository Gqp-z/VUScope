import type {
  AcmgAssessment,
  AcmgClassification,
  AcmgCriterion,
  ReclassificationEvent,
  VariantRecord,
} from '../types/variant';

export type AcmgRuleOverrides = Record<string, boolean>;

/**
 * Evaluates ACMG/AMP 2015 / ClinGen SVI Bayesian-point criteria for a variant.
 * Points follow Tavtigian et al. (2020) calibration:
 *   Pathogenic >= 10, Likely Pathogenic 6..9, Hot VUS 4..5, VUS 0..3,
 *   Likely Benign -1..-6, Benign <= -7 (or BA1 stand-alone).
 */
export function evaluateAcmgCriteria(
  variant: VariantRecord,
  overrides: AcmgRuleOverrides = {},
): AcmgAssessment {
  const domainTotal = variant.sameDomainPathogenicCount + variant.sameDomainBenignCount;
  const domainPathRatio =
    domainTotal > 0 ? variant.sameDomainPathogenicCount / domainTotal : 0;

  const sameCodonPath = variant.similarClassifiedVariants.filter(
    (s) =>
      s.distanceAa === 0 &&
      (s.classification === 'Pathogenic' || s.classification === 'Likely Pathogenic'),
  );
  const proximalPath = variant.similarClassifiedVariants.filter(
    (s) =>
      s.distanceAa > 0 &&
      s.distanceAa <= 15 &&
      (s.classification === 'Pathogenic' || s.classification === 'Likely Pathogenic'),
  );

  // 1. PVS1: Null / Truncating variant in a known LOF gene
  const pvs1Triggered = variant.variantType === 'Truncating VUS';

  // 2. PS1: Same amino acid change previously established Pathogenic (curated note or identical match)
  const ps1Triggered = false;

  // 3. PS3: Well-established functional studies show deleterious effect
  const ps3Triggered =
    (variant.functionalStatus === 'Published Assay' ||
      variant.functionalStatus === 'Preliminary') &&
    (variant.functionalSummary.toLowerCase().includes('loss') ||
      variant.functionalSummary.toLowerCase().includes('disrupt') ||
      variant.functionalSummary.toLowerCase().includes('defect') ||
      variant.functionalSummary.toLowerCase().includes('reduced'));

  // 4. PM1: Located in a mutational hotspot / critical functional domain without benign variation
  const pm1Triggered =
    variant.sameDomainPathogenicCount >= 12 && domainPathRatio >= 0.7;

  // 5. PM2_Supporting: Absent or ultra-rare in gnomAD v4 controls
  const pm2Triggered = variant.gnomadAf === 0 || variant.gnomadAf <= 0.000025;

  // 6. PM5: Novel missense change at an amino acid residue where another pathogenic missense exists
  const pm5Triggered =
    variant.variantType === 'Missense' && sameCodonPath.length > 0;

  // 7. PP2: Missense in a gene/domain with low rate of benign missense variation
  const pp2Triggered =
    variant.variantType === 'Missense' &&
    variant.sameDomainPathogenicCount >= 20 &&
    variant.sameDomainBenignCount <= 10;

  // 8. PP3 / PP3_Moderate: Multiple lines of computational evidence support deleterious effect
  const revelHigh = variant.revelScore !== null && variant.revelScore >= 0.773;
  const revelVeryHigh = variant.revelScore !== null && variant.revelScore >= 0.932;
  const amHigh =
    variant.alphaMissenseScore !== undefined &&
    variant.alphaMissenseScore !== null &&
    variant.alphaMissenseScore >= 0.564;
  const caddHigh = variant.caddPhred !== null && variant.caddPhred >= 25;
  const spliceHigh =
    variant.variantType === 'Splice Region' &&
    (variant.functionalSummary.toLowerCase().includes('spliceai') || caddHigh);
  const pp3ModerateTriggered =
    revelVeryHigh && ((amHigh && caddHigh) || variant.clinvarSubmissions.lpOrP >= 4);
  const pp3SupportingTriggered =
    !pp3ModerateTriggered && (revelHigh || amHigh || caddHigh || spliceHigh);

  // 9. PP5_Supporting: Discordant ClinVar LP/P submissions by multiple clinical labs
  const pp5Triggered =
    variant.clinvarStatus === 'Conflicting Interpretations' &&
    variant.clinvarSubmissions.lpOrP >= 3 &&
    variant.clinvarSubmissions.lbOrB === 0;

  // Benign criteria
  // 10. BA1: Allele frequency > 0.5% (or > 1%) stand-alone benign
  const ba1Triggered = variant.gnomadAf >= 0.005;

  // 11. BS1: Allele frequency greater than expected for rare Mendelian disorder
  const bs1Triggered = !ba1Triggered && variant.gnomadAf >= 0.0003;

  // 12. BS3: Functional studies show no deleterious effect on protein function
  const bs3Triggered =
    (variant.functionalStatus === 'Published Assay' ||
      variant.functionalStatus === 'Preliminary') &&
    (variant.functionalSummary.toLowerCase().includes('wild-type') ||
      variant.functionalSummary.toLowerCase().includes('retains'));

  // 13. BP4: Multiple computational tools suggest no impact on gene/protein
  const revelLow = variant.revelScore !== null && variant.revelScore <= 0.29;
  const amLow =
    variant.alphaMissenseScore !== undefined &&
    variant.alphaMissenseScore !== null &&
    variant.alphaMissenseScore < 0.34;
  const caddLow = variant.caddPhred !== null && variant.caddPhred < 15;
  const bp4Triggered =
    !pp3ModerateTriggered &&
    !pp3SupportingTriggered &&
    ((revelLow && amLow) || (revelLow && caddLow));

  // 14. BP7: Synonymous variant with no predicted splicing impact
  const bp7Triggered =
    variant.variantType === 'Synonymous' &&
    !variant.functionalSummary.toLowerCase().includes('splice');

  const rawCriteria: Omit<AcmgCriterion, 'active'>[] = [
    {
      code: 'PVS1',
      label: 'Null Variant in LOF Gene',
      direction: 'pathogenic',
      strength: 'Very Strong',
      points: 8,
      autoTriggered: pvs1Triggered,
      rationale: pvs1Triggered
        ? `Truncating consequence (${variant.variantType}) in ClinGen ${variant.clingenValidity} gene.`
        : 'Not a predicted loss-of-function null variant.',
    },
    {
      code: 'PS1',
      label: 'Same Amino Acid Change as Pathogenic',
      direction: 'pathogenic',
      strength: 'Strong',
      points: 4,
      autoTriggered: ps1Triggered,
      rationale: 'Reserved for exact same amino-acid substitution confirmed Pathogenic elsewhere.',
    },
    {
      code: 'PS3',
      label: 'Deleterious Functional Assay Signal',
      direction: 'pathogenic',
      strength: 'Strong',
      points: 4,
      autoTriggered: ps3Triggered,
      rationale: ps3Triggered
        ? `${variant.functionalStatus} (${variant.pubmedCount} PubMed refs): ${variant.functionalSummary}`
        : 'No published wet-lab assay establishing functional loss.',
    },
    {
      code: 'PM1',
      label: 'Mutational Hotspot / Critical Functional Domain',
      direction: 'pathogenic',
      strength: 'Moderate',
      points: 2,
      autoTriggered: pm1Triggered,
      rationale: pm1Triggered
        ? `${variant.proteinDomain} houses ${variant.sameDomainPathogenicCount} P/LP vs ${variant.sameDomainBenignCount} B/LB (${Math.round(domainPathRatio * 100)}% pathogenic enrichment).`
        : `${variant.proteinDomain} does not meet hotspot enrichment threshold (${variant.sameDomainPathogenicCount}P/${variant.sameDomainBenignCount}B).`,
    },
    {
      code: 'PM2_Supporting',
      label: 'Absent / Ultra-Rare in Controls',
      direction: 'pathogenic',
      strength: 'Supporting',
      points: 1,
      autoTriggered: pm2Triggered,
      rationale: pm2Triggered
        ? `gnomAD v4 AF = ${variant.gnomadAf === 0 ? '0 (Absent)' : variant.gnomadAf.toExponential(2)} (${variant.gnomadPopMaxLabel}).`
        : `gnomAD v4 AF (${variant.gnomadAf.toExponential(2)}) exceeds PM2 rarity cutoff.`,
    },
    {
      code: 'PM5',
      label: 'Novel Missense at Pathogenic Codon',
      direction: 'pathogenic',
      strength: 'Moderate',
      points: 2,
      autoTriggered: pm5Triggered,
      rationale: pm5Triggered
        ? `Same codon classified pathogenic variant: ${sameCodonPath.map((s) => s.hgvs).join(', ')}.`
        : proximalPath.length > 0
          ? `Proximal pathogenic neighbors within ±15 aa (${proximalPath.map((s) => s.hgvs).join(', ')}), not exact same codon.`
          : 'No established pathogenic missense curated at this codon.',
    },
    {
      code: 'PP2',
      label: 'Missense Constrained Functional Region',
      direction: 'pathogenic',
      strength: 'Supporting',
      points: 1,
      autoTriggered: pp2Triggered,
      rationale: pp2Triggered
        ? `Missense in constrained ${variant.proteinDomain} (${variant.sameDomainPathogenicCount} P/LP, ${variant.sameDomainBenignCount} B/LB).`
        : 'Does not meet missense constraint criteria.',
    },
    {
      code: 'PP3_Moderate',
      label: 'Strong Computational Pathogenicity Consensus',
      direction: 'pathogenic',
      strength: 'Moderate',
      points: 2,
      autoTriggered: pp3ModerateTriggered,
      rationale: pp3ModerateTriggered
        ? `High ensemble convergence (REVEL ${variant.revelScore?.toFixed(2) ?? '—'}, AlphaMissense ${variant.alphaMissenseScore?.toFixed(2) ?? '—'}, CADD ${variant.caddPhred?.toFixed(1) ?? '—'}).`
        : 'Does not reach ClinGen PP3_Moderate calibration.',
    },
    {
      code: 'PP3',
      label: 'Computational Deleteriousness Support',
      direction: 'pathogenic',
      strength: 'Supporting',
      points: 1,
      autoTriggered: pp3SupportingTriggered,
      rationale: pp3SupportingTriggered
        ? `Deleterious computational prediction (REVEL ${variant.revelScore?.toFixed(2) ?? '—'}, AlphaMissense ${variant.alphaMissenseScore?.toFixed(2) ?? '—'}, CADD ${variant.caddPhred?.toFixed(1) ?? '—'}).`
        : 'In-silico predictors do not support deleteriousness.',
    },
    {
      code: 'PP5_Supporting',
      label: 'Multi-Lab ClinVar LP/P Discordance Signal',
      direction: 'pathogenic',
      strength: 'Supporting',
      points: 1,
      autoTriggered: pp5Triggered,
      rationale: pp5Triggered
        ? `${variant.clinvarSubmissions.lpOrP} clinical labs assert LP/P vs ${variant.clinvarSubmissions.vus} VUS.`
        : 'Insufficient unidirectional LP/P ClinVar lab assertions.',
    },
    {
      code: 'BA1',
      label: 'Stand-Alone High Population Frequency',
      direction: 'benign',
      strength: 'Stand-Alone',
      points: -8,
      autoTriggered: ba1Triggered,
      rationale: ba1Triggered
        ? `gnomAD AF (${variant.gnomadAf.toFixed(4)}) exceeds 0.5% BA1 stand-alone threshold.`
        : 'AF below BA1 stand-alone benign cutoff.',
    },
    {
      code: 'BS1',
      label: 'Allele Frequency Exceeds Disease Expectation',
      direction: 'benign',
      strength: 'Strong',
      points: -4,
      autoTriggered: bs1Triggered,
      rationale: bs1Triggered
        ? `gnomAD AF (${variant.gnomadAf.toExponential(2)}, ${variant.gnomadPopMaxLabel}) exceeds expected Mendelian prevalence.`
        : 'AF compatible with disease prevalence.',
    },
    {
      code: 'BS3',
      label: 'Functional Assay Confirms Wild-Type Activity',
      direction: 'benign',
      strength: 'Strong',
      points: -4,
      autoTriggered: bs3Triggered,
      rationale: bs3Triggered
        ? `Assay demonstrates retained wild-type function: ${variant.functionalSummary}`
        : 'No functional assay confirming benign wild-type retention.',
    },
    {
      code: 'BP4',
      label: 'Computational Benign Consensus',
      direction: 'benign',
      strength: 'Supporting',
      points: -1,
      autoTriggered: bp4Triggered,
      rationale: bp4Triggered
        ? `Benign consensus across REVEL (${variant.revelScore?.toFixed(2) ?? '—'}), AlphaMissense (${variant.alphaMissenseScore?.toFixed(2) ?? '—'}), and CADD (${variant.caddPhred?.toFixed(1) ?? '—'}).`
        : 'In-silico scores do not converge on benign tolerance.',
    },
    {
      code: 'BP7',
      label: 'Synonymous Without Splice Impact',
      direction: 'benign',
      strength: 'Supporting',
      points: -1,
      autoTriggered: bp7Triggered,
      rationale: bp7Triggered
        ? 'Synonymous change with no predicted splice motif alteration.'
        : 'Not a benign-leaning synonymous variant.',
    },
  ];

  const criteria: AcmgCriterion[] = rawCriteria.map((c) => ({
    ...c,
    active: overrides[c.code] !== undefined ? overrides[c.code] : c.autoTriggered,
  }));

  const activeCriteria = criteria.filter((c) => c.active);
  const pathogenicPoints = activeCriteria
    .filter((c) => c.direction === 'pathogenic')
    .reduce((sum, c) => sum + c.points, 0);
  const benignPoints = activeCriteria
    .filter((c) => c.direction === 'benign')
    .reduce((sum, c) => sum + c.points, 0);
  const netPoints = pathogenicPoints + benignPoints;

  const ba1Active = criteria.some((c) => c.code === 'BA1' && c.active);

  let classification: AcmgClassification;
  if (ba1Active || netPoints <= -7) {
    classification = 'Benign';
  } else if (netPoints <= -1) {
    classification = 'Likely Benign';
  } else if (netPoints >= 10) {
    classification = 'Pathogenic';
  } else if (netPoints >= 6) {
    classification = 'Likely Pathogenic';
  } else if (netPoints >= 4) {
    classification = 'Hot VUS';
  } else {
    classification = 'VUS';
  }

  const isHotVus = classification === 'Hot VUS';
  const pointsToLikelyPathogenic = Math.max(0, 6 - netPoints);

  const activeCodes = activeCriteria.map((c) => c.code).join(', ') || 'None';
  const summary = isHotVus
    ? `Hot VUS (${netPoints} ACMG pts; only ${pointsToLikelyPathogenic} pt${pointsToLikelyPathogenic === 1 ? '' : 's'} below Likely Pathogenic threshold). Triggered: ${activeCodes}.`
    : `${classification} (${netPoints >= 0 ? `+${netPoints}` : netPoints} ACMG pts). Active rules: ${activeCodes}.`;

  return {
    classification,
    isHotVus,
    netPoints,
    pathogenicPoints,
    benignPoints,
    pointsToLikelyPathogenic,
    criteria,
    summary,
  };
}

export function buildDefaultReclassificationTimeline(
  variant: VariantRecord,
  assessment?: AcmgAssessment,
): ReclassificationEvent[] {
  const acmg = assessment ?? evaluateAcmgCriteria(variant);
  const events: ReclassificationEvent[] = [];

  events.push({
    id: `${variant.id}-clinvar`,
    date: variant.clinvarLastEvaluated || '2025-01-15',
    source: 'ClinVar',
    title:
      variant.clinvarStatus === 'Conflicting Interpretations'
        ? `ClinVar Conflicting Submissions (${variant.clinvarSubmissions.lpOrP} LP/P vs ${variant.clinvarSubmissions.vus} VUS)`
        : `ClinVar Consensus VUS (${variant.clinvarSubmissions.total} lab submissions)`,
    detail: `ClinVar ID ${variant.clinvarId}: ${variant.clinvarSubmissions.total} total assertions (${variant.clinvarSubmissions.lpOrP} LP/P, ${variant.clinvarSubmissions.vus} VUS, ${variant.clinvarSubmissions.lbOrB} LB/B).`,
    impactDirection:
      variant.clinvarSubmissions.lpOrP > 0
        ? 'up'
        : variant.clinvarSubmissions.lbOrB > 0
          ? 'down'
          : 'neutral',
  });

  events.push({
    id: `${variant.id}-gnomad`,
    date: '2024-11-01',
    source: 'gnomAD',
    title:
      variant.gnomadAf === 0
        ? 'gnomAD v4 Absence Confirmed (PM2_Supporting)'
        : `gnomAD v4 AF Annotated (${variant.gnomadPopMaxLabel})`,
    detail:
      variant.gnomadAf === 0
        ? 'Variant absent across gnomAD v4 exome and genome reference cohorts.'
        : `Global AF ${variant.gnomadAf.toExponential(2)} (${variant.gnomadPopMaxLabel}).`,
    impactDirection: variant.gnomadAf <= 0.000025 ? 'up' : variant.gnomadAf >= 0.0003 ? 'down' : 'neutral',
  });

  if (
    variant.revelScore !== null ||
    variant.alphaMissenseScore !== undefined ||
    variant.caddPhred !== null
  ) {
    const amLabel =
      variant.alphaMissenseScore !== undefined && variant.alphaMissenseScore !== null
        ? `AlphaMissense ${variant.alphaMissenseScore.toFixed(2)} (${variant.alphaMissenseClass ?? 'Scored'})`
        : 'AlphaMissense N/A';
    events.push({
      id: `${variant.id}-insilico`,
      date: '2024-09-18',
      source: 'dbNSFP / AlphaMissense',
      title: `Ensemble In-Silico Profile Updated (${amLabel})`,
      detail: `REVEL ${variant.revelScore !== null ? variant.revelScore.toFixed(3) : '—'} · CADD ${variant.caddPhred !== null ? variant.caddPhred.toFixed(1) : '—'} · PolyPhen-2 ${variant.polyphenScore !== null ? variant.polyphenScore.toFixed(2) : '—'}.`,
      impactDirection:
        (variant.revelScore ?? 0) >= 0.75 || (variant.alphaMissenseScore ?? 0) >= 0.564
          ? 'up'
          : (variant.revelScore ?? 1) <= 0.29
            ? 'down'
            : 'neutral',
    });
  }

  events.push({
    id: `${variant.id}-pubmed`,
    date: '2024-08-04',
    source: 'PubMed Functional',
    title:
      variant.functionalStatus === 'None'
        ? 'Unstudied Functional Assay Gap Flagged'
        : `${variant.functionalStatus} Evidence (${variant.pubmedCount} PubMed citations)`,
    detail: variant.functionalSummary,
    impactDirection:
      variant.functionalStatus === 'None'
        ? 'neutral'
        : variant.functionalSummary.toLowerCase().includes('wild-type') ||
            variant.functionalSummary.toLowerCase().includes('retains')
          ? 'down'
          : 'up',
  });

  events.push({
    id: `${variant.id}-acmg`,
    date: '2025-02-18',
    source: 'ACMG Curation',
    title: `${acmg.classification} Rule Evaluation (${acmg.netPoints >= 0 ? `+${acmg.netPoints}` : acmg.netPoints} pts)`,
    detail: acmg.summary,
    impactDirection:
      acmg.netPoints >= 4 ? 'up' : acmg.netPoints <= -1 ? 'down' : 'neutral',
  });

  return [...(variant.reclassificationHistory ?? []), ...events];
}
