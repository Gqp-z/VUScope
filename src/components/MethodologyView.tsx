const SOURCES = [
  {
    name: 'ClinVar (NIH)',
    role: 'Clinical Classification & Conflict Tension',
    usage:
      'Supplies submission counts across VUS, Likely Pathogenic/Pathogenic, and Benign labs, plus nearby classified variants at the same codon or domain.',
  },
  {
    name: 'gnomAD (Broad Institute)',
    role: 'Population Allele Frequency',
    usage:
      'Provides global and sub-population allele frequencies (PopMax) to score either ultra-rare penetrance candidates or population-prevalent modifiers.',
  },
  {
    name: 'PubMed (NIH)',
    role: 'Published Functional Study Coverage',
    usage:
      'Quantifies existing functional literature so researchers can target unstudied evidence gaps or prioritise preliminary signals for replication.',
  },
  {
    name: 'ClinGen',
    role: 'Gene-Disease Validity & Actionability',
    usage:
      'Anchors disease association strength (Definitive, Strong, Moderate, Limited) and semi-quantitative clinical actionability scores.',
  },
  {
    name: 'Ensembl VEP',
    role: 'Transcript Consequence & Domain Mapping',
    usage:
      'Standardises HGVS coding/protein coordinates, molecular consequence types (missense, splice region, in-frame indel), and functional protein domains.',
  },
  {
    name: 'dbNSFP (REVEL, CADD, SIFT, PolyPhen-2)',
    role: 'In-Silico Deleteriousness Consensus',
    usage:
      'Aggregates normalized ensemble and evolutionary conservation scores with automatic re-weighting when specific predictors are unavailable (e.g. indels).',
  },
];

export function MethodologyView() {
  return (
    <div className="mx-auto max-w-[1120px] px-6 py-6 space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-xl font-bold text-slate-900">
          Scoring Methodology &amp; Non-Overlap Architecture
        </h1>
        <p className="mt-1 text-sm text-slate-600 max-w-3xl">
          VUScope is a transparent multi-criteria decision-support platform built to help genomics researchers allocate limited wet-lab experimental resources across Variants of Uncertain Significance.
        </p>
      </div>

      {/* Distinct Scope & Non-Overlap Architecture */}
      <section className="border border-slate-200 bg-white rounded-md p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Zero-Overlap Architecture &amp; Cross-Tool Integration
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs leading-relaxed text-slate-600">
          <div>
            <h3 className="font-semibold text-slate-900 mb-1">
              Not a Diagnostic ACMG Classifier
            </h3>
            <p>
              Tools such as InterVar, Franklin, and ClinVar VCEP pipelines apply fixed ACMG/AMP rules to determine whether a variant causes disease. VUScope intentionally avoids diagnostic classification and instead answers a distinct operational question: <em>which remaining VUS offer the highest experimental research value under a lab&apos;s specific objectives?</em>
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 mb-1">
              Single-Responsibility Cross-Tool Flow
            </h3>
            <p>
              Every workbench module serves one non-overlapping role synced to shared state: the <strong>Search Bar</strong> runs both instant cohort filtering and live 6-database API lookups; the <strong>Protein Map</strong> filters by functional domain or arising gene condition and overlays ClinVar P/LP neighbors; <strong>Import Cohort</strong> handles batch CSV/TSV ingestion; and the <strong>Dossier</strong> surfaces full multi-condition spectra with direct NCBI, gnomAD, Ensembl, and ClinGen links.
            </p>
          </div>
        </div>
      </section>

      {/* Mathematical Formulation */}
      <section className="border border-slate-200 bg-white rounded-md p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Transparent Priority Equation
        </h2>
        <div className="rounded bg-slate-50 border border-slate-200 p-3 font-mono text-xs text-slate-800 overflow-x-auto">
          PriorityScore(v) = 100 &times; &Sigma;<sub>i=1..6</sub> [ (w<sub>i</sub> / &Sigma;w) &times; SubScore<sub>i</sub>(v) ]
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600 pt-1">
          <div className="space-y-1">
            <div className="font-semibold text-slate-900">1. Population Frequency (gnomAD AF)</div>
            <p>
              Log-transformed AF mapped to [0.05, 1.0]. In <em>Ultra-Rare First</em> mode, AF = 0 scores 1.00; in <em>Higher AF Impact</em> mode, prevalent alleles score higher to reflect societal carrier burden.
            </p>
          </div>
          <div className="space-y-1">
            <div className="font-semibold text-slate-900">2. ClinVar Conflict &amp; Uncertainty</div>
            <p>
              Prioritises variants with conflicting lab submissions (especially VUS vs. Likely Pathogenic discordance) over uniform single-lab VUS.
            </p>
          </div>
          <div className="space-y-1">
            <div className="font-semibold text-slate-900">3. Functional Study Availability (PubMed)</div>
            <p>
              In <em>Unstudied Gap</em> mode, variants with zero published assays score 1.00; in <em>Prior Assay Signal</em> mode, preliminary/published studies score higher for confirmatory follow-up.
            </p>
          </div>
          <div className="space-y-1">
            <div className="font-semibold text-slate-900">4. In-Silico Consensus (dbNSFP)</div>
            <p>
              Weighted consensus across REVEL (45%), normalized CADD Phred (30%), inverted SIFT (12.5%), and PolyPhen-2 (12.5%), re-normalized when scores are absent for indels/splice sites.
            </p>
          </div>
          <div className="space-y-1">
            <div className="font-semibold text-slate-900">5. Classification of Similar Variants</div>
            <p>
              Combines same-codon or proximal (&le;15 aa) ClinVar Pathogenic/Likely Pathogenic hits with the domain-level pathogenic-to-benign ratio.
            </p>
          </div>
          <div className="space-y-1">
            <div className="font-semibold text-slate-900">6. Disease Association (ClinGen)</div>
            <p>
              Combines ClinGen Gene-Disease Validity tier (Definitive = 0.72, Strong = 0.58, Moderate = 0.38) with normalized clinical actionability (0–12).
            </p>
          </div>
        </div>
      </section>

      {/* 6 Integrated Public Sources */}
      <section className="border border-slate-200 bg-white rounded-md overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Integrated Public Genetic Databases
          </h2>
        </div>
        <div className="divide-y divide-slate-100">
          {SOURCES.map((src) => (
            <div
              key={src.name}
              className="grid grid-cols-1 md:grid-cols-3 gap-2 px-5 py-3 text-xs"
            >
              <div className="font-semibold text-slate-900">{src.name}</div>
              <div className="font-medium text-blue-700">{src.role}</div>
              <div className="text-slate-600">{src.usage}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
