import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Onboarding from './pages/Onboarding';
import CustomerDetail from './pages/CustomerDetail';
import './App.css';

export default function App() {
  return (
    <div className="layout">
      <header className="topbar">
        <span className="topbar-brand">M2 · Customers</span>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
        </Routes>
      </main>
    </div>
  );
}
