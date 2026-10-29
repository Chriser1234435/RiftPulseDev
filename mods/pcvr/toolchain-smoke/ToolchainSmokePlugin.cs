using IPA;

namespace RiftPulseDev.Pcvr.ToolchainSmoke
{
    // Compile-only validation against the installed BSIPA loader. Not installed into the game.
    [Plugin(RuntimeOptions.SingleStartInit)]
    public sealed class ToolchainSmokePlugin
    {
        [Init]
        public void Initialize() { }
    }
}
