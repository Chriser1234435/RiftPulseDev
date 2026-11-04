using System;
using IPA;
using BeatSaberMarkupLanguage.MenuButtons;
using BeatSaberMarkupLanguage.Util;

namespace RiftPulse.Pcvr
{
    [Plugin(RuntimeOptions.SingleStartInit)]
    public sealed class Plugin
    {
        private MenuButton? _menuButton;

        [Init]
        public void Initialize()
        {
            // IPA initialization runs before Beat Saber's Zenject container and
            // BSML MenuButtons singleton are ready. Defer registration to the
            // main-menu initialization event; do not touch MenuButtons here.
            MainMenuAwaiter.MainMenuInitializing += OnMainMenuInitializing;
        }

        private void OnMainMenuInitializing()
        {
            RegisterMenuButton();
        }

        private void RegisterMenuButton()
        {
            if (_menuButton != null) return;
            _menuButton = new MenuButton("RiftPulse", ShowRiftPulse);
            MenuButtons.Instance.RegisterButton(_menuButton);
        }

        private static void ShowRiftPulse()
        {
            RiftPulseFlowCoordinator.Present();
        }

        [OnExit]
        public void Shutdown()
        {
            MainMenuAwaiter.MainMenuInitializing -= OnMainMenuInitializing;
            if (_menuButton != null)
            {
                MenuButtons.Instance.UnregisterButton(_menuButton);
                _menuButton = null;
            }
        }
    }
}
