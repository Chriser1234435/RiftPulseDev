# RiftPulse PCVR adapter

PCVR UI prototype for the pinned Beat Saber 1.40.8 instance.

This build adds a BSIPA main-menu button named **RiftPulse**, a dedicated FlowCoordinator screen, and a BSML pairing-screen prototype. The “Connect to RiftPulse” button currently generates a display-only five-digit code and marks the UI as preview-only; it is **not registered with the backend**. Device authentication, web pairing, module dashboard, realtime chat, and BSR are still pending.

Build:

```powershell
dotnet build RiftPulse.Pcvr.csproj -c Release
```

Target framework: .NET Framework 4.7.2. References are pinned to the installed Beat Saber 1.40.8 instance and its BSML plugin.

Runtime loading and in-game visual behavior still need verification in Beat Saber.
