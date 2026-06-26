import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { AdiReport, AdiReportFinding } from '../../types';
import { PageLoader } from './PageLoader';

const GRADE_TONE: Record<string, 'good' | 'warn' | 'bad'> = {
  A: 'good', B: 'good', C: 'warn', D: 'bad', F: 'bad',
};
const SEV_LABEL: Record<AdiReportFinding['severity'], string> = {
  high: 'High', medium: 'Medium', low: 'Low', ok: 'OK',
};

function buildPlainText(r: AdiReport): string {
  const lines = [
    `Accumulate Security Report — ${r.adi_url}`,
    `Grade ${r.grade} (${r.score}/100) — ${r.summary}`,
    `Multi-sig: ${r.benchmarks.multi_sig_rate}% (network avg ${r.benchmarks.network_multi_sig_rate}%)`,
    '',
    'Findings:',
    ...r.findings.map(f =>
      `- [${SEV_LABEL[f.severity]}] ${f.title}\n    ${f.detail}` + (f.fix ? `\n    Fix: ${f.fix}` : '')),
  ];
  return lines.join('\n');
}

function FindingRow({ f }: { f: AdiReportFinding }) {
  return (
    <div className={`report-finding report-finding--${f.severity}`}>
      <span className={`report-sev report-sev--${f.severity}`}>{SEV_LABEL[f.severity]}</span>
      <div className="report-finding-body">
        <div className="report-finding-title">{f.title}</div>
        <div className="report-finding-detail">{f.detail}</div>
        {f.fix && (
          <div className="report-finding-fix">
            <span className="report-finding-fix-label">Fix</span> {f.fix}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Per-ADI Security Report Card — synthesizes every signal for one identity into
 * a graded verdict, prioritized findings (why + fix), and a network benchmark.
 * Answers "is this identity secure, and what should I fix?".
 */
export function SecurityReportCard({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['adi-report', url],
    queryFn: () => api.getAdiReport(url),
    staleTime: 300000,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 1,
  });

  if (isLoading) return <PageLoader message="Analyzing identity…" />;
  if (isError || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="report-empty">
        {notFound ? 'No security data for this identity.' : 'Could not load the security report.'}
      </div>
    );
  }

  const r = data;
  const tone = GRADE_TONE[r.grade] ?? 'warn';
  const m = r.metrics;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildPlainText(r));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable */ }
  };

  const chips: { label: string; value: string | number }[] = [
    { label: 'Key pages', value: m.total_pages },
    { label: 'Multi-sig', value: `${m.multi_sig}/${m.total_pages}` },
    { label: 'Avg threshold', value: m.avg_threshold },
    { label: 'Reused keys', value: m.shared_keys },
    { label: 'Shares with', value: `${m.shared_with.length} ADIs` },
    { label: 'Zero-credit', value: m.zero_credit },
    { label: 'Implied-only', value: m.implied_only },
    { label: 'External authorities', value: m.cross_adi },
    { label: 'Delegations out', value: m.delegates_out },
  ];

  return (
    <div className="report-card">
      <div className="report-head">
        <div className={`report-grade report-grade--${tone}`}>
          <span className="report-grade-letter">{r.grade}</span>
          <span className="report-grade-score">{r.score}/100</span>
        </div>
        <div className="report-head-text">
          <div className="report-head-title">Security report</div>
          <div className="report-summary">{r.summary}</div>
          <div className="report-bench">
            Multi-sig adoption <strong>{r.benchmarks.multi_sig_rate}%</strong>
            <span className="report-bench-net"> · network avg {r.benchmarks.network_multi_sig_rate}%</span>
          </div>
        </div>
        <button type="button" className="report-copy" onClick={copy}>
          {copied ? '✓ Copied' : 'Copy report'}
        </button>
      </div>

      <div className="report-metrics">
        {chips.map(c => (
          <div key={c.label} className="report-chip">
            <span className="report-chip-value">{c.value}</span>
            <span className="report-chip-label">{c.label}</span>
          </div>
        ))}
      </div>

      <div className="report-findings-label">
        {r.findings.length} finding{r.findings.length !== 1 ? 's' : ''}, most important first
      </div>
      <div className="report-findings">
        {r.findings.map(f => <FindingRow key={f.id} f={f} />)}
      </div>
    </div>
  );
}
