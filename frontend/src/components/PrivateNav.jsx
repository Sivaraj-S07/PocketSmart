import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const LINKS = [
  ['dashboard', '/dashboard', 'Dashboard'],
  ['home', '/home-planner', '🏠 Home'],
  ['party', '/party-planner', '🎉 Party'],
  ['jewelry', '/jewelry-planner', '💍 Jewelry'],
  ['history', '/history', '📜 History'],
];

/** Top navigation shared by every signed-in page (markup/classes identical to the original). */
export default function PrivateNav({ active }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = async (e) => {
    e.preventDefault();
    await logout();
    navigate('/login');
  };

  return (
    <nav>
      <div className="nav-logo">PocketSmart<span className="dot">.</span><span className="ai">AI</span></div>
      <div className="nav-right">
        {LINKS.map(([key, to, label]) => (
          <Link key={key} to={to} className={key === active ? 'nl active' : 'nl'}>{label}</Link>
        ))}
        <span className="user-chip" id="userChip">👤 {user?.username || 'User'}</span>
        <a href="/login" className="nl danger" onClick={onLogout}>Logout</a>
      </div>
    </nav>
  );
}
