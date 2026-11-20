import React, { useState } from "react";
import {
  Globe,
  X,
  Play,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  Sparkles,
  Plus,
  Trash2,
} from "lucide-react";
import { testApiSource, connectApiDataset } from "../../api/datasets.js";
import type { DatasetUploadResponse, ApiSourceConfig, ApiTestResponse } from "@ai-vis/types";

interface ApiConnectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (data: DatasetUploadResponse) => void;
}

interface ApiPreset {
  id: string;
  name: string;
  description: string;
  url: string;
  dataPath?: string;
  refreshSeconds: number;
}

const PRESETS: ApiPreset[] = [
  {
    id: "crypto",
    name: "Live Crypto Markets (CoinGecko)",
    description: "Top cryptocurrency market prices, 24h volume, and market caps",
    url: "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=25&page=1",
    dataPath: "",
    refreshSeconds: 30,
  },
  {
    id: "weather",
    name: "Open-Meteo Weather Metrics",
    description: "7-day hourly temperature, humidity, and wind speed forecasts",
    url: "https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m&forecast_days=7",
    dataPath: "hourly",
    refreshSeconds: 60,
  },
  {
    id: "json_posts",
    name: "JSONPlaceholder Analytics",
    description: "Live mock user content and feed metrics for quick testing",
    url: "https://jsonplaceholder.typicode.com/posts",
    dataPath: "",
    refreshSeconds: 0,
  },
];

export const ApiConnectorModal: React.FC<ApiConnectorModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [datasetName, setDatasetName] = useState<string>("Live API Dataset");
  const [url, setUrl] = useState<string>("");
  const [method, setMethod] = useState<"GET" | "POST">("GET");
  const [dataPath, setDataPath] = useState<string>("");
  const [refreshInterval, setRefreshInterval] = useState<number>(30);
  const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>([]);

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ApiTestResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleApplyPreset = (preset: ApiPreset) => {
    setDatasetName(preset.name);
    setUrl(preset.url);
    setDataPath(preset.dataPath || "");
    setRefreshInterval(preset.refreshSeconds);
    setTestResult(null);
    setTestError(null);
  };

  const handleAddHeader = () => {
    setHeaders([...headers, { key: "", value: "" }]);
  };

  const handleUpdateHeader = (index: number, field: "key" | "value", val: string) => {
    const updated = [...headers];
    updated[index][field] = val;
    setHeaders(updated);
  };

  const handleRemoveHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index));
  };

  const getHeadersRecord = (): Record<string, string> => {
    const rec: Record<string, string> = {};
    for (const h of headers) {
      if (h.key.trim()) {
        rec[h.key.trim()] = h.value.trim();
      }
    }
    return rec;
  };

  const handleTestConnection = async () => {
    if (!url.trim()) {
      setTestError("Please enter an API endpoint URL.");
      return;
    }

    setIsTesting(true);
    setTestError(null);
    setTestResult(null);

    const config: ApiSourceConfig = {
      url: url.trim(),
      method,
      dataPath: dataPath.trim() || undefined,
      headers: Object.keys(getHeadersRecord()).length > 0 ? getHeadersRecord() : undefined,
      refreshIntervalSeconds: refreshInterval,
    };

    try {
      const result = await testApiSource(config);
      setTestResult(result);
      if (!result.valid) {
        setTestError(result.message || "Failed to retrieve tabular data from API.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to test API connection.";
      setTestError(msg);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!datasetName.trim()) {
      setSubmitError("Please enter a dataset name.");
      return;
    }
    if (!url.trim()) {
      setSubmitError("Please enter an API endpoint URL.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const config: ApiSourceConfig = {
      url: url.trim(),
      method,
      dataPath: dataPath.trim() || undefined,
      headers: Object.keys(getHeadersRecord()).length > 0 ? getHeadersRecord() : undefined,
      refreshIntervalSeconds: refreshInterval,
    };

    try {
      const response = await connectApiDataset(datasetName.trim(), config);
      onSuccess(response);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to connect API dataset.";
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-app-surface border border-app-border rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-app-border flex items-center justify-between bg-app-bg/40">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center border border-blue-500/20">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-app-text">Connect Live REST API</h2>
              <p className="text-xs text-app-muted">
                Ingest live JSON endpoints, webhooks, and SaaS APIs with auto-sync
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-app-muted hover:text-app-text hover:bg-app-border/40 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm">
          {/* Quick Presets */}
          <div>
            <label className="block text-xs font-semibold text-app-muted uppercase tracking-wider mb-2">
              Quick Live Presets (Try in 1-Click)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleApplyPreset(p)}
                  className="p-3 rounded-xl border border-app-border/80 bg-app-bg/50 hover:bg-app-bg hover:border-blue-500/40 text-left transition-all group"
                >
                  <div className="flex items-center space-x-2 mb-1">
                    <Sparkles className="w-3.5 h-3.5 text-blue-400 group-hover:scale-110 transition-transform" />
                    <span className="font-semibold text-xs text-app-text truncate">{p.name}</span>
                  </div>
                  <p className="text-[11px] text-app-muted line-clamp-2 leading-relaxed">
                    {p.description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Dataset Name */}
            <div>
              <label className="block text-xs font-medium text-app-text mb-1">Dataset Name</label>
              <input
                type="text"
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
                placeholder="e.g., Live CoinGecko Crypto Feed"
                className="w-full px-3.5 py-2.5 rounded-xl bg-app-bg border border-app-border text-app-text text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>

            {/* URL & Method */}
            <div>
              <label className="block text-xs font-medium text-app-text mb-1">API Endpoint URL</label>
              <div className="flex gap-2">
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as "GET" | "POST")}
                  className="px-3 py-2.5 rounded-xl bg-app-bg border border-app-border text-app-text text-sm font-mono font-medium focus:outline-none focus:border-blue-500"
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://api.example.com/v1/metrics"
                  className="flex-1 px-3.5 py-2.5 rounded-xl bg-app-bg border border-app-border text-app-text text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            {/* JSON Data Path & Refresh Interval */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-app-text mb-1">
                  Data JSON Path (Optional)
                </label>
                <input
                  type="text"
                  value={dataPath}
                  onChange={(e) => setDataPath(e.target.value)}
                  placeholder="e.g. data or results (blank = auto-detect)"
                  className="w-full px-3.5 py-2 rounded-xl bg-app-bg border border-app-border text-app-text text-sm focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-app-text mb-1">
                  Live Auto-Refresh Interval
                </label>
                <div className="relative">
                  <select
                    value={refreshInterval}
                    onChange={(e) => setRefreshInterval(Number(e.target.value))}
                    className="w-full px-3.5 py-2 rounded-xl bg-app-bg border border-app-border text-app-text text-sm appearance-none focus:outline-none focus:border-blue-500"
                  >
                    <option value={0}>Manual Only (Sync on Demand)</option>
                    <option value={15}>Every 15 Seconds (Ultra Real-Time)</option>
                    <option value={30}>Every 30 Seconds</option>
                    <option value={60}>Every 1 Minute</option>
                    <option value={300}>Every 5 Minutes</option>
                    <option value={3600}>Every 1 Hour</option>
                  </select>
                  <Clock className="w-4 h-4 text-app-muted absolute right-3 top-3 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Custom Headers Accordion / Editor */}
            <div className="border border-app-border rounded-xl p-3.5 bg-app-bg/30 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-app-text">
                  HTTP Headers ({headers.length})
                </span>
                <button
                  type="button"
                  onClick={handleAddHeader}
                  className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Header
                </button>
              </div>

              {headers.length > 0 && (
                <div className="space-y-2">
                  {headers.map((h, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input
                        type="text"
                        value={h.key}
                        onChange={(e) => handleUpdateHeader(idx, "key", e.target.value)}
                        placeholder="Header (e.g. Authorization)"
                        className="flex-1 px-2.5 py-1.5 rounded-lg bg-app-bg border border-app-border text-xs font-mono"
                      />
                      <input
                        type="text"
                        value={h.value}
                        onChange={(e) => handleUpdateHeader(idx, "value", e.target.value)}
                        placeholder="Value (e.g. Bearer token)"
                        className="flex-1 px-2.5 py-1.5 rounded-lg bg-app-bg border border-app-border text-xs font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveHeader(idx)}
                        className="text-app-muted hover:text-rose-400 p-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Test Connection Button */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting || !url.trim()}
                className="px-4 py-2 rounded-xl bg-app-border/40 hover:bg-app-border text-app-text text-xs font-medium flex items-center gap-2 transition-all disabled:opacity-50"
              >
                {isTesting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5 text-blue-400" />
                )}
                <span>Test Connection & Preview</span>
              </button>
            </div>

            {/* Test Error Banner */}
            {testError && (
              <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/80 text-rose-300 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{testError}</span>
              </div>
            )}

            {/* Test Result Preview */}
            {testResult && testResult.valid && (
              <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-800/60 space-y-2.5">
                <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{testResult.message}</span>
                </div>

                {/* Sample Columns Badges */}
                <div className="flex flex-wrap gap-1.5">
                  {testResult.detectedColumns.slice(0, 10).map((col) => (
                    <span
                      key={col}
                      className="px-2 py-0.5 rounded-md bg-emerald-900/40 text-emerald-300 text-[11px] font-mono border border-emerald-700/50"
                    >
                      {col}
                    </span>
                  ))}
                  {testResult.detectedColumns.length > 10 && (
                    <span className="text-[11px] text-app-muted self-center">
                      +{testResult.detectedColumns.length - 10} more
                    </span>
                  )}
                </div>

                {/* Table Preview */}
                {testResult.sampleRows.length > 0 && (
                  <div className="max-h-36 overflow-auto border border-app-border/60 rounded-lg text-[11px]">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-app-surface text-app-muted border-b border-app-border">
                        <tr>
                          {testResult.detectedColumns.slice(0, 6).map((col) => (
                            <th key={col} className="p-1.5 px-2">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {testResult.sampleRows.slice(0, 3).map((row, idx) => (
                          <tr key={idx} className="border-b border-app-border/30">
                            {testResult.detectedColumns.slice(0, 6).map((col) => (
                              <td key={col} className="p-1.5 px-2 truncate max-w-[150px]">
                                {String(row[col] ?? "—")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {submitError && (
              <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/80 text-rose-300 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{submitError}</span>
              </div>
            )}

            {/* Modal Footer */}
            <div className="pt-4 border-t border-app-border flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-app-muted hover:text-app-text text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !url.trim()}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold shadow-lg shadow-blue-500/20 flex items-center gap-2 transition-all disabled:opacity-50"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Connect & Build Dashboard</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
