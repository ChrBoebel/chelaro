# Chelaro product decisions

Status: accepted for foundation work  
Date: 2026-08-13

## Capability

Chelaro is a private, single-owner system for storing financial documents, managing personal
finances, and receiving proposal-only help from a conversational finance assistant.

## Foundation defaults

- **Deployment:** self-hosted/local first, with a cloud-compatible architecture.
- **Audience:** personal finances first; freelancer and business workflows are later profiles.
- **AI policy:** deterministic and local processing works without an external model. External AI providers are disabled by default and require explicit per-provider consent.
- **Language:** German first, internationalization-ready.
- **Repository:** public code-only Source Preview named `chelaro`; private development history and
  internal material remain in a separate owner-controlled repository.

## Release gates

1. **Trust Prototype:** immutable PDF/JPG storage, extraction staging, human verification, document search, and bounded assistant reads.
2. **MVP 1.0:** transactions, Finance Workbooks, document matching, and reviewable assistant proposals.

## Non-goals for the MVP

- bank transfers, payments, or card management;
- tax or legal advice;
- direct Open Banking synchronization;
- autonomous document deletion or default direct agent writes;
- arbitrary workbook macros or executable formulas.
