import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, AudioLines, Bell, Check, ChevronDown,
  CircleHelp, Command, ExternalLink, Gamepad2, Headphones, LayoutDashboard,
  Link2, LockKeyhole, LogOut, MessageCircle, Monitor, MoreHorizontal, Music2,
  Plus, Radio, RefreshCw, Settings2, ShieldCheck, SlidersHorizontal, Sparkles,
  Unplug, Users, WandSparkles, X, Zap,
} from "lucide-react";

type User = { id: string; name: string; email: string };
type Device = { id: string; platform: "pcvr" | "quest"; gameVersion: string; modVersion: string; label: string | null; createdAt: string; lastSeenAt: string | null };
type ChatMessage = { id: string; provider: ProviderKey; senderName: string; text: string; receivedAt: string; badges: { moderator: boolean; subscriber: boolean; verified: boolean } };
type ProviderState = "connected" | "disconnected" | "degraded" | "error" | "unsupported";
type ProviderHealth = { provider: ProviderKey; state: ProviderState; viewerCount: number | null; detailCode: string | null; unofficial: boolean };
type ProviderConnection = { status: string; displayName: string | null; connectedAt: string | null; configured: boolean; detailCode: string | null };
type ViewerAggregate = { total: number | null; includedProviders: ProviderKey[]; missingProviders: ProviderKey[]; partial: boolean };
type ModuleKey = "chat" | "bsr-song-request";
type ProviderKey = "twitch" | "youtube" | "kick" | "tiktok";
type Provider = { key: ProviderKey; name: string; short: string; className: string; note: string };
const providers: Provider[] = [
  { key: "twitch", name: "Twitch", short: "T", className: "twitch", note: "Live chat + viewers" },
  { key: "youtube", name: "YouTube", short: "▶", className: "youtube", note: "Live chat + viewers" },
  { key: "kick", name: "Kick", short: "K", className: "kick", note: "Live chat + viewers" },
  { key: "tiktok", name: "TikTok LIVE", short: "♪", className: "tiktok", note: "Unofficial · best effort" },
];
const initialEnabled: Record<ModuleKey, boolean> = { chat: true, "bsr-song-request": true };

function App() {
  const [activeTab, setActiveTab] = useState("Overview");
  const [enabled, setEnabled] = useState(initialEnabled);
  const [providerConnections, setProviderConnections] = useState<Record<ProviderKey, ProviderConnection>>({
    twitch: { status: "disconnected", displayName: null, connectedAt: null, configured: false, detailCode: "oauth_credentials_not_configured" },
    youtube: { status: "disconnected", displayName: null, connectedAt: null, configured: false, detailCode: null },
    kick: { status: "disconnected", displayName: null, connectedAt: null, configured: false, detailCode: null },
    tiktok: { status: "unsupported", displayName: null, connectedAt: null, configured: false, detailCode: "unofficial_connector_unavailable" },
  });
  const [modal, setModal] = useState<"pair" | "provider" | "settings" | "help" | "auth" | null>(null);
  const [pairCode, setPairCode] = useState("");
  const [pairStatus, setPairStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [selectedProvider, setSelectedProvider] = useState<ProviderKey>("twitch");
  const [notice, setNotice] = useState("");
  const [command, setCommand] = useState("!bsr");
  const [autoSave, setAutoSave] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [apiStatus, setApiStatus] = useState<"checking" | "online" | "offline">("checking");
  const [user, setUser] = useState<User | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(true);
  const [chatError, setChatError] = useState(false);
  const [providerHealth, setProviderHealth] = useState<ProviderHealth[]>([]);
  const [viewerAggregate, setViewerAggregate] = useState<ViewerAggregate | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  const refreshChat = useCallback(async () => {
    try {
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

  useEffect(() => {
    fetch("/api/auth/get-session", { credentials: "include" })
      .then(response => response.ok ? response.json() : null)
      .then(data => setUser(data?.user ? data.user as User : null))
      .catch(() => setUser(null))
      .finally(() => setAuthLoaded(true));
  }, []);

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
    void refreshChat();
    void refreshProviderHealth();
    void refreshProviderConnections();
  }, [user?.id, refreshDevices, refreshChat, refreshProviderHealth, refreshProviderConnections]);

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
          const message = payload?.type === "chat.message" ? payload.message as ChatMessage : null;
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

  useEffect(() => {
    if (!authLoaded) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("provider") !== "twitch" || !params.get("status")) return;
    const status = params.get("status");
    if (status === "connected") flash("Twitch account authorized. EventSub subscription setup is still pending.");
    else if (status === "denied") flash("Twitch authorization was canceled.");
    else flash("Twitch connection could not be completed. No token details were shown.");
    window.history.replaceState({}, "", window.location.pathname);
    if (user?.id) {
      void refreshProviderConnections();
      void refreshProviderHealth();
      void refreshChat();
    }
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

  const handleProviderAction = async () => {
    const provider = providers.find(item => item.key === selectedProvider)!;
    const current = providerConnections[selectedProvider];
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
    if (selectedProvider !== "twitch") {
      flash(selectedProvider === "tiktok" ? "TikTok LIVE is unavailable in this build." : provider.name + " authorization is not implemented yet.");
      return;
    }
    if (!current.configured) {
      flash("Twitch OAuth is not configured in this local workspace yet.");
      return;
    }
    try {
      const response = await fetch("/api/v1/providers/twitch/connect", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message ?? "Could not start Twitch authorization.");
      const authorizationUrl = new URL(data.authorizationUrl);
      if (authorizationUrl.origin !== "https://id.twitch.tv" || authorizationUrl.pathname !== "/oauth2/authorize") throw new Error("The authorization URL was not trusted.");
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
      if (!response.ok) throw new Error(data.message ?? data.error?.message ?? "Could not authenticate. Check your details and try again.");
      const sessionResponse = await fetch("/api/auth/get-session", { credentials: "include" });
      const session = await sessionResponse.json();
      if (!session?.user) throw new Error("The server did not create a valid session.");
      setUser(session.user as User);
      setAuthPassword("");
      flash(authMode === "signin" ? "Signed in to RiftPulse." : "RiftPulse account created.");
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
    { label: "Integrations", icon: Link2 },
    { label: "Devices", icon: Gamepad2 },
    { label: "Settings", icon: SlidersHorizontal },
  ];

  if (!authLoaded) return <div className="auth-loading"><div className="brand-mark"><AudioLines size={25}/></div><span className="loading-ring"/><small>INITIALIZING RIFTPULSE</small></div>;

  if (!user) return (
    <main className="auth-shell">
      <header className="auth-top"><div className="auth-brand"><div className="brand-mark"><AudioLines size={22}/></div><span>RIFTPULSE</span><small>V1</small></div><span className="auth-secure"><ShieldCheck size={14}/> LOCAL DEVELOPMENT</span></header>
      <section className="auth-layout">
        <div className="auth-copy"><div className="eyebrow"><span className="eyebrow-line"/> YOUR STREAMING COMMAND CENTER</div><h1>Your stream.<br/><em>Your rules.</em></h1><p>Bring your live chat, song requests, and Beat Saber setup into one clean control center.</p><div className="auth-features"><div><MessageCircle/><span><b>Chat, all in one place</b><small>Bring supported platforms into the game.</small></span></div><div><Music2/><span><b>Song requests, under control</b><small>Configure commands and queue behavior.</small></span></div><div><Gamepad2/><span><b>PCVR + Quest</b><small>One account. Separate game adapters.</small></span></div></div></div>
        <div className="auth-card"><div className="auth-card-heading"><div className="auth-card-icon"><Sparkles size={20}/></div><div><h2>{authMode === "signin" ? "Welcome back" : "Create your account"}</h2><p>{authMode === "signin" ? "Sign in to manage your RiftPulse setup." : "Start building your streaming setup."}</p></div></div>
          <div className="auth-tabs"><button type="button" className={authMode === "signin" ? "active" : ""} onClick={() => {setAuthMode("signin");setAuthError("");}}>Sign in</button><button type="button" className={authMode === "signup" ? "active" : ""} onClick={() => {setAuthMode("signup");setAuthError("");}}>Create account</button></div>
          <form className="auth-form" onSubmit={submitAuth}>
            {authMode === "signup" && <label>Display name<input autoComplete="name" value={authName} onChange={e=>setAuthName(e.target.value)} minLength={2} maxLength={64} placeholder="What should we call you?" required/></label>}
            <label>Email address<input type="email" autoComplete="email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} maxLength={254} placeholder="you@example.com" required/></label>
            <label>Password<input type="password" autoComplete={authMode === "signin" ? "current-password" : "new-password"} value={authPassword} onChange={e=>setAuthPassword(e.target.value)} minLength={8} maxLength={128} placeholder={authMode === "signin" ? "Enter your password" : "At least 8 characters"} required/></label>
            {authError && <div className="auth-error"><X size={15}/>{authError}</div>}
            <button className="primary-button auth-submit" disabled={authBusy}>{authBusy ? <><RefreshCw size={16} className="spin"/> Working…</> : <>{authMode === "signin" ? "Sign in to RiftPulse" : "Create account"}<ArrowRight size={16}/></>}</button>
          </form>
          <div className="auth-foot"><ShieldCheck size={15}/><span>Local development only. Email verification and production sign-in remain disabled until a mail provider and production origin are configured.</span></div>
        </div>
      </section>
      <footer className="auth-footer"><span>© 2026 RiftPulse</span><span>CHAT · BSR SONG REQUEST</span><span>LOCAL DEVELOPMENT BUILD</span></footer>
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
            return <button key={item.label} className={`nav-item ${activeTab === item.label ? "active" : ""}`} onClick={() => {
              setActiveTab(item.label);
              if (item.label === "Settings") setModal("settings");
              else if (item.label === "Devices") document.getElementById("devices")?.scrollIntoView({ behavior: "smooth", block: "start" });
              else if (item.label === "Integrations") document.getElementById("integrations")?.scrollIntoView({ behavior: "smooth", block: "start" });
              else if (item.label === "Modules") document.getElementById("modules")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
        <button className="nav-item help-nav" onClick={() => setModal("help")}><CircleHelp size={17} /><span>Help & feedback</span></button>
        <div className="sidebar-footer"><div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div><div className="footer-profile"><b>{user.name}</b><small>{user.email}</small></div><button className="icon-button tiny" onClick={() => setProfileOpen(!profileOpen)} aria-label="Open profile menu"><MoreHorizontal size={18} /></button>
          {profileOpen && <div className="profile-menu"><div className="profile-menu-title">{user.email}</div><button onClick={() => { setProfileOpen(false); setModal("settings"); }}><Settings2 size={15} /> Preferences</button><button onClick={() => { void signOut(); }}><LogOut size={15} /> Sign out</button></div>}
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-sep">/</span><b>{activeTab}</b></div>
          <div className="topbar-actions"><div className={`api-pill ${apiStatus}`}><span className="status-dot" />{apiStatus === "online" ? "API operational" : apiStatus === "checking" ? "Checking API" : "API offline"}</div><button className="icon-button" aria-label="Notifications" onClick={() => flash("You're all caught up.")}><Bell size={17} /><i /></button><button className="avatar top-avatar" onClick={() => setProfileOpen(!profileOpen)} aria-label="Account menu">{user.name.slice(0, 1).toUpperCase()}</button></div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div><div className="eyebrow"><span className="eyebrow-line" /> YOUR STREAMING COMMAND CENTER</div><h1>Make your stream <span>pulse.</span></h1><p className="welcome-sub">Your setup at a glance. Let's get everything connected.</p></div>
            <button className="primary-button" onClick={() => { startPairing(); setModal("pair"); }}><Plus size={17} /> Connect a device</button>
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

          <section className="metrics-grid">
            <MetricCard icon={<Radio size={17} />} label="PLATFORMS CONNECTED" value={String(Object.values(providerConnections).filter(connection => connection.status === "connected").length).padStart(2, "0")} detail="confirmed provider authorizations" />
            <MetricCard icon={<Gamepad2 size={17} />} label="DEVICES PAIRED" value={String(devices.length).padStart(2, "0")} detail={devices.length ? "Active paired devices" : "Connect Beat Saber to begin"} />
            <MetricCard icon={<WandSparkles size={17} />} label="ACTIVE MODULES" value={String(Object.values(enabled).filter(Boolean).length).padStart(2, "0")} detail="Chat + BSR Song Request" />
            <MetricCard icon={<Users size={17} />} label="LIVE VIEWERS" value={viewerAggregate?.total == null ? "—" : String(viewerAggregate.total)} detail={viewerAggregate?.total == null ? (healthLoading ? "Checking provider counts" : "No fresh counts available") : viewerAggregate.partial ? "Partial · some providers unavailable" : "Fresh counts across providers"} muted={viewerAggregate?.total == null} />
          </section>

          <section className="section-block" id="modules">
            <div className="section-heading"><div><div className="section-overline">YOUR TOOLKIT</div><h3>Modules <span className="subtle-count">02</span></h3><p>Small tools. Big stream energy.</p></div><button className="text-button" onClick={() => setActiveTab("Modules")}>Manage modules <ArrowUpRight size={15} /></button></div>
            <div className="module-grid">
              <ModuleCard title="Chat" description="Bring Twitch, YouTube, Kick and TikTok LIVE messages into your game." tag="COMMUNITY" icon={<MessageCircle size={21} />} accent="purple" enabled={enabled.chat} onToggle={() => toggleModule("chat")} onConfigure={() => setModal("settings")} status="Ready to configure" />
              <ModuleCard title="BSR Song Request" description="Let your viewers request Beat Saber tracks with a simple chat command." tag="INTERACTIVE" icon={<Music2 size={21} />} accent="cyan" enabled={enabled["bsr-song-request"]} onToggle={() => toggleModule("bsr-song-request")} onConfigure={() => setModal("settings")} status={`Command: ${command}`} />
            </div>
          </section>

          <section className="section-block integrations-block" id="integrations">
            <div className="section-heading"><div><div className="section-overline">BRING IT TOGETHER</div><h3>Integrations <span className="subtle-count">04</span></h3><p>Your platforms, one connected experience.</p></div><button className="outline-button" onClick={() => openProvider("twitch")}><Plus size={15} /> Connect platform</button></div>
            <div className="provider-list">
              {providers.map(provider => <div className="provider-row" key={provider.key}>
                <div className={`provider-icon ${provider.className}`}>{provider.short}</div>
                <div className="provider-main"><b>{provider.name}{provider.key === "tiktok" && <span className="unofficial-label">UNOFFICIAL</span>}</b><small>{providerConnections[provider.key].status === "connected" ? "Connected as " + (providerConnections[provider.key].displayName ?? "account") : providerConnections[provider.key].status === "unsupported" ? "Unavailable in this build" : providerConnections[provider.key].configured ? provider.note : providerConnections[provider.key].detailCode === "oauth_credentials_not_configured" ? "Local OAuth credentials not configured" : provider.note}</small></div>
                <div className={"connection-state " + (providerConnections[provider.key].status === "connected" ? "is-connected" : "")}><span className="status-dot" />{providerConnections[provider.key].status === "connected" ? "Connected" : providerConnections[provider.key].status === "unsupported" ? "Unavailable" : providerConnections[provider.key].status === "degraded" ? "Needs attention" : providerConnections[provider.key].status === "error" ? "Error" : "Not connected"}</div>
                <button className={providerConnections[provider.key].status === "connected" ? "disconnect-button" : "connect-button"} onClick={() => openProvider(provider.key)}>{providerConnections[provider.key].status === "connected" ? "Manage" : providerConnections[provider.key].status === "unsupported" ? "Details" : "Connect"}{providerConnections[provider.key].status === "connected" ? <ChevronDown size={14} /> : <ExternalLink size={13} />}</button>
              </div>)}
            </div>
            <div className="integration-footnote"><ShieldCheck size={15} /><span>Connection status comes from the local API. Twitch OAuth is implemented but requires your own registered app credentials; YouTube and Kick OAuth are still in development. TikTok LIVE remains unavailable.</span></div>
          </section>

          <section className="section-block chat-feed-block" id="chat-feed">
            <div className="section-heading">
              <div><div className="section-overline">COMMUNITY PULSE</div><h3>Recent chat <span className="subtle-count">{chatMessages.length.toString().padStart(2, "0")}</span></h3><p>Normalized messages from your connected platforms.</p></div>
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
                <div className="chat-status-heading"><span>PROVIDER HEALTH</span><small>{healthLoading ? "Checking…" : `${providerHealth.filter(item => item.state === "connected" || item.state === "degraded").length}/4 active`}</small></div>
                {(providerHealth.length ? providerHealth : providers.map(item => ({ provider: item.key, state: item.key === "tiktok" ? "unsupported" as const : "disconnected" as const, viewerCount: null, detailCode: null, unofficial: item.key === "tiktok" }))).map(health => {
                  const provider = providers.find(item => item.key === health.provider);
                  const label = health.state === "connected" ? "Connected" : health.state === "degraded" ? "Degraded" : health.state === "unsupported" ? "Unavailable" : health.state === "error" ? "Error" : "Not connected";
                  return <div className={`chat-provider-status ${health.state}`} key={health.provider}><span className="status-dot" /><div><b>{provider?.name ?? health.provider}</b><small>{label}{health.detailCode ? ` · ${health.detailCode.replace(/_/g, " ")}` : ""}</small></div><strong>{health.viewerCount == null ? "—" : health.viewerCount}</strong></div>;
                })}
              </aside>
            </div>
            <div className="integration-footnote"><ShieldCheck size={15} /><span>Viewer totals only include fresh counts. “—” means unknown, not zero. TikTok LIVE remains unofficial/best-effort until a compliant connector is validated.</span></div>
          </section>

          <section className="bottom-grid" id="devices">
            <div className="panel-card devices-card">
              <div className="panel-title"><div><div className="section-overline">YOUR HARDWARE</div><h3>Connected devices</h3></div><button className="icon-button" onClick={() => { startPairing(); setModal("pair"); }} aria-label="Add device"><Plus size={17} /></button></div>
              {devices.length === 0 ? <div className="empty-device"><div className="empty-device-icon"><Monitor size={22} /></div><div><b>No devices paired yet</b><p>Connect Beat Saber to bring RiftPulse into your game.</p><button className="inline-action" onClick={() => { startPairing(); setModal("pair"); }}>Pair your first device <ArrowUpRight size={14} /></button></div></div> : <div className="device-list">{devices.map(device => <div className="device-row" key={device.id}><div className="empty-device-icon"><Gamepad2 size={20}/></div><div><b>{device.label || (device.platform === "pcvr" ? "Beat Saber · PCVR" : "Beat Saber · Quest")}</b><p>Game {device.gameVersion} · Mod {device.modVersion}</p></div><button className="disconnect-button" onClick={() => void revokeDevice(device.id)}>Disconnect</button></div>)}</div>}
            </div>
            <div className="panel-card activity-card">
              <div className="panel-title"><div><div className="section-overline">SYSTEM STATUS</div><h3>Activity</h3></div><Activity size={17} className="activity-icon" /></div>
              <div className="activity-row"><div className="activity-symbol green"><Check size={14} /></div><div><b>Workspace initialized</b><small>RiftPulse V1 foundation is ready</small></div><time>NOW</time></div>
              <div className="activity-row"><div className="activity-symbol blue"><RefreshCw size={14} /></div><div><b>API health check</b><small>{apiStatus === "online" ? "Worker responding normally" : apiStatus === "offline" ? "Worker unavailable in this environment" : "Checking local Worker"}</small></div><time>{apiStatus === "checking" ? "…" : "LIVE"}</time></div>
            </div>
          </section>

          <footer className="page-footer"><div><span className="footer-pulse" /> RIFTPULSE <span className="footer-version">V0.1.0 · LOCAL PREVIEW</span></div><div><span>Built for the beat.</span><span className="footer-separator">·</span><button onClick={() => setModal("help")}>Support</button><span className="footer-separator">·</span><button onClick={() => setModal("settings")}>Preferences</button></div></footer>
        </div>
      </main>

      {notice && <div className="toast"><Check size={16} />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><X size={14} /></button></div>}

      {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setModal(null); }}>
        <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <button className="modal-close icon-button" onClick={() => setModal(null)} aria-label="Close"><X size={18} /></button>
          {modal === "auth" && <><div className="modal-icon purple-modal"><LockKeyhole size={22} /></div><div className="modal-eyebrow">YOUR RIFTPULSE ACCOUNT</div><h2 id="modal-title">{authMode === "signup" ? "Create your account." : "Welcome back."}</h2><p className="modal-copy">Sign in to save module settings and manage your devices. Account creation is enabled only for this local development origin; email verification and remote sign-in are not configured.</p><form onSubmit={submitAuth} className="auth-form">{authMode === "signup" && <div className="field-group"><label htmlFor="auth-name">Display name</label><input id="auth-name" required minLength={2} maxLength={80} autoComplete="name" value={authName} onChange={e => setAuthName(e.target.value)} placeholder="Your streamer name" /></div>}<div className="field-group"><label htmlFor="auth-email">Email address</label><input id="auth-email" type="email" required maxLength={254} autoComplete="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="you@example.com" /></div><div className="field-group"><label htmlFor="auth-password">Password</label><input id="auth-password" type="password" required minLength={8} maxLength={128} autoComplete={authMode === "signup" ? "new-password" : "current-password"} value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder="At least 8 characters" /></div>{authError && <div className="inline-error"><LockKeyhole size={15} />{authError}</div>}<button className="primary-button modal-submit" type="submit" disabled={authBusy}>{authBusy ? <><RefreshCw size={16} className="spin" /> Please wait…</> : <>{authMode === "signup" ? "Create account" : "Sign in"} <ArrowUpRight size={15} /></>}</button></form><p className="auth-switch">{authMode === "signup" ? "Already have an account?" : "New to RiftPulse?"} <button onClick={() => { setAuthMode(authMode === "signup" ? "signin" : "signup"); setAuthError(""); }}>{authMode === "signup" ? "Sign in" : "Create an account"}</button></p><p className="modal-footnote">Local development only. Do not use a password you use on other services.</p></>}
          {modal === "pair" && <><div className="modal-icon purple-modal"><Gamepad2 size={22} /></div><div className="modal-eyebrow">DEVICE PAIRING</div><h2 id="modal-title">Connect your game.</h2><p className="modal-copy">Open RiftPulse in Beat Saber, select <b>Connect to website</b>, then enter the five-digit code displayed in-game.</p>
            <div className="pairing-code-area"><div className="pairing-instruction"><Gamepad2 size={19}/><span>Open RiftPulse inside Beat Saber and choose <b>Connect to website</b>.</span></div><small>The five-digit code is generated by the mod and expires after five minutes.</small></div>
            <div className="field-group"><label htmlFor="pair-input">Five-digit code from your game</label><input id="pair-input" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} placeholder="00000" value={pairCode} onChange={e => { setPairCode(e.target.value.replace(/\D/g, "").slice(0, 5)); setPairStatus("idle"); }} /></div>
            {pairStatus === "error" && <div className="inline-error"><LockKeyhole size={15} /> The code may be expired, already used, or not registered by your mod.</div>}
            {pairStatus === "success" && <div className="inline-success"><Check size={15} /> Device paired successfully.</div>}
            <button className="primary-button modal-submit" disabled={pairCode.length !== 5 || pairStatus === "checking"} onClick={verifyPairing}>{pairStatus === "checking" ? <><RefreshCw size={16} className="spin" /> Verifying…</> : <>Verify code <ArrowUpRight size={15} /></>}</button>
            <p className="modal-footnote">This form never generates pairing codes. Enter only the current code displayed by your own Beat Saber installation.</p>
          </>}
          {modal === "provider" && <><div className={`modal-icon provider-icon ${providers.find(p => p.key === selectedProvider)?.className}`}>{providers.find(p => p.key === selectedProvider)?.short}</div><div className="modal-eyebrow">PLATFORM INTEGRATION</div><h2 id="modal-title">{providerConnections[selectedProvider].status === "connected" ? "Manage" : "Connect"} {providers.find(p => p.key === selectedProvider)?.name}</h2><p className="modal-copy">{selectedProvider === "twitch" ? (providerConnections.twitch.configured ? "Authorize your Twitch account securely. After authorization, EventSub subscription setup is still required before live messages arrive." : "The Twitch OAuth flow is implemented locally, but app credentials and a token encryption key have not been configured in this workspace.") : selectedProvider === "tiktok" ? "TikTok LIVE is unavailable in this build; no unofficial endpoint is being contacted." : (providers.find(p => p.key === selectedProvider)?.name + " authorization is not implemented yet. The account will remain disconnected until its secure OAuth flow is ready.")}</p>
            {selectedProvider === "tiktok" && <div className="warning-note"><ShieldCheck size={16} /><span><b>Unofficial connector</b><br />TikTok LIVE support is best effort and may be unavailable or change without notice.</span></div>}
            <div className="provider-permissions"><div><Check size={15} /> Chat event capability</div><div><Users size={15} /> Viewer count where supported</div><div><LockKeyhole size={15} /> Secure account authorization</div></div>
            <button className="primary-button modal-submit" disabled={providerConnections[selectedProvider].status !== "connected" && (selectedProvider !== "twitch" || !providerConnections.twitch.configured)} onClick={() => void handleProviderAction()}>{providerConnections[selectedProvider].status === "connected" ? <><Unplug size={16} /> Disconnect account</> : selectedProvider === "twitch" && providerConnections.twitch.configured ? <><Link2 size={16} /> Connect with Twitch</> : <>Not configured yet <LockKeyhole size={15} /></>}</button><p className="modal-footnote">{providerConnections[selectedProvider].status === "connected" ? "Disconnecting clears stored token ciphertext." : "No external account is contacted until you choose an enabled connection action."}</p>
          </>}
          {modal === "settings" && <><div className="modal-icon purple-modal"><Settings2 size={22} /></div><div className="modal-eyebrow">PREFERENCES</div><h2 id="modal-title">Tune your setup.</h2><p className="modal-copy">Module switches and the BSR command save to your account. Provider OAuth and device preferences remain gated until their integrations are complete.</p>
            <div className="settings-option"><div><b>Automatically save toggles</b><small>Apply module changes immediately.</small></div><button className={`toggle ${autoSave ? "on" : ""}`} role="switch" aria-checked={autoSave} onClick={() => setAutoSave(!autoSave)}><span /></button></div>
            <div className="field-group"><label htmlFor="command-input">BSR song request command</label><input id="command-input" value={command} maxLength={20} onChange={e => setCommand(e.target.value.replace(/\s/g, ""))} placeholder="!bsr" /><small>Saved to your account when you choose Save. Format: ! followed by letters, numbers, _ or -.</small></div>
            <div className="settings-option"><div><b>Reduced motion</b><small>Respect your device's motion preference.</small></div><span className="settings-badge">System</span></div>
            <button className="primary-button modal-submit" onClick={() => void saveSettings()}>Save settings to account <Check size={15} /></button>
          </>}
          {modal === "help" && <><div className="modal-icon purple-modal"><Headphones size={22} /></div><div className="modal-eyebrow">RIFTPULSE GUIDE</div><h2 id="modal-title">Ready when you are.</h2><p className="modal-copy">RiftPulse connects your livestream community with Beat Saber. V1 is focused on two modules: in-game Chat and BSR Song Request.</p><div className="help-list"><div><MessageCircle size={18} /><span><b>Chat</b><small>Bring supported live messages into your game.</small></span></div><div><Music2 size={18} /><span><b>BSR Song Request</b><small>Queue viewer song requests with configurable commands.</small></span></div><div><Gamepad2 size={18} /><span><b>Pair your game</b><small>Use the in-game five-digit pairing flow once the mod is installed.</small></span></div></div><button className="primary-button modal-submit" onClick={() => { setModal(null); startPairing(); setModal("pair"); }}>Connect a device <ArrowUpRight size={15} /></button></>}
        </div>
      </div>}
    </div>
  );
}

function MetricCard({ icon, label, value, detail, muted = false }: { icon: React.ReactNode; label: string; value: string; detail: string; muted?: boolean }) {
  return <div className={`metric-card ${muted ? "metric-muted" : ""}`}><div className="metric-top"><span className="metric-icon">{icon}</span><span className="metric-label">{label}</span></div><div className="metric-value">{value}</div><div className="metric-detail">{detail}</div></div>;
}

function ModuleCard({ title, description, tag, icon, accent, enabled, onToggle, onConfigure, status }: { title: string; description: string; tag: string; icon: React.ReactNode; accent: string; enabled: boolean; onToggle: () => void; onConfigure: () => void; status: string }) {
  return <article className={`module-card ${!enabled ? "module-disabled" : ""}`}><div className={`module-card-accent ${accent}`} /><div className="module-card-top"><div className={`module-icon ${accent}`}>{icon}</div><button className={`toggle ${enabled ? "on" : ""}`} role="switch" aria-checked={enabled} aria-label={`Toggle ${title}`} onClick={onToggle}><span /></button></div><div className="module-tag">{tag}</div><h4>{title}</h4><p>{description}</p><div className="module-card-bottom"><span className={`module-status ${enabled ? "ready" : ""}`}><i />{enabled ? status : "Module disabled"}</span><button className="configure-button" onClick={onConfigure}>Configure <ArrowUpRight size={14} /></button></div></article>;
}

export default App;
