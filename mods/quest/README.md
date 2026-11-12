# RiftPulse Quest alpha 0.1.27

Native ARM64 Scotland2 client for Beat Saber 1.40.8 (1.40.8_7379). This alpha adds a movable, world-space chat panel inside Beat Saber gameplay.

## World-space chat panel

- Uses a real BSML floating screen with a VR controller grab handle. It is not a HUD overlay.
- Panel position and rotation are saved in Quest app storage and restored in subsequent gameplay sessions.
- The RiftPulse in-game menu includes MOVE CHAT PANEL TO VIEW to reset the panel in front of the current view.
- Displays recent Twitch, YouTube, and TikTok LIVE chat messages and supported events.
- Shows combined viewer totals when fresh counts are available.
- Polls the paired-device chat feed every three seconds while the Chat module is enabled.

## Included pairing and module behavior

The mod generates a five-digit pairing code, registers the pairing challenge with the RiftPulse API, checks website claim status, and loads/saves the account's Chat and BSR module preferences. The panel feed uses the paired-device credential and existing device-authenticated /api/v1/device/chat/panel API.

## Alpha validation needed

The Quest native library compiled and linked successfully. A real headset test is still required to validate QMOD import, in-game placement, the floating-screen grab handle, saved placement after leaving/restarting gameplay, and live provider feed delivery. Connector availability and live provider events are best-effort; ChatIntegrations command execution and BSR song-request fulfillment remain separate workstreams.