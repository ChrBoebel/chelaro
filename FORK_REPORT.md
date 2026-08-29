# Fork Report

## Export basis

- Source repository: private source repository retained by the owner
- Source snapshot: reviewed `main` content from 29 August 2026
- Export method: tracked files from the reviewed source snapshot, without source Git metadata or history
- Source tracked files: 1,238
- Curated source files before adding this report and the sanitization report: 1,220

## Exclusions

- Source `.git` directory and all prior Git history
- Untracked source content, including `docs/blueprint/`
- Dependency, build, cache, virtual-environment, and coverage directories
- Local environment files such as `.env` and `.env.local`; the two tracked `.env.example`
  templates contain placeholders only and remain part of the export
- Nine image and icon files whose public rights chain was not fully attested
- Six internal brand and design documents that described the excluded visual identity
- Three image-specific support files: screenshot capture, icon generation, and the removed asset test
- No owner attestations or asset-provenance confirmations were invented during this export

## Licensing retained

- Software: existing PolyForm Noncommercial License 1.0.0 terms in `LICENSE.md`
- Name and trademark policy: separate terms in `BRAND_ASSETS.md`; no visual brand assets are included
- This export does not replace, broaden, or reinterpret either set of terms

## Initial repository identity

- Branch: `main`
- Commit author: `Christopher Böbel <ChrBoebel@users.noreply.github.com>`
- Intended history: exactly one initial commit containing this report and the clean export

## Publication status

- Prepared as a code-only public Source Preview
- Publication is permitted only after the final sanitization gate passes
- No binary release, signed download, or update artifact is part of this snapshot
