import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';

const HomePage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <span className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-brand-600 to-blue-600">
                코아 · 엔코아AI캠퍼스 상담 챗봇
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <a href="#" className="text-gray-600 hover:text-brand-600 font-medium transition-colors">부트캠프 소개</a>
              <a href="#" className="text-gray-600 hover:text-brand-600 font-medium transition-colors">커리큘럼</a>
              <a href="#" className="text-gray-600 hover:text-brand-600 font-medium transition-colors">수강후기</a>
              <button className="bg-brand-600 text-white px-5 py-2 rounded-lg font-medium hover:bg-brand-700 transition-colors shadow-sm hover:shadow-md">
                지원하기
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
        <div className="text-center max-w-4xl mx-auto">
          <h1 className="text-5xl font-extrabold text-gray-900 tracking-tight mb-8 leading-tight">
            AI 시대의 핵심 인재로 거듭나는<br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-600 to-blue-600">
              실무형 AI 개발자 부트캠프
            </span>
          </h1>
          <p className="mt-4 text-xl text-gray-600 mb-10 leading-relaxed">
            비전공자도 6개월 만에 실무 투입이 가능한 풀스택 AI 개발자로 성장합니다.<br/>
            최신 LLM 활용부터 RAG 시스템 구축, 팀 프로젝트 포트폴리오까지.
          </p>
          <div className="flex justify-center gap-4">
            <button className="bg-brand-600 text-white px-8 py-4 rounded-xl font-bold text-lg hover:bg-brand-700 transition-all transform hover:-translate-y-1 shadow-lg hover:shadow-xl">
              1기 지원하기
            </button>
            <button className="bg-white text-gray-800 border-2 border-gray-200 px-8 py-4 rounded-xl font-bold text-lg hover:border-gray-300 hover:bg-gray-50 transition-all transform hover:-translate-y-1">
              커리큘럼 다운로드
            </button>
          </div>
        </div>
      </main>

      {/* Floating Chat Button */}
      <div className="fixed bottom-8 right-8 z-50">
        <div className="relative group">
          <div className="absolute -top-14 right-0 bg-white text-gray-800 px-4 py-2 rounded-lg shadow-lg text-sm font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none border border-gray-100">
            궁금한 점을 챗봇에게 물어보세요!
            <div className="absolute -bottom-2 right-6 w-4 h-4 bg-white border-b border-r border-gray-100 transform rotate-45"></div>
          </div>
          <button
            onClick={() => navigate('/chat')}
            className="bg-brand-600 text-white p-4 rounded-full shadow-xl hover:bg-brand-700 hover:scale-110 transition-all duration-300 flex items-center justify-center focus:outline-none focus:ring-4 focus:ring-brand-500 focus:ring-opacity-50"
            aria-label="채팅 상담 시작하기"
          >
            <MessageSquare size={32} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default HomePage;
