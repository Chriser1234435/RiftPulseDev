using BeatSaberMarkupLanguage;
using BeatSaberMarkupLanguage.Attributes;
using BeatSaberMarkupLanguage.ViewControllers;
using HMUI;

namespace RiftPulse.Pcvr
{
    [ViewDefinition("RiftPulse.Pcvr.pairing.bsml")]
    public sealed class RiftPulsePairingViewController : BSMLAutomaticViewController
    {
        [UIValue("pairing-code")]
        public string PairingCode { get; private set; } = "— — — — —";

        [UIValue("status-text")]
        public string StatusText { get; private set; } = "Connect your Beat Saber installation to your RiftPulse account.";

        [UIAction("connect-click")]
        public void ConnectClicked()
        {
            // UI prototype only: backend challenge registration is the next integration.
            PairingCode = GenerateFiveDigitCode();
            StatusText = "Pairing UI preview. This code is not registered with the website yet.";
            NotifyPropertyChanged(nameof(PairingCode));
            NotifyPropertyChanged(nameof(StatusText));
        }

        private static string GenerateFiveDigitCode()
        {
            using (var rng = System.Security.Cryptography.RandomNumberGenerator.Create())
            {
                var bytes = new byte[4];
                rng.GetBytes(bytes);
                var value = System.BitConverter.ToUInt32(bytes, 0) % 90000 + 10000;
                return value.ToString();
            }
        }
    }

    public sealed class RiftPulseFlowCoordinator : FlowCoordinator
    {
        private readonly RiftPulsePairingViewController _pairingView =
            BeatSaberUI.CreateViewController<RiftPulsePairingViewController>();

        public static void Present()
        {
            var coordinator = BeatSaberUI.CreateFlowCoordinator<RiftPulseFlowCoordinator>();
            BeatSaberUI.MainFlowCoordinator.PresentFlowCoordinator(coordinator);
        }

        protected override void DidActivate(bool firstActivation, bool addedToHierarchy, bool screenSystemEnabling)
        {
            if (firstActivation)
            {
                SetTitle("RiftPulse");
                showBackButton = true;
            }

            if (addedToHierarchy)
            {
                ProvideInitialViewControllers(_pairingView);
            }
        }

        protected override void BackButtonWasPressed(ViewController topViewController)
        {
            BeatSaberUI.MainFlowCoordinator.DismissFlowCoordinator(this);
        }
    }
}
