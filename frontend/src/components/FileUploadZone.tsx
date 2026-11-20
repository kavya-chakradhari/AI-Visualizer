import React, { useState, useRef } from "react";
import {
  UploadCloud,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Loader2,
  X,
  Globe,
  Database,
  ArrowRight,
} from "lucide-react";
import { uploadDataset } from "../api/datasets.js";
import { DUMMY_DATASETS, createDummyFile, DummyDatasetDefinition } from "../data/dummyDatasets.js";
import { ApiConnectorModal } from "./connectors/ApiConnectorModal.js";
import { DatabaseConnectorModal } from "./connectors/DatabaseConnectorModal.js";
import type { DatasetUploadResponse } from "@ai-vis/types";

interface FileUploadZoneProps {
  onUploadSuccess: (data: DatasetUploadResponse) => void;
}

export const FileUploadZone: React.FC<FileUploadZoneProps> = ({ onUploadSuccess }) => {
  const [activeSourceTab, setActiveSourceTab] = useState<"file" | "api" | "database">("file");
  const [isApiModalOpen, setIsApiModalOpen] = useState<boolean>(false);
  const [isDbModalOpen, setIsDbModalOpen] = useState<boolean>(false);

  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = async (file: File) => {
    setErrorMessage(null);

    // Client-side quick checks
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    if (ext !== ".csv" && ext !== ".xlsx") {
      setErrorMessage(`Invalid file format '${ext}'. Please upload a valid .csv or .xlsx file.`);
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      setErrorMessage(
        `File is ${(file.size / (1024 * 1024)).toFixed(1)}MB, which exceeds the 25MB maximum limit.`
      );
      return;
    }

    if (file.size === 0) {
      setErrorMessage("The selected file is empty (0 bytes). Please upload a file with data.");
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadStage("Uploading file stream...");

    try {
      const response = await uploadDataset(file, undefined, (percent) => {
        setUploadProgress(percent);
        if (percent === 100) {
          setUploadStage("Validating file signature & profiling columns...");
        }
      });

      setUploadProgress(100);
      setUploadStage("Complete!");
      onUploadSuccess(response);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to upload and parse dataset.";
      setErrorMessage(msg);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleLoadDummy = (dummy: DummyDatasetDefinition) => {
    const dummyFile = createDummyFile(dummy);
    processFile(dummyFile);
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Source Selector Tabs */}
      <div className="flex items-center justify-center p-1.5 bg-app-surface/90 border border-app-border rounded-2xl max-w-md mx-auto shadow-sm">
        <button
          type="button"
          onClick={() => setActiveSourceTab("file")}
          className={`flex-1 py-2 px-3.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
            activeSourceTab === "file"
              ? "bg-app-primary text-white shadow-md shadow-brand-500/20"
              : "text-app-muted hover:text-app-text"
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>File Upload</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveSourceTab("api");
            setIsApiModalOpen(true);
          }}
          className={`flex-1 py-2 px-3.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
            activeSourceTab === "api"
              ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
              : "text-app-muted hover:text-app-text"
          }`}
        >
          <Globe className="w-4 h-4" />
          <span className="flex items-center gap-1">
            Live API
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveSourceTab("database");
            setIsDbModalOpen(true);
          }}
          className={`flex-1 py-2 px-3.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
            activeSourceTab === "database"
              ? "bg-purple-600 text-white shadow-md shadow-purple-500/20"
              : "text-app-muted hover:text-app-text"
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Database / BigQuery</span>
        </button>
      </div>

      {/* Alternative Sources Quick Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <div
          onClick={() => setIsApiModalOpen(true)}
          className="p-4 rounded-2xl border border-blue-500/20 bg-blue-950/10 hover:bg-blue-950/20 hover:border-blue-500/40 transition-all cursor-pointer flex items-center justify-between group"
        >
          <div className="flex items-center space-x-3.5">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center border border-blue-500/20 group-hover:scale-105 transition-transform">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-xs text-app-text group-hover:text-blue-400 transition-colors">
                  Connect Live REST API
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400">
                  LIVE
                </span>
              </div>
              <p className="text-[11px] text-app-muted mt-0.5">
                Stream data from any endpoint with auto-sync polling
              </p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-app-muted group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all" />
        </div>

        <div
          onClick={() => setIsDbModalOpen(true)}
          className="p-4 rounded-2xl border border-purple-500/20 bg-purple-950/10 hover:bg-purple-950/20 hover:border-purple-500/40 transition-all cursor-pointer flex items-center justify-between group"
        >
          <div className="flex items-center space-x-3.5">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center border border-purple-500/20 group-hover:scale-105 transition-transform">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-xs text-app-text group-hover:text-purple-400 transition-colors">
                  Connect Database & BigQuery
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300">
                  SQL
                </span>
              </div>
              <p className="text-[11px] text-app-muted mt-0.5">
                Postgres, MySQL, SQLite, or Google BigQuery queries
              </p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-app-muted group-hover:text-purple-400 group-hover:translate-x-0.5 transition-all" />
        </div>
      </div>

      {/* Upload Box (CSV/XLSX) */}
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => !isUploading && fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer transition-all duration-300 ${
          isDragging
            ? "border-app-primary bg-app-primary/10 shadow-lg shadow-brand-500/10 scale-[1.01]"
            : "border-app-border bg-app-surface/60 hover:bg-app-surface/90"
        } ${isUploading ? "pointer-events-none opacity-80" : ""}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx"
          onChange={handleFileChange}
          className="hidden"
          disabled={isUploading}
        />

        <div className="flex flex-col items-center justify-center space-y-4">
          <div
            className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-transform ${
              isDragging ? "bg-app-primary text-white scale-110" : "bg-app-surface text-app-primary"
            }`}
          >
            {isUploading ? (
              <Loader2 className="w-8 h-8 animate-spin text-app-primary" />
            ) : (
              <UploadCloud className="w-8 h-8" />
            )}
          </div>

          <div className="space-y-1">
            <h3 className="text-lg sm:text-xl font-semibold text-app-text">
              {isUploading ? "Ingesting & Profiling Dataset" : "Drag & drop your CSV or Excel file here"}
            </h3>
            <p className="text-sm text-app-muted">
              {isUploading
                ? uploadStage
                : "Supports CSV and XLSX spreadsheets up to 25 MB with automatic deterministic schema profiling"}
            </p>
          </div>

          {!isUploading && (
            <div className="pt-2">
              <button
                type="button"
                className="px-5 py-2.5 rounded-xl bg-app-primary hover:brightness-110 text-white font-medium text-sm transition-colors shadow-md"
              >
                Browse Files
              </button>
            </div>
          )}

          {/* Progress Bar */}
          {isUploading && (
            <div className="w-full max-w-md pt-4 space-y-2">
              <div className="flex justify-between text-xs text-app-muted font-mono">
                <span>{uploadStage}</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-2 w-full bg-app-surface rounded-full overflow-hidden">
                <div
                  className="h-full bg-app-primary transition-all duration-300 rounded-full"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex items-center space-x-4 pt-2 text-xs text-app-muted">
            <span className="flex items-center gap-1">
              <FileSpreadsheet className="w-3.5 h-3.5" /> CSV / XLSX
            </span>
            <span>•</span>
            <span>Max 25 MB</span>
            <span>•</span>
            <span>Strict File Signature Check</span>
          </div>
        </div>
      </div>

      {/* Specific Human-Readable Error Banner */}
      {errorMessage && (
        <div className="flex items-start justify-between p-4 rounded-xl bg-red-950/60 border border-red-500/30 text-red-200 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-300">Data Ingestion Error</p>
              <p className="text-sm text-red-200 mt-0.5">{errorMessage}</p>
            </div>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-400 hover:text-red-200 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Quick Test / Dummy Data Section */}
      <div className="bg-app-surface/40 border border-app-border/80 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-sm font-semibold text-app-text">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Instant Demo Datasets (1-Click Test)</span>
          </div>
          <span className="text-xs text-app-muted">Pure deterministic test vectors</span>
        </div>
        <p className="text-xs text-app-muted leading-relaxed">
          Need sample data right away? Click any pre-configured dataset below to test CSV streaming,
          currency, percentage, dates, identifiers, and constraint handling:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          {DUMMY_DATASETS.map((dummy) => (
            <button
              key={dummy.id}
              type="button"
              disabled={isUploading}
              onClick={() => handleLoadDummy(dummy)}
              className="text-left p-3 rounded-xl bg-app-surface/60 hover:bg-app-surface border border-app-border/60 hover:border-app-primary/40 transition-all group"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-app-text group-hover:text-app-primary transition-colors">
                  {dummy.name}
                </span>
                <CheckCircle2 className="w-3.5 h-3.5 text-app-muted group-hover:text-app-primary" />
              </div>
              <p className="text-[11px] text-app-muted line-clamp-2 leading-relaxed">
                {dummy.description}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Modals */}
      <ApiConnectorModal
        isOpen={isApiModalOpen}
        onClose={() => setIsApiModalOpen(false)}
        onSuccess={onUploadSuccess}
      />
      <DatabaseConnectorModal
        isOpen={isDbModalOpen}
        onClose={() => setIsDbModalOpen(false)}
        onSuccess={onUploadSuccess}
      />
    </div>
  );
};
