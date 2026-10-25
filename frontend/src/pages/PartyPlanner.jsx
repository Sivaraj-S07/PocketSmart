import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import PrivateNav from '../components/PrivateNav.jsx';
import ShopLinks from '../components/ShopLinks.jsx';
import { usePageStyle } from '../hooks/usePageStyle.js';
import partyPlannerCss from '../styles/pages/partyPlanner.css?inline';
import { copyText, errorText, extractJSON, fmt, mdToHtml, planText } from '../util.js';

const SHOP = {
  Swiggy: { lbl: '🛍 Swiggy', cls: 's-swiggy', u: 'https://www.swiggy.com/search?query=' },
  Zomato: { lbl: '🍽 Zomato', cls: 's-zomato', u: 'https://www.zomato.com/search?q=' },
  Amazon: { lbl: '🛍 Amazon', cls: 's-amazon', u: 'https://www.amazon.in/s?k=' },
  Flipkart: { lbl: '🛒 Flipkart', cls: 's-flipkart', u: 'https://www.flipkart.com/search?q=' },
  OYO: { lbl: '🏨 OYO', cls: 's-oyo', u: 'https://www.oyorooms.com/search?location=' },
  Booking: { lbl: '🏨 Booking', cls: 's-booking', u: 'https://www.booking.com/searchresults.html?ss=' },
};

const EVENT_TYPES = ['Birthday Party', 'Wedding Reception', 'Engagement Ceremony', 'Anniversary Celebration', 'Baby Shower', 'House Warming', 'Corporate Event', 'Festival Celebration', 'Graduation Party'];
const VENUES = ['Home', 'Banquet Hall', 'Hotel', 'Outdoor / Garden', 'Restaurant', 'OYO / Resort'];
const FOOD_PREFS = ['Vegetarian Only', 'Non-Vegetarian', 'Both Veg & Non-Veg'];
const NEEDS = [
  ['n_food', '🍽️', 'Catering', 'Catering'],
  ['n_decor', '🎀', 'Decoration', 'Decoration'],
  ['n_ent', '🎵', 'Entertainment', 'Entertainment'],
  ['n_cake', '🎂', 'Cake & Sweets', 'Cake'],
  ['n_photo', '📸', 'Photography', 'Photography'],
  ['n_gifts', '🎁', 'Return Gifts', 'Gifts'],
];

const blankForm = () => ({
  budget: '',
  guests: '',
  eventType: '',
  location: '',
  foodPref: '',
  notes: '',
  needs: { Catering: true, Decoration: true },
});

export default function PartyPlanner() {
  usePageStyle(partyPlannerCss, 'Party Planner – PocketSmart AI');
  const { expireSession } = useAuth();
  const [form, setForm] = useState(blankForm);
  const [view, setView] = useState('empty'); // empty | loading | result
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(null);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const toggleNeed = (value) => (e) => setForm((f) => ({ ...f, needs: { ...f.needs, [value]: e.target.checked } }));

  async function generate() {
    const { budget, guests, eventType, location, foodPref, notes } = form;
    const needs = NEEDS.filter(([, , value]) => form.needs[value]).map(([, , value]) => value);

    if (!budget || !guests || !eventType) {
      alert('Please fill in Budget, Guests, and Party Type.');
      return;
    }

    setView('loading');
    setBusy(true);
    try {
      const res = await api.post('/api/generate-party', {
        budget: parseInt(budget, 10),
        event_type: eventType,
        guests: parseInt(guests, 10),
        location,
        food_preference: foodPref,
        includes: needs,
        notes,
      });
      if (res.status === 401) return expireSession();
      const raw = res.data || {};
      const recText = planText(raw);
      const parsed = extractJSON(recText);
      const b = parseInt(budget, 10);
      const meta = `₹${b.toLocaleString('en-IN')} · ${eventType} · ${guests} guests`;
      const source = raw.source === 'gemini' ? '✦ Gemini recommendation' : 'Offline recommendation';

      if (parsed && parsed.categories) {
        const platforms = needs.includes('Catering') ? ['Swiggy', 'Zomato', 'Amazon', 'Flipkart'] : ['Amazon', 'Flipkart'];
        setResult({ kind: 'structured', source, meta, data: parsed, budget: b, platforms });
      } else if (recText) {
        setResult({ kind: 'text', source, meta, text: recText, budget: b });
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
    setForm((f) => ({ ...f, budget: '', guests: '', eventType: '', location: '', foodPref: '', notes: '' }));
  }

  async function copyResult() {
    const lines = [];
    (structured ? result.data.categories || [] : []).forEach((c) => {
      lines.push(`${c.name ?? ''} — ${fmt(c.allocation)}`);
      (c.items || []).forEach((i) => lines.push(`  • ${i.name ?? ''} — ${fmt(i.price)}`));
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
  const plat = structured && result.platforms.length ? result.platforms : ['Swiggy', 'Zomato', 'Amazon', 'Flipkart'];
  const venues = structured && Array.isArray(result.data.venues) ? result.data.venues : [];
  const tips = structured && Array.isArray(result.data.tips) ? result.data.tips : [];
  const dash = '—';

  return (
    <>
      <PrivateNav active="party" />

      <div className="page-header">
        <div className="ph-glow"></div>
        <div className="ph-inner">
          <div className="ph-icon">🎉</div>
          <div className="ph-text">
            <h1>Party Budget Planner</h1>
            <p>Build an event plan around your budget, guest count, and priorities</p>
          </div>
        </div>
      </div>

      <main>
        <div className="layout">
          {/* FORM */}
          <div className="form-card">
            <div className="fch"><span className="sec-icon">📋</span><h2>Event Details</h2></div>
            <div className="form-body">
              <div className="fsec">
                <div className="fsec-title"><span>🔵</span> Basic Information</div>
                <div className="frow">
                  <div className="fgroup"><label>Total Budget (₹) *</label><input type="number" id="budget" placeholder="e.g. 30000" min="500" value={form.budget} onChange={setField('budget')} /></div>
                  <div className="fgroup"><label>Number of Guests *</label><input type="number" id="guests" placeholder="e.g. 50" min="1" value={form.guests} onChange={setField('guests')} /></div>
                </div>
              </div>

              <div className="fsec">
                <div className="fsec-title"><span>🎈</span> Event Details</div>
                <div className="frow">
                  <div className="fgroup">
                    <label>Party Type *</label>
                    <select id="eventType" value={form.eventType} onChange={setField('eventType')}>
                      <option value="">Select type</option>
                      {EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="fgroup">
                    <label>Venue Type</label>
                    <select id="location" value={form.location} onChange={setField('location')}>
                      <option value="">Select venue</option>
                      {VENUES.map((v) => <option key={v}>{v}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="fsec">
                <div className="fsec-title"><span>🟡</span> Party Needs</div>
                <div className="needs-grid">
                  {NEEDS.map(([id, icon, value, label]) => (
                    <div className="need-item" key={id}>
                      <span className="ni">{icon}</span>
                      <input type="checkbox" id={id} value={value} checked={!!form.needs[value]} onChange={toggleNeed(value)} />
                      <label htmlFor={id}>{label}</label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="fsec">
                <div className="fsec-title"><span>🔷</span> Additional Requirements</div>
                <div className="frow">
                  <div className="fgroup full">
                    <label>Food Preference</label>
                    <select id="foodPref" value={form.foodPref} onChange={setField('foodPref')}>
                      <option value="">Select preference</option>
                      {FOOD_PREFS.map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                </div>
                <div className="frow">
                  <div className="fgroup full">
                    <label>Special Requests</label>
                    <textarea id="notes" placeholder="Special requests, themes, dietary restrictions, etc." value={form.notes} onChange={setField('notes')}></textarea>
                  </div>
                </div>
              </div>

              <button className="btn-gen" id="genBtn" onClick={generate} disabled={busy}>🎉 Generate Budget Plan</button>
            </div>
          </div>

          {/* RESULT PANEL */}
          <div id="resultPanel">
            <div className="res-empty" id="emptyState" style={{ display: view === 'empty' ? 'block' : 'none' }}>
              <div className="re-icon">🎉</div>
              <div className="re-title">Your Party Budget Plan Will Appear Here</div>
              <p className="re-sub">Fill in your event details on the left and click Generate to get a complete AI budget breakdown with venue suggestions and shopping links.</p>
            </div>
            <div className="loading" id="loadingState" style={{ display: view === 'loading' ? 'block' : 'none' }}>
              <div className="spinner"></div>
              <p>Creating your personalized party budget plan...</p>
            </div>
            <div className="result-wrap" id="resultWrap" style={{ display: view === 'result' ? 'block' : 'none' }}>
              <div className="res-topbar">
                <div><h2>🎉 Your Party Budget Plan</h2><p id="resMeta">{result?.meta ?? 'Party'}</p></div>
                <div className="res-topbar-right">
                  <button className="print-btn" onClick={() => window.print()}>🖨️ Print/Save</button>
                  <div className="res-badge" id="resultSource">{result?.source ?? 'Budget recommendation'}</div>
                </div>
              </div>

              <div className="budget-line">
                <span className="bl-label">💰 Budget:</span>
                <span className="bl-val" id="blVal">{result ? fmt(result.budget) : dash}</span>
              </div>

              <div id="catSections">
                {structured &&
                  cats.map((cat, ci) => (
                    <div className="cat-section" key={ci}>
                      <div className="cat-head">
                        <span className="cat-icon">{cat.icon || '📦'}</span>
                        <span className="cat-name">{cat.name}</span>
                        <span className="cat-alloc">{fmt(cat.allocation)}</span>
                      </div>
                      <div className="cat-items">
                        {(cat.items || []).map((item, ii) => (
                          <div className="cat-item" key={ii}>
                            <div className="ci-top">
                              <span className="ci-name">{item.name}</span>
                              <span className="ci-price">{fmt(item.price)}</span>
                            </div>
                            <div className="ci-desc">{item.description}</div>
                            <div className="shop-row">
                              <span className="shop-lbl">Shop on:</span>
                              <ShopLinks item={item} name={item.name} fallbackPlatforms={plat} cfg={SHOP} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                {result?.kind === 'text' && (
                  <div
                    style={{ background: 'var(--surface)', border: '2px solid var(--border)', borderRadius: '14px', padding: '20px', lineHeight: 1.8, fontSize: '0.91rem' }}
                    dangerouslySetInnerHTML={{ __html: mdToHtml(result.text) }}
                  />
                )}
              </div>

              <div className="bsum-footer" id="bsumFooter">
                <div className="bsf-row total"><span className="bsf-label">Total Budget</span><span className="bsf-val" id="bsfTotal">{result ? fmt(result.budget) : dash}</span></div>
                <div className="bsf-row"><span className="bsf-label">Allocated</span><span className="bsf-val" id="bsfAlloc">{structured ? fmt(totalAlloc) : dash}</span></div>
                <div className="bsf-row remaining"><span className="bsf-label">Remaining</span><span className="bsf-val" id="bsfRemain">{structured ? fmt(Math.max(0, result.budget - totalAlloc)) : dash}</span></div>
              </div>

              <div className="venue-card" id="venueCard" style={{ display: venues.length ? 'block' : 'none' }}>
                <div className="vc-head"><span>📍</span><h3>Venue Suggestions</h3></div>
                <div className="vc-body" id="venueBody">
                  {venues.map((v, i) => (
                    <div className="venue-item" key={i}>
                      <div>
                        <div className="vi-name">{v.name}</div>
                        <div className="vi-meta">{v.type ? '● Type: ' + v.type : ''} {v.location ? '📍 ' + v.location : ''}</div>
                        <div className="vi-links">
                          <ShopLinks item={{ shopping_links: v.search_links }} name={v.name} fallbackPlatforms={['OYO', 'Booking']} cfg={SHOP} />
                        </div>
                      </div>
                      <div className="vi-price">{v.cost !== undefined ? fmt(v.cost) : ''}</div>
                    </div>
                  ))}
                </div>
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
