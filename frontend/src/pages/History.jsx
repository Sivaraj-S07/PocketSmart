import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiUrl } from '../api.js';
import { useAuth } from '../auth.jsx';
import PrivateNav from '../components/PrivateNav.jsx';
import { usePageStyle } from '../hooks/usePageStyle.js';
import historyCss from '../styles/pages/history.css?inline';
import { escapeHTML, extractJSON, fmt } from '../util.js';

const EMOJI = { home: '🏠', party: '🎉', jewelry: '💍' };
const BADGE = { jewelry: 'badge-jewelry', home: 'badge-home', party: 'badge-party' };
const FILTERS = [
  ['all', 'All'],
  ['jewelry', '💍 Jewelry'],
  ['home', '🏠 Home'],
  ['party', '🎉 Party'],
];

/** Inner HTML of the plain-text view. escapeHTML runs first, so the markup below can only be our own tags. */
function formatFallback(text) {
  return escapeHTML(text)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (s) => `<ul>${s}</ul>`)
    .replace(/\n\n/g, '<br/><br/>');
}

function HistoryItem({ item, fallbackName = 'Item' }) {
  return (
    <div className="hi-item">
      <div className="hi-dot"></div>
      <div className="hi-info">
        <div className="hi-name">{item.name || item.type || fallbackName}</div>
        {item.description ? <div className="hi-desc">{item.description}</div> : null}
      </div>
      {item.price ? <div className="hi-price">{fmt(item.price)}</div> : null}
    </div>
  );
}

/** Structured view of a stored plan; returns null (so the caller can show raw text) when there is nothing to show. */
function renderParsedResult(parsed) {
  const sections = [];
  const oa = parsed.outfit_analysis;
  if (oa && (oa.colors || oa.style || oa.formality)) {
    sections.push(
      <div className="result-section" key="oa">
        <div className="rs-title"><span>👗</span> Outfit Analysis</div>
        <div className="oa-tags">
          {oa.colors ? <div className="oa-tag">🎨 {oa.colors}</div> : null}
          {oa.style ? <div className="oa-tag">👗 {oa.style}</div> : null}
          {oa.formality ? <div className="oa-tag">✨ {oa.formality}</div> : null}
        </div>
      </div>,
    );
  }
  if (Array.isArray(parsed.categories) && parsed.categories.length) {
    parsed.categories.forEach((cat, i) => {
      sections.push(
        <div className="result-section" key={`cat-${i}`}>
          <div className="rs-title">
            <span>{cat.icon || '📦'}</span> {cat.name} — <span style={{ color: 'var(--blue)', fontWeight: 900, textTransform: 'none' }}>{fmt(cat.allocation)}</span>
          </div>
          {(cat.items || []).map((item, j) => <HistoryItem item={{ ...item, type: undefined }} key={j} />)}
        </div>,
      );
    });
  }
  const flat = parsed.jewelry || parsed.recommendations || parsed.items || [];
  if (Array.isArray(flat) && flat.length) {
    sections.push(
      <div className="result-section" key="flat">
        <div className="rs-title"><span>💎</span> Recommendations</div>
        {flat.map((item, i) => <HistoryItem item={item} key={i} />)}
      </div>,
    );
  }
  if (Array.isArray(parsed.tips) && parsed.tips.length) {
    sections.push(
      <div className="result-section" key="tips">
        <div className="rs-title"><span>💡</span> Tips &amp; Suggestions</div>
        {parsed.tips.map((t, i) => (
          <div className="hi-tip" key={i}>
            <div className="hi-tip-dot">✓</div>
            <div className="hi-tip-txt">{t}</div>
          </div>
        ))}
      </div>,
    );
  }
  return sections.length ? <>{sections}</> : null;
}

function totalSpentOf(parsed) {
  if (!parsed) return 0;
  if (Array.isArray(parsed.categories) && parsed.categories.length)
    return parsed.categories.reduce((s, c) => s + (Number(c.allocation) || 0), 0);
  return (parsed.jewelry || parsed.recommendations || []).reduce((s, i) => s + (Number(i.price) || 0), 0);
}

function HistoryCard({ item }) {
  const parsed = extractJSON(item.result);
  const body = parsed ? renderParsedResult(parsed) : null;
  const totalSpent = totalSpentOf(parsed);
  return (
    <div className="history-card" data-category={item.category || 'other'}>
      <div className="hc-header">
        <div className="hc-left">
          <span className={`hc-badge ${BADGE[item.category] || 'badge-default'}`}>{EMOJI[item.category] || '📋'} {item.category || 'General'}</span>
          {item.budget ? <span className="hc-budget">Budget: {fmt(item.budget)}</span> : null}
          {totalSpent ? <span className="hc-budget" style={{ background: 'rgba(34,197,94,0.2)', color: '#86EFAC' }}>Spent: {fmt(totalSpent)}</span> : null}
        </div>
        <span className="hc-date">
          {new Date(item.timestamp).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <div className="hc-body">
        {body || <div className="raw-result" dangerouslySetInnerHTML={{ __html: formatFallback(item.result || '') }} />}
      </div>
      <div style={{ padding: '8px 16px 14px' }}>
        <a
          href={apiUrl(`/api/recommendation-details/${encodeURIComponent(item.id)}`)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: '.8rem', fontWeight: 800, color: 'var(--blue)' }}
        >
          View full details (JSON) →
        </a>
      </div>
    </div>
  );
}

export default function History() {
  usePageStyle(historyCss, 'History – PocketSmart AI');
  const { expireSession } = useAuth();
  const [state, setState] = useState({ status: 'loading', total: 0, items: [] });
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/history');
      if (res.status === 401) return expireSession();
      const data = res.data || {};
      // The API already returns newest first; show it in that order.
      setState({ status: 'ready', total: data.total ?? 0, items: data.history || [] });
    } catch {
      setState({ status: 'error', total: 0, items: [] });
    }
  }, [expireSession]);

  useEffect(() => {
    load();
  }, [load]);

  async function clearHistory() {
    if (!window.confirm('Clear all recommendation history? This cannot be undone.')) return;
    await api.del('/api/history');
    load();
  }

  const visible = state.items.filter((i) => filter === 'all' || (i.category || 'other') === filter);
  const countText = state.status === 'loading' ? 'Loading...' : `${state.total} recommendation${state.total !== 1 ? 's' : ''}`;

  let list;
  if (state.status === 'loading') {
    list = (
      <div className="loading-state">
        <div className="spinner"></div>
        <p>Loading your history...</p>
      </div>
    );
  } else if (state.status === 'error') {
    list = (
      <div className="empty-state">
        <div className="es-icon">⚠️</div>
        <div className="es-title">Failed to Load History</div>
        <p className="es-sub">Could not connect to the server. Please try again.</p>
      </div>
    );
  } else if (state.total === 0) {
    list = (
      <div className="empty-state">
        <div className="es-icon">📭</div>
        <div className="es-title">No History Yet</div>
        <p className="es-sub">Plans you create will appear here for later review.</p>
        <Link to="/dashboard" className="btn-primary">Go to Dashboard</Link>
      </div>
    );
  } else {
    list = visible.map((item) => <HistoryCard item={item} key={item.id} />);
  }

  return (
    <>
      <PrivateNav active="history" />

      <div className="page-header">
        <div className="ph-glow"></div>
        <div className="ph-inner">
          <div className="ph-icon">📜</div>
          <div className="ph-text">
            <h1>Recommendation History</h1>
            <p>Review your saved planning recommendations</p>
          </div>
        </div>
      </div>

      <main>
        <div className="controls-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span className="history-count" id="historyCount">{countText}</span>
            <div className="filter-row">
              {FILTERS.map(([key, label]) => (
                <button key={key} className={key === filter ? 'filter-btn active' : 'filter-btn'} onClick={() => setFilter(key)}>{label}</button>
              ))}
            </div>
          </div>
          <button className="btn-danger" onClick={clearHistory}>🗑️ Clear History</button>
        </div>

        <div id="historyList" className="history-list">{list}</div>
      </main>
    </>
  );
}
