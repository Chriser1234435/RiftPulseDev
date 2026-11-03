# RiftPulse PCVR adapter

PCVR integration prototype for the pinned Beat Saber 1.40.8 instance.

This build adds:
- BSIPA main-menu button named **RiftPulse**
- Dedicated FlowCoordinator screen and BSML pairing UI
- Mod-generated five-digit code registration against the RiftPulse development API
- Device UUID persisted locally for this installation
- Status polling until the user claims the code on the development website, or the challenge expires

Pairing currently binds the device record to the account and reports success. **Secure per-device credential exchange, mod-authenticated realtime connections, Chat, BSR, and settings synchronization are not yet implemented.** In-game runtime load/visual validation remains pending.

Build:

```powershell
dotnet build RiftPulse.Pcvr.csproj -c Release
```

Target framework: .NET Framework 4.7.2. References are pinned to the installed Beat Saber 1.40.8 instance and its BSML plugin.
