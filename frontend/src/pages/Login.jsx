import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { usePageStyle } from '../hooks/usePageStyle.js';
import loginCss from '../styles/pages/login.css?inline';

export default function Login() {
  usePageStyle(loginCss, 'Login – PocketSmart AI');
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(params.get('expired') ? 'Your session ended. Please sign in again.' : '');

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await login(username, password);
      if (result.ok) {
        navigate('/dashboard');
        return;
      }
      setError(result.error || 'Invalid username or password');
    } catch {
      setError('Connection error. Please try again.');
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
            <h1 className="page-title">Welcome Back 👋</h1>
            <p className="page-sub">Sign in to access your personalized budget planner</p>
            <div className="err-box" id="errBox" style={{ display: error ? 'block' : undefined }}>{error}</div>
            <form id="loginForm" onSubmit={onSubmit}>
              <div className="form-group">
                <label>Username</label>
                <div className="inp-wrap"><span className="inp-icon">👤</span><input type="text" id="username" placeholder="Enter your username" required value={username} onChange={(e) => setUsername(e.target.value)} /></div>
              </div>
              <div className="form-group">
                <label>Password</label>
                <div className="inp-wrap"><span className="inp-icon">🔒</span><input type="password" id="password" placeholder="Enter your password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
              </div>
              <button type="submit" className="btn-submit" id="submitBtn" disabled={busy}>{busy ? 'Signing in...' : 'Sign In →'}</button>
            </form>
            <p className="switch">Don't have an account? <Link to="/register">Create one free</Link></p>
          </div>
        </div>

        <div className="right">
          <div className="right-glow"></div>
          <div className="right-inner">
            <h2>Plan Smarter with AI</h2>
            <p>Access all three powerful budget planners and save time while staying within your budget</p>
            <div className="feat-cards">
              <div className="feat-card"><div className="feat-icon">🏠</div><div className="feat-text"><h4>Home Interior Planner</h4><p>Smart furniture & decor within your budget</p></div></div>
              <div className="feat-card"><div className="feat-icon">🎉</div><div className="feat-text"><h4>Party Budget Planner</h4><p>Event cost planning and allocation</p></div></div>
              <div className="feat-card"><div className="feat-icon">💍</div><div className="feat-text"><h4>Jewelry Budget Planner</h4><p>Outfit-matched jewelry recommendations</p></div></div>
            </div>
          </div>
        </div>
    </>
  );
}
