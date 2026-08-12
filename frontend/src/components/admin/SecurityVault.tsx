import { useEffect, useMemo, useState } from 'react';
import { Clock3, Copy, ExternalLink, Eye, EyeOff, KeyRound, Lock, Save, ShieldCheck } from 'lucide-react';
import { adminApi } from '../../services/api';
import { SecurityVaultCredential, SecurityVaultData, SecurityVaultStatus } from '../../types';

function errorDetail(error: unknown, fallback: string) {
  return (error as { response?: { data?: { detail?: string } } }).response?.data?.detail || fallback;
}

function isStrongVaultPassword(value: string) {
  return value.length >= 8 && /[^A-Za-z0-9가-힣\s]/.test(value);
}

export default function SecurityVault() {
  const [status, setStatus] = useState<SecurityVaultStatus | null>(null);
  const [data, setData] = useState<SecurityVaultData | null>(null);
  const [vaultToken, setVaultToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [savingKey, setSavingKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [extending, setExtending] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState('');

  const loadStatus = async () => {
    try {
      setStatus(await adminApi.getSecurityVaultStatus());
    } catch {
      setNotice('보안 정보 설정 상태를 불러오지 못했습니다.');
    }
  };

  useEffect(() => { void loadStatus(); }, []);

  useEffect(() => {
    if (!expiresAt) return;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) lockVault('보안 정보 열람 시간이 만료되어 자동으로 잠겼습니다.');
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  const lockVault = (message = '보안 정보를 잠갔습니다.') => {
    setVaultToken('');
    setData(null);
    setExpiresAt(null);
    setSecondsLeft(0);
    setPassword('');
    setConfirmPassword('');
    setResetOpen(false);
    setNewPassword('');
    setNewPasswordConfirm('');
    setRevealed(new Set());
    setNotice(message);
  };

  const openVault = async (token: string, expiresInSeconds: number) => {
    const result = await adminApi.getSecurityVaultData(token);
    setVaultToken(token);
    setData(result);
    setExpiresAt(Date.now() + expiresInSeconds * 1000);
    setPassword('');
    setConfirmPassword('');
  };

  const setup = async () => {
    if (password !== confirmPassword) {
      setNotice('보관 비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    setLoading(true);
    try {
      const result = await adminApi.setupSecurityVault(password);
      setStatus((current) => current ? { ...current, configured: true, can_setup: false } : current);
      await openVault(result.vault_token, result.expires_in_seconds);
      setNotice('보안 정보 보관 비밀번호를 설정했습니다. 이제 접속 정보를 입력해 주세요.');
    } catch (error) {
      setNotice(errorDetail(error, '보안 정보 보관 비밀번호를 설정하지 못했습니다.'));
    } finally {
      setLoading(false);
    }
  };

  const unlock = async () => {
    setLoading(true);
    try {
      const result = await adminApi.unlockSecurityVault(password);
      await openVault(result.vault_token, result.expires_in_seconds);
      setNotice('보안 정보 잠금을 해제했습니다.');
    } catch (error) {
      setNotice(errorDetail(error, '보안 정보 잠금을 해제하지 못했습니다.'));
    } finally {
      setLoading(false);
    }
  };

  const extendVault = async () => {
    if (!vaultToken) return;
    setExtending(true);
    try {
      const result = await adminApi.extendSecurityVault(vaultToken);
      setVaultToken(result.vault_token);
      setExpiresAt(Date.now() + result.expires_in_seconds * 1000);
      setNotice('자동 잠금 시간을 지금부터 30분으로 연장했습니다.');
    } catch (error) {
      const statusCode = (error as { response?: { status?: number } }).response?.status;
      if (statusCode === 403) lockVault('보안 정보 열람 시간이 만료되었습니다. 다시 잠금 해제해 주세요.');
      else setNotice(errorDetail(error, '자동 잠금 시간을 연장하지 못했습니다.'));
    } finally {
      setExtending(false);
    }
  };

  const resetVaultPassword = async () => {
    if (!vaultToken) return;
    if (!isStrongVaultPassword(newPassword)) {
      setNotice('새 비밀번호는 8자 이상이며 특수문자를 1개 이상 포함해야 합니다.');
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setNotice('새 비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    setResetting(true);
    try {
      const result = await adminApi.resetSecurityVaultPassword(vaultToken, newPassword);
      setVaultToken(result.vault_token);
      setExpiresAt(Date.now() + result.expires_in_seconds * 1000);
      setNewPassword('');
      setNewPasswordConfirm('');
      setResetOpen(false);
      setNotice('보안 정보 보관 비밀번호를 재설정했습니다. 기존 비밀번호는 더 이상 사용할 수 없습니다.');
    } catch (error) {
      const statusCode = (error as { response?: { status?: number } }).response?.status;
      if (statusCode === 403) lockVault('보안 정보 열람 시간이 만료되었습니다. 다시 잠금 해제해 주세요.');
      else setNotice(errorDetail(error, '보안 정보 보관 비밀번호를 재설정하지 못했습니다.'));
    } finally {
      setResetting(false);
    }
  };

  const updateCredential = (key: string, field: keyof SecurityVaultCredential, value: string) => {
    setData((current) => current ? {
      ...current,
      credentials: current.credentials.map((item) => item.key === key ? { ...item, [field]: value } : item),
    } : current);
  };

  const saveCredential = async (item: SecurityVaultCredential) => {
    if (!vaultToken) return;
    setSavingKey(item.key);
    try {
      const saved = await adminApi.saveSecurityVaultCredential(vaultToken, item);
      setData((current) => current ? {
        ...current,
        credentials: current.credentials.map((row) => row.key === item.key ? saved : row),
      } : current);
      setNotice(`${item.label} 정보를 저장했습니다.`);
    } catch (error) {
      const statusCode = (error as { response?: { status?: number } }).response?.status;
      if (statusCode === 403) lockVault('보안 정보 열람 시간이 만료되었습니다. 다시 잠금 해제해 주세요.');
      else setNotice(errorDetail(error, '보안 정보를 저장하지 못했습니다.'));
    } finally {
      setSavingKey('');
    }
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
      setNotice(`${label}을(를) 복사했습니다.`);
    } catch {
      setNotice('브라우저에서 클립보드 복사를 허용하지 않았습니다.');
    }
  };

  const expiryLabel = useMemo(() => `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`, [secondsLeft]);

  if (!status) return <div className="rounded-3xl bg-white p-8 text-sm text-slate-400 shadow-sm">보안 정보 설정을 확인하는 중입니다.</div>;

  if (!vaultToken || !data) {
    const needsSetup = !status.configured;
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-950 text-white"><Lock className="h-6 w-6" /></div>
        <div className="mt-5 text-center"><h2 className="text-xl font-black text-slate-950">{needsSetup ? '보안 정보 보관 비밀번호 설정' : '보안 정보 잠금 해제'}</h2><p className="mt-2 text-sm leading-6 text-slate-500">관리자 로그인과 별도로 접속 계정·비밀번호·허용된 환경설정을 보호합니다.</p></div>
        {notice && <div className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{notice}</div>}
        {needsSetup && !status.can_setup ? <div className="mt-6 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">최상위 관리자만 최초 보관 비밀번호를 설정할 수 있습니다.</div> : <div className="mt-6 space-y-4"><label className="block text-sm font-bold text-slate-700">보관 비밀번호<input autoComplete={needsSetup ? 'new-password' : 'current-password'} type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !needsSetup) void unlock(); }} placeholder={needsSetup ? '8자 이상, 특수문자 포함' : '현재 보관 비밀번호'} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500" /></label>{needsSetup && <label className="block text-sm font-bold text-slate-700">비밀번호 확인<input autoComplete="new-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500" /></label>}<button onClick={() => void (needsSetup ? setup() : unlock())} disabled={loading || !password || (needsSetup && (!isStrongVaultPassword(password) || !confirmPassword))} className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-40">{loading ? '확인 중...' : needsSetup ? '보관 비밀번호 설정' : '잠금 해제'}</button>{needsSetup && <p className="text-xs leading-5 text-slate-400">8자 이상이며 특수문자를 1개 이상 포함해 주세요.</p>}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 rounded-3xl bg-[linear-gradient(120deg,#0f172a,#1e3a8a)] p-6 text-white shadow-lg sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-4"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10"><ShieldCheck className="h-6 w-6 text-blue-200" /></span><div><h2 className="text-xl font-black">운영 보안 정보</h2><p className="mt-1 text-xs text-blue-100">잠금 해제 후 30분 동안 열람할 수 있으며 필요할 때 시간을 연장할 수 있습니다.</p></div></div><div className="flex flex-wrap items-center gap-3"><span className="rounded-xl bg-white/10 px-3 py-2 font-mono text-xs ring-1 ring-white/20">자동 잠금 {expiryLabel}</span><button onClick={() => setResetOpen((current) => !current)} className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-xs font-black text-white ring-1 ring-white/30"><KeyRound className="h-4 w-4" />비밀번호 재설정</button><button onClick={() => void extendVault()} disabled={extending} className="inline-flex items-center gap-2 rounded-xl bg-blue-400/20 px-4 py-2 text-xs font-black text-white ring-1 ring-white/30 disabled:opacity-50"><Clock3 className="h-4 w-4" />{extending ? '연장 중...' : '30분 연장'}</button><button onClick={() => lockVault()} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-black text-slate-900"><Lock className="h-4 w-4" />잠그기</button></div></section>

      {notice && <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">{notice}</div>}

      {resetOpen && <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm"><div className="flex flex-col gap-5 lg:flex-row lg:items-end"><div className="flex-1"><h3 className="font-black text-slate-950">보관 비밀번호 재설정</h3><p className="mt-1 text-xs leading-5 text-slate-600">새 비밀번호로 변경하면 기존 비밀번호와 기존에 발급된 보안 정보 인증은 즉시 사용할 수 없습니다.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-700">새 비밀번호<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="8자 이상, 특수문자 포함" className="mt-2 w-full rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-500" /></label><label className="text-xs font-bold text-slate-700">새 비밀번호 확인<input type="password" autoComplete="new-password" value={newPasswordConfirm} onChange={(event) => setNewPasswordConfirm(event.target.value)} className="mt-2 w-full rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-500" /></label></div></div><div className="flex gap-2"><button onClick={() => { setResetOpen(false); setNewPassword(''); setNewPasswordConfirm(''); }} className="rounded-xl border border-amber-300 bg-white px-4 py-3 text-sm font-bold text-slate-700">취소</button><button onClick={() => void resetVaultPassword()} disabled={resetting || !isStrongVaultPassword(newPassword) || newPassword !== newPasswordConfirm} className="rounded-xl bg-amber-600 px-5 py-3 text-sm font-black text-white disabled:opacity-40">{resetting ? '변경 중...' : '비밀번호 변경'}</button></div></div></section>}

      <div className="grid gap-5 xl:grid-cols-2">
        {data.credentials.map((item) => {
          const passwordKey = `${item.key}:password`;
          const showPassword = revealed.has(passwordKey);
          return <section key={item.key} className="min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-blue-600" /><h3 className="font-black text-slate-950">{item.label}</h3></div><p className="mt-1 text-xs text-slate-400">{item.key === 'aws_console' ? 'AWS 계정 ID·EC2 인스턴스 ID·IAM 로그인 계정을 구분해 관리합니다.' : 'n·Xavis 일자별 사용 현황 접속 정보입니다.'}</p></div>{item.login_url && <a href={item.login_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700">사이트 열기<ExternalLink className="h-3.5 w-3.5" /></a>}</div><div className="mt-5 grid gap-4"><label className="text-xs font-bold text-slate-600">표시 이름<input value={item.label} onChange={(event) => updateCredential(item.key, 'label', event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="text-xs font-bold text-slate-600">접속 주소<input value={item.login_url ?? ''} onChange={(event) => updateCredential(item.key, 'login_url', event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label>{item.key === 'aws_console' && <><label className="text-xs font-bold text-slate-600">AWS 계정 ID<div className="mt-2 flex gap-2"><input value={item.account_identifier ?? ''} onChange={(event) => updateCredential(item.key, 'account_identifier', event.target.value.replace(/[^0-9]/g, ''))} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm" /><button onClick={() => void copy(item.account_identifier ?? '', 'AWS 계정 ID')} className="rounded-xl border border-slate-200 p-2.5 text-slate-500" title="복사"><Copy className="h-4 w-4" /></button></div></label><label className="text-xs font-bold text-slate-600">EC2 인스턴스 ID<div className="mt-2 flex gap-2"><input value={item.instance_identifier ?? ''} onChange={(event) => updateCredential(item.key, 'instance_identifier', event.target.value.trim())} placeholder="i-0123456789abcdef0" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm" /><button onClick={() => void copy(item.instance_identifier ?? '', 'EC2 인스턴스 ID')} className="rounded-xl border border-slate-200 p-2.5 text-slate-500" title="복사"><Copy className="h-4 w-4" /></button></div></label></>}<label className="text-xs font-bold text-slate-600">로그인 아이디<div className="mt-2 flex gap-2"><input value={item.username} onChange={(event) => updateCredential(item.key, 'username', event.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /><button onClick={() => void copy(item.username, '로그인 아이디')} className="rounded-xl border border-slate-200 p-2.5 text-slate-500" title="복사"><Copy className="h-4 w-4" /></button></div></label><label className="text-xs font-bold text-slate-600">로그인 비밀번호<div className="mt-2 flex gap-2"><div className="relative min-w-0 flex-1"><input type={showPassword ? 'text' : 'password'} value={item.password} onChange={(event) => updateCredential(item.key, 'password', event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 pr-10 text-sm" /><button type="button" onClick={() => toggleReveal(passwordKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div><button onClick={() => void copy(item.password, '로그인 비밀번호')} className="rounded-xl border border-slate-200 p-2.5 text-slate-500" title="복사"><Copy className="h-4 w-4" /></button></div></label><label className="text-xs font-bold text-slate-600">운영 메모<textarea value={item.note} onChange={(event) => updateCredential(item.key, 'note', event.target.value)} rows={2} className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><button onClick={() => void saveCredential(item)} disabled={savingKey === item.key} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-40"><Save className="h-4 w-4" />{savingKey === item.key ? '저장 중...' : '암호화 저장'}</button></div></section>;
        })}
      </div>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 bg-slate-50 px-6 py-4"><h3 className="font-black text-slate-950">운영 환경설정</h3><p className="mt-1 text-xs leading-5 text-slate-500">운영에 필요한 허용 항목만 표시합니다. 암호화 키, JWT 비밀키, 관리자 비밀번호는 화면에서 조회할 수 없습니다.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b border-slate-200 text-left text-xs text-slate-500"><th className="px-6 py-3">항목</th><th className="px-4 py-3">환경변수</th><th className="px-4 py-3">상태</th><th className="px-4 py-3">값</th><th className="px-6 py-3 text-right">동작</th></tr></thead><tbody>{data.environment.map((item) => { const visible = revealed.has(`env:${item.key}`); return <tr key={item.key} className="border-b border-slate-100 last:border-0"><td className="px-6 py-3 font-semibold text-slate-800">{item.label}</td><td className="px-4 py-3 font-mono text-xs text-slate-500">{item.key}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-black ${item.configured ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{item.configured ? '설정됨' : '미설정'}</span></td><td className="max-w-md px-4 py-3 font-mono text-xs text-slate-700"><span className="block truncate">{!item.configured ? '-' : visible || !item.sensitive ? item.value : '••••••••••••'}</span></td><td className="px-6 py-3"><div className="flex justify-end gap-2">{item.sensitive && item.configured && <button onClick={() => toggleReveal(`env:${item.key}`)} className="rounded-lg border border-slate-200 p-2 text-slate-500" title={visible ? '숨기기' : '보기'}>{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>}<button onClick={() => void copy(item.value, item.label)} disabled={!item.configured} className="rounded-lg border border-slate-200 p-2 text-slate-500 disabled:opacity-30" title="복사"><Copy className="h-4 w-4" /></button></div></td></tr>; })}</tbody></table></div></section>
    </div>
  );
}
