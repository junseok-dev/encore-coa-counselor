import React, { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Send, Square } from 'lucide-react';

interface Props {
  onSendMessage: (message: string) => void;
  onStop: () => void;
  isLoading: boolean;
}

const InputBar: React.FC<Props> = ({ onSendMessage, onStop, isLoading }) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    if (input.trim()) {
      onSendMessage(input.trim());
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      return;
    }

    if (isLoading) {
      onStop();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 100)}px`;
    }
  }, [input]);

  return (
    <div className="shrink-0 border-t border-white/70 bg-white/75 px-3 py-3 backdrop-blur">
      <div className="flex items-center gap-2 rounded-[1.75rem] border border-white/80 bg-white px-3 py-2 shadow-[0_12px_30px_rgba(15,23,42,0.08)] transition-all focus-within:border-brand-300 focus-within:ring-2 focus-within:ring-brand-200">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="메시지를 입력하세요"
          className="block max-h-[120px] min-h-[24px] flex-1 resize-none self-center overflow-y-auto border-none bg-transparent px-1 py-1 text-[15px] leading-6 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-0 sm:text-[15.5px]"
          rows={1}
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim() && !isLoading}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-cyan-500 text-white transition-transform hover:scale-[1.03] disabled:cursor-not-allowed disabled:from-slate-200 disabled:to-slate-200"
          aria-label={isLoading && !input.trim() ? '중지' : '전송'}
        >
          {isLoading && !input.trim() ? <Square size={14} fill="currentColor" /> : <Send size={15} />}
        </button>
      </div>
      <p className="mt-2 text-center text-[11px] text-slate-400">
        코아는 실수가 있을 수 있습니다. 중요한 정보는 담당자에게 확인해 주세요.
      </p>
    </div>
  );
};

export default InputBar;
