# RiftPulse PCVR adapter

PCVR integration prototype for the pinned Beat Saber 1.40.8 instance.

This build adds:
- BSIPA main-menu button named **RiftPulse**
- Dedicated FlowCoordinator screen and BSML pairing UI
- Mod-generated five-digit code registration against the RiftPulse development API
- Stable local device UUID
- Random 32-byte device credential protected at rest with Windows DPAPI (CurrentUser scope)
- API stores only a SHA-256 digest of the credential and transfers it into the device record upon website claim
- Status polling until the user claims the code on the development website, or the challenge expires

The Railway API development WebSocket upgrade now has a bearer-credential validation branch for active, non-revoked devices. Deployment and real WebSocket validation are pending. **Realtime Chat delivery, BSR, module settings synchronization, and Quest integration remain unfinished.** In-game runtime load/visual validation remains pending.

Build:

```powershell
dotnet build RiftPulse.Pcvr.csproj -c Release
```

Target framework: .NET Framework 4.7.2. References are pinned to the installed Beat Saber 1.40.8 instance and its BSML plugin.
