import { Routes, Route, NavLink } from 'react-router-dom';
import CustomerList from './pages/CustomerList';
import CustomerDetail from './pages/CustomerDetail';
import CreateCustomer from './pages/CreateCustomer';
import './App.css';

export default function App() {
  return (
    <div className="layout">
      <header className="topbar">
        <span className="topbar-brand">M2 · Customers</span>
        <nav className="topbar-nav">
          <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>
            Customers
          </NavLink>
          <NavLink to="/new" className={({ isActive }) => isActive ? 'active' : ''}>
            + New
          </NavLink>
        </nav>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<CustomerList />} />
          <Route path="/new" element={<CreateCustomer />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
        </Routes>
      </main>
    </div>
  );
}
