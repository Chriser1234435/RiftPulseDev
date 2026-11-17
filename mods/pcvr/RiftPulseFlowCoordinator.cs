using System;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using BeatSaberMarkupLanguage;
using BeatSaberMarkupLanguage.Attributes;
using BeatSaberMarkupLanguage.ViewControllers;
using HMUI;

namespace RiftPulse.Pcvr
{
    [ViewDefinition("RiftPulse.Pcvr.pairing.bsml")]
    public sealed class RiftPulsePairingViewController : BSMLAutomaticViewController
    {
        private const string ApiBase = "https://app.riftpulse.me/api/v1";
        private const string GameVersion = "1.40.8_7379";
        private const string ModVersion = "0.3.8";
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(12) };
        private bool _connecting;

        public string PairingCode { get; private set; } = "-----";
        public string StatusText { get; private set; } = "Connect your Beat Saber installation to your RiftPulse account.";
        public string ChatToggleLabel { get; private set; } = "CHAT MODULE: OFF (UI PREVIEW)";
        public string BsrToggleLabel { get; private set; } = "BSR MODULE: OFF (UI PREVIEW)";
        public string ModulePreviewStatus { get; private set; } = "";

        // BSML does not interpolate {property} placeholders in ordinary text/button
        // attributes. Bind concrete components and update their text after parsing.
        [UIComponent("pairingCodeText")]
        private TextMeshProUGUI _pairingCodeText = null!;

        [UIComponent("statusText")]
        private TextMeshProUGUI _statusText = null!;

        [UIComponent("connectButton")]
        private Button _connectButton = null!;

        [UIComponent("customizeChatPanelButton")]
        private Button _customizeChatPanelButton = null!;

        [UIComponent("chatToggleButton")]
        private Button _chatToggleButton = null!;

        [UIComponent("bsrToggleButton")]
        private Button _bsrToggleButton = null!;

        [UIComponent("bsrQueueText")]
        private TextMeshProUGUI _bsrQueueText = null!;

        private TextMeshProUGUI? _connectButtonText;
        private TextMeshProUGUI? _customizeChatPanelButtonText;
        private TextMeshProUGUI? _chatToggleButtonText;
        private TextMeshProUGUI? _bsrToggleButtonText;

        [UIAction("#post-parse")]
        public void OnPostParse()
        {
            _connectButtonText = _connectButton != null
                ? _connectButton.GetComponentInChildren<TextMeshProUGUI>()
                : null;
            _customizeChatPanelButtonText = _customizeChatPanelButton != null
                ? _customizeChatPanelButton.GetComponentInChildren<TextMeshProUGUI>(true)
                : null;
            if (_customizeChatPanelButton != null)
            {
                _customizeChatPanelButton.gameObject.SetActive(true);
                _customizeChatPanelButton.interactable = true;
                var buttonImage = _customizeChatPanelButton.GetComponentInChildren<Image>(true);
                if (buttonImage != null) buttonImage.color = new Color(0.42f, 0.24f, 0.78f, 1f);
            }
            if (_customizeChatPanelButtonText != null)
            {
                _customizeChatPanelButtonText.gameObject.SetActive(true);
                _customizeChatPanelButtonText.enabled = true;
                _customizeChatPanelButtonText.color = Color.white;
                _customizeChatPanelButtonText.alpha = 1f;
            }
            _chatToggleButtonText = _chatToggleButton != null
                ? _chatToggleButton.GetComponentInChildren<TextMeshProUGUI>()
                : null;
            _bsrToggleButtonText = _bsrToggleButton != null
                ? _bsrToggleButton.GetComponentInChildren<TextMeshProUGUI>()
                : null;

            if (_connectButton == null || _pairingCodeText == null || _statusText == null ||
                _connectButtonText == null || _customizeChatPanelButtonText == null ||
                _chatToggleButtonText == null || _bsrToggleButtonText == null)
            {
                StatusText = "A RiftPulse menu control could not initialize. Reinstall the PCVR package and check the BSML dependency.";
            }

            RefreshUi();
            _ = ResumeDevicePairing();
        }

        private async Task ResumeDevicePairing()
        {
            try
            {
                var credential = LoadOrCreateDeviceCredential();
                var deviceId = LoadOrCreateDeviceId();
                var body = "{\"deviceId\":\"" + deviceId + "\",\"deviceCredential\":\"" + credential + "\"}";
                using (var request = new HttpRequestMessage(HttpMethod.Post, ApiBase + "/pairing/resume"))
                {
                    request.Content = new StringContent(body, Encoding.UTF8, "application/json");
                    using (var response = await Http.SendAsync(request))
                    {
                        if (response.IsSuccessStatusCode)
                        {
                            var payload = await response.Content.ReadAsStringAsync();
                            var state = Regex.Match(payload, "\"status\"\\s*:\\s*\"([a-z_]+)\"");
                            if (state.Success && state.Groups[1].Value == "claimed")
                            {
                                _hasPairedThisSession = true;
                                PairingCode = "LINKED";
                                StatusText = "Saved device link restored.";
                                RefreshUi();
                                await LoadAccountModuleSettings();
                                return;
                            }
                        }
                    }
                }
            }
            catch (Exception) { /* Keep startup resilient; the saved device credential is still available. */ }
            await LoadAccountModuleSettings();
        }

        private static string CompactStatus(string value, int maxLength)
        {
            var compact = Regex.Replace(value ?? string.Empty, @"\s+", " ").Trim();
            if (compact.Length <= maxLength) return compact;
            return compact.Substring(0, Math.Max(0, maxLength - 3)).TrimEnd() + "...";
        }

        private void RefreshUi()
        {
            if (_pairingCodeText != null) _pairingCodeText.text = PairingCode;
            if (_connectButtonText != null)
                _connectButtonText.text = _connecting ? "GENERATING CODE..." :
                    (_hasPairedThisSession ? "GENERATE NEW CODE" : "GENERATE SECURE CODE");
            if (_customizeChatPanelButtonText != null) _customizeChatPanelButtonText.text = "OPEN DISPLAY LAB";
            var visibleStatus = string.IsNullOrWhiteSpace(ModulePreviewStatus)
                ? StatusText : ModulePreviewStatus;
            if (_statusText != null) _statusText.text = CompactStatus(visibleStatus, 38);
            if (_chatToggleButtonText != null) _chatToggleButtonText.text = ChatToggleLabel;
            if (_bsrToggleButtonText != null) _bsrToggleButtonText.text = BsrToggleLabel;
        }

        private bool _hasPairedThisSession;
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
                RefreshUi();
            }
            catch (IOException)
            {
                ModulePreviewStatus = "Could not save preview switches locally. Check RiftPulse folder permissions.";
                RefreshUi();
            }
            catch (UnauthorizedAccessException)
            {
                ModulePreviewStatus = "Could not save preview switches locally. Check RiftPulse folder permissions.";
                RefreshUi();
            }
        }

        [UIAction("toggle-chat")]
        public async void ToggleChatPreview()
        {
            if (!_hasPairedThisSession)
            {
                ModulePreviewStatus = "Pair this installation using Generate Pairing Code before changing account settings.";
                RefreshUi();
                return;
            }
            _chatPreviewEnabled = !_chatPreviewEnabled;
            ChatToggleLabel = _chatPreviewEnabled ? "CHAT MODULE: ON (SYNCING)" : "CHAT MODULE: OFF (SYNCING)";
            RefreshUi();
            await SaveModuleSetting("chat", _chatPreviewEnabled);
        }

        [UIAction("toggle-bsr")]
        public async void ToggleBsrPreview()
        {
            if (!_hasPairedThisSession)
            {
                ModulePreviewStatus = "Pair this installation using Generate Pairing Code before changing account settings.";
                RefreshUi();
                return;
            }
            _bsrPreviewEnabled = !_bsrPreviewEnabled;
            BsrToggleLabel = _bsrPreviewEnabled ? "BSR MODULE: ON (SYNCING)" : "BSR MODULE: OFF (SYNCING)";
            RefreshUi();
            await SaveModuleSetting("bsr-song-request", _bsrPreviewEnabled);
        }

        [UIAction("refresh-bsr-queue")]
        public async void RefreshBsrQueueClicked() { await RefreshSongRequestQueue(); }

        private static string ReadSongRequestJsonString(string json, string key)
        {
            var match = Regex.Match(json, "\\\"" + Regex.Escape(key) + "\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"");
            return match.Success ? match.Groups[1].Value.Replace("\\\\n", " ") : string.Empty;
        }

        private async Task RefreshSongRequestQueue()
        {
            if (_bsrQueueText != null) _bsrQueueText.text = "Loading song queue...";
            if (!_hasPairedThisSession) { if (_bsrQueueText != null) _bsrQueueText.text = "Pair this device to view your song queue."; return; }
            try
            {
                using (var request = new HttpRequestMessage(HttpMethod.Get, ApiBase + "/device/song-requests"))
                {
                    request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", LoadOrCreateDeviceCredential());
                    using (var response = await Http.SendAsync(request))
                    {
                        if (!response.IsSuccessStatusCode) { if (_bsrQueueText != null) _bsrQueueText.text = "Queue unavailable (HTTP " + (int)response.StatusCode + ")."; return; }
                        var payload = await response.Content.ReadAsStringAsync();
                        var requestsMatch = Regex.Match(payload, "\\\"requests\\\"\\s*:\\s*\\[(.*?)\\]", RegexOptions.Singleline);
                        if (!requestsMatch.Success) { if (_bsrQueueText != null) _bsrQueueText.text = "Could not read the song queue."; return; }
                        var items = Regex.Matches(requestsMatch.Groups[1].Value, "\\{[^{}]*\\}");
                        if (items.Count == 0) { if (_bsrQueueText != null) _bsrQueueText.text = "No songs waiting. Viewers: !bsr [BeatSaver key]"; return; }
                        var lines = new System.Collections.Generic.List<string>();
                        for (var index = 0; index < items.Count && index < 3; index++)
                        {
                            var item = items[index].Value;
                            var song = ReadSongRequestJsonString(item, "songName");
                            var requester = ReadSongRequestJsonString(item, "requesterName");
                            var status = ReadSongRequestJsonString(item, "status");
                            if (string.IsNullOrWhiteSpace(song)) song = "BeatSaver map " + ReadSongRequestJsonString(item, "beatsaverKey");
                            lines.Add((status == "playing" ? "PLAYING: " : "NEXT: ") + song + " - " + requester);
                        }
                        if (items.Count > 3) lines.Add("+" + (items.Count - 3) + " more in queue");
                        if (_bsrQueueText != null) _bsrQueueText.text = string.Join("\n", lines.ToArray());
                    }
                }
            }
            catch (Exception) { if (_bsrQueueText != null) _bsrQueueText.text = "Could not reach the RiftPulse song queue."; }
        }
        internal static string BsrCommand = "!bsr";
        internal static float BsrRequesterCooldownSeconds = 30f;
        internal static float BsrQueueLimit = 25f;

        internal async Task SaveBsrConfiguration()
        {
            if (!_hasPairedThisSession) { ModulePreviewStatus = "Pair this installation before changing BSR settings."; RefreshUi(); return; }
            var command = Regex.Replace(BsrCommand ?? "!bsr", "[^!a-zA-Z0-9_-]", "").ToLowerInvariant();
            if (!Regex.IsMatch(command, "^![a-z0-9_-]{1,19}$")) command = "!bsr";
            BsrCommand = command;
            var cooldown = Math.Max(0, Math.Min(3600, (int)Math.Round(BsrRequesterCooldownSeconds)));
            var limit = Math.Max(1, Math.Min(50, (int)Math.Round(BsrQueueLimit)));
            var body = "{\"settings\":{\"command\":\""+command+"\",\"requesterCooldownSeconds\":"+cooldown+",\"queueLimit\":"+limit+"}}";
            try
            {
                using (var request = new HttpRequestMessage(new HttpMethod("PATCH"), ApiBase + "/device/settings/modules/bsr-song-request"))
                {
                    request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", LoadOrCreateDeviceCredential());
                    request.Content = new StringContent(body, Encoding.UTF8, "application/json");
                    using (var response = await Http.SendAsync(request))
                    {
                        if (!response.IsSuccessStatusCode) throw new InvalidOperationException("HTTP " + (int)response.StatusCode);
                    }
                }
                ModulePreviewStatus = "BSR settings saved to your RiftPulse account.";
            }
            catch (Exception) { ModulePreviewStatus = "Could not save BSR settings. Check your connection and pairing."; }
            RefreshUi();
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
                            RefreshUi();
                            return;
                        }
                    }
                }
                ChatToggleLabel = _chatPreviewEnabled ? "CHAT MODULE: ON (ACCOUNT SYNCED)" : "CHAT MODULE: OFF (ACCOUNT SYNCED)";
                BsrToggleLabel = _bsrPreviewEnabled ? "BSR MODULE: ON (ACCOUNT SYNCED)" : "BSR MODULE: OFF (ACCOUNT SYNCED)";
                ModulePreviewStatus = "Module settings saved to your RiftPulse account. Service activation and configuration are separate steps.";
                RefreshUi();
            }
            catch (Exception)
            {
                ModulePreviewStatus = "Could not sync module settings. Check connection and confirm this installation is paired.";
                RefreshUi();
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
                        if (!response.IsSuccessStatusCode)
                        {
                            _hasPairedThisSession = false;
                            ModulePreviewStatus = (int)response.StatusCode == 401
                                ? "This PCVR device's pairing record is missing or expired. Choose GENERATE PAIRING CODE and link this installation again to restore its chat feed."
                                : "Pair this installation before syncing module settings.";
                            RefreshUi();
                            return;
                        }
                        _hasPairedThisSession = true;
                        PairingCode = "LINKED";
                        var payload = await response.Content.ReadAsStringAsync();
                        var chatMatch = Regex.Match(payload, "\\\"chat\\\"\\s*:\\s*\\{[^}]*\\\"enabled\\\"\\s*:\\s*(true|false)", RegexOptions.Singleline);
                        var bsrMatch = Regex.Match(payload, "\\\"bsr-song-request\\\"\\s*:\\s*\\{[^}]*\\\"enabled\\\"\\s*:\\s*(true|false)", RegexOptions.Singleline);
                        if (chatMatch.Success) _chatPreviewEnabled = chatMatch.Groups[1].Value == "true";
                        if (bsrMatch.Success) _bsrPreviewEnabled = bsrMatch.Groups[1].Value == "true";                        var commandMatch = Regex.Match(payload, "\"bsr-song-request\"\\s*:\\s*\\{.*?\"settings\"\\s*:\\s*\\{.*?\"command\"\\s*:\\s*\"([^\\\"]+)\"", RegexOptions.Singleline);
                        var cooldownMatch = Regex.Match(payload, "\"requesterCooldownSeconds\"\\s*:\\s*(\\d+)");
                        var limitMatch = Regex.Match(payload, "\"queueLimit\"\\s*:\\s*(\\d+)");
                        if (commandMatch.Success) BsrCommand = commandMatch.Groups[1].Value;
                        if (cooldownMatch.Success) BsrRequesterCooldownSeconds = Math.Max(0, Math.Min(3600, int.Parse(cooldownMatch.Groups[1].Value)));
                        if (limitMatch.Success) BsrQueueLimit = Math.Max(1, Math.Min(50, int.Parse(limitMatch.Groups[1].Value)));
                        ChatToggleLabel = _chatPreviewEnabled ? "CHAT MODULE: ON (ACCOUNT SYNCED)" : "CHAT MODULE: OFF (ACCOUNT SYNCED)";
                        BsrToggleLabel = _bsrPreviewEnabled ? "BSR MODULE: ON (ACCOUNT SYNCED)" : "BSR MODULE: OFF (ACCOUNT SYNCED)";
                        ModulePreviewStatus = "Module settings synced. Song requests are ready when BSR is enabled.";
                        RefreshUi();
                        await RefreshSongRequestQueue();
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
            ModulePreviewStatus = string.Empty;
            PairingCode = "�����";
            StatusText = "Generating a secure pairing code...";
            RefreshUi();

            try
            {
                var code = GenerateFiveDigitCode();
                var deviceId = LoadOrCreateDeviceId();
                var deviceCredential = LoadOrCreateDeviceCredential();
                PairingCode = code;
                StatusText = "Registering code with RiftPulse...";
                RefreshUi();

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
                            RefreshUi();
                            return;
                        }
                        var responseText = await response.Content.ReadAsStringAsync();
                        var match = Regex.Match(responseText, "\"challengeId\"\\s*:\\s*\"([0-9a-fA-F-]{36})\"");
                        if (!match.Success)
                        {
                            StatusText = "RiftPulse returned an invalid pairing response. Try again.";
                            RefreshUi();
                            return;
                        }
                        await PollPairingStatus(match.Groups[1].Value);
                    }
                }
            }
            catch (TaskCanceledException)
            {
                StatusText = "RiftPulse request timed out. Check your connection and try again.";
                RefreshUi();
            }
            catch (Exception)
            {
                StatusText = "Could not reach RiftPulse. Check your connection and try again.";
                RefreshUi();
            }
            finally
            {
                _connecting = false;
            }
        }

        private async Task PollPairingStatus(string challengeId)
        {
            StatusText = "Code registered. Enter it on the RiftPulse website to link this installation.";
            RefreshUi();
            var expiresAt = DateTime.UtcNow.AddMinutes(5);
            while (DateTime.UtcNow < expiresAt)
            {
                await Task.Delay(1500);
                using (var response = await Http.GetAsync(ApiBase + "/pairing/challenges/" + challengeId))
                {
                    if (!response.IsSuccessStatusCode)
                    {
                        StatusText = "Pairing status could not be checked (HTTP " + (int)response.StatusCode + ").";
                        RefreshUi();
                        return;
                    }
                    var payload = await response.Content.ReadAsStringAsync();
                    var statusMatch = Regex.Match(payload, "\"status\"\\s*:\\s*\"([a-z_]+)\"");
                    if (!statusMatch.Success) continue;
                    var status = statusMatch.Groups[1].Value;
                    if (status == "claimed")
                    {
                        _hasPairedThisSession = true;
                        PairingCode = "LINKED";
                        StatusText = "RiftPulse account linked. Device pairing succeeded.";
                        RefreshUi();
                        await LoadAccountModuleSettings();
                        return;
                    }
                    if (status == "expired" || status == "revoked")
                    {
                        StatusText = "This pairing code expired. Press Generate Pairing Code to generate another.";
                        RefreshUi();
                        return;
                    }
                }
            }
            StatusText = "Pairing timed out. Press Generate Pairing Code to try again.";
            RefreshUi();
        }

        internal static string DeviceCredential => LoadOrCreateDeviceCredential();

        [UIAction("move-chat-panel")]
        public void MoveChatPanel()
        {
            RiftPulseChatPanel.RequestReposition();
            ModulePreviewStatus = "Chat panel re-centered in front of you. Fine-tune it in Display Settings.";
            RefreshUi();
        }
        [UIAction("open-bsr-settings")]
        public void OpenBsrSettings() { RiftPulseFlowCoordinator.ShowBsrSettings(); }

        [UIAction("open-bsr-panel")]
        public void OpenBsrPanel()
        {
            RiftPulseSongRequestPanel.Initialize();
            RiftPulseSongRequestPanel.Show();
            ModulePreviewStatus = "Song request queue opened. Select a request to approve or remove it.";
            RefreshUi();
        }
        [UIAction("recenter-bsr-panel")]
        public void RecenterBsrPanel()
        {
            RiftPulseSongRequestPanel.Recenter();
            ModulePreviewStatus = "Song request panel re-centered in front of you.";
            RefreshUi();
        }

        [UIAction("open-chat-settings")]
        public void OpenChatPanelSettings()
        {
            RiftPulseFlowCoordinator.ShowChatPanelSettings();
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


    [ViewDefinition("RiftPulse.Pcvr.chatsettings.bsml")]
    public sealed class RiftPulseChatSettingsViewController : BSMLAutomaticViewController
    {
        [UIValue("panel-x")]
        public float PanelX
        {
            get => RiftPulseChatPanelPreferences.X;
            set => RiftPulseChatPanelPreferences.SetX(value);
        }

        [UIValue("panel-y")]
        public float PanelY
        {
            get => RiftPulseChatPanelPreferences.Y;
            set => RiftPulseChatPanelPreferences.SetY(value);
        }

        [UIValue("panel-z")]
        public float PanelZ
        {
            get => RiftPulseChatPanelPreferences.Z;
            set => RiftPulseChatPanelPreferences.SetZ(value);
        }

        [UIValue("panel-width")]
        public float PanelWidth
        {
            get => RiftPulseChatPanelPreferences.Width;
            set => RiftPulseChatPanelPreferences.SetWidth(value);
        }

        [UIValue("panel-height")]
        public float PanelHeight
        {
            get => RiftPulseChatPanelPreferences.Height;
            set => RiftPulseChatPanelPreferences.SetHeight(value);
        }

    }

    public sealed class RiftPulseChatSettingsFlowCoordinator : FlowCoordinator
    {
        private readonly RiftPulseChatSettingsViewController _settingsView =
            BeatSaberUI.CreateViewController<RiftPulseChatSettingsViewController>();

        public static void Present()
        {
            RiftPulseFlowCoordinator.ShowChatPanelSettings();
        }

        protected override void DidActivate(bool firstActivation, bool addedToHierarchy, bool screenSystemEnabling)
        {
            if (firstActivation)
            {
                SetTitle("Chat Panel Settings");
                showBackButton = true;
            }
            if (addedToHierarchy)
            {
                RiftPulseChatPanelPreferences.BeginSettingsEdit();
                ProvideInitialViewControllers(_settingsView);
            }
        }

        protected override void BackButtonWasPressed(ViewController topViewController)
        {
            RiftPulseChatPanelPreferences.EndSettingsEdit();
            RiftPulseFlowCoordinator.CloseChatPanelSettings(this);
        }
    }

    [ViewDefinition("RiftPulse.Pcvr.bsrsettings.bsml")]
    public sealed class RiftPulseBsrSettingsViewController : BSMLAutomaticViewController
    {
        [UIValue("bsr-command")]
        public string RequestCommand
        {
            get => RiftPulsePairingViewController.BsrCommand;
            set => RiftPulsePairingViewController.BsrCommand = value ?? "";
        }

        [UIValue("bsr-cooldown")]
        public float RequesterCooldown
        {
            get => RiftPulsePairingViewController.BsrRequesterCooldownSeconds;
            set => RiftPulsePairingViewController.BsrRequesterCooldownSeconds = value;
        }

        [UIValue("bsr-queue-limit")]
        public float QueueLimit
        {
            get => RiftPulsePairingViewController.BsrQueueLimit;
            set => RiftPulsePairingViewController.BsrQueueLimit = value;
        }

        [UIValue("bsr-panel-x")]
        public float PanelX { get => RiftPulseSongRequestPanel.PanelX; set => RiftPulseSongRequestPanel.PanelX = value; }

        [UIValue("bsr-panel-y")]
        public float PanelY { get => RiftPulseSongRequestPanel.PanelY; set => RiftPulseSongRequestPanel.PanelY = value; }

        [UIValue("bsr-panel-z")]
        public float PanelZ { get => RiftPulseSongRequestPanel.PanelZ; set => RiftPulseSongRequestPanel.PanelZ = value; }

        [UIValue("bsr-panel-width")]
        public float PanelWidth { get => RiftPulseSongRequestPanel.PanelWidth; set => RiftPulseSongRequestPanel.PanelWidth = value; }

        [UIValue("bsr-panel-height")]
        public float PanelHeight { get => RiftPulseSongRequestPanel.PanelHeight; set => RiftPulseSongRequestPanel.PanelHeight = value; }

        [UIAction("save-bsr-settings")]
        public async void SaveClicked()
        {
            var active = RiftPulseFlowCoordinator.ActivePairingView;
            if (active != null) await active.SaveBsrConfiguration();
        }

    }

    public sealed class RiftPulseBsrSettingsFlowCoordinator : FlowCoordinator
    {
        private readonly RiftPulseBsrSettingsViewController _settingsView =
            BeatSaberUI.CreateViewController<RiftPulseBsrSettingsViewController>();

        protected override void DidActivate(bool firstActivation, bool addedToHierarchy, bool screenSystemEnabling)
        {
            if (firstActivation) { SetTitle("Song Request Settings"); showBackButton = true; }
            if (addedToHierarchy) ProvideInitialViewControllers(_settingsView);
        }

        protected override void BackButtonWasPressed(ViewController topViewController)
        {
            RiftPulseFlowCoordinator.CloseBsrSettings(this);
        }
    }
    public sealed class RiftPulseFlowCoordinator : FlowCoordinator
    {
        private static RiftPulseFlowCoordinator? _activeInstance;

        internal static RiftPulsePairingViewController? ActivePairingView => _activeInstance?._pairingView;
        private readonly RiftPulsePairingViewController _pairingView =
            BeatSaberUI.CreateViewController<RiftPulsePairingViewController>();
        private readonly RiftPulseChatSettingsFlowCoordinator _chatSettingsCoordinator =
            BeatSaberUI.CreateFlowCoordinator<RiftPulseChatSettingsFlowCoordinator>();
        private readonly RiftPulseBsrSettingsFlowCoordinator _bsrSettingsCoordinator =
            BeatSaberUI.CreateFlowCoordinator<RiftPulseBsrSettingsFlowCoordinator>();

        internal static void ShowChatPanelSettings()
        {
            if (_activeInstance == null) return;
            _activeInstance.PresentFlowCoordinator(_activeInstance._chatSettingsCoordinator);
        }

        internal static void CloseChatPanelSettings(RiftPulseChatSettingsFlowCoordinator settings)
        {
            if (_activeInstance == null) return;
            _activeInstance.DismissFlowCoordinator(settings);
        }

        internal static void ShowBsrSettings()
        {
            if (_activeInstance == null) return;
            _activeInstance.PresentFlowCoordinator(_activeInstance._bsrSettingsCoordinator);
        }

        internal static void CloseBsrSettings(RiftPulseBsrSettingsFlowCoordinator settings)
        {
            if (_activeInstance == null) return;
            _activeInstance.DismissFlowCoordinator(settings);
        }

        public static void Present()
        {
            var coordinator = BeatSaberUI.CreateFlowCoordinator<RiftPulseFlowCoordinator>();
            BeatSaberUI.MainFlowCoordinator.PresentFlowCoordinator(coordinator);
        }

        protected override void DidActivate(bool firstActivation, bool addedToHierarchy, bool screenSystemEnabling)
        {
            if (addedToHierarchy) _activeInstance = this;
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
