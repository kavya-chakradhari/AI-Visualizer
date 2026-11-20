import React, { useState } from "react";
import {
  Database,
  X,
  Play,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  Sparkles,
  ShieldCheck,
  Server,
  Cloud,
} from "lucide-react";
import { testDatabaseSource, connectDatabaseDataset } from "../../api/datasets.js";
import type { DatasetUploadResponse, DatabaseSourceConfig, DatabaseTestResponse } from "@ai-vis/types";

interface DatabaseConnectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (data: DatasetUploadResponse) => void;
}

export const DatabaseConnectorModal: React.FC<DatabaseConnectorModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [dbType, setDbType] = useState<"sqlite" | "postgres" | "mysql" | "bigquery">("sqlite");
  const [datasetName, setDatasetName] = useState<string>("Enterprise Live Database");
  const [connectionString, setConnectionString] = useState<string>("");
  const [host, setHost] = useState<string>("localhost");
  const [port, setPort] = useState<number>(5432);
  const [database, setDatabase] = useState<string>("analytics");
  const [user, setUser] = useState<string>("postgres");
  const [password, setPassword] = useState<string>("");
  const [ssl, setSsl] = useState<boolean>(false);

  // BigQuery specific
  const [projectId, setProjectId] = useState<string>("");
  const [credentialsJson, setCredentialsJson] = useState<string>("");

  // SQL Query
  const [query, setQuery] = useState<string>(
    "SELECT order_id, order_date, customer_region, product_category, sales_amount, units_sold, profit_margin, status FROM live_enterprise_orders ORDER BY order_date DESC LIMIT 1000"
  );
  const [refreshInterval, setRefreshInterval] = useState<number>(30);

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<DatabaseTestResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleUseDemo = () => {
    setDbType("sqlite");
    setDatasetName("Live Enterprise Orders & Revenue");
    setQuery(
      "SELECT order_id, order_date, customer_region, product_category, sales_amount, units_sold, profit_margin, status FROM live_enterprise_orders ORDER BY order_date DESC LIMIT 1000"
    );
    setRefreshInterval(30);
    setTestResult(null);
    setTestError(null);
  };

  const buildConfig = (): DatabaseSourceConfig => {
    return {
      type: dbType,
      connectionString: connectionString.trim() || undefined,
      host: dbType !== "sqlite" && dbType !== "bigquery" ? host.trim() : undefined,
      port: dbType !== "sqlite" && dbType !== "bigquery" ? port : undefined,
      database: dbType !== "sqlite" && dbType !== "bigquery" ? database.trim() : undefined,
      user: dbType !== "sqlite" && dbType !== "bigquery" ? user.trim() : undefined,
      password: dbType !== "sqlite" ? password : undefined,
      ssl,
      projectId: dbType === "bigquery" ? projectId.trim() : undefined,
      credentialsJson: dbType === "bigquery" && credentialsJson.trim() ? credentialsJson.trim() : undefined,
      query: query.trim(),
      refreshIntervalSeconds: refreshInterval,
    };
  };

  const handleTest = async () => {
    if (!query.trim()) {
      setTestError("Please provide a read-only SQL query.");
      return;
    }

    setIsTesting(true);
    setTestError(null);
    setTestResult(null);

    try {
      const config = buildConfig();
      const result = await testDatabaseSource(config);
      setTestResult(result);
      if (!result.valid) {
        setTestError(result.message || "Failed to execute database query.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to execute database query.";
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
    if (!query.trim()) {
      setSubmitError("Please enter a SQL query.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const config = buildConfig();
      const response = await connectDatabaseDataset(datasetName.trim(), config);
      onSuccess(response);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to connect to database.";
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
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center border border-purple-500/20">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-app-text">Connect Database & BigQuery</h2>
              <p className="text-xs text-app-muted">
                Execute live SQL queries on PostgreSQL, MySQL, SQLite, or Google BigQuery
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
          {/* Quick Demo Database Banner */}
          <div className="p-3.5 rounded-xl border border-purple-500/30 bg-purple-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5 font-semibold text-xs text-purple-300">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span>Instant Enterprise Demo Database</span>
              </div>
              <p className="text-[11px] text-app-muted mt-0.5">
                Test live SQL queries and chart creation immediately using the built-in SQLite orders table.
              </p>
            </div>
            <button
              type="button"
              onClick={handleUseDemo}
              className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold whitespace-nowrap shadow-md shadow-purple-600/20 transition-all"
            >
              Load Demo Live DB
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Database Engine Selector */}
            <div>
              <label className="block text-xs font-medium text-app-text mb-2">
                Database / Warehouse Type
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: "sqlite", label: "SQLite / Demo DB", icon: Server },
                  { id: "postgres", label: "PostgreSQL", icon: Database },
                  { id: "mysql", label: "MySQL", icon: Database },
                  { id: "bigquery", label: "Google BigQuery", icon: Cloud },
                ].map((item) => {
                  const Icon = item.icon;
                  const isSelected = dbType === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setDbType(item.id as never);
                        if (item.id === "bigquery") {
                          setQuery("SELECT date, region, revenue, conversions FROM `project.dataset.sales` LIMIT 1000");
                        } else if (item.id === "sqlite") {
                          setQuery(
                            "SELECT order_id, order_date, customer_region, product_category, sales_amount, units_sold, profit_margin, status FROM live_enterprise_orders ORDER BY order_date DESC LIMIT 1000"
                          );
                        }
                      }}
                      className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 text-xs font-medium transition-all ${
                        isSelected
                          ? "border-purple-500 bg-purple-500/10 text-purple-300 shadow-sm"
                          : "border-app-border bg-app-bg hover:bg-app-bg/80 text-app-muted"
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${isSelected ? "text-purple-400" : ""}`} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dataset Name */}
            <div>
              <label className="block text-xs font-medium text-app-text mb-1">Dataset Name</label>
              <input
                type="text"
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
                placeholder="e.g. Live Production Sales DB"
                className="w-full px-3.5 py-2.5 rounded-xl bg-app-bg border border-app-border text-app-text text-sm focus:outline-none focus:border-purple-500"
                required
              />
            </div>

            {/* Connection Fields for Postgres / MySQL */}
            {(dbType === "postgres" || dbType === "mysql") && (
              <div className="space-y-3 p-3.5 rounded-xl border border-app-border bg-app-bg/30">
                <div>
                  <label className="block text-xs font-medium text-app-muted mb-1">
                    Connection String URI (Optional)
                  </label>
                  <input
                    type="text"
                    value={connectionString}
                    onChange={(e) => setConnectionString(e.target.value)}
                    placeholder={`${dbType}://user:password@host:port/dbname`}
                    className="w-full px-3 py-1.5 rounded-lg bg-app-bg border border-app-border text-xs font-mono"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-app-muted mb-1">Host</label>
                    <input
                      type="text"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      placeholder="db.example.com or localhost"
                      className="w-full px-3 py-1.5 rounded-lg bg-app-bg border border-app-border text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-app-muted mb-1">Port</label>
                    <input
                      type="number"
                      value={port}
                      onChange={(e) => setPort(Number(e.target.value))}
                      placeholder={dbType === "postgres" ? "5432" : "3306"}
                      className="w-full px-3 py-1.5 rounded-lg bg-app-bg border border-app-border text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-app-muted mb-1">Database</label>
                    <input
                      type="text"
                      value={database}
                      onChange={(e) => setDatabase(e.target.value)}
                      placeholder="analytics"
                      className="w-full px-3 py-1.5 rounded-lg bg-app-bg border border-app-border text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-app-muted mb-1">User</label>
                    <input
                      type="text"
                      value={user}
                      onChange={(e) => setUser(e.target.value)}
                      placeholder="readonly_user"
                      className="w-full px-3 py-1.5 rounded-lg bg-app-bg border border-app-border text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-app-muted mb-1">Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3 py-1.5 rounded-lg bg-app-bg border border-app-border text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="sslCheck"
                    checked={ssl}
                    onChange={(e) => setSsl(e.target.checked)}
                    className="rounded border-app-border text-purple-600 focus:ring-purple-500"
                  />
                  <label htmlFor="sslCheck" className="text-xs text-app-muted cursor-pointer">
                    Enable SSL / TLS encryption
                  </label>
                </div>
              </div>
            )}

            {/* BigQuery Fields */}
            {dbType === "bigquery" && (
              <div className="space-y-3 p-3.5 rounded-xl border border-app-border bg-app-bg/30">
                <div>
                  <label className="block text-xs font-medium text-app-muted mb-1">
                    Google Cloud Project ID
                  </label>
                  <input
                    type="text"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    placeholder="my-gcp-project-12345"
                    className="w-full px-3 py-2 rounded-lg bg-app-bg border border-app-border text-xs font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-app-muted mb-1">
                    Service Account JSON / OAuth Token (Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={credentialsJson}
                    onChange={(e) => setCredentialsJson(e.target.value)}
                    placeholder='{"type": "service_account", "access_token": "ya29..."}'
                    className="w-full px-3 py-2 rounded-lg bg-app-bg border border-app-border text-xs font-mono"
                  />
                </div>
              </div>
            )}

            {/* SQL Query Editor */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-app-text">SQL Query (Read-Only)</label>
                <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Read-Only Enforced
                </span>
              </div>
              <textarea
                rows={3}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="SELECT column1, column2, SUM(metric) FROM table_name GROUP BY 1, 2"
                className="w-full p-3 rounded-xl bg-app-bg border border-app-border text-app-text font-mono text-xs focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
                required
              />
            </div>

            {/* Auto-Refresh Interval */}
            <div>
              <label className="block text-xs font-medium text-app-text mb-1">
                Live Auto-Refresh Interval
              </label>
              <div className="relative">
                <select
                  value={refreshInterval}
                  onChange={(e) => setRefreshInterval(Number(e.target.value))}
                  className="w-full px-3.5 py-2 rounded-xl bg-app-bg border border-app-border text-app-text text-sm appearance-none focus:outline-none focus:border-purple-500"
                >
                  <option value={0}>Manual Only (Sync on Demand)</option>
                  <option value={15}>Every 15 Seconds (Real-Time Live)</option>
                  <option value={30}>Every 30 Seconds</option>
                  <option value={60}>Every 1 Minute</option>
                  <option value={300}>Every 5 Minutes</option>
                  <option value={3600}>Every 1 Hour</option>
                </select>
                <Clock className="w-4 h-4 text-app-muted absolute right-3 top-3 pointer-events-none" />
              </div>
            </div>

            {/* Test Connection Button */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleTest}
                disabled={isTesting || !query.trim()}
                className="px-4 py-2 rounded-xl bg-app-border/40 hover:bg-app-border text-app-text text-xs font-medium flex items-center gap-2 transition-all disabled:opacity-50"
              >
                {isTesting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5 text-purple-400" />
                )}
                <span>Test Connection & Query</span>
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
                  {testResult.detectedColumns.map((col) => (
                    <span
                      key={col}
                      className="px-2 py-0.5 rounded-md bg-emerald-900/40 text-emerald-300 text-[11px] font-mono border border-emerald-700/50"
                    >
                      {col}
                    </span>
                  ))}
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
                disabled={isSubmitting || !query.trim()}
                className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold shadow-lg shadow-purple-500/20 flex items-center gap-2 transition-all disabled:opacity-50"
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
