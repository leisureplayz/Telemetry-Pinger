export interface WebhookConfig {
  enabled: boolean;
  url: string;
  alert_on_status_change: boolean;
  alert_on_latency_spike: boolean;
  latency_threshold_ms: number;
}

export interface HostConfig {
  id: string;
  name: string;
  url: string;
  expected_status: number;
}

export interface YamlConfig {
  config: {
    interval_seconds: number;
    timeout_seconds: number;
    webhook: WebhookConfig;
  };
  hosts: HostConfig[];
}

export interface PingHistoryItem {
  timestamp: number;
  latencyMs: number;
  statusCode: number;
  up: boolean;
  error: string | null;
}

export interface HostState extends HostConfig {
  up: boolean;
  lastPingTime: number;
  lastLatency: number;
  lastStatusCode: number;
  lastError: string | null;
  history: PingHistoryItem[];
  uptimePercentage: number;
  avgLatency: number;
}

export interface AlertLog {
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

export interface TelemetryData {
  hosts: HostState[];
  config: {
    interval_seconds: number;
    timeout_seconds: number;
    webhook: WebhookConfig;
  };
  alerts: AlertLog[];
  isPinging: boolean;
}
