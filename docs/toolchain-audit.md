# Step 4 — Toolchain audit

Date: 2026-10-29

## Verified on the Windows development machine

- Node.js `24.22.1` and npm `11.19.1` are installed. PowerShell blocks the `npm.ps1` shim under the current execution policy; invoking `npm.cmd` works. No execution-policy changes were made.
- Portable Git `2.56.0.windows.4` is available at `C:\Users\chris\Documents\RiftPulse Development\tools\MinGit\cmd\git.exe`.
- .NET 8 SDK `8.0.427` is installed; .NET 8 and .NET 10 runtimes are present.
- Beat Saber PCVR instance `1.40.8_7379` exists at `C:\Users\chris\BSManager\BSInstances\1.40.8`.
- User confirmed the standalone Quest Beat Saber version is also `1.40.8_7379`.
- PCVR assembly inspection confirmed `IPA.Injector.dll` assembly version `4.3.6.0`, `IPA.Loader.dll` assembly version `2.0.0.0`, and `BSML.dll` assembly version `1.12.5.0` (`1.12.5+bs.1.40.0`). The game's `Main.dll` and Unity managed assemblies are present. A minimal mod compile/load test remains outstanding.
- Android SDK Platform-Tools `37.0.1` was installed through WinGet; a fresh shell is needed for its PATH update to be visible. No Quest device connection/build has yet been verified.
- CMake `4.4.4` installation was started through WinGet but appears to be waiting on Windows Installer elevation/consent. Installation is not yet confirmed. Ninja installation was queued after CMake and is also not confirmed.
- Java/JDK, Android NDK, QPM, Unity Hub/Editor, and Visual Studio were not found in PATH or checked common install paths. This is a preliminary check, not proof that no copy exists elsewhere.
- `.gitignore` ignores `.env`, `.dev.vars`, and generated web folders such as `node_modules` and `dist`.

## Repository and web toolchain

- Local Git repository tracks `origin/main` at `https://github.com/Chriser1234435/RiftPulseDev.git`; the remote's existing initial commit was fetched successfully.
- Clean folder skeleton: `apps/web`, `apps/api`, `packages/contracts`, `packages/shared`, `mods/pcvr`, `mods/quest`, `tests/unit`, and `tests/integration`.
- Root tooling dependencies are pinned in `package.json` and `package-lock.json`: Vite `8.3.5`, Cloudflare Wrangler `4.155.0`, TypeScript `7.0.2`, and `@cloudflare/vite-plugin` `1.66.0`.
- `npm run check:toolchain` succeeded, reporting Wrangler `4.155.0`, Vite `8.3.5`, and TypeScript `7.0.2`.
- `npm run build` succeeded using Cloudflare's official Vite plugin, producing a local Worker build in `dist/worker/`.
- Local Vite dev server smoke test: `/api/v1/health` returned HTTP 200 with `{"service":"riftpulse-api","status":"ok","version":"0.1.0-dev"}`. The local server was stopped after the test.
- `npm exec -- esbuild --version` succeeded (`0.28.2`). `npm audit --omit=dev` reported zero vulnerabilities.
- npm warned that `workerd` and `esbuild` install scripts were not covered by its script-approval setting. The build and runtime smoke test succeeded without changing that setting.
- Local Git branch `main` contains four local commits ahead of `origin/main`; the remote has not been updated. Working-tree status must be checked after this audit update.

## Toolchain decisions based on current documentation

- **Cloudflare web/API:** use React + Vite with Cloudflare's official Vite plugin and project-local Wrangler. Sources: https://developers.cloudflare.com/workers/vite-plugin/get-started/ and https://developers.cloudflare.com/workers/wrangler/install-and-update/.
- **PCVR:** Beat Saber `1.40.8` uses the legacy Unity `2021.3.16f1` branch; PC modding uses C#, BSIPA, and the .NET Framework 4.7.2 ecosystem. The local loader versions above are now inspected, but target framework and a minimal compile/load test remain outstanding. Sources: https://bsmg.wiki/pc-modding.html and https://bsmg.wiki/modding/pc/setup.html.
- **Standalone Quest:** target `1.40.8_7379` is user-confirmed. Quest mods are native Android/ARM64 shared libraries (C++), not PCVR C# DLLs; Scotland2 is the relevant loader family. Validate exact Scotland2/QPM/NDK dependencies before choosing and building the starter template. Sources: https://questsaber.com/wiki/?page=quest-modding%2Foverview and https://bsmg.wiki/quest-modding.
- **Quest build tools:** QPM supports NDK management and downloading CMake/Ninja, but QPM, NDK, and a Quest build have not yet been verified. Source: https://github.com/QuestPackageManager/QPM.CLI.
- **Authentication / D1:** Better Auth remains a candidate pending an isolated local Worker/D1 integration test before locking auth dependencies or creating database migrations. Sources: https://better-auth.com/docs/adapters/other-relational-databases and https://better-auth.com/blog/1-5.

## Still to validate before implementation

- Build a minimal PCVR mod against the installed game and loader assemblies; confirm the target framework and BSML API use.
- Finish confirming CMake/Ninja, obtain/configure QPM and an appropriate Android NDK, and run QPM diagnostics/build for Quest `1.40.8_7379`.
- Verify ADB visibility in a fresh shell and only perform a device connection check if the Quest is connected and debugging is enabled.
- Add the actual React UI scaffold in its own authorized step; the current Worker is only a health-check foundation.
- Prove Better Auth + D1 in an isolated local integration test before adopting its auth schema.

## Safety boundaries

No Cloudflare projects, databases, DNS records, OAuth integrations, or deployments were changed during Step 4. No old RiftPulse source code, database migrations, secrets, or deployment settings were imported. No push to GitHub has been made.
