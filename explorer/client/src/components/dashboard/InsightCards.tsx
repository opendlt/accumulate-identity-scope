import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { GlassCard } from '../ui/GlassCard';
import { AnimatedCounter } from '../ui/AnimatedCounter';
import { GlowBadge } from '../ui/GlowBadge';
import type { NetworkSummary } from '../../types';
import { useTheme } from '../../contexts/ThemeContext';
import { getTooltipStyle, getThemeColors } from '../../hooks/useThemeColors';

function CardStripe({ color }: { color: string }) {
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, height: 3,
      background: color, borderRadius: '16px 16px 0 0',
    }} />
  );
}

export function KeyReuseCard({ data }: { data: NetworkSummary }) {
  const { isDark } = useTheme();
  const themeColors = getThemeColors(isDark);
  if (data.top_key_reuse.length === 0) return null;

  const chartData = data.top_key_reuse.map(d => ({
    name: d.key_hash.slice(0, 8) + '..',
    adis: d.adi_count,
  }));
  const top = data.top_key_reuse[0];

  return (
    <GlassCard delay={0.3} style={{ position: 'relative', overflow: 'hidden' }}>
      <CardStripe color="linear-gradient(90deg, #ef4444, #f97316)" />
      <div style={{ padding: '16px 0 0' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Top Key Reuse
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 28, fontWeight: 800, color: '#ef4444' }}>
            <AnimatedCounter value={top.adi_count} />
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>ADIs share 1 key</span>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 10 }}>
          {top.key_hash.slice(0, 24)}...
        </div>
        <ResponsiveContainer width="100%" height={100}>
          <BarChart data={chartData} layout="vertical">
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={70} tick={{ fill: themeColors.canvasTextDim, fontSize: 9 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={getTooltipStyle(isDark)} />
            <Bar dataKey="adis" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={10} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </GlassCard>
  );
}

export function TokenEconomyCard({ data }: { data: NetworkSummary }) {
  const { isDark } = useTheme();
  const themeColors = getThemeColors(isDark);
  const acmeCount = data.token_distribution.find(t => t.token_url === 'acc://ACME')?.count || 0;
  const customCount = data.counts.token_accounts - acmeCount;
  const pieData = [
    { name: 'ACME', value: acmeCount },
    { name: 'Custom', value: customCount },
  ];

  return (
    <GlassCard delay={0.35} style={{ position: 'relative', overflow: 'hidden' }}>
      <CardStripe color="linear-gradient(90deg, #22d3ee, #6c8cff)" />
      <div style={{ padding: '16px 0 0' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Token Economy
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 80, height: 80 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={36} innerRadius={18} dataKey="value" strokeWidth={0}>
                  <Cell fill="#22d3ee" />
                  <Cell fill="#a78bfa" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ flex: 1, fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22d3ee' }} />
              <span style={{ color: 'var(--text-secondary)' }}>ACME</span>
              <strong style={{ marginLeft: 'auto', color: 'var(--text-primary)' }}><AnimatedCounter value={acmeCount} /></strong>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#a78bfa' }} />
              <span style={{ color: 'var(--text-secondary)' }}>Custom</span>
              <strong style={{ marginLeft: 'auto', color: 'var(--text-primary)' }}><AnimatedCounter value={customCount} /></strong>
            </div>
            {data.token_distribution.filter(t => t.token_url !== 'acc://ACME').map(t => (
              <div key={t.token_url} style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                <GlowBadge variant="issuer">{t.token_url.replace('acc://', '')}</GlowBadge>
                <span style={{ marginLeft: 4 }}>{t.count} holders</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

export function AuthorityHotspotCard({ data }: { data: NetworkSummary }) {
  const { isDark } = useTheme();
  const themeColors = getThemeColors(isDark);
  if (data.top_authority_books.length === 0) return null;
  const top = data.top_authority_books[0];
  const chartData = data.top_authority_books.map(b => ({
    name: b.authority_url.replace('acc://', '').slice(0, 18),
    count: b.governed_count,
  }));

  return (
    <GlassCard delay={0.4} style={{ position: 'relative', overflow: 'hidden' }}>
      <CardStripe color="linear-gradient(90deg, #f59e0b, #f472b6)" />
      <div style={{ padding: '16px 0 0' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Authority Hotspot
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 28, fontWeight: 800, color: '#f59e0b' }}>
            <AnimatedCounter value={top.governed_count} />
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>accounts governed</span>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>
          {top.authority_url}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10 }}>
          <AnimatedCounter value={data.authority.cross_adi_books} /> cross-ADI books &middot;{' '}
          <AnimatedCounter value={data.authority.delegation_count} /> delegations
        </div>
        <ResponsiveContainer width="100%" height={80}>
          <BarChart data={chartData} layout="vertical">
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={120} tick={{ fill: themeColors.canvasTextDim, fontSize: 9 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={getTooltipStyle(isDark)} />
            <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={8} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </GlassCard>
  );
}

export function DepthCard({ data }: { data: NetworkSummary }) {
  const { isDark } = useTheme();
  const themeColors = getThemeColors(isDark);
  const chartData = data.depth_distribution.map(d => ({
    name: `D${d.depth}`,
    count: d.count,
  }));

  return (
    <GlassCard delay={0.45} style={{ position: 'relative', overflow: 'hidden' }}>
      <CardStripe color="linear-gradient(90deg, #6c8cff, #34d399)" />
      <div style={{ padding: '16px 0 0' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Hierarchy Depth
        </div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          {data.depth_distribution.map(d => (
            <div key={d.depth} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
                <AnimatedCounter value={d.count} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Depth {d.depth}</div>
            </div>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={80}>
          <BarChart data={chartData}>
            <XAxis dataKey="name" tick={{ fill: themeColors.canvasTextDim, fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={getTooltipStyle(isDark)} />
            <Bar dataKey="count" fill="#6c8cff" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </GlassCard>
  );
}
