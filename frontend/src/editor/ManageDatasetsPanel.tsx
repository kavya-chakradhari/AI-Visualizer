import React, { useState } from "react";
import type { Dataset, DatasetUploadResponse } from "@ai-vis/types";
import { X, Database, Trash2, Plus, FileSpreadsheet } from "lucide-react";
import { FileUploadZone } from "../components/FileUploadZone.js";

export interface ManageDatasetsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  datasets: Dataset[];
  primaryDatasetId?: string;
  onAttach: (data: DatasetUploadResponse) => void;
  onDetach: (datasetId: string) => void;
}

export const ManageDatasetsPanel: React.FC<ManageDatasetsPanelProps> = ({
  isOpen,
  onClose,
  datasets,
  primaryDatasetId,
  onAttach,
  onDetach,
}) => {
  const [isAdding, setIsAdding] = useState(false);

  if (!isOpen) return null;

  const handleUploadSuccess = (data: DatasetUploadResponse) => {
    onAttach(data);
    setIsAdding(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-app-bg/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-2xl rounded-2xl bg-app-surface border border-app-border shadow-2xl flex flex-col overflow-hidden text-app-text max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-label="Manage datasets"
      >
        <div className="px-6 py-4 border-b border-app-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-app-primary/20 text-app-primary flex items-center justify-center">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-app-text">Manage Datasets</h2>
              <p className="text-xs text-app-muted">
                Attach more than one dataset to this dashboard so charts can pull from different sources
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-app-muted hover:text-app-text hover:bg-app-bg transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="space-y-2.5">
            {datasets.map((dataset) => (
              <div
                key={dataset.id}
                className="flex items-center justify-between p-3.5 rounded-xl bg-app-bg/60 border border-app-border"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-app-surface text-app-primary flex items-center justify-center flex-shrink-0">
                    <FileSpreadsheet className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-app-text truncate">
                        {dataset.name}
                      </span>
                      {dataset.id === primaryDatasetId && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-app-primary/20 text-app-primary">
                          PRIMARY
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-app-muted truncate">
                      {dataset.rowCount.toLocaleString()} rows • {dataset.columnCount} columns
                      {dataset.sourceType && dataset.sourceType !== "file"
                        ? ` • ${dataset.sourceType.toUpperCase()}`
                        : ""}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDetach(dataset.id)}
                  title="Remove this dataset from the dashboard"
                  className="w-9 h-9 flex items-center justify-center rounded-lg text-app-muted hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            ))}
            {datasets.length === 0 && (
              <p className="text-xs text-app-muted text-center py-4">
                No datasets attached yet.
              </p>
            )}
          </div>

          {isAdding ? (
            <FileUploadZone onUploadSuccess={handleUploadSuccess} />
          ) : (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-app-border text-app-muted hover:text-app-text hover:border-app-primary/40 transition-colors text-sm font-medium min-h-[44px]"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Add another dataset
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
