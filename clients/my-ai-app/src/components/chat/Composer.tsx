import { Send, Square } from 'lucide-react';
import { Button } from '../ui/button';

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  placeholder,
  disabled,
  busy,
  busyLabel = '发送中…',
  submitLabel = '发送',
  stopLabel = '停止',
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  placeholder: string;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  submitLabel?: string;
  stopLabel?: string;
}) {
  const stopping = Boolean(busy && onStop);
  return (
    <div className="border-t bg-white px-4 py-3">
      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (stopping) {
                onStop?.();
                return;
              }
              if (!disabled && !busy && value.trim()) onSubmit();
            }
          }}
          placeholder={placeholder}
          rows={2}
          className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 resize-none outline-none"
          disabled={disabled && !stopping}
        />
        {stopping ? (
          <Button
            onClick={() => onStop?.()}
            className="bg-slate-700 hover:bg-slate-800 text-white h-10 px-4"
          >
            <Square className="size-4" />
            {stopLabel}
          </Button>
        ) : (
          <Button
            onClick={onSubmit}
            disabled={disabled || busy || !value.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white h-10 px-4"
          >
            <Send className="size-4" />
            {disabled && busyLabel !== '发送中…' ? busyLabel : submitLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
