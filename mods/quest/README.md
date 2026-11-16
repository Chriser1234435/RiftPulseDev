# RiftPulse Quest alpha 0.3.6

Native ARM64 Scotland2 client for Beat Saber 1.40.8 (1.40.8_7379). This alpha ports the PCVR BSML menu hierarchy into Quest-native C++/BSML, including a constrained two-column card layout and Device Status footer.

## World-space chat panel

- Uses a real BSML floating screen with a VR controller grab handle. It is not a HUD overlay.
- X/Z are measured against headset yaw and Y is true vertical, so pitching the headset down does not place the default panel on the floor.
- Panel X/Y/Z, width, and height are saved in Quest app storage; a level-horizon quaternion preserves the current facing after slider changes and across subsequent gameplay sessions.
- Chat displays platform display names with a blue username marker: Twitch purple, YouTube red, and TikTok white.
- New incoming messages sit at the bottom; oldest entries are trimmed from the top.
- The RiftPulse in-game menu includes RE-CENTER CHAT PANEL to reset the panel to centered and 2.15 m in front of the current view.
- Displays recent Twitch, YouTube, and TikTok LIVE chat messages and supported events.
- Shows combined viewer totals when fresh counts are available.
- Polls the paired-device chat feed every three seconds while the Chat module is enabled.

## Included pairing and module behavior

The mod generates a five-digit pairing code, registers the pairing challenge with the RiftPulse API, checks website claim status, and loads/saves the account's Chat and BSR module preferences. The panel feed uses the paired-device credential and existing device-authenticated /api/v1/device/chat/panel API.

## Alpha validation needed

The Quest native library compiled and linked successfully. A real headset test is still required to validate QMOD import, in-game placement, the floating-screen grab handle, saved placement after leaving/restarting gameplay, and live provider feed delivery. Connector availability and live provider events are best-effort; ChatIntegrations command execution and BSR song-request fulfillment remain separate workstreams.