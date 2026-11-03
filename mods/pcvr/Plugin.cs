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
            MainMenuAwaiter.MainMenuInitializing += OnMainMenuInitializing;
        }

        private void OnMainMenuInitializing()
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
