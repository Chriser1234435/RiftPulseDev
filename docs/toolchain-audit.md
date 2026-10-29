# Step 4 — Toolchain audit

Date: 2026-10-29

## Verified on the Windows development machine

- Node.js `24.22.1` is installed.
- npm `11.19.1` is installed. PowerShell blocks the `npm.ps1` shim under the current execution policy; invoking `npm.cmd` works. No execution-policy changes were made.
- Portable Git `2.56.0.windows.4` is available at `C:\Users\chris\Documents\RiftPulse Development\tools\MinGit\cmd\git.exe`.
- The .NET 8 SDK installation completed. Verified `dotnet --info` and `dotnet --version` report SDK `8.0.427`; .NET 8 and .NET 10 runtimes are present.
- Beat Saber PCVR instance `1.40.8_7379` exists at `C:\Users\chris\BSManager\BSInstances\1.40.8`.
- The existing PCVR instance includes BSML and common mod libraries. This supports evaluating BSML for the PCVR menu, but the exact referenced assemblies and framework must still be pinned and build-tested against the installed instance.
- Java, Android SDK/ADB, Gradle, Wrangler, Unity Hub/Editor, and Visual Studio were not found in PATH or the checked common install paths. This is a preliminary check, not proof that no copy exists elsewhere.
- `.gitignore` was checked: `.env`, `.dev.vars`, and generated web folders such as `node_modules` and `dist` are ignored.

## Repository foundation created

- Local Git repository now tracks `origin/main` at `https://github.com/Chriser1234435/RiftPulseDev.git`; the remote's existing initial commit was fetched successfully.
- `README.md`, `.gitignore`, `.editorconfig`, and `.gitattributes`.
- Clean folder skeleton for `apps/web`, `apps/api`, `packages/contracts`, `packages/shared`, `mods/pcvr`, `mods/quest`, `tests/unit`, and `tests/integration`.
- Design docs: `docs/architecture.md`, `docs/implementation-roadmap.md`, and this audit.

## Toolchain decisions based on current documentation

- **Cloudflare web/API:** use React + Vite with Cloudflare's official Vite plugin and a project-local Wrangler dependency. Cloudflare recommends project-local Wrangler so versions are repeatable. Sources: https://developers.cloudflare.com/workers/vite-plugin/get-started/ and https://developers.cloudflare.com/workers/wrangler/install-and-update/.
- **PCVR:** Beat Saber 1.40.8 belongs to the legacy Unity `2021.3.16f1` branch; the PC mod workflow uses C#, BSIPA, and the .NET Framework 4.7.2 ecosystem. Confirm against the local game assemblies and the exact BSIPA template before locking the project target. Sources: https://bsmg.wiki/pc-modding.html and https://bsmg.wiki/modding/pc/setup.html.
- **Standalone Quest:** this is a separate native C++ workflow, not the PCVR C# DLL. The current BSMG guide calls for C++, CMake, ADB, Ninja, and Android NDK 27; Scotland2 is the mod loader selected in the Quest patching workflow. This must be validated against the Quest's actual game version before creating the mod template. Sources: https://bsmg.wiki/modding/quest/intro.html and https://bsmg.wiki/quest-modding.
- **Authentication / D1:** Better Auth documentation lists Cloudflare D1 support through the Kysely dialect, and Better Auth's v1.5 notes describe D1 as a first-class database option. This is enough to keep Better Auth as the candidate, but still requires a local Worker/D1 integration test before locking dependencies or creating database migrations. Sources: https://better-auth.com/docs/adapters/other-relational-databases and https://better-auth.com/blog/1-5.

## Still to validate before implementation

- Inspect exact PCVR loader versions, target framework, game references, and BSML APIs; compile a minimal mod against Beat Saber `1.40.8_7379` before feature implementation.
- Confirm the Quest Beat Saber version and supported Scotland2/NDK build combination. Install/configure CMake, Ninja, QPM/Templatr, ADB/platform tools, and NDK only once that target is confirmed.
- Add the project-local Cloudflare/Vite dependencies and test a local Worker build in the next authorized implementation step; do not authenticate to Cloudflare or deploy as part of this audit.
- Prove Better Auth + D1 in an isolated local integration test before adopting its auth schema.

## Safety boundaries

No Cloudflare projects, databases, DNS records, OAuth integrations, or deployments were changed during Step 4. No old RiftPulse source code, database migrations, secrets, or deployment settings were imported. No remote push has been made.
