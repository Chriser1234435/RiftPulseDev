using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
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
        private static float _x = 0f;
        private static float _y = 0f;
        private static float _z = 2.15f;
        private static float _width = 110f;
        private static float _height = 70f;
        private static bool _settingsPoseCaptured;
        private static Vector3 _settingsCameraPosition;
        private static Vector3 _settingsCameraRight;
        private static Vector3 _settingsCameraUp;
        private static Vector3 _settingsCameraForward;
        private static Quaternion _settingsCameraRotation = Quaternion.identity;
        private static Quaternion _savedRotationOffset = Quaternion.identity;
        private static bool _hasSavedRotationOffset;

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

        // Spatial placement uses a level horizon. Using the raw HMD forward/up
        // vectors tilts the distance offset downward when the player looks down,
        // which can put a "2.15 m in front" panel on the floor.
        internal static Vector3 HorizontalForward(Transform cameraTransform)
        {
            var forward = cameraTransform.forward;
            forward.y = 0f;
            if (forward.sqrMagnitude < 0.0001f) forward = Vector3.forward;
            return forward.normalized;
        }

        internal static Vector3 HorizontalRight(Transform cameraTransform)
        {
            return Vector3.Cross(Vector3.up, HorizontalForward(cameraTransform)).normalized;
        }

        internal static Quaternion HorizontalCameraRotation(Transform cameraTransform)
        {
            return Quaternion.LookRotation(HorizontalForward(cameraTransform), Vector3.up);
        }

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
                    // Rotation offsets written before the level-horizon coordinate frame
                    // used a pitch-relative basis. Keep X/Y/Z/size, but migrate their
                    // facing to the safe front-facing default once; new files use frame 2.
                    if (values.Length >= 11 && values[10] == "2")
                    {
                        var rotationValues = new float[4];
                        var validRotation = true;
                        for (var i = 0; i < 4; i++)
                            validRotation &= float.TryParse(values[i + 5], NumberStyles.Float, CultureInfo.InvariantCulture, out rotationValues[i]);
                        if (validRotation)
                        {
                            _savedRotationOffset = new Quaternion(rotationValues[0], rotationValues[1], rotationValues[2], rotationValues[3]);
                            _hasSavedRotationOffset = values[9] == "1";
                        }
                    }
                    else
                    {
                        _savedRotationOffset = Quaternion.identity;
                        _hasSavedRotationOffset = false;
                        SaveFile();
                    }
                    // 0.3.1's initial defaults were slightly off-centre. Migrate only
                    // that untouched legacy default; preserve any other saved user pose.
                    if (Mathf.Abs(_x - 0.72f) < 0.0001f &&
                        Mathf.Abs(_y + 0.12f) < 0.0001f &&
                        Mathf.Abs(_z - 2.15f) < 0.0001f)
                    {
                        _x = 0f;
                        _y = 0f;
                        SaveFile();
                    }
                }
            }
            catch (Exception) { /* Keep safe defaults when settings cannot be read. */ }
        }

        internal static void SetX(float value) { Load(); _x = Mathf.Clamp(value, -2.5f, 2.5f); SaveAndApply(); }
        internal static void SetY(float value) { Load(); _y = Mathf.Clamp(value, -2.0f, 2.0f); SaveAndApply(); }
        internal static void SetZ(float value) { Load(); _z = Mathf.Clamp(value, 0.8f, 4.5f); SaveAndApply(); }
        internal static void SetWidth(float value) { Load(); _width = Mathf.Clamp(value, 60f, 180f); SaveAndApply(); }
        internal static void SetHeight(float value) { Load(); _height = Mathf.Clamp(value, 40f, 120f); SaveAndApply(); }

        internal static Quaternion GetInitialPanelRotation(Transform cameraTransform, Vector3 panelPosition)
        {
            Load();
            var referenceRotation = HorizontalCameraRotation(cameraTransform);
            if (_hasSavedRotationOffset) return referenceRotation * _savedRotationOffset;
            return Quaternion.LookRotation(cameraTransform.position - panelPosition, Vector3.up);
        }

        internal static void SaveRotationOffset(Quaternion worldRotation, Quaternion referenceCameraRotation)
        {
            Load();
            _savedRotationOffset = Quaternion.Inverse(referenceCameraRotation) * worldRotation;
            _hasSavedRotationOffset = true;
            SaveFile();
        }

        internal static void ResetForRecenter()
        {
            Load();
            // Recenter is an explicit reset, not a reuse of the last manually dragged pose.
            _x = 0f;
            _y = 0f;
            _z = 2.15f;
            _savedRotationOffset = Quaternion.identity;
            _hasSavedRotationOffset = false;
            SaveFile();
        }

        internal static Quaternion SettingsCameraRotation(Transform cameraTransform)
        {
            return _settingsPoseCaptured ? _settingsCameraRotation : HorizontalCameraRotation(cameraTransform);
        }

        internal static Quaternion CapturedSettingsCameraRotation { get { return _settingsCameraRotation; } }

        internal static void BeginSettingsEdit()
        {
            var camera = Camera.main;
            if (camera == null) return;
            var transform = camera.transform;
            _settingsCameraPosition = transform.position;
            _settingsCameraRight = HorizontalRight(transform);
            _settingsCameraUp = Vector3.up;
            _settingsCameraForward = HorizontalForward(transform);
            _settingsCameraRotation = HorizontalCameraRotation(transform);
            _settingsPoseCaptured = true;
        }

        internal static void EndSettingsEdit() { _settingsPoseCaptured = false; }

        internal static bool TryGetSettingsPose(out Vector3 position, out Vector3 right, out Vector3 up, out Vector3 forward)
        {
            position = _settingsCameraPosition;
            right = _settingsCameraRight;
            up = _settingsCameraUp;
            forward = _settingsCameraForward;
            return _settingsPoseCaptured;
        }

        internal static void SyncPositionFromWorld(Vector3 position, Transform cameraTransform)
        {
            Load();
            var delta = position - cameraTransform.position;
            // X/Z are relative to headset yaw; Y is true world vertical.
            _x = Mathf.Clamp(Vector3.Dot(delta, HorizontalRight(cameraTransform)), -2.5f, 2.5f);
            _y = Mathf.Clamp(delta.y, -2f, 2f);
            _z = Mathf.Clamp(Vector3.Dot(delta, HorizontalForward(cameraTransform)), 0.8f, 4.5f);
            SaveFile();
        }

        private static void SaveFile()
        {
            try
            {
                File.WriteAllLines(SettingsPath, new[] {
                    _x.ToString("R", CultureInfo.InvariantCulture),
                    _y.ToString("R", CultureInfo.InvariantCulture),
                    _z.ToString("R", CultureInfo.InvariantCulture),
                    _width.ToString("R", CultureInfo.InvariantCulture),
                    _height.ToString("R", CultureInfo.InvariantCulture),
                    _savedRotationOffset.x.ToString("R", CultureInfo.InvariantCulture),
                    _savedRotationOffset.y.ToString("R", CultureInfo.InvariantCulture),
                    _savedRotationOffset.z.ToString("R", CultureInfo.InvariantCulture),
                    _savedRotationOffset.w.ToString("R", CultureInfo.InvariantCulture),
                    _hasSavedRotationOffset ? "1" : "0",
                    "2"
                });
            }
            catch (Exception) { }
        }

        private static void SaveAndApply()
        {
            SaveFile();
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
        private TextMeshProUGUI? _headerText;
        private TextMeshProUGUI? _text;
        private TextMeshProUGUI? _handleLabel;
        private Image[]? _platformMarkParts;
        private static Sprite? _whiteSprite;
        private bool _requestInFlight;
        private bool _moveRequested;
        private bool _hasPersistedPanelPose;
        private Vector3 _lastPersistedPanelPosition;
        private Quaternion _lastPersistedPanelRotation = Quaternion.identity;
        private float _nextPosePersistAt;
        private bool _chatEnabled = true;
        private readonly ConcurrentQueue<Action> _pendingUiActions = new ConcurrentQueue<Action>();
        private float _nextPollAt;
        private string _sessionStartedAtUtc = string.Empty;

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
            if (_instance == null) return;
            RiftPulseChatPanelPreferences.ResetForRecenter();
            _instance._moveRequested = true;
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
            Vector3 cameraPosition, right, up, forward;
            var captured = RiftPulseChatPanelPreferences.TryGetSettingsPose(out cameraPosition, out right, out up, out forward);
            if (captured || camera != null)
            {
                if (!captured)
                {
                    var cameraTransform = camera!.transform;
                    cameraPosition = cameraTransform.position;
                    right = RiftPulseChatPanelPreferences.HorizontalRight(cameraTransform);
                    up = Vector3.up;
                    forward = RiftPulseChatPanelPreferences.HorizontalForward(cameraTransform);
                }
                var position = cameraPosition + right * RiftPulseChatPanelPreferences.X
                    + up * RiftPulseChatPanelPreferences.Y + forward * RiftPulseChatPanelPreferences.Z;
                _panel.ScreenPosition = position;
                // Preserve the panel's current facing while its position sliders update.
                // Recomputing LookRotation on every slider callback caused it to flip.
                if (camera != null)
                    RiftPulseChatPanelPreferences.SaveRotationOffset(
                        _panel.ScreenRotation, RiftPulseChatPanelPreferences.HorizontalCameraRotation(camera.transform));
                else if (captured)
                    RiftPulseChatPanelPreferences.SaveRotationOffset(
                        _panel.ScreenRotation, RiftPulseChatPanelPreferences.CapturedSettingsCameraRotation);
            }
            _panel.ScreenSize = new Vector2(RiftPulseChatPanelPreferences.Width, RiftPulseChatPanelPreferences.Height);
            if (_headerText != null)
            {
                var headerRect = _headerText.GetComponent<RectTransform>();
                headerRect.anchoredPosition = new Vector2(5f, RiftPulseChatPanelPreferences.Height * 0.5f - 5.5f);
                headerRect.sizeDelta = new Vector2(
                    Mathf.Max(32f, RiftPulseChatPanelPreferences.Width - 20f), 11f);
            }
            if (_text != null)
            {
                var textRect = _text.GetComponent<RectTransform>();
                textRect.anchoredPosition = new Vector2(5f, -5f);
                textRect.sizeDelta = new Vector2(
                    Mathf.Max(32f, RiftPulseChatPanelPreferences.Width - 20f),
                    Mathf.Max(18f, RiftPulseChatPanelPreferences.Height - 22f));
            }
            if (_handleLabel != null)
            {
                var handleRect = _handleLabel.GetComponent<RectTransform>();
                handleRect.anchoredPosition = new Vector2(0f, -RiftPulseChatPanelPreferences.Height * 0.5f + 2.2f);
                handleRect.sizeDelta = new Vector2(
                    Mathf.Min(42f, RiftPulseChatPanelPreferences.Width * 0.45f), 3.5f);
            }
            UpdatePlatformMarkPosition();
            ApplyGrabHandleStyle();
            // Slider-applied transforms are already persisted by the five preference setters.
            // Reset the drag baseline so the settings edit is not mistaken for controller movement.
            MarkCurrentPanelPosePersisted();
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

            // Only a world-space panel transform change indicates a controller drag.
            // Head movement alone does not alter ScreenPosition, so it cannot overwrite X/Y/Z.
            SavePlacement();

            if (Time.realtimeSinceStartup >= _nextPollAt && !_requestInFlight)
            {
                _nextPollAt = Time.realtimeSinceStartup + 3.0f;
                _ = RefreshFeed();
            }

        }

        private static TMP_FontAsset? ResolvePanelFont()
        {
            // Prefer a neutral, high-legibility sans-serif when the game has one
            // loaded; fall back to Beat Saber's default TMP asset on every version.
            var fonts = Resources.FindObjectsOfTypeAll<TMP_FontAsset>();
            for (var i = 0; i < fonts.Length; i++)
            {
                if (fonts[i] == null) continue;
                var name = fonts[i].name.ToLowerInvariant();
                if (name.Contains("liberation") || name.Contains("arial") ||
                    name.Contains("roboto") || name.Contains("noto sans"))
                    return fonts[i];
            }
            var font = TMP_Settings.defaultFontAsset;
            if (font != null) return font;
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
                + RiftPulseChatPanelPreferences.HorizontalRight(cameraTransform) * RiftPulseChatPanelPreferences.X
                + Vector3.up * RiftPulseChatPanelPreferences.Y
                + RiftPulseChatPanelPreferences.HorizontalForward(cameraTransform) * RiftPulseChatPanelPreferences.Z;
            // Face the headset: screen's front normal must point from panel toward camera.
            var rotation = RiftPulseChatPanelPreferences.GetInitialPanelRotation(cameraTransform, position);
            // Ignore stale absolute world coordinates; headset-relative saved offsets are canonical.
            RiftPulseChatPanelPreferences.SyncPositionFromWorld(position, cameraTransform);

            // FloatingScreen creates a world-space panel with a controller-grabbable handle.
            _panel = FloatingScreen.CreateFloatingScreen(
                new Vector2(RiftPulseChatPanelPreferences.Width, RiftPulseChatPanelPreferences.Height),
                true, position, rotation, 0f, true);
            if (_panel == null) return false;

            _panel.ShowHandle = true;
            _panel.HighlightHandle = true;
            DontDestroyOnLoad(_panel.gameObject);

            var root = _panel.GetComponent<RectTransform>();
            // Keep the title/viewer count pinned at the top. The feed itself is bottom-aligned
            // so new messages enter at the bottom and older messages are trimmed from the top.
            _headerText = CreatePanelText(root, "RiftPulse PCVR Chat Header",
                new Vector2(5f, RiftPulseChatPanelPreferences.Height * 0.5f - 5.5f),
                new Vector2(Mathf.Max(32f, RiftPulseChatPanelPreferences.Width - 20f), 11f),
                2.8f, TextAlignmentOptions.TopLeft);
            _headerText.text = "RIFTPULSE  /  LIVE CHAT\nCOMBINED VIEWERS  -";

            _text = CreatePanelText(root, "RiftPulse PCVR Live Chat Feed",
                new Vector2(5f, -5f),
                new Vector2(Mathf.Max(32f, RiftPulseChatPanelPreferences.Width - 20f),
                    Mathf.Max(18f, RiftPulseChatPanelPreferences.Height - 22f)),
                3.0f, TextAlignmentOptions.BottomLeft);
            _text.text = "Waiting for live messages...";
            // Old entries are trimmed before rendering. Keep TMP in its default
            // overflow mode because Masking can hide all text on some VR canvases.

            _handleLabel = CreatePanelText(root, "RiftPulse PCVR Drag Hint",
                new Vector2(0f, -RiftPulseChatPanelPreferences.Height * 0.5f + 2.2f),
                new Vector2(Mathf.Min(42f, RiftPulseChatPanelPreferences.Width * 0.45f), 3.5f),
                1.65f, TextAlignmentOptions.Center);
            _handleLabel.text = "DRAG TO MOVE";
            _handleLabel.enableWordWrapping = false;
            _handleLabel.color = new Color(0.34f, 0.88f, 1f, 1f);
            CreatePlatformMark(root);
            ApplyGrabHandleStyle();
            MarkCurrentPanelPosePersisted();
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
                var camera = Camera.main;
                if (camera != null)
                    RiftPulseChatPanelPreferences.SyncPositionFromWorld(position, camera.transform);
                // Migrate the saved world position into the editable headset-relative X/Y/Z values.
            }
            catch { }
        }

        private void MarkCurrentPanelPosePersisted()
        {
            if (_panel == null)
            {
                _hasPersistedPanelPose = false;
                return;
            }
            _lastPersistedPanelPosition = _panel.ScreenPosition;
            _lastPersistedPanelRotation = _panel.ScreenRotation;
            _hasPersistedPanelPose = true;
        }

        private void SavePlacement()
        {
            if (_panel == null) return;
            var position = _panel.ScreenPosition;
            var rotation = _panel.ScreenRotation;
            if (!_hasPersistedPanelPose)
            {
                MarkCurrentPanelPosePersisted();
                return;
            }

            var positionDelta = position - _lastPersistedPanelPosition;
            var positionChanged = positionDelta.sqrMagnitude >= 0.000025f; // 5 mm
            var rotationChanged = Quaternion.Angle(rotation, _lastPersistedPanelRotation) >= 0.5f;
            if (!positionChanged && !rotationChanged) return;

            var now = Time.realtimeSinceStartup;
            if (now < _nextPosePersistAt) return;
            var camera = Camera.main;
            if (camera == null) return;

            // Persist the user's controller-dragged pose relative to the headset at
            // the time of the move. Do not run this against a stationary screen when
            // the player simply turns or walks around.
            RiftPulseChatPanelPreferences.SyncPositionFromWorld(position, camera.transform);
            RiftPulseChatPanelPreferences.SaveRotationOffset(
                rotation, RiftPulseChatPanelPreferences.HorizontalCameraRotation(camera.transform));
            _lastPersistedPanelPosition = position;
            _lastPersistedPanelRotation = rotation;
            _nextPosePersistAt = now + 0.25f;
        }

        private void DestroyPanel(bool savePlacement)
        {
            if (_panel == null) return;
            if (savePlacement) SavePlacement();
            Destroy(_panel.gameObject);
            _panel = null;
            _headerText = null;
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
                // The first successful response supplies a server-clock session cutoff.
                // A local PC clock can be skewed and must never decide which messages exist.
                var sessionFeedUrl = string.IsNullOrEmpty(_sessionStartedAtUtc)
                    ? FeedUrl
                    : FeedUrl + "?sessionStartedAt=" + Uri.EscapeDataString(_sessionStartedAtUtc);
                using (var request = new HttpRequestMessage(HttpMethod.Get, sessionFeedUrl))
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
                    var serverSessionStart = ReadString(body, "sessionStartedAt");
                    if (!string.IsNullOrEmpty(serverSessionStart)) _sessionStartedAtUtc = serverSessionStart;
                    _pendingUiActions.Enqueue(() => RenderFeed(body));
                }
                else if (statusCode == 401)
                {
                    _pendingUiActions.Enqueue(() =>
                    {
                        if (_panel != null) _panel.gameObject.SetActive(true);
                        if (_headerText != null)
                            _headerText.text = "RIFTPULSE  /  LIVE CHAT\nDEVICE LINK REQUIRED";
                        if (_text != null)
                        {
                            _text.gameObject.SetActive(true);
                            _text.enabled = true;
                            _text.text = "Open RiftPulse from the Mods panel, generate a pairing code, and enter it on app.riftpulse.me.";
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
            if (_headerText != null) _headerText.text = "RIFTPULSE  /  LIVE CHAT\nCONNECTION STATUS";
            if (_text == null) return;
            _text.gameObject.SetActive(true);
            _text.enabled = true;
            _text.text = detail;
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
        private static string ProviderBadge(string provider)
        {
            if (provider == "twitch") return "<mark=#9146FF><color=#FFFFFF><b> TW </b></color></mark>";
            if (provider == "youtube") return "<mark=#FF0000><color=#FFFFFF><b> YT </b></color></mark>";
            if (provider == "tiktok") return "<mark=#FFFFFF><color=#111111><b> TT </b></color></mark>";
            return "<mark=#64748B><color=#FFFFFF><b> RP </b></color></mark>";
        }

        private static string FormatFeedEntry(string provider, string eventKind, string sender, string message)
        {
            var safeSender = Escape(sender, 28);
            var safeMessage = Escape(message, 80);
            var badge = ProviderBadge(provider);
            if (string.IsNullOrEmpty(eventKind))
            {
                var nameColor = provider == "twitch" ? "#C4A1FF" : provider == "youtube" ? "#FF6666" : provider == "tiktok" ? "#FFFFFF" : "#D7E0EF";
                return badge + " <color=" + nameColor + "><b>" + safeSender + "</b></color>\n" + safeMessage + "\n\n";
            }
            var label = eventKind == "follow" ? "* FOLLOW"
                : eventKind == "subscription" ? "+ SUB / MEMBER"
                : eventKind == "gift" ? "GIFT"
                : eventKind == "bits" ? "BITS"
                : eventKind == "super_chat" ? "$ SUPER CHAT"
                : eventKind == "donation" ? "$ DONATION"
                : eventKind == "like" ? "LIKE"
                : eventKind == "share" ? "SHARE"
                : eventKind == "raid" ? "RAID"
                : eventKind == "member_join" ? "+ MEMBER JOIN" : "STREAM EVENT";
            var accent = provider == "twitch" ? "#9146FF" : provider == "youtube" ? "#FF3333" : provider == "tiktok" ? "#D8D8D8" : "#64748B";
            var foreground = provider == "tiktok" ? "#111111" : "#FFFFFF";
            return badge + " <mark=" + accent + "><color=" + foreground + "><b> " + label + " / " + safeSender + " </b></color></mark>\n<color=" + accent + "><b>" + safeMessage + "</b></color>\n\n";
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
                if (_headerText != null) _headerText.text = "RIFTPULSE  /  LIVE CHAT\nCHAT MODULE OFF";
                _text.text = "Chat is currently disabled for this installation. Enable the Chat module on app.riftpulse.me.";
                return;
            }

            var total = "-";
            var viewerMatch = Regex.Match(json, "\\\"total\\\"\\s*:\\s*(null|[0-9]+)");
            if (viewerMatch.Success && viewerMatch.Groups[1].Value != "null")
                total = viewerMatch.Groups[1].Value;
            if (_headerText != null)
                _headerText.text = "RIFTPULSE  /  LIVE CHAT\nCOMBINED VIEWERS  " + total;

            var output = new StringBuilder();

            var messagesStart = json.IndexOf("\"messages\"", StringComparison.Ordinal);
            var arrayStart = messagesStart < 0 ? -1 : json.IndexOf('[', messagesStart);
            var arrayEnd = FindMatchingArrayEnd(json, arrayStart);
            if (arrayStart >= 0 && arrayEnd > arrayStart)
            {
                var cursor = arrayStart + 1;
                var chatEntries = new List<KeyValuePair<DateTime, string>>();
                while (cursor < arrayEnd)
                {
                    while (cursor < arrayEnd && (char.IsWhiteSpace(json[cursor]) || json[cursor] == ','))
                        cursor++;
                    var objectStart = json.IndexOf('{', cursor);
                    if (objectStart < 0 || objectStart >= arrayEnd) break;
                    var objectEnd = FindMatchingObjectEnd(json, objectStart);
                    if (objectEnd < 0 || objectEnd > arrayEnd) break;
                    var item = json.Substring(objectStart, objectEnd - objectStart + 1);
                    cursor = objectEnd + 1;
                    var sender = ReadString(item, "displayName");
                    if (sender.Length == 0) sender = ReadString(item, "senderName");
                    var message = ReadString(item, "text");
                    var timestamp = ReadString(item, "receivedAt");
                    if (timestamp.Length == 0) timestamp = ReadString(item, "sentAt");
                    // Do not gate live chat by the headset/PC clock. The API owns receivedAt;
                    // local clock drift can otherwise discard every legitimate incoming message.
                    if (sender.Length == 0 || message.Length == 0) continue;
                    DateTime messageTime;
                    if (!DateTime.TryParse(timestamp, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out messageTime))
                        messageTime = DateTime.UtcNow; // display ordering only; never discard chat due to device clock drift
                    var provider = ReadString(item, "provider");
                    var eventKind = ReadString(item, "eventKind");
                    var entry = FormatFeedEntry(provider, eventKind, sender, message);
                    chatEntries.Add(new KeyValuePair<DateTime, string>(messageTime, entry));
                }
                chatEntries.Sort((left, right) => left.Key.CompareTo(right.Key));
                var charsPerMessageLine = Mathf.Max(24f, RiftPulseChatPanelPreferences.Width * 0.62f);
                var messageLines = 2f + Mathf.CeilToInt(80f / charsPerMessageLine);
                var availableLines = Mathf.Max(1f, (RiftPulseChatPanelPreferences.Height - 25f) / 3.2f);
                // Keep a conservative fixed-capacity feed so each refresh removes the
                // oldest entries before rendering; never let a burst fill the panel.
                var visibleMessageCapacity = Mathf.Clamp(Mathf.FloorToInt(availableLines / messageLines), 1, 4);
                if (chatEntries.Count > visibleMessageCapacity)
                    chatEntries.RemoveRange(0, chatEntries.Count - visibleMessageCapacity);
                // Bottom-anchored feed: keep chronological order so newest entries sit at the bottom.
                // Capacity trimming above removes the oldest messages from the top.
                foreach (var entry in chatEntries)
                    output.Append(entry.Value);
                if (chatEntries.Count == 0) output.AppendLine("Waiting for live messages...");
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
