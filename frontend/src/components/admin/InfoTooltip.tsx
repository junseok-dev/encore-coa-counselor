import React from 'react';
import { HelpCircle } from 'lucide-react';

interface Props {
  text: string;
  side?: 'top' | 'bottom';
  align?: 'left' | 'center' | 'right';
  width?: string;
}

const InfoTooltip: React.FC<Props> = ({ text, side = 'top', align = 'center', width = 'w-72' }) => {
  const alignClass =
    align === 'left'
      ? 'left-0'
      : align === 'right'
        ? 'right-0'
        : 'left-1/2 -translate-x-1/2';
  const sideClass = side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2';

  return (
    <span className="group relative inline-flex items-center">
      <HelpCircle size={14} className="text-slate-400 transition-colors hover:text-slate-600 cursor-help" />
      <span
        className={`pointer-events-none absolute ${sideClass} ${alignClass} ${width} z-30 rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 whitespace-pre-line`}
      >
        {text}
      </span>
    </span>
  );
};

export default InfoTooltip;