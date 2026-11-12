using System;
using IPA;
using IPA.Logging;
using BeatSaberMarkupLanguage.MenuButtons;
using BeatSaberMarkupLanguage.Util;

namespace RiftPulse.Pcvr
{
    [Plugin(RuntimeOptions.SingleStartInit)]
    public sealed class Plugin
    {
        private MenuButton? _menuButton;
        private Logger? _logger;
        private bool _enabled;

        [Init]
        public void Initialize(Logger logger)
        {
            _logger = logger;
            _logger.Info("RiftPulse PCVR initialized.");
        }

        [OnEnable]
        public void OnEnable()
        {
            if (_enabled) return;
            _enabled = true;

            // BSML creates its menu singletons during main-menu initialization.
            // Subscribe while the plugin is enabled and register only when BSML
            // signals that those instances are ready.
            MainMenuAwaiter.MainMenuInitializing -= OnMainMenuInitializing;
            RiftPulseChatPanel.Shutdown();
            MainMenuAwaiter.MainMenuInitializing += OnMainMenuInitializing;
            _logger?.Info("Waiting for BSML main-menu initialization.");
        }

        private void OnMainMenuInitializing()
        {
            if (_menuButton != null) return;

            try
            {
                var menuButtons = MenuButtons.Instance;
                if (menuButtons == null)
                {
                    _logger?.Error("BSML raised MainMenuInitializing but MenuButtons.Instance was null; RiftPulse menu button was not registered.");
                    return;
                }

                var button = new MenuButton("RiftPulse", ShowRiftPulse);
                menuButtons.RegisterButton(button);
                _menuButton = button;
                RiftPulseChatPanel.Initialize();
                _logger?.Info("RiftPulse menu button registered in the Beat Saber main-menu mods panel.");
            }
            catch (Exception exception)
            {
                _logger?.Error("Failed to register the RiftPulse main-menu button: " + exception);
            }
        }

        private void ShowRiftPulse()
        {
            try
            {
                RiftPulseFlowCoordinator.Present();
            }
            catch (Exception exception)
            {
                _logger?.Error("Failed to open the RiftPulse menu: " + exception);
            }
        }

        [OnDisable]
        public void OnDisable()
        {
            if (!_enabled) return;
            _enabled = false;
            MainMenuAwaiter.MainMenuInitializing -= OnMainMenuInitializing;
            RiftPulseChatPanel.Shutdown();

            try
            {
                var menuButtons = MenuButtons.Instance;
                if (_menuButton != null && menuButtons != null)
                {
                    menuButtons.UnregisterButton(_menuButton);
                }
            }
            catch (Exception exception)
            {
                _logger?.Warn("Could not unregister the RiftPulse menu button during disable: " + exception.Message);
            }
            finally
            {
                _menuButton = null;
            }
        }

        [OnExit]
        public void Shutdown()
        {
            OnDisable();
            _logger?.Info("RiftPulse PCVR shut down.");
        }
    }
}
