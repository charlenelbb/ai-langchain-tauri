import React, { useState } from 'react';
import { API_BASE, setAuth, type AuthUser } from '../lib/api';
import { Button } from './ui/button';

type LoginViewProps = {
  onLoggedIn: (user: AuthUser) => void;
};

const LoginView: React.FC<LoginViewProps> = ({ onLoggedIn }) => {
  const [roleTab, setRoleTab] = useState<'customer' | 'agent'>('customer');
  const [username, setUsername] = useState('customer');
  const [password, setPassword] = useState('demo123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function switchTab(next: 'customer' | 'agent') {
    setRoleTab(next);
    setUsername(next);
    setPassword('demo123');
    setError('');
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message || '登录失败');
        return;
      }
      setAuth(data.token, data.user);
      onLoggedIn(data.user);
    } catch {
      setError('无法连接后端');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-slate-100">
      <div className="bg-white border border-slate-200 rounded-2xl p-7 w-[400px] shadow-sm space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">智能客服</h1>
          <p className="text-sm text-slate-500 mt-1">登录后进入对应工作台</p>
        </div>
        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            className={`py-2 text-sm rounded-lg ${
              roleTab === 'customer' ? 'bg-white shadow-sm font-medium text-slate-900' : 'text-slate-500'
            }`}
            onClick={() => switchTab('customer')}
          >
            我是客户
          </button>
          <button
            type="button"
            className={`py-2 text-sm rounded-lg ${
              roleTab === 'agent' ? 'bg-white shadow-sm font-medium text-slate-900' : 'text-slate-500'
            }`}
            onClick={() => switchTab('agent')}
          >
            我是坐席
          </button>
        </div>
        <div className="space-y-3">
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="用户名"
          />
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
        </div>
        {error ? <div className="text-sm text-red-600">{error}</div> : null}
        <Button
          className="w-full bg-slate-900 hover:bg-slate-800 text-white h-10"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? '登录中…' : '登录'}
        </Button>
        <p className="text-[11px] text-slate-400 text-center">
          演示账号 {roleTab} / demo123
        </p>
      </div>
    </div>
  );
};

export default LoginView;
