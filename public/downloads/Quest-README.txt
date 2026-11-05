# RiftPulse Quest adapter - alpha 0.1.26

Native ARM64 Scotland2 QMOD for Beat Saber 1.40.8 (1.40.8_7379).

## Pairing fix
Version 0.1.26 explicitly clears the stored HTTP completion callback as it is moved to the main-thread dispatcher. This prevents a completed HTTPS request from leaving the single-request guard stuck in a busy state and blocking the next pairing request.

Version 0.1.25 fixed Unity SetRequestHeader runtime lookup and removed rejected/unnecessary request headers. Version 0.1.25 also added persisted pairing state, pairing resume, and the stale-request watchdog.

The mod generates a five-digit code and registers it with the RiftPulse API. Enter that code on https://app.riftpulse.me and then select CHECK PAIRING STATUS in Beat Saber.

This remains an alpha build. Headset import, pairing, and preference-sync runtime validation must still be confirmed on a headset. Live provider chat/events, combined viewer counts, ChatIntegrations command execution, and BSR song-request fulfillment are not yet implemented.
