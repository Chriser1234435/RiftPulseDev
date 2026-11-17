# RiftPulse PCVR 0.3.8

PCVR plugin for Beat Saber 1.40.8. RiftPulse provides account pairing, live chat, viewer events, and the BSR song-request queue.

## In-game Chat

- Movable world-space panel with the same white controller grab handle used by BSR.
- Saved placement and size controls.
- Bold mixed-case chat text with local timestamp, a platform-color square, sender name, and message on one line.
- Follow, membership, gift, bits, Super Chat, donation, like, share, raid, and member events use highlighted event labels.
- Text scales up as the panel is reduced so the feed remains readable.

## In-game BSR

- Open **RiftPulse → Song Requests → Configure Song Requests** for the command, requester cooldown, queue limit, and display settings.
- X/Y/Z position and width/height settings are saved locally. The sliders apply while the panel is open.
- Open **Request Queue** to use the movable floating queue. Grab its white handle to reposition it.
- Select a request and choose **YES / Download** to install it to the PCVR CustomLevels folder, or **NO / Remove** to remove it from the queue.
- The queue can be scrolled and refreshes automatically while open.

The BSIPA manifest and BSML views are embedded in `RiftPulse.Pcvr.dll`. The release ZIP contains `Plugins/RiftPulse.Pcvr.dll` and `README.txt`; it intentionally has no loose manifest. Extract the ZIP into the Beat Saber game root. This package is PCVR only and must not be installed on Quest Standalone.

A live in-headset test is still required to confirm placement, grabbing, queue navigation, download/install, and readability at the smallest supported size.