import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity, ArrowDown, ArrowDownRight, ArrowRight, ArrowUpRight, AudioLines, Bell, Check, ChevronDown,
  CircleHelp, Command, Download, ExternalLink, Gamepad2, Headphones, LayoutDashboard,
  Link2, LockKeyhole, LogOut, MessageCircle, Monitor, MoreHorizontal, Music2,
  Plus, Radio, RefreshCw, Settings2, ShieldCheck, SlidersHorizontal, Sparkles,
  Unplug, Users, WandSparkles, X, Zap,
} from "lucide-react";

type User = { id: string; name: string; email: string };
type ReleaseUpdate = { id: string; title: string; category: "website" | "mod" | "both"; version: string | null; summary: string; changes: string[]; publishedAt: string; isRead: boolean };
type Device = { id: string; platform: "pcvr" | "quest"; gameVersion: string; modVersion: string; label: string | null; createdAt: string; lastSeenAt: string | null };
type ChatMessage = { id: string; provider: ProviderKey; senderName: string; text: string; receivedAt: string; badges: { moderator: boolean; subscriber: boolean; verified: boolean } };
type ProviderState = "connected" | "disconnected" | "degraded" | "error" | "unsupported";
type ProviderHealth = { provider: ProviderKey; state: ProviderState; viewerCount: number | null; detailCode: string | null; unofficial: boolean };
type ProviderConnection = { status: string; displayName: string | null; connectedAt: string | null; configured: boolean; detailCode: string | null };
type ViewerAggregate = { total: number | null; includedProviders: ProviderKey[]; missingProviders: ProviderKey[]; partial: boolean };
type ModuleKey = "chat" | "bsr-song-request";
type ProviderKey = "twitch" | "youtube" | "tiktok";
type Provider = { key: ProviderKey; name: string; short: string; className: string; note: string };
const providers: Provider[] = [
  { key: "twitch", name: "Twitch", short: "T", className: "twitch", note: "Live chat + viewers" },
  { key: "youtube", name: "YouTube", short: "▶", className: "youtube", note: "Live chat + viewers" },
  { key: "tiktok", name: "TikTok LIVE", short: "♪", className: "tiktok", note: "Unofficial · best effort" },
];
type ProviderEventPayload = {
  id: string; provider: ProviderKey; kind: string; actorName: string | null;
  itemName: string | null; quantity: number | null; amount: number | null;
  currency: string | null; message: string | null; receivedAt: string;
};

function providerEventAsChatMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Partial<ProviderEventPayload>;
  if (event.kind === "viewer_count") return null;
  if (typeof event.id !== "string" || typeof event.provider !== "string"
    || !providers.some(provider => provider.key === event.provider)
    || typeof event.kind !== "string" || typeof event.receivedAt !== "string") return null;
  const actor = typeof event.actorName === "string" && event.actorName ? event.actorName : "Stream event";
  let description: string;
  switch (event.kind) {
    case "follow": description = "followed the channel"; break;
    case "subscription": description = "subscribed"; break;
    case "gift": description = "sent " + (typeof event.quantity === "number" && event.quantity > 1 ? event.quantity + " × " : "") + (event.itemName || "a gift"); break;
    case "bits": description = "cheered " + (event.amount ?? event.quantity ?? "") + " Bits"; break;
    case "super_chat": description = "sent a Super Chat" + (event.amount !== null && event.amount !== undefined ? " (" + (event.currency ? event.currency + " " : "") + event.amount + ")" : ""); break;
    case "donation": description = "donated " + (event.currency ? event.currency + " " : "") + (event.amount ?? "an amount not provided"); break;
    case "like": description = "liked the stream"; break;
    case "share": description = "shared the stream"; break;
    case "raid": description = "raided the channel"; break;
    case "member_join": description = "joined the stream"; break;
    case "viewer_count": return null;
    default: description = "triggered " + event.kind;
  }
  if (event.message) description += ": " + event.message;
  return {
    id: event.id, provider: event.provider as ProviderKey, senderName: actor,
    text: description.slice(0, 500), receivedAt: event.receivedAt,
    badges: { moderator: false, subscriber: event.kind === "subscription", verified: false },
  };
}

const initialEnabled: Record<ModuleKey, boolean> = { chat: true, "bsr-song-request": true };

const onboardingSteps = [
  { title: "Welcome to RiftPulse", description: "This quick tour shows you where everything lives. You can skip it now and replay it any time from the question-mark Support button.", target: null },
  { title: "Your stream at a glance", description: "The overview shows connected platforms, paired devices, enabled modules, and viewer totals when fresh counts are available.", target: "overview" },
  { title: "Your modules", description: "Chat brings supported platform messages into one experience. BSR Song Request lets viewers request Beat Saber tracks with your chosen chat command. Use the module cards to open their settings.", target: "modules" },
  { title: "Install the Beat Saber mod", description: "Choose the correct package for your setup: PCVR ZIP for the PC version, or Quest QMOD for standalone. Follow the installation notes on each card.", target: "downloads" },
  { title: "Connect your platforms", description: "Choose Connect beside Twitch, YouTube, or TikTok LIVE, then follow the authorization or account setup steps. Some platforms need an extra setup action after connecting.", target: "integrations" },
  { title: "Chat & Events", description: "This is where recent messages and supported stream events appear. Provider health and viewer counts help you see which connections are reporting data.", target: "chat-feed" },
  { title: "Pair your Beat Saber device", description: "Open RiftPulse in Beat Saber, choose Connect to website, and enter the five-digit code shown in-game. You can manage paired devices here afterward.", target: "devices" },
  { title: "Tune your preferences", description: "Open Settings in the left navigation to adjust module preferences and your BSR command. Changes to module toggles are saved to your account.", target: "settings" },
  { title: "Your guide is always here", description: "Finished! Select the round question-mark Support button whenever you want to run this walkthrough again.", target: "support" },
] as const;

function App() {
  const [activeTab, setActiveTab] = useState("Overview");
  const [enabled, setEnabled] = useState(initialEnabled);
  const [providerConnections, setProviderConnections] = useState<Record<ProviderKey, ProviderConnection>>({
    twitch: { status: "disconnected", displayName: null, connectedAt: null, configured: false, detailCode: "oauth_credentials_not_configured" },
    youtube: { status: "disconnected", displayName: null, connectedAt: null, configured: false, detailCode: null },
    tiktok: { status: "disconnected", displayName: null, connectedAt: null, configured: false, detailCode: "unofficial_connector_not_configured" },
  });
  const [twitchEventSubAutoAttempted, setTwitchEventSubAutoAttempted] = useState(false);
  const [modal, setModal] = useState<"pair" | "provider" | "settings" | "help" | "auth" | null>(null);
  const [pairCode, setPairCode] = useState("");
  const [pairStatus, setPairStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [selectedProvider, setSelectedProvider] = useState<ProviderKey>("twitch");
  const [tiktokUsername, setTiktokUsername] = useState("");
  const [tiktokSaving, setTiktokSaving] = useState(false);
  const [tiktokAccountId, setTiktokAccountId] = useState("");
  const [notice, setNotice] = useState("");
  const [command, setCommand] = useState("!bsr");
  const [autoSave, setAutoSave] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [updates, setUpdates] = useState<ReleaseUpdate[]>([]);
  const [updatesLoading, setUpdatesLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState<"checking" | "online" | "offline">("checking");
  const [user, setUser] = useState<User | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup" | "request-reset" | "reset-password">("signin");
  const [resetToken, setResetToken] = useState("");
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authSuccessMessage, setAuthSuccessMessage] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(true);
  const [chatError, setChatError] = useState(false);
  const [providerHealth, setProviderHealth] = useState<ProviderHealth[]>([]);
  const [viewerAggregate, setViewerAggregate] = useState<ViewerAggregate | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [tourCompleted, setTourCompleted] = useState(false);
  const [tourSaving, setTourSaving] = useState(false);
  const [tourTargetRect, setTourTargetRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  const refreshChat = useCallback(async (): Promise<number> => {
    // YouTube is polled using the interval returned by liveChatMessages.list.
    // When it is disconnected, offline, or unavailable, back off to 30 seconds.
    let pollAfterMs = 30_000;
    try {
      const pollResponse = await fetch("/api/v1/providers/youtube/poll", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}",
      }).catch(() => null);
      if (pollResponse?.ok) {
        const pollData = await pollResponse.json().catch(() => ({}));
        if (typeof pollData.pollAfterMs === "number" && Number.isFinite(pollData.pollAfterMs)) {
          pollAfterMs = Math.max(5_000, Math.min(300_000, pollData.pollAfterMs));
        }
      }
      const response = await fetch("/api/v1/chat/messages", { credentials: "include" });
      if (!response.ok) throw new Error("Could not load chat messages");
      const data = await response.json();
      setChatMessages(Array.isArray(data.messages) ? data.messages : []);
      setChatError(false);
    } catch {
      setChatError(true);
    } finally {
      setChatLoading(false);
    }
    return pollAfterMs;
  }, []);

  const refreshProviderConnections = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/providers/connections", { credentials: "include" });
      if (!response.ok) throw new Error("Could not load provider connections");
      const data = await response.json();
      if (!Array.isArray(data.connections)) throw new Error("Invalid provider connection response");
      setProviderConnections(current => {
        const next = { ...current };
        for (const row of data.connections) {
          if (row && typeof row.provider === "string" && Object.hasOwn(next, row.provider)) {
            next[row.provider as ProviderKey] = {
              status: typeof row.status === "string" ? row.status : "error",
              displayName: typeof row.displayName === "string" ? row.displayName : null,
              connectedAt: typeof row.connectedAt === "string" ? row.connectedAt : null,
              configured: row.configured === true,
              detailCode: typeof row.detailCode === "string" ? row.detailCode : null,
            };
          }
        }
        return next;
      });
    } catch {
      // Keep the last confirmed connection state; never invent a connected state.
    }
  }, []);

  const refreshProviderHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/integrations/health", { credentials: "include" });
      if (!response.ok) throw new Error("Could not load provider health");
      const data = await response.json();
      setProviderHealth(Array.isArray(data.providers) ? data.providers : []);
      setViewerAggregate(data.viewers ?? null);
    } catch {
      setProviderHealth([]);
      setViewerAggregate(null);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    const response = await fetch("/api/v1/devices", { credentials: "include" });
    if (response.ok) {
      const data = await response.json();
      setDevices(Array.isArray(data.devices) ? data.devices : []);
    }
  }, []);

  const refreshUpdates = useCallback(async () => {
    setUpdatesLoading(true);
    try {
      const response = await fetch("/api/v1/updates", { credentials: "include" });
      if (!response.ok) throw new Error("Could not load release updates");
      const data = await response.json();
      setUpdates(Array.isArray(data.updates) ? data.updates : []);
    } catch {
      // Keep the last successfully loaded release history visible.
    } finally {
      setUpdatesLoading(false);
    }
  }, []);

  const markUpdatesRead = async () => {
    if (!updates.some(update => !update.isRead)) return;
    try {
      const response = await fetch("/api/v1/updates/read", { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error("Could not mark updates as read");
      setUpdates(current => current.map(update => ({ ...update, isRead: true })));
    } catch {
      flash("Could not mark updates as read. Please try again.");
    }
  };

  useEffect(() => {
    // Keep a live device class for responsive layout and touch-friendly controls.
    const mobileQuery = window.matchMedia("(max-width: 760px), (pointer: coarse) and (max-width: 900px)");
    const updateDeviceClass = () => {
      document.documentElement.classList.toggle("is-mobile-device", mobileQuery.matches);
      document.documentElement.classList.toggle("is-desktop-device", !mobileQuery.matches);
      document.documentElement.dataset.device = mobileQuery.matches ? "mobile" : "desktop";
    };
    updateDeviceClass();
    mobileQuery.addEventListener("change", updateDeviceClass);
    return () => mobileQuery.removeEventListener("change", updateDeviceClass);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const segments = window.location.pathname.split("/").filter(Boolean);
    const resetPathIndex = segments.findIndex(segment => segment.toLowerCase() === "reset-password");
    const pathToken = resetPathIndex >= 0 ? segments[resetPathIndex + 1] : null;
    const token = params.get("token") ?? (pathToken ? decodeURIComponent(pathToken) : null);
    if (params.get("error") === "INVALID_TOKEN") {
      setAuthMode("request-reset");
      setAuthError("That reset link is expired or has already been used. Request a new one.");
      window.history.replaceState({}, "", "/");
    } else if (token) {
      setResetToken(token);
      setAuthMode("reset-password");
      setAuthEmail(params.get("email") ?? "");
    }
  }, []);

  useEffect(() => {
    fetch("/api/auth/get-session", { credentials: "include" })
      .then(response => response.ok ? response.json() : null)
      .then(data => setUser(data?.user ? data.user as User : null))
      .catch(() => setUser(null))
      .finally(() => setAuthLoaded(true));
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setTourOpen(false);
      setTourCompleted(false);
      return;
    }
    let active = true;
    let autoOpenTimer: number | undefined;
    fetch("/api/v1/onboarding", { credentials: "include" })
      .then(response => response.ok ? response.json() : Promise.reject(new Error("Onboarding status unavailable")))
      .then(data => {
        if (!active) return;
        const completed = data?.completed === true;
        setTourCompleted(completed);
        if (!completed) {
          setTourStep(0);
          autoOpenTimer = window.setTimeout(() => { if (active) setTourOpen(true); }, 650);
        }
      })
      .catch(() => {
        // If account preferences cannot be reached, do not interrupt the dashboard.
        // The user can still launch the guide manually from Support.
      });
    return () => { active = false; if (autoOpenTimer !== undefined) window.clearTimeout(autoOpenTimer); };
  }, [user?.id]);

  useEffect(() => {
    if (!tourOpen) { setTourTargetRect(null); return; }
    const step = onboardingSteps[tourStep];
    if (!step?.target) { setTourTargetRect(null); return; }
    const target = document.querySelector<HTMLElement>(`[data-tour-target="${step.target}"]`);
    if (!target) { setTourTargetRect(null); return; }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center", inline: "nearest" });
    const previous = {
      position: target.style.position,
      zIndex: target.style.zIndex,
      boxShadow: target.style.boxShadow,
      borderRadius: target.style.borderRadius,
      outline: target.style.outline,
    };
    target.style.position = target.style.position || "relative";
    target.style.zIndex = "10002";
    target.style.boxShadow = "0 0 0 3px #b59aff, 0 0 34px #a78bfa66, 0 0 0 100vmax rgba(3,5,12,.76)";
    target.style.borderRadius = target.style.borderRadius || "12px";
    target.style.outline = "1px solid rgba(207,190,255,.75)";
    let timer = 0;
    const update = () => {
      const rect = target.getBoundingClientRect();
      setTourTargetRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };
    timer = window.setTimeout(update, reduceMotion ? 0 : 420);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      target.style.position = previous.position;
      target.style.zIndex = previous.zIndex;
      target.style.boxShadow = previous.boxShadow;
      target.style.borderRadius = previous.borderRadius;
      target.style.outline = previous.outline;
    };
  }, [tourOpen, tourStep]);

  useEffect(() => {
    if (!user?.id) return;
    fetch("/api/v1/settings/modules", { credentials: "include" })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (data?.modules) {
          setEnabled({
            chat: !!data.modules.chat?.enabled,
            "bsr-song-request": !!data.modules["bsr-song-request"]?.enabled,
          });
          const savedCommand = data.modules["bsr-song-request"]?.settings?.command;
          if (typeof savedCommand === "string" && savedCommand.startsWith("!") && savedCommand.length <= 20) setCommand(savedCommand);
        }
      }).catch(() => {});
    refreshDevices().catch(() => {});
    void refreshProviderHealth();
    void refreshProviderConnections();
    void refreshUpdates();
  }, [user?.id, refreshDevices, refreshProviderHealth, refreshProviderConnections, refreshUpdates]);

  // Keep YouTube chat and stream events flowing while the Chat module is enabled.
  // Respect the pollingIntervalMillis-derived delay from YouTube and pause while hidden.
  useEffect(() => {
    if (!user?.id || !enabled.chat) return;
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      if (document.visibilityState === "hidden") {
        if (!disposed) timer = window.setTimeout(() => void poll(), 30_000);
        return;
      }
      const delay = await refreshChat();
      if (!disposed) timer = window.setTimeout(() => void poll(), delay);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (timer !== undefined) window.clearTimeout(timer);
      void poll();
    };
    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [user?.id, enabled.chat, refreshChat]);

  useEffect(() => {
    if (!user?.id) return;
    const refreshProviderStatus = () => {
      void refreshProviderConnections();
      void refreshProviderHealth();
    };
    const timer = window.setInterval(refreshProviderStatus, 5000);
    window.addEventListener("focus", refreshProviderStatus);
    document.addEventListener("visibilitychange", refreshProviderStatus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshProviderStatus);
      document.removeEventListener("visibilitychange", refreshProviderStatus);
    };
  }, [user?.id, refreshProviderConnections, refreshProviderHealth]);

  // Automatically subscribe once a Twitch OAuth connection is persisted. This
  // also retries setup for already-connected accounts with pending/failed health.
  useEffect(() => {
    if (!user?.id) {
      setTwitchEventSubAutoAttempted(false);
      return;
    }
    const twitch = providerConnections.twitch;
    if (twitch.status !== "connected"
      || (twitch.detailCode !== "eventsub_subscription_pending" && twitch.detailCode !== "eventsub_subscription_failed")
      || twitchEventSubAutoAttempted) return;

    setTwitchEventSubAutoAttempted(true);
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/v1/providers/twitch/eventsub/subscribe", {
          method: "POST", credentials: "include",
          headers: { "content-type": "application/json" }, body: "{}",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error?.message ?? "EventSub setup was rejected.");
        await refreshProviderConnections();
        await refreshProviderHealth();
        if (active) flash(data.status === "subscribed"
          ? "Twitch EventSub is enabled. Chat and stream events are subscribed."
          : "Twitch EventSub subscriptions were requested. Waiting for Twitch webhook verification.");
      } catch (error) {
        if (active) flash(error instanceof Error ? error.message : "Could not enable Twitch EventSub.");
      }
    })();
    return () => { active = false; };
  }, [user?.id, providerConnections.twitch.status, providerConnections.twitch.detailCode,
      twitchEventSubAutoAttempted, refreshProviderConnections, refreshProviderHealth]);

  useEffect(() => {
    if (!user?.id || !enabled.chat) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let attempts = 0;

    const connect = () => {
      if (disposed) return;
      const endpoint = new URL("/api/v1/realtime", window.location.href);
      endpoint.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(endpoint);
      socket.onopen = () => { attempts = 0; };
      socket.onmessage = event => {
        try {
          const payload = JSON.parse(String(event.data));
          const message: ChatMessage | null = payload?.type === "chat.message"
            ? payload.message as ChatMessage
            : payload?.type === "provider.event" ? providerEventAsChatMessage(payload.event) : null;
          if (!message || typeof message.id !== "string" || typeof message.text !== "string"
            || typeof message.senderName !== "string" || !providers.some(provider => provider.key === message.provider)) return;
          setChatMessages(current => [...current.filter(item => item.id !== message.id), message].slice(-100));
          setChatError(false);
        } catch {
          // Ignore malformed frames; chat history remains available via the API.
        }
      };
      socket.onclose = () => {
        if (disposed) return;
        const delay = Math.min(30_000, 1000 * (2 ** Math.min(attempts, 5)));
        attempts++;
        reconnectTimer = window.setTimeout(connect, delay);
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [user?.id, enabled.chat]);

  // Poll durable chat history as a fallback so messages still appear if realtime delivery is interrupted.
  useEffect(() => {
    if (!user?.id || !enabled.chat) return;
    let active = true;
    let loading = false;
    const refreshStoredChat = async () => {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch("/api/v1/chat/messages", { credentials: "include" });
        if (!response.ok) return;
        const data = await response.json();
        if (!active || !Array.isArray(data.messages)) return;
        setChatMessages(current => {
          const byId = new Map<string, ChatMessage>();
          for (const message of current) byId.set(message.id, message);
          for (const message of data.messages as ChatMessage[]) {
            if (message && typeof message.id === "string") byId.set(message.id, message);
          }
          return [...byId.values()].slice(-100);
        });
        setChatError(false);
      } catch {
        // Realtime remains available; a later poll will retry history retrieval.
      } finally {
        loading = false;
      }
    };
    const timer = window.setInterval(() => { void refreshStoredChat(); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [user?.id, enabled.chat]);
  useEffect(() => {
    let alive = true;
    fetch("/api/v1/health").then(r => { if (!r.ok) throw new Error("API unavailable"); return r.json(); })
      .then(() => { if (alive) setApiStatus("online"); })
      .catch(() => { if (alive) setApiStatus("offline"); });
    return () => { alive = false; };
  }, []);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  };

  const startTour = () => {
    setModal(null);
    setProfileOpen(false);
    setUpdatesOpen(false);
    setTourStep(0);
    setTourOpen(true);
  };

  const finishTour = async () => {
    if (tourSaving) return;
    setTourSaving(true);
    try {
      const response = await fetch("/api/v1/onboarding", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ completed: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message ?? "Could not save your guide progress.");
      setTourCompleted(true);
      setTourOpen(false);
      setTourStep(0);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not save your guide progress.");
    } finally {
      setTourSaving(false);
    }
  };

  const advanceTour = () => {
    if (tourStep >= onboardingSteps.length - 1) void finishTour();
    else setTourStep(current => Math.min(current + 1, onboardingSteps.length - 1));
  };

  const useTourBack = () => setTourStep(current => Math.max(0, current - 1));

  useEffect(() => {
    if (!authLoaded) return;
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("provider");
    const status = params.get("status");
    const reason = params.get("reason");
    if ((provider !== "twitch" && provider !== "youtube") || !status) return;

    setActiveTab("Integrations");
    if (status === "connected" && !user?.id) {
      flash(provider + " returned from authorization, but RiftPulse could not confirm your sign-in. Sign in again and reconnect.");
    } else if (status === "connected") {
      flash(provider === "twitch" ? "Twitch connected. RiftPulse is enabling EventSub chat and events automatically." : "YouTube connected. Live chat and supported events will poll automatically while Chat is enabled and the channel is live.");
    } else if (status === "denied") {
      flash(provider + " authorization was canceled.");
    } else if (provider === "twitch") {
      const messages: Record<string, string> = {
        state_invalid_or_expired: "Twitch returned an expired or invalid authorization attempt. Start Connect Twitch again.",
        authorization_code_missing: "Twitch did not return an authorization code. Start Connect Twitch again.",
        token_exchange_failed: "Twitch accepted the login, but its token exchange failed. Try connecting again.",
        token_response_invalid: "Twitch returned an incomplete token response. Try connecting again.",
        token_validation_failed: "Twitch could not validate the returned account token. Try connecting again.",
        scope_mismatch: "Twitch did not grant every permission RiftPulse needs for chat and events.",
        token_persistence_failed: "Twitch authorized RiftPulse, but the encrypted connection could not be saved.",
        storage_failed: "RiftPulse could not verify or save the Twitch authorization state.",
      };
      flash(messages[reason ?? ""] ?? "Twitch connection could not be completed. Check the latest RiftPulse callback diagnostic.");
    } else {
      flash(provider + " connection could not be completed. No token details were shown.");
    }

    window.history.replaceState({}, "", `${window.location.pathname}#integrations`);
    if (user?.id) {
      void refreshProviderConnections();
      void refreshProviderHealth();
      void refreshChat();
    }
    window.requestAnimationFrame(() => {
      document.getElementById("integrations")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [authLoaded, user?.id, refreshProviderConnections, refreshProviderHealth, refreshChat]);

  const toggleModule = async (key: ModuleKey) => {
    const previous = enabled[key];
    const next = !previous;
    setEnabled(current => ({ ...current, [key]: next }));
    try {
      const response = await fetch(`/api/v1/settings/modules/${key}`, {
        method: "PATCH", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message ?? "Could not save module settings.");
      flash(next ? "Module enabled and saved to your account." : "Module disabled and saved to your account.");
    } catch (error) {
      setEnabled(current => ({ ...current, [key]: previous }));
      flash(error instanceof Error ? error.message : "Could not save module settings.");
    }
  };

  const openProvider = (key: ProviderKey) => {
    setSelectedProvider(key);
    setModal("provider");
  };

  const saveTikTokSettings = async () => {
    setTiktokSaving(true);
    try {
      const response = await fetch("/api/v1/providers/tiktok/settings", {
        method: "PUT", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: tiktokUsername }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message ?? "Could not save TikTok settings.");
      setTiktokUsername(typeof data.username === "string" ? data.username : "");
      setTiktokAccountId(typeof data.accountId === "string" ? data.accountId : user?.id ?? "");
      flash(data.username ? "TikTok LIVE username saved to your account." : "TikTok LIVE username cleared.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not save TikTok settings.");
    } finally {
      setTiktokSaving(false);
    }
  };
  useEffect(() => {
    if (modal !== "provider" || selectedProvider !== "tiktok" || !user?.id) return;
    let active = true;
    fetch("/api/v1/providers/tiktok/settings", { credentials: "include" })
      .then(response => response.ok ? response.json() : Promise.reject(new Error("Could not load TikTok settings.")))
      .then(data => {
        if (!active) return;
        setTiktokUsername(typeof data.username === "string" ? data.username : "");
        setTiktokAccountId(typeof data.accountId === "string" ? data.accountId : user.id);
      })
      .catch(() => { if (active) setTiktokAccountId(user.id); });
    return () => { active = false; };
  }, [modal, selectedProvider, user?.id]);
  const disconnectSelectedProvider = async () => {
    const provider = providers.find(item => item.key === selectedProvider)!;
    try {
      const response = await fetch("/api/v1/providers/" + selectedProvider, { method: "DELETE", credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message ?? "Could not disconnect " + provider.name + ".");
      await refreshProviderConnections();
      await refreshProviderHealth();
      setModal(null);
      flash(provider.name + " disconnected and saved.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not disconnect " + provider.name + ".");
    }
  };
  const handleProviderAction = async () => {
    const provider = providers.find(item => item.key === selectedProvider)!;
    const current = providerConnections[selectedProvider];
    if (current.status === "connected" && selectedProvider === "twitch" && current.detailCode !== "eventsub_verification_pending") {
      try {
        const response = await fetch("/api/v1/providers/twitch/eventsub/subscribe", {
          method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error?.message ?? "Could not enable Twitch chat events.");
        await refreshProviderConnections();
        await refreshProviderHealth();
        flash(data.status === "subscribed" ? "Twitch chat events are enabled." : "Subscription requested. Waiting for Twitch to verify the webhook.");
      } catch (error) {
        flash(error instanceof Error ? error.message : "Could not enable Twitch chat events.");
      }
      return;
    }
    if (current.status === "connected" && current.detailCode === "eventsub_verification_pending") {
      flash("Twitch is still verifying the webhook. Check back in a moment.");
      return;
    }
    if (current.status === "connected") {
      try {
        const response = await fetch("/api/v1/providers/" + selectedProvider, { method: "DELETE", credentials: "include" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error?.message ?? "Could not disconnect " + provider.name + ".");
        await refreshProviderConnections();
        await refreshProviderHealth();
        setModal(null);
        flash(provider.name + " disconnected and saved.");
      } catch (error) {
        flash(error instanceof Error ? error.message : "Could not disconnect " + provider.name + ".");
      }
      return;
    }
    if (selectedProvider === "youtube") {
      if (!current.configured) {
        flash("YouTube OAuth is not configured in this local workspace yet.");
        return;
      }
      try {
        const response = await fetch("/api/v1/providers/youtube/connect", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error?.message ?? "Could not start YouTube authorization.");
        const authorizationUrl = new URL(data.authorizationUrl);
        if (authorizationUrl.origin !== "https://accounts.google.com" || authorizationUrl.pathname !== "/o/oauth2/v2/auth") throw new Error("The authorization URL was not trusted.");
        window.location.assign(authorizationUrl.toString());
      } catch (error) {
        flash(error instanceof Error ? error.message : "Could not start YouTube authorization.");
      }
      return;
    }
    if (selectedProvider !== "twitch") {
      flash("TikTok LIVE is unavailable in this build.");
      return;
    }
    if (!current.configured) {
      flash("Twitch OAuth is not configured in this local workspace yet.");
      return;
    }
    try {
      const response = await fetch("/api/v1/providers/twitch/connect", {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message ?? "Could not start Twitch authorization.");
      const authorizationUrl = new URL(data.authorizationUrl);
      if (authorizationUrl.origin !== "https://id.twitch.tv" || authorizationUrl.pathname !== "/oauth2/authorize") {
        throw new Error("The Twitch authorization URL was not trusted.");
      }
      window.location.assign(authorizationUrl.toString());
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not start Twitch authorization.");
    }
  };

  const startPairing = () => {
    setPairCode("");
    setPairStatus("idle");
  };

  const verifyPairing = async () => {
    setPairStatus("checking");
    try {
      const response = await fetch("/api/v1/pairing/claim", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: pairCode }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setPairStatus("success");
        await refreshDevices();
        flash("Beat Saber device paired to your account.");
      } else {
        setPairStatus("error");
        flash(data.error?.message ?? (response.status === 401 ? "Sign in before claiming a device." : "Could not verify the code. Check that it is current and try again."));
      }
    } catch {
      setPairStatus("error");
      flash("The API is unavailable. Try again when it reconnects.");
    }
  };

  const saveSettings = async () => {
    const safeCommand = command.trim();
    if (!/^![a-z0-9_-]{1,19}$/i.test(safeCommand)) {
      flash("Use a command starting with ! followed by 1–19 letters, numbers, _ or -.");
      return;
    }
    try {
      const response = await fetch("/api/v1/settings/modules/bsr-song-request", {
        method: "PATCH", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: { command: safeCommand } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message ?? "Could not save settings.");
      setCommand(safeCommand);
      setModal(null);
      flash("Settings saved to your account.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not save settings.");
    }
  };

  const revokeDevice = async (deviceId: string) => {
    try {
      const response = await fetch(`/api/v1/devices/${deviceId}`, { method: "DELETE", credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message ?? "Could not disconnect device.");
      await refreshDevices();
      flash("Device disconnected.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not disconnect device.");
    }
  };

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    try {
      if (authMode === "request-reset") {
        const response = await fetch("/api/auth/request-password-reset", {
          method: "POST", credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: authEmail.trim(), redirectTo: "https://app.riftpulse.me/" }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const code = data.code ?? data.error?.code;
          if (code === "INVALID_ORIGIN" || response.status === 403) {
            throw new Error("We couldn't verify this request. Refresh the page and try again.");
          }
          throw new Error(data.message ?? data.error?.message ?? "Could not request a password reset.");
        }
        setResetEmailSent(true);
        setAuthError("");
      } else if (authMode === "reset-password") {
        if (!resetToken) throw new Error("This password reset link is missing its token. Request a new link.");
        const response = await fetch("/api/auth/reset-password", {
          method: "POST", credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: resetToken, newPassword: authPassword }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const code = data.code ?? data.error?.code;
          if (code === "INVALID_TOKEN") throw new Error("That reset link is expired or has already been used. Request a new one.");
          if (code === "INVALID_ORIGIN" || response.status === 403) throw new Error("Your reset request could not be verified. Open the link from https://app.riftpulse.me and try again.");
          throw new Error(data.message ?? data.error?.message ?? "Could not reset password. The link may have expired.");
        }
        if (data.status !== true) throw new Error("The password service did not confirm the reset. Please request a new link.");
        // Better Auth's successful status is returned only after the credential is updated
        // and the one-time reset token is consumed. Do not make success depend on a second
        // sign-in request: reset links opened from email may not carry the account email.
        setUser(null);
        setAuthPassword("");
        setResetToken("");
        window.history.replaceState({}, "", "/");
        setAuthMode("signin");
        setAuthError("");
        setAuthSuccessMessage("Sign in using your new password.");
      } else {
        const endpoint = authMode === "signin" ? "sign-in" : "sign-up";
        const payload = authMode === "signin"
          ? { email: authEmail.trim(), password: authPassword }
          : { name: authName.trim(), email: authEmail.trim(), password: authPassword };
        const response = await fetch(`/api/auth/${endpoint}/email`, {
          method: "POST", credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const code = data.code ?? data.error?.code;
          if (code === "INVALID_EMAIL_OR_PASSWORD" || response.status === 401) {
            throw new Error("Incorrect email or password. Check your details and try again.");
          }
          if (code === "INVALID_ORIGIN" || response.status === 403) {
            throw new Error("Your sign-in request could not be verified. Refresh the page and try again.");
          }
          throw new Error(data.message ?? data.error?.message ?? "Could not authenticate. Check your details and try again.");
        }
        const sessionResponse = await fetch("/api/auth/get-session", { credentials: "include" });
        const session = await sessionResponse.json();
        if (!session?.user) throw new Error("The server did not create a valid session.");
        setUser(session.user as User);
        setAuthPassword("");
        flash(authMode === "signin" ? "Signed in to RiftPulse." : "RiftPulse account created.");
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    await fetch("/api/auth/sign-out", { method: "POST", credentials: "include" }).catch(() => undefined);
    setUser(null);
    setProfileOpen(false);
    setAuthPassword("");
    flash("Signed out.");
  };

  const navItems = [
    { label: "Overview", icon: LayoutDashboard },
    { label: "Modules", icon: WandSparkles },
    { label: "Downloads", icon: Download },
    { label: "Integrations", icon: Link2 },
    { label: "Devices", icon: Gamepad2 },
    { label: "Settings", icon: SlidersHorizontal },
  ];

  const rawPath = window.location.pathname;
  const legalPath = (rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath) || "/";
  if (legalPath === "/privacy" || legalPath === "/terms") {
    return <LegalPage kind={legalPath === "/privacy" ? "privacy" : "terms"} />;
  }

  if (!authLoaded) return <div className="auth-loading"><div className="brand-mark"><AudioLines size={25}/></div><span className="loading-ring"/><small>INITIALIZING RIFTPULSE</small></div>;

  if (!user || authMode === "reset-password" || authMode === "request-reset") return (
    <main className="auth-shell">
      <header className="auth-top"><div className="auth-brand"><div className="brand-mark"><AudioLines size={22}/></div><span>RIFTPULSE</span><small>V1</small></div><span className="auth-secure"><ShieldCheck size={14}/> LOCAL DEVELOPMENT</span></header>
      <section className="auth-layout">
        <div className="auth-copy"><div className="eyebrow"><span className="eyebrow-line"/> YOUR STREAMING COMMAND CENTER</div><h1>Your stream.<br/><em>Your rules.</em></h1><p>Bring your live chat, song requests, and Beat Saber setup into one clean control center.</p><div className="auth-features"><div><MessageCircle/><span><b>Chat, all in one place</b><small>Bring supported platforms into the game.</small></span></div><div><Music2/><span><b>Song requests, under control</b><small>Configure commands and queue behavior.</small></span></div><div><Gamepad2/><span><b>PCVR + Quest</b><small>One account. Separate game adapters.</small></span></div></div></div>
        <div className="auth-card"><div className="auth-card-heading"><div className="auth-card-icon"><Sparkles size={20}/></div><div><h2>{authMode === "signin" ? "Welcome back" : authMode === "signup" ? "Create your account" : authMode === "request-reset" ? "Recover your account" : "Choose a new password"}</h2><p>{authMode === "signin" ? "Sign in to manage your RiftPulse setup." : authMode === "signup" ? "Start building your streaming setup." : authMode === "request-reset" ? "We’ll email a secure password reset link." : "The link is time-limited and can only be used once."}</p></div></div>
          {authMode === "signin" && authSuccessMessage && <div className="auth-success"><ShieldCheck size={16}/><span><b>Password updated successfully.</b><small>{authSuccessMessage}</small></span></div>}
          {(authMode === "signin" || authMode === "signup") && <div className="auth-tabs"><button type="button" className={authMode === "signin" ? "active" : ""} onClick={() => {setAuthMode("signin");setAuthError("");}}>Sign in</button><button type="button" className={authMode === "signup" ? "active" : ""} onClick={() => {setAuthMode("signup");setAuthError("");}}>Create account</button></div>}
          <form className="auth-form" onSubmit={submitAuth}>
            {authMode === "signup" && <label>Display name<input autoComplete="name" value={authName} onChange={e=>setAuthName(e.target.value)} minLength={2} maxLength={64} placeholder="What should we call you?" required/></label>}
            {authMode !== "reset-password" && <label>Email address<input type="email" autoComplete="email" value={authEmail} onChange={e=>{setAuthEmail(e.target.value);setResetEmailSent(false);}} maxLength={254} placeholder="you@example.com" required/></label>}
            {authMode === "request-reset" && resetEmailSent && <div className="auth-success"><ShieldCheck size={16}/><span><b>Go check your email inbox.</b><small>If the address matches an account, you should receive a password reset link. Check your spam folder too.</small></span></div>}
            {authMode !== "request-reset" && <label>{authMode === "reset-password" ? "New password" : "Password"}<input type="password" autoComplete={authMode === "signin" ? "current-password" : "new-password"} value={authPassword} onChange={e=>setAuthPassword(e.target.value)} minLength={8} maxLength={128} placeholder={authMode === "signin" ? "Enter your password" : "At least 8 characters"} required/></label>}
            {authError && <div className="auth-error"><X size={15}/>{authError}</div>}
            <button className="primary-button auth-submit" disabled={authBusy}>{authBusy ? <><RefreshCw size={16} className="spin"/> Working…</> : <>{authMode === "signin" ? "Sign in to RiftPulse" : authMode === "signup" ? "Create account" : authMode === "request-reset" ? "Send reset link" : "Set new password"}<ArrowRight size={16}/></>}</button>
          </form>
          {authMode === "signin" && <p className="auth-switch"><button type="button" onClick={() => {setAuthMode("request-reset");setAuthError("");}}>Forgot password?</button></p>}
          {(authMode === "request-reset" || authMode === "reset-password") && <p className="auth-switch"><button type="button" onClick={() => {setAuthMode("signin");setAuthError("");}}>Back to sign in</button></p>}
          <div className="auth-foot"><ShieldCheck size={15}/><span>RiftPulse preview account. Password reset links expire after one hour.</span></div>
        </div>
      </section>
      <footer className="auth-footer"><span>© 2026 RiftPulse</span><span>CHAT · BSR SONG REQUEST</span><span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></span></footer>
    </main>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><AudioLines size={22} strokeWidth={2.6} /></div>
          <div className="brand-name">rift<span>pulse</span><div className="brand-caption">STREAM CONTROL</div></div>
        </div>
        <div className="workspace-switcher">
          <div className="workspace-avatar">R</div>
          <div className="workspace-copy"><b>{user.name}</b><small>{user.email}</small></div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="primary-nav">
          {navItems.map(item => {
            const Icon = item.icon;
            return <button key={item.label} data-tour-target={item.label === "Settings" ? "settings" : undefined} className={`nav-item ${activeTab === item.label ? "active" : ""}`} onClick={() => {
              setActiveTab(item.label);
              if (item.label === "Settings") setModal("settings");
              else if (item.label === "Devices") document.getElementById("devices")?.scrollIntoView({ behavior: "smooth", block: "start" });
              else if (item.label === "Integrations") document.getElementById("integrations")?.scrollIntoView({ behavior: "smooth", block: "start" });
              else if (item.label === "Modules") document.getElementById("modules")?.scrollIntoView({ behavior: "smooth", block: "start" });
              else if (item.label === "Downloads") document.getElementById("downloads")?.scrollIntoView({ behavior: "smooth", block: "start" });
              else window.scrollTo({ top: 0, behavior: "smooth" });
            }}><Icon size={17} /><span>{item.label}</span>{item.label === "Integrations" && <span className="nav-count">4</span>}</button>;
          })}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-promo">
          <div className="promo-glow"><Zap size={17} /></div>
          <b>Your stream, in sync.</b>
          <p>One pulse between your chat and the game.</p>
          <button onClick={() => setModal("help")}>Explore RiftPulse <ArrowUpRight size={14} /></button>
        </div>
        <button className="nav-item help-nav" aria-label="Support — replay the getting started guide" onClick={startTour}><CircleHelp size={17} /><span>Support</span></button>
        <div className="sidebar-footer"><div className="avatar"><img className="avatar-image" src="/images/riftpulse-profile.jpg" alt="RiftPulse profile" /></div><div className="footer-profile"><b>{user.name}</b><small>{user.email}</small></div></div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-sep">/</span><b>{activeTab}</b></div>
          <div className="topbar-actions"><button className="icon-button support-trigger" data-tour-target="support" title="Support and getting started guide" aria-label="Support and getting started guide" onClick={startTour}><CircleHelp size={18} /></button><div className={`api-pill ${apiStatus}`}><span className="status-dot" />{apiStatus === "online" ? "API operational" : apiStatus === "checking" ? "Checking API" : "API offline"}</div><div className="notification-anchor"><button className={"icon-button notification-button" + (updates.some(update => !update.isRead) ? " has-unread" : "")} aria-label="Updates" aria-haspopup="dialog" aria-expanded={updatesOpen} onClick={() => { const next = !updatesOpen; setUpdatesOpen(next); if (next) void refreshUpdates(); }}><Bell size={17} />{updates.some(update => !update.isRead) && <i />}</button>{updatesOpen && <div className="updates-dropdown" role="dialog" aria-label="RiftPulse updates"><div className="updates-header"><div><b>RiftPulse updates</b><small>Website and mod release notes</small></div><button className="updates-close" aria-label="Close updates" onClick={() => setUpdatesOpen(false)}><X size={15} /></button></div><div className="updates-toolbar"><span>{updates.some(update => !update.isRead) ? updates.filter(update => !update.isRead).length + " new update" + (updates.filter(update => !update.isRead).length === 1 ? "" : "s") : "You’re all caught up"}</span>{updates.some(update => !update.isRead) && <button onClick={() => void markUpdatesRead()}>Mark all read</button>}</div><div className="updates-list">{updatesLoading && updates.length === 0 ? <div className="updates-empty"><RefreshCw size={16} className="spin" /> Loading updates…</div> : updates.length === 0 ? <div className="updates-empty"><Bell size={18} /><b>No updates yet</b><span>Website and mod changes will show up here.</span></div> : updates.map(update => <article className={"update-entry" + (update.isRead ? "" : " unread")} key={update.id}><div className="update-entry-top"><span className={"update-tag " + update.category}>{update.category === "both" ? "Website + Mod" : update.category === "mod" ? "Mod update" : "Website update"}</span><time dateTime={update.publishedAt}>{new Date(update.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time></div><div className="update-entry-title">{update.title}{update.version && <small>{update.version}</small>}</div><p>{update.summary}</p>{update.changes.length > 0 && <ul>{update.changes.map((change, index) => <li key={update.id + "-" + index}>{change}</li>)}</ul>}</article>)}</div></div>}</div><div className="account-menu-anchor"><button className="avatar top-avatar" onClick={() => setProfileOpen(!profileOpen)} aria-label="Account menu" aria-haspopup="menu" aria-expanded={profileOpen}><img className="avatar-image" src="/images/riftpulse-profile.jpg" alt="" /></button>{profileOpen && <div className="profile-menu account-dropdown" role="menu"><div className="account-dropdown-heading"><div className="avatar"><img className="avatar-image" src="/images/riftpulse-profile.jpg" alt="" /></div><span><b>{user.name}</b><small>{user.email}</small></span></div><div className="profile-menu-title">ACCOUNT</div><button role="menuitem" onClick={() => { setProfileOpen(false); setModal("settings"); }}><Settings2 size={15} /> Preferences</button><button role="menuitem" onClick={() => { void signOut(); }}><LogOut size={15} /> Sign out</button></div>}</div></div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div><div className="eyebrow"><span className="eyebrow-line" /> YOUR STREAMING COMMAND CENTER</div><h1>Make your stream <span>pulse.</span></h1><p className="welcome-sub">Your setup at a glance. Let's get everything connected.</p></div>
            <div className="welcome-actions">{!tourCompleted && <button className="outline-button get-started-button" onClick={startTour}><WandSparkles size={15} /> Get started</button>}<button className="primary-button" onClick={() => { startPairing(); setModal("pair"); }}><Plus size={17} /> Connect a device</button></div>
          </section>

          <section className="hero-card">
            <div className="hero-content">
              <div className="hero-kicker"><Sparkles size={14} /> RIFTPULSE V1 <span className="kicker-divider" /> EARLY ACCESS</div>
              <h2>Bring your chat<br />into the <span>game.</span></h2>
              <p>Connect your streaming platforms, configure your modules, and let your community become part of the action.</p>
              <button className="hero-button" onClick={() => { setActiveTab("Integrations"); document.getElementById("integrations")?.scrollIntoView({ behavior: "smooth" }); }}>Set up integrations <ArrowDownRight size={16} /></button>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" />
              <div className="hero-core"><AudioLines size={48} strokeWidth={1.8} /></div>
              <div className="float-chip chip-chat"><MessageCircle size={16} /><span>Live chat</span><i /></div>
              <div className="float-chip chip-viewers"><Users size={16} /><span>Viewers</span><b>—</b></div>
              <div className="float-chip chip-song"><Music2 size={16} /><span>Song queue</span><i /></div>
              <div className="art-particle p1" /><div className="art-particle p2" /><div className="art-particle p3" />
            </div>
            <div className="hero-grid" aria-hidden="true" />
          </section>

          <section className="metrics-grid" data-tour-target="overview">
            <MetricCard icon={<Radio size={17} />} label="PLATFORMS CONNECTED" value={String(Object.values(providerConnections).filter(connection => connection.status === "connected").length).padStart(2, "0")} detail="confirmed provider authorizations" />
            <MetricCard icon={<Gamepad2 size={17} />} label="DEVICES PAIRED" value={String(devices.length).padStart(2, "0")} detail={devices.length ? "Active paired devices" : "Connect Beat Saber to begin"} />
            <MetricCard icon={<WandSparkles size={17} />} label="ACTIVE MODULES" value={String(Object.values(enabled).filter(Boolean).length).padStart(2, "0")} detail="Chat + BSR Song Request" />
            <MetricCard icon={<Users size={17} />} label="LIVE VIEWERS" value={viewerAggregate?.total == null ? "—" : String(viewerAggregate.total)} detail={viewerAggregate?.total == null ? (healthLoading ? "Checking provider counts" : "No fresh counts available") : viewerAggregate.partial ? "Partial · some providers unavailable" : "Fresh counts across providers"} muted={viewerAggregate?.total == null} />
          </section>

          <section className="section-block" id="modules" data-tour-target="modules">
            <div className="section-heading"><div><div className="section-overline">YOUR TOOLKIT</div><h3>Modules <span className="subtle-count">02</span></h3><p>Small tools. Big stream energy.</p></div><button className="text-button" onClick={() => setActiveTab("Modules")}>Manage modules <ArrowUpRight size={15} /></button></div>
            <div className="module-grid">
              <ModuleCard title="Chat" description="Bring Twitch, YouTube, and TikTok LIVE messages into your game." tag="COMMUNITY" icon={<MessageCircle size={21} />} accent="purple" onConfigure={() => { setActiveTab("Integrations"); document.getElementById("chat-feed")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} status="Chat & Events" />
              <ModuleCard title="BSR Song Request" description="Let your viewers request Beat Saber tracks with a simple chat command." tag="INTERACTIVE" icon={<Music2 size={21} />} accent="cyan" onConfigure={() => setModal("settings")} status={`Command: ${command}`} />
            </div>
          </section>

          <section className="section-block downloads-block" id="downloads" data-tour-target="downloads">
            <div className="section-heading"><div><div className="section-overline">ALPHA TEST BUILDS</div><h3>Development downloads <span className="subtle-count">02</span></h3><p>Alpha packages for Beat Saber 1.40.8. PCVR v0.1.29 and Quest v0.1.35 add the large animated PULSING RIFT panel header, a world-space live chat feed, platform labels, viewer totals, and a corrected movable panel handle. Both platform builds compile; real-headset validation is still required.</p></div><span className="settings-badge">PCVR v0.1.29 / Quest v0.1.35</span></div>
            <div className="downloads-grid">
              <article className="panel-card download-card">
                <div className="download-card-head"><div className="download-platform-icon pcvr-download"><Monitor size={20} /></div><div><b>PCVR</b><small>Windows / Beat Saber 1.40.8 (PCVR)</small></div><span className="download-state">v0.1.29 | ZIP built</span></div>
                <p><b>Install on PCVR (Beat Saber 1.40.8):</b> Download the ZIP and extract it directly into your PCVR 1.40.8 Beat Saber game folder (the folder containing <code>Beat Saber.exe</code>). Keep the ZIP's folder structure; it places <code>RiftPulse.Pcvr.dll</code> in the <code>Plugins</code> folder automatically. The BSIPA manifest is embedded inside the DLL, so do not copy a separate <code>manifest.json</code> into <code>Plugins</code>. If you tried an earlier package, remove the old RiftPulse <code>Plugins/manifest.json</code> first. Launch PCVR 1.40.8 and open RiftPulse from the Mods panel. Version 0.1.29 keeps the world-space panel available in the main menu and gameplay. <b>PULSING RIFT</b> is the large animated panel header. Use the small <b>DRAG TO MOVE</b> footer hit area to reposition the panel; its placement is saved. The old visible capsule grip has been removed. The monitor mark and provider icons identify PCVR plus Twitch, YouTube, and TikTok LIVE messages/events. Validate panel movement, saved placement, and live feed in a real headset session.</p>
                <a className="primary-button download-link" href="/downloads/RiftPulse.Pcvr-0.1.29.zip" download><Download size={15} /> Download PCVR ZIP</a>
              </article>
              <article className="panel-card download-card">
                <div className="download-card-head"><div className="download-platform-icon quest-download"><Gamepad2 size={20} /></div><div><b>Quest Standalone</b><small>Meta Quest headset / Beat Saber 1.40.8</small></div><span className="download-state">v0.1.35 | QMOD built</span></div>
                <p><b>Install on Quest Standalone (Beat Saber 1.40.8):</b> Download the QMOD and import it into ModsBeforeFriday (MBF) while your Quest is connected and running the standalone 1.40.8 version of Beat Saber. Install the mod through MBF, launch Beat Saber, and open RiftPulse from the Mods panel. Select <b>OPEN 3D CHAT PANEL</b> to create the world-space chat screen. <b>PULSING RIFT</b> is the large animated header. Use the <b>DRAG TO MOVE</b> footer hit area to reposition the panel; its placement is saved. Quest 0.1.35 creates the title and feed with TextMeshPro UI elements on the floating world-space canvas instead of the curved menu-text path that left the chat invisible. Pair the headset to load recent messages/events and the combined viewer total. The download is a QMOD only; there is no Quest ZIP.</p>
                <a className="primary-button download-link" href="/downloads/RiftPulse-Quest-0.1.35-Alpha.qmod" download><Download size={15} /> Download Quest QMOD</a>
              </article>
            </div>
            <div className="integration-footnote"><ShieldCheck size={15} /><span>Alpha build for tester validation. The device-authenticated in-game chat feed, world-space panel, and combined viewer summary are included. Real headset and live-stream testing is still required. ChatIntegrations command execution and BSR song-request fulfillment remain separate unfinished workstreams. Use a test instance; not a release build.</span></div>
          </section>

          <section className="section-block integrations-block" id="integrations" data-tour-target="integrations">
            <div className="section-heading"><div><div className="section-overline">BRING IT TOGETHER</div><h3>Integrations <span className="subtle-count">03</span></h3><p>Your platforms, one connected experience.</p></div><button className="outline-button" onClick={() => openProvider("twitch")}><Plus size={15} /> Connect platform</button></div>
            <div className="provider-list">
              {providers.map(provider => <div className="provider-row" key={provider.key}>
                <div className={`provider-icon ${provider.className}`}>{provider.short}</div>
                <div className="provider-main"><b>{provider.name}{provider.key === "tiktok" && <>{providerConnections.tiktok.status === "connected" && <span className="tiktok-live-viewers" title="Current TikTok LIVE viewers"><Users size={13} /><span>{providerHealth.find(item => item.provider === "tiktok")?.viewerCount ?? "-"}</span></span>}<span className="unofficial-label">UNOFFICIAL</span></>}</b><small>{providerConnections[provider.key].status === "connected" ? "Connected as " + (providerConnections[provider.key].displayName ?? "account") : providerConnections[provider.key].status === "unsupported" ? "Unavailable in this build" : providerConnections[provider.key].configured ? provider.note : providerConnections[provider.key].detailCode === "oauth_credentials_not_configured" ? "Local OAuth credentials not configured" : provider.note}</small></div>
                <div className={"connection-state " + (providerConnections[provider.key].status === "connected" ? "is-connected" : "")}><span className="status-dot" />{providerConnections[provider.key].status === "connected" ? "Connected" : providerConnections[provider.key].status === "unsupported" ? "Unavailable" : providerConnections[provider.key].status === "degraded" ? "Needs attention" : providerConnections[provider.key].status === "error" ? "Error" : "Not connected"}</div>
                <button className={providerConnections[provider.key].status === "connected" ? "disconnect-button" : "connect-button"} onClick={() => openProvider(provider.key)}>{providerConnections[provider.key].status === "connected" ? "Manage" : providerConnections[provider.key].status === "unsupported" ? "Details" : "Connect"}{providerConnections[provider.key].status === "connected" ? <ChevronDown size={14} /> : <ExternalLink size={13} />}</button>
              </div>)}
            </div>
            <div className="integration-footnote"><ShieldCheck size={15} /><span>Connection status comes from the API. Twitch uses EventSub webhooks, YouTube polls live chat and supported stream events, and TikTok LIVE uses an unofficial best-effort bridge. A real live-stream test is still needed to confirm end-to-end delivery.</span></div>
          </section>

          <section className="section-block chat-feed-block" id="chat-feed" data-tour-target="chat-feed">
            <div className="section-heading">
              <div><div className="section-overline">COMMUNITY PULSE</div><h3>Chat & Events <span className="subtle-count">{chatMessages.length.toString().padStart(2, "0")}</span></h3><p>Live messages and normalized stream events from connected platforms.</p></div>
              <button className="outline-button" onClick={() => { void refreshChat(); void refreshProviderHealth(); }} disabled={chatLoading && healthLoading}><RefreshCw size={14} /> Refresh status</button>
            </div>
            <div className="chat-feed-panel">
              <div className="chat-feed-main">
                {chatLoading ? <div className="chat-empty"><RefreshCw size={18} className="spin" /><span>Loading recent chat…</span></div>
                  : chatError ? <div className="chat-empty"><CircleHelp size={20} /><div><b>Chat history unavailable</b><p>Check the local API and try again.</p></div></div>
                  : chatMessages.length === 0 ? <div className="chat-empty"><div className="chat-empty-icon"><MessageCircle size={21} /></div><div><b>No live messages yet</b><p>Provider connectors are not authorized yet, so no real messages are being received.</p></div></div>
                  : <div className="chat-message-list">{chatMessages.slice(-8).map(message => {
                    const provider = providers.find(item => item.key === message.provider);
                    return <article className="chat-message-row" key={message.id}>
                      <div className={`provider-icon ${provider?.className ?? "tiktok"} chat-provider-icon`}>{provider?.short ?? "?"}</div>
                      <div className="chat-message-copy"><div className="chat-message-meta"><b>{message.senderName}</b><span className="chat-provider-label">{provider?.name ?? message.provider}</span><time>{new Date(message.receivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div><p>{message.text}</p></div>
                    </article>;
                  })}</div>}
              </div>
              <aside className="chat-feed-status">
                <div className="chat-status-heading"><span>PROVIDER HEALTH</span><small>{healthLoading ? "Checking…" : `${providerHealth.filter(item => item.state === "connected" || item.state === "degraded").length}/3 active`}</small></div>
                {(providerHealth.length ? providerHealth : providers.map(item => ({ provider: item.key, state: item.key === "tiktok" ? "unsupported" as const : "disconnected" as const, viewerCount: null, detailCode: null, unofficial: item.key === "tiktok" }))).map(health => {
                  const provider = providers.find(item => item.key === health.provider);
                  const label = health.state === "connected" ? "Connected" : health.state === "degraded" ? "Degraded" : health.state === "unsupported" ? "Unavailable" : health.state === "error" ? "Error" : "Not connected";
                  return <div className={`chat-provider-status ${health.state}`} key={health.provider}><span className="status-dot" /><div><b>{provider?.name ?? health.provider}</b><small>{label}{health.detailCode ? ` · ${health.detailCode.replace(/_/g, " ")}` : ""}</small></div><strong>{health.viewerCount == null ? "—" : health.viewerCount}</strong></div>;
                })}
              </aside>
            </div>
            <div className="integration-footnote"><ShieldCheck size={15} /><span>Viewer totals only include fresh counts. “—” means unknown, not zero. TikTok LIVE uses an unofficial bridge and remains best-effort until a real stream test confirms its event payloads and reconnect behavior.</span></div>
          </section>

          <section className="bottom-grid" id="devices">
            <div className="panel-card devices-card" data-tour-target="devices">
              <div className="panel-title"><div><div className="section-overline">YOUR HARDWARE</div><h3>Connected devices</h3></div><button className="icon-button" onClick={() => { startPairing(); setModal("pair"); }} aria-label="Add device"><Plus size={17} /></button></div>
              {devices.length === 0 ? <div className="empty-device"><div className="empty-device-icon"><Monitor size={22} /></div><div><b>No devices paired yet</b><p>Connect Beat Saber to bring RiftPulse into your game.</p><button className="inline-action" onClick={() => { startPairing(); setModal("pair"); }}>Pair your first device <ArrowUpRight size={14} /></button></div></div> : <div className="device-list">{devices.map(device => <div className="device-row" key={device.id}><div className="empty-device-icon"><Gamepad2 size={20}/></div><div><b>{device.label || (device.platform === "pcvr" ? "Beat Saber · PCVR" : "Beat Saber · Quest")}</b><p>Game {device.gameVersion} · Mod {device.modVersion}</p></div><button className="disconnect-button" onClick={() => void revokeDevice(device.id)}>Disconnect</button></div>)}</div>}
            </div>
            <div className="panel-card activity-card">
              <div className="panel-title"><div><div className="section-overline">SYSTEM STATUS</div><h3>Activity</h3></div><Activity size={17} className="activity-icon" /></div>
              <div className="activity-row"><div className="activity-symbol green"><Check size={14} /></div><div><b>Workspace initialized</b><small>RiftPulse V1 foundation is ready</small></div><time>NOW</time></div>
              <div className="activity-row"><div className="activity-symbol blue"><RefreshCw size={14} /></div><div><b>API health check</b><small>{apiStatus === "online" ? "Worker responding normally" : apiStatus === "offline" ? "Worker unavailable in this environment" : "Checking local Worker"}</small></div><time>{apiStatus === "checking" ? "…" : "LIVE"}</time></div>
            </div>
          </section>

          <footer className="page-footer"><div><span className="footer-pulse" /> RIFTPULSE <span className="footer-version">V0.1.0 · DEVELOPMENT PREVIEW</span></div><div><span>Built for the beat.</span><span className="footer-separator">·</span><a href="/privacy">Privacy</a><span className="footer-separator">·</span><a href="/terms">Terms</a><span className="footer-separator">·</span><button onClick={startTour}>Support</button><span className="footer-separator">·</span><button onClick={() => setModal("settings")}>Preferences</button></div></footer>
        </div>
      </main>

      {notice && <div className="toast"><Check size={16} />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><X size={14} /></button></div>}

      {tourOpen && <div className="onboarding-layer">
        <div className="onboarding-scrim" aria-hidden="true" />
        {tourTargetRect && <div className="onboarding-arrow" aria-hidden="true" style={{
          left: Math.max(12, Math.min(tourTargetRect.left + tourTargetRect.width / 2 - 18, window.innerWidth - 48)),
          top: Math.max(8, tourTargetRect.top - 46),
        }}><ArrowDown size={34} strokeWidth={2.6} /></div>}
        <section className="onboarding-panel" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-description">
          <div className="onboarding-topline">
            <div className="onboarding-brand"><span className="onboarding-guide-icon"><ArrowDownRight size={19} /></span><span><b>RIFTPULSE GUIDE</b><small>GETTING STARTED</small></span></div>
            <span className="onboarding-counter">{String(tourStep + 1).padStart(2, "0")} <i>/</i> {String(onboardingSteps.length).padStart(2, "0")}</span>
            <button className="icon-button onboarding-close" aria-label="Close guide" title="Close guide" disabled={tourSaving} onClick={() => void finishTour()}><X size={17} /></button>
          </div>
          <div className="onboarding-progress"><span style={{ width: ((tourStep + 1) / onboardingSteps.length * 100) + "%" }} /></div>
          <div className="onboarding-copy">
            <div className="onboarding-step-label">{tourStep === 0 ? "LET'S GET YOU SET UP" : "STEP " + String(tourStep).padStart(2, "0")}</div>
            <h2 id="onboarding-title">{onboardingSteps[tourStep].title}</h2>
            <p id="onboarding-description">{onboardingSteps[tourStep].description}</p>
          </div>
          <div className="onboarding-actions">
            <button className="onboarding-skip" disabled={tourSaving} onClick={() => void finishTour()}>Skip guide</button>
            <div className="onboarding-nav">
              {tourStep > 0 && <button className="onboarding-back" disabled={tourSaving} onClick={useTourBack}>Back</button>}
              <button className="primary-button onboarding-next" disabled={tourSaving} onClick={advanceTour}>{tourSaving ? <><RefreshCw size={15} className="spin" /> Saving…</> : tourStep === onboardingSteps.length - 1 ? <>Finish <Check size={15} /></> : <>Next <ArrowRight size={15} /></>}</button>
            </div>
          </div>
        </section>
      </div>}

      {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setModal(null); }}>
        <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <button className="modal-close icon-button" onClick={() => setModal(null)} aria-label="Close"><X size={18} /></button>
          {modal === "auth" && <><div className="modal-icon purple-modal"><LockKeyhole size={22} /></div><div className="modal-eyebrow">YOUR RIFTPULSE ACCOUNT</div><h2 id="modal-title">{authMode === "signup" ? "Create your account." : "Welcome back."}</h2><p className="modal-copy">Sign in to save module settings and manage your devices. This isolated development preview uses temporary test accounts without email verification; do not reuse a password from another service.</p><form onSubmit={submitAuth} className="auth-form">{authMode === "signup" && <div className="field-group"><label htmlFor="auth-name">Display name</label><input id="auth-name" required minLength={2} maxLength={80} autoComplete="name" value={authName} onChange={e => setAuthName(e.target.value)} placeholder="Your streamer name" /></div>}<div className="field-group"><label htmlFor="auth-email">Email address</label><input id="auth-email" type="email" required maxLength={254} autoComplete="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="you@example.com" /></div><div className="field-group"><label htmlFor="auth-password">Password</label><input id="auth-password" type="password" required minLength={8} maxLength={128} autoComplete={authMode === "signup" ? "new-password" : "current-password"} value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder="At least 8 characters" /></div>{authError && <div className="inline-error"><LockKeyhole size={15} />{authError}</div>}<button className="primary-button modal-submit" type="submit" disabled={authBusy}>{authBusy ? <><RefreshCw size={16} className="spin" /> Please wait…</> : <>{authMode === "signup" ? "Create account" : "Sign in"} <ArrowUpRight size={15} /></>}</button></form><p className="auth-switch">{authMode === "signup" ? "Already have an account?" : "New to RiftPulse?"} <button onClick={() => { setAuthMode(authMode === "signup" ? "signin" : "signup"); setAuthError(""); }}>{authMode === "signup" ? "Sign in" : "Create an account"}</button></p><p className="modal-footnote">Development preview only. Test accounts are temporary; never reuse a password from another service.</p></>}
          {modal === "pair" && <><div className="modal-icon purple-modal"><Gamepad2 size={22} /></div><div className="modal-eyebrow">DEVICE PAIRING</div><h2 id="modal-title">Connect your game.</h2><p className="modal-copy">Open RiftPulse in Beat Saber, select <b>Connect to website</b>, then enter the five-digit code displayed in-game.</p>
            <div className="pairing-code-area"><div className="pairing-instruction"><Gamepad2 size={19}/><span>Open RiftPulse inside Beat Saber and choose <b>Connect to website</b>.</span></div><small>The five-digit code is generated by the mod and expires after five minutes.</small></div>
            <div className="field-group"><label htmlFor="pair-input">Five-digit code from your game</label><input id="pair-input" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} placeholder="00000" value={pairCode} onChange={e => { setPairCode(e.target.value.replace(/\D/g, "").slice(0, 5)); setPairStatus("idle"); }} /></div>
            {pairStatus === "error" && <div className="inline-error"><LockKeyhole size={15} /> The code may be expired, already used, or not registered by your mod.</div>}
            {pairStatus === "success" && <div className="inline-success"><Check size={15} /> Device paired successfully.</div>}
            <button className="primary-button modal-submit" disabled={pairCode.length !== 5 || pairStatus === "checking"} onClick={verifyPairing}>{pairStatus === "checking" ? <><RefreshCw size={16} className="spin" /> Verifying…</> : <>Verify code <ArrowUpRight size={15} /></>}</button>
            <p className="modal-footnote">This form never generates pairing codes. Enter only the current code displayed by your own Beat Saber installation.</p>
          </>}
          {modal === "provider" && <><div className={`modal-icon provider-icon ${providers.find(p => p.key === selectedProvider)?.className}`}>{providers.find(p => p.key === selectedProvider)?.short}</div><div className="modal-eyebrow">PLATFORM INTEGRATION</div><h2 id="modal-title">{providerConnections[selectedProvider].status === "connected" ? "Manage" : "Connect"} {providers.find(p => p.key === selectedProvider)?.name}</h2><p className="modal-copy">{selectedProvider === "twitch" ? (providerConnections.twitch.configured ? "Authorize your Twitch account securely. After authorization, EventSub subscription setup is still required before live messages arrive." : "The Twitch OAuth flow is implemented locally, but app credentials and a token encryption key have not been configured in this workspace.") : selectedProvider === "youtube" ? (providerConnections.youtube.configured ? "Authorize read-only access for your YouTube channel. While Chat is enabled, RiftPulse automatically polls live chat and supported Super Chat/membership events during an active broadcast." : "Google OAuth and YouTube Data API credentials have not been configured in this workspace.") : selectedProvider === "tiktok" ? "RiftPulse uses a separate Railway bridge for TikTok LIVE chat and supported events such as gifts, follows, likes, and shares. The bridge securely discovers the public username saved to your RiftPulse account, waits for that account to go LIVE, and forwards events to the API using signed requests. This is an unofficial, best-effort integration; event delivery must still be verified during an actual LIVE broadcast." : (providers.find(p => p.key === selectedProvider)?.name + " authorization is not implemented yet. The account will remain disconnected until its secure OAuth flow is ready.")}</p>
            {selectedProvider === "tiktok" && <><div className="warning-note"><ShieldCheck size={16} /><span><b>Unofficial connector</b><br />TikTok LIVE support is best effort and may be unavailable or change without notice.</span></div>
              <div className="field-group"><label htmlFor="tiktok-username">Public TikTok LIVE username</label><input id="tiktok-username" autoComplete="off" maxLength={25} placeholder="yourusername" value={tiktokUsername} onChange={e => setTiktokUsername(e.target.value.replace(/^@/, "").slice(0, 24))} /><small>Enter the username only, without @ or a profile URL. This is saved privately to your RiftPulse account.</small></div>
              <div className="field-group"><label htmlFor="tiktok-account-id">RiftPulse account ID (managed automatically)</label><input id="tiktok-account-id" readOnly value={tiktokAccountId || user?.id || "Available after sign-in"} /><small>The Railway bridge automatically discovers the username saved above from your signed-in account. You do not need to copy this ID or configure a separate connector process.</small></div>
              <button className="primary-button modal-submit" disabled={tiktokSaving || !user?.id} onClick={() => void saveTikTokSettings()}>{tiktokSaving ? <><RefreshCw size={16} className="spin" /> Saving…</> : <>Save TikTok username <Check size={15} /></>}</button></>}
            <div className="provider-permissions"><div><Check size={15} /> Chat event capability</div><div><Users size={15} /> Viewer count where supported</div><div><LockKeyhole size={15} /> Secure account authorization</div></div>
            {selectedProvider !== "tiktok" && <><button className="primary-button modal-submit" disabled={(providerConnections[selectedProvider].status !== "connected" && ((selectedProvider === "twitch" && !providerConnections.twitch.configured) || (selectedProvider === "youtube" && !providerConnections.youtube.configured))) || (providerConnections[selectedProvider].detailCode === "eventsub_verification_pending")} onClick={() => void handleProviderAction()}>{selectedProvider === "twitch" && providerConnections.twitch.status === "connected" ? providerConnections.twitch.detailCode === "eventsub_verification_pending" ? <><RefreshCw size={16} className="spin" /> Waiting for verification</> : <><Radio size={16} /> Enable / repair chat events</> : providerConnections[selectedProvider].status === "connected" ? <><Unplug size={16} /> Disconnect account</> : selectedProvider === "twitch" && providerConnections.twitch.configured ? <><Link2 size={16} /> Connect with Twitch</> : selectedProvider === "youtube" && providerConnections.youtube.configured ? <><Link2 size={16} /> Connect with YouTube</>: <>Not configured yet <LockKeyhole size={15} /></>}</button>{selectedProvider === "twitch" && providerConnections.twitch.status === "connected" && providerConnections.twitch.detailCode !== "eventsub_verification_pending" && <button className="primary-button modal-submit" onClick={() => void disconnectSelectedProvider()}><Unplug size={16} /> Disconnect Twitch</button>}<p className="modal-footnote">{providerConnections[selectedProvider].status === "connected" && selectedProvider === "twitch" && providerConnections[selectedProvider].detailCode === "eventsub_subscription_pending" ? "Twitch is authorized. Enable the signed webhook subscription to receive live chat." : providerConnections[selectedProvider].status === "connected" && selectedProvider === "twitch" && providerConnections[selectedProvider].detailCode === "eventsub_verification_pending" ? "Twitch is validating the webhook endpoint. The status will update after its signed challenge arrives." : providerConnections[selectedProvider].status === "connected" && selectedProvider === "youtube" && providerConnections[selectedProvider].detailCode === "live_chat_polling_pending" ? "YouTube is authorized. Keep Chat enabled and the dashboard visible during a live broadcast; chat and supported events poll automatically." : providerConnections[selectedProvider].status === "connected" ? "Disconnecting clears stored token ciphertext." : "No external account is contacted until you choose an enabled connection action."}</p></>}
          </>}
          {modal === "settings" && <><div className="modal-icon purple-modal"><Settings2 size={22} /></div><div className="modal-eyebrow">PREFERENCES</div><h2 id="modal-title">Tune your setup.</h2><p className="modal-copy">Module switches and the BSR command save to your account. Provider OAuth and device preferences remain gated until their integrations are complete.</p>
            <div className="settings-option"><div><b>Automatically save toggles</b><small>Apply module changes immediately.</small></div><button className={`toggle ${autoSave ? "on" : ""}`} role="switch" aria-checked={autoSave} onClick={() => setAutoSave(!autoSave)}><span /></button></div>
            <div className="field-group"><label htmlFor="command-input">BSR song request command</label><input id="command-input" value={command} maxLength={20} onChange={e => setCommand(e.target.value.replace(/\s/g, ""))} placeholder="!bsr" /><small>Saved to your account when you choose Save. Format: ! followed by letters, numbers, _ or -.</small></div>
            <div className="settings-option"><div><b>Reduced motion</b><small>Respect your device's motion preference.</small></div><span className="settings-badge">PCVR v0.1.29 / Quest v0.1.35</span></div>
            <button className="primary-button modal-submit" onClick={() => void saveSettings()}>Save settings to account <Check size={15} /></button>
          </>}
          {modal === "help" && <><div className="modal-icon purple-modal"><Headphones size={22} /></div><div className="modal-eyebrow">RIFTPULSE GUIDE</div><h2 id="modal-title">Ready when you are.</h2><p className="modal-copy">RiftPulse connects your livestream community with Beat Saber. V1 is focused on two modules: in-game Chat and BSR Song Request.</p><div className="help-list"><div><MessageCircle size={18} /><span><b>Chat</b><small>Bring supported live messages into your game.</small></span></div><div><Music2 size={18} /><span><b>BSR Song Request</b><small>Queue viewer song requests with configurable commands.</small></span></div><div><Gamepad2 size={18} /><span><b>Pair your game</b><small>Use the in-game five-digit pairing flow once the mod is installed.</small></span></div></div><button className="primary-button modal-submit" onClick={() => { setModal(null); startPairing(); setModal("pair"); }}>Connect a device <ArrowUpRight size={15} /></button></>}
        </div>
      </div>}
    </div>
  );
}

function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const privacy = kind === "privacy";
  return <main className="legal-shell">
    <header className="legal-header"><a className="legal-brand" href="/"><span className="legal-mark"><AudioLines size={22}/></span>RIFTPULSE</a><a className="legal-back" href="/">Back to RiftPulse <ArrowRight size={15}/></a></header>
    <article className="legal-document">
      <div className="legal-eyebrow">RIFTPULSE · LEGAL</div>
      <h1>{privacy ? "Privacy Policy" : "Terms of Service"}</h1>
      <p className="legal-effective">Effective date: November 11, 2026</p>
      {privacy ? <>
        <p>This Privacy Policy describes how RiftPulse (“RiftPulse,” “we,” “us,” or “our”) handles information when you use our website, account services, and Beat Saber-related integrations. RiftPulse is a development-stage service; features and data flows may change as features are introduced.</p>
        <h2>1. Information we handle</h2><p>Depending on the features you use, we may handle account details such as email address, display name, and account identifier; device and pairing identifiers, pairing status, and configuration preferences; and technical information such as request logs, browser/device details, IP address, and security events.</p>
        <h2>2. Connected platform data</h2><p>If you authorize Twitch, YouTube/Google, or TikTok LIVE, the service may process platform identifiers, usernames, authorization tokens, chat messages, stream status, viewer counts, and event data (such as follows, subscriptions, gifts, or donations) to the extent the integration supports them and the permissions allow. Actual data availability varies by platform and feature.</p>
        <h2>3. How information is used</h2><p>We use information to operate and secure accounts, complete device pairing, provide integrations and settings sync, deliver chat/event and song-request features, troubleshoot errors, prevent abuse, and maintain or improve RiftPulse.</p>
        <h2>4. Service providers and sharing</h2><p>RiftPulse relies on service providers including Cloudflare and Railway for hosting, infrastructure, and operation. Information may be processed by providers and connected platforms as needed to deliver requested features. We may disclose information when legally required or when reasonably necessary to protect the service, users, or others. We do not sell personal information for money.</p>
        <h2>5. OAuth and third-party accounts</h2><p>When you connect an external account, you grant RiftPulse access within the permissions presented by that platform. You can revoke authorization through the platform's account settings; this may disable RiftPulse features. Third-party services are governed by their own terms and privacy policies.</p>
        <h2>6. Security and retention</h2><p>We use reasonable safeguards to protect information, but no service can guarantee absolute security. Information is retained as needed to provide the service, maintain security, resolve issues, and meet legal obligations; retention periods may vary by data type.</p>
        <h2>7. Your choices and requests</h2><p>You may disconnect integrations through available controls or revoke them at the platform. You may request access, correction, or deletion of account information by contacting RiftPulse through the website's Support feature. We will handle requests as required by applicable law. Certain records may need to be retained for security or legal reasons.</p>
        <h2>8. Children's privacy</h2><p>RiftPulse is not intended for children below the minimum age permitted under applicable law. If we learn that we have collected personal information in violation of applicable law, we will take appropriate steps to address it.</p>
        <h2>9. International processing</h2><p>Our providers may process information in locations outside your country. Where applicable, we take steps required by law for such processing.</p>
        <h2>10. Policy updates and contact</h2><p>We may update this policy and revise its effective date. For privacy questions or requests, contact us through the Support feature on the RiftPulse website.</p>
      </> : <>
        <p>These Terms of Service (“Terms”) govern your use of the RiftPulse website, accounts, software integrations, device pairing, and supported features. By accessing or using RiftPulse, you agree to these Terms. If you do not agree, do not use the service.</p>
        <h2>1. Service description</h2><p>RiftPulse provides tools intended for Beat Saber players and streamers, which may include account and device pairing, streaming-platform connections, chat and event integrations, configurable commands, and song-request features. Features may be changed, suspended, or discontinued as the service develops.</p>
        <h2>2. Eligibility and accounts</h2><p>You must meet the minimum age required by applicable law and the services you connect. If you are a minor, obtain any parent or guardian permission required by law. Keep account credentials secure, provide accurate information, and promptly report suspected unauthorized access.</p>
        <h2>3. Third-party platform connections</h2><p>Connecting Twitch, YouTube/Google, TikTok LIVE, or another platform is subject to that platform's terms, policies, and availability. You are responsible for having permission to connect the account and for revoking access when appropriate. RiftPulse does not control third-party services and does not guarantee their continued availability.</p>
        <h2>4. Acceptable use</h2><p>You may not use RiftPulse unlawfully; attempt unauthorized access; disrupt, abuse, or overload the service; circumvent authentication, pairing, or security controls; distribute harmful code; harass or impersonate others; or violate another person's rights. You may not use chat commands or song requests to spam or disrupt a stream.</p>
        <h2>5. User configuration and content</h2><p>You are responsible for the commands, request rules, and moderation settings you configure, and for ensuring your use of connected platforms and content complies with applicable rules and rights. RiftPulse does not claim ownership of Beat Saber, music, or third-party platform content.</p>
        <h2>6. Intellectual property</h2><p>RiftPulse's original software, branding, and website materials are owned by or licensed to RiftPulse, except third-party materials. Do not reproduce or commercially exploit these materials except as permitted by law or applicable license. Third-party marks belong to their respective owners.</p>
        <h2>7. Availability and changes</h2><p>RiftPulse is under development and is provided without a guarantee of uninterrupted, error-free operation, compatibility with every device or game version, or continued operation of integrations. We may modify or discontinue features as reasonably needed.</p>
        <h2>8. Suspension and termination</h2><p>We may restrict or suspend access for violations, abuse, security risks, or legal requirements. You may stop using RiftPulse at any time and request account-data deletion through the website's Support feature, subject to applicable retention obligations.</p>
        <h2>9. Disclaimer</h2><p>To the maximum extent permitted by law, RiftPulse is provided “AS IS” and “AS AVAILABLE,” without warranties not expressly provided, including implied warranties of merchantability, fitness for a particular purpose, and non-infringement. Nothing here excludes rights or warranties that cannot legally be excluded.</p>
        <h2>10. Limitation of liability</h2><p>To the maximum extent permitted by law, RiftPulse is not liable for indirect, incidental, special, consequential, or punitive damages, including loss of data, service interruption, or third-party service issues. This does not limit liability that cannot legally be limited.</p>
        <h2>11. Privacy</h2><p>Your use of RiftPulse is also subject to our <a href="/privacy">Privacy Policy</a>, which explains how information is handled.</p>
        <h2>12. Updates, governing law, and contact</h2><p>We may revise these Terms by posting an updated version and effective date; additional notice or consent will be provided where required. Governing law and dispute venue will be determined by applicable law. For questions, contact RiftPulse through the website's Support feature.</p>
      </>}
      <div className="legal-bottom"><a href="/privacy">Privacy Policy</a><span>·</span><a href="/terms">Terms of Service</a><span>·</span><a href="/">RiftPulse Home</a></div>
    </article>
    <footer className="legal-footer">© 2026 RiftPulse · Built for the beat.</footer>
  </main>;
}

function MetricCard({ icon, label, value, detail, muted = false }: { icon: React.ReactNode; label: string; value: string; detail: string; muted?: boolean }) {
  return <div className={`metric-card ${muted ? "metric-muted" : ""}`}><div className="metric-top"><span className="metric-icon">{icon}</span><span className="metric-label">{label}</span></div><div className="metric-value">{value}</div><div className="metric-detail">{detail}</div></div>;
}

function ModuleCard({ title, description, tag, icon, accent, onConfigure, status }: { title: string; description: string; tag: string; icon: React.ReactNode; accent: string; onConfigure: () => void; status: string }) {
  return <article className="module-card"><div className={`module-card-accent ${accent}`} /><div className="module-card-top"><div className={`module-icon ${accent}`}>{icon}</div></div><div className="module-tag">{tag}</div><h4>{title}</h4><p>{description}</p><div className="module-card-bottom"><span className="module-status ready"><i />{status}</span><button className="configure-button" onClick={onConfigure}>Configure <ArrowUpRight size={14} /></button></div></article>;
}

export default App;

