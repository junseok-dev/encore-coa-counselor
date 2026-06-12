import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { adminApi, getAdminToken } from '../services/api';
import { AdminSessionDetail } from '../types';

const SOURCE_BADGE: Record<string, { label: string; className: string }> = {
  faq: { label: 'FAQ', className: 'bg-green-100 text-green-700' },
  document: { label: '문서', className: 'bg-blue-100 text-blue-700' },
  ai: { label: 'AI', className: 'bg-purple-100 text-purple-700' },
  fallback: { label: '오류', className: 'bg-red-100 text-red-700' },
  user: { label: '사용자', className: 'bg-gray-100 text-gray-600' },
};

export default function AdminSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<AdminSessionDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getAdminToken()) {
      navigate('/admin');
      return;
    }
    if (!sessionId) return;
    adminApi
      .getSessionDetail(sessionId)
      .then(setDetail)
      .catch(() => setError('세션 정보를 불러오지 못했습니다.'));
  }, [sessionId, navigate]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-400">불러오는 중...</p>
      </div>
    );
  }

  const { session, messages } = detail;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-3xl">
        <button
          onClick={() => navigate('/admin')}
          className="mb-4 flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-800"
        >
          목록으로
        </button>

        <div className="mb-6 rounded-xl bg-white p-5 shadow">
          <h2 className="mb-2 text-lg font-bold text-gray-800">세션 상세</h2>
          <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
            <span>사용자</span>
            <span className="font-medium text-gray-800">{session.user_name ?? '익명'}</span>
            <span>시작</span>
            <span>{new Date(session.created_at).toLocaleString('ko-KR')}</span>
            <span>메시지 수</span>
            <span>{session.message_count}개</span>
          </div>
        </div>

        <div className="space-y-3">
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            const badge = msg.source ? SOURCE_BADGE[msg.source] : null;
            return (
              <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex max-w-[80%] flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
                  {badge && !isUser && (
                    <span className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                  )}
                  <div
                    className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm ${
                      isUser
                        ? 'rounded-br-sm bg-brand-600 text-white'
                        : 'rounded-bl-sm border border-gray-200 bg-white text-gray-800 shadow-sm'
                    }`}
                  >
                    {msg.content}
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(msg.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
