import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Dashboard from './pages/Dashboard.jsx';
import History from './pages/History.jsx';
import Home from './pages/Home.jsx';
import HomePlanner from './pages/HomePlanner.jsx';
import JewelryPlanner from './pages/JewelryPlanner.jsx';
import Login from './pages/Login.jsx';
import PartyPlanner from './pages/PartyPlanner.jsx';
import Register from './pages/Register.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/home-planner" element={<HomePlanner />} />
        <Route path="/party-planner" element={<PartyPlanner />} />
        <Route path="/jewelry-planner" element={<JewelryPlanner />} />
        <Route path="/history" element={<History />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
