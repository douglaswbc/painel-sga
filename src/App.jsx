import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import { AuthProvider } from './contexts/AuthContext';
import DashboardLayout from './components/DashboardLayout';
import Login from './pages/Login';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import Locatarios from './pages/Locatarios';
import Veiculos from './pages/Veiculos';
import Contratos from './pages/Contratos';
import Cobrancas from './pages/Cobrancas';
import Mensagens from './pages/Mensagens';
import Triagem from './pages/Triagem';
import Configuracoes from './pages/Configuracoes';
import Admin from './pages/Admin';
import Acessos from './pages/Acessos';
import ZernioCallback from './pages/ZernioCallback';
import CandidateApplication from './pages/CandidateApplication';
import PaymentNotice from './pages/PaymentNotice';


// Componente temporário para teste
const Placeholder = ({ title }) => <h1 className="text-2xl text-white font-bold">{title}</h1>;

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="min-h-screen bg-[#f5f5f7]">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/zernio/callback" element={<ZernioCallback />} />
            <Route path="/inscricao/:token" element={<CandidateApplication />} />
            <Route path="/pagar/aviso/:motivo" element={<PaymentNotice />} />

            
            {/* Rotas Protegidas pelo DashboardLayout */}
            <Route element={<DashboardLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/locatarios" element={<Locatarios />} />
              <Route path="/clientes" element={<Locatarios />} />
              <Route path="/veiculos" element={<Veiculos />} />
              <Route path="/ativos" element={<Veiculos />} />
              <Route path="/contratos" element={<Contratos />} />
              <Route path="/cobrancas" element={<Cobrancas />} />
              <Route path="/mensagens" element={<Mensagens />} />
              <Route path="/triagem" element={<Triagem />} />
              <Route path="/configuracoes" element={<Configuracoes />} />
              <Route path="/acessos" element={<Acessos />} />
              <Route path="/admin" element={<Admin />} />
            </Route>

            <Route path="/" element={<Landing />} />
          </Routes>
          
          <ToastContainer theme="light" position="top-right" autoClose={3000} />
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
