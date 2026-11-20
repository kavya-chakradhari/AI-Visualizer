import React, { useState } from "react";
import { Search, Table as TableIcon, ArrowUpDown } from "lucide-react";
import type { ColumnProfile } from "@ai-vis/types";

interface DataPreviewTableProps {
  columns: ColumnProfile[];
  rows: Record<string, unknown>[];
  totalRowCount: number;
}

export const DataPreviewTable: React.FC<DataPreviewTableProps> = ({
  columns,
  rows,
  totalRowCount,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Filtering
  const filteredRows = rows.filter((row) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return Object.values(row).some((val) =>
      val !== null && val !== undefined && String(val).toLowerCase().includes(q)
    );
  });

  // Sorting
  const sortedRows = [...filteredRows].sort((a, b) => {
    if (!sortColumn) return 0;
    const aVal = a[sortColumn];
    const bVal = b[sortColumn];

    if (aVal === bVal) return 0;
    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;

    let comp = 0;
    if (typeof aVal === "number" && typeof bVal === "number") {
      comp = aVal - bVal;
    } else {
      comp = String(aVal).localeCompare(String(bVal));
    }

    return sortDirection === "asc" ? comp : -comp;
  });

  const handleSort = (colName: string) => {
    if (sortColumn === colName) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else {
        setSortColumn(null);
        setSortDirection("asc");
      }
    } else {
      setSortColumn(colName);
      setSortDirection("asc");
    }
  };

  return (
    <div className="space-y-3 bg-app-surface/60 border border-app-border rounded-2xl p-4 sm:p-5">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
        <div className="flex items-center space-x-2">
          <TableIcon className="w-5 h-5 text-app-primary" />
          <h3 className="text-base sm:text-lg font-semibold text-app-text">
            Data Preview (First 50 Rows)
          </h3>
          <span className="text-xs bg-app-surface text-app-muted px-2.5 py-0.5 rounded-full font-mono">
            {rows.length} rows loaded of {totalRowCount.toLocaleString()} total
          </span>
        </div>

        {/* Quick Search */}
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-app-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search preview rows..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-app-surface/80 border border-app-border/80 rounded-xl text-xs text-app-text placeholder-app-muted focus:outline-none focus:border-app-primary transition-colors"
          />
        </div>
      </div>

      {/* Responsive Horizontal Scroll Container (Fully mobile-safe) */}
      <div className="w-full overflow-x-auto rounded-xl border border-app-border shadow-inner max-h-[500px] overflow-y-auto">
        <table className="w-full min-w-full text-left text-xs border-collapse">
          {/* Sticky Table Header */}
          <thead className="sticky top-0 z-10 bg-app-surface border-b border-app-border text-app-muted">
            <tr>
              <th className="p-3 w-12 text-center text-app-muted font-mono">#</th>
              {columns.map((col) => (
                <th
                  key={col.name}
                  onClick={() => handleSort(col.name)}
                  className="p-3 font-semibold whitespace-nowrap cursor-pointer hover:bg-app-surface/60 transition-colors group select-none"
                >
                  <div className="flex items-center space-x-2">
                    <span className="text-app-text group-hover:text-app-primary">
                      {col.name}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-mono font-normal ${
                        col.semanticType === "unknown"
                          ? "bg-amber-950/60 text-amber-400 border border-amber-500/20"
                          : "bg-app-surface text-app-muted border border-app-border"
                      }`}
                    >
                      {col.semanticType}
                    </span>
                    <ArrowUpDown className="w-3 h-3 text-app-muted group-hover:text-app-muted" />
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {/* Table Body */}
          <tbody className="divide-y divide-app-border/60 bg-app-bg/40 font-mono text-[11px]">
            {sortedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="p-8 text-center text-app-muted font-sans"
                >
                  No matching rows found.
                </td>
              </tr>
            ) : (
              sortedRows.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className="hover:bg-app-surface/40 transition-colors odd:bg-app-surface/20"
                >
                  <td className="p-2.5 text-center text-app-muted font-mono text-[10px]">
                    {rowIdx + 1}
                  </td>
                  {columns.map((col) => {
                    const rawVal = row[col.name];
                    const isNull = rawVal === null || rawVal === undefined || rawVal === "";

                    return (
                      <td
                        key={col.name}
                        className="p-2.5 whitespace-nowrap max-w-xs truncate text-app-text"
                        title={isNull ? "null" : String(rawVal)}
                      >
                        {isNull ? (
                          <span className="text-app-muted italic font-sans text-[10px]">null</span>
                        ) : typeof rawVal === "boolean" ? (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] ${
                              rawVal
                                ? "bg-emerald-500/10 text-emerald-400"
                                : "bg-red-500/10 text-red-400"
                            }`}
                          >
                            {String(rawVal)}
                          </span>
                        ) : (
                          String(rawVal)
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-app-muted pt-1">
        <span>
          Showing {sortedRows.length} of {rows.length} preview rows
        </span>
        <span className="text-[11px] text-app-muted">
          Full {totalRowCount.toLocaleString()} rows safely stored in disk-based storage
        </span>
      </div>
    </div>
  );
};
