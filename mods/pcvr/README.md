# RiftPulse PCVR alpha adapter 0.1.13

PCVR pairing and dashboard UI prototype for Beat Saber 1.40.8. Generates and registers a five-digit pairing code against the RiftPulse development API; device credential is Windows DPAPI protected. Includes Chat and BSR preview switches that only toggle local UI state. Actual modules, setting persistence, real-time chat, BSR, and the Quest port remain unfinished. In-game runtime visual/load validation is pending.

Build with `dotnet build RiftPulse.Pcvr.csproj -c Release`. References are pinned to Beat Saber 1.40.8 / BSML.
