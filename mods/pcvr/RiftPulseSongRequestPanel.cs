using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using BeatSaberMarkupLanguage.FloatingScreen;
using TMPro;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;

namespace RiftPulse.Pcvr
{
    internal sealed class RiftPulseSongRequestPanel : MonoBehaviour
    {
        private const string ApiBase = "https://app.riftpulse.me/api/v1";
        private const long MaxDownloadBytes = 100L * 1024L * 1024L;
        private const long MaxExpandedBytes = 700L * 1024L * 1024L;
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(25) };
        private static RiftPulseSongRequestPanel? _instance;

        private sealed class SongRequest
        {
            public string Id = "";
            public string Key = "";
            public string Song = "";
            public string Requester = "";
            public string Provider = "";
            public string Status = "";
        }

        private FloatingScreen? _panel;
        private TextMeshProUGUI? _header;
        private TextMeshProUGUI? _detail;
        private TextMeshProUGUI? _status;
        private RectTransform? _queueContent;
        private RectTransform? _queueViewport;
        private ScrollRect? _queueScroll;
        private readonly List<Button> _rowButtons = new List<Button>();
        private readonly List<SongRequest> _requests = new List<SongRequest>();
        private Button? _yesButton;
        private Button? _noButton;
        private Button? _refreshButton;
        private int _selectedIndex = -1;
        private float _nextPollAt;
        private bool _polling;
        private bool _actionInProgress;
        private Vector3 _panelOffset = new Vector3(0f, 0f, 2.25f);
        private Quaternion _panelRotationOffset = Quaternion.identity;
        private float _panelWidth = 142f;
        private float _panelHeight = 88f;
        private Vector3 _lastPersistedPosition;
        private Quaternion _lastPersistedRotation = Quaternion.identity;
        private float _nextPoseSaveAt;

        private static string PanelPosePath
        {
            get
            {
                var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RiftPulse");
                Directory.CreateDirectory(folder);
                return Path.Combine(folder, "pcvr-bsr-panel-pose.txt");
            }
        }

        public static void Initialize()
        {
            if (_instance != null) return;
            var host = new GameObject("RiftPulse BSR Queue Driver");
            DontDestroyOnLoad(host);
            _instance = host.AddComponent<RiftPulseSongRequestPanel>();
            _instance.LoadPanelPose();
        }

        public static float PanelX { get { Initialize(); return _instance != null ? _instance._panelOffset.x : 0f; } set { UpdatePanelPreference(panel => panel._panelOffset.x = Mathf.Clamp(value, -2.5f, 2.5f)); } }
        public static float PanelY { get { Initialize(); return _instance != null ? _instance._panelOffset.y : 0f; } set { UpdatePanelPreference(panel => panel._panelOffset.y = Mathf.Clamp(value, -2f, 2f)); } }
        public static float PanelZ { get { Initialize(); return _instance != null ? _instance._panelOffset.z : 2.25f; } set { UpdatePanelPreference(panel => panel._panelOffset.z = Mathf.Clamp(value, 0.8f, 4.5f)); } }
        public static float PanelWidth { get { Initialize(); return _instance != null ? _instance._panelWidth : 142f; } set { UpdatePanelPreference(panel => panel._panelWidth = Mathf.Clamp(value, 104f, 180f)); } }
        public static float PanelHeight { get { Initialize(); return _instance != null ? _instance._panelHeight : 88f; } set { UpdatePanelPreference(panel => panel._panelHeight = Mathf.Clamp(value, 68f, 120f)); } }

        private static void UpdatePanelPreference(Action<RiftPulseSongRequestPanel> update)
        {
            Initialize();
            var panel = _instance;
            if (panel == null) return;
            if (panel._panel != null) panel.PersistDraggedPose();
            update(panel);
            panel.SavePanelPose();
            if (panel._panel == null) return;
            var camera = Camera.main;
            if (camera != null)
            {
                var cameraTransform = camera.transform;
                var position = cameraTransform.position
                    + RiftPulseChatPanelPreferences.HorizontalRight(cameraTransform) * panel._panelOffset.x
                    + Vector3.up * panel._panelOffset.y
                    + RiftPulseChatPanelPreferences.HorizontalForward(cameraTransform) * panel._panelOffset.z;
                panel._panel.ScreenPosition = position;
            }
            panel.RelayoutPanel();
            panel.RenderQueue();
        }

        public static void Shutdown()
        {
            if (_instance == null) return;
            _instance.DestroyPanel();
            Destroy(_instance.gameObject);
            _instance = null;
        }

        public static void Show()
        {
            Initialize();
            if (_instance == null) return;
            _instance.EnsurePanel();
            if (_instance._panel != null) _instance._panel.gameObject.SetActive(true);
            _instance._nextPollAt = 0f;
            _ = _instance.RefreshQueue();
        }

        public static void Recenter()
        {
            Initialize();
            if (_instance == null) return;
            _instance._panelOffset = new Vector3(0f, 0f, 2.25f);
            _instance._panelRotationOffset = Quaternion.identity;
            _instance.SavePanelPose();
            _instance.DestroyPanel();
            Show();
        }

        private void Update()
        {
            if (_panel == null) return;
            PersistDraggedPose();
            if (Time.realtimeSinceStartup >= _nextPollAt && !_polling && !_actionInProgress)
            {
                _nextPollAt = Time.realtimeSinceStartup + 4f;
                _ = RefreshQueue();
            }
        }

        private void LoadPanelPose()
        {
            try
            {
                if (!File.Exists(PanelPosePath)) return;
                var values = File.ReadAllText(PanelPosePath).Split(new[] { " ", "\r", "\n", "\t" }, StringSplitOptions.RemoveEmptyEntries);
                if (values.Length < 7) return;
                var parsed = new float[7];
                for (var i = 0; i < parsed.Length; i++)
                    if (!float.TryParse(values[i], NumberStyles.Float, CultureInfo.InvariantCulture, out parsed[i])) return;
                _panelOffset = new Vector3(parsed[0], parsed[1], parsed[2]);
                _panelRotationOffset = new Quaternion(parsed[3], parsed[4], parsed[5], parsed[6]);
                if (values.Length >= 9)
                {
                    if (float.TryParse(values[7], NumberStyles.Float, CultureInfo.InvariantCulture, out var width))
                        _panelWidth = Mathf.Clamp(width, 104f, 180f);
                    if (float.TryParse(values[8], NumberStyles.Float, CultureInfo.InvariantCulture, out var height))
                        _panelHeight = Mathf.Clamp(height, 68f, 120f);
                }
            }
            catch { _panelOffset = new Vector3(0f, 0f, 2.25f); _panelRotationOffset = Quaternion.identity; }
        }

        private void SavePanelPose()
        {
            try
            {
                File.WriteAllText(PanelPosePath, string.Join(" ", new[] {
                    _panelOffset.x.ToString("R", CultureInfo.InvariantCulture),
                    _panelOffset.y.ToString("R", CultureInfo.InvariantCulture),
                    _panelOffset.z.ToString("R", CultureInfo.InvariantCulture),
                    _panelRotationOffset.x.ToString("R", CultureInfo.InvariantCulture),
                    _panelRotationOffset.y.ToString("R", CultureInfo.InvariantCulture),
                    _panelRotationOffset.z.ToString("R", CultureInfo.InvariantCulture),
                    _panelRotationOffset.w.ToString("R", CultureInfo.InvariantCulture),
                    _panelWidth.ToString("R", CultureInfo.InvariantCulture),
                    _panelHeight.ToString("R", CultureInfo.InvariantCulture)
                }));
            }
            catch { }
        }

        private void PersistDraggedPose()
        {
            if (_panel == null) return;
            var position = _panel.ScreenPosition;
            var rotation = _panel.ScreenRotation;
            if (Vector3.Distance(position, _lastPersistedPosition) < 0.005f &&
                Quaternion.Angle(rotation, _lastPersistedRotation) < 0.5f) return;
            if (Time.realtimeSinceStartup < _nextPoseSaveAt) return;
            var camera = Camera.main;
            if (camera == null) return;
            var transform = camera.transform;
            var delta = position - transform.position;
            _panelOffset.x = Vector3.Dot(delta, RiftPulseChatPanelPreferences.HorizontalRight(transform));
            _panelOffset.y = delta.y;
            _panelOffset.z = Vector3.Dot(delta, RiftPulseChatPanelPreferences.HorizontalForward(transform));
            _panelRotationOffset = Quaternion.Inverse(RiftPulseChatPanelPreferences.HorizontalCameraRotation(transform)) * rotation;
            SavePanelPose();
            _lastPersistedPosition = position;
            _lastPersistedRotation = rotation;
            _nextPoseSaveAt = Time.realtimeSinceStartup + 0.25f;
        }

        private bool EnsurePanel()
        {
            if (_panel != null) return true;
            var camera = Camera.main;
            if (camera == null) return false;
            LoadPanelPose();
            var transform = camera.transform;
            var forward = RiftPulseChatPanelPreferences.HorizontalForward(transform);
            var right = RiftPulseChatPanelPreferences.HorizontalRight(transform);
            var position = transform.position + right * _panelOffset.x + Vector3.up * _panelOffset.y + forward * _panelOffset.z;
            var cameraRotation = RiftPulseChatPanelPreferences.HorizontalCameraRotation(transform);
            var rotation = Quaternion.Angle(_panelRotationOffset, Quaternion.identity) < 0.01f
                ? Quaternion.LookRotation(transform.position - position, Vector3.up)
                : cameraRotation * _panelRotationOffset;
            _panel = FloatingScreen.CreateFloatingScreen(new Vector2(_panelWidth, _panelHeight), true, position, rotation, 0f, true);
            if (_panel == null) return false;
            _panel.ShowHandle = true;
            _panel.HighlightHandle = true;
            DontDestroyOnLoad(_panel.gameObject);
            var root = _panel.GetComponent<RectTransform>();
            var background = root.gameObject.GetComponent<Image>();
            if (background != null) background.color = new Color(0.018f, 0.028f, 0.060f, 0.97f);

            _header = CreateText(root, "RIFTPULSE  /  SONG REQUESTS", new Vector2(0f, _panelHeight * 0.5f - 5f), new Vector2(_panelWidth - 14f, 7f), 4.2f, TextAlignmentOptions.Center);
            _status = CreateText(root, "Connecting to the live queue...", new Vector2(0f, -_panelHeight * 0.5f + 4f), new Vector2(_panelWidth - 14f, 4f), 2.0f, TextAlignmentOptions.Center);
            _detail = CreateText(root, "♫  SELECT A REQUEST\n\nChoose a song to review it.", new Vector2(_panelWidth * 0.246f, _panelHeight * 0.2f), new Vector2(_panelWidth * 0.408f, _panelHeight * 0.34f), 2.8f, TextAlignmentOptions.TopLeft);

            CreateQueueScrollView(root);
            _yesButton = CreateButton(root, "BSR Approve", "YES  /  DOWNLOAD", new Vector2(_panelWidth * 0.246f, -_panelHeight * 0.045f), new Vector2(_panelWidth * 0.338f, _panelHeight * 0.102f), () => { _ = ApproveSelected(); });
            _noButton = CreateButton(root, "BSR Reject", "NO  /  REMOVE", new Vector2(_panelWidth * 0.246f, -_panelHeight * 0.17f), new Vector2(_panelWidth * 0.338f, _panelHeight * 0.09f), () => { _ = RejectSelected(); });
            _refreshButton = CreateButton(root, "BSR Refresh", "REFRESH QUEUE", new Vector2(_panelWidth * 0.246f, -_panelHeight * 0.307f), new Vector2(_panelWidth * 0.338f, _panelHeight * 0.0795f), () => { _ = RefreshQueue(); });
            var hint = CreateText(root, "DRAG TO MOVE", new Vector2(0f, -_panelHeight * 0.5f + 2.2f), new Vector2(70f, 3.5f), 1.65f, TextAlignmentOptions.Center);
            hint.color = new Color(0.34f, 0.88f, 1f, 1f);
            ApplyGrabHandleStyle();
            _lastPersistedPosition = _panel.ScreenPosition;
            _lastPersistedRotation = _panel.ScreenRotation;
            RenderQueue();
            return true;
        }

        private void CreateQueueScrollView(RectTransform root)
        {
            var viewportObject = new GameObject(
                "RiftPulse BSR Queue Viewport",
                typeof(RectTransform), typeof(Image), typeof(Mask), typeof(ScrollRect));
            var viewportRect = viewportObject.GetComponent<RectTransform>();
            viewportRect.SetParent(root, false);
            viewportRect.anchorMin = viewportRect.anchorMax = new Vector2(0.5f, 0.5f);
            viewportRect.pivot = new Vector2(0.5f, 0.5f);
            viewportRect.anchoredPosition = new Vector2(-_panelWidth * 0.24f, 0f);
            viewportRect.sizeDelta = new Vector2(_panelWidth * 0.48f, _panelHeight * 0.76f);
            var viewportImage = viewportObject.GetComponent<Image>();
            viewportImage.color = new Color(0.025f, 0.04f, 0.075f, 1f);
            viewportImage.raycastTarget = true;
            viewportObject.GetComponent<Mask>().showMaskGraphic = false;

            var contentObject = new GameObject(
                "RiftPulse BSR Queue Content",
                typeof(RectTransform), typeof(VerticalLayoutGroup), typeof(ContentSizeFitter));
            var contentRect = contentObject.GetComponent<RectTransform>();
            contentRect.SetParent(viewportRect, false);
            contentRect.anchorMin = new Vector2(0f, 1f);
            contentRect.anchorMax = new Vector2(1f, 1f);
            contentRect.pivot = new Vector2(0.5f, 1f);
            contentRect.anchoredPosition = Vector2.zero;
            contentRect.sizeDelta = new Vector2(0f, 0f);
            var layout = contentObject.GetComponent<VerticalLayoutGroup>();
            layout.spacing = 0.8f;
            layout.childControlWidth = true;
            layout.childControlHeight = false;
            layout.childForceExpandWidth = true;
            layout.childForceExpandHeight = false;
            layout.padding = new RectOffset(1, 1, 1, 1);
            var fitter = contentObject.GetComponent<ContentSizeFitter>();
            fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            _queueViewport = viewportRect;
            _queueScroll = viewportObject.GetComponent<ScrollRect>();
            _queueScroll.viewport = viewportRect;
            _queueScroll.content = contentRect;
            _queueScroll.horizontal = false;
            _queueScroll.vertical = true;
            _queueScroll.movementType = ScrollRect.MovementType.Clamped;
            _queueScroll.scrollSensitivity = 12f;
            _queueContent = contentRect;
        }

        private TextMeshProUGUI CreateText(Transform parent, string value, Vector2 position, Vector2 size, float fontSize, TextAlignmentOptions alignment)
        {
            var go = new GameObject("RiftPulse BSR Text", typeof(RectTransform), typeof(TextMeshProUGUI));
            var rect = go.GetComponent<RectTransform>();
            rect.SetParent(parent, false);
            rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.anchoredPosition = position;
            rect.sizeDelta = size;
            var text = go.GetComponent<TextMeshProUGUI>();
            var font = RiftPulseChatPanel.ResolvePanelFont();
            if (font != null) text.font = font;
            text.text = value;
            text.fontStyle = FontStyles.Bold;
            text.fontSize = fontSize * TextScale;
            text.color = new Color(0.92f, 0.95f, 1f, 1f);
            text.enableWordWrapping = true;
            text.alignment = alignment;
            text.richText = true;
            return text;
        }

        private float TextScale => Mathf.Clamp(1f / Mathf.Min(_panelWidth / 142f, _panelHeight / 88f), 1f, 1.5f);

        private void ApplyGrabHandleStyle()
        {
            if (_panel == null) return;
            _panel.ShowHandle = true;
            _panel.HighlightHandle = true;
            GameObject? handle = null;
            for (var type = _panel.GetType(); type != null && handle == null; type = type.BaseType)
            {
                var field = type.GetField("handle", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly);
                handle = field?.GetValue(_panel) as GameObject;
            }
            if (handle == null) return;
            handle.SetActive(true);
            handle.transform.localPosition = new Vector3(0f, -_panelHeight * 0.5f + 2.2f, 0f);
            handle.transform.localRotation = Quaternion.identity;
            handle.transform.localScale = Vector3.one;
            var renderer = handle.GetComponent<MeshRenderer>();
            if (renderer != null) { renderer.enabled = true; renderer.material.color = Color.white; }
            var collider = handle.GetComponent<BoxCollider>();
            if (collider == null) collider = handle.AddComponent<BoxCollider>();
            collider.center = Vector3.zero;
            collider.size = new Vector3(Mathf.Clamp(_panelWidth * 0.34f, 24f, 42f), 4.5f, 4.5f);
        }

        private void RelayoutPanel()
        {
            if (_panel == null) return;
            _panel.ScreenSize = new Vector2(_panelWidth, _panelHeight);
            if (_header != null)
            {
                var rect = _header.GetComponent<RectTransform>();
                rect.anchoredPosition = new Vector2(0f, _panelHeight * 0.5f - 5f);
                rect.sizeDelta = new Vector2(_panelWidth - 14f, 7f);
                _header.fontSize = 4.2f * TextScale;
            }
            if (_status != null)
            {
                var rect = _status.GetComponent<RectTransform>();
                rect.anchoredPosition = new Vector2(0f, -_panelHeight * 0.5f + 4f);
                rect.sizeDelta = new Vector2(_panelWidth - 14f, 4f);
                _status.fontSize = 2.0f * TextScale;
            }
            if (_detail != null)
            {
                var rect = _detail.GetComponent<RectTransform>();
                rect.anchoredPosition = new Vector2(_panelWidth * 0.246f, _panelHeight * 0.2f);
                rect.sizeDelta = new Vector2(_panelWidth * 0.408f, _panelHeight * 0.34f);
                _detail.fontSize = 2.8f * TextScale;
            }
            if (_queueViewport != null)
            {
                _queueViewport.anchoredPosition = new Vector2(-_panelWidth * 0.24f, 0f);
                _queueViewport.sizeDelta = new Vector2(_panelWidth * 0.48f, _panelHeight * 0.76f);
            }
            SetButtonLayout(_yesButton, new Vector2(_panelWidth * 0.246f, -_panelHeight * 0.045f), new Vector2(_panelWidth * 0.338f, _panelHeight * 0.102f));
            SetButtonLayout(_noButton, new Vector2(_panelWidth * 0.246f, -_panelHeight * 0.17f), new Vector2(_panelWidth * 0.338f, _panelHeight * 0.09f));
            SetButtonLayout(_refreshButton, new Vector2(_panelWidth * 0.246f, -_panelHeight * 0.307f), new Vector2(_panelWidth * 0.338f, _panelHeight * 0.0795f));
            ApplyGrabHandleStyle();
            foreach (var row in _rowButtons)
            {
                if (row == null) continue;
                var rowRect = row.GetComponent<RectTransform>();
                rowRect.sizeDelta = new Vector2(_panelWidth * 0.465f, _panelHeight * 0.102f);
                var label = row.GetComponentInChildren<TextMeshProUGUI>();
                if (label != null) label.fontSize = 2.7f * TextScale;
                var element = row.GetComponent<LayoutElement>();
                if (element != null) { element.preferredWidth = _panelWidth * 0.465f; element.preferredHeight = _panelHeight * 0.102f; }
            }
            if (_queueContent != null) LayoutRebuilder.ForceRebuildLayoutImmediate(_queueContent);
        }

        private void SetButtonLayout(Button? button, Vector2 position, Vector2 size)
        {
            if (button == null) return;
            var rect = button.GetComponent<RectTransform>();
            rect.anchoredPosition = position;
            rect.sizeDelta = size;
            var label = button.GetComponentInChildren<TextMeshProUGUI>();
            if (label != null)
            {
                label.fontSize = 2.7f * TextScale;
                label.GetComponent<RectTransform>().sizeDelta = size - new Vector2(2f, 1f);
            }
        }

        private Button CreateButton(Transform parent, string name, string label, Vector2 position, Vector2 size, Action action)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Image), typeof(Button));
            var rect = go.GetComponent<RectTransform>();
            rect.SetParent(parent, false);
            rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.anchoredPosition = position;
            rect.sizeDelta = size;
            var image = go.GetComponent<Image>();
            image.color = new Color(0.15f, 0.12f, 0.25f, 0.98f);
            var button = go.GetComponent<Button>();
            button.targetGraphic = image;
            button.onClick.AddListener(new UnityAction(() => action()));
            var labelText = CreateText(rect, label, Vector2.zero, size - new Vector2(2f, 1f), 2.7f, TextAlignmentOptions.Center);
            labelText.raycastTarget = false;
            return button;
        }

        private void SelectRequest(int index)
        {
            if (index < 0 || index >= _requests.Count) return;
            _selectedIndex = index;
            RenderQueue();
        }

        private void RenderQueue()
        {
            foreach (var button in _rowButtons)
                if (button != null) Destroy(button.gameObject);
            _rowButtons.Clear();

            if (_header != null)
                _header.text = "RIFTPULSE  /  SONG REQUESTS   •   " + _requests.Count + " WAITING";

            if (_requests.Count == 0)
            {
                if (_detail != null)
                    _detail.text = "♫  NO REQUESTS YET\n\nViewer requests from Twitch, YouTube, and TikTok will appear here.";
                SetActionButtons(false);
                if (_status != null && !_actionInProgress) _status.text = "Queue is clear  •  Waiting for viewer requests";
                return;
            }

            if (_selectedIndex < 0 || _selectedIndex >= _requests.Count) _selectedIndex = 0;
            for (var i = 0; i < _requests.Count; i++)
            {
                var item = _requests[i];
                var song = string.IsNullOrWhiteSpace(item.Song) ? "BeatSaver " + item.Key : item.Song;
                if (song.Length > 43) song = song.Substring(0, 40) + "...";
                var rowIndex = i;
                var selected = i == _selectedIndex;
                var button = CreateButton(_queueContent!, "BSR Song Row " + i,
                    (selected ? "▶  " : "♫  ") + song + "  ·  " + item.Requester,
                    Vector2.zero, new Vector2(_panelWidth * 0.465f, _panelHeight * 0.102f),
                    () => SelectRequest(rowIndex));
                var layout = button.GetComponent<LayoutElement>();
                if (layout == null) layout = button.gameObject.AddComponent<LayoutElement>();
                layout.preferredWidth = _panelWidth * 0.465f;
                layout.preferredHeight = _panelHeight * 0.102f;
                layout.flexibleWidth = 0f;
                layout.flexibleHeight = 0f;
                button.interactable = true;
                var rowLabel = button.GetComponentInChildren<TextMeshProUGUI>();
                if (rowLabel != null) { rowLabel.enableWordWrapping = false; rowLabel.fontSize = 2.7f * TextScale; rowLabel.fontStyle = FontStyles.Bold; }
                var image = button.GetComponent<Image>();
                if (image != null)
                    image.color = selected ? new Color(0.28f, 0.18f, 0.48f, 1f) : new Color(0.09f, 0.13f, 0.22f, 0.98f);
                _rowButtons.Add(button);
            }

            var selectedRequest = _requests[_selectedIndex];
            if (_detail != null)
            {
                _detail.text = "♫  SELECTED REQUEST\n\n<b>" + Escape(selectedRequest.Song, 90) +
                    "</b>\n\nREQUESTED BY\n" + Escape(selectedRequest.Requester, 40) +
                    "\n\nPLATFORM  /  " + Escape(selectedRequest.Provider.ToUpperInvariant(), 18) +
                    "\nMAP KEY  /  " + Escape(selectedRequest.Key, 18) +
                    "\n\nYES downloads and adds it to Custom Levels. NO removes the request.";
            }
            SetActionButtons(!_actionInProgress);
            if (_status != null && !_actionInProgress)
                _status.text = _requests.Count + (_requests.Count == 1 ? " request in queue" : " requests in queue") +
                    "  •  Scroll the list to browse";
            if (_queueContent != null) LayoutRebuilder.ForceRebuildLayoutImmediate(_queueContent);
        }

        private void SetActionButtons(bool enabled)
        {
            if (_yesButton != null) _yesButton.interactable = enabled;
            if (_noButton != null) _noButton.interactable = enabled;
        }

        private async Task RefreshQueue()
        {
            if (_polling || _panel == null) return;
            _polling = true;
            try
            {
                using (var request = new HttpRequestMessage(HttpMethod.Get, ApiBase + "/device/song-requests"))
                {
                    request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", RiftPulsePairingViewController.DeviceCredential);
                    using (var response = await Http.SendAsync(request).ConfigureAwait(false))
                    {
                        var payload = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                        if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Queue unavailable (HTTP " + (int)response.StatusCode + ").");
                        var arrayStart = payload.IndexOf("\"requests\"", StringComparison.Ordinal);
                        arrayStart = arrayStart < 0 ? -1 : payload.IndexOf('[', arrayStart);
                        var arrayEnd = FindArrayEnd(payload, arrayStart);
                        if (arrayEnd < 0) throw new InvalidOperationException("Queue response could not be read.");
                        var next = new List<SongRequest>();
                        var cursor = arrayStart + 1;
                        while (cursor < arrayEnd)
                        {
                            while (cursor < arrayEnd && (char.IsWhiteSpace(payload[cursor]) || payload[cursor] == ',')) cursor++;
                            if (cursor >= arrayEnd) break;
                            if (payload[cursor] != '{') { cursor++; continue; }
                            var objectEnd = FindObjectEnd(payload, cursor);
                            if (objectEnd < 0 || objectEnd > arrayEnd) break;
                            var json = payload.Substring(cursor, objectEnd - cursor + 1);
                            cursor = objectEnd + 1;
                            var item = new SongRequest {
                                Id = ReadString(json, "id"), Key = ReadString(json, "beatsaverKey"),
                                Song = ReadString(json, "songName"), Requester = ReadString(json, "requesterName"),
                                Provider = ReadString(json, "provider"), Status = ReadString(json, "status")
                            };
                            if (!string.IsNullOrEmpty(item.Id)) next.Add(item);
                        }
                        var selectedId = _selectedIndex >= 0 && _selectedIndex < _requests.Count
                            ? _requests[_selectedIndex].Id : "";
                        MainThread(() =>
                        {
                            _requests.Clear();
                            _requests.AddRange(next);
                            _selectedIndex = string.IsNullOrEmpty(selectedId)
                                ? (_requests.Count > 0 ? 0 : -1)
                                : _requests.FindIndex(item => item.Id == selectedId);
                            if (_selectedIndex < 0 && _requests.Count > 0) _selectedIndex = 0;
                            RenderQueue();
                        });
                    }
                }
            }
            catch (Exception ex)
            {
                var message = ex.Message;
                MainThread(() => { if (_status != null) _status.text = message; });
            }
            finally { _polling = false; }
        }

        private async Task ApproveSelected()
        {
            if (_actionInProgress || _selectedIndex < 0 || _selectedIndex >= _requests.Count) return;
            var item = _requests[_selectedIndex];
            _actionInProgress = true;
            MainThread(() => { SetActionButtons(false); if (_status != null) _status.text = "Downloading " + item.Song + "..."; });
            try
            {
                await DownloadAndInstall(item).ConfigureAwait(false);
                await UpdateRequestStatus(item.Id, "downloaded").ConfigureAwait(false);
                MainThread(() =>
                {
                    if (_status != null) _status.text = "Downloaded to Custom Levels. Open Solo → Custom Levels to play it.";
                    _requests.RemoveAll(value => value.Id == item.Id);
                    _selectedIndex = Math.Min(_selectedIndex, _requests.Count - 1);
                    RenderQueue();
                });
            }
            catch (Exception ex)
            {
                var message = "Download failed: " + ex.Message;
                MainThread(() => { if (_status != null) _status.text = message; });
            }
            finally { _actionInProgress = false; MainThread(() => { SetActionButtons(_requests.Count > 0); }); }
        }

        private async Task RejectSelected()
        {
            if (_actionInProgress || _selectedIndex < 0 || _selectedIndex >= _requests.Count) return;
            var item = _requests[_selectedIndex];
            _actionInProgress = true;
            SetActionButtons(false);
            try
            {
                await UpdateRequestStatus(item.Id, "rejected").ConfigureAwait(false);
                MainThread(() =>
                {
                    _requests.RemoveAll(value => value.Id == item.Id);
                    _selectedIndex = Math.Min(_selectedIndex, _requests.Count - 1);
                    if (_status != null) _status.text = "Request removed from the queue.";
                    RenderQueue();
                });
            }
            catch (Exception ex) { MainThread(() => { if (_status != null) _status.text = "Could not remove request: " + ex.Message; }); }
            finally { _actionInProgress = false; MainThread(() => SetActionButtons(_requests.Count > 0)); }
        }

        private async Task UpdateRequestStatus(string id, string status)
        {
            var json = "{\"status\":\"" + status + "\"}";
            using (var request = new HttpRequestMessage(new HttpMethod("PATCH"), ApiBase + "/device/song-requests/" + id))
            {
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", RiftPulsePairingViewController.DeviceCredential);
                request.Content = new StringContent(json, Encoding.UTF8, "application/json");
                using (var response = await Http.SendAsync(request).ConfigureAwait(false))
                {
                    if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Queue update returned HTTP " + (int)response.StatusCode + ".");
                }
            }
        }

        private async Task DownloadAndInstall(SongRequest item)
        {
            if (!Regex.IsMatch(item.Key, "^[a-fA-F0-9]{5,8}$")) throw new InvalidOperationException("This request does not contain a valid BeatSaver map key.");
            var metadata = await Http.GetStringAsync("https://api.beatsaver.com/maps/id/" + Uri.EscapeDataString(item.Key)).ConfigureAwait(false);
            var urlMatch = Regex.Match(metadata, "\"downloadURL\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])+)\"");
            if (!urlMatch.Success) throw new InvalidOperationException("BeatSaver did not provide a download link.");
            var downloadUrl = ReadJsonString(urlMatch.Groups[1].Value);
            if (!Uri.TryCreate(downloadUrl, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps ||
                !(uri.Host.Equals("cdn.beatsaver.com", StringComparison.OrdinalIgnoreCase) ||
                  uri.Host.EndsWith(".beatsaver.com", StringComparison.OrdinalIgnoreCase)))
                throw new InvalidOperationException("BeatSaver returned an untrusted download host.");

            var bytes = await Http.GetByteArrayAsync(uri).ConfigureAwait(false);
            if (bytes.LongLength < 100 || bytes.LongLength > MaxDownloadBytes) throw new InvalidOperationException("The map archive has an unexpected size.");
            var safeName = Regex.Replace(item.Song ?? "BeatSaver Map", "[^a-zA-Z0-9 _-]", "").Trim();
            if (safeName.Length > 42) safeName = safeName.Substring(0, 42);
            if (safeName.Length == 0) safeName = "BeatSaver Map";
            var customLevels = Path.Combine(Application.dataPath, "CustomLevels");
            Directory.CreateDirectory(customLevels);
            var destination = Path.Combine(customLevels, item.Key + " (" + safeName + ")");
            var root = Path.GetFullPath(destination) + Path.DirectorySeparatorChar;
            if (Directory.Exists(destination) &&
                !File.Exists(Path.Combine(destination, "Info.dat")) &&
                !File.Exists(Path.Combine(destination, "info.dat")))
            {
                Directory.Delete(destination, true);
            }
            if (!Directory.Exists(destination))
            {
                Directory.CreateDirectory(destination);
                try
                {
                    using (var memory = new MemoryStream(bytes, false))
                    using (var archive = new ZipArchive(memory, ZipArchiveMode.Read, false))
                    {
                        long expandedBytes = 0;
                        foreach (var entry in archive.Entries)
                        {
                            var relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                            if (Path.IsPathRooted(relative) ||
                                relative.Split(Path.DirectorySeparatorChar).Any(part => part == ".." || part == "."))
                                throw new InvalidDataException("The BeatSaver archive contains an unsafe file path.");
                            expandedBytes += entry.Length;
                            if (expandedBytes > MaxExpandedBytes)
                                throw new InvalidDataException("The extracted song exceeds the 700 MB safety limit.");
                            var target = Path.GetFullPath(Path.Combine(destination, relative));
                            if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                                throw new InvalidDataException("The BeatSaver archive contains an unsafe file path.");
                            if (string.IsNullOrEmpty(entry.Name))
                            {
                                Directory.CreateDirectory(target);
                                continue;
                            }
                            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                            using (var input = entry.Open())
                            using (var output = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None))
                                await input.CopyToAsync(output).ConfigureAwait(false);
                        }
                    }

                    var infoPath = File.Exists(Path.Combine(destination, "Info.dat"))
                        ? Path.Combine(destination, "Info.dat")
                        : File.Exists(Path.Combine(destination, "info.dat"))
                            ? Path.Combine(destination, "info.dat")
                            : Directory.GetFiles(destination, "Info.dat", SearchOption.AllDirectories)
                                .Concat(Directory.GetFiles(destination, "info.dat", SearchOption.AllDirectories))
                                .FirstOrDefault();
                    if (string.IsNullOrEmpty(infoPath))
                        throw new InvalidDataException("The BeatSaver archive does not contain an Info.dat file.");
                    var songRoot = Path.GetDirectoryName(infoPath)!;
                    if (!string.Equals(songRoot, destination, StringComparison.OrdinalIgnoreCase))
                    {
                        foreach (var file in Directory.GetFiles(songRoot, "*", SearchOption.TopDirectoryOnly))
                        {
                            var target = Path.Combine(destination, Path.GetFileName(file));
                            if (File.Exists(target)) throw new InvalidDataException("The archive contains duplicate song files.");
                            File.Move(file, target);
                        }
                        foreach (var folder in Directory.GetDirectories(songRoot, "*", SearchOption.TopDirectoryOnly))
                        {
                            var target = Path.Combine(destination, Path.GetFileName(folder));
                            if (Directory.Exists(target)) throw new InvalidDataException("The archive contains duplicate song folders.");
                            Directory.Move(folder, target);
                        }
                    }
                }
                catch
                {
                    try { if (Directory.Exists(destination)) Directory.Delete(destination, true); } catch { }
                    throw;
                }
            }
            MainThread(TryRefreshSongCore);
        }

        private static void TryRefreshSongCore()
        {
            try
            {
                var assembly = AppDomain.CurrentDomain.GetAssemblies()
                    .FirstOrDefault(a => a.GetName().Name == "SongCore");
                var loader = assembly?.GetType("SongCore.Loader", false);
                var instance = loader?.GetProperty("Instance", BindingFlags.Public | BindingFlags.Static)
                    ?.GetValue(null, null);
                var refresh = loader?.GetMethod("RefreshSongs", new[] { typeof(bool) });
                if (instance != null && refresh != null)
                    refresh.Invoke(instance, new object[] { false });
            }
            catch (Exception exception)
            {
                Debug.LogWarning("[RiftPulse] SongCore refresh failed; the installed map remains on disk: " + exception.Message);
            }
        }

        private static void MainThread(Action action)
        {
            if (_instance != null) _instance._pendingUi.Enqueue(action);
        }

        private readonly System.Collections.Concurrent.ConcurrentQueue<Action> _pendingUi = new System.Collections.Concurrent.ConcurrentQueue<Action>();

        private void LateUpdate()
        {
            while (_pendingUi.TryDequeue(out var action))
            {
                try { action(); } catch { }
            }
        }

        private static int FindArrayEnd(string json, int start)
        {
            if (start < 0 || start >= json.Length || json[start] != '[') return -1;
            var depth = 0; var inString = false; var escaped = false;
            for (var i = start; i < json.Length; i++)
            {
                var ch = json[i];
                if (inString) { if (escaped) escaped = false; else if (ch == '\\') escaped = true; else if (ch == '"') inString = false; continue; }
                if (ch == '"') inString = true; else if (ch == '[') depth++; else if (ch == ']' && --depth == 0) return i;
            }
            return -1;
        }

        private static int FindObjectEnd(string json, int start)
        {
            if (start < 0 || start >= json.Length || json[start] != '{') return -1;
            var depth = 0; var inString = false; var escaped = false;
            for (var i = start; i < json.Length; i++)
            {
                var ch = json[i];
                if (inString) { if (escaped) escaped = false; else if (ch == '\\') escaped = true; else if (ch == '"') inString = false; continue; }
                if (ch == '"') inString = true; else if (ch == '{') depth++; else if (ch == '}' && --depth == 0) return i;
            }
            return -1;
        }

        private static string ReadString(string json, string key)
        {
            var match = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
            return match.Success ? ReadJsonString(match.Groups[1].Value) : "";
        }

        private static string ReadJsonString(string value)
        {
            return value.Replace("\\n", " ").Replace("\\r", " ").Replace("\\t", " ")
                .Replace("\\\"", "\"").Replace("\\\\", "\\");
        }

        private static string Escape(string value, int max)
        {
            if (value == null) return "";
            if (value.Length > max) value = value.Substring(0, max);
            return value.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;")
                .Replace("\r", " ").Replace("\n", " ");
        }

        private void DestroyPanel()
        {
            if (_panel != null) Destroy(_panel.gameObject);
            _panel = null;
            _header = null;
            _detail = null;
            _status = null;
            _queueContent = null;
            _queueViewport = null;
            _queueScroll = null;
            _yesButton = null;
            _noButton = null;
            _refreshButton = null;
            _rowButtons.Clear();
        }
    }
}
