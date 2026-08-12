import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Code2,
  FileClock,
  Loader2,
  MessageSquareText,
  Play,
  X,
} from 'lucide-react';
import { adminApi } from '../../services/api';
import { OperationsAlertDetail, OperationsAttentionItem } from '../../types';

interface OperationsAlertDetailProps {
  item: OperationsAttentionItem;
  onClose: () => void;
  onOpenPrompts: () => void;
  onRefresh: () => Promise<void>;
};

const HISTORY_LABELS: Record<string, string> = {
  checking_started: '확인 시작',
  work_updated: '검증 기준 저장',
  answer_tested: '수정 후 답변 테스트',
  resolved: '처리 완료',
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return new Date(value).toLocaleString('ko-KR');
}

function errorMessage(error: unknown) {
  const responseDetail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return responseDetail || (error instanceof Error ? error.message : '요청을 처리하지 못했습니다.');
}

export default function OperationsAlertDetailPanel({
  item,
  onClose,
  onOpenPrompts,
  onRefresh,
}: OperationsAlertDetailProps) {
  const [detail, setDetail] = useState<OperationsAlertDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(item.status);
  const [testQuestion, setTestQuestion] = useState(item.question || '');
  const [testAnswer, setTestAnswer] = useState('');
  const [testSource, setTestSource] = useState('');
  const [testPassed, setTestPassed] = useState(false);
  const [testedAt, setTestedAt] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const problemStartRef = useRef<HTMLDivElement>(null);

  const hydrate = (next: OperationsAlertDetail) => {
    setDetail(next);
    setStatus(next.alert.status);
    setTestQuestion(next.alert.test_question || item.question || '');
    setTestAnswer(next.alert.test_answer || '');
    setTestSource(next.alert.test_source || '');
    setTestPassed(next.alert.test_passed);
    setTestedAt(next.alert.tested_at);
  };

  const loadDetail = async () => {
    setLoading(true);
    setError('');
    try {
      hydrate(await adminApi.getOperationsAlertDetail(item.alert_id));
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.alert_id]);

  const messages = detail?.messages ?? [];
  const histories = detail?.history ?? [];
  const relatedResolutions = detail?.related_resolutions ?? [];
  const problemStartMessageId = detail?.problem_start_message_id ?? null;
  const problemStartIndex = messages.findIndex((message) => message.id === problemStartMessageId);

  useEffect(() => {
    if (loading || problemStartIndex < 0) return;
    const frame = window.requestAnimationFrame(() => {
      const container = chatScrollRef.current;
      const marker = problemStartRef.current;
      if (container && marker) {
        const markerOffset = marker.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
        container.scrollTop = Math.max(0, markerOffset - 24);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, problemStartIndex]);

  const saveWorkflow = async (nextStatus: 'open' | 'checking' | 'resolved'): Promise<boolean> => {
    setSaving(true);
    setError('');
    try {
      await adminApi.updateOperationsAlertWorkflow(item.alert_id, {
        status: nextStatus,
        test_question: testQuestion,
        test_passed: testPassed,
      });
      await loadDetail();
      await onRefresh();
      return true;
    } catch (requestError) {
      setError(errorMessage(requestError));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveAndOpen = async (open: () => void) => {
    if (status === 'resolved') {
      open();
      return;
    }
    const saved = await saveWorkflow('checking');
    if (saved) open();
  };

  const runAnswerTest = async () => {
    if (!testQuestion.trim()) {
      setError('테스트할 질문을 입력해 주세요.');
      return;
    }
    setTesting(true);
    setError('');
    setTestPassed(false);
    try {
      const result = await adminApi.testOperationsAlertAnswer(item.alert_id, testQuestion.trim());
      setTestAnswer(result.answer);
      setTestSource(result.source);
      setTestedAt(result.tested_at);
      setStatus('checking');
      await onRefresh();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setTesting(false);
    }
  };

  const complete = async () => {
    if (!testAnswer || !testedAt) {
      setError('완료 전에 같은 질문으로 수정 후 답변 테스트를 실행해 주세요.');
      return;
    }
    if (!testPassed) {
      setError('테스트 답변이 원하는 결과인지 체크해 주세요.');
      return;
    }
    await saveWorkflow('resolved');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6">
      <div className="my-3 w-full max-w-6xl overflow-hidden rounded-3xl bg-slate-50 shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-black text-slate-950">긴급 확인 큐 상세</h2>
              <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${status === 'resolved' ? 'bg-emerald-100 text-emerald-700' : status === 'checking' ? 'bg-blue-100 text-blue-700' : 'bg-rose-100 text-rose-700'}`}>
                {status === 'resolved' ? '처리 완료' : status === 'checking' ? '확인 중' : '미확인'}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">전체 대화 맥락과 문제 발생 구간을 확인한 뒤, 같은 질문으로 수정 결과를 검증합니다.</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="닫기"><X className="h-5 w-5" /></button>
        </header>

        {loading ? (
          <div className="flex min-h-96 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-cyan-700" /></div>
        ) : (
          <div className="space-y-5 p-4 sm:p-7">
            {error && <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

            <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 font-black text-slate-900"><MessageSquareText className="h-5 w-5 text-cyan-700" />관련 채팅 전체 기록</h3>
                  <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-rose-700 ring-1 ring-rose-200">문제 발생 구간 강조</span>
                </div>
                <p className="mt-1 break-all font-mono text-[11px] text-slate-400">세션 {item.session_id}</p>
                <div ref={chatScrollRef} className="mt-4 max-h-[60vh] min-h-80 space-y-3 overflow-y-auto overscroll-contain rounded-xl bg-slate-50 p-3 pr-2">
                  {messages.length ? messages.map((message, index) => {
                    const isProblemStart = index === problemStartIndex;
                    const isProblemContext = problemStartIndex >= 0 && index >= problemStartIndex;
                    return (
                    <div key={message.id} ref={isProblemStart ? problemStartRef : undefined}>
                      {isProblemStart && <div className="mb-3 flex items-center gap-2"><span className="h-px flex-1 bg-rose-300" /><span className="rounded-full bg-rose-600 px-3 py-1 text-[10px] font-black text-white">문제 발생 지점</span><span className="h-px flex-1 bg-rose-300" /></div>}
                      <div className={`flex rounded-2xl p-1.5 ${message.role === 'user' ? 'justify-end' : 'justify-start'} ${isProblemContext ? 'bg-rose-50 ring-1 ring-rose-200' : ''}`}>
                        <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? isProblemContext ? 'bg-rose-600 text-white' : 'bg-cyan-700 text-white' : isProblemContext ? 'border border-rose-200 bg-white text-slate-800' : 'border border-slate-200 bg-white text-slate-700'}`}>
                          <p className="whitespace-pre-wrap">{message.content}</p>
                          <p className={`mt-1 text-[10px] ${message.role === 'user' ? 'text-white/75' : isProblemContext ? 'text-rose-500' : 'text-slate-400'}`}>{message.role === 'user' ? '사용자' : `챗봇${message.source ? ` · ${message.source}` : ''}`} · {formatDateTime(message.created_at)}</p>
                        </div>
                      </div>
                    </div>
                    );
                  }) : <p className="py-8 text-center text-sm text-slate-400">저장된 대화가 없습니다.</p>}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="flex items-center gap-2 font-black text-slate-900"><Code2 className="h-5 w-5 text-violet-700" />대처 작업</h3>
                <p className="mt-2 text-xs leading-5 text-slate-500">원인에 따라 답변 프롬프트를 수정하거나 코드를 수정·배포한 뒤 이 화면으로 돌아와 검증하세요.</p>
                <div className="mt-4 space-y-2">
                  <button onClick={() => void saveAndOpen(onOpenPrompts)} disabled={saving} className="flex w-full items-center justify-between rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-bold text-violet-800 hover:bg-violet-100 disabled:opacity-50"><span className="flex items-center gap-2"><Bot className="h-4 w-4" />프롬프트 관리 열기</span><ArrowRight className="h-4 w-4" /></button>
                </div>
                <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">프롬프트나 코드를 수정·배포한 뒤 이 화면으로 돌아와 같은 질문으로 결과를 확인하세요.</div>
              </section>
            </div>

            <section className="rounded-2xl border border-cyan-200 bg-white p-5 shadow-sm">
              <div><h3 className="flex items-center gap-2 font-black text-slate-900"><Bot className="h-5 w-5 text-cyan-700" />수정 후 동일 질문 테스트</h3><p className="mt-1 text-xs text-slate-500">수정·배포가 끝났다면 같은 질문을 실제 챗봇 경로로 다시 실행해 답변을 확인합니다.</p></div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <textarea value={testQuestion} onChange={(event) => { setTestQuestion(event.target.value); setTestAnswer(''); setTestSource(''); setTestedAt(null); setTestPassed(false); }} rows={2} className="min-h-12 flex-1 resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm leading-6 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" />
                <button onClick={() => void runAnswerTest()} disabled={testing || status === 'resolved'} className="inline-flex min-w-48 items-center justify-center gap-2 rounded-xl bg-cyan-700 px-4 py-3 text-sm font-black text-white hover:bg-cyan-800 disabled:opacity-50">{testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}같은 질문으로 테스트</button>
              </div>
              {testAnswer && (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-black text-slate-500">테스트 답변</p><p className="text-[11px] text-slate-400">출처 {testSource || '-'} · {formatDateTime(testedAt)}</p></div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{testAnswer}</p>
                  <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-900">
                    <input type="checkbox" checked={testPassed} onChange={(event) => setTestPassed(event.target.checked)} disabled={status === 'resolved'} className="mt-0.5 h-4 w-4 accent-emerald-600" />
                    <span>이 답변이 원하는 결과와 일치합니다.<span className="mt-0.5 block text-xs font-normal text-emerald-700">답변 내용을 직접 확인하고 문제가 해결됐을 때만 체크해 주세요.</span></span>
                  </label>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="flex items-center gap-2 font-black text-slate-900"><FileClock className="h-5 w-5 text-slate-500" />처리 이력 및 재발 확인</h3>
              <p className="mt-1 text-xs text-slate-500">현재 건의 검증 기록과 과거에 같은 유형으로 완료한 건을 함께 확인합니다.</p>
              {relatedResolutions.length > 0 && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-black text-amber-900">과거 동일 유형 처리 {relatedResolutions.length}건</p>
                  <div className="mt-3 space-y-3">
                    {relatedResolutions.map((related) => (
                      <div key={related.alert_id} className="rounded-xl border border-amber-200 bg-white p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-black text-slate-800">{related.reason}</p><p className="text-[10px] text-slate-400">{related.resolved_by || '관리자'} · {formatDateTime(related.resolved_at)}</p></div>
                        <p className="mt-2 text-xs leading-5 text-slate-600"><b className="text-slate-800">질문</b> {related.test_question || '-'}</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600"><b className="text-slate-800">검증된 답변</b> {related.test_answer || '-'}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-4 space-y-3">
                {histories.length ? histories.map((history) => (
                  <div key={history.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-black text-slate-800">{HISTORY_LABELS[history.action] || history.action}</p><p className="text-[11px] text-slate-400">{history.actor} · {formatDateTime(history.created_at)}</p></div>
                    {history.action === 'resolved' && <p className="mt-3 text-xs leading-5 text-slate-600"><b className="text-slate-800">검증된 답변</b><br />{history.test_answer || '-'}</p>}
                    {history.action === 'answer_tested' && <p className="mt-2 line-clamp-2 text-xs text-slate-500">질문: {history.test_question}<br />답변: {history.test_answer}</p>}
                  </div>
                )) : <p className="rounded-xl bg-slate-50 py-8 text-center text-sm text-slate-400">아직 저장된 처리 이력이 없습니다.</p>}
              </div>
            </section>

            <footer className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">완료 시 문제 유형·원래 대화·테스트 질문과 답변·확인 관리자와 시간이 기록됩니다.</p>
              {status === 'resolved' ? (
                <button onClick={() => void saveWorkflow('open')} disabled={saving} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-700 hover:bg-slate-50">다시 열기</button>
              ) : (
                <button onClick={() => void complete()} disabled={saving || !testPassed} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}검증 완료 및 처리 완료</button>
              )}
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
