using System;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using BeatSaberMarkupLanguage;
using BeatSaberMarkupLanguage.Attributes;
using BeatSaberMarkupLanguage.ViewControllers;
using HMUI;

namespace RiftPulse.Pcvr
{
    [ViewDefinition("RiftPulse.Pcvr.pairing.bsml")]
    public sealed class RiftPulsePairingViewController : BSMLAutomaticViewController
    {
        private const string ApiBase = "https://riftpulse.me/api/v1";
        private const string GameVersion = "1.40.8_7379";
        private const string ModVersion = "0.1.14";
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(12) };
        private bool _connecting;

        [UIValue("pairing-code")]
        public string PairingCode { get; private set; } = "â€” â€” â€” â€” â€”";

        [UIValue("status-text")]
        public string StatusText { get; private set; } = "Connect your Beat Saber installation to your RiftPulse account.";

        [UIValue("chat-toggle-label")]
        public string ChatToggleLabel { get; private set; } = "CHAT MODULE: OFF (UI PREVIEW)";

        [UIValue("bsr-toggle-label")]
        public string BsrToggleLabel { get; private set; } = "BSR MODULE: OFF (UI PREVIEW)";

        [UIValue("module-preview-status")]
        public string ModulePreviewStatus { get; private set; } = "These prototype switches are local UI state only; they do not activate services or save settings.";

        private bool _chatPreviewEnabled;
        private bool _bsrPreviewEnabled;

        public RiftPulsePairingViewController()
        {
            LoadModulePreviewSettings();
            ChatToggleLabel = _chatPreviewEnabled ? "CHAT MODULE: ON (LOCAL SAVED PREVIEW)" : "CHAT MODULE: OFF (LOCAL SAVED PREVIEW)";
            BsrToggleLabel = _bsrPreviewEnabled ? "BSR MODULE: ON (LOCAL SAVED PREVIEW)" : "BSR MODULE: OFF (LOCAL SAVED PREVIEW)";
        }

        private static string SettingsPath
        {
            get
            {
                var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RiftPulse");
                Directory.CreateDirectory(folder);
                return Path.Combine(folder, "pcvr-module-preview-settings.txt");
            }
        }

        private void LoadModulePreviewSettings()
        {
            try
            {
                if (!File.Exists(SettingsPath)) return;
                var values = File.ReadAllLines(SettingsPath);
                _chatPreviewEnabled = values.Length > 0 && values[0] == "1";
                _bsrPreviewEnabled = values.Length > 1 && values[1] == "1";
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        private void SaveModulePreviewSettings()
        {
            try
            {
                File.WriteAllLines(SettingsPath, new[] { _chatPreviewEnabled ? "1" : "0", _bsrPreviewEnabled ? "1" : "0" });
                ModulePreviewStatus = "Module switches are saved locally. They are still UI previews and do not activate services or sync to the website.";
                NotifyPropertyChanged(nameof(ModulePreviewStatus));
            }
            catch (IOException)
            {
                ModulePreviewStatus = "Could not save preview switches locally. Check RiftPulse folder permissions.";
                NotifyPropertyChanged(nameof(ModulePreviewStatus));
            }
            catch (UnauthorizedAccessException)
            {
                ModulePreviewStatus = "Could not save preview switches locally. Check RiftPulse folder permissions.";
                NotifyPropertyChanged(nameof(ModulePreviewStatus));
            }
        }

        [UIAction("toggle-chat")]
        public async void ToggleChatPreview()
        {
            _chatPreviewEnabled = !_chatPreviewEnabled;
            ChatToggleLabel = _chatPreviewEnabled ? "CHAT MODULE: ON (SYNCING)" : "CHAT MODULE: OFF (SYNCING)";
            NotifyPropertyChanged(nameof(ChatToggleLabel));
            await SaveModuleSetting("chat", _chatPreviewEnabled);
        }

        [UIAction("toggle-bsr")]
        public async void ToggleBsrPreview()
        {
            _bsrPreviewEnabled = !_bsrPreviewEnabled;
            BsrToggleLabel = _bsrPreviewEnabled ? "BSR MODULE: ON (SYNCING)" : "BSR MODULE: OFF (SYNCING)";
            NotifyPropertyChanged(nameof(BsrToggleLabel));
            await SaveModuleSetting("bsr-song-request", _bsrPreviewEnabled);
        }

        private async Task SaveModuleSetting(string moduleKey, bool enabled)
        {
            try
            {
                var credential = LoadOrCreateDeviceCredential();
                var body = "{\"enabled\":" + (enabled ? "true" : "false") + "}";
                using (var request = new HttpRequestMessage(new HttpMethod("PATCH"), new Uri(ApiBase + "/device/settings/modules/" + moduleKey)))
                {
                    request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", credential);
                    request.Content = new StringContent(body, Encoding.UTF8, "application/json");
                    using (var response = await Http.SendAsync(request))
                    {
                        if (!response.IsSuccessStatusCode)
                        {
                            ModulePreviewStatus = "Settings sync failed (HTTP " + (int)response.StatusCode + "). Link this device to your account first.";
                            NotifyPropertyChanged(nameof(ModulePreviewStatus));
                            return;
                        }
                    }
                }
                ChatToggleLabel = _chatPreviewEnabled ? "CHAT MODULE: ON (ACCOUNT SYNCED)" : "CHAT MODULE: OFF (ACCOUNT SYNCED)";
                BsrToggleLabel = _bsrPreviewEnabled ? "BSR MODULE: ON (ACCOUNT SYNCED)" : "BSR MODULE: OFF (ACCOUNT SYNCED)";
                ModulePreviewStatus = "Module settings saved to your RiftPulse account. Service activation and configuration are separate steps.";
                NotifyPropertyChanged(nameof(ChatToggleLabel));
                NotifyPropertyChanged(nameof(BsrToggleLabel));
                NotifyPropertyChanged(nameof(ModulePreviewStatus));
            }
            catch (Exception)
            {
                ModulePreviewStatus = "Could not sync module settings. Check connection and confirm this installation is paired.";
                NotifyPropertyChanged(nameof(ModulePreviewStatus));
            }
        }

        private async Task LoadAccountModuleSettings()
        {
            try
            {
                var credential = LoadOrCreateDeviceCredential();
                using (var request = new HttpRequestMessage(HttpMethod.Get, ApiBase + "/device/settings/modules"))
                {
                    request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", credential);
                    using (var response = await Http.SendAsync(request))
                    {
                        if (!response.IsSuccessStatusCode) return;
                        var payload = await response.Content.ReadAsStringAsync();
                        var chatMatch = Regex.Match(payload, "\\\"chat\\\"\\s*:\\s*\\{[^}]*\\\"enabled\\\"\\s*:\\s*(true|false)", RegexOptions.Singleline);
                        var bsrMatch = Regex.Match(payload, "\\\"bsr-song-request\\\"\\s*:\\s*\\{[^}]*\\\"enabled\\\"\\s*:\\s*(true|false)", RegexOptions.Singleline);
                        if (chatMatch.Success) _chatPreviewEnabled = chatMatch.Groups[1].Value == "true";
                        if (bsrMatch.Success) _bsrPreviewEnabled = bsrMatch.Groups[1].Value == "true";
                        ChatToggleLabel = _chatPreviewEnabled ? "CHAT MODULE: ON (ACCOUNT SYNCED)" : "CHAT MODULE: OFF (ACCOUNT SYNCED)";
                        BsrToggleLabel = _bsrPreviewEnabled ? "BSR MODULE: ON (ACCOUNT SYNCED)" : "BSR MODULE: OFF (ACCOUNT SYNCED)";
                        ModulePreviewStatus = "Loaded module settings from your RiftPulse account. Services are not activated by these switches yet.";
                        NotifyPropertyChanged(nameof(ChatToggleLabel));
                        NotifyPropertyChanged(nameof(BsrToggleLabel));
                        NotifyPropertyChanged(nameof(ModulePreviewStatus));
                    }
                }
            }
            catch (Exception) { /* Keep local preview values if account sync cannot be reached. */ }
        }

        [UIAction("connect-click")]
        public async void ConnectClicked()
        {
            if (_connecting) return;
            _connecting = true;
            PairingCode = "â€” â€” â€” â€” â€”";
            StatusText = "Generating a secure pairing codeâ€¦";
            NotifyPropertyChanged(nameof(PairingCode));
            NotifyPropertyChanged(nameof(StatusText));

            try
            {
                var code = GenerateFiveDigitCode();
                var deviceId = LoadOrCreateDeviceId();
                var deviceCredential = LoadOrCreateDeviceCredential();
                PairingCode = code;
                StatusText = "Registering code with RiftPulseâ€¦";
                NotifyPropertyChanged(nameof(PairingCode));
                NotifyPropertyChanged(nameof(StatusText));

                var body = "{\"code\":\"" + code + "\",\"deviceCredential\":\"" + deviceCredential + "\",\"deviceId\":\"" + deviceId +
                    "\",\"platform\":\"pcvr\",\"gameVersion\":\"" + GameVersion +
                    "\",\"modVersion\":\"" + ModVersion + "\"}";
                using (var request = new HttpRequestMessage(HttpMethod.Post, ApiBase + "/pairing/challenges"))
                {
                    request.Content = new StringContent(body, Encoding.UTF8, "application/json");
                    using (var response = await Http.SendAsync(request))
                    {
                        if (!response.IsSuccessStatusCode)
                        {
                            StatusText = "Could not register the code (HTTP " + (int)response.StatusCode + "). Try again.";
                            NotifyPropertyChanged(nameof(StatusText));
                            return;
                        }
                        var responseText = await response.Content.ReadAsStringAsync();
                        var match = Regex.Match(responseText, "\"challengeId\"\\s*:\\s*\"([0-9a-fA-F-]{36})\"");
                        if (!match.Success)
                        {
                            StatusText = "RiftPulse returned an invalid pairing response. Try again.";
                            NotifyPropertyChanged(nameof(StatusText));
                            return;
                        }
                        await PollPairingStatus(match.Groups[1].Value);
                    }
                }
            }
            catch (TaskCanceledException)
            {
                StatusText = "RiftPulse request timed out. Check your connection and try again.";
                NotifyPropertyChanged(nameof(StatusText));
            }
            catch (Exception)
            {
                StatusText = "Could not reach RiftPulse. Check your connection and try again.";
                NotifyPropertyChanged(nameof(StatusText));
            }
            finally
            {
                _connecting = false;
            }
        }

        private async Task PollPairingStatus(string challengeId)
        {
            StatusText = "Code registered. Enter it on the RiftPulse website to link this installation.";
            NotifyPropertyChanged(nameof(StatusText));
            var expiresAt = DateTime.UtcNow.AddMinutes(5);
            while (DateTime.UtcNow < expiresAt)
            {
                await Task.Delay(1500);
                using (var response = await Http.GetAsync(ApiBase + "/pairing/challenges/" + challengeId))
                {
                    if (!response.IsSuccessStatusCode)
                    {
                        StatusText = "Pairing status could not be checked (HTTP " + (int)response.StatusCode + ").";
                        NotifyPropertyChanged(nameof(StatusText));
                        return;
                    }
                    var payload = await response.Content.ReadAsStringAsync();
                    var statusMatch = Regex.Match(payload, "\"status\"\\s*:\\s*\"([a-z_]+)\"");
                    if (!statusMatch.Success) continue;
                    var status = statusMatch.Groups[1].Value;
                    if (status == "claimed")
                    {
                        StatusText = "âœ“ RiftPulse account linked! Device pairing succeeded.";
                        NotifyPropertyChanged(nameof(StatusText));
                        await LoadAccountModuleSettings();
                        return;
                    }
                    if (status == "expired" || status == "revoked")
                    {
                        StatusText = "This pairing code expired. Press Generate Pairing Code to generate another.";
                        NotifyPropertyChanged(nameof(StatusText));
                        return;
                    }
                }
            }
            StatusText = "Pairing timed out. Press Generate Pairing Code to try again.";
            NotifyPropertyChanged(nameof(StatusText));
        }

        private static string LoadOrCreateDeviceId()
        {
            var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RiftPulse");
            Directory.CreateDirectory(folder);
            var path = Path.Combine(folder, "pcvr-device-id.txt");
            if (File.Exists(path))
            {
                var existing = File.ReadAllText(path).Trim();
                if (Guid.TryParse(existing, out var parsed)) return parsed.ToString();
            }
            var created = Guid.NewGuid().ToString();
            File.WriteAllText(path, created);
            return created;
        }

        private static string LoadOrCreateDeviceCredential()
        {
            var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RiftPulse");
            Directory.CreateDirectory(folder);
            var path = Path.Combine(folder, "pcvr-device-credential.bin");
            if (File.Exists(path))
            {
                var protectedBytes = File.ReadAllBytes(path);
                var plainBytes = ProtectedData.Unprotect(protectedBytes, null, DataProtectionScope.CurrentUser);
                return BitConverter.ToString(plainBytes).Replace("-", "").ToLowerInvariant();
            }
            var credentialBytes = new byte[32];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(credentialBytes);
            var protectedCredential = ProtectedData.Protect(credentialBytes, null, DataProtectionScope.CurrentUser);
            File.WriteAllBytes(path, protectedCredential);
            return BitConverter.ToString(credentialBytes).Replace("-", "").ToLowerInvariant();
        }

        private static string GenerateFiveDigitCode()
        {
            using (var rng = RandomNumberGenerator.Create())
            {
                var bytes = new byte[4];
                rng.GetBytes(bytes);
                var value = BitConverter.ToUInt32(bytes, 0) % 90000 + 10000;
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
