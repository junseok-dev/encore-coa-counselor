import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Home, MessageSquarePlus, Search } from 'lucide-react';
import ChatWindow from '../components/chat/ChatWindow';
import HistoryDropdown from '../components/chat/HistoryPanel';
import { useChat } from '../hooks/useChat';
import { Conversation } from '../types';

const ChatPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    messages,
    isLoading,
    streamingMessageId,
    suggestedQuestions,
    sendMessage,
    stopGenerating,
    startNewChat,
    loadConversation,
    convId,
  } = useChat();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | null>(null);
  const historyBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(96,165,250,0.28),_transparent_34%),linear-gradient(180deg,_#f8fbff_0%,_#edf4ff_48%,_#e7eefb_100%)] px-3 py-2 sm:px-6 sm:py-4">
      <div className="relative flex h-[calc(100vh-1rem)] w-full max-w-[520px] flex-col overflow-hidden rounded-[2.25rem] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(241,247,255,0.92))] shadow-[0_24px_80px_rgba(15,23,42,0.18)] sm:h-[min(1080px,calc(100vh-2rem))]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.22),_transparent_70%)]" />

        <header className="relative z-10 shrink-0 border-b border-white/70 bg-white/70 shadow-sm backdrop-blur">
          <div className="mx-auto flex min-h-[72px] w-full items-center justify-between gap-2 px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <button
                onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
                className="shrink-0 rounded-full p-2 text-gray-500 transition-colors hover:bg-white hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                aria-label="뒤로 가기"
              >
                <ArrowLeft size={20} />
              </button>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-cyan-500 text-sm font-bold text-white shadow-inner">
                AI
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-[15px] font-bold leading-tight text-slate-900 sm:text-base">
                  코아
                </h1>
                <p className="truncate text-[11px] font-medium text-brand-600/90">
                  엔코아 AI 캠퍼스 상담 챗봇
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                onClick={startNewChat}
                className="flex shrink-0 items-center justify-center rounded-2xl border border-white/80 bg-white/80 p-2 text-gray-600 transition-colors hover:bg-white hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                aria-label="새 대화 시작"
                title="새 대화 시작"
              >
                <MessageSquarePlus size={18} />
              </button>
              <a
                href="https://encorecampus.ai/"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-2xl border border-white/80 bg-white/80 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-white hover:text-gray-900"
                aria-label="엔코아 AI 캠퍼스 홈페이지"
              >
                <Home size={15} />
                <span className="text-[13px]">홈</span>
              </a>
              <button
                ref={historyBtnRef}
                onClick={() => setHistoryOpen((v) => !v)}
                className={`flex items-center gap-1.5 rounded-2xl border px-3 py-2 text-sm transition-colors ${
                  historyOpen
                    ? 'border-brand-300 bg-brand-50 text-brand-700'
                    : 'border-white/80 bg-white/80 text-gray-600 hover:bg-white hover:text-gray-900'
                }`}
              >
                <Search size={15} />
                <span className="text-[13px]">기록</span>
              </button>
            </div>
          </div>
        </header>

        <main className="relative flex-1 overflow-hidden">
          <div className="relative z-10 h-full w-full">
            <ChatWindow
              messages={messages}
              isLoading={isLoading}
              streamingMessageId={streamingMessageId}
              suggestedQuestions={suggestedQuestions}
              sendMessage={sendMessage}
              stopGenerating={stopGenerating}
              convId={convId}
              scrollToMessageId={scrollToMessageId}
            />
          </div>
        </main>

        <HistoryDropdown
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onSelect={(conv: Conversation, messageId?: string) => {
            loadConversation(conv);
            if (messageId) setScrollToMessageId(messageId);
          }}
          currentConvId={convId}
          anchorRef={historyBtnRef}
        />
      </div>
    </div>
  );
};

export default ChatPage;