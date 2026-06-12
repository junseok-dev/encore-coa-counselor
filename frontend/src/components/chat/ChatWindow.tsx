import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Message, SuggestedQuestion } from '../../types';
import InputBar from './InputBar';
import MessageBubble from './MessageBubble';
import SuggestedQuestions from './SuggestedQuestions';

interface Props {
  messages: Message[];
  isLoading: boolean;
  streamingMessageId: string | null;
  suggestedQuestions: SuggestedQuestion[];
  sendMessage: (content: string) => void;
  stopGenerating: () => void;
  convId?: string;
  scrollToMessageId?: string | null;
}

const SCROLL_STORAGE_PREFIX = 'chatScroll:v1:';
const NEAR_BOTTOM_THRESHOLD = 80;

const ChatWindow: React.FC<Props> = ({
  messages,
  isLoading,
  streamingMessageId,
  suggestedQuestions,
  sendMessage,
  stopGenerating,
  convId,
  scrollToMessageId,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const hasRestoredRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const scrollKey = `${SCROLL_STORAGE_PREFIX}${convId ?? 'default'}`;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  };

  // 외부에서 특정 메시지로 점프 요청이 오면 해당 메시지로 스크롤 + 잠시 강조
  useEffect(() => {
    if (!scrollToMessageId) return;
    const el = messageRefs.current[scrollToMessageId];
    if (!el) return;
    const timer = setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-brand-400', 'ring-offset-2', 'rounded-2xl');
      const removeHighlight = setTimeout(() => {
        el.classList.remove('ring-2', 'ring-brand-400', 'ring-offset-2', 'rounded-2xl');
      }, 1800);
      return () => clearTimeout(removeHighlight);
    }, 60);
    return () => clearTimeout(timer);
  }, [scrollToMessageId, messages]);

  useEffect(() => {
    hasRestoredRef.current = false;
    isNearBottomRef.current = true;
  }, [convId]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || hasRestoredRef.current || messages.length === 0) return;

    const saved = sessionStorage.getItem(scrollKey);
    if (saved !== null) {
      container.scrollTop = Number(saved);
    } else {
      container.scrollTop = container.scrollHeight;
    }
    const distanceFromBottom = container.scrollHeight - (container.scrollTop + container.clientHeight);
    isNearBottomRef.current = distanceFromBottom < NEAR_BOTTOM_THRESHOLD;
    hasRestoredRef.current = true;
  }, [messages.length, scrollKey]);

  useEffect(() => {
    if (!hasRestoredRef.current || !isNearBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container || !hasRestoredRef.current) return;
    const distanceFromBottom = container.scrollHeight - (container.scrollTop + container.clientHeight);
    isNearBottomRef.current = distanceFromBottom < NEAR_BOTTOM_THRESHOLD;
    setShowScrollDown(distanceFromBottom > 240);
    sessionStorage.setItem(scrollKey, String(container.scrollTop));
  };

  const showSuggestions = !isLoading;
  const showLoadingDots = isLoading && !streamingMessageId;

  return (
    <div className="relative flex h-full flex-col bg-transparent">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-1 py-4 space-y-0.5"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            ref={(el) => {
              messageRefs.current[message.id] = el;
            }}
          >
            <MessageBubble
              message={message}
              isStreaming={message.id === streamingMessageId}
            />
          </div>
        ))}

        {showLoadingDots && (
          <div className="mb-1 flex items-start gap-2.5 px-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-cyan-500 text-xs font-bold text-white shadow-sm">
              AI
            </div>
            <div className="flex flex-col">
              <span className="mb-1 text-[12px] font-semibold text-gray-600">코아</span>
              <div className="flex items-center gap-1.5 rounded-[1.5rem] rounded-tl-md border border-white/80 bg-white px-4 py-3 shadow-sm">
                <div className="flex gap-1">
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400 [animation-delay:-0.3s]" />
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400 [animation-delay:-0.15s]" />
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400" />
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} className="h-2" />
      </div>

      {showScrollDown && (
        <button
          onClick={scrollToBottom}
          aria-label="맨 아래로 이동"
          className="absolute bottom-32 right-4 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-white/80 bg-white/95 text-gray-600 shadow-[0_6px_18px_rgba(15,23,42,0.18)] backdrop-blur transition-transform hover:scale-105 hover:text-gray-900"
        >
          <ChevronDown size={20} />
        </button>
      )}

      {showSuggestions && (
        <div className="shrink-0 border-t border-white/70 bg-white/70 px-3 py-2 backdrop-blur sm:px-4 sm:py-2.5">
          <SuggestedQuestions
            questions={suggestedQuestions}
            onSelect={sendMessage}
            disabled={isLoading}
          />
        </div>
      )}

      <InputBar onSendMessage={sendMessage} onStop={stopGenerating} isLoading={isLoading} />
    </div>
  );
};

export default ChatWindow;
