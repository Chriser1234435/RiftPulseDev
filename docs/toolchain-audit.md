# Step 4 — Toolchain audit and validation

Date: 2026-10-29

## Step 4 outcome

**Complete for local toolchain setup and compile validation.** Both PCVR and standalone Quest builds have passed compile-only smoke tests, and the QPM Quest template with its real mod dependencies has built successfully. Runtime loading inside Beat Saber and a connected Quest device have not been tested; ADB currently reports no attached devices.

## Verified local development tools

- Node.js `24.22.1`; npm `11.19.1`. PowerShell blocks the `npm.ps1` shim under the current execution policy, so use `npm.cmd`. No execution-policy changes were made.
- Portable Git `2.56.0.windows.4` at `C:\Users\chris\Documents\RiftPulse Development\tools\MinGit\cmd\git.exe`.
- .NET SDK `8.0.427`; .NET 8 and .NET 10 runtimes are present.
- Portable CMake `4.4.4` and Ninja `1.13.2` under `C:\Users\chris\Documents\RiftPulse Development\tools\portable`.
- Android SDK Platform-Tools / ADB `37.0.1` installed through WinGet. The explicit executable works; a fresh shell does not yet resolve `adb` by command name. `adb devices` returned no connected devices.
- QPM CLI `1.5.12+3b7834d` is installed portably. `qpm doctor` reports CMake, Ninja, QPM, and ADB found when the portable tool paths are supplied.
- Android NDK `27.2.12479018` was downloaded and extracted by QPM. Clang reports version `18.0.3`.
- QPM warns that Windows symbolic-link privilege is unavailable and falls back to copying dependency files. Dependency restore completed successfully; no Windows developer mode or privilege setting was changed.

## PCVR target validation

- Installed Beat Saber PCVR instance: `1.40.8_7379` at `C:\Users\chris\BSManager\BSInstances\1.40.8`.
- Inspected loader assemblies: `IPA.Injector.dll` assembly version `4.3.6.0`, `IPA.Loader.dll` assembly version `2.0.0.0`, and `BSML.dll` assembly version `1.12.5.0` (`1.12.5+bs.1.40.0`).
- Created a compile-only smoke project at `mods/pcvr/toolchain-smoke` targeting .NET Framework 4.7.2 and using the current BSIPA attribute-based plugin API.
- `dotnet build` succeeded with **0 warnings and 0 errors**. The smoke-test DLL was not copied into the game or loaded in-game.

## Standalone Quest target validation

- User-confirmed Quest target: `1.40.8_7379`.
- Built a simple native Android shared library with CMake/Ninja and NDK 27.2.12479018; ELF inspection confirmed `ELF64`, `DYN`, `AArch64`.
- Generated a separate validation copy of the current Quest mod template outside the repository at `tools/qpm-template-validation`. QPM restored dependencies including Scotland2 `0.1.7`, beatsaber-hook `5.1.9`, and paper `3.7.0`.
- Built the actual QPM/Scotland2 template with CMake/Ninja for `arm64-v8a`; build exited with code 0 and produced `libriftpulse.so`. CMake printed upstream NDK deprecation/override warnings, but they did not prevent the build.
- The template-validation copy is kept outside the project repository so upstream template and third-party dependency files are not imported into RiftPulseDev. Only the minimal local toolchain smoke-test source is kept under `mods/quest/toolchain-smoke`.
- No mod has been installed on the Quest or copied into the PCVR game folder. Runtime loading still requires a later explicit test with the relevant game/device available.

## Cloudflare web/API foundation

- Root tooling dependencies are pinned: Vite `8.3.5`, Wrangler `4.155.0`, TypeScript `7.0.2`, and `@cloudflare/vite-plugin` `1.66.0`.
- `npm.cmd run check:toolchain` succeeded.
- `npm.cmd run build` succeeded using Cloudflare's official Vite plugin.
- Local Vite dev-server smoke test: `/api/v1/health` returned HTTP 200 with `{"service":"riftpulse-api","status":"ok","version":"0.1.0-dev"}`. The local server was stopped after the test.
- `npm.cmd audit --omit=dev` reported zero vulnerabilities. npm warned that `workerd` and `esbuild` install scripts were not covered by the current script-approval setting; no approval or security setting was changed.
- This is only a health-check foundation, not the finished website or API.

## Still outstanding (not blockers for Step 4 completion)

- Run the PCVR plugin in-game and validate menu integration against the target game.
- Connect the Quest with developer debugging enabled and verify ADB device visibility before any device install/load test.
- Integrate the QPM/Scotland2 template into the real Quest module project only in its authorized implementation step.
- Add the React website UI and perform isolated Better Auth/D1 integration testing in their authorized implementation steps.

## Repository and safety boundaries

- Main repository: `C:\Users\chris\Documents\RiftPulse Development\workspace\RiftPulseDev`.
- The local repository contains the clean skeleton, Cloudflare Worker foundation, architecture/roadmap docs, audit, and two compile-only smoke-test source projects.
- Local commits have not been pushed to GitHub.
- No Cloudflare projects, databases, DNS records, OAuth integrations, or deployments were changed.
- No legacy RiftPulse source, migrations, secrets, or deployment configuration was imported.
