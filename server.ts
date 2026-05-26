import express from "express";
import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Configuration and State Interfaces
interface WebhookConfig {
  enabled: boolean;
  url: string;
  alert_on_status_change: boolean;
  alert_on_latency_spike: boolean;
  latency_threshold_ms: number;
}

interface HostConfig {
  id: string;
  name: string;
  url: string;
  expected_status: number;
}

interface YamlConfig {
  config: {
    interval_seconds: number;
    timeout_seconds: number;
    webhook: WebhookConfig;
  };
  hosts: HostConfig[];
}

interface PingHistoryItem {
  timestamp: number;
  latencyMs: number;
  statusCode: number;
  up: boolean;
  error: string | null;
}

interface HostState extends HostConfig {
  up: boolean;
  lastPingTime: number;
  lastLatency: number;
  lastStatusCode: number;
  lastError: string | null;
  history: PingHistoryItem[];
  uptimePercentage: number;
  avgLatency: number;
}

interface AlertLog {
  id: string;
  timestamp: string;
  hostId: string;
  hostName: string;
  url: string;
  type: "status_down" | "status_up" | "latency_spike" | "test";
  message: string;
  status: "sent" | "failed";
  details: string;
}

// In-memory telemetry database
let activeConfig: YamlConfig = {
  config: {
    interval_seconds: 10,
    timeout_seconds: 5,
    webhook: {
      enabled: false,
      url: "",
      alert_on_status_change: true,
      alert_on_latency_spike: true,
      latency_threshold_ms: 800,
    },
  },
  hosts: [],
};

let hostStates: Map<string, HostState> = new Map();
let alertLogs: AlertLog[] = [];
let daemonTimer: NodeJS.Timeout | null = null;
let isPinging = false;

// Helpers to load / save YAML Configuration
const CONFIG_PATH = path.join(process.cwd(), "hosts.yaml");

function loadConfiguration() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const fileContents = fs.readFileSync(CONFIG_PATH, "utf8");
      const parsed = yaml.load(fileContents) as YamlConfig;
      if (parsed && typeof parsed === "object") {
        activeConfig = {
          config: {
            interval_seconds: Number(parsed?.config?.interval_seconds ?? 10),
            timeout_seconds: Number(parsed?.config?.timeout_seconds ?? 5),
            webhook: {
              enabled: Boolean(parsed?.config?.webhook?.enabled ?? false),
              url: String(parsed?.config?.webhook?.url ?? ""),
              alert_on_status_change: Boolean(parsed?.config?.webhook?.alert_on_status_change ?? true),
              alert_on_latency_spike: Boolean(parsed?.config?.webhook?.alert_on_latency_spike ?? true),
              latency_threshold_ms: Number(parsed?.config?.webhook?.latency_threshold_ms ?? 800),
            },
          },
          hosts: Array.isArray(parsed?.hosts) ? parsed.hosts : [],
        };
        console.log("YAML config loaded successfully:", activeConfig.hosts?.length, "hosts configured.");
      }
    } else {
      console.warn("hosts.yaml not found, writing default fallback.");
      saveConfigurationDefault();
    }
  } catch (error) {
    console.error("Error reading or parsing hosts.yaml:", error);
  }

  // Sync state map with updated config hosts
  const currentHosts = activeConfig.hosts || [];
  const activeIds = new Set(currentHosts.map(h => h.id));

  // Remove untracked host states
  for (const hostId of hostStates.keys()) {
    if (!activeIds.has(hostId)) {
      hostStates.delete(hostId);
    }
  }

  // Initialize or update existing mappings
  for (const h of currentHosts) {
    const existing = hostStates.get(h.id);
    if (!existing) {
      hostStates.set(h.id, {
        ...h,
        up: true, // Optimistically start as true until first ping
        lastPingTime: 0,
        lastLatency: 0,
        lastStatusCode: 200,
        lastError: null,
        history: [],
        uptimePercentage: 100,
        avgLatency: 0,
      });
    } else {
      // Update config metadata but preserve operational metrics
      existing.name = h.name;
      existing.url = h.url;
      existing.expected_status = h.expected_status;
    }
  }
}

function saveConfigurationDefault() {
  const defaultContent = `config:
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
`;
  try {
    fs.writeFileSync(CONFIG_PATH, defaultContent, "utf8");
    console.log("Default hosts.yaml created.");
  } catch (err) {
    console.error("Error creating default hosts.yaml:", err);
  }
}

// Fire Real-time Third-party Webhook alerts (Discord, Slack, Custom)
async function triggerWebhook(alert: {
  hostId: string;
  hostName: string;
  url: string;
  type: "status_down" | "status_up" | "latency_spike" | "test";
  message: string;
  subtitle: string;
}) {
  const cfg = activeConfig.config.webhook;
  if (!cfg.enabled || !cfg.url) {
    return;
  }

  let logItem: AlertLog = {
    id: "alert_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    timestamp: new Date().toISOString(),
    hostId: alert.hostId,
    hostName: alert.hostName,
    url: alert.url,
    type: alert.type,
    message: alert.message,
    status: "failed",
    details: "",
  };

  try {
    const isDiscord = cfg.url.includes("discord.com/api/webhooks");
    const isSlack = cfg.url.includes("hooks.slack.com/services");
    
    let payload: any = {};
    const colorInt = alert.type === "status_down" ? 15158332 : alert.type === "status_up" ? 3066993 : 16753920; // hex red, green, orange
    const alertEmoji = alert.type === "status_down" ? "🔴" : alert.type === "status_up" ? "🟢" : "⚠️";

    if (isDiscord) {
      payload = {
        username: "Telemetry Network Daemon",
        avatar_url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&auto=format&fit=crop&q=60", // abstract vector art URL
        embeds: [
          {
            title: `${alertEmoji} ${alert.message}`,
            description: alert.subtitle,
            color: colorInt,
            timestamp: new Date().toISOString(),
            fields: [
              { name: "Service Name", value: alert.hostName, inline: true },
              { name: "Endpoint URL", value: alert.url, inline: true },
              { name: "Event Category", value: alert.type.replace("_", " ").toUpperCase(), inline: true },
            ],
            footer: {
              text: "Telemetry Pinger Engine • Production Monitoring",
            },
          },
        ],
      };
    } else if (isSlack) {
      payload = {
        text: `${alertEmoji} *${alert.message}*\n>${alert.subtitle}\n*Service:* ${alert.hostName} | *Endpoint:* ${alert.url}`,
      };
    } else {
      // Generic Webhook payload
      payload = {
        event: alert.type,
        host_id: alert.hostId,
        host_name: alert.hostName,
        url: alert.url,
        timestamp: Date.now(),
        message: alert.message,
        details: alert.subtitle,
      };
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 8000);

    const response = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });

    clearTimeout(timeout);
    
    if (response.ok) {
      logItem.status = "sent";
      logItem.details = `Delivered successfully to ${isDiscord ? "Discord" : isSlack ? "Slack" : "Web Address"}. Status: ${response.status}`;
    } else {
      logItem.details = `Webhook endpoint returned non-successful response: ${response.status} ${response.statusText}`;
    }
  } catch (err: any) {
    logItem.details = `Failure delivering webhook communication: ${err?.message || err}`;
  }

  // Push to local logs and keep it rolling under 100 entries.
  alertLogs.unshift(logItem);
  if (alertLogs.length > 100) {
    alertLogs.pop();
  }
}

// Generate the beautiful, comprehensive standalone HTML status page
function compileHtmlStatusPage() {
  const currentTimestamp = new Date().toUTCString();
  const hostsArray = Array.from(hostStates.values());
  const globalIncidentLog = alertLogs.slice(0, 15);

  let downHosts = hostsArray.filter(h => !h.up);
  let overallStatusColor = "bg-emerald-600";
  let overallStatusText = "All Core Services Operational";
  let overallStatusSub = "Network routes are optimal and system latency profiles are inside nominal thresholds.";

  if (downHosts.length > 0) {
    overallStatusColor = "bg-rose-600";
    overallStatusText = `${downHosts.length} Service${downHosts.length > 1 ? "s" : ""} Experiencing Outage`;
    overallStatusSub = `Connection failures detected across monitored environments. Immediate remediation recommended.`;
  } else {
    // Check for high latency profiles
    const warningHosts = hostsArray.filter(h => h.up && h.lastLatency > activeConfig.config.webhook.latency_threshold_ms);
    if (warningHosts.length > 0) {
      overallStatusColor = "bg-amber-500";
      overallStatusText = `System Performance Degradation`;
      overallStatusSub = `${warningHosts.length} endpoint${warningHosts.length > 1 ? "s are" : " is"} displaying latency exceeding thresholds.`;
    }
  }

  // Compile individual cards
  let hostCardsHtml = "";
  for (const h of hostsArray) {
    const isUp = h.up;
    const badgeColor = isUp ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20";
    const statusDot = isUp ? "bg-emerald-500" : "bg-rose-500 animate-pulse";
    const statusTextLabel = isUp ? "OPERATIONAL" : "OUTAGE";

    // Trace status bar (last 20 checks)
    const normalizedHistory = [...h.history].slice(-24);
    // pad to 24 items if fewer exist
    while (normalizedHistory.length < 24) {
      normalizedHistory.unshift({ timestamp: 0, latencyMs: 0, statusCode: 0, up: true, error: null });
    }

    let historyDotsHtml = "";
    for (const tick of normalizedHistory) {
      if (tick.timestamp === 0) {
        // empty spacer
        historyDotsHtml += `<div class="h-6 w-1.5 rounded-full bg-[#1e293b]/50" title="No history recorded"></div>`;
      } else {
        const titleText = `${new Date(tick.timestamp).toLocaleTimeString()} - Latency: ${tick.latencyMs}ms, Code: ${tick.statusCode}${tick.error ? `, Err: ${tick.error}` : ""}`;
        const dotBg = tick.up 
          ? (tick.latencyMs > activeConfig.config.webhook.latency_threshold_ms ? "bg-amber-400" : "bg-emerald-500") 
          : "bg-rose-500";
        historyDotsHtml += `<div class="h-6 w-1.5 rounded-full ${dotBg} hover:scale-125 transition-transform cursor-pointer" title="${titleText}"></div>`;
      }
    }

    hostCardsHtml += `
    <div class="bg-[#0f172a] border border-[#1e293b] rounded-xl p-5 shadow-lg flex flex-col justify-between transition-all duration-200 hover:border-[#334155]">
      <div>
        <div class="flex items-center justify-between gap-2 mb-3">
          <div class="flex items-center gap-2">
            <span class="flex h-2.5 w-2.5 rounded-full ${statusDot}"></span>
            <h3 class="text-base font-semibold text-slate-100 tracking-tight">${h.name}</h3>
          </div>
          <span class="px-2 py-0.5 text-[10px] font-mono border rounded-full ${badgeColor}">${statusTextLabel}</span>
        </div>
        
        <p class="text-xs text-slate-400 font-mono select-all truncate mb-4" title="${h.url}">${h.url}</p>
        
        <div class="grid grid-cols-3 gap-2 py-3 border-t border-b border-slate-800/60 mb-4 text-center">
          <div>
            <div class="text-[10px] text-slate-500 font-medium">REALTIME LATENCY</div>
            <div class="text-sm font-mono font-semibold text-slate-200 mt-0.5">${isUp ? `${h.lastLatency} ms` : "—"}</div>
          </div>
          <div>
            <div class="text-[10px] text-slate-500 font-medium">AVG LATENCY</div>
            <div class="text-sm font-mono font-semibold text-slate-200 mt-0.5">${h.avgLatency > 0 ? `${h.avgLatency} ms` : "—"}</div>
          </div>
          <div>
            <div class="text-[10px] text-slate-500 font-medium">UPTIME SCORE</div>
            <div class="text-sm font-mono font-semibold text-emerald-400 mt-0.5">${h.uptimePercentage.toFixed(1)}%</div>
          </div>
        </div>
      </div>

      <div>
        <div class="flex items-center justify-between text-[11px] text-slate-500 mb-1.5">
          <span>Operational History (Last 24 cycles)</span>
          <span>${h.uptimePercentage.toFixed(1)}% Uptime</span>
        </div>
        <div class="flex gap-1 justify-between mb-2">
          ${historyDotsHtml}
        </div>
        
        <div class="flex items-center justify-between text-[10px] text-slate-600 font-mono">
          <span>4h ago</span>
          <span>Last tested: ${h.lastPingTime > 0 ? new Date(h.lastPingTime).toLocaleTimeString() : "Pending"}</span>
          <span>Now</span>
        </div>
      </div>
    </div>
    `;
  }

  // Compile incident logs
  let incidentLogRows = "";
  if (globalIncidentLog.length === 0) {
    incidentLogRows = `
    <div class="text-center py-8 border border-dashed border-slate-800 rounded-xl">
      <p class="text-sm text-slate-500 font-mono">No telemetry incident logs recorded. Core infrastructure remains robust.</p>
    </div>`;
  } else {
    for (const log of globalIncidentLog) {
      const typeBadge = log.type === "status_down" 
        ? "bg-rose-950/40 text-rose-400 border-rose-900/50" 
        : log.type === "status_up" 
          ? "bg-emerald-950/40 text-emerald-400 border-emerald-900/50" 
          : "bg-amber-950/40 text-amber-400 border-amber-900/50";
      
      const categoryLabel = log.type === "status_down" 
        ? "OUTAGE" 
        : log.type === "status_up" 
          ? "RESTORED" 
          : log.type === "test" 
            ? "MONITOR" 
            : "SPIKE";

      incidentLogRows += `
      <div class="flex flex-col md:flex-row items-start md:items-center justify-between p-3.5 bg-[#0f172a] border border-[#1e293b] rounded-lg gap-3">
        <div class="flex items-start md:items-center gap-3">
          <span class="px-2 py-0.5 text-[9px] font-mono border rounded ${typeBadge}">${categoryLabel}</span>
          <div>
            <h4 class="text-sm font-medium text-slate-200">${log.message}</h4>
            <span class="text-xs text-slate-400 font-mono">${log.details}</span>
          </div>
        </div>
        <div class="text-right flex flex-row md:flex-col items-center md:items-end justify-between w-full md:w-auto mt-2 md:mt-0 font-mono border-t border-slate-800/40 md:border-none pt-2 md:pt-0">
          <span class="text-xs text-slate-400">${log.hostName}</span>
          <span class="text-[10px] text-slate-500">${new Date(log.timestamp).toLocaleTimeString()} (${new Date(log.timestamp).toLocaleDateString()})</span>
        </div>
      </div>
      `;
    }
  }

  const outputHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Infrastructure Status | Telemetry Pinger</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body {
      background-color: #020617;
    }
  </style>
</head>
<body class="text-slate-100 min-h-screen font-sans flex flex-col justify-between">

  <!-- Header Banner -->
  <div class="border-b border-[#1e293b] bg-[#090d1f] backdrop-blur-md sticky top-0 z-50">
    <div class="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="h-9 w-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-activity"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0L6.41 10.54a2 2 0 0 1-1.93 1.46H2"/></svg>
        </div>
        <div>
          <h1 class="text-lg font-bold text-slate-100 uppercase tracking-wider font-mono">Status Board</h1>
          <p class="text-xs text-slate-400 font-mono">Telemetry Network Prober Daemon</p>
        </div>
      </div>

      <div class="flex items-center gap-4">
        <span class="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono bg-slate-900 border border-slate-800 text-slate-400">
          <span class="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping"></span>
          DAEMON ONLINE
        </span>
        <button onclick="window.location.reload()" class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#0f172a] hover:bg-[#1e293b] border border-[#1e293b] text-slate-300 transition">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
          Reload
        </button>
      </div>
    </div>
  </div>

  <!-- Main Container -->
  <main class="max-w-6xl mx-auto px-4 py-8 flex-grow w-full">
    
    <!-- Big Overall Status Card -->
    <div class="${overallStatusColor} rounded-2xl p-6 md:p-8 shadow-2xl mb-8 border border-white/10 relative overflow-hidden">
      <!-- Glow Decorator -->
      <div class="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/10 blur-3xl"></div>
      
      <div class="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <h2 class="text-2xl md:text-3xl font-extrabold tracking-tight text-white mb-2">${overallStatusText}</h2>
          <p class="text-white/80 text-sm md:text-base max-w-2xl">${overallStatusSub}</p>
        </div>
        <div class="bg-black/20 backdrop-blur-sm self-stretch md:self-auto px-5 py-3 rounded-xl border border-white/5 font-mono text-xs text-white/90">
          <div class="mb-1">LAST EVALUATED:</div>
          <div class="font-bold">${currentTimestamp}</div>
          <div class="mt-2 text-[10px] text-white/60">INTERVAL CYCLE: Every ${activeConfig.config.interval_seconds}s</div>
        </div>
      </div>
    </div>

    <!-- Monitored Enclaves Grid -->
    <h3 class="text-xs font-bold tracking-widest text-slate-400 font-mono uppercase mb-4">MONITORED TARGET SERVICES</h3>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-5 mb-10">
      ${hostCardsHtml}
    </div>

    <!-- Global Operations Log -->
    <div class="bg-[#090d1f] border border-[#1e293b] rounded-2xl p-5 shadow-xl">
      <div class="flex items-center justify-between mb-5">
        <div>
          <h3 class="text-base font-bold text-slate-100">Daemon Incident Feed</h3>
          <p class="text-xs text-slate-500 font-mono">Chronological list of outages, recoveries, and latency triggers</p>
        </div>
        <span class="text-[10px] font-mono text-slate-400 border border-slate-800 bg-[#0f172a]/80 px-2.5 py-1 rounded">
          ROLLING LOGS CAP: 100
        </span>
      </div>

      <div class="space-y-3">
        ${incidentLogRows}
      </div>
    </div>

  </main>

  <!-- Footer block -->
  <footer class="border-t border-[#1e293b] bg-[#040815] py-6 mt-12">
    <div class="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between text-slate-500 text-xs font-mono gap-4">
      <div>
        <span>Telemetry Pinger Engine &bull; Built in Node.js &bull; Client Offline Compliant</span>
      </div>
      <div>
        <span>Generated snapshot: ${currentTimestamp}</span>
      </div>
    </div>
  </footer>

</body>
</html>`;

  // Write status.html to the public folder (available live in browser at /status.html) Wait, let's make sure directories exist
  const publicDir = path.join(process.cwd(), "public");
  const distDir = path.join(process.cwd(), "dist");

  try {
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    fs.writeFileSync(path.join(publicDir, "status.html"), outputHtml, "utf8");
    
    // Also write to dist for production runtime if dist is already present
    if (fs.existsSync(distDir)) {
      fs.writeFileSync(path.join(distDir, "status.html"), outputHtml, "utf8");
    }
  } catch (err) {
    console.error("Error writing static status.html file:", err);
  }

  return outputHtml;
}

// Daemon Ping Function
async function executePingCycle() {
  if (isPinging) return;
  isPinging = true;

  try {
    const timeoutSeconds = activeConfig.config.timeout_seconds || 5;
    const hostsToPing = Array.from(hostStates.values());

    const pingPromises = hostsToPing.map(async (host) => {
      const abortController = new AbortController();
      const nativeTimeoutId = setTimeout(() => abortController.abort(), timeoutSeconds * 1000);

      const startTime = Date.now();
      let statusCode = 0;
      let latencyMs = 0;
      let up = false;
      let errorStr: string | null = null;

      try {
        const response = await fetch(host.url, {
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; TelemetryPinger/1.0; BackgroundProberDaemon)",
          },
          signal: abortController.signal,
        });

        statusCode = response.status;
        latencyMs = Math.round(Date.now() - startTime);
        
        // Match status
        if (host.expected_status) {
          up = (statusCode === host.expected_status);
          if (!up) {
            errorStr = `Expected ${host.expected_status}, but received ${statusCode}`;
          }
        } else {
          up = response.ok;
          if (!up) {
            errorStr = `HTTP non-success code: ${statusCode}`;
          }
        }
      } catch (err: any) {
        latencyMs = Math.round(Date.now() - startTime);
        if (err.name === "AbortError" || err.message?.toLowerCase().includes("timeout")) {
          errorStr = "Connection request timed out";
        } else {
          errorStr = err?.message || "DNS resolve error or host unreachable";
        }
        statusCode = 0;
        up = false;
      } finally {
        clearTimeout(nativeTimeoutId);
      }

      // Read current state
      const state = hostStates.get(host.id);
      if (state) {
        // Track stats and evaluate triggers for webhooks
        const oldUp = state.up;
        const currentHookConfig = activeConfig.config.webhook;

        // Trigger Alert logic: Service Down
        if (oldUp && !up) {
          console.log(`[PINGER] Host ${host.name} (${host.id}) went DOWN. Triggering alert...`);
          await triggerWebhook({
            hostId: host.id,
            hostName: host.name,
            url: host.url,
            type: "status_down",
            message: `OUTAGE: Service Offline - ${host.name}`,
            subtitle: `The host did not respond with expected criteria. Reason: ${errorStr || "HTTP Status Code error."}`,
          });
        }
        // Trigger Alert logic: Service Restored
        else if (!oldUp && up) {
          console.log(`[PINGER] Host ${host.name} (${host.id}) restored UP. Triggering alert...`);
          await triggerWebhook({
            hostId: host.id,
            hostName: host.name,
            url: host.url,
            type: "status_up",
            message: `RECOVERY: Service Restored - ${host.name}`,
            subtitle: `The host returned to online production status successfully. Response latency: ${latencyMs} ms.`,
          });
        }
        // Trigger Alert logic: Latency Spike
        else if (up && currentHookConfig.alert_on_latency_spike && latencyMs > currentHookConfig.latency_threshold_ms) {
          // Verify if previous check was healthy to prevent notification flood
          const lastPingItem = state.history[state.history.length - 1];
          const wasSpiking = lastPingItem && lastPingItem.up && lastPingItem.latencyMs > currentHookConfig.latency_threshold_ms;
          
          if (!wasSpiking) {
            console.log(`[PINGER] Host ${host.name} latency spiked to ${latencyMs}ms. Triggering alert...`);
            await triggerWebhook({
              hostId: host.id,
              hostName: host.name,
              url: host.url,
              type: "latency_spike",
              message: `LATENCY SPIKE: Sluggish Endpoint - ${host.name}`,
              subtitle: `Service is sluggish. Latency clocked at ${latencyMs}ms, exceeding nominal threshold profile of ${currentHookConfig.latency_threshold_ms}ms.`,
            });
          }
        }

        // Apply state updates
        state.up = up;
        state.lastPingTime = Date.now();
        state.lastLatency = latencyMs;
        state.lastStatusCode = statusCode;
        state.lastError = errorStr;

        // Append to history log
        state.history.push({
          timestamp: Date.now(),
          latencyMs,
          statusCode,
          up,
          error: errorStr,
        });

        // Cap history to last 50 entries
        if (state.history.length > 50) {
          state.history.shift();
        }

        // Recalculate rolling stats
        const relevantHistory = state.history;
        const totalPings = relevantHistory.length;
        const healthyPings = relevantHistory.filter(h => h.up).length;
        state.uptimePercentage = totalPings > 0 ? (healthyPings / totalPings) * 100 : 100;

        const uptimeWeights = relevantHistory.filter(h => h.up && h.latencyMs > 0);
        state.avgLatency = uptimeWeights.length > 0
          ? Math.round(uptimeWeights.reduce((acc, current) => acc + current.latencyMs, 0) / uptimeWeights.length)
          : latencyMs;
      }
    });

    await Promise.all(pingPromises);

    // Save and build latest static status page files
    compileHtmlStatusPage();

  } catch (err) {
    console.error("Critical error in daemon query interval loop:", err);
  } finally {
    isPinging = false;
  }
}

// Boot up daemon prober clock
function startTelemetryDaemon() {
  stopTelemetryDaemon();

  // Load configuration initially
  loadConfiguration();

  // Execute first query run right away with silent catch
  executePingCycle().catch(console.error);

  const secs = activeConfig.config?.interval_seconds || 10;
  console.log(`Scheduling network prober interval clock: every ${secs} seconds.`);
  
  daemonTimer = setInterval(() => {
    executePingCycle().catch(console.error);
  }, secs * 1000);
}

// Tear down daemon prober clock
function stopTelemetryDaemon() {
  if (daemonTimer) {
    clearInterval(daemonTimer);
    daemonTimer = null;
    console.log("Telemetry daemon background thread cancelled.");
  }
}

// Boot background prober
startTelemetryDaemon();


// Express Endpoint Definitions

// 1. Get current status, target details, metrics, history, alerts, and debug info
app.get("/api/telemetry", (req, res) => {
  const list = Array.from(hostStates.values());
  res.json({
    hosts: list,
    config: activeConfig.config,
    alerts: alertLogs,
    isPinging,
  });
});

// 2. Fetch raw text content and parsed profile of hosts.yaml for config editor UI
app.get("/api/config", (req, res) => {
  try {
    let rawContent = "";
    if (fs.existsSync(CONFIG_PATH)) {
      rawContent = fs.readFileSync(CONFIG_PATH, "utf8");
    } else {
      rawContent = "hosts.yaml target missing.";
    }
    res.json({
      rawContent,
      parsed: activeConfig,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read hosts.yaml configuration file: " + err?.message });
  }
});

// 3. Save hosts.yaml configuration updates & hot-reload daemon instantly
app.post("/api/config", (req, res) => {
  const { rawContent } = req.body;
  
  if (!rawContent || typeof rawContent !== "string") {
    return res.status(400).json({ error: "Invalid payload input structure." });
  }

  try {
    // Validate syntax before committing to server storage
    const parsed = yaml.load(rawContent) as any;
    if (!parsed || typeof parsed !== "object" || !parsed.hosts) {
      return res.status(400).json({ error: "Check YAML syntax context. Schema must outline 'hosts: []' block." });
    }

    if (parsed.hosts && !Array.isArray(parsed.hosts)) {
      return res.status(400).json({ error: "Property 'hosts' must represent a sequential list of targeted endpoints." });
    }

    // Write file back to hosts.yaml safely
    fs.writeFileSync(CONFIG_PATH, rawContent, "utf8");

    // Hot-reload config maps & recreate background loop intervals immediately
    console.log("Saved live edits to hosts.yaml. Rescheduling background monitoring threads...");
    startTelemetryDaemon();

    return res.json({
      success: true,
      message: "Configuration committed successfully. Network daemon synchronized.",
      parsed: activeConfig,
    });
  } catch (err: any) {
    return res.status(400).json({ error: "YAML compilation or parsing check failed: " + err?.message });
  }
});

// 4. Test Webhook configuration to trigger inline alert message
app.post("/api/test-webhook", async (req, res) => {
  const { url } = req.body;

  if (url) {
    // Temporarily swap config or trigger specifically
    const oldUrl = activeConfig.config.webhook.url;
    const oldEnabled = activeConfig.config.webhook.enabled;

    activeConfig.config.webhook.url = url;
    activeConfig.config.webhook.enabled = true;

    try {
      await triggerWebhook({
        hostId: "test_endpoint",
        hostName: "System Diagnostics Probe",
        url: "https://diagnostics.telemetry.local",
        type: "test",
        message: "SYSTEM MONITORS ACTIVE",
        subtitle: "This is a configuration verification broadcast. Webhook integration confirmed healthy.",
      });

      // Restore old ones
      activeConfig.config.webhook.url = oldUrl;
      activeConfig.config.webhook.enabled = oldEnabled;

      return res.json({ success: true, message: "Diagnostic alert fired successfully. Review communication logs below." });
    } catch (err: any) {
      activeConfig.config.webhook.url = oldUrl;
      activeConfig.config.webhook.enabled = oldEnabled;
      return res.status(500).json({ error: "Webhook diagnostic delivery threw error details: " + err?.message });
    }
  } else {
    // Fire with current active configs
    if (!activeConfig.config.webhook.enabled || !activeConfig.config.webhook.url) {
      return res.status(422).json({ error: "Webhooks are disabled in config. Enable webhooks or input a URL path first." });
    }

    try {
      await triggerWebhook({
        hostId: "test_endpoint",
        hostName: "System Diagnostics Probe",
        url: "https://diagnostics.telemetry.local",
        type: "test",
        message: "SYSTEM DIAGNOSTICS BROADCAST",
        subtitle: "Manual system diagnostics check triggered. All webhook routing channels verified healthy.",
      });

      return res.json({ success: true, message: "Diagnostic alert fired successfully. Review communication logs below." });
    } catch (err: any) {
      return res.status(500).json({ error: "Webhook diagnostic delivery threw error: " + err?.message });
    }
  }
});

// 5. Force background loop ping sequence manual execution
app.post("/api/force-ping", async (req, res) => {
  if (isPinging) {
    return res.status(409).json({ error: "A ping telemetry sweep cycle is already underway." });
  }

  try {
    await executePingCycle();
    res.json({ success: true, message: "Diagnostics sweep query cycle executed successfully." });
  } catch (err: any) {
    res.status(500).json({ error: "Forced sweep interval execution failed: " + err?.message });
  }
});

// 6. Return standard generated status.html standalone page
app.get("/api/status-page", (req, res) => {
  const currentHtml = compileHtmlStatusPage();
  res.setHeader("Content-Type", "text/html");
  res.send(currentHtml);
});

// 7. Download status.html as static file attachment
app.get("/api/status-page/download", (req, res) => {
  const currentHtml = compileHtmlStatusPage();
  res.setHeader("Content-Disposition", "attachment; filename=status.html");
  res.setHeader("Content-Type", "text/html");
  res.send(currentHtml);
});


// Serve React / Vite assets
async function bootstrapWebServer() {
  if (process.env.NODE_ENV !== "production") {
    // Mount Vite Dev Server middleware inside express
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Express static handlers for prebuilt Vite distribution directory
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    
    // Serve fallback index.html for index URL routes (React Router etc)
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Telemetry Server running on interface http://localhost:${PORT}`);
  });
}

bootstrapWebServer().catch((err) => {
  console.error("Fatal exception in server asset setup:", err);
  process.exit(1);
});
