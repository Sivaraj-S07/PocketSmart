import { Link } from 'react-router-dom';
import { usePageStyle } from '../hooks/usePageStyle.js';
import homeCss from '../styles/pages/home.css?inline';

/** Public landing page. */
export default function Home() {
  usePageStyle(homeCss, 'PocketSmart AI – Smart Budget Planner');
  return (
    <>
      {/* NAVBAR */}
      <nav>
        <div className="nav-logo">PocketSmart<span className="dot">.</span><span className="ai">AI</span></div>
        <div className="nav-menu">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it Works</a>
          <a href="#reviews">Reviews</a>
          <Link to="/login">Sign In</Link>
          <Link to="/register" className="nav-btn">Get Started Free</Link>
        </div>
      </nav>

      {/* HERO */}
      <div style={{ paddingTop: "68px" }}>
      <div className="hero">
        <div className="hero-grid-bg"></div>
        <div className="hero-glow"></div>
        <div className="hero-inner">
          <div>
            <div className="hero-badge">✦ Smart budget recommendations</div>
            <h1>Budget Planning<br />for Your Home,<br /><span className="hl">Events & Style</span></h1>
            <p className="hero-sub">Plan home decor, events, and jewelry within your budget. Gemini can enhance suggestions when configured; built-in recommendations work offline too.</p>
            <div className="hero-actions">
              <Link to="/register" className="btn-gold">Start Planning Free →</Link>
              <Link to="/login" className="btn-ghost-w">Sign In</Link>
            </div>
          </div>
          <div className="hero-card-stack">
            <div className="hero-card"><div className="hc-icon hci-b">🏠</div><div className="hc-info"><h4>Home Interior Planner</h4><p>₹50,000 · 3 rooms · Modern</p></div><div className="hc-badge">✓ Active</div></div>
            <div className="hero-card"><div className="hc-icon hci-g">🎉</div><div className="hc-info"><h4>Party Budget Planner</h4><p>Birthday · 50 guests · ₹25,000</p></div><div className="hc-badge">✓ Active</div></div>
            <div className="hero-card"><div className="hc-icon hci-p">💍</div><div className="hc-info"><h4>Jewelry Planner</h4><p>Wedding · ₹10,000 budget</p></div><div className="hc-badge">✓ Active</div></div>
          </div>
        </div>
        <div className="hero-stats">
          <div className="h-stat"><div className="h-stat-val">3</div><div className="h-stat-lbl">Planner Modules</div></div>
          <div className="h-stat"><div className="h-stat-val">10+</div><div className="h-stat-lbl">Platforms Covered</div></div>
          <div className="h-stat"><div className="h-stat-val">2</div><div className="h-stat-lbl">Recommendation modes</div></div>
          <div className="h-stat"><div className="h-stat-val">Free</div><div className="h-stat-lbl">To Get Started</div></div>
        </div>
      </div>

      {/* TRUST BAR */}
      <div className="trust">
        <div className="trust-item"><span>✅</span> Completely Free</div>
        <div className="trust-item"><span>🤖</span> Gemini optional · offline mode ready</div>
        <div className="trust-item"><span>🛒</span> Amazon · Flipkart · IKEA</div>
        <div className="trust-item"><span>🍕</span> Swiggy · Zomato · OYO</div>
        <div className="trust-item"><span>📱</span> Works on All Devices</div>
      </div>

      {/* PLANNERS */}
      <div className="section" id="features">
        <div className="tc">
          <div className="sec-tag">Our Smart Planners</div>
          <h2 className="sec-title">Everything You Need to Budget Smarter</h2>
          <p className="sec-sub">Three budget planners for major life expenses, tailored to your preferences</p>
        </div>
        <div className="cards3">
          <div className="pcard">
            <div className="pcard-top pt-blue">🏠</div>
            <div className="pcard-body">
              <h3>Home Interior Budget Planner</h3>
              <p>Tell us your rooms, budget and style. Get curated furniture, lighting and decor picks within your price range from top platforms.</p>
              <div className="ptags"><span className="ptag">Amazon</span><span className="ptag">Flipkart</span><span className="ptag">IKEA</span></div>
              <Link to="/register" className="plink">Start Planning →</Link>
            </div>
          </div>
          <div className="pcard">
            <div className="pcard-top pt-gold">🎉</div>
            <div className="pcard-body">
              <h3>Party Budget Planner</h3>
              <p>Input budget, guest count and event type. AI splits costs perfectly across food, decoration, entertainment and venue.</p>
              <div className="ptags"><span className="ptag">Swiggy</span><span className="ptag">Zomato</span><span className="ptag">OYO</span><span className="ptag">Amazon</span></div>
              <Link to="/register" className="plink">Plan My Event →</Link>
            </div>
          </div>
          <div className="pcard">
            <div className="pcard-top pt-indigo">💍</div>
            <div className="pcard-body">
              <h3>Jewelry Budget Planner</h3>
              <p>Enter your budget and occasion. Upload an outfit photo for AI color-matched jewelry suggestions that complement your look.</p>
              <div className="ptags"><span className="ptag">Amazon</span><span className="ptag">Flipkart</span><span className="ptag">All Occasions</span></div>
              <Link to="/register" className="plink">Find Jewelry →</Link>
            </div>
          </div>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div className="section-alt" id="how-it-works">
        <div className="section-alt-inner">
          <div className="tc">
            <div className="sec-tag">Simple Process</div>
            <h2 className="sec-title">How PocketSmart AI Works</h2>
            <p className="sec-sub">Get personalized recommendations in four simple steps</p>
          </div>
          <div className="steps4">
            <div className="step-box"><div className="step-num">1</div><h4>Create Free Account</h4><p>Sign up in seconds — no credit card or payment needed</p></div>
            <div className="step-box"><div className="step-num">2</div><h4>Choose Your Planner</h4><p>Pick from Home, Party or Jewelry budget planner</p></div>
            <div className="step-box"><div className="step-num">3</div><h4>Set Your Budget</h4><p>Enter your budget, preferences and specific requirements</p></div>
            <div className="step-box"><div className="step-num">4</div><h4>Get AI Picks</h4><p>Receive curated product picks with direct shopping links</p></div>
          </div>
        </div>
      </div>

      {/* REVIEWS */}
      <div className="section" id="reviews">
        <div className="tc">
          <div className="sec-tag">What Users Say</div>
          <h2 className="sec-title">Trusted by Smart Shoppers</h2>
          <p className="sec-sub">Real experiences from people who transformed their budget planning</p>
        </div>
        <div className="reviews3">
          <div className="rcard">
            <div className="rstars">★★★★★</div>
            <p className="rtext">"Furnished my entire living room within ₹40,000! Amazon and IKEA recommendations were spot on. Saved hours of research."</p>
            <div className="rauthor"><div className="ravatar">P</div><div><div className="rname">Priya Sharma</div><div className="rrole">Homeowner · Bangalore</div></div></div>
          </div>
          <div className="rcard">
            <div className="rstars">★★★★★</div>
            <p className="rtext">"Planned my sister's wedding for 80 guests within budget. The AI budget split for catering and decor was absolutely perfect!"</p>
            <div className="rauthor"><div className="ravatar">R</div><div><div className="rname">Rahul Mehta</div><div className="rrole">Event Planner · Mumbai</div></div></div>
          </div>
          <div className="rcard">
            <div className="rstars">★★★★★</div>
            <p className="rtext">"Uploaded my saree photo and got perfectly matched earrings within ₹5,000. The jewelry planner is absolutely genius!"</p>
            <div className="rauthor"><div className="ravatar">A</div><div><div className="rname">Ananya Krishnan</div><div className="rrole">Fashion Blogger · Chennai</div></div></div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="cta-section">
        <div className="cta-box">
          <h2>Ready to Optimize Your Budget?</h2>
          <p>Let PocketSmart AI make smarter financial decisions across all areas of your life</p>
          <div className="cta-btns">
            <Link to="/register" className="btn-white">Create Free Account</Link>
            <Link to="/login" className="btn-ol-w">Sign In</Link>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <footer>
        <div className="fgrid">
          <div>
            <div className="flogo">PocketSmart<span className="dot">.</span><span className="ai">AI</span></div>
            <p className="fdesc">Your budget planning assistant for home, events, and jewelry, with Gemini enhancement when configured and a built-in offline mode.</p>
          </div>
          <div className="fcol"><h4>Planners</h4><Link to="/home-planner">Home Interior</Link><Link to="/party-planner">Party Budget</Link><Link to="/jewelry-planner">Jewelry Finder</Link></div>
          <div className="fcol"><h4>Account</h4><Link to="/login">Sign In</Link><Link to="/register">Register Free</Link><Link to="/dashboard">Dashboard</Link><Link to="/history">History</Link></div>
          <div className="fcol"><h4>Platforms</h4><a href="#">Amazon India</a><a href="#">Flipkart</a><a href="#">IKEA India</a><a href="#">Swiggy / Zomato</a></div>
        </div>
        <div className="fbot"><span>© 2026 PocketSmart AI. All rights reserved.</span><span>Gemini optional · offline recommendations available</span></div>
      </footer>
      </div>
    </>
  );
}
