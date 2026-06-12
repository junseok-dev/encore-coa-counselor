import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Message } from '../../types';

interface Props {
  message: Message;
  isStreaming?: boolean;
}

const THINKING_STATUSES = [
  '질문을 확인하고 있어요.',
  '핵심 의도를 파악하고 있어요.',
  '관련 안내를 찾아보고 있어요.',
  '필요한 내용만 고르고 있어요.',
  '쉽게 말할 답변으로 정리하고 있어요.',
];

// ** 강조가 화면에 리터럴 '**'로 보이지 않도록 정규화한다.
const normalizeEmphasis = (text: string): string => {
  // CommonMark 약점: 닫는 **가 구두점 바로 뒤(예: "...영상)**을")면 right-flanking 조건을 못 채워
  // 강조가 안 닫히고 '**'가 그대로 보인다. 구두점과 ** 사이에 폭0 문자(​, 화면엔 안 보임)를
  // 넣어 닫힘을 보장한다.
  let s = text.replace(/([)\]}.,:;!?"'’”」』】》〉·…/%])(\*\*)/g, '$1​$2');
  // 스트리밍 중/말풍선 분할로 닫히지 않은 **는 끝에 닫는 **를 붙여 즉시 굵게 렌더.
  const boldMarks = (s.match(/\*\*/g) || []).length;
  if (boldMarks % 2 === 1) s = `${s}**`;
  return s;
};

const MessageBubble: React.FC<Props> = ({ message, isStreaming = false }) => {
  const isUser = message.role === 'user';
  const [statusIndex, setStatusIndex] = useState(0);
  const timeString = new Date(message.timestamp).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const assistantBubbles = message.content
    .split(/\n{2,}/)
    .map((part) => part.trim())
    // 보이는 글자(문자/숫자/한글)가 없는 조각은 빈 말풍선이 되므로 제외한다.
    // (공백·제로폭 문자, 스트리밍 중 잠깐 생기는 "- "·"**" 같은 미완성 마크다운 조각 포함)
    .filter((part) => /[\p{L}\p{N}]/u.test(part));

  useEffect(() => {
    if (!isStreaming) {
      setStatusIndex(0);
      return;
    }

    const timer = window.setInterval(() => {
      setStatusIndex((current) => (current + 1) % THINKING_STATUSES.length);
    }, 3000);

    return () => window.clearInterval(timer);
  }, [isStreaming]);

  if (isUser) {
    return (
      <div className="mb-2 flex items-end justify-end gap-1.5 px-3 sm:px-4">
        <span className="mb-0.5 shrink-0 text-[10px] text-gray-400">{timeString}</span>
        <div className="max-w-[85%] rounded-[1.75rem] rounded-br-md bg-gradient-to-br from-brand-500 to-cyan-500 px-3.5 py-2.5 text-[15.5px] leading-[1.75] text-white shadow-[0_14px_30px_rgba(37,99,235,0.22)] sm:max-w-[78%] sm:px-4 sm:py-3 sm:text-[16px] sm:leading-[1.8]">
          <div className="whitespace-pre-wrap break-keep">{message.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2 flex items-start gap-2 px-3 sm:gap-2.5 sm:px-4">
      <div className="mt-1 shrink-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-cyan-500 text-xs font-bold text-white shadow-sm sm:h-10 sm:w-10">
          AI
        </div>
      </div>

      <div className="flex max-w-[85%] flex-col sm:max-w-[82%]">
        <span className="mb-1 text-[12.5px] font-semibold text-gray-600">코아</span>
        <div className="flex items-end gap-1.5">
          <div className="flex flex-col items-start gap-1.5">
            {isStreaming && assistantBubbles.length === 0 ? (
              <div className="w-fit max-w-full rounded-[1.75rem] rounded-tl-md border border-white/80 bg-white px-3.5 py-2.5 text-[15.5px] leading-[1.75] text-gray-800 shadow-[0_12px_28px_rgba(15,23,42,0.08)] sm:px-4 sm:py-3 sm:text-[16px] sm:leading-[1.8]">
                <div className="flex items-center gap-2">
                  <span className="break-keep">{THINKING_STATUSES[statusIndex]}</span>
                  <span className="flex gap-0.5 pt-1">
                    <span className="h-1 w-1 animate-bounce rounded-full bg-brand-400 [animation-delay:-0.3s]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-brand-400 [animation-delay:-0.15s]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-brand-400" />
                  </span>
                </div>
              </div>
            ) : assistantBubbles.length === 0 ? (
              <div className="w-fit max-w-full rounded-[1.75rem] rounded-tl-md border border-white/80 bg-white px-3.5 py-2.5 text-[15.5px] leading-[1.75] text-gray-500 shadow-[0_12px_28px_rgba(15,23,42,0.08)] sm:px-4 sm:py-3 sm:text-[16px] sm:leading-[1.8]">
                <span className="break-keep">죄송해요, 답변을 준비하지 못했어요. 질문을 조금 바꿔서 다시 물어봐 주시겠어요?</span>
              </div>
            ) : (
              assistantBubbles.map((bubble, index) => (
                <div
                  key={index}
                  className={`w-fit max-w-full rounded-[1.75rem] border border-white/80 bg-white px-3.5 py-2.5 text-[15.5px] leading-[1.75] text-gray-800 shadow-[0_12px_28px_rgba(15,23,42,0.08)] sm:px-4 sm:py-3 sm:text-[16px] sm:leading-[1.8] ${
                    index === 0 ? 'rounded-tl-md' : ''
                  }`}
                >
                  <div className="whitespace-pre-wrap break-keep">
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => <span>{children}</span>,
                        strong: ({ children }) => <strong className="font-bold text-gray-950">{children}</strong>,
                        ul: ({ children }) => (
                          <ul className="mt-1.5 ml-5 list-disc space-y-1 marker:text-gray-400">{children}</ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="mt-1.5 ml-5 list-decimal space-y-1 marker:text-gray-400">{children}</ol>
                        ),
                        li: ({ children }) => <li className="pl-1">{children}</li>,
                        a: ({ href, children }) => (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-brand-600 underline decoration-brand-300 underline-offset-2 hover:text-brand-700 hover:decoration-brand-500"
                          >
                            {children}
                            <span className="ml-0.5 align-top text-[10px]">↗</span>
                          </a>
                        ),
                      }}
                    >
                      {normalizeEmphasis(bubble)}
                    </ReactMarkdown>
                  </div>
                </div>
              ))
            )}

            {message.source === 'handoff' && (
              <div className="mt-1">
                {message.handoff_url ? (
                  <a
                    href={message.handoff_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex rounded-xl bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600"
                  >
                    상담 매니저 연결하기
                  </a>
                ) : (
                  <p className="text-xs text-brand-600">
                    상담 매니저 연결이 필요합니다. 채널로 문의해 주세요.
                  </p>
                )}
              </div>
            )}
          </div>
          <span className="mb-0.5 shrink-0 text-[10px] text-gray-400">{timeString}</span>
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
