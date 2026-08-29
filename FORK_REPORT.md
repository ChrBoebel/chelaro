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
- Nine image and icon files whose public provenance had not yet been supplied at initial export
- Six internal brand and design documents that described the excluded visual identity
- Three image-specific support files: screenshot capture, icon generation, and the removed asset test
- No owner attestations or asset-provenance confirmations were invented during this export

## Licensing retained

- Software: existing PolyForm Noncommercial License 1.0.0 terms in `LICENSE.md`
- Name, trademark and visual-asset policy: separate terms in `BRAND_ASSETS.md`
- This export does not replace, broaden, or reinterpret either set of terms

## Initial repository identity

- Branch: `main`
- Commit author: `Christopher Böbel <ChrBoebel@users.noreply.github.com>`
- Intended history: exactly one initial commit containing this report and the clean export

## Publication status

- Initially prepared as a code-only public Source Preview
- Publication is permitted only after the final sanitization gate passes
- No binary release, signed download, or update artifact is part of this snapshot

## Subsequent asset decision

After the initial public root commit, the owner confirmed that the nine excluded visual files were
created through his Codex-agent workflow and explicitly approved their public inclusion. They are
introduced only through a later reviewed pull request, not retroactively inserted into the clean
root commit. Current provenance, hashes and residual warnings are documented in
`ASSET_PROVENANCE.md` and `SANITIZATION_REPORT.md`.
