import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChevronDown } from 'lucide-react';
import { FaqItem } from '../../data/faqs';

interface Props {
  items: FaqItem[];
}

const FaqSection: React.FC<Props> = ({ items }) => {
  const [openId, setOpenId] = useState<string>(items[0]?.id ?? '');

  if (!items.length) return null;

  return (
    <section className="px-4 pb-4 pt-1 sm:px-5">
      <div className="rounded-[2rem] border border-white/70 bg-white/85 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-brand-500">
              FAQ
            </p>
            <h2 className="mt-1 text-[1.2rem] font-bold text-slate-900">
              자주 묻는 질문
            </h2>
          </div>
          <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
            내용만 수정하면 반영
          </span>
        </div>

        <div className="space-y-2">
          {items.map((item) => {
            const open = item.id === openId;

            return (
              <article
                key={item.id}
                className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-slate-50/80 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => setOpenId(open ? '' : item.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
                >
                  <span className="text-[15.5px] font-semibold leading-7 text-slate-900 sm:text-base">
                    {item.question}
                  </span>
                  <ChevronDown
                    size={18}
                    className={`shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
                  />
                </button>

                {open && (
                  <div className="border-t border-slate-200 bg-white px-4 py-4 text-[15px] leading-8 text-slate-700 sm:text-[15.5px]">
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                        ul: ({ children }) => <ul className="mb-3 space-y-1.5 last:mb-0">{children}</ul>,
                        li: ({ children }) => (
                          <li className="flex gap-2">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                            <span className="min-w-0 flex-1">{children}</span>
                          </li>
                        ),
                      }}
                    >
                      {item.answer}
                    </ReactMarkdown>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default FaqSection;
