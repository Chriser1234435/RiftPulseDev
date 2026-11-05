# RiftPulse Quest adapter - alpha 0.1.25

Native ARM64 Scotland2 client for Beat Saber 1.40.8 (1.40.8_7379).

Fixes in 0.1.25:
- Pairing code and challenge ID are saved in Quest persistent storage with owner-only file permissions.
- On opening the RiftPulse menu, the client resumes the newest pairing challenge using its device ID and device credential. This restores pending and already-claimed headset sessions after Beat Saber or Quest restarts.
- Added an authenticated /api/v1/pairing/resume API endpoint. It accepts the device ID and credential in a JSON body, verifies the credential digest against the pending challenge or registered device, and never returns the credential.
- Added a 30-second stale-request watchdog. A missing Unity main-thread completion callback no longer permanently blocks new HTTPS requests; late results from retired requests are ignored.
- Existing retry and module-setting paths use the same recovery logic.

The QMOD manifest is UTF-8 without BOM and begins directly with { . Target: Beat Saber 1.40.8_7379, Scotland2, ARM64.

Alpha validation still requires real-headset testing of fresh pairing, menu reopen, full Beat Saber restart, already-claimed recovery, module settings, and revoked-device behavior. Live provider chat/events, combined viewer counts, ChatIntegrations command execution, and BSR song-request fulfillment remain outside this pairing fix.