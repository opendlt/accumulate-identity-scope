import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { TopologyMap } from './dashboard/TopologyMap';
import { KeyReuseCard, TokenEconomyCard, AuthorityHotspotCard, DepthCard } from './dashboard/InsightCards';
import { useTheme } from '../contexts/ThemeContext';
import { getTooltipStyle, getThemeColors } from '../hooks/useThemeColors';

export function Dashboard() {
  const { isDark } = useTheme();
  const themeColors = getThemeColors(isDark);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['network-summary'],
    queryFn: api.getNetworkSummary,
    staleTime: 120000,
  });

  const { data: topology, isLoading: topoLoading } = useQuery({
    queryKey: ['topology'],
    queryFn: api.getTopology,
    staleTime: 300000,
  });

  const [edgeFilters, setEdgeFilters] = useState({
    hierarchy: true,
    authority: true,
    key_sharing: true,
    delegation: true,
  });
  const [colorBy, setColorBy] = useState('status');

  if (isError) {
    return <ErrorState title="Failed to load dashboard" message="Could not fetch network summary data." onRetry={() => refetch()} />;
  }

  if (isLoading || !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[120, 160, 420, 200].map((h, i) => (
          <div key={i} className="shimmer" style={{ height: h, borderRadius: 16 }} />
        ))}
      </div>
    );
  }

  const c = data.counts;
  const total = c.adis || 1;
  const doneCount = data.adi_status['done'] || 0;
  const errCount = data.adi_status['error'] || 0;
  const healthRate = doneCount / total;
  const multiSigRate = data.security.total_pages > 0
    ? data.security.multi_sig / data.security.total_pages : 0;

  const orbMetrics = [
    { value: c.adis,                label: 'ADIs',           ...getEntityColor('adi') },
    { value: c.token_accounts,      label: 'Token Accounts', ...getEntityColor('token') },
    { value: c.data_accounts,       label: 'Data Accounts',  ...getEntityColor('data') },
    { value: c.key_books,           label: 'Key Books',      ...getEntityColor('key') },
    { value: c.account_authorities, label: 'Authorities',    ...getEntityColor('authority') },
    { value: c.key_entries,         label: 'Key Entries',    ...getEntityColor('key') },
  ];

  const topAdis = data.top_adis.slice(0, 8).map(a => ({
    name: a.url.replace('acc://', '').slice(0, 22),
    entries: a.entry_count,
    tokens: a.token_count,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ===== 1A. Hero Metrics Strip ===== */}
      <GlassCard gradientTop delay={0}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: 4,
        }}>
          {orbMetrics.map((m, i) => (
            <StatOrb key={m.label} value={m.value} label={m.label}
              color={m.color} glow={m.glow} delay={i * 0.06} />
          ))}
        </div>
      </GlassCard>

      {/* ===== 1B. Network Vitals Row ===== */}
      <div className="grid-3">
        {/* Identity Health */}
        <GlassCard title="Identity Health" glow delay={0.08}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <RingGauge
              value={healthRate}
              size={96}
              strokeWidth={7}
              color={healthRate > 0.9 ? '#22c55e' : healthRate > 0.7 ? '#f59e0b' : '#ef4444'}
              valueLabel={`${(healthRate * 100).toFixed(1)}%`}
              label="Healthy"
            />
            <div style={{ flex: 1, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Crawled</span>
                <GlowBadge variant="success"><AnimatedCounter value={doneCount} /></GlowBadge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Errors</span>
                <GlowBadge variant={errCount > 0 ? 'danger' : 'success'}>
                  <AnimatedCounter value={errCount} />
                </GlowBadge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Root / Sub</span>
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
            <RingGauge
              value={multiSigRate}
              size={96}
              strokeWidth={7}
              color={multiSigRate > 0.1 ? '#22c55e' : '#ef4444'}
              valueLabel={`${(multiSigRate * 100).toFixed(1)}%`}
              label="Multi-sig"
            />
            <div style={{ flex: 1, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Multi-sig pages</span>
                <GlowBadge variant={data.security.multi_sig > 0 ? 'success' : 'danger'}>
                  <AnimatedCounter value={data.security.multi_sig} />
                </GlowBadge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Shared keys</span>
                <GlowBadge variant={data.security.shared_key_count > 0 ? 'danger' : 'success'}>
                  <AnimatedCounter value={data.security.shared_key_count} />
                </GlowBadge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Zero-credit</span>
                <GlowBadge variant={data.security.zero_credit_pages > 0 ? 'warning' : 'success'}>
                  <AnimatedCounter value={data.security.zero_credit_pages} />
                </GlowBadge>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Authority Model */}
        <GlassCard title="Authority Model" delay={0.16}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <RingGauge
              value={data.authority.explicit / ((data.authority.explicit + data.authority.implied) || 1)}
              size={96}
              strokeWidth={7}
              color="#6c8cff"
              valueLabel={`${data.authority.explicit}`}
              label="Explicit"
            />
            <div style={{ flex: 1, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Explicit</span>
                <GlowBadge variant="adi"><AnimatedCounter value={data.authority.explicit} /></GlowBadge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Implied</span>
                <GlowBadge variant="authority"><AnimatedCounter value={data.authority.implied} /></GlowBadge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Cross-ADI / Deleg.</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 11 }}>
                  <AnimatedCounter value={data.authority.cross_adi_books} /> / <AnimatedCounter value={data.authority.delegation_count} />
                </span>
              </div>
              <HeatStrip segments={[
                { value: data.authority.explicit, color: '#6c8cff', label: 'Explicit' },
                { value: data.authority.implied, color: '#f59e0b', label: 'Implied' },
              ]} />
            </div>
          </div>
        </GlassCard>
      </div>

      {/* ===== 1C. Network Topology Map ===== */}
      <GlassCard
        title="Network Topology"
        titleRight={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
            {/* Color-by selector */}
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

            {/* Edge toggles */}
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

            {topology && (
              <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>
                {topology.nodes.length} nodes &middot; {topology.edges.length} edges
              </span>
            )}
          </div>
        }
        delay={0.2}
      >
        {topoLoading || !topology ? (
          <div className="shimmer" style={{ height: 420, borderRadius: 12 }} />
        ) : (
          <TopologyMap data={topology} edgeFilters={edgeFilters} colorBy={colorBy} />
        )}
      </GlassCard>

      {/* ===== 1D. Insight Cards Row ===== */}
      <div style={{
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
      <GlassCard title="Top ADIs by Directory Entries" delay={0.5}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={topAdis} layout="vertical">
            <XAxis type="number" tick={{ fill: themeColors.canvasTextDim, fontSize: 11 }} axisLine={{ stroke: themeColors.gridLine }} tickLine={false} />
            <YAxis type="category" dataKey="name" width={170} tick={{ fill: themeColors.canvasTextDim, fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={getTooltipStyle(isDark)} cursor={{ fill: themeColors.cursorFill }} />
            <Bar dataKey="entries" fill="#34d399" radius={[0, 6, 6, 0]} name="Entries" barSize={12} />
          </BarChart>
        </ResponsiveContainer>
      </GlassCard>

      {/* ===== 1E. Crawl Status Breakdown ===== */}
      <GlassCard title="Crawl Status Breakdown" delay={0.55}>
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
                {status}
              </GlowBadge>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
