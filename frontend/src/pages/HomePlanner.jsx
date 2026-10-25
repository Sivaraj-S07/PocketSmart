import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import PrivateNav from '../components/PrivateNav.jsx';
import ShopLinks from '../components/ShopLinks.jsx';
import { usePageStyle } from '../hooks/usePageStyle.js';
import homePlannerCss from '../styles/pages/homePlanner.css?inline';
import { copyText, errorText, extractJSON, fmt, mdToHtml, planText } from '../util.js';

const SHOP_CFG = {
  Amazon: { lbl: '🛍 Amazon', cls: 's-amazon', u: 'https://www.amazon.in/s?k=' },
  Flipkart: { lbl: '🛒 Flipkart', cls: 's-flipkart', u: 'https://www.flipkart.com/search?q=' },
  IKEA: { lbl: '🪑 IKEA', cls: 's-ikea', u: 'https://www.ikea.com/in/en/search/?q=' },
  Pepperfry: { lbl: '🏠 Pepperfry', cls: 's-pepperfry', u: 'https://www.pepperfry.com/catalogsearch/result/?q=' },
};

const ROOM_OPTIONS = [
  ['r_living', 'Living Room'],
  ['r_bedroom', 'Bedroom'],
  ['r_kitchen', 'Kitchen'],
  ['r_bathroom', 'Bathroom'],
  ['r_dining', 'Dining Room'],
  ['r_office', 'Home Office'],
];
const PLATFORM_OPTIONS = [
  ['p_amazon', 'Amazon'],
  ['p_flipkart', 'Flipkart'],
  ['p_ikea', 'IKEA'],
  ['p_pepperfry', 'Pepperfry'],
];
const STYLES = ['Modern / Contemporary', 'Minimalist', 'Traditional / Classic', 'Bohemian', 'Industrial', 'Scandinavian', 'Luxury'];
const QTY_FIELDS = [
  ['numLights', 'Lights', 500],
  ['numFans', 'Ceiling fans', 500],
  ['numFurniture', 'Furniture pieces', 500],
  ['numDining', 'Dining tables', 100],
];

const blankForm = () => ({
  budget: '',
  rooms: '',
  style: '',
  preferences: '',
  rooms_checked: {},
  platforms_checked: { Amazon: true, Flipkart: true, IKEA: true },
  qty: { numLights: '0', numFans: '0', numFurniture: '0', numDining: '0' },
});

export default function HomePlanner() {
  usePageStyle(homePlannerCss, 'Home Interior Planner – PocketSmart AI');
  const { expireSession } = useAuth();
  const [form, setForm] = useState(blankForm);
  const [view, setView] = useState('empty'); // empty | loading | result
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(null);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const toggle = (group, key) => (e) => setForm((f) => ({ ...f, [group]: { ...f[group], [key]: e.target.checked } }));
  const setQty = (key) => (e) => setForm((f) => ({ ...f, qty: { ...f.qty, [key]: e.target.value } }));

  async function generate() {
    const { budget, rooms, style } = form;
    const roomTypes = ROOM_OPTIONS.filter(([, v]) => form.rooms_checked[v]).map(([, v]) => v);
    const platforms = PLATFORM_OPTIONS.filter(([, v]) => form.platforms_checked[v]).map(([, v]) => v);

    if (!budget || !rooms || !style) {
      alert('Please fill in Budget, Rooms, and Style.');
      return;
    }

    setView('loading');
    setBusy(true);
    const n = (key) => parseInt(form.qty[key], 10) || 0;
    try {
      const res = await api.post('/api/generate-home', {
        budget: parseInt(budget, 10),
        rooms,
        style,
        room_types: roomTypes,
        platforms,
        preferences: form.preferences,
        num_lights: n('numLights'),
        num_fans: n('numFans'),
        num_furniture: n('numFurniture'),
        num_dining_tables: n('numDining'),
      });
      if (res.status === 401) return expireSession();
      const raw = res.data || {};
      const recText = planText(raw);
      const parsed = extractJSON(recText);
      const meta = `₹${parseInt(budget, 10).toLocaleString('en-IN')} · ${rooms} rooms · ${style}`;
      const source = raw.source === 'gemini' ? '✦ Gemini recommendation' : 'Offline recommendation';

      if (parsed && parsed.categories) {
        setResult({ kind: 'structured', source, meta, data: parsed, budget: parseInt(budget, 10), platforms });
      } else if (recText) {
        setResult({ kind: 'text', source, meta, text: recText });
      } else {
        alert('Error: ' + errorText(raw));
        setView('empty');
        setBusy(false);
        return;
      }
      setView('result');
    } catch (err) {
      setView('empty');
      alert('Connection error: ' + err.message);
    }
    setBusy(false);
  }

  function resetForm() {
    setView('empty');
    setResult(null);
    setForm((f) => ({ ...f, budget: '', rooms: '', style: '', preferences: '' }));
  }

  async function copyResult() {
    const lines = [];
    (structured ? result.data.categories || [] : []).forEach((c) => {
      lines.push(`${c.name ?? ''} — ${fmt(c.allocation)}`);
      (c.items || []).forEach((item) => lines.push(`  • ${item.name ?? ''} — ${fmt(item.price)}`));
    });
    (structured ? result.data.tips || [] : []).forEach((t) => lines.push('💡 ' + t));
    if (await copyText(lines.join('\n'))) {
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    }
  }

  const structured = result?.kind === 'structured';
  const cats = structured ? result.data.categories || [] : [];
  const totalAlloc = cats.reduce((s, c) => s + (Number(c.allocation) || 0), 0);
  const plat = structured && result.platforms.length ? result.platforms : ['Amazon', 'Flipkart', 'IKEA'];
  const tips = structured && Array.isArray(result.data.tips) ? result.data.tips : [];
  const dash = '—';

  return (
    <>
      <PrivateNav active="home" />

      <div className="page-header">
        <div className="ph-glow"></div>
        <div className="ph-inner">
          <div className="ph-icon">🏠</div>
          <div className="ph-text">
            <h1>Home Interior Budget Planner</h1>
            <p>Budget-aware furniture, lighting, and decor searches across popular platforms</p>
          </div>
        </div>
      </div>

      <main>
        <div className="layout">
          {/* FORM */}
          <div className="form-card">
            <div className="form-card-header"><span>📋</span><h2>Enter Your Requirements</h2></div>
            <div className="form-body">
              <div className="form-group">
                <label>Total Budget (₹)<span className="req">*</span></label>
                <input type="number" id="budget" placeholder="e.g. 50000" min="1000" required value={form.budget} onChange={setField('budget')} />
              </div>
              <div className="form-group">
                <label>Number of Rooms<span className="req">*</span></label>
                <select id="rooms" value={form.rooms} onChange={setField('rooms')}>
                  <option value="">Select rooms</option>
                  <option value="1">1 Room</option>
                  <option value="2">2 Rooms</option>
                  <option value="3">3 Rooms</option>
                  <option value="4">4 Rooms</option>
                  <option value="5+">5+ Rooms</option>
                </select>
              </div>
              <div className="form-group">
                <label>Interior Style<span className="req">*</span></label>
                <select id="style" value={form.style} onChange={setField('style')}>
                  <option value="">Select style</option>
                  {STYLES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Rooms to Furnish</label>
                <div className="cbgroup">
                  {ROOM_OPTIONS.map(([id, value]) => (
                    <div className="cbitem" key={id}>
                      <input type="checkbox" id={id} value={value} checked={!!form.rooms_checked[value]} onChange={toggle('rooms_checked', value)} />
                      <label htmlFor={id}>{value}</label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label>Fixtures &amp; Furniture (quantity)</label>
                <div className="cbgroup qty-grid">
                  {QTY_FIELDS.map(([id, label, max]) => (
                    <label className="qty" key={id}>
                      <span>{label}</span>
                      <input type="number" id={id} min="0" max={max} inputMode="numeric" value={form.qty[id]} onChange={setQty(id)} />
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label>Preferred Platforms</label>
                <div className="cbgroup">
                  {PLATFORM_OPTIONS.map(([id, value]) => (
                    <div className="cbitem" key={id}>
                      <input type="checkbox" id={id} value={value} checked={!!form.platforms_checked[value]} onChange={toggle('platforms_checked', value)} />
                      <label htmlFor={id}>{value}</label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label>Additional Preferences</label>
                <textarea id="preferences" placeholder="e.g. prefer light colors, need storage solutions..." value={form.preferences} onChange={setField('preferences')}></textarea>
              </div>
              <button className="btn-gen" id="genBtn" onClick={generate} disabled={busy}>✦ Generate recommendations</button>
            </div>
          </div>

          {/* RESULT PANEL */}
          <div id="resultPanel">
            <div className="res-empty" id="emptyState" style={{ display: view === 'empty' ? 'block' : 'none' }}>
              <div className="re-icon">🏠</div>
              <div className="re-title">Your Personalized Budget Plan Will Appear Here</div>
              <p className="re-sub">Fill in your budget, rooms and style on the left, then click Generate to get a structured plan with product tables and direct shopping links.</p>
            </div>
            <div className="loading" id="loadingState" style={{ display: view === 'loading' ? 'block' : 'none' }}>
              <div className="spinner"></div>
              <p>Generating your personalized home interior plan...</p>
            </div>
            <div className="result-wrap" id="resultWrap" style={{ display: view === 'result' ? 'block' : 'none' }}>
              <div className="res-topbar">
                <div><h2>🏠 Your Personalized Budget Plan</h2><p id="resMeta">{result?.meta ?? 'Home Interior'}</p></div>
                <div className="res-badge" id="resultSource">{result?.source ?? 'Budget recommendation'}</div>
              </div>
              <div className="bsum">
                <div className="bsum-head"><span>💰</span><h3>Budget Summary</h3></div>
                <div className="bsum-body">
                  <div className="bsum-item"><div className="bsum-lbl">Total Budget</div><div className="bsum-val" id="bsTotal">{structured ? fmt(result.budget) : dash}</div></div>
                  <div className="bsum-item"><div className="bsum-lbl">Allocated</div><div className="bsum-val gold" id="bsAllocated">{structured ? fmt(totalAlloc) : dash}</div></div>
                  <div className="bsum-item"><div className="bsum-lbl">Remaining</div><div className="bsum-val green" id="bsRemaining">{structured ? fmt(Math.max(0, result.budget - totalAlloc)) : dash}</div></div>
                  <div className="bsum-item"><div className="bsum-lbl">Categories</div><div className="bsum-val" id="bsCategories">{structured ? cats.length : dash}</div></div>
                </div>
              </div>
              <div id="catSections">
                {structured &&
                  cats.map((cat, ci) => (
                    <div className="cat-card" key={ci}>
                      <div className="cat-head">
                        <span className="cat-icon">{cat.icon || '📦'}</span>
                        <span className="cat-name">{cat.name}</span>
                        <span className="cat-alloc">{fmt(cat.allocation)}</span>
                      </div>
                      <table className="cat-table">
                        <thead><tr><th>Item</th><th>Description</th><th>Price</th><th>Qty</th><th>Shopping Links</th></tr></thead>
                        <tbody>
                          {(cat.items || []).map((item, ii) => (
                            <tr key={ii}>
                              <td><span className="td-name">{item.name}</span></td>
                              <td>{item.description}</td>
                              <td><span className="td-price">{fmt(item.price)}</span></td>
                              <td><span className="td-qty">x{item.quantity || 1}</span></td>
                              <td><div className="shop-links"><ShopLinks item={item} name={item.name} fallbackPlatforms={plat} cfg={SHOP_CFG} /></div></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                {result?.kind === 'text' && (
                  <div
                    style={{ background: 'var(--surface)', border: '2px solid var(--border)', borderRadius: '16px', padding: '24px', boxShadow: 'var(--shadow)', lineHeight: 1.8, fontSize: '0.91rem', color: 'var(--text2)' }}
                    dangerouslySetInnerHTML={{ __html: mdToHtml(result.text, { h3: '14px 0 6px', h2: '16px 0 8px', h1: true }) }}
                  />
                )}
              </div>
              <div className="tips-card" id="tipsCard" style={{ display: tips.length ? 'block' : 'none' }}>
                <div className="tips-head"><span>💡</span><h3>Additional Suggestions</h3></div>
                <div className="tips-body" id="tipsBody">
                  {tips.map((t, i) => (
                    <div className="tip-row" key={i}><div className="tip-dot">✓</div><div className="tip-txt">{t}</div></div>
                  ))}
                </div>
              </div>
              <div className="res-actions">
                <button className="btn-new" onClick={resetForm}>+ New Plan</button>
                <button className="btn-copy" id="copyBtn" onClick={copyResult}>{copied ? '✅ Copied!' : '📋 Copy All'}</button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
