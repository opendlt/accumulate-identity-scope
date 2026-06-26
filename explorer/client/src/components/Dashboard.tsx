import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { api } from '../api/client';
import { GlassCard } from './ui/GlassCard';
import { StatOrb } from './ui/StatOrb';
import { RingGauge } from './ui/RingGauge';
import { HeatStrip } from './ui/HeatStrip';
import { GlowBadge } from './ui/GlowBadge';
import { AnimatedCounter } from './ui/AnimatedCounter';
import { ErrorState } from './ui/ErrorState';
import { getEntityColor } from '../hooks/useEntityColor';
import { PageLoader } from './ui/PageLoader';
import { TopologyMap } from './dashboard/TopologyMap';
import { defaultEdgeFilters } from './graph/graphShared';
import { KeyReuseCard, TokenEconomyCard, AuthorityHotspotCard, DepthCard } from './dashboard/InsightCards';
import { InfoTip } from './ui/InfoTip';
import { RiskNote } from './ui/RiskNote';
import { useTheme } from '../contexts/ThemeContext';
import { getTooltipStyle, getThemeColors } from '../hooks/useThemeColors';

export function Dashboard() {
  const { isDark } = useTheme();
  const themeColors = getThemeColors(isDark);
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['network-summary'],
    queryFn: api.getNetworkSummary,
    staleTime: 120000,
  });

  const { data: topology, isLoading: topoLoading } = useQuery({
    queryKey: ['topology'],
    queryFn: () => api.getTopology(true),
    staleTime: 300000,
  });

  const { data: liteSummary } = useQuery({
    queryKey: ['lite-summary'],
    queryFn: api.getLiteSummary,
    staleTime: 300000,
  });

  // Default edges ON for hierarchy (P2.4) so topology structure is visible on
  // first load instead of disconnected dots.
  const [edgeFilters, setEdgeFilters] = useState<Record<string, boolean>>(defaultEdgeFilters);
  const [colorBy, setColorBy] = useState('status');
  const [hideEmpty, setHideEmpty] = useState(true);

  if (isError) {
    return <ErrorState title="Failed to load dashboard" message="Could not fetch network summary data." onRetry={() => refetch()} />;
  }

  if (isLoading || !data) {
    return <PageLoader message="Loading command center..." />;
  }

  const c = data.counts;
  const total = c.adis || 1;
  const doneCount = data.adi_status['done'] || 0;
  const errCount = data.adi_status['error'] || 0;
  const healthRate = doneCount / total;
  const multiSigRate = data.security.total_pages > 0
    ? data.security.multi_sig / data.security.total_pages : 0;

  const orbMetrics = [
    { value: c.adis,                label: 'ADIs',           term: 'adi',              ...getEntityColor('adi') },
    { value: c.token_accounts,      label: 'Token Accounts', term: 'token-account',    ...getEntityColor('token') },
    { value: c.data_accounts,       label: 'Data Accounts',  term: 'data-account',     ...getEntityColor('data') },
    { value: c.key_books,           label: 'Key Books',      term: 'key-book',         ...getEntityColor('key') },
    { value: c.account_authorities, label: 'Authorities',    term: 'authority',        ...getEntityColor('authority') },
    { value: c.key_entries,         label: 'Key Entries',    term: 'public-key-hash',  ...getEntityColor('key') },
    { value: c.lite_accounts ?? 0,  label: 'Lite Accounts',  term: 'lite-account',     ...getEntityColor('key') },
  ];

  const topAdis = data.top_adis.slice(0, 8).map(a => ({
    name: a.url.replace('acc://', '').slice(0, 22),
    entries: a.entry_count,
    tokens: a.token_count,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ===== Meaning layer: view framing ===== */}
      <div className="view-intro">
        <div className="view-intro__title">Command Center</div>
        <div className="view-intro__lead">A network-wide structural snapshot of every identity (ADI) on Accumulate — how many exist, how they’re secured, and how authority is distributed.</div>
        <div className="view-intro__audience">Network overview · for ADI owners, developers &amp; auditors</div>
      </div>

      {/* ===== 1A. Hero Metrics Strip ===== */}
      <GlassCard gradientTop delay={0}>
        <div className="dash-orb-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: 4,
        }}>
          {orbMetrics.map((m, i) => (
            <div key={m.label} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <StatOrb value={m.value} label={m.label}
                color={m.color} glow={m.glow} delay={i * 0.06} />
              <div style={{ position: 'absolute', top: 12, right: 12 }}>
                <InfoTip term={m.term} />
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* ===== 1B. Network Vitals Row ===== */}
      <div className="grid-3">
        {/* Crawl Coverage */}
        <GlassCard title="Crawl Coverage" titleRight={<InfoTip term="crawl-coverage" />} glow delay={0.08}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <RingGauge
              value={healthRate}
              size={96}
              strokeWidth={7}
              color={healthRate > 0.9 ? getEntityColor('success').color : healthRate > 0.7 ? getEntityColor('authority').color : getEntityColor('danger').color}
              valueLabel={`${(healthRate * 100).toFixed(1)}%`}
              // Redundant (color-blind safe) cue: glyph reports scan-coverage tier
              // without relying on the ring hue. ✓ fully scanned, ◐ partial, ⚠ gaps.
              label={healthRate > 0.9 ? '✓ Fully scanned' : healthRate > 0.7 ? '◐ Partial scan' : '⚠ Scan gaps'}
            />
            <div style={{ flex: 1, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Crawled</span>
                <GlowBadge variant="success">✓ <AnimatedCounter value={doneCount} /> done</GlowBadge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Errors</span>
                <GlowBadge variant={errCount > 0 ? 'danger' : 'success'}>
                  {errCount > 0 ? '⚠ ' : '✓ '}<AnimatedCounter value={errCount} /> {errCount > 0 ? 'error' : 'clear'}
                </GlowBadge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Root / Sub<InfoTip term="sub-adi" /></span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                  <AnimatedCounter value={data.root_count} /> / <AnimatedCounter value={data.sub_count} />
                </span>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Security Posture */}
        <GlassCard title="Security Posture" glow delay={0.12}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <RingGauge
                value={multiSigRate}
                size={96}
                strokeWidth={7}
                color={multiSigRate > 0.1 ? getEntityColor('success').color : getEntityColor('danger').color}
                valueLabel={`${(multiSigRate * 100).toFixed(1)}%`}
                // Redundant cue: glyph conveys multi-sig posture without hue.
                label={multiSigRate > 0.1 ? '✓ Multi-sig' : '⚠ Multi-sig'}
              />
              {/* B3: state the band honestly — this is our own indicator threshold,
                  not an industry standard. */}
              <div style={{ fontSize: 9, color: 'var(--text-tertiary)', textAlign: 'center', maxWidth: 110, lineHeight: 1.3 }}>
                Indicator turns positive above 10% multi-sig
              </div>
            </div>
            <div style={{ flex: 1, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Multi-sig pages<InfoTip term="multi-sig" /></span>
                <GlowBadge variant={data.security.multi_sig > 0 ? 'success' : 'danger'}>
                  <AnimatedCounter value={data.security.multi_sig} />
                </GlowBadge>
              </div>
              {/* B3: denominator behind the multi-sig ring's color. */}
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: -2 }}>
                {data.security.multi_sig} of {data.security.total_pages} pages
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Shared keys<InfoTip term="key-reuse" /></span>
                <GlowBadge variant={data.security.shared_key_count > 0 ? 'danger' : 'success'}>
                  <AnimatedCounter value={data.security.shared_key_count} />
                </GlowBadge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Zero-credit<InfoTip term="credits" /></span>
                <GlowBadge variant={data.security.zero_credit_pages > 0 ? 'warning' : 'success'}>
                  <AnimatedCounter value={data.security.zero_credit_pages} />
                </GlowBadge>
              </div>
              {/* B3: denominator behind the zero-credit signal. */}
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: -2 }}>
                {data.security.zero_credit_pages} of {data.security.total_pages} pages can’t sign
              </div>
            </div>
          </div>

          {/* B1+B2: surface the 1–2 most relevant headline risks in context
              (why it matters + Fix). Guard on the count so callouts only appear
              when the risk is actually present. */}
          {(data.security.shared_key_count > 0 || multiSigRate <= 0.1 || data.security.zero_credit_pages > 0) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
              {data.security.shared_key_count > 0 && <RiskNote risk="key-reuse" compact />}
              {data.security.shared_key_count === 0 && multiSigRate <= 0.1 && <RiskNote risk="single-sig" compact />}
              {data.security.zero_credit_pages > 0 && <RiskNote risk="zero-credit" compact />}
            </div>
          )}
        </GlassCard>

        {/* Authority Model */}
        <GlassCard title="Authority Model" delay={0.16}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <RingGauge
              value={data.authority.explicit / ((data.authority.explicit + data.authority.implied) || 1)}
              size={96}
              strokeWidth={7}
              color={getEntityColor('adi').color}
              valueLabel={`${data.authority.explicit}`}
              label="Explicit"
            />
            <div style={{ flex: 1, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Explicit<InfoTip term="implied-explicit" /></span>
                <GlowBadge variant="adi"><AnimatedCounter value={data.authority.explicit} /></GlowBadge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Implied<InfoTip term="implied-explicit" /></span>
                <GlowBadge variant="authority"><AnimatedCounter value={data.authority.implied} /></GlowBadge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Cross-ADI<InfoTip term="cross-adi" /> / Deleg.<InfoTip term="delegation" /></span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 11 }}>
                  <AnimatedCounter value={data.authority.cross_adi_books} /> / <AnimatedCounter value={data.authority.delegation_count} />
                </span>
              </div>
              <HeatStrip segments={[
                { value: data.authority.explicit, color: getEntityColor('adi').color, label: 'Explicit' },
                { value: data.authority.implied, color: getEntityColor('authority').color, label: 'Implied' },
              ]} />
            </div>
          </div>
        </GlassCard>
      </div>

      {/* ===== 1B-2. Lite Account Economy ===== */}
      {liteSummary && liteSummary.total > 0 && (() => {
        const bt = liteSummary.by_type || {};
        const ids = bt['lite_identity'] || 0;
        const toks = bt['lite_token_account'] || 0;
        const datas = bt['lite_data_account'] || 0;
        const acme = (liteSummary.total_acme_balance ?? 0) / 1e8;
        const credits = liteSummary.total_credits ?? 0;
        const active = liteSummary.active ?? 0;
        const dormant = liteSummary.dormant ?? 0;
        const enrichedPct = liteSummary.total > 0 && liteSummary.enriched !== undefined
          ? (liteSummary.enriched / liteSummary.total) * 100 : 0;
        const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
        const econ: { label: string; value: string; color: string; term?: string }[] = [
          { label: 'ACME held', value: fmt(acme), color: getEntityColor('token').color, term: 'token-account' },
          { label: 'Credits held', value: fmt(credits), color: getEntityColor('authority').color, term: 'credits' },
          { label: 'Active wallets', value: fmt(active), color: getEntityColor('success').color },
          { label: 'Dormant', value: fmt(dormant), color: 'var(--text-tertiary)' },
        ];
        return (
          <GlassCard
            title="Lite Account Economy"
            titleRight={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                  {enrichedPct.toFixed(1)}% enriched
                </span>
                <InfoTip term="lite-account" />
              </span>
            }
            delay={0.18}
          >
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.4 }}>
              The largest account class on Accumulate — wallets addressed by a key hash, not registered under any ADI.
              They hold most of the network’s circulating value. Click through to inspect any wallet.
            </div>

            {/* Economy stats */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 16,
            }}>
              {econ.map(e => (
                <div key={e.label} style={{
                  padding: '12px 14px', borderRadius: 10, background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: e.color, fontFamily: 'var(--font-mono)', lineHeight: 1.1 }}>
                    {e.value}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    {e.label}{e.term && <InfoTip term={e.term} />}
                  </div>
                </div>
              ))}
            </div>

            {/* Type composition — corrects the old "everything is a lite identity"
                mislabel: data accounts are now counted as their true on-chain type. */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Composition by type
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{fmt(liteSummary.total)} total</span>
            </div>
            <HeatStrip segments={[
              { value: datas, color: getEntityColor('data').color, label: 'Lite data accounts' },
              { value: toks, color: getEntityColor('token').color, label: 'Lite token accounts' },
              { value: ids, color: getEntityColor('key').color, label: 'Lite identities' },
            ]} height={10} />
            <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
              {[
                { label: 'Lite data accounts', n: datas, c: getEntityColor('data').color },
                { label: 'Lite token accounts', n: toks, c: getEntityColor('token').color },
                { label: 'Lite identities', n: ids, c: getEntityColor('key').color },
              ].map(x => (
                <span key={x.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: x.c }} />
                  {x.label} <strong style={{ color: 'var(--text-primary)' }}>{fmt(x.n)}</strong>
                </span>
              ))}
            </div>

            <button
              className="issuer-obs-view-btn"
              style={{ marginTop: 16 }}
              onClick={() => navigate('/accounts?tab=lite')}
            >
              Explore lite accounts →
            </button>
          </GlassCard>
        );
      })()}

      {/* ===== 1C. Network Topology Map (lazy-loaded) ===== */}
      <GlassCard
        title="Network Topology"
        titleRight={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, flexWrap: 'wrap' }}>
            <select
              value={colorBy}
              onChange={e => setColorBy(e.target.value)}
              style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                borderRadius: 6, padding: '3px 8px', color: 'var(--text-secondary)',
                fontSize: 10, cursor: 'pointer',
              }}
            >
              <option value="status">Color: Status</option>
              <option value="accounts">Color: Account count</option>
              <option value="depth">Color: Depth</option>
            </select>

            {(['hierarchy', 'authority', 'key_sharing', 'delegation'] as const).map(type => (
              <label key={type} style={{
                display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer',
                color: edgeFilters[type] ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                fontSize: 10,
              }}>
                <input type="checkbox" checked={edgeFilters[type]}
                  onChange={e => setEdgeFilters(f => ({ ...f, [type]: e.target.checked }))}
                  style={{ width: 12, height: 12 }} />
                {type.replace('_', ' ')}
              </label>
            ))}

            <label style={{
              display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer',
              color: hideEmpty ? 'var(--text-secondary)' : 'var(--text-tertiary)',
              fontSize: 10,
            }}>
              <input type="checkbox" checked={hideEmpty}
                onChange={e => setHideEmpty(e.target.checked)}
                style={{ width: 12, height: 12 }} />
              Hide empty/reserved ADIs
            </label>

            {topology && (
              <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>
                {topology.nodes.length} nodes &middot; {topology.edges.length} edges
              </span>
            )}
          </div>
        }
        delay={0.2}
      >
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Each dot is an identity (ADI); size = number of accounts, ◆ = a sub-identity. Click a node to open it in the tree.
        </div>
        {topoLoading || !topology ? (
          <div style={{ height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-elevated)', borderRadius: 12 }}>
            <PageLoader message="Loading network topology..." />
          </div>
        ) : (
          <TopologyMap data={topology} edgeFilters={edgeFilters} colorBy={colorBy} hideEmpty={hideEmpty} />
        )}
      </GlassCard>

      {/* ===== 1D. Insight Cards Row ===== */}
      <div className="dash-insight-grid" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 16,
      }}>
        <KeyReuseCard data={data} />
        <TokenEconomyCard data={data} />
        <AuthorityHotspotCard data={data} />
        <DepthCard data={data} />
      </div>

      {/* ===== Bottom: Top ADIs Chart ===== */}
      <GlassCard title="Top ADIs by Directory Entries" titleRight={<InfoTip term="directory-entries" />} delay={0.5}>
        <ResponsiveContainer width="100%" height={200} minWidth={0}>
          <BarChart data={topAdis} layout="vertical">
            <XAxis type="number" tick={{ fill: themeColors.canvasTextDim, fontSize: 11 }} axisLine={{ stroke: themeColors.gridLine }} tickLine={false} />
            <YAxis type="category" dataKey="name" width={170} tick={{ fill: themeColors.canvasTextDim, fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={getTooltipStyle(isDark)} cursor={{ fill: themeColors.cursorFill }} />
            <Bar dataKey="entries" fill={getEntityColor('key').color} radius={[0, 6, 6, 0]} name="Entries" barSize={12} />
          </BarChart>
        </ResponsiveContainer>
      </GlassCard>

      {/* ===== 1E. Crawl Status Breakdown ===== */}
      <GlassCard title="Crawl Status Breakdown" titleRight={<InfoTip term="crawl-coverage" />} delay={0.55}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
          gap: 10,
        }}>
          {Object.entries(data.adi_status).map(([status, count]) => (
            <div key={status} style={{
              textAlign: 'center', padding: '12px 8px', borderRadius: 10,
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
                <AnimatedCounter value={count} />
              </div>
              <GlowBadge variant={status === 'done' ? 'success' : status === 'error' ? 'danger' : 'warning'}>
                {/* Redundant glyph so status reads without relying on hue. */}
                {status === 'done' ? '✓ ' : status === 'error' ? '⚠ ' : '○ '}{status}
              </GlowBadge>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
