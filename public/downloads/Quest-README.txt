RiftPulse Quest alpha 0.1.18
Beat Saber 1.40.8 standalone (Scotland2)

This build updates Quest pairing request construction. It creates UnityWebRequest with an explicit HTTP method and uploads the payload as raw UTF-8 JSON using UploadHandlerRaw, matching the RiftPulse API's application/json contract. The in-game status panel now reports the request-construction failure stage or the HTTP/server rejection details instead of displaying only a generic internet warning.

To pair: install this QMOD on a Quest running the supported Beat Saber 1.40.8 build, open RiftPulse in the Beat Saber main menu, generate the code, enter that current five-digit code on the RiftPulse development website while signed in, then press CHECK PAIRING STATUS. The game may regenerate a code after a retry; always enter the currently displayed code.

The current Quest UI uses a manual status-check button; it does not yet poll automatically. Chat and BSR switches save account preferences only; live chat/provider events, combined viewer counts, configurable ChatIntegrations command execution, and the BSR song-request queue are not implemented by this client. This build has compiled and been packaged, but still needs a fresh MBF import and headset runtime pairing test.

The QMOD targets Beat Saber package 1.40.8_7379 and declares the Scotland2 loader plus Beat Saber Hook, BSML, Custom Types, and Paper2 dependencies.