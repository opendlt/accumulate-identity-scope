import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api/client';
import { GlassCard } from './ui/GlassCard';
import { GlowBadge } from './ui/GlowBadge';
import { RingGauge } from './ui/RingGauge';
import { AnimatedCounter } from './ui/AnimatedCounter';
import type {
  TreeNode as TreeNodeType, ADI, TokenAccount, DataAccount,
  KeyBook, KeyPage, TokenIssuer, AuthorityRecord,
} from '../types';

/* ─── Helpers ──────────────────────────────────── */

function shortUrl(url: string) { return url.replace('acc://', ''); }

function nodeColor(node: TreeNodeType): string {
  if (node.token_count > 0 && node.data_count > 0) return '#6c8cff';
  if (node.token_count > 0) return '#22d3ee';
  if (node.data_count > 0) return '#a78bfa';
  if (node.book_count > 0) return '#34d399';
  return 'var(--text-tertiary)';
}

function hierarchyPath(tree: TreeNodeType[], targetUrl: string): TreeNodeType[] {
  for (const node of tree) {
    if (node.url === targetUrl) return [node];
    if (node.children) {
      const sub = hierarchyPath(node.children, targetUrl);
      if (sub.length) return [node, ...sub];
    }
  }
  return [];
}

/* ─── Tree Node (Left Panel) ──────────────────── */

interface TreeNodeProps {
  node: TreeNodeType;
  selected: string | null;
  onSelect: (url: string) => void;
  depth?: number;
  searchTerm: string;
  expandAll: boolean;
}

function TreeNodeComponent({ node, selected, onSelect, depth = 0, searchTerm, expandAll }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children && node.children.length > 0;
  const totalAccounts = node.token_count + node.data_count;
  const isSelected = selected === node.url;
  const [hovered, setHovered] = useState(false);

  // Auto-expand when expandAll changes or search matches
  useEffect(() => {
    if (expandAll) setExpanded(true);
  }, [expandAll]);

  const matchesSearch = searchTerm && node.url.toLowerCase().includes(searchTerm.toLowerCase());
  const childMatchesSearch = searchTerm && hasChildren && node.children.some(
    c => c.url.toLowerCase().includes(searchTerm.toLowerCase()) || hasMatchInTree(c, searchTerm)
  );

  // Auto-expand if a child matches search
  useEffect(() => {
    if (childMatchesSearch) setExpanded(true);
  }, [childMatchesSearch]);

  const dotColor = nodeColor(node);
  const dotSize = Math.max(5, Math.min(10, 5 + Math.log2((totalAccounts || 1) + 1)));

  return (
    <div className="tree-node">
      <div
        className={`tree-node-row ${isSelected ? 'selected' : ''} ${matchesSearch ? 'tree-node-row--match' : ''}`}
        onClick={() => onSelect(node.url)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Indent guides */}
        {depth > 0 && (
          <div className="tree-indent-guides" style={{ width: depth * 14 }}>
            {Array.from({ length: depth }).map((_, i) => (
              <div key={i} className="tree-indent-line" style={{ left: i * 14 + 7 }} />
            ))}
          </div>
        )}

        {/* Toggle */}
        <span
          className="tree-toggle"
          onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}
          style={{ transform: expanded && hasChildren ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        >
          {hasChildren ? '\u25BC' : ''}
        </span>

        {/* Node dot */}
        <span style={{
          width: dotSize, height: dotSize, borderRadius: '50%', flexShrink: 0,
          background: dotColor,
          boxShadow: isSelected || hovered ? `0 0 8px ${dotColor}80` : 'none',
          transition: 'box-shadow 0.2s, width 0.2s, height 0.2s',
        }} />

        {/* Status indicator */}
        {node.crawl_status !== 'done' && (
          <span style={{
            width: 4, height: 4, borderRadius: '50%', flexShrink: 0,
            background: node.crawl_status === 'error' ? '#ef4444' : '#f59e0b',
          }} />
        )}

        {/* Label */}
        <span className="tree-label" title={node.url}>
          {shortUrl(node.url)}
        </span>

        {/* Badges */}
        {totalAccounts > 0 && (
          <span className="tree-badge" style={{ background: `${dotColor}18`, color: dotColor, borderColor: `${dotColor}25` }}>
            {totalAccounts}
          </span>
        )}
      </div>

      {/* Mini tooltip on hover */}
      <AnimatePresence>
        {hovered && !isSelected && (
          <motion.div
            className="tree-node-tooltip"
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.12 }}
          >
            <span>{shortUrl(node.url)}</span>
            <span style={{ color: '#22d3ee' }}>{node.token_count}T</span>
            <span style={{ color: '#a78bfa' }}>{node.data_count}D</span>
            <span style={{ color: '#34d399' }}>{node.book_count}K</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Children */}
      <AnimatePresence initial={false}>
        {expanded && hasChildren && (
          <motion.div
            className="tree-children"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            {node.children.map(child => (
              <TreeNodeComponent
                key={child.url}
                node={child}
                selected={selected}
                onSelect={onSelect}
                depth={depth + 1}
                searchTerm={searchTerm}
                expandAll={expandAll}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function hasMatchInTree(node: TreeNodeType, term: string): boolean {
  if (node.url.toLowerCase().includes(term.toLowerCase())) return true;
  return node.children?.some(c => hasMatchInTree(c, term)) || false;
}

/* ─── ADI Detail Type ─────────────────────────── */

type ADIDetail = ADI & {
  children: ADI[];
  token_accounts: TokenAccount[];
  data_accounts: DataAccount[];
  key_books: KeyBook[];
  token_issuers: TokenIssuer[];
  authorities: AuthorityRecord[];
};

/* ─── Center Panel — Identity Profile Card ──── */

function IdentityProfile({ url, tree }: { url: string; tree: TreeNodeType[] }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['adi-detail', url],
    queryFn: () => api.getAdi(url),
  });
  const [tab, setTab] = useState('accounts');
  const [copied, setCopied] = useState(false);

  // Reset tab when selection changes
  useEffect(() => { setTab('accounts'); }, [url]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 20 }}>
        {[80, 60, 200].map((h, i) => (
          <div key={i} className="shimmer" style={{ height: h, borderRadius: 12 }} />
        ))}
      </div>
    );
  }
  if (!data || 'error' in data) {
    return <div className="loading">ADI not found</div>;
  }
  const d = data as ADIDetail;

  const path = hierarchyPath(tree, url);
  const totalAccounts = d.token_accounts.length + d.data_accounts.length;

  const tabs = [
    { id: 'accounts', label: 'Accounts', count: totalAccounts, icon: '\u25CF' },
    { id: 'security', label: 'Security', count: d.key_books.length, icon: '\u26BF' },
    { id: 'authority', label: 'Authority', count: d.authorities.length, icon: '\u2B2A' },
    { id: 'children', label: 'Sub-ADIs', count: d.children.length, icon: '\u25C8' },
    ...(d.token_issuers.length > 0 ? [{ id: 'issuers', label: 'Issuers', count: d.token_issuers.length, icon: '\u25C6' }] : []),
  ];

  const handleCopy = () => {
    navigator.clipboard.writeText(d.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="identity-profile">
      {/* ── Header ── */}
      <div className="identity-header">
        {/* Breadcrumb */}
        {path.length > 1 && (
          <div className="identity-breadcrumb">
            {path.map((p, i) => (
              <span key={p.url}>
                {i > 0 && <span className="identity-breadcrumb-sep">/</span>}
                <span className={i === path.length - 1 ? 'identity-breadcrumb-current' : 'identity-breadcrumb-parent'}>
                  {shortUrl(p.url).split('/').pop() || shortUrl(p.url)}
                </span>
              </span>
            ))}
          </div>
        )}

        <div className="identity-title-row">
          <div className="identity-title-left">
            <GlowBadge variant={d.crawl_status === 'done' ? 'success' : 'danger'}>
              {d.crawl_status}
            </GlowBadge>
            <GlowBadge variant={d.parent_url ? 'data' : 'adi'}>
              {d.parent_url ? 'Sub-ADI' : 'Root'}
            </GlowBadge>
          </div>
          <div className="identity-title-actions">
            <button className="identity-action-btn" onClick={handleCopy} title="Copy URL">
              {copied ? '\u2713' : '\u2398'}
            </button>
            <button className="identity-action-btn" onClick={() => navigate(`/network?select=${encodeURIComponent(d.url)}`)}>
              Graph
            </button>
          </div>
        </div>

        <h2 className="identity-url">{shortUrl(d.url)}</h2>

        {d.parent_url && (
          <div className="identity-parent">
            Child of <span className="identity-parent-link">{shortUrl(d.parent_url)}</span>
            &nbsp;&middot;&nbsp;{d.entry_count} directory entries
          </div>
        )}
        {!d.parent_url && (
          <div className="identity-parent">
            Root Identity &middot; {d.entry_count} directory entries
          </div>
        )}
      </div>

      {/* ── Metrics Row ── */}
      <div className="identity-metrics">
        {[
          { label: 'Token', value: d.token_accounts.length, color: '#22d3ee', max: 30 },
          { label: 'Data', value: d.data_accounts.length, color: '#a78bfa', max: 10 },
          { label: 'Key Books', value: d.key_books.length, color: '#34d399', max: 5 },
          { label: 'Sub-ADIs', value: d.children.length, color: '#6c8cff', max: 10 },
        ].map(m => (
          <div key={m.label} className="identity-metric-card">
            <RingGauge value={Math.min(m.value / m.max, 1)} size={44} strokeWidth={3.5} color={m.color}
              valueLabel={String(m.value)} />
            <div className="identity-metric-label">{m.label}</div>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div className="identity-tabs">
        {tabs.map(t => (
          <button
            key={t.id}
            className={`identity-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="identity-tab-icon">{t.icon}</span>
            {t.label}
            {t.count > 0 && <span className="identity-tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="identity-tab-content"
        >
          {tab === 'accounts' && <AccountsTab data={d} />}
          {tab === 'security' && <SecurityTab data={d} />}
          {tab === 'authority' && <AuthorityTab data={d} />}
          {tab === 'children' && <ChildrenTab data={d} />}
          {tab === 'issuers' && <IssuersTab data={d} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ─── Tab: Accounts ──────────────────────────── */

function AccountsTab({ data }: { data: ADIDetail }) {
  const [filter, setFilter] = useState('');
  const [sortCol, setSortCol] = useState<'url' | 'type' | 'token'>('url');
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const allAccounts = useMemo(() => {
    const items = [
      ...data.token_accounts.map(a => ({ url: a.url, type: 'token' as const, token: a.token_url })),
      ...data.data_accounts.map(a => ({ url: a.url, type: 'data' as const, token: '-' })),
    ];
    return items;
  }, [data]);

  const filtered = useMemo(() => {
    let list = allAccounts;
    if (filter) {
      const term = filter.toLowerCase();
      list = list.filter(a => a.url.toLowerCase().includes(term) || a.token.toLowerCase().includes(term));
    }
    list.sort((a, b) => {
      const va = a[sortCol] || '';
      const vb = b[sortCol] || '';
      return va < vb ? -sortDir : va > vb ? sortDir : 0;
    });
    return list;
  }, [allAccounts, filter, sortCol, sortDir]);

  const handleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir(d => d === 1 ? -1 : 1);
    else { setSortCol(col); setSortDir(1); }
  };

  if (allAccounts.length === 0) {
    return <EmptyState icon="\u25CF" message="No accounts found for this ADI" />;
  }

  return (
    <div>
      <div className="identity-tab-toolbar">
        <input
          type="text"
          placeholder="Filter accounts..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="identity-filter-input"
        />
        <span className="identity-tab-counter">
          {filtered.length} of {allAccounts.length}
        </span>
      </div>

      <div className="identity-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('url')} className="sortable-th">
                Account URL {sortCol === 'url' && (sortDir === 1 ? '\u25B2' : '\u25BC')}
              </th>
              <th onClick={() => handleSort('type')} className="sortable-th">
                Type {sortCol === 'type' && (sortDir === 1 ? '\u25B2' : '\u25BC')}
              </th>
              <th onClick={() => handleSort('token')} className="sortable-th">
                Token {sortCol === 'token' && (sortDir === 1 ? '\u25B2' : '\u25BC')}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 100).map(a => (
              <tr key={a.url}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      width: 4, height: 4, borderRadius: '50%',
                      background: a.type === 'token' ? '#22d3ee' : '#a78bfa',
                      flexShrink: 0,
                    }} />
                    <span className="url-link">{shortUrl(a.url)}</span>
                  </div>
                </td>
                <td>
                  <GlowBadge variant={a.type}>{a.type}</GlowBadge>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                  {a.token !== '-' ? shortUrl(a.token) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 100 && (
          <div className="identity-table-more">
            Showing 100 of {filtered.length} accounts
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Tab: Security ──────────────────────────── */

function SecurityTab({ data }: { data: ADIDetail }) {
  if (data.key_books.length === 0) {
    return <EmptyState icon="\u26BF" message="No key books for this ADI" />;
  }

  return (
    <div className="security-grid">
      {data.key_books.map(book => (
        <KeyBookCard key={book.url} book={book} />
      ))}
    </div>
  );
}

function KeyBookCard({ book }: { book: KeyBook }) {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['key-book', book.url],
    queryFn: () => api.getKeyBook(book.url),
    enabled: expanded,
  });

  return (
    <div className="key-book-card">
      <div className="key-book-card-header" onClick={() => setExpanded(!expanded)}>
        <div className="key-book-card-left">
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: '#34d399',
            boxShadow: '0 0 8px rgba(52,211,153,0.3)',
          }} />
          <span className="key-book-card-url">{shortUrl(book.url)}</span>
        </div>
        <div className="key-book-card-right">
          <GlowBadge variant="key">{book.page_count} {book.page_count === 1 ? 'page' : 'pages'}</GlowBadge>
          <span className="tree-toggle" style={{
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 0.2s',
          }}>{'\u25BC'}</span>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{ overflow: 'hidden' }}
          >
            {isLoading ? (
              <div className="shimmer" style={{ height: 60, margin: 8, borderRadius: 8 }} />
            ) : data?.pages ? (
              <div className="key-book-pages">
                {data.pages.map(page => (
                  <KeyPageCard key={page.url} page={page} />
                ))}
              </div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function KeyPageCard({ page }: { page: KeyPage }) {
  const isMultiSig = page.threshold > 1;
  const thresholdLabel = `${page.threshold}/${page.keys.length || 1}`;

  return (
    <div className="key-page-card">
      <div className="key-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <RingGauge
            value={Math.min(page.threshold / Math.max(page.keys.length, 1), 1)}
            size={36}
            strokeWidth={3}
            color={isMultiSig ? '#22c55e' : '#f59e0b'}
            valueLabel={thresholdLabel}
          />
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>
              {shortUrl(page.url)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', display: 'flex', gap: 8 }}>
              <span>v{page.version}</span>
              <span>{isMultiSig ? 'Multi-sig' : 'Single-sig'}</span>
              <span>
                {page.credit_balance > 0 ? (
                  <span style={{ color: '#22c55e' }}>{page.credit_balance} credits</span>
                ) : (
                  <span style={{ color: '#ef4444' }}>0 credits</span>
                )}
              </span>
            </div>
          </div>
        </div>
        <GlowBadge variant={isMultiSig ? 'success' : 'warning'}>
          {thresholdLabel}
        </GlowBadge>
      </div>

      {page.keys.length > 0 && (
        <div className="key-entries">
          {page.keys.map((k, i) => (
            <div key={i} className="key-entry">
              <div className="key-entry-hash">
                {k.public_key_hash || k.public_key || 'No key hash'}
              </div>
              <div className="key-entry-meta">
                {k.delegate && (
                  <GlowBadge variant="authority">
                    delegate: {shortUrl(k.delegate).slice(0, 20)}
                  </GlowBadge>
                )}
                {k.last_used_on ? (
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>
                    Last used: {new Date(k.last_used_on * 1000).toLocaleDateString()}
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>Never used</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Tab: Authority ─────────────────────────── */

function AuthorityTab({ data }: { data: ADIDetail }) {
  if (data.authorities.length === 0) {
    return <EmptyState icon="\u2B2A" message="No authority records" />;
  }

  const explicit = data.authorities.filter(a => !a.is_implied);
  const implied = data.authorities.filter(a => a.is_implied);

  return (
    <div>
      {/* Authority Flow Diagram */}
      <AuthorityFlowDiagram adi={data} />

      {/* Authority List */}
      <div style={{ marginTop: 16 }}>
        {explicit.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div className="identity-section-label">Explicit ({explicit.length})</div>
            {explicit.map((a, i) => (
              <AuthorityRow key={i} authority={a} />
            ))}
          </div>
        )}
        {implied.length > 0 && (
          <div>
            <div className="identity-section-label">Implied ({implied.length})</div>
            {implied.map((a, i) => (
              <AuthorityRow key={i} authority={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AuthorityRow({ authority }: { authority: AuthorityRecord }) {
  const isExternal = authority.authority_url.split('/')[0] !== authority.account_url.split('/')[0];
  return (
    <div className="authority-row">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: authority.is_implied ? '#f59e0b' : '#6c8cff',
        }} />
        <span className="url-link" style={{ fontSize: 12 }}>{shortUrl(authority.authority_url)}</span>
        {isExternal && (
          <GlowBadge variant="issuer">external</GlowBadge>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <GlowBadge variant={authority.is_implied ? 'authority' : 'adi'}>
          {authority.is_implied ? 'implied' : 'explicit'}
        </GlowBadge>
        {authority.disabled ? <GlowBadge variant="danger">disabled</GlowBadge> : null}
      </div>
    </div>
  );
}

/* ─── Authority Flow Diagram (SVG) ──────────── */

function AuthorityFlowDiagram({ adi }: { adi: ADIDetail }) {
  if (adi.authorities.length === 0) return null;

  const uniqueAuthorities = [...new Set(adi.authorities.map(a => a.authority_url))];
  const W = 560;
  const nodeH = 28;
  const centerX = W / 2;
  const centerY = 40;
  const authStartY = 100;
  const spacing = Math.min(50, 300 / Math.max(uniqueAuthorities.length, 1));
  const totalH = authStartY + uniqueAuthorities.length * spacing + 20;

  return (
    <div className="authority-flow-container">
      <svg width="100%" viewBox={`0 0 ${W} ${totalH}`} className="authority-flow-svg">
        {/* Center ADI node */}
        <rect x={centerX - 100} y={centerY - nodeH / 2} width={200} height={nodeH}
          rx={8} fill="rgba(108,140,255,0.12)" stroke="#6c8cff" strokeWidth={1} />
        <text x={centerX} y={centerY + 4} textAnchor="middle"
          fill="#e8ecf4" fontSize={10} fontFamily="var(--font-mono)" fontWeight={600}>
          {shortUrl(adi.url).slice(0, 28)}
        </text>

        {/* Authority nodes + connections */}
        {uniqueAuthorities.map((authUrl, i) => {
          const authRecords = adi.authorities.filter(a => a.authority_url === authUrl);
          const isImplied = authRecords.some(a => a.is_implied);
          const isExternal = authUrl.split('/')[0] !== adi.url.replace('acc://', '').split('/')[0];
          const y = authStartY + i * spacing;
          const nodeColor = isImplied ? '#f59e0b' : '#6c8cff';

          return (
            <g key={authUrl}>
              {/* Connection line */}
              <line
                x1={centerX} y1={centerY + nodeH / 2}
                x2={centerX} y2={y - nodeH / 2}
                stroke={nodeColor}
                strokeWidth={1}
                strokeDasharray={isImplied ? '4,3' : undefined}
                opacity={0.5}
              />

              {/* Arrow */}
              <polygon
                points={`${centerX},${y - nodeH / 2} ${centerX - 4},${y - nodeH / 2 - 6} ${centerX + 4},${y - nodeH / 2 - 6}`}
                fill={nodeColor}
                opacity={0.6}
              />

              {/* Authority node */}
              <rect
                x={centerX - 120} y={y - nodeH / 2} width={240} height={nodeH}
                rx={8}
                fill={isExternal ? 'rgba(244,114,182,0.08)' : `${nodeColor}15`}
                stroke={isExternal ? '#f472b6' : nodeColor}
                strokeWidth={0.8}
                strokeDasharray={isImplied ? '3,2' : undefined}
              />
              <text x={centerX} y={y + 4} textAnchor="middle"
                fill={isExternal ? '#f472b6' : 'var(--text-primary)'} fontSize={9} fontFamily="var(--font-mono)">
                {shortUrl(authUrl).slice(0, 32)}
              </text>

              {/* Type badge */}
              <text x={centerX + 130} y={y + 3} textAnchor="start"
                fill={nodeColor} fontSize={8} fontWeight={600}>
                {isImplied ? 'IMPLIED' : 'EXPLICIT'}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ─── Tab: Children ──────────────────────────── */

function ChildrenTab({ data }: { data: ADIDetail }) {
  if (data.children.length === 0) {
    return <EmptyState icon="\u25C8" message="No sub-ADIs" />;
  }

  return (
    <div className="children-grid">
      {data.children.map(child => (
        <div key={child.url} className="child-card">
          <div className="child-card-top">
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: child.crawl_status === 'done' ? '#22c55e' : '#ef4444',
            }} />
            <span className="url-link" style={{ flex: 1 }}>{shortUrl(child.url)}</span>
            <GlowBadge variant={child.crawl_status === 'done' ? 'success' : 'danger'}>
              {child.crawl_status}
            </GlowBadge>
          </div>
          <div className="child-card-stats">
            <span>{child.entry_count} entries</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Tab: Issuers ──────────────────────────── */

function IssuersTab({ data }: { data: ADIDetail }) {
  return (
    <div className="issuers-grid">
      {data.token_issuers.map(t => {
        const issued = parseFloat(t.issued) || 0;
        const limit = parseFloat(t.supply_limit) || 0;
        const utilization = limit > 0 ? issued / limit : 0;

        return (
          <div key={t.url} className="issuer-card">
            <div className="issuer-card-header">
              <div className="issuer-symbol">{t.symbol}</div>
              <GlowBadge variant="issuer">{t.symbol}</GlowBadge>
            </div>
            <div className="issuer-card-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {limit > 0 && (
                  <RingGauge value={utilization} size={52} strokeWidth={4} color="#f472b6"
                    valueLabel={`${(utilization * 100).toFixed(0)}%`} label="Used" />
                )}
                <div style={{ flex: 1, fontSize: 11 }}>
                  <div className="issuer-stat">
                    <span>Precision</span><strong>{t.precision}</strong>
                  </div>
                  <div className="issuer-stat">
                    <span>Issued</span><strong>{t.issued}</strong>
                  </div>
                  <div className="issuer-stat">
                    <span>Supply Limit</span><strong>{t.supply_limit || '\u221E'}</strong>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
                {shortUrl(t.url)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Empty State ────────────────────────────── */

function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <div className="identity-empty">
      <span className="identity-empty-icon">{icon}</span>
      <span>{message}</span>
    </div>
  );
}

/* ─── Right Panel — Context Sidebar ─────────── */

function ContextSidebar({ url, data }: { url: string; data?: ADIDetail }) {
  const { data: intel } = useQuery({
    queryKey: ['intelligence'],
    queryFn: api.getIntelligence,
    staleTime: 300000,
  });

  if (!data) return null;

  // Find key overlaps from intelligence data
  const keyOverlaps = intel?.key_reuse.filter(
    kr => kr.adi_urls.includes(url)
  ) || [];

  // Find authority reach
  const authorityReach = intel?.authority_concentration.filter(
    ac => data.authorities.some(a => a.authority_url === ac.authority_url)
  ) || [];

  // Related ADIs (those sharing authority books)
  const relatedAdis = intel?.cross_authority.filter(
    ca => data.authorities.some(a => a.authority_url === ca.authority_url)
  ) || [];

  // Delegations involving this ADI
  const delegations = intel?.delegations.filter(
    d => d.delegator_adi === url || shortUrl(d.delegate).startsWith(shortUrl(url))
  ) || [];

  return (
    <div className="context-sidebar">
      <div className="context-sidebar-title">Context</div>

      {/* Quick Stats */}
      <div className="context-section">
        <div className="context-section-title">Quick Stats</div>
        <div className="context-stat-grid">
          <div className="context-stat">
            <div className="context-stat-value" style={{ color: '#22d3ee' }}>
              <AnimatedCounter value={data.token_accounts.length} />
            </div>
            <div className="context-stat-label">Tokens</div>
          </div>
          <div className="context-stat">
            <div className="context-stat-value" style={{ color: '#a78bfa' }}>
              <AnimatedCounter value={data.data_accounts.length} />
            </div>
            <div className="context-stat-label">Data</div>
          </div>
          <div className="context-stat">
            <div className="context-stat-value" style={{ color: '#34d399' }}>
              <AnimatedCounter value={data.key_books.length} />
            </div>
            <div className="context-stat-label">Books</div>
          </div>
          <div className="context-stat">
            <div className="context-stat-value" style={{ color: '#f59e0b' }}>
              <AnimatedCounter value={data.authorities.length} />
            </div>
            <div className="context-stat-label">Auth</div>
          </div>
        </div>
      </div>

      {/* Key Overlap Warning */}
      {keyOverlaps.length > 0 && (
        <div className="context-section">
          <div className="context-section-title" style={{ color: '#ef4444' }}>Key Overlap</div>
          {keyOverlaps.map((ko, i) => (
            <div key={i} className="context-overlap-item">
              <div style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>
                {ko.adi_count} ADIs share key
              </div>
              <div className="key-hash" style={{ fontSize: 9 }}>
                {ko.key_hash.slice(0, 16)}...
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
                {ko.adi_urls.filter(u => u !== url).slice(0, 4).map(u => (
                  <span key={u} className="context-tag">{shortUrl(u).slice(0, 16)}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Authority Reach */}
      {authorityReach.length > 0 && (
        <div className="context-section">
          <div className="context-section-title">Authority Reach</div>
          {authorityReach.map((ar, i) => (
            <div key={i} className="context-reach-item">
              <span className="url-link" style={{ fontSize: 10 }}>
                {shortUrl(ar.authority_url).slice(0, 22)}
              </span>
              <div style={{ display: 'flex', gap: 6, fontSize: 10, color: 'var(--text-tertiary)' }}>
                <span>{ar.total_accounts} accts</span>
                <span>&middot;</span>
                <span>{ar.explicit_count} explicit</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Related ADIs */}
      {relatedAdis.length > 0 && (
        <div className="context-section">
          <div className="context-section-title">Related Entities</div>
          {relatedAdis.slice(0, 5).map((ra, i) => (
            <div key={i} className="context-related-item">
              <span className="url-link" style={{ fontSize: 10 }}>
                {shortUrl(ra.authority_url).slice(0, 24)}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                governs {ra.governed_count}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Delegations */}
      {delegations.length > 0 && (
        <div className="context-section">
          <div className="context-section-title">Delegations</div>
          {delegations.map((d, i) => (
            <div key={i} className="context-delegation-item">
              <div style={{ fontSize: 10 }}>
                <span style={{ color: '#34d399' }}>{shortUrl(d.delegate).slice(0, 18)}</span>
                <span style={{ color: 'var(--text-tertiary)' }}> via </span>
                <span style={{ color: 'var(--text-secondary)' }}>{shortUrl(d.key_page).slice(0, 18)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Mini connection graph placeholder */}
      <div className="context-section">
        <div className="context-section-title">Network Position</div>
        <div style={{
          height: 80, borderRadius: 8, background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, color: 'var(--text-tertiary)',
        }}>
          {data.authorities.length} authorities &middot; {data.children.length} children
        </div>
      </div>
    </div>
  );
}

/* ─── Main Export ─────────────────────────────── */

export function TreeExplorer() {
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(params.get('select'));
  const [searchTerm, setSearchTerm] = useState('');
  const [expandAll, setExpandAll] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
  const treeRef = useRef<HTMLDivElement>(null);

  const { data: tree, isLoading } = useQuery({
    queryKey: ['tree'],
    queryFn: () => api.getTree(),
  });

  // Detail data for context sidebar
  const { data: selectedDetail } = useQuery({
    queryKey: ['adi-detail', selected],
    queryFn: () => api.getAdi(selected!),
    enabled: !!selected,
  });

  const handleSelect = useCallback((url: string) => {
    setSelected(url);
    setParams({ select: url });
  }, [setParams]);

  // Count tree nodes
  const nodeCount = useMemo(() => {
    if (!tree) return 0;
    function count(nodes: TreeNodeType[]): number {
      return nodes.reduce((sum, n) => sum + 1 + count(n.children || []), 0);
    }
    return count(tree);
  }, [tree]);

  if (isLoading) {
    return (
      <div className="tree-layout-3">
        <div className="shimmer" style={{ height: '100%', borderRadius: 16 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="shimmer" style={{ height: 80, borderRadius: 12 }} />
          <div className="shimmer" style={{ height: 60, borderRadius: 12 }} />
          <div className="shimmer" style={{ height: 300, borderRadius: 12 }} />
        </div>
        <div className="shimmer" style={{ height: '100%', borderRadius: 16 }} />
      </div>
    );
  }
  if (!tree) return null;

  return (
    <div className={`tree-layout-3 ${!contextOpen ? 'context-closed' : ''}`}>
      {/* ── Left Panel: Visual Tree ── */}
      <div className="tree-panel-3" ref={treeRef}>
        {/* Tree toolbar */}
        <div className="tree-toolbar">
          <input
            type="text"
            placeholder="Search identities..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="tree-search-input"
          />
          <div className="tree-toolbar-actions">
            <button
              className="tree-toolbar-btn"
              onClick={() => setExpandAll(!expandAll)}
              title={expandAll ? 'Collapse all' : 'Expand all'}
            >
              {expandAll ? '\u25BC' : '\u25B6'} All
            </button>
            <span className="tree-node-count">{nodeCount} ADIs</span>
          </div>
        </div>

        {/* Tree content */}
        <div className="tree-scroll">
          {tree.map(node => (
            <TreeNodeComponent
              key={node.url}
              node={node}
              selected={selected}
              onSelect={handleSelect}
              searchTerm={searchTerm}
              expandAll={expandAll}
            />
          ))}
        </div>
      </div>

      {/* ── Center Panel: Identity Profile ── */}
      <div className="detail-panel-3">
        {selected ? (
          <IdentityProfile url={selected} tree={tree} />
        ) : (
          <div className="identity-empty-state">
            <div className="identity-empty-icon-large">{'\u25C8'}</div>
            <div className="identity-empty-title">Select an Identity</div>
            <div className="identity-empty-desc">
              Choose an ADI from the tree to explore its accounts, security, and authority chain.
            </div>
          </div>
        )}
      </div>

      {/* ── Right Panel: Context Sidebar ── */}
      <div className={`context-panel-3 ${contextOpen ? '' : 'collapsed'}`}>
        <button
          className="context-toggle"
          onClick={() => setContextOpen(!contextOpen)}
          title={contextOpen ? 'Hide context' : 'Show context'}
        >
          {contextOpen ? '\u276F' : '\u276E'}
        </button>
        {contextOpen && selected && (
          <ContextSidebar url={selected} data={selectedDetail as ADIDetail | undefined} />
        )}
      </div>
    </div>
  );
}
