import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import PrivateNav from '../components/PrivateNav.jsx';
import { usePageStyle } from '../hooks/usePageStyle.js';
import dashboardCss from '../styles/pages/dashboard.css?inline';

const EMOJI = { home: '🏠', party: '🎉', jewelry: '💍' };
const LABEL = { home: 'Home Interior', party: 'Party Budget', jewelry: 'Jewelry' };

export default function Dashboard() {
  usePageStyle(dashboardCss, 'Dashboard – PocketSmart AI');
  const { user, expireSession } = useAuth();
  const [total, setTotal] = useState(0);
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/api/history')
      .then((r) => {
        if (cancelled) return;
        if (r.status === 401) return expireSession();
        if (!r.ok || !r.data) return;
        setTotal(r.data.total || 0);
        // The API returns newest first, so the five most recent are the first five.
        setRecent((r.data.history || []).slice(0, 5));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [expireSession]);

  return (
    <>
      <PrivateNav active="dashboard" />
        <div className="banner">
            <div className="banner-glow"></div>
            <div className="banner-inner">
              <div className="banner-text">
                <h1>Welcome back, <em id="heroUser">{user?.username || 'there'}</em>! 👋</h1>
                <p>Choose a planner and build a practical budget for your next project</p>
              </div>
              <div className="banner-pill">Gemini optional · offline planning available</div>
            </div>
          </div>

          <main>
            <div className="stats">
              <div className="stat">
                <div className="stat-ico si-b">📊</div>
                <div>
                  <div className="stat-val" id="totalRecs">{total}</div>
                  <div className="stat-lbl">Total Recommendations</div>
                </div>
              </div>
              <div className="stat">
                <div className="stat-ico si-g">🧠</div>
                <div>
                  <div className="stat-val">3</div>
                  <div className="stat-lbl">Budget planning tools</div>
                </div>
              </div>
              <div className="stat">
                <div className="stat-ico si-p">🛒</div>
                <div>
                  <div className="stat-val">10+</div>
                  <div className="stat-lbl">Platforms Covered</div>
                </div>
              </div>
            </div>

            <div className="sec-head">Our Smart Budget Planners</div>
            <div className="planners">
              <Link to="/home-planner" className="pc">
                <div className="pc-top pt-b">🏠</div>
                <div className="pc-body">
                  <h3>Home Interior Budget Planner</h3>
                  <p>Budget-aware furniture, lighting, and decor ideas for every room.</p>
                  <div className="pc-tags"><span className="pct">Amazon</span><span className="pct">Flipkart</span><span className="pct">IKEA</span></div>
                  <div className="pc-btn">Get Started →</div>
                </div>
              </Link>
              <Link to="/party-planner" className="pc">
                <div className="pc-top pt-g">🎉</div>
                <div className="pc-body">
                  <h3>Party Budget Planner</h3>
                  <p>Plan birthdays, weddings & events with smart AI budget splits.</p>
                  <div className="pc-tags"><span className="pct">Swiggy</span><span className="pct">Zomato</span><span className="pct">OYO</span></div>
                  <div className="pc-btn">Get Started →</div>
                </div>
              </Link>
              <Link to="/jewelry-planner" className="pc">
                <div className="pc-top pt-p">💍</div>
                <div className="pc-body">
                  <h3>Jewelry Budget Planner</h3>
                  <p>Find perfect jewelry. Upload outfit image for AI color-matched suggestions.</p>
                  <div className="pc-tags"><span className="pct">Amazon</span><span className="pct">Flipkart</span><span className="pct">Occasions</span></div>
                  <div className="pc-btn">Get Started →</div>
                </div>
              </Link>
            </div>

            <div className="sec-head">Recent Activity</div>
            <div className="activity" id="actBox">
                {recent.length > 0 ? (
                  recent.map((i) => (
                    <div className="act-row" key={i.id}>
                      <div className="act-ico">{EMOJI[i.category] || '📋'}</div>
                      <div className="act-info">
                        <div className="act-name">{LABEL[i.category] || i.category} Recommendation</div>
                        <div className="act-date">{new Date(i.timestamp).toLocaleString()}</div>
                      </div>
                      <div className="act-amt">₹{i.budget?.toLocaleString() || 'N/A'}</div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                <div className="empty-ico">📭</div>
                <p className="empty-txt">No recommendations yet. Start planning to see your activity here!</p>
              </div>
                )}
              </div>
              </main>
    </>
  );
}
