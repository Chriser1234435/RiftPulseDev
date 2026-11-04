# RiftPulse mod website release workflow (standing requirement)

This is mandatory for every website change affecting a RiftPulse mod or its tester download artifacts.

1. Increment version for every re-upload or change. Never re-upload an artifact under an unchanged version. Increment the relevant mod package version (SemVer patch for routine changes, minor/major as warranted) in canonical source and metadata; ensure generated packages and published metadata reflect it. For a website-only change affecting mod downloads, bump the relevant artifact version too.
2. Build mod(s) from current source in Release mode; do not upload stale DLL/QMOD/ZIP files.
3. Copy newly built artifacts into `public/downloads` and update manifest and tester-facing metadata/release notes.
4. Run relevant checks and build website (`npm test` or targeted checks followed by `npm run build`).
5. Deploy isolated RiftPulse development Cloudflare Worker (`riftpulse-dev`) for alpha testers. Never deploy production resources without separate explicit authorization.
6. Verify each deployed artifact by HTTP GET and compare SHA-256 hashes with local files; verify website endpoint and published version metadata.
7. Record version, date, artifacts, deployment ID, and verification results in `docs/dev-builds.md`.
8. Report exact versions and what was uploaded. If build or verification fails, do not claim alpha testers have the update.

**Standing user instruction:** Every mod website upload/change must ship a new version to alpha testers and bump versioning. Preserve this rule in project files and follow it automatically for future changes.
