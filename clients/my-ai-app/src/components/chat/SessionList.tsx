import { Plus } from 'lucide-react';
import { Button } from '../ui/button';
import { formatClock } from './format';
import type { SessionItem } from './types';

export function SessionList({
  sessions,
  currentId,
  disabled,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: {
  sessions: SessionItem[];
  currentId: string | null;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename?: (session: SessionItem) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <aside className="w-60 shrink-0 bg-white border-r border-slate-200 flex flex-col min-w-0">
      <div className="px-3 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-800">会话</div>
        <Button
          size="xs"
          variant="secondary"
          onClick={onNew}
          disabled={disabled}
          className="h-7"
        >
          <Plus className="size-3.5" />
          新建
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.length === 0 ? (
          <p className="p-3 text-xs text-slate-500">暂无会话</p>
        ) : (
          sessions.map((s) => {
            const active = currentId === s.id;
            return (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSelect(s.id);
                }}
                className={`w-full text-left px-3 py-2.5 rounded-xl border cursor-pointer ${
                  active
                    ? 'border-blue-200 bg-blue-50'
                    : 'border-transparent hover:bg-slate-50'
                } ${disabled ? 'opacity-60 pointer-events-none' : ''}`}
              >
                <div className="flex items-start justify-between gap-1">
                  <div
                    className="text-sm font-medium text-slate-800 truncate"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onRename?.(s);
                    }}
                  >
                    {s.title}
                  </div>
                  {onDelete ? (
                    <button
                      type="button"
                      className="text-slate-400 hover:text-slate-700 text-xs px-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(s.id);
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <div className="text-[11px] text-slate-500 truncate">
                    {s.botPaused ? '等待坐席' : s.lastMessage || '暂无消息'}
                  </div>
                  <div className="text-[10px] text-slate-400 shrink-0">
                    {formatClock(s.updatedAt)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
