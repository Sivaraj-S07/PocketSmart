import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import PrivateNav from '../components/PrivateNav.jsx';
import ShopLinks from '../components/ShopLinks.jsx';
import { usePageStyle } from '../hooks/usePageStyle.js';
import jewelryPlannerCss from '../styles/pages/jewelryPlanner.css?inline';
import { copyText, errorText, extractJSON, fmt, mdToHtml, planText } from '../util.js';

const SHOP = {
  Amazon: { lbl: 'Amazon', cls: 's-amazon', u: 'https://www.amazon.in/s?k=' },
  Flipkart: { lbl: 'Flipkart', cls: 's-flipkart', u: 'https://www.flipkart.com/search?q=' },
  Bluestone: { lbl: 'Bluestone', cls: 's-bluestone', u: 'https://www.bluestone.com/search.html#q=' },
  Tanishq: { lbl: 'Tanishq', cls: 's-tanishq', u: 'https://www.tanishq.co.in/search?q=' },
  Caratlane: { lbl: 'CaratLane', cls: 's-caratlane', u: 'https://www.caratlane.com/catalogsearch/result/?q=' },
  Melorra: { lbl: 'Melorra', cls: 's-melorra', u: 'https://www.melorra.com/search?q=' },
  Malabar: { lbl: 'Malabar', cls: 's-malabar', u: 'https://www.malabargoldanddiamonds.com/search?q=' },
};

const OCCASIONS = ['Birthday', 'Wedding', 'Engagement', 'Anniversary', 'Festival / Diwali', 'Casual / Daily Wear', 'Office / Professional', 'Party / Night Out', 'Baby Shower / Naming', 'Gift'];
const METALS = ['Gold', 'Silver', 'Rose Gold', 'Platinum', 'Artificial / Imitation', 'Oxidised'];
const TYPES = [
  ['j_earring', 'Earrings', '💎 Earrings'],
  ['j_necklace', 'Necklace', '📿 Necklace'],
  ['j_bangle', 'Bangles', '🪬 Bangles'],
  ['j_ring', 'Ring', '💍 Ring'],
  ['j_maang', 'Maangtika', '✨ Maangtika'],
  ['j_bracelet', 'Bracelet', '📿 Bracelet'],
];
const PLATFORMS = [
  ['p_amazon', 'Amazon', 'Amazon'],
  ['p_flipkart', 'Flipkart', 'Flipkart'],
  ['p_bluestone', 'Bluestone', 'Bluestone'],
  ['p_tanishq', 'Tanishq', 'Tanishq'],
  ['p_caratlane', 'Caratlane', 'CaratLane'],
  ['p_melorra', 'Melorra', 'Melorra'],
];

const blankForm = () => ({
  budget: '',
  occasion: '',
  metal: '',
  stylePrefs: '',
  types: {},
  platforms: { Amazon: true, Flipkart: true, Bluestone: true },
});

export default function JewelryPlanner() {
  usePageStyle(jewelryPlannerCss, 'Jewelry Planner – PocketSmart AI');
  const { expireSession } = useAuth();
  const [form, setForm] = useState(blankForm);
  const [image, setImage] = useState(null); // { base64, dataUrl }
  const [view, setView] = useState('empty'); // empty | loading | result
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef(null);
  const copyTimer = useRef(null);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const toggle = (group, key) => (e) => setForm((f) => ({ ...f, [group]: { ...f[group], [key]: e.target.checked } }));

  function handleImg(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setImage({ base64: String(ev.target.result).split(',')[1], dataUrl: String(ev.target.result) });
    reader.readAsDataURL(file);
  }

  function removeImg() {
    setImage(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function generate() {
    const { budget, occasion, metal, stylePrefs } = form;
    const jewelryTypes = TYPES.filter(([, v]) => form.types[v]).map(([, v]) => v);
    const platforms = PLATFORMS.filter(([, v]) => form.platforms[v]).map(([, v]) => v);

    if (!budget || !occasion) {
      alert('Please fill in Budget and Occasion.');
      return;
    }

    setView('loading');
    setBusy(true);
    try {
      const res = await api.post('/api/generate-jewelry', {
        budget: parseInt(budget, 10),
        occasion,
        jewelry_types: jewelryTypes,
        metal_preference: metal,
        platforms,
        style_preferences: stylePrefs,
        image: image?.base64 || null,
      });
      if (res.status === 401) return expireSession();
      const raw = res.data || {};
      const source = raw.source === 'gemini' ? '✦ Gemini recommendation' : 'Offline recommendation';
      const recText = planText(raw);
      const parsed = extractJSON(recText);
      const b = parseInt(budget, 10);

      if (parsed && (parsed.jewelry || parsed.recommendations)) {
        setResult({ kind: 'structured', source, data: parsed, budget: b, platforms });
      } else if (recText) {
        setResult({ kind: 'text', source, text: recText, budget: b });
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
    removeImg();
    setForm((f) => ({ ...f, budget: '', occasion: '', metal: '', stylePrefs: '' }));
  }

  async function copyResult() {
    const lines = [];
    const copyItems = structured ? result.data.jewelry || result.data.recommendations || [] : [];
    copyItems.forEach((i) => {
      lines.push(`${i.name || i.type || ''} — ${fmt(i.price)}`);
      lines.push('  ' + (i.description ?? ''));
    });
    (structured ? result.data.tips || [] : []).forEach((t) => lines.push('💡 ' + t));
    if (await copyText(lines.join('\n'))) {
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    }
  }

  const structured = result?.kind === 'structured';
  const items = structured ? result.data.jewelry || result.data.recommendations || [] : [];
  const totalSpent = items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  const plat = structured && result.platforms.length ? result.platforms : ['Amazon', 'Flipkart', 'Bluestone'];
  const analysis = structured ? result.data.outfit_analysis : null;
  const tips = structured && Array.isArray(result.data.tips) ? result.data.tips : [];

  return (
    <>
      <PrivateNav active="jewelry" />

      <div className="page-header">
        <div className="ph-glow"></div>
        <div className="ph-inner">
          <div className="ph-icon">💍</div>
          <div className="ph-text">
            <h1>Jewelry Budget Planner</h1>
            <p>Get jewelry ideas shaped by your occasion, budget, and style preferences</p>
          </div>
        </div>
      </div>

      <main>
        <div className="layout">
          {/* FORM */}
          <div className="form-card">
            <div className="fch"><span>📋</span>
              <h2>Your Preferences</h2>
            </div>
            <div className="form-body">
              <div className="fsec">
                <div className="fsec-title"><span>💰</span> Budget Details</div>
                <div className="fgroup">
                  <label>Total Budget (₹) *</label>
                  <input type="number" id="budget" placeholder="e.g. 10000" min="500" value={form.budget} onChange={setField('budget')} />
                </div>
              </div>

              <div className="fsec">
                <div className="fsec-title"><span>💍</span> Occasion &amp; Preferences</div>
                <div className="frow">
                  <div className="fgroup full">
                    <label>Occasion *</label>
                    <select id="occasion" value={form.occasion} onChange={setField('occasion')}>
                      <option value="">Select occasion</option>
                      {OCCASIONS.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                </div>
                <div className="frow">
                  <div className="fgroup full">
                    <label>Jewelry Types</label>
                    <div className="cbgroup">
                      {TYPES.map(([id, value, label]) => (
                        <div className="cbitem" key={id}>
                          <input type="checkbox" id={id} value={value} checked={!!form.types[value]} onChange={toggle('types', value)} />
                          <label htmlFor={id}>{label}</label>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="frow">
                  <div className="fgroup full">
                    <label>Metal Preference</label>
                    <select id="metal" value={form.metal} onChange={setField('metal')}>
                      <option value="">No preference</option>
                      {METALS.map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
                <div className="frow">
                  <div className="fgroup full">
                    <label>Preferred Platforms</label>
                    <div className="cbgroup">
                      {PLATFORMS.map(([id, value, label]) => (
                        <div className="cbitem" key={id}>
                          <input type="checkbox" id={id} value={value} checked={!!form.platforms[value]} onChange={toggle('platforms', value)} />
                          <label htmlFor={id}>{label}</label>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="frow">
                  <div className="fgroup full">
                    <label>Style Preferences</label>
                    <textarea id="stylePrefs" placeholder="Describe your style, colors, materials, etc." value={form.stylePrefs} onChange={setField('stylePrefs')}></textarea>
                  </div>
                </div>
              </div>

              <div className="fsec">
                <div className="fsec-title"><span>👗</span> Upload Outfit Image <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--muted)', marginLeft: '4px' }}>(Optional — for color matching)</span></div>
                <div className="upload-zone" id="uploadZone" style={{ display: image ? 'none' : 'block' }}>
                  <input type="file" id="imgInput" accept="image/*" ref={fileInput} onChange={handleImg} />
                  <div className="uz-icon">📷</div>
                  <div className="uz-text">Click to upload outfit photo</div>
                  <div className="uz-hint">JPG, PNG, WEBP · Max 5MB</div>
                </div>
                <div className="img-preview" id="imgPreview" style={{ display: image ? 'block' : 'none' }}>
                  <img id="previewImg" src={image?.dataUrl} alt="Outfit preview" />
                  <button className="img-remove" onClick={removeImg}>✕ Remove Image</button>
                </div>
              </div>

              <button className="btn-gen" id="genBtn" onClick={generate} disabled={busy}>✦ Get Recommendations</button>
            </div>
          </div>

          {/* RESULT PANEL */}
          <div id="resultPanel">
            <div className="res-empty" id="emptyState" style={{ display: view === 'empty' ? 'block' : 'none' }}>
              <div className="re-icon">💍</div>
              <div className="re-title">Your Personalized Jewelry Recommendations Will Appear Here</div>
              <p className="re-sub">Set your budget, occasion and preferences. Optionally upload an outfit photo for color-matched suggestions, then click Get Recommendations.</p>
            </div>
            <div className="loading" id="loadingState" style={{ display: view === 'loading' ? 'block' : 'none' }}>
              <div className="spinner"></div>
              <p>Analyzing your preferences and generating jewelry recommendations...</p>
            </div>

            <div className="result-wrap" id="resultWrap" style={{ display: view === 'result' ? 'block' : 'none' }}>
              <div className="res-topbar">
                <h2>💍 Your Personalized Jewelry Recommendations</h2>
                <span id="resultSource" style={{ color: '#ffd37c', fontSize: '0.78rem', fontWeight: 800 }}>{result?.source ?? 'Budget recommendation'}</span>
              </div>

              {/* Budget Summary */}
              <div className="bsum">
                <div className="bsum-head"><span>💰</span>
                  <h3>Budget Summary</h3>
                </div>
                <div className="bsum-body">
                  <div className="bsum-item">
                    <div className="lbl">Total Budget</div>
                    <div className="val" id="bsTotal">{result ? fmt(result.budget) : '—'}</div>
                  </div>
                  <div className="bsum-item">
                    <div className="lbl">Remaining Budget</div>
                    <div className="val green" id="bsRemain">{structured ? fmt(Math.max(0, result.budget - totalSpent)) : '—'}</div>
                  </div>
                </div>
              </div>

              {/* Outfit Analysis (shown only if image uploaded) */}
              <div className="outfit-card" id="outfitCard" style={{ display: analysis ? 'block' : 'none' }}>
                <div className="oc-head"><span>👗</span>
                  <h3>Outfit Analysis</h3>
                </div>
                <div className="oc-body" id="outfitBody">
                  {analysis && !(analysis.colors || analysis.style || analysis.formality) && <div className="oc-tag">No outfit details detected</div>}
                  {analysis?.colors ? <div className="oc-tag"><span className="ticon">🎨</span> Colors: {analysis.colors}</div> : null}
                  {analysis?.style ? <div className="oc-tag"><span className="ticon">👗</span> Style: {analysis.style}</div> : null}
                  {analysis?.formality ? <div className="oc-tag"><span className="ticon">✨</span> Formality: {analysis.formality}</div> : null}
                </div>
              </div>

              {/* Jewelry Recommendations */}
              <div className="jwl-section">
                <div className="jwl-head"><span>💎</span>
                  <h3>Jewelry Recommendations</h3>
                </div>
                <div className="jwl-items" id="jwlItems">
                  {structured &&
                    items.map((item, i) => (
                      <div className="jwl-item" key={i}>
                        <div className="ji-top">
                          <div className="ji-dot"></div>
                          <span className="ji-name">{item.name || item.type}</span>
                          <span className="ji-price">{fmt(item.price)}</span>
                        </div>
                        <div className="ji-desc">{item.description}</div>
                        {item.style ? <div className="ji-style">Style: <strong>{item.style}</strong></div> : null}
                        <div className="shop-row">
                          <span className="shop-lbl">Shop For This:</span>
                          <ShopLinks item={item} name={item.name || item.type} fallbackPlatforms={plat} cfg={SHOP} />
                        </div>
                      </div>
                    ))}
                  {result?.kind === 'text' && (
                    <div style={{ padding: '20px', lineHeight: 1.8, fontSize: '0.91rem' }} dangerouslySetInnerHTML={{ __html: mdToHtml(result.text) }} />
                  )}
                </div>
              </div>

              {/* Styling Tips */}
              <div className="tips-card" id="tipsCard" style={{ display: tips.length ? 'block' : 'none' }}>
                <div className="tips-head"><span>💡</span>
                  <h3>Styling Tips</h3>
                </div>
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
