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
