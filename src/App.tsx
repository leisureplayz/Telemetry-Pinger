import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Activity,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Eye,
  Download,
  Settings,
  Bell,
  Terminal,
  Copy,
  ExternalLink,
  ChevronRight,
  Info,
  Clock,
  Send,
  HelpCircle,
  FileCode,
  ShieldCheck,
  Check,
  Laptop
} from "lucide-react";

import { HostState, AlertLog, TelemetryData } from "./types";

// Configuration YAML Presets for User Convenience
const DAEMON_PRESETS = {
  dns: `# Telemetry DNS Prober Configuration
config:
  interval_seconds: 15
  timeout_seconds: 4
  webhook:
    enabled: false
    url: ""
    alert_on_status_change: true
    alert_on_latency_spike: true
    latency_threshold_ms: 150

hosts:
  - id: cloudflare_primary
    name: Cloudflare Primary DNS
    url: https://1.1.1.1
    expected_status: 200
  - id: google_dns_one
    name: Google Public DNS
    url: https://8.8.8.8
    expected_status: 200
  - id: quad9_dns
    name: Quad9 Secure DNS
    url: https://9.9.9.9
    expected_status: 200
`,
  ecommerce: `# Telemetry E-Commerce Cluster Configuration
config:
  interval_seconds: 8
  timeout_seconds: 5
  webhook:
    enabled: true
    url: "https://discord.com/api/webhooks/your-mock-or-real-id"
    alert_on_status_change: true
    alert_on_latency_spike: true
    latency_threshold_ms: 1200

hosts:
  - id: store_home
    name: Retail storefront Landing Page
    url: https://httpbin.org/delay/1
    expected_status: 200
  - id: payment_gateway
    name: Stripe Gateway Bridge
    url: https://httpbin.org/status/200
    expected_status: 200
  - id: item_catalog
    name: Catalog Elastic Microservice
    url: https://httpbin.org/status/200
    expected_status: 200
  - id: order_checkout
    name: Checkout Pipeline Lambda
    url: https://httpbin.org/status/500
    expected_status: 200
`,
  crypto: `# Telemetry Crypto Index Feeds Configuration
config:
  interval_seconds: 10
  timeout_seconds: 4
  webhook:
    enabled: false
    url: ""
    alert_on_status_change: true
    alert_on_latency_spike: true
    latency_threshold_ms: 600

hosts:
  - id: binance_api
    name: Binance Public Price Tickers
    url: https://api.binance.com/api/v3/ping
    expected_status: 200
  - id: coinbase_status
    name: Coinbase Cloud Service
    url: https://api.coinbase.com/v2/prices/spot
    expected_status: 200
  - id: coingecko_ping
    name: CoinGecko Public Indexer
    url: https://api.coingecko.com/api/v3/ping
    expected_status: 200
`,
  sandbox: `# Telemetry Diagnostics Default Sandbox
config:
  interval_seconds: 10
  timeout_seconds: 5
  webhook:
    enabled: false
    url: ""
    alert_on_status_change: true
    alert_on_latency_spike: true
    latency_threshold_ms: 800

hosts:
  - id: google
    name: Google Core Services
    url: https://www.google.com
    expected_status: 200
  - id: github
    name: GitHub Platform
    url: https://github.com
    expected_status: 200
  - id: cloudflare
    name: Cloudflare DNS
    url: https://1.1.1.1
    expected_status: 200
  - id: httpbin
    name: HTTP Test Endpoint
    url: https://httpbin.org/get
    expected_status: 200
`
};

export default function App() {
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [yamlContent, setYamlContent] = useState<string>("");
  const [configOutputError, setConfigOutputError] = useState<string | null>(null);
  const [configOutputSuccess, setConfigOutputSuccess] = useState<string | null>(null);
  
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isTestingWebhook, setIsTestingWebhook] = useState(false);
  const [webhookUrlTest, setWebhookUrlTest] = useState("");
  
  const [copiedHostId, setCopiedHostId] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<string>("sandbox");
  const [yamlEditorMode, setYamlEditorMode] = useState<"edit" | "help">("edit");
  const [activeTab, setActiveTab] = useState<"monitors" | "config" | "webhooks">("monitors");
  const [toastMessage, setToastMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  
  // Historical Hover Details State
  const [hoveredHistoryItem, setHoveredHistoryItem] = useState<{
    hostId: string;
    index: number;
    timestamp: number;
    latencyMs: number;
    statusCode: number;
    up: boolean;
    error: string | null;
  } | null>(null);

  // Trigger transient dashboard warnings or successes
  const triggerToast = useCallback((text: string, type: "success" | "error" = "success") => {
    setToastMessage({ type, text });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  }, []);

  // Fetch telemetry status
  const fetchTelemetry = useCallback(async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const response = await fetch("/api/telemetry");
      if (response.ok) {
        const data = (await response.json()) as TelemetryData;
        setTelemetry(data);
      } else {
        console.error("Telemetry API failed", response.status);
      }
    } catch (err) {
      console.error("Error drawing telemetry state:", err);
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  }, []);

  // Fetch hosts.yaml code blocks
  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch("/api/config");
      if (response.ok) {
        const data = await response.json();
        setYamlContent(data.rawContent);
        if (data.parsed?.config?.webhook?.url) {
          setWebhookUrlTest(data.parsed.config.webhook.url);
        }
      }
    } catch (err) {
      console.error("Error reading configuration properties:", err);
    }
  }, []);

  // Periodic polling triggers
  useEffect(() => {
    fetchTelemetry(false);
    fetchConfig();

    const interval = setInterval(() => {
      fetchTelemetry(true);
    }, 3500);

    return () => clearInterval(interval);
  }, [fetchTelemetry, fetchConfig]);

  // Immediate manual sweep triggers
  const handleForcePingSweep = async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/force-ping", { method: "POST" });
      const data = await response.json();
      if (response.ok) {
        triggerToast("Infrastructure telemetry query sweep completed.", "success");
        await fetchTelemetry(false);
      } else {
        triggerToast(data.error || "Manual sweep was rate-limited.", "error");
      }
    } catch (err: any) {
      triggerToast("Error triggering manual probe sweeps: " + err?.message, "error");
    } finally {
      setIsRefreshing(false);
    }
  };

  // Submit edits to hosts.yaml configuration map
  const handleUpdateConfig = async (rawCode: string) => {
    setIsSavingConfig(true);
    setConfigOutputError(null);
    setConfigOutputSuccess(null);
    try {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawContent: rawCode }),
      });

      const data = await response.json();

      if (response.ok) {
        setConfigOutputSuccess("hosts.yaml committed successfully. Telemetry pinger daemon hot-reloaded.");
        triggerToast("Configuration verified and active.", "success");
        await fetchTelemetry(true);
        if (data.parsed?.config?.webhook?.url) {
          setWebhookUrlTest(data.parsed.config.webhook.url);
        }
      } else {
        setConfigOutputError(data.error || "YAML Syntax compiler reported exception.");
        triggerToast("Configuration error detected.", "error");
      }
    } catch (err: any) {
      setConfigOutputError("Network delivery failed: " + err?.message);
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Run presets setups
  const handleApplyPreset = (key: keyof typeof DAEMON_PRESETS) => {
    const code = DAEMON_PRESETS[key];
    setYamlContent(code);
    setActivePreset(key);
    setConfigOutputError(null);
    setConfigOutputSuccess(`Applied custom "${key.toUpperCase()}" template preset. Click "Commit Configuration Changes" below to sync with the daemon.`);
    triggerToast(`Applied "${key}" preset successfully.`, "success");
  };

  // Fire webhook tests
  const handleTestWebhookUrl = async () => {
    setIsTestingWebhook(true);
    try {
      const payload: any = {};
      if (webhookUrlTest.trim()) {
        payload.url = webhookUrlTest.trim();
      }

      const response = await fetch("/api/test-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (response.ok) {
        triggerToast("Diagnostic webhook delivered. Check channel notifications.", "success");
        await fetchTelemetry(true);
      } else {
        triggerToast(data.error || "Webhook failed to fire.", "error");
      }
    } catch (err: any) {
      triggerToast("Webhook transport failure: " + err?.message, "error");
    } finally {
      setIsTestingWebhook(false);
    }
  };

  // Copy target URLs to clipboard
  const handleCopyUrl = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedHostId(id);
    triggerToast(`Copied ${url} to clipboard.`, "success");
    setTimeout(() => setCopiedHostId(null), 2000);
  };

  // Calculate high level stats
  const totalProbesCount = telemetry?.hosts?.length || 0;
  const onlineHostsCount = telemetry?.hosts?.filter(h => h.up).length || 0;
  const offlineHostsCount = totalProbesCount - onlineHostsCount;
  const averageClusterLatency = totalProbesCount > 0 
    ? Math.round(telemetry!.hosts.reduce((acc, h) => acc + (h.up ? h.lastLatency : 0), 0) / (onlineHostsCount || 1))
    : 0;
  const onlinePercentageUptime = totalProbesCount > 0 
    ? Math.round((onlineHostsCount / totalProbesCount) * 100) 
    : 100;

  // Render status summary attributes
  let overallBadgeStatus = "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  let statusTextHeading = "All Operational";
  let latencyAlertThreshold = telemetry?.config?.webhook?.latency_threshold_ms ?? 800;

  if (offlineHostsCount > 0) {
    overallBadgeStatus = "text-rose-400 bg-rose-500/10 border-rose-500/20";
    statusTextHeading = `${offlineHostsCount} Outage${offlineHostsCount > 1 ? "s" : ""} Active`;
  } else if (telemetry?.hosts?.some(h => h.up && h.lastLatency > latencyAlertThreshold)) {
    overallBadgeStatus = "text-amber-400 bg-amber-500/10 border-amber-500/20";
    statusTextHeading = "Degraded Latency";
  }

  return (
    <div id="telemetry_dashboard_root" class="min-h-screen bg-gradient-to-b from-[#0b0f19] via-[#050811] to-[#010206] font-sans text-slate-200 flex flex-col justify-start selection:bg-emerald-500/30 selection:text-white">
      
      {/* Toast Notification HUD */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            id="hud_toast_alert"
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            class="fixed top-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4.5 py-3 rounded-xl shadow-2xl backdrop-blur-md border bg-[#0d1324]/90 text-sm font-medium border-slate-800/85 shadow-black/80"
          >
            {toastMessage.type === "success" ? (
              <CheckCircle class="h-4.5 w-4.5 text-emerald-400" />
            ) : (
              <AlertTriangle class="h-4.5 w-4.5 text-rose-400" />
            )}
            <span class="text-slate-200">{toastMessage.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Banner & Title Interface */}
      <header id="dashboard_top_banner" class="border-b border-slate-900/60 bg-[#090d16]/85 backdrop-blur-lg sticky top-0 z-40">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="h-11 w-11 rounded-xl bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
              <Activity class="h-5.5 w-5.5 animate-pulse" />
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h1 class="text-xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-slate-100 via-slate-100 to-slate-300 font-sans">Telemetry Monitor</h1>
                <span class="h-2 w-2 rounded-full bg-emerald-400 animate-ping" title="Background daemon active"></span>
              </div>
              <p class="text-[11px] text-slate-400 font-mono tracking-wide uppercase">Daemon network prober & webhook engine</p>
            </div>
          </div>
          
          {/* Global Header Actions */}
          <div class="flex flex-wrap items-center gap-2.5 w-full sm:w-auto mt-2 sm:mt-0">
            <button
              id="btn_sweep_network"
              onClick={handleForcePingSweep}
              disabled={isRefreshing || telemetry?.isPinging}
              class="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/25 border border-emerald-500/20 transition-all duration-200 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw class={`h-3.5 w-3.5 ${isRefreshing || telemetry?.isPinging ? "animate-spin" : ""}`} />
              Sweep Network
            </button>
            
            <a
              id="link_open_live_status"
              href="/api/status-page"
              target="_blank"
              rel="noreferrer"
              class="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#111827]/60 hover:bg-[#111827]/90 border border-slate-800/80 text-slate-300 hover:text-white hover:border-slate-700 shadow-md shadow-black/15 transition-all duration-200"
            >
              <Eye class="h-3.5 w-3.5" />
              Live HTML Status
            </a>

            <a
              id="link_download_status"
              href="/api/status-page/download"
              class="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#111827]/60 hover:bg-[#111827]/90 border border-slate-800/80 text-slate-300 hover:text-white hover:border-slate-700 shadow-md shadow-black/15 transition-all duration-200"
              title="Download compiled standalone HTML dashboard sheet"
            >
              <Download class="h-3.5 w-3.5" />
              Download HTML
            </a>
          </div>
        </div>
      </header>

      {/* Main Console Page Workspace */}
      <main class="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex-grow w-full">
        
        {/* Core Telemetry Indicators Grid */}
        <div id="summary_indicators_grid" class="grid grid-cols-2 lg:grid-cols-4 gap-4.5 mb-8">
          
          {/* Operational Health Badge Card */}
          <div class="bg-gradient-to-b from-[#111827]/40 to-[#0b0f19]/35 backdrop-blur border border-slate-850/50 hover:border-slate-800/80 rounded-xl p-5 flex flex-col justify-between shadow-lg relative overflow-hidden transition-all duration-300 hover:shadow-black/20">
            <div class="flex items-center justify-between text-[11px] text-slate-400 font-mono uppercase tracking-wider">
              <span>Daemon Status</span>
              <Laptop class="h-4 w-4 text-slate-500" />
            </div>
            <div class="mt-4 flex items-baseline gap-2">
              <span class="text-2xl font-extrabold tracking-tight text-white font-mono">100%</span>
              <span class="text-[10px] text-emerald-400 font-mono font-bold tracking-wider px-1.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 uppercase">Core Online</span>
            </div>
            <div class="mt-3.5 text-xs text-slate-450 flex items-center gap-2 border-t border-slate-800/40 pt-2.5">
              <span class="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Probes interval: <strong class="text-slate-350 font-semibold font-mono">{telemetry?.config?.interval_seconds || 10}s</strong></span>
            </div>
          </div>

          {/* Operational Ratio */}
          <div class="bg-gradient-to-b from-[#111827]/40 to-[#0b0f19]/35 backdrop-blur border border-slate-850/50 hover:border-slate-800/80 rounded-xl p-5 flex flex-col justify-between shadow-lg relative overflow-hidden transition-all duration-300 hover:shadow-black/20">
            <div class="flex items-center justify-between text-[11px] text-slate-400 font-mono uppercase tracking-wider">
              <span>Infrastructure Ratio</span>
              <CheckCircle class="h-4 w-4 text-emerald-550/70" />
            </div>
            <div class="mt-4 flex items-baseline gap-1.5">
              <span class="text-2xl font-extrabold tracking-tight text-white font-mono">{onlinePercentageUptime}%</span>
              <span class="text-[10px] text-slate-400 font-mono">({onlineHostsCount} / {totalProbesCount} active)</span>
            </div>
            <div class="mt-3.5 text-xs text-slate-450 flex items-center gap-1 border-t border-slate-800/40 pt-2.5">
              <span class={`font-mono text-[10px] border px-2 py-0.5 rounded-full ${overallBadgeStatus}`}>
                {statusTextHeading}
              </span>
            </div>
          </div>

          {/* Average Latency */}
          <div class="bg-gradient-to-b from-[#111827]/40 to-[#0b0f19]/35 backdrop-blur border border-slate-850/50 hover:border-slate-800/80 rounded-xl p-5 flex flex-col justify-between shadow-lg relative overflow-hidden transition-all duration-300 hover:shadow-black/20">
            <div class="flex items-center justify-between text-[11px] text-slate-400 font-mono uppercase tracking-wider">
              <span>Cluster Avg Latency</span>
              <Clock class="h-4 w-4 text-purple-400/80" />
            </div>
            <div class="mt-4 flex items-baseline gap-1.5">
              <span class="text-2xl font-extrabold tracking-tight text-white font-mono">{averageClusterLatency}</span>
              <span class="text-xs text-slate-400 font-mono">ms</span>
            </div>
            <div class="mt-3.5 text-xs text-slate-450 flex items-center justify-between border-t border-slate-800/40 pt-2.5 font-mono">
              <span>Alert limit:</span>
              <span class="text-slate-350 font-bold">{latencyAlertThreshold}ms</span>
            </div>
          </div>

          {/* Alert Deliveries */}
          <div class="bg-gradient-to-b from-[#111827]/40 to-[#0b0f19]/35 backdrop-blur border border-slate-850/50 hover:border-slate-800/80 rounded-xl p-5 flex flex-col justify-between shadow-lg relative overflow-hidden transition-all duration-300 hover:shadow-black/20">
            <div class="flex items-center justify-between text-[11px] text-slate-400 font-mono uppercase tracking-wider">
              <span>Incident Deliveries</span>
              <Bell class="h-4 w-4 text-amber-550" />
            </div>
            <div class="mt-4 flex items-baseline gap-2">
              <span class="text-2xl font-extrabold tracking-tight text-white font-mono">
                {telemetry?.alerts?.length || 0}
              </span>
              <span class="text-[10px] text-slate-400 font-mono uppercase font-bold text-amber-500/90 rounded-md bg-amber-500/10 border border-amber-500/10 px-1.5 py-0.5">DISPATCHED</span>
            </div>
            <div class="mt-3.5 text-xs text-slate-450 flex items-center gap-2 border-t border-slate-800/40 pt-2.5">
              <span class={`h-2 w-2 rounded-full ${telemetry?.config?.webhook?.enabled ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`}></span>
              <span>Webhooks: <strong class="text-slate-350 font-mono font-semibold">{telemetry?.config?.webhook?.enabled ? "Armed" : "Disabled"}</strong></span>
            </div>
          </div>

        </div>

        {/* Workspace Hub Sections Selection Tabs */}
        <div class="flex border-b border-slate-900/60 mb-8 gap-3">
          <button
            onClick={() => setActiveTab("monitors")}
            class={`px-4 py-3 text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2.5 cursor-pointer relative -mb-[2px] border-b-2 ${
              activeTab === "monitors"
                ? "border-emerald-400 text-slate-100 font-extrabold"
                : "border-transparent text-slate-450 hover:text-slate-200 hover:border-slate-800"
            }`}
          >
            <Activity class="h-4 w-4 text-emerald-400" />
            Core Monitors ({totalProbesCount})
          </button>
          <button
            onClick={() => setActiveTab("config")}
            class={`px-4 py-3 text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2.5 cursor-pointer relative -mb-[2px] border-b-2 ${
              activeTab === "config"
                ? "border-emerald-400 text-slate-100 font-extrabold"
                : "border-transparent text-slate-450 hover:text-slate-200 hover:border-slate-800"
            }`}
          >
            <Settings class="h-4 w-4 text-blue-400" />
            Daemon YAML Editor
          </button>
          <button
            onClick={() => setActiveTab("webhooks")}
            class={`px-4 py-3 text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2.5 cursor-pointer relative -mb-[2px] border-b-2 ${
              activeTab === "webhooks"
                ? "border-emerald-400 text-slate-100 font-extrabold"
                : "border-transparent text-slate-450 hover:text-slate-200 hover:border-slate-800"
            }`}
          >
            <Bell class="h-4 w-4 text-purple-400" />
            Alarms & Event Feed
          </button>
        </div>

        {/* Tab contents window */}
        <div id="tabs_content_viewport">
          
          {/* TAB 1: OPERATIONAL GRID PROBES */}
          {activeTab === "monitors" && (
            <div>
              {totalProbesCount === 0 ? (
                <div class="text-center py-12 bg-slate-900 border border-slate-850 rounded-2xl flex flex-col items-center justify-center p-6">
                  <Terminal class="h-10 w-10 text-slate-600 mb-3" />
                  <h3 class="text-base font-bold text-slate-350">No Monitored Hosts Found</h3>
                  <p class="text-xs text-slate-450 max-w-sm mt-1 mb-4">
                    The hosts configuration block inside `hosts.yaml` is empty or parsing failed. Configure your network stack to start polling targets.
                  </p>
                  <button
                    onClick={() => setActiveTab("config")}
                    class="px-4 py-2 rounded-lg text-xs bg-slate-850 border border-slate-800 text-slate-300 hover:text-slate-100 hover:bg-slate-800 transition cursor-pointer"
                  >
                    Configure Targets Now
                  </button>
                </div>
              ) : (
                <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <AnimatePresence mode="popLayout">
                    {telemetry?.hosts.map((host: HostState) => {
                      const isUp = host.up;
                      const hasLatencyAlert = isUp && host.lastLatency > latencyAlertThreshold;
                      
                      // Status Dot Colorings
                      let statusNodeColor = "bg-emerald-400 shadow-md shadow-emerald-400/35";
                      let borderStyle = "border-slate-850/60 hover:border-slate-800/80 shadow-md shadow-black/20 hover:shadow-black/40";
                      let textBadgeStyle = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                      let textBadgeLabel = "OPERATIONAL";

                      if (!isUp) {
                        statusNodeColor = "bg-rose-500 animate-pulse shadow-md shadow-rose-500/35";
                        borderStyle = "border-rose-900/40 bg-rose-950/5 hover:border-rose-700/60 shadow-lg shadow-rose-950/10 hover:shadow-rose-950/20";
                        textBadgeStyle = "bg-rose-500/10 text-rose-400 border-rose-500/20";
                        textBadgeLabel = "OFFLINE";
                      } else if (hasLatencyAlert) {
                        statusNodeColor = "bg-amber-400 shadow-md shadow-amber-400/35";
                        borderStyle = "border-amber-900/40 bg-amber-950/5 hover:border-amber-700/60 shadow-lg shadow-amber-950/10 hover:shadow-amber-950/20";
                        textBadgeStyle = "bg-amber-500/10 text-amber-400 border-amber-500/20";
                        textBadgeLabel = "SLUGGISH";
                      }

                      // Fill history array to 24 items to align layout nicely
                      const displayHistory = [...host.history].slice(-24);
                      while (displayHistory.length < 24) {
                        displayHistory.unshift({ timestamp: 0, latencyMs: 0, statusCode: 0, up: true, error: null });
                      }

                      return (
                        <motion.div
                          key={host.id}
                          layoutId={`card_${host.id}`}
                          initial={{ opacity: 0, scale: 0.98 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          class={`bg-gradient-to-b from-[#111827]/40 to-[#0d1323]/50 border ${borderStyle} rounded-2xl p-6.5 flex flex-col justify-between transition-all duration-350`}
                        >
                          <div>
                            {/* Card Header information block */}
                            <div class="flex items-start justify-between gap-2 mb-2.5">
                              <div class="flex items-center gap-2.5">
                                <span class={`h-3 w-3 rounded-full ${statusNodeColor}`}></span>
                                <h3 class="text-base font-bold text-slate-100 tracking-tight font-sans">
                                  {host.name}
                                </h3>
                              </div>
                              <span class={`px-2.5 py-0.5 text-[10px] border font-bold font-mono rounded-full tracking-wide ${textBadgeStyle}`}>
                                {textBadgeLabel}
                              </span>
                            </div>

                            {/* Host URL text link */}
                            <div class="flex items-center gap-1.5 text-xs text-slate-450 font-mono mb-4.5 select-all group">
                              <span class="truncate max-w-[280px] sm:max-w-[340px]" title={host.url}>{host.url}</span>
                              <button
                                onClick={() => handleCopyUrl(host.id, host.url)}
                                class="text-slate-500 hover:text-slate-350 cursor-pointer transition-colors"
                                title="Copy service URL properties"
                              >
                                {copiedHostId === host.id ? (
                                  <Check class="h-3 w-3 text-emerald-400" />
                                ) : (
                                  <Copy class="h-3 w-3" />
                                )}
                              </button>
                              <a
                                href={host.url}
                                target="_blank"
                                rel="noreferrer"
                                class="text-slate-500 hover:text-slate-350 transition-colors"
                              >
                                <ExternalLink class="h-3 w-3" />
                              </a>
                            </div>

                            {/* Core Diagnostics Grid stats rows */}
                            <div class="grid grid-cols-3 gap-2 py-3 border-t border-b border-slate-800/40 text-center mb-4.5">
                              <div>
                                <span class="text-[9px] text-slate-500 font-mono block uppercase tracking-wider">REAL-TIME SPEED</span>
                                <span class="text-sm font-bold font-mono text-slate-200 mt-1 inline-block">
                                  {isUp ? `${host.lastLatency} ms` : "—"}
                                </span>
                              </div>
                              <div>
                                <span class="text-[9px] text-slate-500 font-mono block uppercase tracking-wider">AVERAGE SPEED</span>
                                <span class="text-sm font-bold font-mono text-slate-200 mt-1 inline-block">
                                  {host.avgLatency > 0 ? `${host.avgLatency} ms` : "—"}
                                </span>
                              </div>
                              <div>
                                <span class="text-[9px] text-slate-500 font-mono block uppercase tracking-wider">UPTIME SCORE</span>
                                <span class="text-sm font-bold font-mono text-emerald-400 mt-1 inline-block">
                                  {host.uptimePercentage.toFixed(1)}%
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Historical Timeline Indicators (The GitHub/Uptime style ticker) */}
                          <div class="relative">
                            <div class="flex items-center justify-between text-[10px] text-slate-500 mb-2 font-mono uppercase tracking-wider">
                              <span>Response Grid (Last 24 scans)</span>
                              <span>Expected: {host.expected_status || "2xx"}</span>
                            </div>

                            {/* History ticker bar */}
                            <div class="flex gap-1.2 justify-between mb-3 bg-black/45 p-2 rounded-lg border border-slate-900/60 overflow-visible">
                              {displayHistory.map((tick, index) => {
                                if (tick.timestamp === 0) {
                                  return (
                                    <div
                                      key={`empty_${index}`}
                                      class="h-6 w-2 rounded-sm bg-slate-900/30"
                                    ></div>
                                  );
                                }

                                const isSlow = tick.up && tick.latencyMs > latencyAlertThreshold;
                                const tickColor = tick.up 
                                  ? (isSlow ? "bg-amber-400" : "bg-emerald-500") 
                                  : "bg-rose-500 animate-pulse";

                                return (
                                  <div
                                    key={`${host.id}_tick_${index}`}
                                    onMouseEnter={() => setHoveredHistoryItem({
                                      hostId: host.id,
                                      index,
                                      ...tick
                                    })}
                                    onMouseLeave={() => setHoveredHistoryItem(null)}
                                    class={`h-6 w-2 rounded-sm ${tickColor} hover:scale-130 transition-all duration-150 cursor-pointer relative shadow-sm`}
                                  >
                                    {/* Hover Details overlay inside loop */}
                                  </div>
                                );
                              })}
                            </div>

                            {/* Shared details window logic */}
                            <div class="min-h-[16px] text-[10px] font-mono text-slate-500 flex justify-between items-center px-1">
                              <span>3h ago</span>
                              <span class="text-right italic">
                                {isUp && host.lastPingTime > 0 ? (
                                  `Last Ping: ${new Date(host.lastPingTime).toLocaleTimeString()}`
                                ) : (
                                  host.lastError || "No active signal responded."
                                )}
                              </span>
                              <span>Now</span>
                            </div>
                          </div>

                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}

              {/* Hover Tooltip Overlay HUD */}
              <AnimatePresence>
                {hoveredHistoryItem && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    class="fixed bottom-6 right-6 bg-[#0d1324]/95 backdrop-blur-md border border-slate-800/90 rounded-2xl p-5 shadow-2 shadow-black/80 max-w-sm z-50 text-xs font-mono border-l-4 border-l-emerald-400"
                    style={{
                      borderLeftColor: hoveredHistoryItem.up 
                        ? (hoveredHistoryItem.latencyMs > latencyAlertThreshold ? "#f59e0b" : "#10b981") 
                        : "#ef4444"
                    }}
                  >
                    <div class="font-bold text-slate-300 border-b border-slate-800/60 pb-2 mb-2.5 flex items-center justify-between gap-4">
                      <span>HISTORICAL SCAN DETAIL</span>
                      <span class={hoveredHistoryItem.up ? "text-emerald-400" : "text-rose-400"}>
                        {hoveredHistoryItem.up ? "SUCCESS" : "FAILURE"}
                      </span>
                    </div>
                    <div class="space-y-1.5 text-slate-400 text-[11px]">
                      <div>Timestamp: <span class="text-slate-300 font-bold">{new Date(hoveredHistoryItem.timestamp).toLocaleTimeString()} ({new Date(hoveredHistoryItem.timestamp).toLocaleDateString()})</span></div>
                      <div>Response Latency: <span class="text-slate-300 font-bold">{hoveredHistoryItem.latencyMs > 0 ? `${hoveredHistoryItem.latencyMs} ms` : "—"}</span></div>
                      <div>Status Code: <span class="text-slate-300 font-bold">{hoveredHistoryItem.statusCode || "0 (No Signal)"}</span></div>
                      {hoveredHistoryItem.error && (
                        <div class="text-rose-400 mt-2 leading-relaxed border-t border-slate-800/30 pt-2">
                          Error: {hoveredHistoryItem.error}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* TAB 2: YAML DAEMON CONFIGURATION COMPILER */}
          {activeTab === "config" && (
            <div id="compilation_editor_tab" class="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left text editor: yaml parameters */}
              <div class="lg:col-span-8 flex flex-col gap-4">
                <div class="bg-gradient-to-b from-[#111827]/45 to-[#0b0f19]/35 border border-slate-850/50 rounded-2xl p-5.5 shadow-xl flex flex-col h-full">
                  
                  {/* Editor Header Navigation and Settings */}
                  <div class="flex items-center justify-between border-b border-slate-800 pb-3.5 mb-4">
                    <div>
                      <h3 class="text-sm font-bold text-slate-200 flex items-center gap-1.5 flex-row">
                        <FileCode class="h-4 w-4 text-emerald-405" />
                        hosts.yaml compiler editing console
                      </h3>
                      <p class="text-[11px] text-slate-550 font-mono mt-0.5">Edit config values to orchestrate pinger threads live</p>
                    </div>

                    <div class="flex gap-2 p-1 bg-black/35 rounded-lg border border-slate-800/60">
                      <button
                        onClick={() => setYamlEditorMode("edit")}
                        class={`px-3 py-1 rounded-md text-[11px] font-mono font-bold transition cursor-pointer ${
                          yamlEditorMode === "edit"
                            ? "bg-[#111827]/70 text-slate-100 border border-slate-705/50"
                            : "bg-transparent text-slate-450 hover:text-slate-200 border border-transparent"
                        }`}
                      >
                        Code
                      </button>
                      <button
                        onClick={() => setYamlEditorMode("help")}
                        class={`px-3 py-1 rounded-md text-[11px] font-mono font-bold transition cursor-pointer ${
                          yamlEditorMode === "help"
                            ? "bg-[#111827]/70 text-slate-100 border border-slate-705/50"
                            : "bg-transparent text-slate-450 hover:text-slate-200 border border-transparent"
                        }`}
                      >
                        Reference Schema
                      </button>
                    </div>
                  </div>

                  {/* Mode Selector Panel contents */}
                  <div class="flex-grow min-h-[350px] relative font-mono text-xs">
                    {yamlEditorMode === "edit" ? (
                      <textarea
                        id="raw_yaml_editor_box"
                        value={yamlContent}
                        onChange={(e) => setYamlContent(e.target.value)}
                        placeholder="# Configuration YAML..."
                        spellCheck={false}
                        class="w-full h-[380px] p-4 bg-black/45 text-slate-300 font-mono text-xs rounded-xl border border-slate-850/70 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 outline-none resize-y leading-relaxed"
                      />
                    ) : (
                      <div class="bg-slate-950 border border-slate-850 rounded-lg p-5 h-[380px] overflow-y-auto leading-relaxed text-slate-400 text-[11px]">
                        <h4 class="text-sm font-bold text-slate-200 font-sans mb-3 flex items-center gap-1 text-emerald-400">
                          <Info class="h-4 w-4" />
                          YAML Schema Documentation Guide
                        </h4>
                        <p class="mb-4 text-xs font-sans">
                          Our background telemetry daemon compiles YAML keys dynamically on write. You must respect the schema requirements outlined below:
                        </p>

                        <div class="space-y-4">
                          <div>
                            <span class="text-slate-100 font-bold block mb-1">1. Global parameters (`config`)</span>
                            <div class="pl-4 border-l border-slate-800 space-y-1">
                              <div><code class="text-emerald-400 font-bold">interval_seconds</code> : Speed of diagnostic query loops. Default 10s.</div>
                              <div><code class="text-emerald-400 font-bold">timeout_seconds</code> : Network connection limit before thread abort. Default 5s.</div>
                            </div>
                          </div>

                          <div>
                            <span class="text-slate-100 font-bold block mb-1">2. Notification parameters (`webhook`)</span>
                            <div class="pl-4 border-l border-slate-800 space-y-1">
                              <div><code class="text-emerald-400 font-bold">enabled</code> : set true to arm Discord/Slack dispatch vectors.</div>
                              <div><code class="text-emerald-400 font-bold">url</code> : Path URL of third-party hook configurations.</div>
                              <div><code class="text-emerald-400 font-bold">alert_on_status_change</code> : alert if target fails.</div>
                              <div><code class="text-emerald-400 font-bold">alert_on_latency_spike</code> : alert if latency exceeds threshold.</div>
                              <div><code class="text-emerald-400 font-bold">latency_threshold_ms</code> : Latency limit in MS.</div>
                            </div>
                          </div>

                          <div>
                            <span class="text-slate-100 font-bold block mb-1">3. Targets Array List (`hosts`)</span>
                            <div class="pl-4 border-l border-slate-800 space-y-2">
                              <div>Contains list items defined by properties:</div>
                              <div class="bg-slate-900/60 p-2.5 rounded border border-slate-800 font-semibold">
                                - <span class="text-emerald-400">id</span>: UNIQUE snake_case key (e.g. cloudface_dns)<br/>
                                - <span class="text-emerald-400">name</span>: Friendly label (e.g. Cloudflare DNS)<br/>
                                - <span class="text-emerald-400">url</span>: Full endpoint path (HTTPS recommended)<br/>
                                - <span class="text-emerald-400">expected_status</span>: HTTP status (e.g. 200, 301, 204)
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Operational Validation Alert Panels */}
                  {configOutputSuccess && (
                    <div class="mt-4 p-3 bg-emerald-950/30 border border-emerald-900/50 rounded-lg text-xs text-emerald-400 font-mono">
                      {configOutputSuccess}
                    </div>
                  )}

                  {configOutputError && (
                    <div class="mt-4 p-3 bg-rose-950/30 border border-rose-900/50 rounded-lg text-xs text-rose-400 font-mono">
                      Error compiling hosts.yaml file config: {configOutputError}
                    </div>
                  )}

                  {/* Submission triggers */}
                  <div class="mt-5 flex justify-end gap-3.5 border-t border-slate-800 pt-4">
                    <button
                      onClick={() => fetchConfig()}
                      class="px-4.5 py-2.2 font-semibold text-xs rounded-lg border border-slate-805/85 text-slate-400 hover:text-slate-200 hover:bg-[#111827]/60 hover:border-slate-700 transition cursor-pointer"
                    >
                      Undo Edits
                    </button>
                    <button
                      onClick={() => handleUpdateConfig(yamlContent)}
                      disabled={isSavingConfig}
                      class="px-5 py-2.2 font-bold text-xs rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/25 border border-emerald-500/10 transition-all duration-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isSavingConfig ? "Syncing..." : "Commit Configuration Changes"}
                      <ChevronRight class="h-3.5 w-3.5" />
                    </button>
                  </div>

                </div>
              </div>

              {/* Right panel: preset lists quick launcher */}
              <div class="lg:col-span-4 flex flex-col gap-4">
                
                {/* Presets template Card */}
                <div class="bg-gradient-to-b from-[#111827]/45 to-[#0b0f19]/35 border border-slate-850/50 rounded-2xl p-5.5 shadow-xl">
                  <h3 class="text-sm font-bold text-slate-205 mb-3.5 flex items-center gap-2">
                    <Terminal class="h-4 w-4 text-purple-400" />
                    Infrastructure templates
                  </h3>
                  <p class="text-[11px] text-slate-500 font-mono mb-4">Apply preconfigured presets to test the telemetry engine instantly:</p>
                  
                  <div class="space-y-3.5">
                    
                    {/* Sandbox Group */}
                    <button
                      onClick={() => handleApplyPreset("sandbox")}
                      class={`w-full text-left p-3.5 rounded-xl border transition-all flex flex-col justify-between cursor-pointer shadow-sm ${
                        activePreset === "sandbox"
                          ? "bg-[#111827]/80 border-emerald-500/50 shadow-emerald-500/5 scale-[1.01]"
                          : "bg-[#111827]/30 border-slate-850/65 hover:border-slate-800/80 hover:bg-[#111827]/55"
                      }`}
                    >
                      <div class="flex items-center justify-between w-full mb-1">
                        <span class="text-xs font-bold text-slate-205">Default Sandbox Profile</span>
                        <span class="text-[10px] bg-slate-900 border border-slate-800 font-mono px-1.5 py-0.2 rounded text-emerald-400">ACTIVE</span>
                      </div>
                      <p class="text-[10px] text-slate-500 leading-normal font-mono">Checks standard high-availability endpoints (Google, Github, Cloudflare DNS, Httpbin API) every 10 seconds.</p>
                    </button>

                    {/* DNS Group */}
                    <button
                      onClick={() => handleApplyPreset("dns")}
                      class={`w-full text-left p-3.5 rounded-xl border transition-all flex flex-col justify-between cursor-pointer shadow-sm ${
                        activePreset === "dns"
                          ? "bg-[#111827]/80 border-emerald-500/50 shadow-emerald-500/10 scale-[1.01]"
                          : "bg-[#111827]/30 border-slate-850/65 hover:border-slate-800/80 hover:bg-[#111827]/55"
                      }`}
                    >
                      <div class="flex items-center justify-between w-full mb-1">
                        <span class="text-xs font-bold text-slate-205">DNS Infrastructure Group</span>
                        <span class="text-[10px] bg-slate-900 border border-slate-800/80 font-mono px-1.5 py-0.2 rounded text-slate-400">TEMPLATE</span>
                      </div>
                      <p class="text-[10px] text-slate-500 leading-normal font-mono">Monitors response speeds for global public resolver servers (Cloudflare, Google Public, Quad9) every 15 seconds.</p>
                    </button>

                    {/* E-Commerce microservices */}
                    <button
                      onClick={() => handleApplyPreset("ecommerce")}
                      class={`w-full text-left p-3.5 rounded-xl border transition-all flex flex-col justify-between cursor-pointer shadow-sm ${
                        activePreset === "ecommerce"
                          ? "bg-[#111827]/80 border-emerald-500/50 shadow-emerald-500/10 scale-[1.01]"
                          : "bg-[#111827]/30 border-slate-850/65 hover:border-slate-800/80 hover:bg-[#111827]/55"
                      }`}
                    >
                      <div class="flex items-center justify-between w-full mb-1">
                        <span class="text-xs font-bold text-slate-205">E-Commerce Production</span>
                        <span class="text-[10px] bg-teal-950/50 border border-teal-900/50 font-mono px-1.5 py-0.2 rounded text-teal-400 font-bold">ALARM ACTIVE</span>
                      </div>
                      <p class="text-[10px] text-slate-500 leading-normal font-mono">Simulates a checkout pipeline. Intentionally contains a checkout lambda returning HTTP 500 to trigger outage webhook notifications.</p>
                    </button>

                    {/* Crypto Indexers */}
                    <button
                      onClick={() => handleApplyPreset("crypto")}
                      class={`w-full text-left p-3.5 rounded-xl border transition-all flex flex-col justify-between cursor-pointer shadow-sm ${
                        activePreset === "crypto"
                          ? "bg-[#111827]/80 border-emerald-500/50 shadow-emerald-500/10 scale-[1.01]"
                          : "bg-[#111827]/30 border-slate-850/65 hover:border-slate-800/80 hover:bg-[#111827]/55"
                      }`}
                    >
                      <div class="flex items-center justify-between w-full mb-1">
                        <span class="text-xs font-bold text-slate-205">Crypto Exchange Indices</span>
                        <span class="text-[10px] bg-slate-900 border border-slate-800/85 font-mono px-1.5 py-0.2 rounded text-slate-400">TEMPLATE</span>
                      </div>
                      <p class="text-[10px] text-slate-500 leading-normal font-mono">Pings real-time public exchange price endpoints (Binance API, Coinbase API, CoinGecko API) at 10 seconds intervals.</p>
                    </button>

                  </div>
                </div>

                {/* Micro instructions checklist */}
                <div class="bg-gradient-to-b from-[#111827]/40 to-[#0b0f19]/35 border border-slate-850/50 rounded-2xl p-5 text-xs text-slate-450 space-y-2.5">
                  <div class="flex items-center gap-2 text-slate-200 font-semibold mb-1 flex-row">
                    <ShieldCheck class="h-4 w-4 text-emerald-400" />
                    Config Validation Checks
                  </div>
                  <div class="flex items-start gap-1.5 pb-1 border-b border-slate-800/40 leading-normal font-mono text-[10px]">
                    <span class="text-emerald-400 font-bold">✓</span>
                    <span>All host strings must output to valid HTTP schemas.</span>
                  </div>
                  <div class="flex items-start gap-1.5 pb-1 border-b border-slate-800/40 leading-normal font-mono text-[10px]">
                    <span class="text-emerald-400 font-bold">✓</span>
                    <span>Expected statuses default to 200 checks if deleted.</span>
                  </div>
                  <div class="flex items-start gap-1.5 leading-normal font-mono text-[10px]">
                    <span class="text-emerald-400 font-bold">✓</span>
                    <span>Live thread scheduling is rescheduled on editing.</span>
                  </div>
                </div>

              </div>

            </div>
          )}

          {/* TAB 3: WEBHOOK INTEGRATIONS & ROLLING COMMUNICATOR FEED */}
          {activeTab === "webhooks" && (
            <div id="alarms_room_tab" class="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Column: Webhook config setups and diagnostic testing */}
              <div class="lg:col-span-4 space-y-5">
                
                {/* Integration Setup Card */}
                <div class="bg-gradient-to-b from-[#111827]/45 to-[#0b0f19]/35 border border-slate-850/50 rounded-2xl p-5.5 shadow-xl">
                  <h3 class="text-sm font-bold text-slate-205 mb-3.5 flex items-center gap-2">
                    <Send class="h-4 w-4 text-emerald-400" />
                    Channel configuration
                  </h3>
                  <p class="text-[11px] text-slate-500 font-mono mb-4 leading-relaxed">
                    The backend daemon dispatches elegant alerts to your channels using structured Slack Blocks or rich Discord Embed cards.
                  </p>

                  <div class="space-y-4">
                    <div>
                      <label class="block text-[10px] text-slate-450 font-mono font-bold uppercase mb-2 tracking-wider">Webhook endpoint URL</label>
                      <input
                        id="webhook_channel_url_box"
                        type="password"
                        value={webhookUrlTest}
                        onChange={(e) => setWebhookUrlTest(e.target.value)}
                        placeholder="e.g., https://discord.com/api/webhooks/..."
                        class="w-full px-3.5 py-2.5 bg-black/45 font-mono text-xs text-slate-300 border border-slate-850/70 rounded-xl focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 shadow-inner outline-none transition-all"
                      />
                      <span class="text-[9px] text-slate-500 font-mono mt-1.5 block leading-normal">Masked password view. Paste Slack or Discord hook URLs.</span>
                    </div>

                    <div class="p-4 bg-black/45 rounded-xl border border-slate-850/50 space-y-3 shadow-inner">
                      <div class="flex items-center justify-between text-xs text-slate-400 font-mono leading-normal font-semibold">
                        <span>Trigger conditions:</span>
                      </div>
                      <div class="flex items-center gap-2.5 text-xs text-slate-300 font-mono">
                        <CheckCircle class="h-3 w-3 text-emerald-400" />
                        <span>Service Status Changes</span>
                      </div>
                      <div class="flex items-center gap-2.5 text-xs text-slate-300 font-mono">
                        <CheckCircle class="h-3 w-3 text-emerald-400" />
                        <span>Latency spikes &gt; {latencyAlertThreshold}ms</span>
                      </div>
                    </div>

                    <button
                      onClick={handleTestWebhookUrl}
                      disabled={isTestingWebhook}
                      class="w-full justify-center flex items-center gap-2 px-4.5 py-2.5 bg-[#111827]/60 hover:bg-[#111827]/95 border border-slate-800/80 hover:border-slate-750 text-slate-350 hover:text-white text-xs font-bold rounded-xl shadow-md transition disabled:opacity-50 cursor-pointer"
                    >
                      <Activity class={`h-3.5 w-3.5 ${isTestingWebhook ? "animate-spin" : ""}`} />
                      {isTestingWebhook ? "Transmitting..." : "Send Verification Ping Alert"}
                    </button>
                  </div>
                </div>

                {/* Help card */}
                <div class="bg-gradient-to-b from-[#111827]/40 to-[#0b0f19]/35 border border-slate-850/50 rounded-2xl p-5 space-y-2.5 text-xs text-slate-500 leading-relaxed font-mono">
                  <div class="flex items-center gap-1.5 text-slate-350 font-semibold mb-1 flex-row">
                    <HelpCircle class="h-4 w-4 text-purple-400" />
                    How Webhooks fire
                  </div>
                  <p class="text-[10px] leading-relaxed">
                    Once you save your Webhook URL inside <span class="text-slate-400">hosts.yaml</span> (or write it to the input field and hit test), the daemon monitors every query run.
                  </p>
                  <p class="text-[10px] leading-relaxed">
                    If a server's <span class="text-slate-400">up</span> boolean drops from true to false, it formats a Discord red card or Slack block, dispatches it immediately, and logs the result down here.
                  </p>
                </div>

              </div>

              {/* Right column: rolling communicator feed logs lists */}
              <div class="lg:col-span-8 flex flex-col gap-4">
                <div class="bg-gradient-to-b from-[#111827]/45 to-[#0b0f19]/35 border border-slate-850/50 rounded-2xl p-5.5 shadow-xl flex-grow flex flex-col justify-between">
                  <div>
                    <div class="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                      <div>
                        <h3 class="text-sm font-bold text-slate-200 flex items-center gap-1.5 flex-row">
                          <Terminal class="h-4 w-4 text-amber-500" />
                          Daemon Incident Logs & Event Feed
                        </h3>
                        <p class="text-[11px] text-slate-550 font-mono mt-0.5">Rolling records of triggered alerts, outages, and recovered pipelines</p>
                      </div>
                      
                      <span class="text-[9px] font-mono border bg-black/45 text-slate-400 border-slate-800/80 px-2.5 py-0.5 rounded">
                        ROLLING CAP: 100
                      </span>
                    </div>

                    <div class="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                      {telemetry?.alerts && telemetry?.alerts?.length > 0 ? (
                        telemetry.alerts.map((log: AlertLog) => {
                          const isSent = log.status === "sent";
                          
                          let categoryBadge = "bg-amber-950/40 text-amber-400 border-amber-900/50";
                          let categoryLabel = "SPIKE";

                          if (log.type === "status_down") {
                            categoryBadge = "bg-rose-950/40 text-rose-400 border-rose-900/50";
                            categoryLabel = "OUTAGE";
                          } else if (log.type === "status_up") {
                            categoryBadge = "bg-emerald-950/40 text-emerald-400 border-emerald-900/50";
                            categoryLabel = "RESTORED";
                          } else if (log.type === "test") {
                            categoryBadge = "bg-purple-950/40 text-purple-400 border-purple-900/50";
                            categoryLabel = "DIAGNOSTIC";
                          }

                          return (
                            <div
                              key={log.id}
                              class="bg-black/25 border border-slate-850/40 p-3.5 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3 font-mono text-[11px] hover:border-slate-800/80 transition-colors duration-200"
                            >
                              <div class="flex items-start gap-3">
                                <span class={`px-2 py-0.5 text-[9px] border rounded font-extrabold ${categoryBadge}`}>
                                  {categoryLabel}
                                </span>
                                <div>
                                  <h4 class="text-xs font-bold text-slate-200 mt-0.5 leading-snug">{log.message}</h4>
                                  <span class="text-[10px] text-slate-450 leading-relaxed block mt-0.5">{log.details}</span>
                                </div>
                              </div>

                              <div class="text-right flex flex-row md:flex-col items-center md:items-end justify-between w-full md:w-auto mt-2 md:mt-0 font-mono text-[10px] border-t border-slate-800/40 md:border-none pt-1.5 md:pt-0 gap-2">
                                <span class="text-slate-350">{log.hostName}</span>
                                <div class="flex items-center gap-1.5">
                                  <span class={isSent ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                                    {isSent ? "✓ DELIVERED" : "✗ FAILURE"}
                                  </span>
                                  <span class="text-slate-500 font-sans">
                                    {new Date(log.timestamp).toLocaleTimeString()}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div class="text-center py-10 border border-dashed border-slate-850/50 rounded-xl bg-slate-950/20">
                          <p class="text-xs text-slate-500 leading-relaxed font-mono">
                            No telemetry incident alerts triggered. Core channels are quiet and healthy.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Diagnostic details */}
                  <div class="mt-4 pt-3.5 border-t border-slate-800 text-[10px] text-slate-500 font-mono flex items-center justify-between gap-4">
                    <span>Daemon monitor state: synchronized with YAML parameters</span>
                    <span>Snapshot evaluation: {new Date().toLocaleTimeString()}</span>
                  </div>

                </div>
              </div>

            </div>
          )}

        </div>

      </main>

      {/* Console Footer */}
      <footer class="border-t border-slate-900/60 bg-[#060811] py-8 mt-12 text-slate-500 text-xs font-mono">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div class="flex items-center gap-2">
            <Laptop class="h-4 w-4 text-slate-600" />
            <span>Telemetry Network Daemon v1.0.0 &bull; Standing Active</span>
          </div>
          <div class="flex items-center gap-6">
            <span>Uptime: 100.0%</span>
            <span>Local system time: 2026-05-25</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
