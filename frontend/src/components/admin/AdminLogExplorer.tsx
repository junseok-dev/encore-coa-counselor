import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  Clock3,
  FileText,
  Search,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { AdminDocument, AdminFaq, AuditLog, ProcessingLog, PromptConfig } from '../../types';

type ProcessingFilter = 'all' | 'issue' | 'waiting' | 'complete';
type AuditCategory = 'all' | 'content' | 'operations' | 'cost' | 'security' | 'system';

interface AdminLogExplorerProps {
  processingLogs: ProcessingLog[];
  auditLogs: AuditLog[];
  documents: AdminDocument[];
  faqs: AdminFaq[];
  prompts: PromptConfig[];
  onOpenDocument: (documentId: number) => void;
  onOpenAuditTarget: (log: AuditLog) => void;
}

interface ProcessingGroup {
  key: string;
  documentId: number | null;
  title: string;
  subtitle: string;
  logs: ProcessingLog[];
  latestAt: number;
  hasIssue: boolean;
}

const INPUT_CLASS = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100';

function formatDate(value: string): string {
  return new Date(value).toLocaleString('ko-KR');
}

function processingState(log: ProcessingLog): Exclude<ProcessingFilter, 'all'> | 'neutral' {
  const source = `${log.status} ${log.message} ${log.detail ?? ''}`.toLowerCase();
  if (/failed|error|rejected|warning|fail|오류|실패|경고|반려/.test(source)) return 'issue';
  if (/approved|ready|complete|success|restored|완료|승인|성공|복구/.test(source)) return 'complete';
  if (/uploaded|parsing|embedding|review|pending|running|대기|시작|처리/.test(source)) return 'waiting';
  return 'neutral';
}

function processingLabel(status: string): string {
  const labels: Record<string, string> = {
    uploaded: '업로드 완료',
    parsing: '문서 변환',
    embedding: '검색 데이터 생성',
    review: '검토 대기',
    approved: '승인 완료',
    ready: '운영 반영 완료',
    failed: '처리 실패',
    rejected: '검토 반려',
    deleted: '삭제됨',
    restored: '복구됨',
  };
  return labels[status.toLowerCase()] ?? status.replace(/_/g, ' ');
}

function logTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    document: '일반 문서',
    faq_import: 'FAQ 문서',
    reindex: '검색 인덱스',
  };
  return labels[type] ?? type.replace(/_/g, ' ');
}

function auditCategory(log: AuditLog): Exclude<AuditCategory, 'all'> {
  const source = `${log.action} ${log.target_type}`;
  if (/security|password|permission|superadmin|encryption|admin_user/.test(source)) return 'security';
  if (/operations|question_categories/.test(source)) return 'operations';
  if (/cost|billing/.test(source)) return 'cost';
  if (/document|faq|prompt|reindex/.test(source)) return 'content';
  return 'system';
}

function categoryLabel(category: Exclude<AuditCategory, 'all'>): string {
  return {
    content: '콘텐츠',
    operations: '운영',
    cost: '비용',
    security: '보안·권한',
    system: '시스템',
  }[category];
}

function auditTargetName(
  log: AuditLog,
  documents: AdminDocument[],
  faqs: AdminFaq[],
  prompts: PromptConfig[],
): string {
  if ((log.action === 'model_changed' || log.action === 'embedding_model_changed') && log.detail) return log.detail;
  if (log.target_type === 'document') {
    const document = documents.find((item) => String(item.id) === log.target_id);
    return document ? `${document.original_filename} v${document.version}` : `문서 #${log.target_id ?? '-'}`;
  }
  if (log.target_type === 'faq') {
    const faq = faqs.find((item) => item.id === log.target_id);
    return faq ? `FAQ “${faq.question}”` : `FAQ ${log.target_id ?? ''}`.trim();
  }
  if (log.target_type === 'prompt') {
    const prompt = prompts.find((item) => item.prompt_key === log.target_id);
    return prompt?.label ?? `프롬프트 ${log.target_id ?? ''}`.trim();
  }
  if (log.target_type === 'operations_alert') return `개선 항목 #${log.target_id ?? '-'}`;
  if (log.target_type === 'openai_monthly_cost') return `${log.target_id ?? ''} OpenAI 비용`.trim();
  if (log.target_type === 'custom_table') return `업무 데이터 #${log.target_id ?? '-'}`;
  if (log.target_type === 'admin_user') return `관리자 ${log.target_id ?? ''}`.trim();
  if (log.target_type === 'security_vault' && /environment/.test(log.action)) return `${log.target_id ?? ''} 환경설정`.trim();
  if (log.target_type === 'security_vault') return '보안 정보 보관함';
  if (log.target_type === 'system') return log.target_id && log.target_id !== 'global' ? log.target_id : '시스템';
  return `${log.target_type.replace(/_/g, ' ')} ${log.target_id ?? ''}`.trim();
}

function auditSentence(action: string, target: string): string {
  const sentences: Record<string, string> = {
    document_uploaded: `${target}을 업로드했습니다.`,
    faq_document_uploaded: `${target}을 FAQ 문서로 업로드했습니다.`,
    document_artifacts_updated: `${target}의 변환 결과를 수정했습니다.`,
    document_approved: `${target}을 승인하고 운영에 반영했습니다.`,
    document_rejected: `${target}을 반려했습니다.`,
    document_deleted: `${target}을 삭제했습니다.`,
    document_restored: `${target}을 복구했습니다.`,
    faq_saved: `${target}을 저장했습니다.`,
    faq_deleted: `${target}을 삭제했습니다.`,
    prompt_created: `${target}을 만들었습니다.`,
    prompt_updated: `${target}을 수정했습니다.`,
    prompt_deleted: `${target}을 삭제했습니다.`,
    prompt_rolled_back: `${target}을 이전 버전으로 복구했습니다.`,
    reindex: '검색 인덱스를 다시 만들었습니다.',
    reindex_skipped: '변경 사항이 없어 검색 인덱스 재생성을 건너뛰었습니다.',
    operations_review_created: `${target}을 개선 검토에 등록했습니다.`,
    operations_review_reopened: `${target}을 다시 검토하도록 열었습니다.`,
    operations_review_already_exists: `${target}의 기존 검토 항목을 확인했습니다.`,
    operations_ai_assisted: `${target}에서 AI 원인 분석을 실행했습니다.`,
    operations_prompt_draft_saved: `${target}의 프롬프트 초안을 저장했습니다.`,
    operations_prompt_previewed: `${target}의 변경 전·후 답변을 비교했습니다.`,
    operations_prompt_published: `${target}의 개선 프롬프트를 운영에 반영했습니다.`,
    operations_prompt_rolled_back: `${target}의 프롬프트를 이전 버전으로 복구했습니다.`,
    operations_alert_answer_kept: `${target}의 기존 답변을 유지하기로 했습니다.`,
    operations_alert_updated: `${target}의 처리 상태를 변경했습니다.`,
    question_categories_reclassified: '질문 유형을 다시 분류했습니다.',
    openai_cost_created: `${target}을 등록했습니다.`,
    openai_cost_updated: `${target}을 수정했습니다.`,
    openai_cost_deleted: `${target}을 삭제했습니다.`,
    billing_cost_imported: 'AWS 비용 파일을 가져왔습니다.',
    data_table_created: `${target} 테이블을 만들었습니다.`,
    data_table_deleted: `${target} 테이블을 삭제했습니다.`,
    model_changed: `답변 모델을 ${target}(으)로 변경했습니다.`,
    embedding_model_changed: `임베딩 모델을 ${target}(으)로 변경했습니다.`,
    security_vault_configured: '보안 정보 보관함을 설정했습니다.',
    security_vault_unlock_failed: '보안 정보 보관함 잠금 해제에 실패했습니다.',
    security_vault_unlocked: '보안 정보 보관함 잠금을 해제했습니다.',
    security_vault_extended: '보안 정보 자동 잠금 시간을 연장했습니다.',
    security_vault_password_reset: '보안 정보 보관 비밀번호를 재설정했습니다.',
    security_vault_viewed: '보안 정보를 조회했습니다.',
    security_vault_item_saved: '보안 정보를 수정했습니다.',
    security_vault_environment_created: `${target}을 등록했습니다.`,
    security_vault_environment_updated: `${target}을 수정했습니다.`,
    security_vault_environment_deleted: `${target}을 삭제했습니다.`,
    password_changed: '관리자 비밀번호를 변경했습니다.',
    superadmin_changed: '최상위 관리자 계정을 변경했습니다.',
    permission_added: `${target}에게 관리자 권한을 부여했습니다.`,
    permission_removed: `${target}의 관리자 권한을 제거했습니다.`,
    conversation_encryption_migrated: '기존 대화 데이터를 암호화했습니다.',
  };
  return sentences[action] ?? `${target}에서 ‘${action.replace(/_/g, ' ')}’ 작업을 수행했습니다.`;
}

function auditTargetButtonLabel(log: AuditLog): string | null {
  if (log.target_type === 'document') return '문서 보기';
  if (log.target_type === 'faq') return 'FAQ 보기';
  if (log.target_type === 'prompt') return '프롬프트 보기';
  if (log.target_type === 'operations_alert') return '개선 항목 보기';
  if (/cost|billing/.test(log.target_type)) return '비용 보기';
  if (log.target_type === 'custom_table') return '데이터 보기';
  if (log.target_type === 'admin_user') return '권한 보기';
  if (log.target_type === 'security_vault') return '보안 정보 보기';
  if (log.target_type === 'system' && /model|embedding/.test(log.action)) return '설정 보기';
  return null;
}

export default function AdminLogExplorer({
  processingLogs,
  auditLogs,
  documents,
  faqs,
  prompts,
  onOpenDocument,
  onOpenAuditTarget,
}: AdminLogExplorerProps) {
  const [processingQuery, setProcessingQuery] = useState('');
  const [processingFilter, setProcessingFilter] = useState<ProcessingFilter>('all');
  const [processingType, setProcessingType] = useState('all');
  const [auditQuery, setAuditQuery] = useState('');
  const [auditActor, setAuditActor] = useState('all');
  const [auditCategoryFilter, setAuditCategoryFilter] = useState<AuditCategory>('all');

  const documentMap = useMemo(() => new Map(documents.map((document) => [document.id, document])), [documents]);
  const processingTypes = useMemo(() => [...new Set(processingLogs.map((log) => log.log_type))].sort(), [processingLogs]);
  const auditActors = useMemo(() => [...new Set(auditLogs.map((log) => log.actor))].sort(), [auditLogs]);

  const processingCounts = useMemo(() => ({
    issue: processingLogs.filter((log) => processingState(log) === 'issue').length,
    waiting: processingLogs.filter((log) => processingState(log) === 'waiting').length,
    complete: processingLogs.filter((log) => processingState(log) === 'complete').length,
  }), [processingLogs]);

  const processingGroups = useMemo(() => {
    const query = processingQuery.trim().toLowerCase();
    const filtered = processingLogs.filter((log) => {
      const document = log.document_id ? documentMap.get(log.document_id) : null;
      const matchesQuery = !query || [
        log.message,
        log.detail,
        log.status,
        log.log_type,
        log.document_id,
        document?.original_filename,
        document?.logical_name,
      ].some((value) => String(value ?? '').toLowerCase().includes(query));
      const state = processingState(log);
      return matchesQuery
        && (processingFilter === 'all' || state === processingFilter)
        && (processingType === 'all' || log.log_type === processingType);
    });

    const grouped = new Map<string, ProcessingLog[]>();
    filtered.forEach((log) => {
      const key = log.document_id ? `document-${log.document_id}` : 'unlinked';
      grouped.set(key, [...(grouped.get(key) ?? []), log]);
    });

    return [...grouped.entries()].map(([key, logs]): ProcessingGroup => {
      const documentId = logs[0]?.document_id ?? null;
      const document = documentId ? documentMap.get(documentId) : null;
      const orderedLogs = [...logs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      return {
        key,
        documentId,
        title: document?.original_filename ?? (documentId ? `삭제되었거나 찾을 수 없는 문서 #${documentId}` : '문서와 연결되지 않은 처리'),
        subtitle: document ? `${document.logical_name} · v${document.version}` : `${logs.length}개의 시스템 처리 기록`,
        logs: orderedLogs,
        latestAt: Math.max(...logs.map((log) => new Date(log.created_at).getTime())),
        hasIssue: logs.some((log) => processingState(log) === 'issue'),
      };
    }).sort((a, b) => Number(b.hasIssue) - Number(a.hasIssue) || b.latestAt - a.latestAt);
  }, [documentMap, processingFilter, processingLogs, processingQuery, processingType]);

  const filteredAuditLogs = useMemo(() => {
    const query = auditQuery.trim().toLowerCase();
    return auditLogs.filter((log) => {
      const target = auditTargetName(log, documents, faqs, prompts);
      const sentence = auditSentence(log.action, target);
      return (auditActor === 'all' || log.actor === auditActor)
        && (auditCategoryFilter === 'all' || auditCategory(log) === auditCategoryFilter)
        && (!query || [log.actor, log.action, log.target_type, log.target_id, log.detail, target, sentence]
          .some((value) => String(value ?? '').toLowerCase().includes(query)));
    });
  }, [auditActor, auditCategoryFilter, auditLogs, auditQuery, documents, faqs, prompts]);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)] xl:items-start">
      <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-6 xl:flex xl:h-[calc(100vh-13rem)] xl:min-h-[640px] xl:flex-col">
        <div className="flex flex-col gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-cyan-700" />
              <h2 className="text-lg font-semibold text-slate-900">문서 처리 흐름</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">문서별로 업로드부터 운영 반영까지의 흐름을 확인합니다. 문제가 있는 문서가 먼저 표시됩니다.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <button type="button" onClick={() => setProcessingFilter('issue')} className="rounded-xl bg-rose-50 px-3 py-2 text-rose-700">
              <strong className="block text-lg">{processingCounts.issue}</strong>문제
            </button>
            <button type="button" onClick={() => setProcessingFilter('waiting')} className="rounded-xl bg-amber-50 px-3 py-2 text-amber-700">
              <strong className="block text-lg">{processingCounts.waiting}</strong>진행·대기
            </button>
            <button type="button" onClick={() => setProcessingFilter('complete')} className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-700">
              <strong className="block text-lg">{processingCounts.complete}</strong>완료
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input value={processingQuery} onChange={(event) => setProcessingQuery(event.target.value)} placeholder="문서명, 문서 ID, 처리 내용, 오류 메시지 검색" className={`${INPUT_CLASS} pl-9`} />
          </label>
          <select value={processingType} onChange={(event) => setProcessingType(event.target.value)} className={INPUT_CLASS}>
            <option value="all">모든 처리 유형</option>
            {processingTypes.map((type) => <option key={type} value={type}>{logTypeLabel(type)}</option>)}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {([
            ['all', '전체'],
            ['issue', '문제만'],
            ['waiting', '진행·대기'],
            ['complete', '완료'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setProcessingFilter(value)} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${processingFilter === value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {label}
            </button>
          ))}
          <span className="ml-auto self-center text-xs text-slate-500">문서 {processingGroups.length}개</span>
        </div>

        <div className="mt-4 max-h-[440px] space-y-3 overflow-y-auto pr-1 sm:max-h-[560px] xl:min-h-0 xl:flex-1 xl:max-h-none">
          {processingGroups.length === 0 && (
            <div className="rounded-2xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">조건에 맞는 처리 기록이 없습니다.</div>
          )}
          {processingGroups.map((group) => (
            <details key={group.key} open={group.hasIssue} className={`group rounded-2xl border ${group.hasIssue ? 'border-rose-200 bg-rose-50/30' : 'border-slate-200'}`}>
              <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${group.hasIssue ? 'bg-rose-100 text-rose-700' : 'bg-cyan-50 text-cyan-700'}`}>
                  {group.hasIssue ? <AlertTriangle className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">{group.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{group.subtitle} · 단계 {group.logs.length}개 · 최근 {formatDate(new Date(group.latestAt).toISOString())}</span>
                </span>
                {group.hasIssue && <span className="hidden rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700 sm:inline">확인 필요</span>}
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
              </summary>
              <div className="border-t border-slate-200/80 px-4 pb-4 pt-3">
                <ol className="relative ml-2 border-l border-slate-200 pl-5">
                  {group.logs.map((log) => {
                    const state = processingState(log);
                    return (
                      <li key={log.id} className="relative pb-4 last:pb-1">
                        <span className={`absolute -left-[29px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white ${state === 'issue' ? 'bg-rose-500' : state === 'complete' ? 'bg-emerald-500' : state === 'waiting' ? 'bg-amber-400' : 'bg-slate-400'}`} />
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-semibold text-slate-800">{processingLabel(log.status)}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{logTypeLabel(log.log_type)}</span>
                          <span className="text-xs text-slate-400">{formatDate(log.created_at)}</span>
                        </div>
                        <p className="mt-1 text-sm text-slate-700">{log.message}</p>
                        {log.detail && (
                          <div className={`mt-2 rounded-xl px-3 py-2 text-xs leading-5 ${state === 'issue' ? 'bg-rose-100/70 text-rose-800' : 'bg-amber-50 text-amber-800'}`}>
                            <strong className="mr-1">상세:</strong>{log.detail}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
                {group.documentId && documentMap.has(group.documentId) && (
                  <button type="button" onClick={() => onOpenDocument(group.documentId!)} className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-700">
                    문서 확인 <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-6 xl:flex xl:h-[calc(100vh-13rem)] xl:min-h-[640px] xl:flex-col">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><ShieldCheck className="h-5 w-5" /></span>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">관리자 활동 내역</h2>
            <p className="mt-1 text-sm text-slate-500">누가 무엇을 변경했는지 읽기 쉬운 문장으로 확인하고, 관련 관리 화면으로 이동합니다.</p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input value={auditQuery} onChange={(event) => setAuditQuery(event.target.value)} placeholder="관리자, 작업, 대상 이름 또는 상세 내용 검색" className={`${INPUT_CLASS} pl-9`} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <select value={auditActor} onChange={(event) => setAuditActor(event.target.value)} className={INPUT_CLASS}>
              <option value="all">모든 관리자</option>
              {auditActors.map((actor) => <option key={actor} value={actor}>{actor}</option>)}
            </select>
            <select value={auditCategoryFilter} onChange={(event) => setAuditCategoryFilter(event.target.value as AuditCategory)} className={INPUT_CLASS}>
              <option value="all">모든 작업 영역</option>
              <option value="content">콘텐츠</option>
              <option value="operations">운영</option>
              <option value="cost">비용</option>
              <option value="security">보안·권한</option>
              <option value="system">시스템</option>
            </select>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <span>최신 활동순</span>
          <span>{filteredAuditLogs.length}건</span>
        </div>

        <div className="mt-3 max-h-[440px] overflow-y-auto rounded-2xl border border-slate-200 sm:max-h-[560px] xl:min-h-0 xl:flex-1 xl:max-h-none">
          {filteredAuditLogs.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-slate-500">조건에 맞는 활동 기록이 없습니다.</div>
          )}
          <ol className="divide-y divide-slate-100">
            {filteredAuditLogs.map((log) => {
              const target = auditTargetName(log, documents, faqs, prompts);
              const category = auditCategory(log);
              const buttonLabel = auditTargetButtonLabel(log);
              const isRisky = /deleted|removed|failed|password_reset|password_changed/.test(log.action);
              return (
                <li key={log.id} className="p-4 sm:p-5">
                  <div className="flex gap-3">
                    <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${isRisky ? 'bg-rose-50 text-rose-700' : 'bg-violet-50 text-violet-700'}`}>
                      {isRisky ? <AlertTriangle className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-sm leading-6 text-slate-800"><strong>{log.actor}</strong>님이 {auditSentence(log.action, target)}</p>
                        <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-slate-400"><Clock3 className="h-3.5 w-3.5" />{formatDate(log.created_at)}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">{categoryLabel(category)}</span>
                        <span className="font-mono text-[11px] text-slate-400">{log.action}</span>
                      </div>
                      {log.detail && (
                        <details className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                          <summary className="cursor-pointer font-medium text-slate-600">세부 기록 보기</summary>
                          <p className="mt-2 break-words leading-5">{log.detail}</p>
                        </details>
                      )}
                      {buttonLabel && (
                        <button type="button" onClick={() => onOpenAuditTarget(log)} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-cyan-700 hover:text-cyan-900">
                          {buttonLabel} <ArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    </div>
  );
}
