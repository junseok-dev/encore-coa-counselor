import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  Download,
  EyeOff,
  Headphones,
  MessageCircle,
  ShieldAlert,
  UserRound,
  X,
} from 'lucide-react';
import { adminApi } from '../../services/api';
import { AdminSessionDetail, OperationsAttentionItem } from '../../types';
import { formatKoreaDateTime, formatKoreaTime, koreaDateStamp } from '../../utils/dateTime';

interface AdminSessionDrawerProps {
  sessionId: string;
  onClose: () => void;
  onMarkedInternal?: () => void;
}

const SOURCE_BADGE: Record<string, { label: string; className: string }> = {
  faq: { label: 'FAQ', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  document: { label: '문서', className: 'bg-blue-50 text-blue-700 ring-blue-200' },
  ai: { label: 'AI', className: 'bg-violet-50 text-violet-700 ring-violet-200' },
  fallback: { label: '대체 응답', className: 'bg-slate-100 text-slate-700 ring-slate-200' },
  guardrail: { label: '안전 응답', className: 'bg-amber-50 text-amber-800 ring-amber-200' },
  handoff: { label: '상담 연결', className: 'bg-rose-50 text-rose-700 ring-rose-200' },
};

const SIGNAL_LABEL: Record<OperationsAttentionItem['type'], string> = {
  handoff: '상담 연결',
  cancel: '취소 요청',
  refund: '환불 요청',
  safety: '안전 확인',
  error: '처리 오류',
  quality: '직접 등록',
  intent_deviation: '의도 이탈',
  context_mismatch: '문맥 불일치',
  user_complaint: '답변 불만',
  repeated_failure: '반복 실패',
  safety_failure: '안전 처리 실패',
};

export default function AdminSessionDrawer({ sessionId, onClose, onMarkedInternal }: AdminSessionDrawerProps) {
  const [visible, setVisible] = useState(false);
  const [detail, setDetail] = useState<AdminSessionDetail | null>(null);
  const [signals, setSignals] = useState<OperationsAttentionItem[]>([]);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [reviewingMessageId, setReviewingMessageId] = useState<number | null>(null);
  const [reviewNotice, setReviewNotice] = useState('');
  const [excludingFromAnalytics, setExcludingFromAnalytics] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const requestClose = useCallback(() => {
    setVisible(false);
    closeTimerRef.current = window.setTimeout(onClose, 250);
  }, [onClose]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, [requestClose]);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setSignals([]);
    setError('');
    setExportError('');
    setReviewNotice('');
    Promise.all([
      adminApi.getSessionDetail(sessionId),
      adminApi.getOperationsDashboard(30).catch(() => null),
    ]).then(([sessionDetail, operations]) => {
      if (!active) return;
      setDetail(sessionDetail);
      setSignals(operations?.attention.filter((item) => item.session_id === sessionId) ?? []);
    }).catch(() => {
      if (active) setError('세션 정보를 불러오지 못했습니다.');
    });
    return () => { active = false; };
  }, [sessionId]);

  const handleExportSession = async () => {
    setExporting(true);
    setExportError('');
    try {
      const blob = await adminApi.exportSession(sessionId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeSessionId = sessionId.replace(/[^A-Za-z0-9._-]/g, '_') || 'session';
      link.href = url;
      link.download = `chat_session_${safeSessionId}_${koreaDateStamp()}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setExportError('세션 엑셀 다운로드에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setExporting(false);
    }
  };

  const handleCreateReview = async (messageId: number, question: string) => {
    if (!question) return;
    setReviewingMessageId(messageId);
    setReviewNotice('');
    try {
      const result = await adminApi.createSessionOperationsReview(sessionId, question);
      setReviewNotice(result.message);
    } catch {
      setReviewNotice('개선 검토 등록에 실패했습니다. 대화 로그를 확인해 주세요.');
    } finally {
      setReviewingMessageId(null);
    }
  };

  const handleExcludeFromAnalytics = async () => {
    if (!window.confirm('이 대화를 내부 테스트로 분류하고 모든 운영 통계와 개선 검토에서 제외할까요?')) return;
    setExcludingFromAnalytics(true);
    setReviewNotice('');
    try {
      await adminApi.markInternalSessions([sessionId]);
      setReviewNotice('내부 테스트 대화로 분리했습니다. 운영 통계에는 더 이상 포함되지 않습니다.');
      onMarkedInternal?.();
    } catch {
      setReviewNotice('통계 제외 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setExcludingFromAnalytics(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-[80] flex justify-end transition ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      <button
        type="button"
        aria-label="상담 세션 상세 닫기"
        onClick={requestClose}
        className={`absolute inset-0 bg-slate-950/45 backdrop-blur-[1px] transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-drawer-title"
        className={`relative flex h-full w-full max-w-2xl transform flex-col bg-[#f5f7fb] shadow-2xl transition-transform duration-300 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-700">Conversation detail</p>
            <h2 id="session-drawer-title" className="mt-1 text-xl font-bold text-slate-950">상담 세션 상세</h2>
            <p className="mt-1 truncate font-mono text-[11px] text-slate-400">{sessionId}</p>
          </div>
          <button type="button" onClick={requestClose} aria-label="닫기" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {!detail && !error && (
            <div className="flex min-h-[360px] items-center justify-center rounded-3xl bg-white">
              <p className="animate-pulse text-sm text-slate-400">대화 내용을 불러오는 중...</p>
            </div>
          )}

          {error && (
            <div className="flex min-h-[360px] items-center justify-center rounded-3xl bg-white p-6">
              <div className="text-center">
                <AlertCircle className="mx-auto h-8 w-8 text-rose-500" />
                <p className="mt-3 text-sm font-medium text-rose-700">{error}</p>
                <button type="button" onClick={requestClose} className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">닫기</button>
              </div>
            </div>
          )}

          {detail && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-500">메시지 {detail.messages.length}개</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleExcludeFromAnalytics()}
                    disabled={excludingFromAnalytics}
                    className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                  >
                    <EyeOff className="h-4 w-4" />
                    {excludingFromAnalytics ? '분리 중...' : '내부 테스트로 제외'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExportSession()}
                    disabled={exporting}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" />
                    {exporting ? '내보내는 중...' : '이 세션 엑셀 다운로드'}
                  </button>
                </div>
              </div>

              {exportError && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{exportError}</p>}
              {reviewNotice && <p className="rounded-xl bg-cyan-50 px-4 py-3 text-sm text-cyan-800">{reviewNotice}</p>}

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700"><UserRound className="h-4 w-4" /></span>
                  <div className="min-w-0"><p className="text-xs text-slate-400">방문자</p><p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{detail.session.user_name ?? '익명 방문자'}</p></div>
                </div>
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><Calendar className="h-4 w-4" /></span>
                  <div className="min-w-0"><p className="text-xs text-slate-400">시작 시각</p><p className="mt-0.5 text-xs font-semibold text-slate-900">{formatKoreaDateTime(detail.session.created_at)}</p></div>
                </div>
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><MessageCircle className="h-4 w-4" /></span>
                  <div><p className="text-xs text-slate-400">누적 메시지</p><p className="mt-0.5 text-sm font-semibold text-slate-900">{detail.session.message_count}개</p></div>
                </div>
              </div>

              {signals.length > 0 && (
                <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-amber-900"><ShieldAlert className="h-4 w-4" /> 이 세션의 운영 신호</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {signals.map((signal) => (
                      <span key={`${signal.id}-${signal.type}`} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-amber-200">
                        {signal.type === 'handoff' && <Headphones className="h-3.5 w-3.5 text-violet-600" />}
                        {SIGNAL_LABEL[signal.type]} · {signal.reason}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h3 className="font-bold text-slate-950">전체 대화</h3>
                  <p className="mt-1 text-xs text-slate-500">응답 출처와 상담·안전 전환 여부를 함께 표시합니다.</p>
                </div>
                <div className="space-y-5 bg-slate-50/60 p-4 sm:p-5">
                  {detail.messages.map((message, index) => {
                    const isUser = message.role === 'user';
                    const badge = message.source ? SOURCE_BADGE[message.source] : null;
                    const relatedQuestion = isUser
                      ? ''
                      : [...detail.messages.slice(0, index)].reverse().find((candidate) => candidate.role === 'user')?.content || '';
                    return (
                      <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                        <div className={`flex max-w-[90%] flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
                          {badge && !isUser && <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${badge.className}`}>{badge.label}</span>}
                          <div className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${isUser ? 'rounded-br-md bg-slate-950 text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-800 shadow-sm'}`}>
                            {message.content}
                          </div>
                          <span className="text-[11px] text-slate-400">{formatKoreaTime(message.created_at)}</span>
                          {!isUser && relatedQuestion && (
                            <button
                              type="button"
                              onClick={() => void handleCreateReview(message.id, relatedQuestion)}
                              disabled={reviewingMessageId === message.id}
                              className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                            >{reviewingMessageId === message.id ? '등록 중...' : '이 답변 개선 검토'}</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
