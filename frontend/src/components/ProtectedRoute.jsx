import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

/** Private pages: without a session, go to the sign-in page (like the original 401 -> /login?expired=1). */
export default function ProtectedRoute() {
  const { user, loading, reason } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to={reason === 'logout' ? '/login' : '/login?expired=1'} replace />;
  return <Outlet />;
}
