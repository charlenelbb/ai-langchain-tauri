import { Send } from 'lucide-react';
import { Button } from '../ui/button';

export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  busyLabel = '发送中…',
  submitLabel = '发送',
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  placeholder: string;
  disabled?: boolean;
  busyLabel?: string;
  submitLabel?: string;
}) {
  return (
    <div className="border-t bg-white px-4 py-3">
      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!disabled && value.trim()) onSubmit();
            }
          }}
          placeholder={placeholder}
          rows={2}
          className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 resize-none outline-none"
          disabled={disabled}
        />
        <Button
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          className="bg-blue-600 hover:bg-blue-700 text-white h-10 px-4"
        >
          <Send className="size-4" />
          {disabled && busyLabel !== '发送中…' ? busyLabel : submitLabel}
        </Button>
      </div>
    </div>
  );
}
