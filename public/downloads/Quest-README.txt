# RiftPulse Quest alpha 0.1.23

For Beat Saber Quest 1.40.8 (`1.40.8_7379`), Scotland2 ARM64.

This build includes the previous UnityWebRequest `Accept` header removal and now logs the exact pairing header name Unity rejects, rather than only a generic secure-header failure. This diagnostics-only update will help identify whether the failure occurs on pairing-code, device credential, device ID, platform, game-version, or mod-version header assignment.

Import the QMOD using QuestPatcher/MBF and try the Connect / pairing request again. If it still fails, capture the diagnostic text displayed by the RiftPulse menu; it should now name the specific header. The API pairing behavior and full live module integrations remain subject to alpha testing.