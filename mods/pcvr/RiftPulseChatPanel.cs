using System;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using BeatSaberMarkupLanguage.FloatingScreen;
using TMPro;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RiftPulse.Pcvr
{
    /// <summary>
    /// A genuine world-space BSML screen. The built-in grab handle lets VR
    /// controllers move it around the play space; it is never parented to Camera.
    /// </summary>
    internal sealed class RiftPulseChatPanel : MonoBehaviour
    {
        private const string FeedUrl = "https://app.riftpulse.me/api/v1/device/chat/panel";
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
        private static RiftPulseChatPanel? _instance;

        private FloatingScreen? _panel;
        private TextMeshProUGUI? _text;
        private bool _requestInFlight;
        private bool _moveRequested;
        private bool _chatEnabled = true;
        private float _nextPollAt;
        private float _nextSaveAt;

        private static string PlacementPath
        {
            get
            {
                var folder = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "RiftPulse");
                Directory.CreateDirectory(folder);
                return Path.Combine(folder, "pcvr-chat-panel-position.dat");
            }
        }

        public static void Initialize()
        {
            if (_instance != null) return;
            var host = new GameObject("RiftPulse World Chat Driver");
            DontDestroyOnLoad(host);
            _instance = host.AddComponent<RiftPulseChatPanel>();
        }

        public static void Shutdown()
        {
            if (_instance == null) return;
            _instance.DestroyPanel(savePlacement: true);
            Destroy(_instance.gameObject);
            _instance = null;
        }

        public static void RequestReposition()
        {
            if (_instance != null) _instance._moveRequested = true;
        }

        private void Update()
        {
            var sceneName = SceneManager.GetActiveScene().name;
            var gameplay = sceneName == "GameCore"
                || sceneName.IndexOf("Gameplay", StringComparison.OrdinalIgnoreCase) >= 0;
            if (!gameplay)
            {
                if (_panel != null) DestroyPanel(savePlacement: true);
                return;
            }

            if (_moveRequested)
            {
                DestroyPanel(savePlacement: false);
                try { File.Delete(PlacementPath); } catch { }
                _moveRequested = false;
            }

            if (_panel == null && !CreatePanel()) return;

            if (Time.realtimeSinceStartup >= _nextPollAt && !_requestInFlight)
            {
                _nextPollAt = Time.realtimeSinceStartup + 3.0f;
                _ = RefreshFeed();
            }

            if (Time.realtimeSinceStartup >= _nextSaveAt)
            {
                _nextSaveAt = Time.realtimeSinceStartup + 1.5f;
                SavePlacement();
            }
        }

        private bool CreatePanel()
        {
            var camera = Camera.main;
            if (camera == null) return false;

            var cameraTransform = camera.transform;
            var position = cameraTransform.position
                + cameraTransform.forward * 2.15f
                + cameraTransform.right * 0.72f
                - cameraTransform.up * 0.12f;
            var towardPlayer = cameraTransform.position - position;
            var rotation = Quaternion.LookRotation(towardPlayer, cameraTransform.up);
            LoadPlacement(ref position, ref rotation);

            // FloatingScreen creates a world-space panel with a controller-grabbable handle.
            _panel = FloatingScreen.CreateFloatingScreen(
                new Vector2(110f, 70f), true, position, rotation, 0f, true);
            if (_panel == null) return false;

            _panel.ShowHandle = true;
            _panel.HighlightHandle = true;

            var textObject = new GameObject(
                "RiftPulse World Chat Text",
                typeof(RectTransform),
                typeof(TextMeshProUGUI));
            var rect = textObject.GetComponent<RectTransform>();
            rect.SetParent(_panel.GetComponent<RectTransform>(), false);
            rect.anchorMin = new Vector2(0.5f, 0.5f);
            rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.anchoredPosition = new Vector2(0f, -4f);
            rect.sizeDelta = new Vector2(102f, 55f);

            _text = textObject.GetComponent<TextMeshProUGUI>();
            _text.fontSize = 2.45f;
            _text.enableWordWrapping = true;
            _text.alignment = TextAlignmentOptions.TopLeft;
            _text.color = new Color(0.91f, 0.93f, 1f, 1f);
            _text.text = "RIFTPULSE  /  LIVE CHAT\nCOMBINED VIEWERS  -\n\nWaiting for your stream messages...";
            return true;
        }

        private void LoadPlacement(ref Vector3 position, ref Quaternion rotation)
        {
            try
            {
                if (!File.Exists(PlacementPath)) return;
                var values = File.ReadAllText(PlacementPath).Split(
                    new[] { ' ', '\r', '\n', '\t' },
                    StringSplitOptions.RemoveEmptyEntries);
                if (values.Length != 7) return;

                var parsed = new float[7];
                for (var i = 0; i < parsed.Length; i++)
                {
                    if (!float.TryParse(values[i], NumberStyles.Float, CultureInfo.InvariantCulture, out parsed[i]))
                        return;
                }

                position = new Vector3(parsed[0], parsed[1], parsed[2]);
                rotation = new Quaternion(parsed[3], parsed[4], parsed[5], parsed[6]);
            }
            catch { }
        }

        private void SavePlacement()
        {
            if (_panel == null) return;
            try
            {
                var position = _panel.ScreenPosition;
                var rotation = _panel.ScreenRotation;
                File.WriteAllText(
                    PlacementPath,
                    string.Join(" ", new[]
                    {
                        position.x.ToString("R", CultureInfo.InvariantCulture),
                        position.y.ToString("R", CultureInfo.InvariantCulture),
                        position.z.ToString("R", CultureInfo.InvariantCulture),
                        rotation.x.ToString("R", CultureInfo.InvariantCulture),
                        rotation.y.ToString("R", CultureInfo.InvariantCulture),
                        rotation.z.ToString("R", CultureInfo.InvariantCulture),
                        rotation.w.ToString("R", CultureInfo.InvariantCulture),
                    }));
            }
            catch { }
        }

        private void DestroyPanel(bool savePlacement)
        {
            if (_panel == null) return;
            if (savePlacement) SavePlacement();
            Destroy(_panel.gameObject);
            _panel = null;
            _text = null;
        }

        private async Task RefreshFeed()
        {
            _requestInFlight = true;
            try
            {
                using (var request = new HttpRequestMessage(HttpMethod.Get, FeedUrl))
                {
                    request.Headers.Authorization =
                        new System.Net.Http.Headers.AuthenticationHeaderValue(
                            "Bearer", RiftPulsePairingViewController.DeviceCredential);
                    using (var response = await Http.SendAsync(request))
                    {
                        var body = await response.Content.ReadAsStringAsync();
                        if (response.IsSuccessStatusCode)
                        {
                            RenderFeed(body);
                        }
                        else if ((int)response.StatusCode == 401 && _panel != null)
                        {
                            _panel.gameObject.SetActive(false);
                        }
                        else if (_text != null)
                        {
                            _text.text = "RIFTPULSE  /  CHAT\n\nConnection paused. Retrying...";
                        }
                    }
                }
            }
            catch
            {
                if (_text != null) _text.text = "RIFTPULSE  /  CHAT\n\nConnection paused. Retrying...";
            }
            finally
            {
                _requestInFlight = false;
            }
        }

        private static int FindMatchingArrayEnd(string json, int start)
        {
            if (start < 0 || start >= json.Length || json[start] != '[') return -1;
            var depth = 0;
            var inString = false;
            var escaped = false;
            for (var i = start; i < json.Length; i++)
            {
                var ch = json[i];
                if (inString)
                {
                    if (escaped) escaped = false;
                    else if (ch == '\\') escaped = true;
                    else if (ch == '"') inString = false;
                    continue;
                }
                if (ch == '"') inString = true;
                else if (ch == '[') depth++;
                else if (ch == ']' && --depth == 0) return i;
            }
            return -1;
        }
        private void RenderFeed(string json)
        {
            var enabledMatch = Regex.Match(json, "\\\"chatEnabled\\\"\\s*:\\s*(true|false)");
            _chatEnabled = !enabledMatch.Success || enabledMatch.Groups[1].Value == "true";
            if (_panel != null) _panel.gameObject.SetActive(_chatEnabled);
            if (!_chatEnabled || _text == null) return;

            var total = "-";
            var viewerMatch = Regex.Match(json, "\\\"total\\\"\\s*:\\s*(null|[0-9]+)");
            if (viewerMatch.Success && viewerMatch.Groups[1].Value != "null")
                total = viewerMatch.Groups[1].Value;

            var output = new StringBuilder();
            output.AppendLine("RIFTPULSE  /  LIVE CHAT");
            output.Append("COMBINED VIEWERS  ").AppendLine(total);
            output.AppendLine("----------------------------");

            var messagesStart = json.IndexOf("\"messages\"", StringComparison.Ordinal);
            var arrayStart = messagesStart < 0 ? -1 : json.IndexOf('[', messagesStart);
            var arrayEnd = FindMatchingArrayEnd(json, arrayStart);
            if (arrayStart >= 0 && arrayEnd > arrayStart)
            {
                var block = json.Substring(arrayStart + 1, arrayEnd - arrayStart - 1);
                var rendered = 0;
                foreach (Match match in Regex.Matches(block, "\\{[^{}]*\\}"))
                {
                    var item = match.Value;
                    var sender = ReadString(item, "senderName");
                    var message = ReadString(item, "text");
                    if (sender.Length == 0 || message.Length == 0) continue;
                    var provider = ReadString(item, "provider");
                    var tag = provider == "twitch" ? "TW"
                        : provider == "youtube" ? "YT"
                        : provider == "tiktok" ? "TT" : "LIVE";
                    output.Append('[').Append(tag).Append("] ").Append(Escape(sender, 28)).AppendLine();
                    output.AppendLine(Escape(message, 115));
                    output.AppendLine();
                    if (++rendered >= 8) break;
                }
                if (rendered == 0) output.AppendLine("No messages yet. Your chat will appear here.");
            }

            _text.text = output.ToString();
        }

        private static string ReadString(string json, string key)
        {
            var pattern = "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"";
            var match = Regex.Match(json, pattern);
            if (!match.Success) return string.Empty;
            return match.Groups[1].Value
                .Replace("\\n", " ").Replace("\\r", " ").Replace("\\t", " ")
                .Replace("\\\"", "\"").Replace("\\\\", "\\");
        }

        private static string Escape(string value, int maxLength)
        {
            if (value.Length > maxLength) value = value.Substring(0, maxLength);
            return value.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;")
                .Replace("\r", " ").Replace("\n", " ");
        }
    }
}
