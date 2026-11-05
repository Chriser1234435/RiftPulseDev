# RiftPulse PCVR alpha adapter 0.1.14

PCVR pairing and dashboard UI prototype for Beat Saber 1.40.8. Generates and registers a five-digit pairing code against the RiftPulse production API; device credential is Windows DPAPI protected. Includes Chat and BSR preference switches that sync to the paired account; they do not activate the streaming services yet. Live provider chat/events, combined viewer counts, configurable ChatIntegrations command execution, and BSR song-request fulfillment remain unfinished. In-game runtime visual/load validation is pending.

Build with `dotnet build RiftPulse.Pcvr.csproj -c Release`. References are pinned to Beat Saber 1.40.8 / BSML.
