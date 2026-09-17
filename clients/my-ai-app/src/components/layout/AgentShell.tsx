import { useState } from 'react';
import { BookOpen, Headphones, LogOut } from 'lucide-react';
import { Button } from '../ui/button';
import type { AuthUser } from '../../lib/api';
import AgentDesk from '../agent/AgentDesk';
import RagModule from '../modules/RagModule';

export default function AgentShell({
  user,
  onLogout,
}: {
  user: AuthUser;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<'desk' | 'kb'>('desk');

  return (
    <div className="flex h-screen flex-col bg-[#f3f5f8]">
      <header className="h-14 shrink-0 bg-white border-b border-slate-200 px-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-4 min-w-0">
          <div className="text-sm font-semibold text-slate-900">坐席工作台</div>
          <nav className="flex items-center gap-1">
            <Button
              size="sm"
              variant={tab === 'desk' ? 'default' : 'ghost'}
              className={tab === 'desk' ? 'bg-slate-900 text-white' : 'text-slate-600'}
              onClick={() => setTab('desk')}
            >
              <Headphones className="size-4" />
              工作台
            </Button>
            <Button
              size="sm"
              variant={tab === 'kb' ? 'default' : 'ghost'}
              className={tab === 'kb' ? 'bg-slate-900 text-white' : 'text-slate-600'}
              onClick={() => setTab('kb')}
            >
              <BookOpen className="size-4" />
              知识库
            </Button>
          </nav>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span className="truncate max-w-40">{user.username}</span>
          <Button variant="ghost" size="sm" onClick={onLogout}>
            <LogOut className="size-4" />
            退出
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        {tab === 'desk' ? <AgentDesk user={user} /> : <RagModule />}
      </div>
    </div>
  );
}
