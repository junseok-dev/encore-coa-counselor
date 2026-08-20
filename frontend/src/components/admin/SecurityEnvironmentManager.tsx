import { useState } from 'react';
import { Copy, Eye, EyeOff, Plus, Save, Trash2, X } from 'lucide-react';
import { adminApi } from '../../services/api';
import { SecurityVaultEnvironmentItem } from '../../types';

interface SecurityEnvironmentManagerProps {
  vaultToken: string;
  items: SecurityVaultEnvironmentItem[];
  protectedKeys: string[];
  onItemsChange: (items: SecurityVaultEnvironmentItem[]) => void;
  onNotice: (message: string) => void;
  onExpired: () => void;
}

interface NewEnvironmentItem {
  key: string;
  label: string;
  value: string;
  sensitive: boolean;
}

const EMPTY_NEW_ITEM: NewEnvironmentItem = { key: '', label: '', value: '', sensitive: true };
const INPUT_CLASS = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

function errorDetail(error: unknown, fallback: string) {
  return (error as { response?: { data?: { detail?: string } } }).response?.data?.detail || fallback;
}

function isExpired(error: unknown) {
  return (error as { response?: { status?: number } }).response?.status === 403;
}

export default function SecurityEnvironmentManager({
  vaultToken,
  items,
  protectedKeys,
  onItemsChange,
  onNotice,
  onExpired,
}: SecurityEnvironmentManagerProps) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [savingKey, setSavingKey] = useState('');
  const [deletingKey, setDeletingKey] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newItem, setNewItem] = useState<NewEnvironmentItem>(EMPTY_NEW_ITEM);

  const updateItem = (key: string, changes: Partial<SecurityVaultEnvironmentItem>) => {
    onItemsChange(items.map((item) => item.key === key ? { ...item, ...changes } : item));
  };

  const toggleReveal = (key: string) => {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const copy = async (value: string, label: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      onNotice(`${label}을(를) 복사했습니다.`);
    } catch {
      onNotice('브라우저에서 클립보드 복사를 허용하지 않았습니다.');
    }
  };

  const saveItem = async (item: SecurityVaultEnvironmentItem) => {
    if (!item.value) {
      onNotice('저장할 값을 입력해 주세요. 값을 없애려면 삭제 버튼을 사용해 주세요.');
      return;
    }
    setSavingKey(item.key);
    try {
      const result = await adminApi.updateSecurityVaultEnvironment(vaultToken, item);
      onItemsChange(result.environment);
      onNotice(result.message);
    } catch (error) {
      if (isExpired(error)) onExpired();
      else onNotice(errorDetail(error, '환경설정을 저장하지 못했습니다.'));
    } finally {
      setSavingKey('');
    }
  };

  const deleteItem = async (item: SecurityVaultEnvironmentItem) => {
    const description = item.custom
      ? '항목과 저장된 값이 모두 삭제됩니다.'
      : '저장된 값이 삭제되고 이 항목은 미설정 상태로 남습니다.';
    if (!window.confirm(`${item.label} 환경설정을 삭제할까요?\n${description}`)) return;
    setDeletingKey(item.key);
    try {
      const result = await adminApi.deleteSecurityVaultEnvironment(vaultToken, item.key);
      onItemsChange(result.environment);
      setRevealed((current) => {
        const next = new Set(current);
        next.delete(item.key);
        return next;
      });
      onNotice(result.message);
    } catch (error) {
      if (isExpired(error)) onExpired();
      else onNotice(errorDetail(error, '환경설정을 삭제하지 못했습니다.'));
    } finally {
      setDeletingKey('');
    }
  };

  const createItem = async () => {
    if (!newItem.key || !newItem.label.trim() || !newItem.value) {
      onNotice('환경변수 이름, 표시 이름, 값을 모두 입력해 주세요.');
      return;
    }
    setCreating(true);
    try {
      const result = await adminApi.createSecurityVaultEnvironment(vaultToken, newItem);
      onItemsChange(result.environment);
      setNewItem(EMPTY_NEW_ITEM);
      setCreateOpen(false);
      onNotice(result.message);
    } catch (error) {
      if (isExpired(error)) onExpired();
      else onNotice(errorDetail(error, '새 환경설정을 등록하지 못했습니다.'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-200 bg-slate-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h3 className="font-black text-slate-950">운영 환경설정</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">값을 변경하거나 삭제하고 새로운 환경변수를 등록할 수 있습니다. 일부 설정은 서비스 재시작 후 완전히 반영됩니다.</p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen((current) => !current)}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white"
        >
          {createOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {createOpen ? '등록 취소' : '새 환경설정'}
        </button>
      </div>

      {createOpen && (
        <div className="border-b border-blue-100 bg-blue-50/60 p-5 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="text-xs font-bold text-slate-700">
              환경변수 이름
              <input
                value={newItem.key}
                onChange={(event) => setNewItem((current) => ({ ...current, key: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') }))}
                placeholder="EXTERNAL_SERVICE_URL"
                className={`${INPUT_CLASS} mt-2 font-mono uppercase`}
              />
            </label>
            <label className="text-xs font-bold text-slate-700">
              표시 이름
              <input value={newItem.label} onChange={(event) => setNewItem((current) => ({ ...current, label: event.target.value }))} placeholder="외부 서비스 주소" className={`${INPUT_CLASS} mt-2`} />
            </label>
          </div>
          <label className="mt-4 block text-xs font-bold text-slate-700">
            값
            <input type={newItem.sensitive ? 'password' : 'text'} value={newItem.value} onChange={(event) => setNewItem((current) => ({ ...current, value: event.target.value }))} placeholder="저장할 환경설정 값" className={`${INPUT_CLASS} mt-2 font-mono`} />
          </label>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={newItem.sensitive} onChange={(event) => setNewItem((current) => ({ ...current, sensitive: event.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
              민감한 값으로 마스킹
            </label>
            <button type="button" onClick={() => void createItem()} disabled={creating || !newItem.key || !newItem.label.trim() || !newItem.value} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white disabled:opacity-40">
              <Plus className="h-4 w-4" />{creating ? '등록 중...' : '환경설정 등록'}
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 p-5 lg:grid-cols-2 sm:p-6">
        {items.map((item) => {
          const visible = revealed.has(item.key);
          const busy = savingKey === item.key || deletingKey === item.key;
          return (
            <article key={item.key} className="min-w-0 rounded-2xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {item.custom ? (
                    <input value={item.label} onChange={(event) => updateItem(item.key, { label: event.target.value })} aria-label={`${item.key} 표시 이름`} className="w-full rounded-lg border border-transparent px-2 py-1 font-bold text-slate-900 outline-none hover:border-slate-200 focus:border-blue-400" />
                  ) : (
                    <h4 className="px-2 py-1 font-bold text-slate-900">{item.label}</h4>
                  )}
                  <p className="mt-1 truncate px-2 font-mono text-[11px] text-slate-400">{item.key}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {item.custom && <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700">사용자 등록</span>}
                  <span className={`rounded-full px-2 py-1 text-[10px] font-black ${item.configured ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{item.configured ? '설정됨' : '미설정'}</span>
                </div>
              </div>

              <label className="mt-4 block text-xs font-bold text-slate-600">
                값
                <div className="mt-2 flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <input
                      type={item.sensitive && !visible ? 'password' : 'text'}
                      value={item.value}
                      onChange={(event) => updateItem(item.key, { value: event.target.value, configured: Boolean(event.target.value) })}
                      placeholder="값을 입력해 주세요"
                      className={`${INPUT_CLASS} pr-10 font-mono`}
                    />
                    {item.sensitive && (
                      <button type="button" onClick={() => toggleReveal(item.key)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" title={visible ? '숨기기' : '보기'}>
                        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                  <button type="button" onClick={() => void copy(item.value, item.label)} disabled={!item.value} className="rounded-xl border border-slate-200 p-2.5 text-slate-500 disabled:opacity-30" title="복사"><Copy className="h-4 w-4" /></button>
                </div>
              </label>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {item.custom && (
                  <label className="mr-auto inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
                    <input type="checkbox" checked={item.sensitive} onChange={(event) => updateItem(item.key, { sensitive: event.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                    민감한 값
                  </label>
                )}
                <button type="button" onClick={() => void saveItem(item)} disabled={busy || !item.value || !item.label.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white disabled:opacity-40">
                  <Save className="h-3.5 w-3.5" />{savingKey === item.key ? '저장 중...' : '저장'}
                </button>
                <button type="button" onClick={() => void deleteItem(item)} disabled={busy || (!item.custom && !item.configured)} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 disabled:opacity-30">
                  <Trash2 className="h-3.5 w-3.5" />{deletingKey === item.key ? '삭제 중...' : '삭제'}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="border-t border-slate-100 bg-slate-50 px-5 py-4 text-xs leading-5 text-slate-500 sm:px-6">
        <strong className="text-slate-700">화면에서 관리할 수 없는 보호 키:</strong> {protectedKeys.join(', ')}
      </div>
    </section>
  );
}
