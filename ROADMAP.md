# Chelaro Roadmap

The roadmap describes outcomes, not promises or fixed delivery dates. Data integrity and recovery
work take priority over feature breadth.

## Now — Private Preview und Source-available-Vorbereitung

- restore reliable GitHub Actions execution and required checks;
- obtain final legal review of the software, commercial, contribution, and brand-asset terms;
- complete repository sanitization before changing GitHub visibility;
- configure the protected macOS release environment and publish the first signed, notarized build;
- complete a synthetic-data product demo and release evidence;
- document and test manual backup and restore before real-data use;
- finish secure local credential storage for future banking connections.
- integrate the fail-closed Agent Host foundation into the desktop review flow without exposing
  canonical finance data or the live checkout.

## Next — Trusted Beta

- add OCR as a versioned, reviewable derivation of immutable documents;
- connect documents, transactions, and workbook rows through explicit evidence links;
- complete the read-only FinTS adapter without persisting PIN or TAN;
- ship encrypted automated backups with a regularly tested restore path;
- complete the authenticated Agent Gateway, one-time apply authorization, recovery, and packaged
  macOS evidence for the proposal-only Agent Host;
- add integrity checks for original files and backup manifests.

## Later — Product Maturity

- validate freelancer, household, and small-business workflows with target users;
- add controlled transaction imports and reconciliation;
- expand accessibility, performance, and recovery testing;
- evaluate additional desktop platforms only after the macOS trust loop is stable;
- assess optional external processing with explicit consent and a documented data boundary.

## Explicitly not promised

- autonomous posting of unverified AI or OCR output;
- deletion of originals when derived rows are removed;
- tax filing, legal compliance, or investment advice;
- custodial banking, payment execution, or crypto trading;
- a cloud-only requirement for core document and finance work;
- multi-user accounting before authorization and audit semantics are redesigned for it.

## Release gates

A public beta requires:

1. green mandatory CI on `main`;
2. a signed and notarized macOS release with verified update delivery;
3. a tested backup and restore procedure;
4. no unresolved critical or high dependency alerts;
5. an updated threat model and security reporting path;
6. synthetic-data screenshots and release notes that match the shipped product.
