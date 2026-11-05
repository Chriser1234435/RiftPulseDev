# RiftPulse Quest adapter — alpha 0.1.25

Native ARM64 Scotland2 client for Beat Saber 1.40.8 (`1.40.8_7379`). This alpha generates a five-digit pairing code, registers the pairing challenge with the RiftPulse API, checks website claim status, and after linking loads and saves the account's Chat and BSR module preferences.

Fix in 0.1.25: Quest resolves UnityWebRequest.SetRequestHeader using Unity's IL2CPP runtime method lookup by method name and argument count rather than brittle exact string-parameter type matching. The request builder keeps the rejected Accept and unnecessary Cache-Control headers removed. Each secure pairing header now has its own diagnostic, and Unity invocation exceptions are surfaced in the in-game status.

The QMOD manifest is UTF-8 without BOM and begins directly with `{`, for QuestPatcher/MBF import. Pairing status is checked manually using CHECK PAIRING STATUS after entering the code on https://app.riftpulse.me.

This is an alpha candidate. Headset import, menu layout, pairing and preference-save runtime validation remain for testers. Module switches persist preferences only; actual live provider chat/events, combined viewer counts, ChatIntegrations command execution, and BSR song-request fulfillment are not yet implemented.