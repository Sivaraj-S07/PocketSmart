import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatError } from '../api.js';
import { usePageStyle } from '../hooks/usePageStyle.js';
import registerCss from '../styles/pages/register.css?inline';

export default function Register() {
  usePageStyle(registerCss, 'Register – PocketSmart AI');
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', fullname: '', email: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (form.password !== form.confirm) {
      setError('Passwords do not match!');
      return;
    }
    setBusy(true);
    try {
      const res = await api.post('/api/register', {
        username: form.username,
        full_name: form.fullname,
        email: form.email,
        password: form.password,
      });
      if (res.ok) {
        setSuccess('✅ Account created! Redirecting to login...');
        timer.current = setTimeout(() => navigate('/login'), 1500);
        return;
      }
      setError(formatError(res.data?.detail ?? res.data, 'Registration failed.'));
    } catch {
      setError('Connection error.');
    }
    setBusy(false);
  }

  return (
    <>
      <div className="left">
          <div className="left-wrap">
            <Link to="/" className="back-link">← Back to Home</Link>
            <div className="brand">PocketSmart<span className="dot">.</span><span className="ai">AI</span></div>
            <p className="brand-tag">Personalized Budget Planning</p>
            <h1 className="page-title">Create Your Account</h1>
            <p className="page-sub">Join PocketSmart AI and start planning smarter today</p>
            <div className="msg msg-err" id="errMsg" style={{ display: error ? 'block' : undefined }}>{error}</div>
            <div className="msg msg-ok" id="okMsg" style={{ display: success ? 'block' : undefined }}>{success}</div>
            <form id="regForm" onSubmit={onSubmit}>
              <div className="form-group"><label>Username *</label><div className="inp-wrap"><span className="inp-icon">👤</span><input type="text" id="username" placeholder="Choose a username" required value={form.username} onChange={set('username')} /></div></div>
              <div className="form-group"><label>Full Name</label><div className="inp-wrap"><span className="inp-icon">📛</span><input type="text" id="fullname" placeholder="Your full name" value={form.fullname} onChange={set('fullname')} /></div></div>
              <div className="form-group"><label>Email</label><div className="inp-wrap"><span className="inp-icon">📧</span><input type="email" id="email" placeholder="your@email.com" value={form.email} onChange={set('email')} /></div></div>
              <div className="form-group"><label>Password *</label><div className="inp-wrap"><span className="inp-icon">🔒</span><input type="password" id="password" placeholder="Create a strong password" required value={form.password} onChange={set('password')} /></div></div>
              <div className="form-group"><label>Confirm Password *</label><div className="inp-wrap"><span className="inp-icon">🔒</span><input type="password" id="confirm" placeholder="Confirm your password" required value={form.confirm} onChange={set('confirm')} /></div></div>
              <button type="submit" className="btn-submit" id="submitBtn" disabled={busy}>{busy ? 'Creating...' : 'Create Account →'}</button>
            </form>
            <p className="switch">Already have an account? <Link to="/login">Sign in here</Link></p>
          </div>
        </div>

        <div className="right">
          <div className="right-glow"></div>
          <div className="right-inner">
            <h2>Why Join PocketSmart AI?</h2>
            <p>Everything you need to manage budgets intelligently with the power of AI</p>
            <div className="benefits">
              <div className="benefit"><div className="bcheck">✓</div><span>Free to use — no credit card needed</span></div>
              <div className="benefit"><div className="bcheck">✓</div><span>Gemini enhancement when configured; offline plans always available</span></div>
              <div className="benefit"><div className="bcheck">✓</div><span>Home, Party & Jewelry planners included</span></div>
              <div className="benefit"><div className="bcheck">✓</div><span>Budget tracking & recommendation history</span></div>
              <div className="benefit"><div className="bcheck">✓</div><span>Amazon, Flipkart, IKEA, Swiggy & more</span></div>
              <div className="benefit"><div className="bcheck">✓</div><span>Upload outfit image for jewelry matching</span></div>
            </div>
          </div>
        </div>
    </>
  );
}
