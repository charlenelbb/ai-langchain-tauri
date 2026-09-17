import React from 'react';
import ReactMarkdown from 'react-markdown';

export function MarkdownContent({
  content,
  className = 'text-slate-800',
}: {
  content: string;
  className?: string;
}) {
  return (
    <ReactMarkdown
      className={`cs-markdown leading-relaxed ${className}`}
      components={{
        p: ({ children }: { children?: React.ReactNode }) => (
          <p className="mb-2 last:mb-0">{children}</p>
        ),
        ul: ({ children }: { children?: React.ReactNode }) => (
          <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>
        ),
        ol: ({ children }: { children?: React.ReactNode }) => (
          <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>
        ),
        li: ({ children }: { children?: React.ReactNode }) => (
          <li className="leading-relaxed">{children}</li>
        ),
        strong: ({ children }: { children?: React.ReactNode }) => (
          <strong className="font-semibold">{children}</strong>
        ),
        code: ({ children }: { children?: React.ReactNode }) => (
          <code className="px-1 py-0.5 rounded bg-slate-100 text-sm font-mono">
            {children}
          </code>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
