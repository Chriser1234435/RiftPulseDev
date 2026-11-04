RiftPulse Quest alpha 0.1.17
Beat Saber 1.40.8 standalone (Scotland2)

This build adds Quest-side account pairing against the RiftPulse development API. The Quest client generates a five-digit code and a persistent device identity, registers the pairing challenge, checks whether the website has claimed it, then loads account Chat/BSR module settings. Module switches save through the authenticated device-settings API.

To pair: install this QMOD on a Quest running the supported Beat Saber 1.40.8 build, open RiftPulse in the Beat Saber main menu, generate the code, enter it on the RiftPulse development website while signed in, then press CHECK PAIRING STATUS. After the account is linked, use the Chat and BSR buttons to save module-enabled settings.

The current Quest UI uses a manual status-check button; it does not yet poll automatically. This alpha has not been installed or runtime-tested on a headset in this build session. Chat service activation, provider event display, combined viewer counts, configurable ChatIntegrations commands, and the BSR song-request queue are not implemented by this client yet. These settings only save account preferences.

The QMOD declares Scotland2 and the resolved Beat Saber Hook, BSML, Custom Types, and Paper2 dependencies. Its root mod.json is UTF-8 JSON without a BOM.
