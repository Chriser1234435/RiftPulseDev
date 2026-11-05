# Development builds — 0.1.0 bootstrap

Date: 2026-11-03

## Download page

The isolated development preview now has a Downloads navigation entry:
https://riftpulse-dev.chrismeten0.workers.dev

Direct artifacts:
- PCVR BSIPA bootstrap ZIP: /downloads/RiftPulse.Pcvr.zip
- Quest Scotland2 bootstrap QMOD: /downloads/RiftPulse.Quest.qmod

The download assets are served by the dev Worker Static Assets binding. No production hostname, DNS, Worker, or database was changed.

## Build facts

- PCVR: `mods/pcvr/RiftPulse.Pcvr.csproj`, target .NET Framework 4.7.2, pinned to the local Beat Saber 1.40.8 BSIPA loader. Release compile passed (0 warnings, 0 errors). ZIP contains the plugin DLL and README.
- Quest: `mods/quest`, native ARM64 build with NDK 27.2.12479018, Scotland2 / beatsaber-hook / paper dependencies. Native CMake/Ninja compile passed and QPM generated `RiftPulse.qmod`. QMOD metadata targets package version `1.40.8_7379`.
- Website: TypeScript typecheck, 41 unit/contract tests, isolated SQLite migration integration, and Vite production build passed. The dev Worker deployment completed successfully; deployment version ID `ffe3b76d-483e-43a0-b764-ce7ab5158509`.
- Remote verification: GET API health returned HTTP 200; both downloadable packages returned HTTP 200.

## Scope warning / next test gates

These are loader bootstrap artifacts, not feature-complete RiftPulse mods. They currently do not implement the in-game menu, mod-generated five-digit pairing, authenticated realtime connection, chat overlay, viewer count display, configurable ChatIntegrations commands, or BSR queue/request handling.

PCVR runtime load has not been verified inside Beat Saber. ADB reported no Quest device attached, so Quest install and in-headset load have not been verified. Keep these packages in a test instance and do not treat them as release builds.

Next implementation sequence:
1. Implement equivalent in-game pairing/menu UI for PCVR and Quest.
2. Connect both adapters to the shared API/event contracts and authenticated realtime feed.
3. Wire Chat module, then BSR request flow.
4. Test PCVR game runtime and Quest headset runtime.
5. During the intended livestream, validate provider connectors/events separately; OAuth provider credentials remain absent from the workspace.


## Alpha tester upload — PCVR 0.1.1

Date: 2026-11-03

- PCVR plugin version bumped from `0.1.0` to `0.1.1` in the project and BSIPA manifests.
- Release compile passed: 0 warnings, 0 errors.
- Published refreshed `RiftPulse.Pcvr.dll`, `RiftPulse.Pcvr.zip`, manifest, and README to the isolated dev Worker.
- Cloudflare Worker deployment version ID: `93ceba5f-e3cd-41e3-b7ac-f7e3e0031f58`.
- Verified website homepage HTTP 200 and each published PCVR artifact HTTP 200; downloaded files' SHA-256 hashes matched local copies.
- DLL SHA-256: `BC879729F3C430E9327EFDF1688B42082F2EDAD7B2146A18895DAE8D74D21594`.
- ZIP SHA-256: `3D26A52A2F8D16615B5E1959AE71E23E63D28EBC1BEF32044162F671D4BF35E8`.
- Quest QMOD was not rebuilt or version-bumped in this PCVR-only release.


## Alpha tester upload — Quest dashboard preview 0.1.1 / PCVR 0.1.2

Date: 2026-11-03

- Quest source updated with a BSML side-panel RiftPulse menu, Chat and BSR dashboard toggles, local-only status display, a local five-digit pairing-code preview, and settings-preview button.
- Quest module toggles remain in-memory only; pairing code is not registered with the website/API. No Quest headset was connected, so installation, in-game menu rendering, and runtime loading remain unverified.
- Quest package version bumped from `0.1.0` to `0.1.1` in `qpm.json`, `qpm.shared.json`, `mod.json`, and `mod.template.json`. Native ARM64 compile succeeded (5/5 build steps); QMOD was packaged and its embedded `mod.json` checked for version `0.1.1` and game target `1.40.8_7379`.
- QMOD creation script reported that schema validation could not run under the available Windows PowerShell version (<6); package was generated successfully and was not claimed as schema-validated. QPM CLI was absent, so `qpm qmod manifest` regeneration was not run; manifest versions were updated directly in the canonical JSON files.
- Quest QMOD SHA-256: `02AA8CF67C792E7E02069C669B6C11EF5263FC40DC81B0CA0FC6A344B506536C`.
- Because the download page itself changed, PCVR package version was also bumped from `0.1.1` to `0.1.2`; Release build passed with 0 warnings and 0 errors. Refreshed PCVR DLL and ZIP were published alongside the Quest QMOD.
- PCVR DLL SHA-256: `BD1460EB3E8085DCD54005C4DF570B073DFFEB9972F730FBBBDFBEFC37C8DAA5`.
- PCVR ZIP SHA-256: `FD6B177B076E36CEE19466E81237ECF41E62BF50F2B5DC4964AA016F6CC367F5`.
- PCVR manifest SHA-256: `048626B8F22BF462FF349716816424B4A826F7B31223F86359C7990D2DD4AC03`.
- Website typecheck, 42 contract tests, isolated SQLite migration test, and production build passed. Deployed only to the isolated dev Worker `riftpulse-dev`; deployment version ID `30405c5f-1402-449e-90ed-a830a7236a30`.
- Verification: homepage HTTP 200; deployed client bundle HTTP 200 and includes the new per-platform versions and preview caveats. PCVR DLL, ZIP, Quest QMOD, and PCVR manifest all returned HTTP 200; remote SHA-256 matched local for every artifact.

## Alpha tester upload — Quest UI adjustment 0.1.2 / PCVR manifest fix 0.1.3

Date: 2026-11-03

- Published updated Quest QMOD 0.1.2 and PCVR DLL/ZIP 0.1.3 to the isolated `riftpulse-dev` Cloudflare Worker. PCVR package version 0.1.3 is the source release version; Quest package metadata is 0.1.2.
- PCVR package includes a refreshed manifest declaring the plugin DLL and BSML dependency; removed an extra stale bare `manifest.json` from the BSManager Plugins folder during troubleshooting. The PCVR side-panel runtime visibility remains pending in-game confirmation.
- Quest UI toggle layout adjustment was packaged. Quest headset visual verification is still pending.
- Website test workflow passed: typecheck, 42 contract tests, isolated database migration test, and production build.
- Worker deployment Version ID: `8bb92765-fc84-45b5-923d-f0683ee6daf6`.
- Verification: homepage HTTP 200; PCVR DLL, PCVR ZIP, Quest QMOD, and PCVR manifest returned HTTP 200 and remote SHA-256 hashes exactly matched local files.
- PCVR DLL SHA-256: `2473E7671659DA95F6358F13C0BC057D0D5DC1217D37F94A0F3E83497CC38A2F`.
- PCVR ZIP SHA-256: `5896298B0168DB161F509DB38361E436380C88FA6D4B811721776C5FCA33B630`.
- Quest QMOD SHA-256: `52B47193AA9F8FF613A614CF32EA5FF2A8E75682D7459B2C9D7B1611C6D1C068`.
- PCVR manifest SHA-256: `69AE217E2DB386C6B6CD990926D1E93E242749F91FF9FE41BE8C0573418B35DE`.

## PCVR IPA manifest path correction — 0.1.5

Date: 2026-11-03

- Root cause: the PCVR BSIPA manifest is installed under `Plugins`, but its `files` declaration incorrectly used `Plugins/RiftPulse.Pcvr.dll`. BSIPA resolved that path relative to the Plugins directory and consequently could not locate the DLL.
- Corrected manifest declaration to `RiftPulse.Pcvr.dll` (relative to `Plugins`) and bumped PCVR package version to 0.1.5.
- Rebuilt web client assets and deployed the corrected PCVR DLL, ZIP, manifest, and README to the dev Cloudflare Worker.
- Verified HTTP 200 and matching local/remote SHA-256 for manifest, ZIP, and DLL.
- Deployment Version ID: `8127f33b-70a9-4da2-bfd1-d1e7af662e57`.
- Updated the local BSManager Beat Saber 1.40.8 Plugins DLL and manifest; retained timestamped backups of both.
- IPA runtime confirmation of the side-panel entry remains pending next game launch.

## PCVR manifest path correction — 0.1.4

Date: 2026-11-03

- Diagnosed BSIPA warning: manifest declared `RiftPulse.Pcvr.dll` as a game-root relative path while the DLL is installed under `Plugins/`.
- Corrected manifest `files` entry to `Plugins/RiftPulse.Pcvr.dll`; bumped PCVR package and project version to 0.1.4, rebuilt Release (0 warnings/errors), installed updated DLL and manifest in BSManager Beat Saber 1.40.8 instance.
- Repacked PCVR ZIP with manifest at archive root and DLL inside `Plugins/`.
- Rebuilt client assets before Wrangler deployment; deployed to isolated development Worker.
- Verification: homepage and all three PCVR download endpoints HTTP 200. Remote SHA-256 exactly matches local for DLL, ZIP, and manifest.
- DLL SHA-256: `318988B347FCF4B139B31BF96FA9BA174983D07EB539E11D829B4ED4441B9E42`.
- ZIP SHA-256: `C428D7DAF7CD0A44F70BF20F0E7D6717B17933E56372C73BA3E51C775513AC93`.
- Manifest SHA-256: `8C7B5FE566FB3B1856471B71D55705199534B6717BF76D426E15019C1490B74F`.
- Runtime confirmation of side panel visibility still awaits the next Beat Saber launch.

## PCVR import manifest parser fix — 0.1.6

Date: 2026-11-03

- Root cause for import parsing error at line 1 column 1: published `manifest.json` had a UTF-8 BOM, which the target import parser rejected.
- Rewrote published manifest as UTF-8 without BOM; validated it parses with PowerShell JSON parser.
- Split path semantics correctly: archive-root manifest declares `Plugins/RiftPulse.Pcvr.dll`; the in-Plugins installed manifest declares `RiftPulse.Pcvr.dll`.
- Repackaged PCVR ZIP with root `manifest.json`, `Plugins/RiftPulse.Pcvr.dll`, and README. Bumped PCVR release version to 0.1.6.
- Deployed Cloudflare Worker successfully. Remote manifest and ZIP HTTP 200 and SHA-256 matched local copies.
- Local BSManager manifest rewritten clean UTF-8 with relative plugin path. Runtime loader and ModsBeforeFriday importer still await user test.
- manifest SHA-256: `B6B82D35CF6D075BF9A79C39E1D86609C8C962016FF69F8A5A77E11381C144C8`.
- ZIP SHA-256: `9608FF484117164DF627ADB956D9EBBF3ED58C6E4F09C0AAB38CCA2CAD1EF34E`.

## Dual-platform manifest fixes — PCVR 0.1.7 / Quest 0.1.3

Date: 2026-11-03

- Scope: fixed platform-specific manifests; ModsBeforeFriday parsing fix was applied to Quest QMOD only. PCVR archive uses its BSIPA manifest with path relative to archive root, while the in-Plugins manifest declares the DLL relative to Plugins.
- PCVR source Release build: `dotnet build mods/pcvr/RiftPulse.Pcvr.csproj -c Release` succeeded with 0 warnings and 0 errors. Version bumped to 0.1.7 in csproj and manifest. DLL SHA-256: `DD12DC5F49F8E52E23496A9ADDB8A5FD9FF185A969F74F28D3CF88FA15786869`. ZIP SHA-256: `F6C3621352E8DB921914B8617189316AA560958FBAD7CF72EAB818A381EB4AD0`. Archive entries: `manifest.json`, `Plugins/RiftPulse.Pcvr.dll`, `README.txt`.
- Quest source metadata rewritten as UTF-8 without BOM, QMOD and QPM versions bumped to 0.1.3. Quest native build and QMOD packaging succeeded. QMOD internal mod.json parsed successfully and confirms name/id and version `_QPVersion` 0.1.3. The bundled schema validator reports it cannot validate due to its PowerShell-version requirement (<6); JSON parsing check passed. Quest QMOD SHA-256: `6FAA3257C34B8F82188F205EA87136428907B306CAAE215ADB7D0F3A9C81B811`.
- `npm test`: passed typecheck, 42 contract tests, isolated database migration test, and production Vite build.
- Uploaded to isolated Cloudflare development Worker `riftpulse-dev`: `https://riftpulse-dev.chrismeten0.workers.dev`. Deployment Version ID: `1cabf69b-0afb-4b2b-9ebd-75cd0856734e`.
- Verification: homepage and PCVR manifest/DLL/ZIP and Quest QMOD HTTP 200. SHA-256 for all four downloads exactly matches local artifacts. PCVR published manifest is BOM-free (starts with bytes `7B 0D 0A`); version and archive file path parsed correctly. PCVR DLL and in-Plugins manifest installed into BSManager Beat Saber 1.40.8 instance, version 0.1.7; timestamped prior backups preserved from earlier installation.
- Runtime validation still requires the next PCVR Beat Saber launch and user testing Quest QMOD import/install on headset. Existing Quest feature limitations remain as documented (preview controls; pairing code not registered server-side; live Chat/BSR not yet implemented).

## Quest QMOD schema enum correction — Quest 0.1.4

Date: 2026-11-03

- Reported ModsBeforeFriday validation failure: `_QPVersion` was `0.1.3`, outside the accepted schema enum `0.1.0`, `0.1.1`, `0.1.2`, `1.0.0`, `1.1.0`, `1.2.0`. This field indicates the QMOD format, not RiftPulse release version.
- Changed Quest QMOD `_QPVersion` to accepted `1.2.0`; incremented RiftPulse Quest mod package version and QPM metadata from `0.1.3` to `0.1.4`. PCVR artifact unchanged.
- Quest native build succeeded; regenerated QMOD internal `mod.json` extracted and parsed, confirming package version `0.1.4` and QMOD format `1.2.0`. `npm test` passed: typecheck, 42 contract tests, isolated migration test, and production build. The build script invokes `qpm qmod manifest` but `qpm` CLI is unavailable in this shell; package generation completed and metadata was independently verified against the enum provided by the ModsBeforeFriday screenshot.
- Deployment to isolated Cloudflare Worker `riftpulse-dev`: `https://riftpulse-dev.chrismeten0.workers.dev`; Version ID `ddde181a-149f-4f20-97f5-abc5c954294a`.
- Verification: homepage and Quest download HTTP 200. Remote Quest QMOD SHA-256 matches local artifact: `30211637A13378F49A9ED51FF12E2B1D096D0E8DCB9BDF105DB9F4869FF0F34D`. Downloaded QMOD internal metadata confirms `version=0.1.4`, `_QPVersion=1.2.0`.
- User should retry importing the newly published QMOD in ModsBeforeFriday. Runtime import on user device not yet confirmed.

## PCVR manifest/package refresh — 0.1.8

Date: 2026-11-03

- Rebuilt PCVR release after tracing the manifest DLL path warning. Bumped PCVR canonical csproj and BSIPA manifest version from 0.1.7 to 0.1.8. Release build passed with 0 warnings and 0 errors.
- Repacked the archive with root `manifest.json`, `Plugins/RiftPulse.Pcvr.dll`, and `README.txt`; archive root manifest JSON parsed and verified version 0.1.8 and the game-root path `Plugins/RiftPulse.Pcvr.dll`. Updated the standalone download `manifest.json` and `PCVR-README.txt` to 0.1.8.
- `npm test` passed: TypeScript typecheck, all 42 contract tests, isolated SQLite migration test, and production build. After static download metadata updates, production Vite build passed again.
- Deployed to isolated dev Worker `riftpulse-dev` at `https://riftpulse-dev.chrismeten0.workers.dev`. Final Worker Version ID: `642613ed-a54f-44be-81f6-0bbb3376b94a`. No production environment touched.
- HTTP verification: homepage, PCVR DLL, PCVR ZIP, `RiftPulse.Pcvr.manifest.json`, generic `manifest.json`, and `PCVR-README.txt` all returned HTTP 200; remote SHA-256 matched each local asset exactly.
- SHA-256 DLL: `81CDB694E589FEB8554683B2B2ADACF235C63D096C120B5878545A9C5BA78C8B`; ZIP: `97D9D51EB33C6CFB77AF2270D412D7D54EDB5EA5D57CD2748C497A3966E0FA73`; manifests: `7CB0DB731331460CC102383FB16E592A30DA1480C0A8828E697B336E11FCBA6D`; README: `3B454E51A071DAAA460FCE376133BBE8DBD7C0F9C27D60CD62CF2C8AF3C0856E`.
- The in-game side-panel/load fix still awaits confirmation on the next Beat Saber launch. Website release is live and file/version metadata was verified. Quest artifact left unchanged at 0.1.4.

## Quest UI encoding and panel layout fix - 0.1.5

Date: 2026-11-03

- Inspected user headset screenshot and identified garbled source-string characters and long BSML Lite toggle/button labels extending beyond panel bounds.
- Replaced non-ASCII separator/icon text with ASCII-safe strings, shortened toggle names to CHAT MODULE and BSR MODULE, shifted toggle/action buttons 12 UI units right, and slightly enlarged text hierarchy for legibility.
- Bumped canonical QPM and QMOD metadata to Quest 0.1.5. Native ARM64 release build succeeded; QMOD package assembled and embedded mod.json verified to report 0.1.5 for Beat Saber 1.40.8_7379.
- QMOD validator reported it could not schema-validate because this host Windows PowerShell is below version 6; artifact creation still completed, ZIP/QMOD structure and embedded metadata were inspected. This validator limitation is recorded; no claim of schema validation.
- Website tests passed: TypeScript check, 42 contract tests, isolated SQLite migration, production website build.
- Deployed only to the isolated dev Cloudflare Worker `riftpulse-dev`, `https://riftpulse-dev.chrismeten0.workers.dev`. Worker Version ID: `650be217-8766-4c72-8a27-c1d194910924`. PCVR artifacts were not modified in this release.
- HTTP verification: website and Quest QMOD and Quest README returned HTTP 200. Downloaded QMOD and README SHA-256 matched local exactly. QMOD remote embedded version checked as 0.1.5.
- QMOD SHA-256: `247D5E0DEDE5478625BB335136D8C54FD6BE5B51770F9CAB57413EA07139684A`; README SHA-256: `3D7F89B269361DD784648C570C7D7E862C173982ACE874A46A9DB279CF0681BF`.
- Runtime headset layout is not re-confirmed yet; user must install/update the QMOD and capture a fresh menu screenshot to validate positional refinements.

## Quest standalone menu refinement - 0.1.5

Date: 2026-11-03

- Addressed the Quest 1.40.8 screenshot: replaced corrupted multibyte/icon glyphs with ASCII-safe strings, reduced oversized button/text widths and vertical spacing, and shortened module toggle labels to avoid clipping and control-label separation.
- Bumped Quest package and QPM metadata to 0.1.5. ARM64 compile succeeded (`cmake --build build`, Ninja reported no work after clean build); QMOD packaging succeeded. Schema validator reports its local PowerShell-version limitation, so manifest validation was performed by parsing the archived mod.json and confirming version 0.1.5.
- Updated public/downloads/RiftPulse.Quest.qmod. Existing 0.1.4 package retained in mods/quest/releases as backup. Website build/test passed: typecheck, 42 contract tests, isolated migration, and Vite production build.
- Deployed isolated dev Worker `riftpulse-dev`, Version ID `8e0427a4-9979-4794-9719-4adeb76820be`. Verified website and QMOD download HTTP 200, and remote SHA-256 matches local `CE1FFD94CD947F4F8C7B4AA7C72316986756B01C94A1DBC82A3EA818ED92BDCE`.
- Quest runtime layout and headset install are not yet independently confirmed; this is the new UI build for retest.

## Quest MBF import manifest BOM fix - 0.1.6

Date: 2026-11-03

- Root cause identified from archive inspection: both source mods/quest/mod.json and the mod.json entry within the previous Quest QMOD began with UTF-8 BOM bytes EF BB BF. MBF parser error at line 1 column 1 matched this defect.
- Rewrote Quest mod.json and template as UTF-8 without BOM, incremented Quest package version to 0.1.6, and repackaged QMOD. Archive verification confirms the root mod.json entry begins with bytes 7B 0D 0A 20 (opening brace, no BOM), and its JSON parses with version 0.1.6.
- Website checks passed: RiftPulse development site HTTP 200, Quest QMOD download HTTP 200, and downloaded QMOD SHA-256 matches local artifact. Previous invalid package backup was moved out of public/downloads into mods/quest/releases.
- Website suite passed: TypeScript typecheck, all 42 contract tests, isolated SQLite migration test, and Vite production build. MBF headset import still requires user retest; QMOD packaging and remote bytes are validated.

## Quest MBF manifest parse fix - 0.1.6

Date: 2026-11-03

- Reproduced the MBF import parse failure clue by inspecting QMOD bytes: embedded root `mod.json` began with UTF-8 BOM (EF BB BF), causing parsers to fail immediately at line 1 column 1.
- Removed BOM from canonical Quest `mod.json` and template, incremented package version to 0.1.6, regenerated QMOD. Archive internal manifest starts with `7B 0D 0A 20` (JSON opening brace, no BOM); JSON parse succeeds and package metadata reports version 0.1.6.
- QPM CLI `qpm` is not installed in this shell; packaging script reports schema-validation skipped due Windows PowerShell version below 6. ZIP structure and embedded JSON were manually validated.
- Website checks passed: `npm test` including typecheck, 42 contract tests, isolated migration test, and production build.
- Deployed isolated Cloudflare dev Worker `riftpulse-dev` at `https://riftpulse-dev.chrismeten0.workers.dev`; Worker Version ID `2eaba658-f445-4c34-ad34-b139e7cbe8a1`. No production environment touched.
- Remote Quest QMOD HTTP download SHA-256 matches local file: `F339DAA23ECADFF71C1DD776A103090579E270A2E4E4A2D4270ED33E9875D2D9`; downloaded archive internal manifest reports `version=0.1.6`.
- MBF import on headset remains user-side retest, not claimed as confirmed.

## Quest version alignment and QMOD rebuild - 0.1.7

Date: 2026-11-03

- Preserved the previous 0.1.6 QMOD, 0.1.5 build-folder QMOD, QPM metadata, manifests and READMEs in mods/quest/releases/pre-0.1.7-metadata-alignment-20261103 before updating the release.
- Found the previous published 0.1.6 QMOD manifest did not match the internal native binary build version: mod.json was 0.1.6 while qpm.json still set CMake PACKAGE_VERSION to 0.1.5 and qpm.shared.json config version was 0.1.4. Updated the release version declarations to 0.1.7 in mod.json, mod.template.json, qpm.json, qpm.shared.json, and tester-facing READMEs.
- Reconfigured CMake/Ninja; configure output confirmed PACKAGE VERSION: 0.1.7 and build.ninja contains -DVERSION=\"0.1.7\". ARM64 libriftpulse.so rebuilt successfully (exit code 0); SHA-256: 6DCE932DE0C82FCFB63590FE25474C505D3C3F14F2486670D35CE6D668576877.
- Created fresh QMOD with exactly three root entries: mod.json, libriftpulse.so, and libbeatsaber-hook.so. The manifest parses as UTF-8 JSON without BOM; _QPVersion=1.2.0, modloader=Scotland2, version=0.1.7, game target 1.40.8_7379. All manifest-referenced binary entries were present. QMOD SHA-256: DF2134837126B04A625FC48CEA0BEA40D721B3A421D43EF18D650B6F3F27E61C.
- Tooling limitation: qpm CLI and PowerShell Core were unavailable, so QPM's own manifest-generation/schema-validation script was not run and dependencies were not re-resolved. The existing pinned dependencies were reused. The QMOD archive and required schema fields/enums, paths and JSON encoding were checked manually against the current QMOD schema.
- npm test passed: TypeScript check, 42 contract tests, isolated SQLite migration test, and production Vite build.
- Deployed to isolated Cloudflare Worker riftpulse-dev: https://riftpulse-dev.chrismeten0.workers.dev. Worker Version ID: ce50893c-dfa2-4761-9627-69971be25812. No production environment was touched.
- Post-deploy: homepage, Quest QMOD and Quest README returned HTTP 200. Downloaded QMOD matched the local file byte-for-byte; remote SHA-256: DF2134837126B04A625FC48CEA0BEA40D721B3A421D43EF18D650B6F3F27E61C. Remote manifest reports riftpulse 0.1.7, QMOD format 1.2.0, Scotland2, Beat Saber 1.40.8_7379, no UTF-8 BOM.
- MBF import and real Quest 2 runtime load remain unverified: adb devices -l returned an empty device list. Do not mark the Quest install as complete until the user confirms MBF import and provides runtime evidence.
- Scope note: Quest in-game screen still provides preview-only Chat/BSR toggles and a local-only test code; real Quest pairing/backend sync, persisted settings, live chat, viewer aggregation and BSR are not implemented by this build.

## PCVR 0.1.8 package integrity recheck - 2026-11-03

- Rebuilt PCVR project in Release against pinned Beat Saber 1.40.8 assemblies: 0 warnings, 0 errors.
- Fresh output DLL SHA-256: 81CDB694E589FEB8554683B2B2ADACF235C63D096C120B5878545A9C5BA78C8B. Published standalone DLL has the same SHA-256.
- Inspected PCVR ZIP entries: root manifest.json, root README.txt, and Plugins/RiftPulse.Pcvr.dll. Embedded DLL hash equals fresh build. Root manifest parses as JSON and reports version 0.1.8 with declared path Plugins/RiftPulse.Pcvr.dll.
- PCVR artifact content is unchanged from the already deployed 0.1.8 package; no version bump or re-upload needed for this verification-only rebuild.
- PCVR in-game menu/load remains unverified in an actual Beat Saber run.

## Quest dependency-manifest correction and release - 0.1.8

Date: 2026-11-03

- Supersedes the interim 0.1.7 upload. The 0.1.7 manifest had an obsolete Paper dependency, omitted the project's resolved BSML, Custom Types, Beat Saber Hook and Paper2 dependencies, and did not explicitly set the Scotland2 loader in the QPM template. Do not use 0.1.7 for new tester installs; 0.1.8 is the current Quest download.
- Restored the correct QPM schema-version fields: qpm.json root version 0.1.5 and qpm.shared.json config.version 0.1.4. Only the mod release info.version fields now read 0.1.8. The template uses the QPM version placeholder and explicitly selects Scotland2.
- Reproduced the current QPM manifest-generation dependency mapping from the QPM.CLI source: the direct modLink dependencies resolved by qpm.shared.json are beatsaber-hook 6.4.2, bsml 0.4.55, custom-types 0.18.4 and paper2_scotland2 4.8.0. Scotland2 is not downloaded as a QMOD (includeQmod=false); it is selected as the manifest modloader. The QMOD now declares the four direct dependency QMOD URLs, all returned HTTP 200.
- QPM CLI itself was not installed on the PC, so its generation/validation script was not run. The manifest was constructed manually to mirror the inspected QPM CLI generator behavior, then checked for required fields, supported QMOD version/loader enum values, SemVer version, four dependency id/version/download URLs, root JSON UTF-8 without BOM, and all referenced archive files.
- Rebuilt the ARM64 native library with CMake/Ninja; configure output reported PACKAGE VERSION 0.1.8 and build.ninja uses VERSION=0.1.8. Build exit code 0. Native library SHA-256: 1A9B153A825A8680C807357F5DB7F4240CA538779138C1C31698275D209A0030.
- QMOD has exactly two root entries: mod.json and libriftpulse.so. Its manifest reports id riftpulse, version 0.1.8, _QPVersion 1.2.0, loader Scotland2, Beat Saber package version 1.40.8_7379 and four resolved dependencies. QMOD SHA-256: 67CC3F6520040F2050B8721D7A473BEAA5F81A50ED0E5F4B7763B144B9DD111B.
- npm test passed: TypeScript check, 42 contract tests, isolated SQLite migration test, and worker/client production build.
- Deployed to the isolated Cloudflare Worker riftpulse-dev: https://riftpulse-dev.chrismeten0.workers.dev. Worker Version ID: 8460234c-96b2-4f6b-867c-c448b37e1449. No production environment was touched.
- Post-deploy: homepage, QMOD and Quest README returned HTTP 200. The downloaded QMOD matched the local artifact byte-for-byte; remote SHA-256: 67CC3F6520040F2050B8721D7A473BEAA5F81A50ED0E5F4B7763B144B9DD111B. Remote manifest confirms version 0.1.8, QMOD 1.2.0, Scotland2, game 1.40.8_7379, no BOM, and dependencies beatsaber-hook, bsml, custom-types, paper2_scotland2.
- MBF import and Quest 2 runtime load are still unverified: adb devices -l returned an empty device list. The next required action is a user-side MBF import and on-headset load check.
- Scope remains preview-only: Quest Chat/BSR toggles are in-memory only; its pairing button generates a local test code and is not connected to the website/API. Persisted settings, actual pairing/backend sync, live chat/viewer aggregation and BSR queue integration remain unfinished. PCVR/Quest in-game runtime validation is also outstanding.


## PCVR installed-manifest path and version alignment — 0.1.9

Date: 2026-11-04

- Investigated the latest PCVR install tree in the BSManager Beat Saber 1.40.8 instance. The installed RiftPulse.Pcvr.manifest.json was still version 0.1.7 and its declared files path was Plugins/RiftPulse.Pcvr.dll, despite the manifest itself living inside Plugins. This stale path is rooted at the Plugins directory and incorrectly adds another Plugins segment; it does not point at the installed DLL. This was the concrete package/install mismatch to correct.
- Bumped the canonical PCVR project and BSIPA manifest/download metadata to 0.1.9. Installed manifest now uses the Plugins-relative path RiftPulse.Pcvr.dll; the archive-root manifest continues to correctly declare Plugins/RiftPulse.Pcvr.dll relative to the game root.
- Release build passed: dotnet build mods/pcvr/RiftPulse.Pcvr.csproj -c Release (0 warnings, 0 errors). Confirmed the freshly built DLL embeds both manifest.json and RiftPulse.Pcvr.pairing.bsml resources.
- Repacked ZIP and refreshed installed DLL plus manifest in BSManager 1.40.8. ZIP entries verified: manifest.json, Plugins/RiftPulse.Pcvr.dll, README.txt.
- DLL SHA-256: 9C926730C39F1855715CB681656257E950F7E932104934D88D5C225763575394. ZIP SHA-256: F6BD6A966F2564AB27B9A058212D3ED5702DEC1FFAB6DB3A90364D4F34818A4B.
- Website npm test passed: TypeScript typecheck, 42 contract tests, isolated SQLite migration test, and Vite production build.
- Deployed the updated PCVR tester artifacts to the isolated dev Worker riftpulse-dev (https://riftpulse-dev.chrismeten0.workers.dev); Wrangler deployment succeeded. No production environment touched.
- Post-deploy verification: DLL, ZIP, generic manifest, PCVR manifest, and PCVR README all returned HTTP 200 and their downloaded SHA-256 hashes matched the local files. Published metadata reports PCVR 0.1.9.
- Important remaining test: a fresh Beat Saber launch is still required to confirm IPA loads RiftPulse and the side-panel entry appears. The package/path/version mismatch is fixed in the install, but live runtime success is not yet confirmed.

- Follow-up hardening: rewrote the installed BSManager manifest using UTF-8 without BOM and reread it to confirm version 0.1.9 plus the corrected Plugins-relative DLL path.


## Quest Standalone UI layout refresh — 0.1.9

Date: 2026-11-04

- Addressed screenshot showing Quest panel labels overlapping and central copy too small. Main menu content moved into a more compact vertical arrangement, with Chat/BSR toggles spaced further apart, increased text sizing, widened button boxes, and pairing/settings/footer brought upward into panel bounds.
- Quest native clean build completed successfully with CMake/Ninja, linking libriftpulse.so. CMake produced toolchain/deprecation warnings, no build failure.
- Updated mod.json and qpm info version to 0.1.9.
- Packaged QMOD archive with mod.json and libriftpulse.so at archive root. Archive entries verified. SHA256: 93E089CB52A6D0EB8EA3A5F6E4F55152FD291A62F8E871DD5E900CBC73D4D209.
- Deployed Quest artifact to dev Worker URL /downloads/RiftPulse.Quest.qmod. Remote download hash matched local SHA256 exactly. Worker deployment succeeded.
- Headset visual runtime validation is pending; screenshot tester should import updated Quest 0.1.9 QMOD and share updated image if any positioning remains off.


## Quest UI recode — 0.1.10

Date: 2026-11-04

- Replaced the prior Quest menu layout code with a clean single-column composition rather than continuing incremental positional tweaks. Simplified title/subtitle, one central status block, spaced Chat/BSR toggles, distinct pairing action/status, settings preview, and footer; clearer text hierarchy and wider button bounds intended to prevent BSML label overlap observed in tester screenshot.
- Native Quest build completed exit code 0. Website build completed exit code 0. Worker deployment completed successfully (dev only).
- QMOD packaging validated, archive contains `libriftpulse.so` and `mod.json`; mod metadata version 0.1.10 and target Quest Beat Saber 1.40.8_7379.
- Download endpoint `/downloads/RiftPulse.Quest.qmod` returned identical SHA-256 to local artifact: 139E69A4AB88268AAEE0673C372C632872BD5AFA860B532B4327F4B4574E4F14.
- Device headset visual test remains pending.


## PCVR embedded BSIPA manifest resource correction — 0.1.10

Date: 2026-11-04

- Diagnosed the exact IPA log root cause against BSIPA PluginLoader source. Loader inspects embedded assembly resources for a name ending in `.manifest.json`, then derives the plugin namespace from the resource-name prefix. Our csproj had embedded the resource as only `manifest.json`, so IPA logged `No manifest.json in RiftPulse.Pcvr.dll`. The previously generated loose `RiftPulse.Pcvr.manifest.json` in Plugins was also stale bare metadata and carried an incorrect Plugins-relative path, producing the missing-DLL warning.
- Corrected csproj LogicalName to `RiftPulse.Pcvr.manifest.json`; resource prefix now matches the RiftPulse.Pcvr namespace. Preserved the manifest `files` entry as `Plugins/RiftPulse.Pcvr.dll`, relative to the Beat Saber install root.
- Bumped PCVR version to 0.1.10 in csproj, canonical manifest, published manifest and README. Release build succeeded: 0 warnings, 0 errors.
- Verified built DLL embeds exactly `RiftPulse.Pcvr.manifest.json` and `RiftPulse.Pcvr.pairing.bsml`. Refreshed BSManager Beat Saber 1.40.8 DLL. Backed up then removed the stale loose `RiftPulse.Pcvr.manifest.json` from the active Plugins scan so IPA reads the manifest embedded in the DLL.
- Repacked ZIP with root manifest.json, Plugins/RiftPulse.Pcvr.dll, README.txt. DLL SHA-256: 4BE2FF9DE6A35B9668C1AE249C5F5F551E9E016C092E816AA57E728F4F255B8D. ZIP SHA-256: FDF941BFC44E60DFDA32863296593E382F014C03214A768AFE29E6F77000BA35.
- `npm test` passed: TypeScript typecheck, 42 contract tests, isolated SQLite migration test, production Vite build.
- Deployed only to isolated development Worker `riftpulse-dev` at https://riftpulse-dev.chrismeten0.workers.dev. Worker version ID: ca3df043-02f3-4c20-b0ee-fe234af3ed02.
- Post-deploy verification: PCVR DLL, ZIP, manifest and README all returned HTTP 200; remote SHA-256 matched local files exactly. Published manifest reports 0.1.10.
- Remaining validation: start Beat Saber 1.40.8 on the PCVR test instance and confirm IPA adds RiftPulse without either previous warning. This build fixes the exact resource-name and loose-manifest path causes but runtime success is not claimed until fresh launch confirms it.


## Quest Standalone typography adjustment — 0.1.12

Date: 2026-11-04

- Tester screenshot of 0.1.11 confirmed overlap was gone but the single central text panel remained too small at font size 2.0. Kept the one-component layout to avoid the prior overlapping BSML controls and increased font size to 3.6, expanded text area to 58x32, and shortened labels to improve readability while retaining all status information.
- Updated Quest mod.json and QPM info version to 0.1.12; target remains Beat Saber 1.40.8_7379, Scotland2.
- Clean native Quest CMake/Ninja build completed exit code 0.
- QMOD rebuilt and verified: archive includes libriftpulse.so and mod.json; SHA-256 6165AC2FCF04696DAD7D9C7EB04B0F45E6AFCD61A78B59600735A3E64EEBD6ED.
- Website build completed successfully; uploaded and deployed to the isolated dev Worker. Worker version ID 0676375b-3450-41e0-b91a-ca572c11390e.
- Download URL remote SHA-256 matched local QMOD exactly; remote metadata confirms version 0.1.12 and packageVersion 1.40.8_7379.
- Headset-side visual confirmation of the revised type size remains pending.


## Alpha tester upload — Quest 0.1.16 (November 4, 2026)

- User requested publishing the Quest alpha for testers; local headset testing is not a release prerequisite.
- Rebuilt Quest ARM64 native library from current source (CMake/Ninja, 5/5 steps succeeded), regenerated QMOD, and bumped Quest package metadata to 0.1.16. QMOD schema validation could not run in Windows PowerShell 5.1 (validator requires PowerShell 6+); embedded JSON was independently parsed.
- Refreshed `public/downloads/RiftPulse.Quest.qmod` and `Quest-README.txt`; README explicitly identifies preview-only pairing/chat/BSR functionality.
- Website `npm test` passed: typecheck, 42 contract tests, isolated migration test, and production Vite build.
- Deployed only to the isolated Cloudflare development Worker `riftpulse-dev`: `https://riftpulse-dev.chrismeten0.workers.dev`. Worker deployment Version ID: `4262a13e-25ae-4aaf-9f2c-e1bef0575de9`.
- Download verification: QMOD HTTP GET succeeded and local/published SHA-256 matched: `B37BE691C43484C144BE7A6007C21D8BFBD40196AAF8D1702F1EA33DD8F338A0`.
- Alpha testers subsequently confirmed Quest 0.1.16 loaded normally and as expected. This closes the MBF/package-load confirmation gate for this alpha build; feature-level pairing, chat, settings persistence, and BSR behavior remain preview-only/unimplemented.


## PCVR module-switch local persistence prototype (November 4, 2026)

- Added local persistence for the PCVR Chat/BSR module switch preview in `mods/pcvr/RiftPulseFlowCoordinator.cs`.
- State loads on view-controller construction and saves on each toggle to `%LOCALAPPDATA%\\RiftPulse\\pcvr-module-preview-settings.txt` (two boolean lines).
- UI labels/status explicitly communicate that the switches are locally saved previews only; they do not activate module services or sync to the website.
- PCVR project compiled successfully with `dotnet build mods\\pcvr\\RiftPulse.Pcvr.csproj -c Release --no-restore`: 0 warnings, 0 errors.
- Backend settings sync, dashboard gating/configuration navigation, and actual PCVR runtime validation remain outstanding.


## Module settings sync auth gap review (November 4, 2026)

- Reviewed Worker module settings endpoints and Railway device credential handling.
- Dashboard settings GET/PATCH currently use Better Auth account sessions. The mod's 64-hex device credential is validated in the Railway realtime WebSocket upgrade branch, where its SHA-256 digest maps to an active, non-revoked device and active account.
- Do not reuse the session-bound settings routes or send credentials without a device-specific endpoint. Next engineering item is adding device-authenticated settings GET/PATCH routes with strict validation and account/device state checks, then wiring PCVR and eventually Quest to them.
- No API deployment or module sync claimed in this review.


## Device-authenticated module settings API + PCVR wiring (November 4, 2026)

- Added shared API routes `GET /api/v1/device/settings/modules` and `PATCH /api/v1/device/settings/modules/{chat|bsr-song-request}`.
- Device authorization accepts a 32-byte hex bearer credential, hashes it with SHA-256, and resolves only active accounts with a non-revoked device record. Session-based website settings endpoints were kept distinct.
- GET initializes module defaults and returns saved enabled/settings values; PATCH accepts only `enabled` and/or an object `settings`, enforces a 4 KiB request cap and 3 KiB serialized settings cap, then persists into `module_settings`.
- PCVR module toggles now issue authenticated PATCH requests; pairing claim triggers an authenticated GET to hydrate module state. Local saved preview values remain fallback if sync fails. UI labels note account-synced settings are not service activation.
- `npm.cmd test` passed: TypeScript typecheck, all 42 unit tests, isolated SQLite migration test, and production build. Tests currently do not contain dedicated cases for these newly added device-settings routes.
- `dotnet build mods\\pcvr\\RiftPulse.Pcvr.csproj -c Release --no-restore` passed (0 warnings/errors).
- Not deployed to Railway development yet; real device credential endpoint verification and runtime PCVR interaction remain pending.


## Alpha tester upload — Quest account-pairing client 0.1.17 (November 4, 2026)

- Replaced the Quest local-only code preview with a native API-connected pairing client for Beat Saber 1.40.8 / Scotland2. The client generates a five-digit code, creates a persistent installation UUID and 32-byte random device credential, registers the pairing challenge, checks claim status, and after claim loads account Chat/BSR module preferences. Chat and BSR switches save through the authenticated device-settings PATCH endpoints.
- Installation identity is persisted under Unity's app-specific persistent-data directory; the credential is generated from `/dev/urandom`, stored in an app-private file with owner-only permissions, and never sent back by the API.
- Updated Quest metadata to 0.1.17 in the QPM package info and template. QMOD target remains `com.beatgames.beatsaber` / `1.40.8_7379`, QMOD format `1.2.0`, Scotland2 loader, with Beat Saber Hook, BSML, Custom Types, and Paper2 dependencies.
- Clean ARM64 native CMake/Ninja build passed (5/5 steps); build exit code 0 using NDK 27.2.12479018. Compiled `libriftpulse.so` SHA-256: `FA37BC9E3C255D7415BCF8D8A5DDB3C8E6658A44C2CE224A9EF14C18362BA0FA`.
- QMOD package generated and manually verified: exactly two root entries, `mod.json` and `libriftpulse.so`; embedded manifest parses as JSON, reports version 0.1.17 and game package 1.40.8_7379, and declares the root library. Embedded library SHA-256 exactly matches the compiled output. QMOD SHA-256: `AB4D946C198B25B6A4702DD4172B2C107A82AA167772A9B3312EB06ADBAAF1BC`.
- The local QMOD schema validator could not run its schema branch because the available Windows PowerShell is 5.1 (it requires PowerShell 6+). The QPM CLI is also not installed; the canonical manifest/QPM version fields were checked and the JSON/ZIP payload independently verified. This is not recorded as a schema-validator pass.
- Updated `public/downloads/RiftPulse.Quest.qmod` and `Quest-README.txt`. README describes the pairing steps and clearly states that the status check is manual and that Chat provider events, combined viewer count, ChatIntegrations command execution, and the BSR request queue are not implemented by this client.
- `npm.cmd test` passed: TypeScript typecheck, 44 contract/unit tests, isolated database migration test, and production Vite build. Wrangler 4.155.0 dry-run succeeded and reported the existing development bindings.
- Deployed only to the isolated development Worker `riftpulse-dev` at `https://riftpulse-dev.chrismeten0.workers.dev`. Worker Version ID: `3e266539-e507-4eb4-a91a-2555619be03e`. Exactly two static download assets were uploaded (Quest QMOD and Quest README); no production Worker or database was changed.
- Post-deploy HTTP GET verification: homepage, Quest QMOD, and Quest README each returned HTTP 200. Downloaded QMOD SHA-256 matched local artifact exactly: `AB4D946C198B25B6A4702DD4172B2C107A82AA167772A9B3312EB06ADBAAF1BC`. Downloaded README SHA-256 matched local file exactly: `DCBF3471486C20CCED991A4F438CC056775568D2D706F6B26C8B148593C1DDC2`. Published README reports version 0.1.17.
- Runtime gate remains open: `adb devices -l` showed no connected Quest. This build was compiled, packaged, uploaded, and verified over HTTP but has not been installed or exercised inside the headset. Pairing uses a manual status-check button rather than automatic 1.5-second polling. Module controls save account preferences; actual live Chat/provider-event processing and BSR song-request fulfillment remain separate unfinished features.


## Quest pairing request construction and diagnostics — 0.1.18 (November 4, 2026)

- Replaced the Quest client's reflective `UnityWebRequest.Post(url, string)` call with the explicit UnityWebRequest constructor and runtime-resolved `UnityEngine.Networking.UploadHandlerRaw(byte[])`. Pairing POST and device-settings PATCH now send raw UTF-8 JSON with `Content-Type: application/json`, matching the API contract instead of relying on Unity's form-encoded string POST overload.
- Added stage-specific diagnostics for request construction, UploadHandlerRaw lookup/constructor, header setup, and SendWebRequest startup. Completion records Unity's native request error, and pairing registration displays bounded API error code/message details when the server rejects the request. The prior generic "check Quest internet connection" status is replaced with the concrete error stage.
- Quest release metadata aligned at 0.1.18 in `src/main.cpp`, `qpm.json`, `qpm.shared.json`, and `mod.json`. The current device API and website pairing contracts were left unchanged; the request now conforms to their JSON requirement.
- Clean ARM64 CMake/Ninja build passed (5/5 steps, exit code 0) using NDK 27.2.12479018. Fresh `libriftpulse.so` SHA-256: `89779447D253C8FD302BA9F70C499861FDEE08885D19BFAE0548E8BC5469739A`.
- Generated QMOD archive and independently inspected its contents: exactly `mod.json` and `libriftpulse.so`; manifest version 0.1.18, package `com.beatgames.beatsaber`, game `1.40.8_7379`, Scotland2 loader, and library declaration. Embedded library hash matches the fresh build. QMOD SHA-256: `9DDF2535349C1FD4CE81D3908D5A88E58832ECEC10DAE7D62B37DD09A06B8E26`.
- QMOD schema validation could not run because the available Windows PowerShell is 5.1 (the package validator requires PowerShell 6+); QPM CLI is not installed. The manifest was parsed as JSON and the archive entries/library hash were independently verified. This is not recorded as a schema-validator pass.
- Updated `public/downloads/RiftPulse.Quest.qmod` and `Quest-README.txt`. README explains the raw JSON request fix, current-code pairing instructions, specific diagnostics, and outstanding runtime/feature limits.
- `npm.cmd test` passed: TypeScript typecheck, all 44 unit/contract tests, isolated database migration test, and production Vite build. A post-copy `npm.cmd run build` also completed successfully; Wrangler 4.155.0 development dry-run succeeded with the configured D1, Durable Object, and Assets bindings.
- Deployed only to the isolated development Worker `riftpulse-dev`: `https://riftpulse-dev.chrismeten0.workers.dev`. Worker Version ID: `008a1c03-7816-4325-b05c-8ad26a9e9f9d`. Wrangler uploaded exactly two changed static assets (Quest QMOD and Quest README); no production Worker or database was changed.
- Post-deploy GET verification: homepage, Quest QMOD, and Quest README returned HTTP 200. Downloaded QMOD was 242,074 bytes and matched local SHA-256 exactly: `9DDF2535349C1FD4CE81D3908D5A88E58832ECEC10DAE7D62B37DD09A06B8E26`. Downloaded README SHA-256 matched local: `381694BEBEA6C8CEB8AE952452678E3C8794F4FFC30E2FF079F4AD6C08A94B54`.
- Runtime gate remains open: this machine still reports no connected Quest through ADB, so MBF installation, in-headset request creation, successful pairing, and settings save have not yet been observed. The package is compiled, packaged, deployed, and download-verified, but the network fix is not described as headset-runtime-confirmed. Chat provider services/events, combined viewers, configurable ChatIntegrations command execution, automatic challenge polling, and BSR queue fulfillment remain unfinished.

## Public domain launch — November 5, 2026

- Promoted the public application to the canonical root hostname: https://riftpulse.me. The requested app.riftpulse.me hostname did not have an existing DNS record, so the documented fallback hostname was used.
- Cloudflare custom domain routes riftpulse.me to the existing Worker script riftpulse-dev. Worker domain ID: 499ce37bc75413d5f6e0d1483aed3fc6228a8756. Final Worker version ID after static asset refresh: ffa43a81-b053-4d1a-a361-c8e4fabfc69f.
- Preserved the existing D1 database binding (riftpulse-dev-db, database ID 1ebf28ca-fcc5-4cb6-8be3-92d889ffc090), Durable Object binding, and Worker secrets. No account/user data reset or database recreation was performed.
- Updated the Worker and Railway API canonical base URL, trusted origin, and disabled remote preview authentication. Railway API received APP_BASE_URL, TRUSTED_ORIGINS, ALLOW_REMOTE_DEV_AUTH=false, the verified sender identity RiftPulse <no-reply@riftpulse.me>, and Twitch/YouTube/Kick production callback URI values.
- Railway API deployment e6dd7806-be7d-4ccb-8225-04a8bc6e315f (source commit 97c4a63f4fa4aaa649edba011aacd803420f5832) reached SUCCESS and environment status reported the API online with one running replica and no warnings or recent failures.
- Fixed Railway API environment wiring so the pre-existing RESEND_API_KEY and RESEND_FROM_EMAIL secrets are passed into Better Auth's Resend password-reset sender. The key remains stored as a Railway secret. Email receipt was not independently tested by sending a message.
- Project verification before deployment: TypeScript typecheck, 44 unit/contract tests, isolated SQLite migration test, and Vite production build all passed. PCVR 0.1.14 Release build passed with 0 warnings/errors. Quest 0.1.19 ARM64 native build passed (5/5 compile/link steps); QMOD contents were inspected and the embedded mod.json reports version 0.1.19.
- Published PCVR 0.1.14 DLL SHA-256: 2249C1CD905BDA9C1802BD2B4D912BA48B4CBCDE6BF32F9C802810EFDD4CF879. PCVR ZIP SHA-256: DFA7B40FCE6594611324CA0C450DC4C10CA6C39212EBDBD39BC24C21FC49D5B9. Quest QMOD 0.1.19 SHA-256: 6883B79163453B20BDF1E114F8A5A42DFD48A1C3143A3DEF47AB4F8EBFDED58E.
- Public verification: https://riftpulse.me/, /api/v1/health, /api/v1/version, and /api/auth/get-session returned HTTP 200. PCVR DLL, PCVR ZIP, Quest QMOD, manifests, and platform READMEs were downloaded from the live domain and their SHA-256 hashes matched the local published files exactly.
- Infrastructure naming note: the live domain deliberately reuses the existing Worker script named riftpulse-dev, Railway service, and Railway environment still labeled development. This was chosen to preserve existing secret bindings and the tester database rather than create a parallel empty environment with credentials/data that could not be safely copied. The production hostname is live, but this is not yet a separately isolated production Railway environment.
- Remaining release gates: PCVR and Quest game-runtime pairing must still be tested on their respective devices. Their current Chat/BSR switches sync preferences but do not activate the live services; provider events, combined viewer counts, configurable ChatIntegrations command execution, and the BSR request queue are not yet implemented by these clients. Railway currently lacks the Twitch/YouTube/Kick OAuth client ID and secret variables, and the provider developer consoles still need the new callback URLs registered. The TikTok bridge remains intentionally paused by its Railway start command.


## Website alpha upload — Quest 0.1.20 (November 5, 2026)

- Published the already-built Quest 0.1.20 alpha package to the RiftPulse Downloads page. Refreshed `public/downloads/RiftPulse.Quest.qmod` and `Quest-README.txt`; website UI metadata now shows PCVR 0.1.14 and Quest 0.1.20, and accurately explains the API-connected pairing/preferences and still-unimplemented live Chat/BSR features.
- Quest QMOD is ARM64 Scotland2, targeting Beat Saber `1.40.8_7379`. Local published QMOD SHA-256: `164CD111095C2909E2DC6C6DF1861E46862524B11360346AB892D31C2E7F4527` (235,833 bytes).
- `npm.cmd test` passed: typecheck, 49 unit/contract tests, isolated SQLite migration test, and Vite production build.
- Deployed development Worker `riftpulse-dev` using `wrangler.jsonc`; Worker assets updated at `https://riftpulse-dev.chrismeten0.workers.dev`.
- Deployed the public website Worker `riftpulse` using `wrangler.production.jsonc` to publish to the configured website domains `https://riftpulse.me` and `https://app.riftpulse.me`, preserving the existing `riftpulse-dev-db` D1 and bindings. Worker Version ID: `994d7536-e7be-44bb-8522-6c16abf58fb0`.
- Verification: QMOD HTTP GET returned 200 and 235,833 bytes at both public hostnames; downloaded SHA-256 exactly matched local. Quest README returned HTTP 200 and advertises alpha 0.1.20; both website homepages returned HTTP 200 with the refreshed client bundle.
- Headset installation, Quest menu rendering, and pairing/preference behavior remain alpha tester runtime validation items. No claim of physical headset test is made.


## Quest pairing header compatibility fix — alpha 0.1.21 (November 5, 2026)

- User headset report: Quest pairing API request failed locally with `Unity rejected the Accept request header`; website reported code not registered since the request was stopped before network dispatch.
- Removed the unnecessary `Accept: application/json` header and Cache-Control setting from Quest UnityWebRequest builder. API responds JSON by default. Keep secure pairing/device metadata request headers; no credentials are placed in URL query params.
- Rebuilt Quest ARM64 native library and QMOD, version 0.1.21 for Beat Saber `1.40.8_7379`. Archive validation confirms `mod.json` version, target package version, and presence of `libriftpulse.so`. QMOD size 235,668 bytes; SHA-256 `4362327B6600F48B98CCB7E9A2D16A52C975E5D0EA459D6E676DB083E5E6A5B6`.
- npm test passed: 49 tests, isolated SQLite migration test, TypeScript check, Vite production build.
- Uploaded website assets via production Wrangler deployment. Worker Version ID `ef0987b0-36ee-4782-a19b-0e2cff23ff9c`.
- Public artifact verification: `https://riftpulse.me/downloads/RiftPulse.Quest.qmod` returned HTTP 200, 235,668 bytes, SHA-256 identical to local. README returned HTTP 200 with 0.1.21. Homepage returned HTTP 200 and refreshed client bundle was verified.
- Physical Quest runtime retest remains required to confirm Unity permits the remaining headers and the pairing flow completes on-device.


## QuestPatcher manifest encoding fix — alpha 0.1.22 (November 5, 2026)

- User reported QuestPatcher import failure: `Parsing manifest caused by: expected value at line 1 column 1`.
- Root cause confirmed by inspecting raw bytes inside the 0.1.21 QMOD: embedded `mod.json` began `EF BB BF` (UTF-8 BOM) before `{`. QuestPatcher's parser expected `{` at byte 0. The earlier PowerShell JSON parse accepted the BOM, masking the issue.
- Rewrote canonical Quest `mod.json` as UTF-8 without BOM and bumped Quest package to 0.1.22 in `src/main.cpp`, `mod.json`, `qpm.json`, and `qpm.shared.json`. Retained the 0.1.21 Unity Accept-header fix.
- Rebuilt ARM64 Quest native library and generated `RiftPulse-Quest-0.1.22-Alpha.qmod` for Beat Saber `1.40.8_7379` / Scotland2. Archive has exactly two entries: `mod.json` and `libriftpulse.so`. Embedded manifest begins `7B` (`{`) with no BOM, parses as JSON, and confirms version 0.1.22 and target `1.40.8_7379`. Library size 888,248 bytes. QMOD size 235,665 bytes. SHA-256: `01279B2D1CF7CEFAEB0823114E47770BFBA978C202FDA651EB0E2244ECE976B8`.
- Updated website Quest card, QMOD, and Quest README. README documents BOM fix and outstanding runtime validation.
- Deployed public Worker `riftpulse` with Wrangler config `wrangler.production.jsonc`; Worker Version ID `de4a8fc2-b5fc-4b95-8380-d5258866537a`. Existing D1 and bindings were preserved.
- Verified both `https://riftpulse.me` and `https://app.riftpulse.me`: QMOD and README HTTP 200; QMOD download exactly 235,665 bytes and SHA-256 matched local (`01279B2D1CF7CEFAEB0823114E47770BFBA978C202FDA651EB0E2244ECE976B8`); README reports 0.1.22; homepage HTTP 200 and serves refreshed client bundle.


## QuestPatcher/MBF QMOD manifest BOM fix — alpha 0.1.22 (November 5, 2026)

- Tester import error: `Parsing manifest Caused by: expected value at line 1 column 1`. Diagnosis: packaged `mod.json` began with UTF-8 BOM bytes `EF BB BF`, which the QuestPatcher manifest parser rejects even though PowerShell JSON conversion tolerates it.
- Removed BOM from Quest source manifests and wrote them as UTF-8 without BOM. Rebuilt Quest ARM64 Scotland2 package for Beat Saber `1.40.8_7379`, version 0.1.22.
- Verified archive contains exactly `mod.json` and `libriftpulse.so`; manifest starts with byte `7B` (`{`), parses as JSON, version is 0.1.22 and target game version is correct. QMOD size 235,665 bytes, SHA-256 `01279B2D1CF7CEFAEB0823114E47770BFBA978C202FDA651EB0E2244ECE976B8`.
- `npm test` passed: 49 unit/contract tests, isolated migration test, TypeScript check and Vite build.
- Production Cloudflare Worker deployed, Version ID `87d2bc0b-c75b-4d47-a5ea-717b7661ec30`.
- Public download verification: QMOD HTTP 200, hash matched local, embedded manifest first byte `7B` and version 0.1.22; README HTTP 200; homepage HTTP 200 and refreshed JS asset confirmed.
- Actual QuestPatcher/MBF import and headset pairing are still untested after deployment and require alpha tester confirmation.
