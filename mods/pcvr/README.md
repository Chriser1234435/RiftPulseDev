RiftPulse PCVR 0.1.25
# RiftPulse PCVR alpha adapter 0.1.20

PCVR adapter for Beat Saber 1.40.8. Generates a five-digit pairing code, links the installation to your RiftPulse account, syncs Chat/BSR module preferences, and adds a movable world-space RiftPulse chat panel inside gameplay.

## World-space chat panel

- A real 3D floating panel in the Beat Saber play space, not a camera HUD or flat screen overlay.
- Grab and move the panel with the VR controller handle. Its position and rotation are saved locally.
- The RiftPulse in-game menu includes MOVE CHAT PANEL TO VIEW to reset it in front of your view.
- Displays recent Twitch, YouTube, and TikTok LIVE messages and supported provider events.
- Displays the combined viewer total when a fresh count is available.
- Polls the paired-device chat feed while the Chat module is enabled.

## Alpha limitations

This build has compiled for PCVR, but a live in-headset test is still needed to confirm the panel size, grab-handle behavior, placement persistence, and performance in a running Beat Saber session. Incoming provider events depend on the relevant platform connector being active. ChatIntegrations command execution and BSR song-request fulfillment are separate workstreams.

The BSIPA manifest is embedded in the DLL. The release ZIP contains Plugins/RiftPulse.Pcvr.dll and README.txt; there is intentionally no loose manifest. Extract the ZIP into the Beat Saber game root, not directly into the Plugins folder. This package is PCVR only and must not be installed on Quest Standalone.