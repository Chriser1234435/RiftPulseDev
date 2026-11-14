using System;
using System.Collections.Concurrent;
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
    internal static class RiftPulseChatPanelPreferences
    {
        private static bool _loaded;
        private static float _x = 0.72f;
        private static float _y = -0.12f;
        private static float _z = 2.15f;
        private static float _width = 110f;
        private static float _height = 70f;

        private static string SettingsPath
        {
            get
            {
                var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RiftPulse");
                Directory.CreateDirectory(folder);
                return Path.Combine(folder, "pcvr-chat-panel-settings.txt");
            }
        }

        internal static float X { get { Load(); return _x; } }
        internal static float Y { get { Load(); return _y; } }
        internal static float Z { get { Load(); return _z; } }
        internal static float Width { get { Load(); return _width; } }
        internal static float Height { get { Load(); return _height; } }

        internal static void Load()
        {
            if (_loaded) return;
            _loaded = true;
            try
            {
                if (!File.Exists(SettingsPath)) return;
                var values = File.ReadAllLines(SettingsPath);
                if (values.Length >= 5)
                {
                    float parsed;
                    if (float.TryParse(values[0], NumberStyles.Float, CultureInfo.InvariantCulture, out parsed)) _x = Mathf.Clamp(parsed, -2.5f, 2.5f);
                    if (float.TryParse(values[1], NumberStyles.Float, CultureInfo.InvariantCulture, out parsed)) _y = Mathf.Clamp(parsed, -2.0f, 2.0f);
                    if (float.TryParse(values[2], NumberStyles.Float, CultureInfo.InvariantCulture, out parsed)) _z = Mathf.Clamp(parsed, 0.8f, 4.5f);
                    if (float.TryParse(values[3], NumberStyles.Float, CultureInfo.InvariantCulture, out parsed)) _width = Mathf.Clamp(parsed, 60f, 180f);
                    if (float.TryParse(values[4], NumberStyles.Float, CultureInfo.InvariantCulture, out parsed)) _height = Mathf.Clamp(parsed, 40f, 120f);
                }
            }
            catch (Exception) { /* Keep safe defaults when settings cannot be read. */ }
        }

        internal static void SetX(float value) { Load(); _x = Mathf.Clamp(value, -2.5f, 2.5f); SaveAndApply(); }
        internal static void SetY(float value) { Load(); _y = Mathf.Clamp(value, -2.0f, 2.0f); SaveAndApply(); }
        internal static void SetZ(float value) { Load(); _z = Mathf.Clamp(value, 0.8f, 4.5f); SaveAndApply(); }
        internal static void SetWidth(float value) { Load(); _width = Mathf.Clamp(value, 60f, 180f); SaveAndApply(); }
        internal static void SetHeight(float value) { Load(); _height = Mathf.Clamp(value, 40f, 120f); SaveAndApply(); }

        private static void SaveAndApply()
        {
            try
            {
                File.WriteAllLines(SettingsPath, new[] {
                    _x.ToString("R", CultureInfo.InvariantCulture),
                    _y.ToString("R", CultureInfo.InvariantCulture),
                    _z.ToString("R", CultureInfo.InvariantCulture),
                    _width.ToString("R", CultureInfo.InvariantCulture),
                    _height.ToString("R", CultureInfo.InvariantCulture)
                });
            }
            catch (Exception) { }
            RiftPulseChatPanel.ApplyPreferences();
        }
    }

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
        private TextMeshProUGUI? _handleLabel;
        private Image[]? _platformMarkParts;
        private static Sprite? _whiteSprite;
        private bool _requestInFlight;
        private bool _moveRequested;
        private bool _chatEnabled = true;
        private readonly ConcurrentQueue<Action> _pendingUiActions = new ConcurrentQueue<Action>();
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
            RiftPulseChatPanelPreferences.Load();
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

        internal static void ApplyPreferences()
        {
            var instance = _instance;
            if (instance == null || instance._panel == null)
            {
                // A stale manually dragged position must not override new X/Y/Z values.
                try { File.Delete(PlacementPath); } catch { }
                return;
            }
            instance._pendingUiActions.Enqueue(instance.ApplyPreferencesOnMainThread);
        }

        private void ApplyPreferencesOnMainThread()
        {
            if (_panel == null) return;
            var camera = Camera.main;
            if (camera != null)
            {
                var cameraTransform = camera.transform;
                var position = cameraTransform.position
                    + cameraTransform.right * RiftPulseChatPanelPreferences.X
                    + cameraTransform.up * RiftPulseChatPanelPreferences.Y
                    + cameraTransform.forward * RiftPulseChatPanelPreferences.Z;
                _panel.ScreenPosition = position;
                _panel.ScreenRotation = Quaternion.LookRotation(cameraTransform.position - position, cameraTransform.up);
            }
            _panel.ScreenSize = new Vector2(RiftPulseChatPanelPreferences.Width, RiftPulseChatPanelPreferences.Height);
            if (_text != null)
            {
                var textRect = _text.GetComponent<RectTransform>();
                textRect.anchoredPosition = new Vector2(5f, 0f);
                textRect.sizeDelta = new Vector2(
                    Mathf.Max(32f, RiftPulseChatPanelPreferences.Width - 20f),
                    Mathf.Max(24f, RiftPulseChatPanelPreferences.Height - 12f));
            }
            if (_handleLabel != null)
            {
                var handleRect = _handleLabel.GetComponent<RectTransform>();
                handleRect.anchoredPosition = new Vector2(0f, -RiftPulseChatPanelPreferences.Height * 0.5f + 2.2f);
            }
            UpdatePlatformMarkPosition();
            ApplyGrabHandleStyle();
            SavePlacement();
        }

        private void Update()
        {
            // HttpClient can finish on a worker thread. Apply all Unity and
            // TextMeshPro changes from this Update loop on the Unity main thread.
            while (_pendingUiActions.TryDequeue(out var action))
            {
                try { action(); }
                catch (Exception exception)
                {
                    Debug.LogWarning("[RiftPulse] Could not update the PCVR chat panel: " + exception.Message);
                }
            }

            if (_moveRequested)
            {
                DestroyPanel(savePlacement: false);
                try { File.Delete(PlacementPath); } catch { }
                _moveRequested = false;
            }

            if (_panel == null && !CreatePanel()) return;
            if (_panel != null && !_panel.gameObject.activeSelf)
                _panel.gameObject.SetActive(true);

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

            RiftPulseChatPanelPreferences.Load();
            var cameraTransform = camera.transform;
            var position = cameraTransform.position
                + cameraTransform.right * RiftPulseChatPanelPreferences.X
                + cameraTransform.up * RiftPulseChatPanelPreferences.Y
                + cameraTransform.forward * RiftPulseChatPanelPreferences.Z;
            var towardPlayer = cameraTransform.position - position;
            var rotation = Quaternion.LookRotation(towardPlayer, cameraTransform.up);
            LoadPlacement(ref position, ref rotation);

            // FloatingScreen creates a world-space panel with a controller-grabbable handle.
            _panel = FloatingScreen.CreateFloatingScreen(
                new Vector2(RiftPulseChatPanelPreferences.Width, RiftPulseChatPanelPreferences.Height),
                true, position, rotation, 0f, true);
            if (_panel == null) return false;

            _panel.ShowHandle = true;
            _panel.HighlightHandle = true;
            DontDestroyOnLoad(_panel.gameObject);

            var root = _panel.GetComponent<RectTransform>();
            // Give the actual feed the full panel body; keep the platform mark and
            // controller grab hint separate so chat never competes with a large title.
            _text = CreatePanelText(root, "RiftPulse PCVR Live Chat Feed",
                new Vector2(5f, 0f),
                new Vector2(Mathf.Max(32f, RiftPulseChatPanelPreferences.Width - 20f),
                    Mathf.Max(24f, RiftPulseChatPanelPreferences.Height - 12f)),
                2.45f, TextAlignmentOptions.TopLeft);
            _text.text = "PCVR  /  LIVE CHAT\nCOMBINED VIEWERS  -\n\nWaiting for your stream messages...";

            _handleLabel = CreatePanelText(root, "RiftPulse PCVR Drag Hint",
                new Vector2(0f, -RiftPulseChatPanelPreferences.Height * 0.5f + 2.2f),
                new Vector2(Mathf.Min(42f, RiftPulseChatPanelPreferences.Width * 0.45f), 3.5f),
                1.65f, TextAlignmentOptions.Center);
            _handleLabel.text = "DRAG TO MOVE";
            _handleLabel.enableWordWrapping = false;
            _handleLabel.color = new Color(0.34f, 0.88f, 1f, 1f);
            CreatePlatformMark(root);
            ApplyGrabHandleStyle();
            return true;
        }

        private void CreatePlatformMark(RectTransform parent)
        {
            _platformMarkParts = new[]
            {
                CreateLockPart(parent, "RiftPulse PCVR Monitor Top", new Vector2(6.5f, 0.8f), Vector2.zero),
                CreateLockPart(parent, "RiftPulse PCVR Monitor Bottom", new Vector2(6.5f, 0.8f), Vector2.zero),
                CreateLockPart(parent, "RiftPulse PCVR Monitor Left", new Vector2(0.8f, 4.3f), Vector2.zero),
                CreateLockPart(parent, "RiftPulse PCVR Monitor Right", new Vector2(0.8f, 4.3f), Vector2.zero),
                CreateLockPart(parent, "RiftPulse PCVR Monitor Stand", new Vector2(0.8f, 1.2f), Vector2.zero),
                CreateLockPart(parent, "RiftPulse PCVR Monitor Foot", new Vector2(3.8f, 0.8f), Vector2.zero)
            };
            UpdatePlatformMarkPosition();
        }

        private void UpdatePlatformMarkPosition()
        {
            if (_platformMarkParts == null || _platformMarkParts.Length != 6) return;
            var markX = -RiftPulseChatPanelPreferences.Width * 0.5f + 8f;
            var markY = RiftPulseChatPanelPreferences.Height * 0.5f - 6f;
            var positions = new[]
            {
                new Vector2(markX, markY + 2.0f), new Vector2(markX, markY - 2.0f),
                new Vector2(markX - 3.2f, markY), new Vector2(markX + 3.2f, markY),
                new Vector2(markX, markY - 3.0f), new Vector2(markX, markY - 3.8f)
            };
            for (var i = 0; i < _platformMarkParts.Length; i++)
            {
                var image = _platformMarkParts[i];
                if (image == null) continue;
                var rect = image.GetComponent<RectTransform>();
                if (rect != null) rect.anchoredPosition = positions[i];
            }
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
            handle.transform.localPosition = new Vector3(0f, -RiftPulseChatPanelPreferences.Height * 0.5f + 2.2f, 0f);
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
            hitBox.size = new Vector3(Mathf.Clamp(RiftPulseChatPanelPreferences.Width * 0.34f, 24f, 42f), 4.5f, 4.5f);
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
            _text = null;
            _handleLabel = null;
        }

        private async Task RefreshFeed()
        {
            _requestInFlight = true;
            try
            {
                string body;
                int statusCode;
                using (var request = new HttpRequestMessage(HttpMethod.Get, FeedUrl))
                {
                    request.Headers.Authorization =
                        new System.Net.Http.Headers.AuthenticationHeaderValue(
                            "Bearer", RiftPulsePairingViewController.DeviceCredential);
                    using (var response = await Http.SendAsync(request).ConfigureAwait(false))
                    {
                        statusCode = (int)response.StatusCode;
                        body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                    }
                }

                if (statusCode >= 200 && statusCode < 300)
                {
                    _pendingUiActions.Enqueue(() => RenderFeed(body));
                }
                else if (statusCode == 401)
                {
                    _pendingUiActions.Enqueue(() =>
                    {
                        if (_panel != null) _panel.gameObject.SetActive(true);
                        if (_text != null)
                        {
                            _text.gameObject.SetActive(true);
                            _text.enabled = true;
                            _text.text = "DEVICE LINK REQUIRED\n\nThis PCVR installation needs to be paired again before it can load chat. Open RiftPulse from the Mods panel, choose GENERATE PAIRING CODE, and enter the code on app.riftpulse.me.";
                        }
                    });
                }
                else
                {
                    _pendingUiActions.Enqueue(() => SetFeedStatus("Chat connection paused (HTTP " + statusCode + "). Retrying..."));
                }
            }
            catch (Exception exception)
            {
                var detail = exception is TaskCanceledException ? "Request timed out." : "Could not reach the chat feed.";
                _pendingUiActions.Enqueue(() => SetFeedStatus(detail + " Retrying..."));
            }
            finally
            {
                _pendingUiActions.Enqueue(() => _requestInFlight = false);
            }
        }

        private void SetFeedStatus(string detail)
        {
            if (_panel != null) _panel.gameObject.SetActive(true);
            if (_text == null) return;
            _text.gameObject.SetActive(true);
            _text.enabled = true;
            _text.text = "PCVR  /  LIVE CHAT\n\n" + detail;
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
            _text.gameObject.SetActive(true);
            _text.enabled = true;
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
                if (rendered == 0) output.AppendLine("Waiting for live messages...");
            }
            else
            {
                output.AppendLine("Chat feed response is missing its messages list.");
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
