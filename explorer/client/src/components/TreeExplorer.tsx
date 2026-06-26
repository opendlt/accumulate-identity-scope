import { useState, useMemo, useCallback, useRef, useEffect, forwardRef } from 'react';
import type React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Virtuoso } from 'react-virtuoso';
import type { VirtuosoHandle } from 'react-virtuoso';
import { api, ApiError } from '../api/client';
import { GlowBadge } from './ui/GlowBadge';
import { RingGauge } from './ui/RingGauge';
import { AnimatedCounter } from './ui/AnimatedCounter';
import { PageLoader } from './ui/PageLoader';
import { getEntityColor } from '../hooks/useEntityColor';
import { InfoTip, TermLabel } from './ui/InfoTip';
import { RiskNote } from './ui/RiskNote';
import { SecurityReportCard } from './ui/SecurityReportCard';
import type {
  TreeNode as TreeNodeType, ADI, TokenAccount, DataAccount,
  KeyBook, KeyPage, TokenIssuer, AuthorityRecord,
} from '../types';

/* ─── Helpers ──────────────────────────────────── */

function shortUrl(url: string) { return url.replace('acc://', ''); }

function nodeColor(node: TreeNodeType): string {
  if (node.token_count > 0 && node.data_count > 0) return getEntityColor('adi').color;
  if (node.token_count > 0) return getEntityColor('token').color;
  if (node.data_count > 0) return getEntityColor('data').color;
  if (node.book_count > 0) return getEntityColor('key').color;
  return 'var(--text-tertiary)';
}

/**
 * Redundant (color-blind safe) cue for node type. Returns a single-letter
 * marker consistent with the dot color in nodeColor():
 *   M = mixed (token + data), T = token, D = data, K = key book, A = plain ADI.
 * Used alongside (not instead of) the colored dot so type reads without hue.
 */
function nodeTypeMarker(node: TreeNodeType): string {
  if (node.token_count > 0 && node.data_count > 0) return 'M';
  if (node.token_count > 0) return 'T';
  if (node.data_count > 0) return 'D';
  if (node.book_count > 0) return 'K';
  return 'A';
}

/**
 * Compact legend (A6) for the redundant single-letter node-type markers shown on
 * each tree row. Colors mirror nodeColor()/nodeTypeMarker() so the swatches match
 * the dots in the tree. Definitions-only: no metrics or counts here.
 */
function NodeTypeLegend() {
  const items: { letter: string; color: string; meaning: string }[] = [
    { letter: 'A', color: getEntityColor('adi').color, meaning: 'identity' },
    { letter: 'T', color: getEntityColor('token').color, meaning: 'has token accounts' },
    { letter: 'D', color: getEntityColor('data').color, meaning: 'has data accounts' },
    { letter: 'K', color: getEntityColor('key').color, meaning: 'has key books' },
    { letter: 'M', color: getEntityColor('adi').color, meaning: 'mixed' },
  ];
  return (
    <div
      className="tree-type-legend"
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px',
        padding: '6px 12px', fontSize: 10, color: 'var(--text-tertiary)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
      aria-label="Node type markers"
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
        Markers
        <InfoTip term="adi" />
      </span>
      {items.map(it => (
        <span key={it.letter} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', background: it.color, flexShrink: 0,
          }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: it.color }}>{it.letter}</span>
          <span>= {it.meaning}</span>
        </span>
      ))}
    </div>
  );
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

/* ─── Tree flattening + search (Left Panel) ──── */

const INDENT = 14;

/**
 * Single pass over the tree (called inside a useMemo keyed on [tree, searchTerm]),
 * produces:
 *  - matches:   Set of node urls whose own url matches the term
 *  - ancestors: Set of ancestor urls that must be expanded to reveal a match
 * No per-node subtree walking happens during render.
 */
interface SearchSets {
  matches: Set<string>;
  ancestors: Set<string>;
}

function computeSearchSets(tree: TreeNodeType[], searchTerm: string): SearchSets {
  const matches = new Set<string>();
  const ancestors = new Set<string>();
  const term = searchTerm.trim().toLowerCase();
  if (!term) return { matches, ancestors };

  // Returns true if `node` or any descendant matches; records ancestors along the way.
  function walk(node: TreeNodeType): boolean {
    const selfMatch = node.url.toLowerCase().includes(term);
    if (selfMatch) matches.add(node.url);

    let childMatch = false;
    if (node.children) {
      for (const child of node.children) {
        if (walk(child)) childMatch = true;
      }
    }
    // If a descendant matched, this node is an ancestor that must be expanded.
    if (childMatch) ancestors.add(node.url);
    return selfMatch || childMatch;
  }

  for (const root of tree) walk(root);
  return { matches, ancestors };
}

/** Collect every url in the tree (used by "Expand all"). */
function collectAllUrls(tree: TreeNodeType[]): Set<string> {
  const urls = new Set<string>();
  function walk(nodes: TreeNodeType[]) {
    for (const n of nodes) {
      urls.add(n.url);
      if (n.children) walk(n.children);
    }
  }
  walk(tree);
  return urls;
}

/** Default first-load expansion: root nodes expanded (matches prior depth < 1 UX). */
function defaultExpandedUrls(tree: TreeNodeType[]): Set<string> {
  const urls = new Set<string>();
  for (const n of tree) urls.add(n.url);
  return urls;
}

interface FlatRow {
  node: TreeNodeType;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  isMatch: boolean;
  isSelected: boolean;
}

/** Flatten the tree into the list of VISIBLE rows, respecting the effective expanded set.
 *
 * When a search is active (`ancestors`/`matches` non-empty), the list is PRUNED to
 * the match-path tree: only matching nodes and the ancestor chain leading to them
 * are emitted. Without this prune, searching a 43k-ADI tree merely highlighted rows
 * that stayed buried in the virtual list — the search read as "broken". A matched
 * node's own (non-matching) descendants are hidden so the result reads as a filtered
 * list, not a re-rooted tree. */
function flattenTree(
  tree: TreeNodeType[],
  expanded: Set<string>,
  matches: Set<string>,
  ancestors: Set<string>,
  selected: string | null,
  searchActive: boolean,
): FlatRow[] {
  const rows: FlatRow[] = [];
  // While searching, prune to the match-path tree. A term with zero matches prunes
  // everything → empty list → the "no identities match" state renders (instead of
  // silently falling back to the full tree).
  const pruning = searchActive;
  function walk(nodes: TreeNodeType[], depth: number) {
    for (const node of nodes) {
      const isMatch = matches.has(node.url);
      const isAncestor = ancestors.has(node.url);
      // While searching, drop any node that is neither a match nor on a path to one.
      if (pruning && !isMatch && !isAncestor) continue;
      const hasChildren = !!(node.children && node.children.length > 0);
      // Ancestors are force-open so the match is revealed; a bare match keeps its
      // own subtree collapsed (its children aren't part of the result set).
      const isExpanded = hasChildren && (pruning ? isAncestor : expanded.has(node.url));
      rows.push({
        node,
        depth,
        isExpanded,
        hasChildren,
        isMatch,
        isSelected: selected === node.url,
      });
      if (isExpanded && node.children) walk(node.children, depth + 1);
    }
  }
  walk(tree, 0);
  return rows;
}

/* ─── Tree Row (Left Panel) ───────────────────── */

interface TreeRowProps {
  row: FlatRow;
  index: number;
  isFocused: boolean;
  onSelect: (url: string) => void;
  onToggle: (url: string) => void;
  onFocusRow: (index: number) => void;
  onRowKeyDown: (e: React.KeyboardEvent, index: number) => void;
  registerRowEl: (index: number, el: HTMLDivElement | null) => void;
}

function TreeRow({
  row, index, isFocused, onSelect, onToggle, onFocusRow, onRowKeyDown, registerRowEl,
}: TreeRowProps) {
  const { node, depth, isExpanded, hasChildren, isMatch, isSelected } = row;
  const [hovered, setHovered] = useState(false);
  const totalAccounts = node.token_count + node.data_count;
  const dotColor = nodeColor(node);
  const dotSize = Math.max(5, Math.min(10, 5 + Math.log2((totalAccounts || 1) + 1)));
  const typeMarker = nodeTypeMarker(node);

  return (
    <div className="tree-node">
      <motion.div
        ref={(el: HTMLDivElement | null) => registerRowEl(index, el)}
        className={`tree-node-row ${isSelected ? 'selected' : ''} ${isMatch ? 'tree-node-row--match' : ''}`}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isExpanded : undefined}
        tabIndex={isFocused ? 0 : -1}
        onClick={() => { onFocusRow(index); onSelect(node.url); }}
        onKeyDown={e => onRowKeyDown(e, index)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        initial={{ opacity: 0, y: -2 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.12 }}
      >
        {/* Indent guides */}
        {depth > 0 && (
          <div className="tree-indent-guides" style={{ width: depth * INDENT }}>
            {Array.from({ length: depth }).map((_, i) => (
              <div key={i} className="tree-indent-line" style={{ left: i * INDENT + 7 }} />
            ))}
          </div>
        )}

        {/* Toggle */}
        <button
          type="button"
          className="tree-toggle"
          aria-label={hasChildren ? (isExpanded ? 'Collapse' : 'Expand') : undefined}
          aria-hidden={!hasChildren}
          tabIndex={-1}
          onClick={e => { e.stopPropagation(); if (hasChildren) onToggle(node.url); }}
          style={{
            transform: isExpanded && hasChildren ? 'rotate(0deg)' : 'rotate(-90deg)',
            background: 'none', border: 'none', padding: 0,
          }}
        >
          {hasChildren ? '\u25BC' : ''}
        </button>

        {/* Node dot + redundant (color-blind safe) type marker */}
        <span className="tree-node-type" aria-hidden style={{ flexShrink: 0 }}>
          <span style={{
            width: dotSize, height: dotSize, borderRadius: '50%',
            background: dotColor,
            boxShadow: isSelected || hovered ? `0 0 8px ${dotColor}80` : 'none',
            transition: 'box-shadow 0.2s, width 0.2s, height 0.2s',
          }} />
          <span className="tree-node-type-letter" style={{ color: dotColor }}>{typeMarker}</span>
        </span>

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
      </motion.div>

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
    </div>
  );
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

function IdentityProfile({ url, tree, onSelect }: { url: string; tree: TreeNodeType[]; onSelect: (url: string) => void }) {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['adi-detail', url],
    queryFn: () => api.getAdi(url),
    // A missing ADI now returns HTTP 404 (ApiError) — that is a terminal,
    // non-retryable result, not a transient failure to retry.
    retry: (failureCount, err) =>
      !(err instanceof ApiError && err.status === 404) && failureCount < 2,
  });
  const [tab, setTab] = useState('report');
  const [copied, setCopied] = useState(false);

  // Reset tab when selection changes — default to the security Report so the
  // graded verdict is the first thing shown for each newly opened ADI.
  useEffect(() => { setTab('report'); }, [url]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 20 }}>
        {[80, 60, 200].map((h, i) => (
          <div key={i} className="shimmer" style={{ height: h, borderRadius: 12 }} />
        ))}
      </div>
    );
  }
  // The query now throws (ApiError 404) for a missing ADI rather than resolving
  // to a `{ error }` body — handle the error state gracefully instead of a
  // stuck loader / dead `'error' in data` check.
  if (isError || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div style={{ padding: 20 }}>
        <EmptyState
          icon={notFound ? '⚲' : '⚠'}
          message={notFound ? `ADI not found: ${shortUrl(url)}` : 'Could not load this identity'}
        />
      </div>
    );
  }
  const d = data as ADIDetail;

  const path = hierarchyPath(tree, url);
  const totalAccounts = d.token_accounts.length + d.data_accounts.length;

  const tabs: { id: string; label: string; count: number; icon: string; term?: string }[] = [
    { id: 'report', label: 'Report', count: 0, icon: '\u25A3' },
    { id: 'accounts', label: 'Accounts', count: totalAccounts, icon: '\u25CF', term: 'token-account' },
    { id: 'security', label: 'Security', count: d.key_books.length, icon: '\u26BF', term: 'key-book' },
    { id: 'authority', label: 'Authority', count: d.authorities.length, icon: '\u2B2A', term: 'authority' },
    { id: 'children', label: 'Sub-ADIs', count: d.children.length, icon: '\u25C8', term: 'sub-adi' },
    ...(d.token_issuers.length > 0 ? [{ id: 'issuers', label: 'Issuers', count: d.token_issuers.length, icon: '\u25C6', term: 'token-issuer' }] : []),
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
          <nav className="identity-breadcrumb" aria-label="Identity hierarchy">
            {path.map((p, i) => {
              const isCurrent = i === path.length - 1;
              const label = shortUrl(p.url).split('/').pop() || shortUrl(p.url);
              return (
                <span key={p.url}>
                  {i > 0 && <span className="identity-breadcrumb-sep">/</span>}
                  {isCurrent ? (
                    <span className="identity-breadcrumb-current" aria-current="page">{label}</span>
                  ) : (
                    <button
                      type="button"
                      className="identity-breadcrumb-parent"
                      aria-label={`Go to ${shortUrl(p.url)}`}
                      onClick={() => onSelect(p.url)}
                      style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' }}
                    >
                      {label}
                    </button>
                  )}
                </span>
              );
            })}
          </nav>
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
            <button className="identity-action-btn" onClick={handleCopy} title="Copy URL" aria-label="Copy identity URL">
              {copied ? '\u2713' : '\u2398'}
            </button>
            <button className="identity-action-btn" onClick={() => navigate(`/network?select=${encodeURIComponent(d.url)}`)} aria-label="View in network graph">
              Graph
            </button>
          </div>
        </div>

        <h2 className="identity-url">{shortUrl(d.url)}</h2>

        {d.parent_url && (
          <div className="identity-parent">
            Child of <span className="identity-parent-link">{shortUrl(d.parent_url)}</span>
            &nbsp;&middot;&nbsp;{d.entry_count} directory entries
            <InfoTip term="directory-entries" />
          </div>
        )}
        {!d.parent_url && (
          <div className="identity-parent">
            Root Identity &middot; {d.entry_count} directory entries
            <InfoTip term="directory-entries" />
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
          <span key={t.id} className="identity-tab-wrap" style={{ display: 'inline-flex', alignItems: 'center' }}>
            <button
              className={`identity-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="identity-tab-icon">{t.icon}</span>
              {t.label}
              {t.count > 0 && <span className="identity-tab-count">{t.count}</span>}
            </button>
            {t.term && <InfoTip term={t.term} />}
          </span>
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
          {tab === 'report' && <SecurityReportCard url={d.url} />}
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
              {([
                { col: 'url' as const, label: 'Account URL' },
                { col: 'type' as const, label: 'Type' },
                { col: 'token' as const, label: 'Token' },
              ]).map(({ col, label }) => {
                const active = sortCol === col;
                const ariaSort: 'ascending' | 'descending' | 'none' =
                  active ? (sortDir === 1 ? 'ascending' : 'descending') : 'none';
                return (
                  <th key={col} className="sortable-th" aria-sort={ariaSort}>
                    <button
                      type="button"
                      onClick={() => handleSort(col)}
                      aria-label={`Sort by ${label}`}
                      style={{
                        background: 'none', border: 'none', padding: 0, font: 'inherit',
                        color: 'inherit', cursor: 'pointer', display: 'inline-flex',
                        alignItems: 'center', gap: 4,
                      }}
                    >
                      {label} {active && (sortDir === 1 ? '\u25B2' : '\u25BC')}
                    </button>
                  </th>
                );
              })}
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
    <div>
      {/* Concept key for the terms used on the key page cards below (definitions only). */}
      <div
        className="security-term-key"
        style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 14px',
          fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12,
        }}
      >
        <TermLabel term="threshold">Threshold</TermLabel>
        <TermLabel term="multi-sig">Multi-sig</TermLabel>
        <TermLabel term="key-page-version">Version</TermLabel>
        <TermLabel term="credits">Credits</TermLabel>
        <TermLabel term="public-key-hash">Key hash</TermLabel>
        <TermLabel term="delegation">Delegation</TermLabel>
      </div>

      <div className="security-grid">
        {data.key_books.map(book => (
          <KeyBookCard key={book.url} book={book} />
        ))}
      </div>
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
              <>
                {/* Per-book security risk callouts (B2) — guarded on the loaded
                    page data actually rendered below. Shown at most once each. */}
                {(() => {
                  const hasZeroCredit = data.pages.some(p => p.credit_balance <= 0);
                  const hasSingleSig = data.pages.some(p => p.threshold <= 1);
                  if (!hasZeroCredit && !hasSingleSig) return null;
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 8px 0' }}>
                      {hasZeroCredit && <RiskNote risk="zero-credit" compact />}
                      {hasSingleSig && <RiskNote risk="single-sig" compact />}
                    </div>
                  );
                })()}
                <div className="key-book-pages">
                  {data.pages.map(page => (
                    <KeyPageCard key={page.url} page={page} />
                  ))}
                </div>
              </>
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

  // Per-ADI authority risk signals (B2) — guarded so a clean ADI shows none.
  // Each callout appears at most once for the tab, keyed off the actual rows below.
  const hasCrossAdi = data.authorities.some(
    a => a.authority_url.split('/')[0] !== a.account_url.split('/')[0],
  );
  const hasDisabled = data.authorities.some(a => !!a.disabled);
  // "Implied-only" = an account governed solely by implied authorities (no
  // explicit grant). Compare per account_url so a mixed ADI doesn't false-trigger.
  const accountsWithExplicit = new Set(
    explicit.map(a => a.account_url),
  );
  const hasImpliedOnly = implied.some(a => !accountsWithExplicit.has(a.account_url));

  return (
    <div>
      {/* Authority Flow Diagram */}
      <AuthorityFlowDiagram adi={data} />

      {/* Per-ADI authority risk callouts (B2) — only when actually present */}
      {(hasCrossAdi || hasDisabled || hasImpliedOnly) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {hasCrossAdi && <RiskNote risk="cross-adi" compact />}
          {hasDisabled && <RiskNote risk="disabled-authority" compact />}
          {hasImpliedOnly && <RiskNote risk="implied-only" compact />}
        </div>
      )}

      {/* Authority List */}
      <div style={{ marginTop: 16 }}>
        {explicit.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div className="identity-section-label">
              <TermLabel term="implied-explicit">Explicit ({explicit.length})</TermLabel>
            </div>
            {explicit.map((a, i) => (
              <AuthorityRow key={i} authority={a} />
            ))}
          </div>
        )}
        {implied.length > 0 && (
          <div>
            <div className="identity-section-label">
              <TermLabel term="implied-explicit">Implied ({implied.length})</TermLabel>
            </div>
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
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <GlowBadge variant="issuer">external</GlowBadge>
            <InfoTip term="cross-adi" />
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <GlowBadge variant={authority.is_implied ? 'authority' : 'adi'}>
          {authority.is_implied ? 'implied' : 'explicit'}
        </GlowBadge>
        {authority.disabled ? (
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <GlowBadge variant="danger">disabled</GlowBadge>
            <InfoTip term="authority" />
          </span>
        ) : null}
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
      <div
        className="authority-flow-caption"
        style={{ fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 4 }}
      >
        Arrows point to the key books that can authorize this identity.
      </div>
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
          <div className="context-section-title" style={{ color: '#ef4444' }}>
            <TermLabel term="key-reuse">Key Overlap</TermLabel>
          </div>
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
          {/* B1: why this matters + fix — only shown when this ADI shares keys. */}
          <RiskNote risk="key-reuse" compact />
        </div>
      )}

      {/* Authority Reach */}
      {authorityReach.length > 0 && (
        <div className="context-section">
          <div className="context-section-title">
            <TermLabel term="authority">Authority Reach</TermLabel>
          </div>
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
          <div className="context-section-title">
            <TermLabel term="delegation">Delegations</TermLabel>
          </div>
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

      {/* Mini ego-graph: network position of the selected ADI */}
      <div className="context-section">
        <div className="context-section-title">Network Position</div>
        <NetworkPositionGraph url={url} data={data} />
      </div>
    </div>
  );
}

/* ─── Network Position Mini-Graph (ego SVG) ──── */

function NetworkPositionGraph({ url, data }: { url: string; data: ADIDetail }) {
  const W = 260;
  const H = 150;
  const cx = W / 2;
  const cy = H / 2 + 8;

  const adiColor = getEntityColor('adi').color;
  const childColor = getEntityColor('adi').color;
  const authColor = getEntityColor('authority').color;
  const parentColor = getEntityColor('data').color;

  // Build the satellite ring: children + unique authorities around the ego node.
  const uniqueAuthorities = [...new Set(data.authorities.map(a => a.authority_url))];
  const satellites: { id: string; label: string; full: string; color: string; kind: string }[] = [
    ...data.children.map(c => ({
      id: c.url, full: c.url, label: shortUrl(c.url).split('/').pop() || shortUrl(c.url),
      color: childColor, kind: 'Sub-ADI',
    })),
    ...uniqueAuthorities.map(a => ({
      id: `auth:${a}`, full: a, label: shortUrl(a).split('/').pop() || shortUrl(a),
      color: authColor, kind: 'Authority',
    })),
  ];

  // Distribute satellites on a semicircle below the ego node so the parent sits above.
  const maxSat = 8;
  const shown = satellites.slice(0, maxSat);
  const extra = satellites.length - shown.length;
  const ringR = 52;
  const placed = shown.map((s, i) => {
    // Spread across the lower 200° arc (from ~ -10° to ~190°), avoiding straight up.
    const t = shown.length === 1 ? 0.5 : i / (shown.length - 1);
    const angle = Math.PI * (0.08 + t * 0.84); // 0..PI sweep across the bottom
    const x = cx + Math.cos(angle) * ringR * 1.5;
    const y = cy + Math.sin(angle) * ringR;
    return { ...s, x, y };
  });

  const parentLabel = data.parent_url
    ? (shortUrl(data.parent_url).split('/').pop() || shortUrl(data.parent_url))
    : null;
  const parentY = 18;

  return (
    <div style={{
      borderRadius: 8, background: 'var(--bg-elevated)',
      border: '1px solid var(--border-subtle)', overflow: 'hidden',
    }}>
      <svg
        width="100%" viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Network position of ${shortUrl(url)}: ${data.parent_url ? 'one parent, ' : ''}${data.children.length} sub-ADIs and ${uniqueAuthorities.length} authorities`}
        style={{ display: 'block' }}
      >
        {/* Parent link (above) */}
        {data.parent_url && (
          <g>
            <line x1={cx} y1={cy} x2={cx} y2={parentY + 8}
              stroke={parentColor} strokeWidth={1} opacity={0.45} />
            <circle cx={cx} cy={parentY} r={6} fill={`${parentColor}22`} stroke={parentColor} strokeWidth={1}>
              <title>Parent: {shortUrl(data.parent_url)}</title>
            </circle>
            <text x={cx + 10} y={parentY + 3} fontSize={8} fill="var(--text-tertiary)"
              fontFamily="var(--font-mono)">{(parentLabel || '').slice(0, 16)}</text>
          </g>
        )}

        {/* Satellite links + nodes */}
        {placed.map(s => (
          <g key={s.id}>
            <line x1={cx} y1={cy} x2={s.x} y2={s.y}
              stroke={s.color} strokeWidth={0.8} opacity={0.35} />
            <circle cx={s.x} cy={s.y} r={5} fill={`${s.color}22`} stroke={s.color} strokeWidth={0.9}>
              <title>{s.kind}: {shortUrl(s.full)}</title>
            </circle>
          </g>
        ))}

        {/* Ego (center) node */}
        <circle cx={cx} cy={cy} r={9} fill={`${adiColor}28`} stroke={adiColor} strokeWidth={1.5}>
          <title>{shortUrl(url)}</title>
        </circle>
        <text x={cx} y={cy + 3} textAnchor="middle" fontSize={8} fontWeight={700}
          fill={adiColor} fontFamily="var(--font-mono)">ADI</text>

        {/* Overflow indicator */}
        {extra > 0 && (
          <text x={W - 6} y={H - 6} textAnchor="end" fontSize={8} fill="var(--text-tertiary)">
            +{extra} more
          </text>
        )}
      </svg>
      <div style={{
        display: 'flex', justifyContent: 'space-around', padding: '4px 8px',
        fontSize: 9, color: 'var(--text-tertiary)', borderTop: '1px solid var(--border-subtle)',
      }}>
        <span style={{ color: parentColor }}>{data.parent_url ? '1 parent' : 'root'}</span>
        <span style={{ color: childColor }}>{data.children.length} children</span>
        <span style={{ color: authColor }}>{uniqueAuthorities.length} authorities</span>
      </div>
    </div>
  );
}

/* ─── Virtuoso List wrapper — carries the ARIA tree role ──── */

// Virtuoso renders its item container via components.List; we tag it as the
// ARIA `tree` scroll region. Virtuoso passes the list ref + layout props here.
const TreeList = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function TreeList(props, ref) {
    return <div {...props} ref={ref} role="tree" aria-label="Identity tree" />;
  },
);

/* ─── Main Export ─────────────────────────────── */

export function TreeExplorer() {
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(params.get('select'));
  const [searchTerm, setSearchTerm] = useState('');
  const [contextOpen, setContextOpen] = useState(true);
  const treeRef = useRef<HTMLDivElement>(null);

  // ── Responsive: single-column mobile layout (P3.7) ──
  // Under 768px the tree-list panel becomes a toggleable drawer over the
  // (full-width) detail panel. The flag is matchMedia-driven so behavior —
  // not just CSS — adapts (default drawer hidden on mobile, open on desktop).
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(max-width: 768px)').matches,
  );
  const [treeOpen, setTreeOpen] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 768px)');
    const apply = (matches: boolean) => {
      setIsMobile(matches);
      // On mobile the drawer starts closed (detail is primary); on desktop it's
      // always shown as a fixed column.
      setTreeOpen(!matches);
    };
    apply(mq.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // ── ARIA tree / keyboard navigation state ──
  // Roving tabindex: exactly one row (focusedIndex into flatRows) is tabbable.
  const [focusedIndex, setFocusedIndex] = useState(0);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  // Live map of rendered row DOM elements (only mounted/virtualized rows are present).
  const rowEls = useRef<Map<number, HTMLDivElement>>(new Map());
  // When set, focus this row's DOM node once it (re)mounts after a scroll.
  const pendingFocus = useRef<number | null>(null);

  const registerRowEl = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) {
      rowEls.current.set(index, el);
      if (pendingFocus.current === index) {
        el.focus();
        pendingFocus.current = null;
      }
    } else {
      rowEls.current.delete(index);
    }
  }, []);

  // SINGLE source of truth for expansion: the set of expanded node urls (manual state).
  const [manualExpanded, setManualExpanded] = useState<Set<string>>(() => new Set());
  // Tracks whether the initial root-expansion default has been seeded for this tree.
  const seededRef = useRef(false);

  const { data: tree, isLoading } = useQuery({
    queryKey: ['tree'],
    queryFn: () => api.getTree(),
  });

  // Seed the default first-load expansion (roots expanded) once the tree arrives.
  useEffect(() => {
    if (tree && !seededRef.current) {
      seededRef.current = true;
      setManualExpanded(defaultExpandedUrls(tree));
    }
  }, [tree]);

  // Detail data for context sidebar
  const { data: selectedDetail } = useQuery({
    queryKey: ['adi-detail', selected],
    queryFn: () => api.getAdi(selected!),
    enabled: !!selected,
    // Don't retry a 404 (missing ADI) — it is terminal. ContextSidebar already
    // renders nothing when detail is undefined, so the panel stays graceful.
    retry: (failureCount, err) =>
      !(err instanceof ApiError && err.status === 404) && failureCount < 2,
  });

  const handleSelect = useCallback((url: string) => {
    setSelected(url);
    setParams({ select: url });
    // On mobile, picking an identity dismisses the tree drawer so the detail
    // panel (the primary surface) is shown full-width.
    if (isMobile) setTreeOpen(false);
  }, [setParams, isMobile]);

  // Toggle a single node's expansion in the manual set.
  const handleToggle = useCallback((url: string) => {
    setManualExpanded(prev => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);

  // ── Single search match set (replaces O(n²) per-render recursion) ──
  const { matches, ancestors } = useMemo(
    () => computeSearchSets(tree || [], searchTerm),
    [tree, searchTerm],
  );

  // Effective expanded set = manual set ∪ search-ancestor set.
  // When search clears, ancestors is empty so we revert to the manual set.
  const effectiveExpanded = useMemo(() => {
    if (ancestors.size === 0) return manualExpanded;
    const merged = new Set(manualExpanded);
    for (const url of ancestors) merged.add(url);
    return merged;
  }, [manualExpanded, ancestors]);

  // "Expand all" is reflected by every node being in the manual set.
  const allExpanded = useMemo(() => {
    if (!tree) return false;
    const all = collectAllUrls(tree);
    if (all.size === 0) return false;
    for (const url of all) {
      if (!manualExpanded.has(url)) return false;
    }
    return true;
  }, [tree, manualExpanded]);

  const handleExpandAll = useCallback(() => {
    if (!tree) return;
    if (allExpanded) setManualExpanded(new Set());        // Collapse all
    else setManualExpanded(collectAllUrls(tree));         // Expand all
  }, [tree, allExpanded]);

  // Flattened list of VISIBLE rows, respecting the effective expanded set.
  const searchActive = searchTerm.trim().length > 0;
  const flatRows = useMemo(
    () => flattenTree(tree || [], effectiveExpanded, matches, ancestors, selected, searchActive),
    [tree, effectiveExpanded, matches, ancestors, selected, searchActive],
  );

  // ── Keyboard navigation (ARIA tree pattern over flatRows) ──

  // Keep focusedIndex valid as the visible row list changes (expand/collapse/search).
  useEffect(() => {
    setFocusedIndex(prev => {
      if (flatRows.length === 0) return 0;
      // Prefer to follow the selected row if it is currently visible.
      const selIdx = selected ? flatRows.findIndex(r => r.node.url === selected) : -1;
      if (selIdx >= 0 && (prev < 0 || prev >= flatRows.length)) return selIdx;
      return Math.min(prev, flatRows.length - 1);
    });
  }, [flatRows, selected]);

  // Move roving focus to `index`, scroll it into view, and focus its DOM node
  // (deferring to remount if the row is currently virtualized out of the DOM).
  const focusRowAt = useCallback((index: number) => {
    if (index < 0 || index >= flatRows.length) return;
    setFocusedIndex(index);
    virtuosoRef.current?.scrollIntoView({ index, behavior: 'auto' });
    const el = rowEls.current.get(index);
    if (el) el.focus();
    else pendingFocus.current = index;
  }, [flatRows.length]);

  const onRowKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    const row = flatRows[index];
    if (!row) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusRowAt(Math.min(index + 1, flatRows.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusRowAt(Math.max(index - 1, 0));
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (row.hasChildren && !row.isExpanded) {
          handleToggle(row.node.url);             // expand collapsed node
        } else if (row.hasChildren && row.isExpanded) {
          focusRowAt(Math.min(index + 1, flatRows.length - 1)); // move to first child
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (row.hasChildren && row.isExpanded) {
          handleToggle(row.node.url);             // collapse expanded node
        } else {
          // Move to parent: nearest preceding row with a shallower depth.
          for (let i = index - 1; i >= 0; i--) {
            if (flatRows[i].depth < row.depth) { focusRowAt(i); break; }
          }
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        handleSelect(row.node.url);
        break;
      case 'Home':
        e.preventDefault();
        focusRowAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusRowAt(flatRows.length - 1);
        break;
      default:
        break;
    }
  }, [flatRows, focusRowAt, handleToggle, handleSelect]);

  // Count tree nodes
  const nodeCount = useMemo(() => {
    if (!tree) return 0;
    function count(nodes: TreeNodeType[]): number {
      return nodes.reduce((sum, n) => sum + 1 + count(n.children || []), 0);
    }
    return count(tree);
  }, [tree]);

  if (isLoading) {
    return <PageLoader message="Loading identity tree..." />;
  }
  if (!tree) return null;

  return (
    <div className={`tree-layout-3 ${!contextOpen ? 'context-closed' : ''} ${isMobile ? 'is-mobile' : ''} ${treeOpen ? 'tree-drawer-open' : 'tree-drawer-closed'}`}>
      {/* Mobile-only: toggle the tree drawer over the detail panel (P3.7). */}
      {isMobile && (
        <button
          type="button"
          className="tree-browse-toggle"
          onClick={() => setTreeOpen(o => !o)}
          aria-expanded={treeOpen}
          aria-controls="tree-list-panel"
        >
          {treeOpen ? '✕ Close tree' : '☰ Browse tree'}
        </button>
      )}

      {/* Mobile-only: tap-out backdrop to dismiss the drawer. */}
      {isMobile && treeOpen && (
        <div className="tree-drawer-backdrop" onClick={() => setTreeOpen(false)} aria-hidden />
      )}

      {/* ── Left Panel: Visual Tree ── */}
      <div className="tree-panel-3" id="tree-list-panel" ref={treeRef}>
        {/* View framing (Phase A meaning layer) */}
        <div className="view-intro" style={{ padding: '12px 12px 0', marginBottom: 0 }}>
          <div className="view-intro__title" style={{ fontSize: 'var(--text-lg)' }}>
            Identity Explorer
          </div>
          <div className="view-intro__lead" style={{ fontSize: 'var(--text-sm)' }}>
            Browse the Accumulate identity hierarchy &mdash; every ADI and sub-identity.
            Select one to inspect its accounts, signing keys, and who can authorize it.
          </div>
          <div className="view-intro__audience">Exploration &middot; for owners &amp; builders</div>
        </div>

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
              onClick={handleExpandAll}
              title={allExpanded ? 'Collapse all' : 'Expand all'}
            >
              {allExpanded ? '\u25BC' : '\u25B6'} All
            </button>
            <span className="tree-node-count">{nodeCount} ADIs</span>
          </div>
        </div>

        {/* Node-type marker legend (A6) — explains the single-letter row cues */}
        <NodeTypeLegend />

        {/* Tree content (virtualized) */}
        <div className="tree-scroll">
          {flatRows.length === 0 ? (
            /* Instructive empty state: distinguish "no search match" from an
               empty database so the message teaches rather than dead-ends. */
            <div
              className="identity-empty"
              style={{ flexDirection: 'column', gap: 6, padding: '32px 20px', textAlign: 'center' }}
            >
              {searchTerm.trim() ? (
                <>
                  <span className="identity-empty-icon">{'⚲'}</span>
                  <span>No identities match &ldquo;{searchTerm.trim()}&rdquo;</span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    Try a shorter prefix &mdash; names are matched on the full
                    URL, e.g. <code style={{ fontFamily: 'var(--font-mono)' }}>acme</code>.
                  </span>
                </>
              ) : (
                <>
                  <span className="identity-empty-icon">{'◈'}</span>
                  <span>No identities indexed yet</span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    The crawler hasn&rsquo;t recorded any ADIs &mdash; check back
                    once the network has been scanned.
                  </span>
                </>
              )}
            </div>
          ) : (
          <Virtuoso
            ref={virtuosoRef}
            style={{ height: '100%' }}
            data={flatRows}
            computeItemKey={(_, row) => row.node.url}
            increaseViewportBy={240}
            components={{ List: TreeList }}
            itemContent={(index, row) => (
              <TreeRow
                row={row}
                index={index}
                isFocused={index === focusedIndex}
                onSelect={handleSelect}
                onToggle={handleToggle}
                onFocusRow={setFocusedIndex}
                onRowKeyDown={onRowKeyDown}
                registerRowEl={registerRowEl}
              />
            )}
          />
          )}
        </div>
      </div>

      {/* ── Center Panel: Identity Profile ── */}
      <div className="detail-panel-3">
        {selected ? (
          <IdentityProfile url={selected} tree={tree} onSelect={handleSelect} />
        ) : (
          <div className="identity-empty-state">
            <div className="identity-empty-icon-large">{'\u25C8'}</div>
            <div className="identity-empty-title">Select an identity</div>
            <div className="identity-empty-desc">
              Each identity is an ADI &mdash; an on-chain account container
              addressed like <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>acc://name.acme</code>.
              Pick one from the tree to see its token &amp; data accounts, its
              signing keys (key books &amp; pages), and which authorities can sign for it.
            </div>
            {/* D1: tiny "what you'll find" hints \u2014 mirror the detail-panel tabs */}
            <div
              style={{
                display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
                gap: '6px 8px', maxWidth: 320,
              }}
              aria-hidden
            >
              {[
                { icon: '\u25CF', label: 'Accounts', color: '#22d3ee' },
                { icon: '\u26BF', label: 'Keys', color: '#34d399' },
                { icon: '\u2B2A', label: 'Authorities', color: '#f59e0b' },
              ].map(h => (
                <span
                  key={h.label}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '3px 9px', fontSize: 11, fontWeight: 600,
                    color: h.color, background: `${h.color}14`,
                    border: `1px solid ${h.color}25`, borderRadius: 999,
                  }}
                >
                  <span style={{ fontSize: 9 }}>{h.icon}</span>{h.label}
                </span>
              ))}
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
          aria-label={contextOpen ? 'Hide context panel' : 'Show context panel'}
          aria-expanded={contextOpen}
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
