import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MessageSquare, Search, X } from 'lucide-react';
import { Conversation, Message } from '../../types';
import { useConversations } from '../../hooks/useChat';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (conv: Conversation, messageId?: string) => void;
  currentConvId?: string;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

interface MatchItem {
  conv: Conversation;
  message: Message;
  snippet: string;
}

const highlight = (text: string, keyword: string) => {
  if (!keyword.trim()) return <span>{text}</span>;
  const parts = text.split(new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === keyword.toLowerCase() ? (
          <mark key={i} className="bg-brand-200 text-brand-800 rounded px-0.5">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
};

const buildSnippet = (text: string, keyword: string): string => {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(keyword.toLowerCase());
  if (idx < 0) return text.slice(0, 60);
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + keyword.length + 40);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
};

const HistoryDropdown: React.FC<Props> = ({ open, onClose, onSelect, currentConvId, anchorRef }) => {
  const [keyword, setKeyword] = useState('');
  const { search, refresh } = useConversations();
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);

  useEffect(() => {
    if (open) {
      refresh();
      setConvs([]);
      setKeyword('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // 키워드 변경 시 매칭 대화 목록 갱신
  useEffect(() => {
    const trimmed = keyword.trim();
    if (!trimmed) {
      setConvs([]);
      return;
    }
    setConvs(search(trimmed));
    setActiveIndex(0);
  }, [keyword]);

  // 매칭 대화들을 메시지 단위로 펼쳐서 평탄화 (한 대화에 매칭 N개면 N개 결과 항목)
  const matches: MatchItem[] = useMemo(() => {
    const trimmed = keyword.trim();
    if (!trimmed) return [];
    const lower = trimmed.toLowerCase();
    const out: MatchItem[] = [];
    for (const c of convs) {
      for (const m of c.messages) {
        if (m.id === 'welcome') continue;
        if (m.content.toLowerCase().includes(lower)) {
          out.push({ conv: c, message: m, snippet: buildSnippet(m.content, trimmed) });
        }
      }
    }
    // 최신순
    out.sort((a, b) => new Date(b.message.timestamp).getTime() - new Date(a.message.timestamp).getTime());
    return out;
  }, [convs, keyword]);

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeIndex]);

  // outside-click: 패널과 토글 버튼 둘 다 제외
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const goPrev = () => {
    if (matches.length === 0) return;
    setActiveIndex((i) => (i > 0 ? i - 1 : matches.length - 1));
  };
  const goNext = () => {
    if (matches.length === 0) return;
    setActiveIndex((i) => (i < matches.length - 1 ? i + 1 : 0));
  };
  const pickActive = () => {
    const target = matches[activeIndex];
    if (!target) return;
    onSelect(target.conv, target.message.id);
    onClose();
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (matches.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      goNext();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      goPrev();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pickActive();
    }
  };

  const anchorRect = anchorRef.current?.getBoundingClientRect();
  const top = (anchorRect?.bottom ?? 64) + 8;
  const rightOffset = anchorRect ? Math.max(8, window.innerWidth - anchorRect.right) : 16;

  return (
    <div
      ref={panelRef}
      className="fixed z-50 w-80 sm:w-96 max-w-[calc(100vw-1rem)] rounded-2xl border border-gray-200 bg-white shadow-xl overflow-hidden"
      style={{ top, right: rightOffset }}
    >
      {/* Search input */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-2 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 focus-within:border-brand-400 focus-within:ring-1 focus-within:ring-brand-400 transition-all">
          <Search size={13} className="shrink-0 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="키워드 입력... (↑↓로 이동, Enter로 점프)"
            className="flex-1 bg-transparent text-[13px] focus:outline-none placeholder-gray-400"
          />
          {keyword && (
            <button onClick={() => setKeyword('')} className="text-gray-400 hover:text-gray-600">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Result navigation: < n/m > */}
      {matches.length > 0 && (
        <div className="flex items-center justify-between border-y border-gray-100 bg-gray-50 px-3 py-1.5">
          <button
            onClick={goPrev}
            className="rounded-md p-1 text-gray-500 hover:bg-white hover:text-gray-900 disabled:opacity-30"
            aria-label="이전 매칭"
            disabled={matches.length <= 1}
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-[11px] font-medium text-gray-600">
            {activeIndex + 1} / {matches.length} 매칭
          </span>
          <button
            onClick={goNext}
            className="rounded-md p-1 text-gray-500 hover:bg-white hover:text-gray-900 disabled:opacity-30"
            aria-label="다음 매칭"
            disabled={matches.length <= 1}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Results — 메시지 단위 */}
      <div className="max-h-72 overflow-y-auto">
        {matches.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-gray-400">
            <MessageSquare size={24} strokeWidth={1.5} />
            <p className="text-xs">
              {keyword.trim() ? '검색 결과가 없습니다' : '키워드를 입력해 대화·메시지를 검색하세요'}
            </p>
          </div>
        ) : (
          <ul className="pb-2">
            {matches.map((item, idx) => {
              const isActive = idx === activeIndex;
              const isCurrent = item.conv.id === currentConvId;
              const roleLabel = item.message.role === 'user' ? '나' : 'AI';
              return (
                <li
                  key={`${item.conv.id}__${item.message.id}`}
                  ref={(el) => {
                    itemRefs.current[idx] = el;
                  }}
                >
                  <button
                    onClick={() => {
                      setActiveIndex(idx);
                      onSelect(item.conv, item.message.id);
                      onClose();
                    }}
                    className={`w-full text-left px-4 py-2.5 transition-colors ${
                      isActive
                        ? 'bg-brand-50 border-l-2 border-l-brand-500'
                        : isCurrent
                          ? 'bg-gray-50 border-l-2 border-l-gray-300'
                          : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12px] font-medium text-gray-700 line-clamp-1 flex-1">
                        <span className={`mr-1 inline-block rounded px-1 text-[10px] ${item.message.role === 'user' ? 'bg-brand-100 text-brand-700' : 'bg-gray-200 text-gray-700'}`}>
                          {roleLabel}
                        </span>
                        {highlight(item.conv.title, keyword)}
                      </p>
                      <span className="shrink-0 text-[10px] text-gray-400">{formatDate(item.message.timestamp)}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-gray-600 line-clamp-2">{highlight(item.snippet, keyword)}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default HistoryDropdown;