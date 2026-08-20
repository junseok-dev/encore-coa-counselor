import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, Download, Headphones, MessageCircle, ShieldAlert, UserRound } from 'lucide-react';
import { adminApi, getAdminToken } from '../services/api';
import { AdminSessionDetail, OperationsAttentionItem } from '../types';
import { formatKoreaDateTime, formatKoreaTime, koreaDateStamp } from '../utils/dateTime';

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

export default function AdminSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [detail, setDetail] = useState<AdminSessionDetail | null>(null);
  const [signals, setSignals] = useState<OperationsAttentionItem[]>([]);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [reviewingMessageId, setReviewingMessageId] = useState<number | null>(null);
  const [reviewNotice, setReviewNotice] = useState('');

  const returnToAdmin = () => {
    const navigationState = location.state as { fromAdmin?: boolean } | null;
    if (navigationState?.fromAdmin) {
      navigate(-1);
      return;
    }
    navigate('/admin?tab=chats');
  };

  const handleExportSession = async () => {
    if (!sessionId) return;
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
    if (!sessionId || !question) return;
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

  useEffect(() => {
    if (!getAdminToken()) {
      navigate('/admin?tab=chats');
      return;
    }
    if (!sessionId) return;
    adminApi.getSessionDetail(sessionId).then(setDetail).catch(() => setError('세션 정보를 불러오지 못했습니다.'));
    adminApi.getOperationsDashboard(30).then((data) => setSignals(data.attention.filter((item) => item.session_id === sessionId))).catch(() => undefined);
  }, [sessionId, navigate]);

  if (error) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100"><p className="rounded-2xl bg-rose-50 px-5 py-4 text-rose-700">{error}</p></div>;
  }

  if (!detail) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100"><p className="animate-pulse text-sm text-slate-400">대화 내용을 불러오는 중...</p></div>;
  }

  const { session, messages } = detail;

  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <header className="border-b border-slate-800 bg-[#08111f] text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <button onClick={returnToAdmin} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-300 hover:text-white">
            <ArrowLeft className="h-4 w-4" /> 운영 콘솔
          </button>
          <span className="font-mono text-xs text-slate-500">{session.id}</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-7 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">Conversation detail</p>
            <h1 className="mt-2 text-2xl font-bold text-slate-950">채팅 세션 상세</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-slate-500">메시지 {messages.length}개</p>
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

        {exportError && <p className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{exportError}</p>}
        {reviewNotice && <p className="mt-3 rounded-xl bg-cyan-50 px-4 py-3 text-sm text-cyan-800">{reviewNotice}</p>}

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700"><UserRound className="h-5 w-5" /></span>
            <div><p className="text-xs text-slate-400">방문자</p><p className="mt-0.5 font-semibold text-slate-900">{session.user_name ?? '익명 방문자'}</p></div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><Calendar className="h-5 w-5" /></span>
            <div><p className="text-xs text-slate-400">시작 시각</p><p className="mt-0.5 text-sm font-semibold text-slate-900">{formatKoreaDateTime(session.created_at)}</p></div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><MessageCircle className="h-5 w-5" /></span>
            <div><p className="text-xs text-slate-400">누적 메시지</p><p className="mt-0.5 font-semibold text-slate-900">{session.message_count}개</p></div>
          </div>
        </div>

        {signals.length > 0 && (
          <section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
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

        <section className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-bold text-slate-950">전체 대화</h2>
            <p className="mt-1 text-xs text-slate-500">응답 출처와 상담·안전 전환 여부를 함께 표시합니다.</p>
          </div>
          <div className="space-y-5 bg-slate-50/60 p-5 sm:p-7">
            {messages.map((msg, index) => {
              const isUser = msg.role === 'user';
              const badge = msg.source ? SOURCE_BADGE[msg.source] : null;
              const relatedQuestion = isUser
                ? ''
                : [...messages.slice(0, index)].reverse().find((candidate) => candidate.role === 'user')?.content || '';
              return (
                <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div className={`flex max-w-[88%] flex-col gap-1.5 sm:max-w-[76%] ${isUser ? 'items-end' : 'items-start'}`}>
                    {badge && !isUser && <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${badge.className}`}>{badge.label}</span>}
                    <div className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${isUser ? 'rounded-br-md bg-slate-950 text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-800 shadow-sm'}`}>
                      {msg.content}
                    </div>
                    <span className="text-[11px] text-slate-400">{formatKoreaTime(msg.created_at)}</span>
                    {!isUser && relatedQuestion && (
                      <button
                        type="button"
                        onClick={() => void handleCreateReview(msg.id, relatedQuestion)}
                        disabled={reviewingMessageId === msg.id}
                        className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                      >{reviewingMessageId === msg.id ? '등록 중...' : '이 답변 개선 검토'}</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
