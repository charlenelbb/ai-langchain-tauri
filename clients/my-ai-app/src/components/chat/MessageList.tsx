import React, { useEffect, useRef } from 'react';
import { MarkdownContent } from './MarkdownContent';
import type { SessionMessage } from './types';

type LiveState = {
  status: 'idle' | 'retrieving' | 'thinking' | 'streaming' | 'done' | 'error';
  answer: string;
  error: string;
};

function TypingDots() {
  return (
    <div className="flex items-center gap-1 h-5 px-0.5" aria-hidden="true">
      <span className="size-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
      <span className="size-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
      <span className="size-1.5 rounded-full bg-slate-400 animate-bounce" />
    </div>
  );
}

export function MessageList({
  messages,
  live,
  empty,
}: {
  messages: SessionMessage[];
  live?: LiveState;
  empty?: React.ReactNode;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const streaming =
    live &&
    (live.status === 'retrieving' ||
      live.status === 'thinking' ||
      live.status === 'streaming');

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, live?.answer, live?.status]);

  if (messages.length === 0 && !streaming && live?.status !== 'error') {
    return <>{empty}</>;
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
      {messages.map((m) => (
        <Bubble key={m.id} message={m} />
      ))}
      {live?.status === 'error' && live.error ? (
        <div className="flex justify-start">
          <div className="px-3 py-2 rounded-2xl rounded-tl-md max-w-[78%] text-sm bg-red-50 border border-red-100 text-red-700">
            {live.error}
          </div>
        </div>
      ) : null}
      {streaming ? (
        <div className="flex justify-start">
          <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-md px-3 py-2 max-w-[78%] shadow-sm">
            {!live.answer ? <TypingDots /> : <MarkdownContent content={live.answer} />}
          </div>
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}

function Bubble({ message: m }: { message: SessionMessage }) {
  const isUser = m.sender === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`px-3 py-2 max-w-[78%] text-sm leading-relaxed shadow-sm ${
          isUser
            ? 'bg-blue-600 text-white rounded-2xl rounded-tr-md whitespace-pre-wrap'
            : m.sender === 'agent'
              ? 'bg-emerald-50 border border-emerald-100 text-slate-900 rounded-2xl rounded-tl-md'
              : 'bg-white border border-slate-200 text-slate-900 rounded-2xl rounded-tl-md'
        }`}
      >
        {m.sender === 'agent' ? (
          <div className="text-[11px] text-emerald-700 mb-1">
            {m.metadata?.agentName ? `坐席 ${m.metadata.agentName}` : '坐席回复'}
          </div>
        ) : m.sender === 'assistant' ? (
          <div className="text-[11px] text-slate-400 mb-1">智能客服</div>
        ) : null}
        {m.sender === 'assistant' || m.sender === 'agent' ? (
          <MarkdownContent
            content={m.text}
            className={isUser ? 'text-white' : 'text-slate-800'}
          />
        ) : (
          m.text
        )}
      </div>
    </div>
  );
}
