import { useState } from 'react';
import './App.css';
import CustomerChat from './components/customer/CustomerChat';
import AgentShell from './components/layout/AgentShell';
import LoginView from './components/LoginView';
import { clearAuth, getStoredUser, type AuthUser } from './lib/api';

function App() {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());

  if (!user) {
    return <LoginView onLoggedIn={setUser} />;
  }

  const onLogout = () => {
    clearAuth();
    setUser(null);
  };

  if (user.role === 'agent') {
    return <AgentShell user={user} onLogout={onLogout} />;
  }

  return <CustomerChat user={user} onLogout={onLogout} />;
}

export default App;
