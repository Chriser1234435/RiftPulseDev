using IPA;

namespace RiftPulse.Pcvr
{
    // Initial PCVR adapter bootstrap. API/device pairing and the in-game UI are being implemented next.
    [Plugin(RuntimeOptions.SingleStartInit)]
    public sealed class Plugin
    {
        [Init]
        public void Initialize()
        {
            // BSIPA invokes this entry point on plugin startup.
        }

        [OnExit]
        public void Shutdown()
        {
            // Cleanly stop adapter resources when those services are added.
        }
    }
}