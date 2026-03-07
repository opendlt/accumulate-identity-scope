import { useCallback, useRef, useState } from 'react';

interface ExportButtonProps {
  onExportCSV?: () => string;
  onExportPNG?: () => HTMLCanvasElement | null;
  filename?: string;
}

export function ExportButton({ onExportCSV, onExportPNG, filename = 'export' }: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const downloadCSV = useCallback(() => {
    if (!onExportCSV) return;
    const csv = onExportCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  }, [onExportCSV, filename]);

  const downloadPNG = useCallback(() => {
    if (!onExportPNG) return;
    const canvas = onExportPNG();
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.png`;
    a.click();
    setOpen(false);
  }, [onExportPNG, filename]);

  if (!onExportCSV && !onExportPNG) return null;

  return (
    <div className="export-btn-wrapper" ref={menuRef}>
      <button
        className="export-btn"
        onClick={() => setOpen(o => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        title="Export data"
      >
        {'\u2B07'} Export
      </button>
      {open && (
        <div className="export-menu">
          {onExportCSV && (
            <button className="export-menu-item" onClick={downloadCSV}>
              {'\u2B07'} Download CSV
            </button>
          )}
          {onExportPNG && (
            <button className="export-menu-item" onClick={downloadPNG}>
              {'\u2B07'} Download PNG
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Helper: convert array of objects to CSV string */
export function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const val = String(row[h] ?? '');
        return val.includes(',') || val.includes('"') || val.includes('\n')
          ? `"${val.replace(/"/g, '""')}"`
          : val;
      }).join(',')
    ),
  ];
  return lines.join('\n');
}
