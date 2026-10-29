# Step 4 — Toolchain audit

Date: 2026-10-29

## Verified on the Windows development machine

- Node.js `24.22.1` is installed.
- npm `11.19.1` is installed. PowerShell blocks the `npm.ps1` shim under the current execution policy; invoking `npm.cmd` works. No execution-policy changes were made.
- Portable Git `2.56.0.windows.4` is available at `C:\Users\chris\Documents\RiftPulse Development\tools\MinGit\cmd\git.exe`.
- The .NET 8 SDK installation completed. Verified `dotnet --info` and `dotnet --version` report SDK `8.0.427`; .NET 8 and .NET 10 runtimes are present.
- Beat Saber PCVR instance `1.40.8_7379` exists at `C:\Users\chris\BSManager\BSInstances\1.40.8`.
- User confirmed the standalone Quest Beat Saber version is also `1.40.8_7379`.
- The existing PCVR instance includes BSML and common mod libraries. This supports evaluating BSML for the PCVR menu, but the exact referenced assemblies and framework must still be pinned and build-tested against the installed instance.
- Java, Android SDK/ADB, Gradle, Unity Hub/Editor, and Visual Studio were not found in PATH or the checked common install paths. This is a preliminary check, not proof that no copy exists elsewhere.
- `.gitignore` was checked: `.env`, `.dev.vars`, and generated web folders such as `node_modules` and `dist` are ignored.

## Repository and web toolchain

- Local Git repository tracks `origin/main` at `https://github.com/Chriser1234435/RiftPulseDev.git`; the remote's existing initial commit was fetched successfully.
- Clean folder skeleton: `apps/web`, `apps/api`, `packages/contracts`, `packages/shared`, `mods/pcvr`, `mods/quest`, `tests/unit`, and `tests/integration`.
- Root tooling dependencies are recorded in `package.json` and `package-lock.json`: Vite `8.3.5`, Cloudflare Wrangler `4.155.0`, TypeScript `7.0.2`, and `@cloudflare/vite-plugin` `1.66.0`.
- `npm run check:toolchain` succeeded, reporting Wrangler `4.155.0`, Vite `8.3.5`, and TypeScript `7.0.2`.
- `npm exec -- esbuild --version` succeeded (`0.28.2`). `npm audit --omit=dev` reported zero vulnerabilities.
- npm warned that `workerd` and `esbuild` install scripts were not covered by its script-approval setting. The CLI smoke checks succeeded without changing that setting; reassess only if a local Worker build requires those scripts.
- Two local commits exist on `main`: `8321dab` (clean project foundation) and `79a3b25` (initial web toolchain). Local branch is ahead of `origin/main` by two commits. No push has been made.

## Toolchain decisions based on current documentation

- **Cloudflare web/API:** use React + Vite with Cloudflare's official Vite plugin and a project-local Wrangler dependency. Cloudflare recommends project-local Wrangler so versions are repeatable. Sources: https://developers.cloudflare.com/workers/vite-plugin/get-started/ and https://developers.cloudflare.com/workers/wrangler/install-and-update/.
- **PCVR:** Beat Saber 1.40.8 belongs to the legacy Unity `2021.3.16f1` branch; the PC mod workflow uses C#, BSIPA, and the .NET Framework 4.7.2 ecosystem. Confirm against the local game assemblies and exact BSIPA template before locking the project target. Sources: https://bsmg.wiki/pc-modding.html and https://bsmg.wiki/modding/pc/setup.html.
- **Standalone Quest:** user-confirmed target is `1.40.8_7379`. Current Quest mod references list that build and use Scotland2. The Quest mod is a native Android/ARM64 shared library written in C++, not the PCVR C# DLL. Validate the exact Scotland2/QPM/NDK setup before selecting and building the starter template. Sources: https://dantheman827.github.io/bsqmods/1.40.8_7379/ and https://bsmg.wiki/quest-modding.
- **Authentication / D1:** Better Auth documentation lists Cloudflare D1 support through the Kysely dialect, and Better Auth's v1.5 notes describe D1 as a first-class database option. This keeps Better Auth as the candidate, but a local Worker/D1 integration test is still required before locking auth dependencies or creating database migrations. Sources: https://better-auth.com/docs/adapters/other-relational-databases and https://better-auth.com/blog/1-5.

## Still to validate before implementation

- Inspect exact PCVR loader versions, target framework, game references, and BSML APIs; compile a minimal mod against Beat Saber `1.40.8_7379` before feature implementation.
- Confirm the supported Scotland2/QPM/NDK build combination for standalone Quest `1.40.8_7379`. Install/configure CMake, Ninja, QPM, ADB/platform tools, and NDK only as needed by the verified template.
- Test a local Cloudflare Worker/Vite build after adding its config and starter entrypoint; do not authenticate to Cloudflare or deploy as part of this audit.
- Prove Better Auth + D1 in an isolated local integration test before adopting its auth schema.

## Safety boundaries

No Cloudflare projects, databases, DNS records, OAuth integrations, or deployments were changed during Step 4. No old RiftPulse source code, database migrations, secrets, or deployment settings were imported. No remote push has been made.
