using System;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using BeatSaberMarkupLanguage.FloatingScreen;
using TMPro;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

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
        private TextMeshProUGUI? _title;
        private TextMeshProUGUI? _text;
        private TextMeshProUGUI? _handleLabel;
        private static Sprite? _whiteSprite;
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
            // Keep the floating chat panel available in menus and gameplay.
            // It is a world-space screen with its own controller grab handle,
            // so users can move it at any time instead of only during a song.

            if (_moveRequested)
            {
                DestroyPanel(savePlacement: false);
                try { File.Delete(PlacementPath); } catch { }
                _moveRequested = false;
            }

            if (_panel == null && !CreatePanel()) return;

            var pulse = (Mathf.Sin(Time.realtimeSinceStartup * 2.2f) + 1f) * 0.5f;
            if (_title != null)
                _title.color = Color.Lerp(new Color(0.28f, 0.70f, 1f, 1f), new Color(0.72f, 0.48f, 1f, 1f), pulse);
            if (_handleLabel != null)
                _handleLabel.color = Color.Lerp(new Color(0.20f, 0.62f, 0.82f, 1f), new Color(0.55f, 0.96f, 1f, 1f), pulse);
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

        private static TMP_FontAsset? ResolvePanelFont()
        {
            var font = TMP_Settings.defaultFontAsset;
            if (font != null) return font;

            var fonts = Resources.FindObjectsOfTypeAll<TMP_FontAsset>();
            for (var i = 0; i < fonts.Length; i++)
                if (fonts[i] != null) return fonts[i];
            return null;
        }

        private TextMeshProUGUI CreatePanelText(
            RectTransform parent, string objectName, Vector2 position, Vector2 size,
            float fontSize, TextAlignmentOptions alignment)
        {
            var textObject = new GameObject(objectName, typeof(RectTransform), typeof(TextMeshProUGUI));
            var rect = textObject.GetComponent<RectTransform>();
            rect.SetParent(parent, false);
            rect.anchorMin = new Vector2(0.5f, 0.5f);
            rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.anchoredPosition = position;
            rect.sizeDelta = size;

            var text = textObject.GetComponent<TextMeshProUGUI>();
            var font = ResolvePanelFont();
            if (font != null) text.font = font;
            text.fontSize = fontSize;
            text.enableWordWrapping = true;
            text.alignment = alignment;
            text.color = new Color(0.91f, 0.93f, 1f, 1f);
            text.richText = true;
            text.raycastTarget = false;
            textObject.SetActive(true);
            return text;
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
            DontDestroyOnLoad(_panel.gameObject);

            var root = _panel.GetComponent<RectTransform>();
            _title = CreatePanelText(root, "RiftPulse Pulsing Rift Header",
                new Vector2(0f, 26f), new Vector2(90f, 8.5f), 5.2f, TextAlignmentOptions.Center);
            _title.text = "<b>PULSING RIFT</b>";
            _title.enableWordWrapping = false;

            _text = CreatePanelText(root, "RiftPulse PCVR Live Chat Feed",
                new Vector2(0f, -5f), new Vector2(104f, 49f), 2.45f, TextAlignmentOptions.TopLeft);
            _text.text = "PCVR  /  LIVE CHAT\nCOMBINED VIEWERS  -\n\nWaiting for your stream messages...";

            _handleLabel = CreatePanelText(root, "RiftPulse PCVR Drag Hint",
                new Vector2(0f, -33f), new Vector2(28f, 3.5f), 1.65f, TextAlignmentOptions.Center);
            _handleLabel.text = "DRAG TO MOVE";
            _handleLabel.enableWordWrapping = false;
            CreatePlatformMark(root);
            ApplyGrabHandleStyle();
            return true;
        }

        private void CreatePlatformMark(RectTransform parent)
        {
            // A small, font-independent monitor mark distinguishes the PCVR panel.
            CreateLockPart(parent, "RiftPulse PCVR Monitor Top", new Vector2(6.5f, 0.8f), new Vector2(-47f, 30f));
            CreateLockPart(parent, "RiftPulse PCVR Monitor Bottom", new Vector2(6.5f, 0.8f), new Vector2(-47f, 26.5f));
            CreateLockPart(parent, "RiftPulse PCVR Monitor Left", new Vector2(0.8f, 4.3f), new Vector2(-50.2f, 28.25f));
            CreateLockPart(parent, "RiftPulse PCVR Monitor Right", new Vector2(0.8f, 4.3f), new Vector2(-43.8f, 28.25f));
            CreateLockPart(parent, "RiftPulse PCVR Monitor Stand", new Vector2(0.8f, 1.2f), new Vector2(-47f, 25.3f));
            CreateLockPart(parent, "RiftPulse PCVR Monitor Foot", new Vector2(3.8f, 0.8f), new Vector2(-47f, 24.5f));
        }

        private static Sprite GetWhiteSprite()
        {
            if (_whiteSprite == null)
                _whiteSprite = Sprite.Create(Texture2D.whiteTexture, new Rect(0f, 0f, 1f, 1f), new Vector2(0.5f, 0.5f));
            return _whiteSprite;
        }

        private Image CreateLockPart(RectTransform parent, string name, Vector2 size, Vector2 position)
        {
            var partObject = new GameObject(name, typeof(RectTransform), typeof(Image));
            var rect = partObject.GetComponent<RectTransform>();
            rect.SetParent(parent, false);
            rect.anchorMin = new Vector2(0.5f, 0.5f);
            rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.anchoredPosition = position;
            rect.sizeDelta = size;
            var image = partObject.GetComponent<Image>();
            image.sprite = GetWhiteSprite();
            image.type = Image.Type.Simple;
            image.color = new Color(0.91f, 0.95f, 1f, 1f);
            image.raycastTarget = false;
            return image;
        }

        private void ApplyGrabHandleStyle()
        {
            if (_panel == null) return;
            _panel.ShowHandle = true;
            _panel.HighlightHandle = true;

            GameObject? handle = null;
            for (var type = _panel.GetType(); type != null && handle == null; type = type.BaseType)
            {
                var field = type.GetField(
                    "handle",
                    BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly);
                handle = field?.GetValue(_panel) as GameObject;
            }
            if (handle == null) return;

            // Keep BSML's native controller drag component and its visible white bar.
            // Hide no native renderers: the collider alone is not a visible grab handle.
            handle.SetActive(true);
            handle.transform.localPosition = new Vector3(0f, -33.5f, 0f);
            handle.transform.localRotation = Quaternion.identity;
            handle.transform.localScale = Vector3.one;

            var nativeRenderer = handle.GetComponent<MeshRenderer>();
            if (nativeRenderer != null)
            {
                nativeRenderer.enabled = true;
                nativeRenderer.material.color = Color.white;
            }

            var hitBox = handle.GetComponent<BoxCollider>();
            if (hitBox == null) hitBox = handle.AddComponent<BoxCollider>();
            hitBox.center = Vector3.zero;
            hitBox.size = new Vector3(30f, 4.5f, 4.5f);
        }

        private void LoadPlacement(ref Vector3 position, ref Quaternion rotation)
        {
            try
            {
                if (!File.Exists(PlacementPath)) return;
                var values = File.ReadAllText(PlacementPath).Split(
                    new[] { ' ', '\r', '\n', '\t' },
                    StringSplitOptions.RemoveEmptyEntries);
                if (values.Length < 7) return;

                var parsed = new float[7];
                for (var i = 0; i < parsed.Length; i++)
                {
                    if (!float.TryParse(values[i], NumberStyles.Float, CultureInfo.InvariantCulture, out parsed[i]))
                        return;
                }

                position = new Vector3(parsed[0], parsed[1], parsed[2]);
                rotation = new Quaternion(parsed[3], parsed[4], parsed[5], parsed[6]);
                // Ignore legacy lock-state data; the panel is now always grab-movable.
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
                        "0"
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
            _title = null;
            _text = null;
            _handleLabel = null;
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
                        else if ((int)response.StatusCode == 401 && _text != null)
                        {
                            // Keep the panel visible before pairing so the user
                            // can still find and reposition it at any time.
                            if (_panel != null) _panel.gameObject.SetActive(true);
                            _text.text = "RIFTPULSE  /  LIVE CHAT\n\nConnect this Beat Saber installation to your RiftPulse account to load chat.";
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
        private static int FindMatchingObjectEnd(string json, int start)
        {
            if (start < 0 || start >= json.Length || json[start] != '{') return -1;
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
                else if (ch == '{') depth++;
                else if (ch == '}' && --depth == 0) return i;
            }
            return -1;
        }
        private void RenderFeed(string json)
        {
            var enabledMatch = Regex.Match(json, "\\\"chatEnabled\\\"\\s*:\\s*(true|false)");
            _chatEnabled = !enabledMatch.Success || enabledMatch.Groups[1].Value == "true";
            if (_panel != null) _panel.gameObject.SetActive(true);
            if (_text == null) return;
            if (!_chatEnabled)
            {
                _text.text = "RIFTPULSE  /  LIVE CHAT\n\nChat is currently disabled for this installation. Enable the Chat module on app.riftpulse.me.";
                return;
            }

            var total = "-";
            var viewerMatch = Regex.Match(json, "\\\"total\\\"\\s*:\\s*(null|[0-9]+)");
            if (viewerMatch.Success && viewerMatch.Groups[1].Value != "null")
                total = viewerMatch.Groups[1].Value;

            var output = new StringBuilder();
            output.AppendLine("PCVR  /  LIVE CHAT");
            output.Append("COMBINED VIEWERS  ").AppendLine(total);
            output.AppendLine("----------------------------");

            var messagesStart = json.IndexOf("\"messages\"", StringComparison.Ordinal);
            var arrayStart = messagesStart < 0 ? -1 : json.IndexOf('[', messagesStart);
            var arrayEnd = FindMatchingArrayEnd(json, arrayStart);
            if (arrayStart >= 0 && arrayEnd > arrayStart)
            {
                var cursor = arrayStart + 1;
                var rendered = 0;
                while (cursor < arrayEnd && rendered < 8)
                {
                    while (cursor < arrayEnd && (char.IsWhiteSpace(json[cursor]) || json[cursor] == ','))
                        cursor++;
                    var objectStart = json.IndexOf('{', cursor);
                    if (objectStart < 0 || objectStart >= arrayEnd) break;
                    var objectEnd = FindMatchingObjectEnd(json, objectStart);
                    if (objectEnd < 0 || objectEnd > arrayEnd) break;
                    var item = json.Substring(objectStart, objectEnd - objectStart + 1);
                    cursor = objectEnd + 1;
                    var sender = ReadString(item, "senderName");
                    var message = ReadString(item, "text");
                    if (sender.Length == 0 || message.Length == 0) continue;
                    var provider = ReadString(item, "provider");
                    var icon = provider == "twitch" ? "<color=#9146FF>●</color>"
                        : provider == "youtube" ? "<color=#FF0033>▶</color>"
                        : provider == "tiktok" ? "<color=#25F4EE>♪</color>"
                        : "<color=#B8C4D8>●</color>";
                    output.Append(icon).Append(' ').Append(Escape(sender, 28)).AppendLine();
                    output.AppendLine(Escape(message, 115));
                    output.AppendLine();
                    rendered++;
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
