import { useCallback, useEffect, useRef, useState } from 'react';
import { Conversation, Message, SuggestedQuestion } from '../types';
import { chatApi } from '../services/api';

const generateId = () => Math.random().toString(36).substring(2, 15);

const CONVERSATIONS_KEY = 'chatConversations:v2';
const CURRENT_CONV_KEY = 'chatCurrentConvId:v2';
const QUESTION_DEBOUNCE_MS = 1000;

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content: '안녕하세요!\n\n엔코아 AI 캠퍼스 상담봇 코아예요 😊 궁금한 내용을 편하게 물어봐 주세요.',
  timestamp: new Date().toISOString(),
};

const loadConversations = (): Conversation[] => {
  try {
    const stored = sessionStorage.getItem(CONVERSATIONS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const persistConversations = (convs: Conversation[]) => {
  try {
    sessionStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convs));
  } catch {}
};

const saveConversation = (conv: Conversation) => {
  const convs = loadConversations();
  const idx = convs.findIndex((c) => c.id === conv.id);
  if (idx >= 0) {
    convs[idx] = conv;
  } else {
    convs.unshift(conv);
  }
  persistConversations(convs);
};

const makeConversation = (id: string, sessionId: string, messages: Message[]): Conversation => {
  const firstUser = messages.find((m) => m.role === 'user');
  const title = firstUser
    ? firstUser.content.slice(0, 28) + (firstUser.content.length > 28 ? '...' : '')
    : '새 상담';
  return { id, title, messages, startedAt: messages[0]?.timestamp ?? new Date().toISOString(), sessionId };
};

const newSessionId = () => `session_${Date.now()}_${generateId()}`;
const newConvId = () => `conv_${Date.now()}_${generateId()}`;

export const useChat = () => {
  const [convId, setConvId] = useState<string>(() => {
    return sessionStorage.getItem(CURRENT_CONV_KEY) ?? newConvId();
  });
  const [messages, setMessages] = useState<Message[]>(() => {
    const id = sessionStorage.getItem(CURRENT_CONV_KEY);
    if (!id) return [WELCOME_MESSAGE];
    const conv = loadConversations().find((c) => c.id === id);
    return conv ? conv.messages : [WELCOME_MESSAGE];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [suggestedQuestions, setSuggestedQuestions] = useState<SuggestedQuestion[]>([]);

  const sessionIdRef = useRef(newSessionId());
  const messagesRef = useRef<Message[]>(messages);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeBotIdRef = useRef<string | null>(null);
  const pendingQuestionsRef = useRef<string[]>([]);
  const pendingUserIdsRef = useRef<string[]>([]);
  const responseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    sessionStorage.setItem(CURRENT_CONV_KEY, convId);
  }, [convId]);

  useEffect(() => {
    const hasUser = messages.some((m) => m.role === 'user');
    if (!hasUser) return;
    saveConversation(makeConversation(convId, sessionIdRef.current, messages));
  }, [messages, convId]);

  useEffect(() => {
    chatApi
      .getSuggestedQuestions()
      .then((res) => setSuggestedQuestions(res.questions))
      .catch((err) => console.error('Failed to load suggested questions:', err));
  }, []);

  const removeActiveBot = useCallback(() => {
    if (!activeBotIdRef.current) return;
    const activeId = activeBotIdRef.current;
    const next = messagesRef.current.filter((m) => m.id !== activeId);
    messagesRef.current = next;
    setMessages(next);
    activeBotIdRef.current = null;
  }, []);

  const cancelActiveResponse = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStreamingMessageId(null);
    removeActiveBot();
  }, [removeActiveBot]);

  const stopGenerating = useCallback(() => {
    if (responseTimerRef.current !== null) {
      window.clearTimeout(responseTimerRef.current);
      responseTimerRef.current = null;
    }
    pendingQuestionsRef.current = [];
    pendingUserIdsRef.current = [];
    cancelActiveResponse();
    setIsLoading(false);
  }, [cancelActiveResponse]);

  const startResponse = useCallback(async () => {
    responseTimerRef.current = null;

    const questions = [...pendingQuestionsRef.current];
    const pendingUserIds = [...pendingUserIdsRef.current];
    pendingQuestionsRef.current = [];
    pendingUserIdsRef.current = [];

    if (!questions.length) {
      setIsLoading(false);
      return;
    }

    const combinedQuestion = questions.join('\n');
    const botId = generateId();
    const botPlaceholder: Message = {
      id: botId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    };

    const withBot = [...messagesRef.current, botPlaceholder];
    messagesRef.current = withBot;
    setMessages(withBot);
    setIsLoading(true);
    setStreamingMessageId(botId);
    activeBotIdRef.current = botId;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const history = messagesRef.current
      .filter((m) => m.id !== 'welcome' && m.id !== botId && !pendingUserIds.includes(m.id) && m.content.trim())
      .slice(-10)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    await chatApi.streamMessage(
      sessionIdRef.current,
      combinedQuestion,
      history,
      (token) => {
        const next = messagesRef.current.map((m) =>
          m.id === botId ? { ...m, content: m.content + token } : m,
        );
        messagesRef.current = next;
        setMessages(next);
      },
      (source, handoffUrl) => {
        const next = messagesRef.current.map((m) =>
          m.id === botId ? { ...m, source: source as Message['source'], handoff_url: handoffUrl } : m,
        );
        messagesRef.current = next;
        setMessages(next);
        setIsLoading(false);
        setStreamingMessageId(null);
        abortControllerRef.current = null;
        activeBotIdRef.current = null;
      },
      () => {
        const next = messagesRef.current.map((m) =>
          m.id === botId
            ? {
                ...m,
                content: '서버와 통신하는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.',
                source: 'fallback' as Message['source'],
              }
            : m,
        );
        messagesRef.current = next;
        setMessages(next);
        setIsLoading(false);
        setStreamingMessageId(null);
        abortControllerRef.current = null;
        activeBotIdRef.current = null;
      },
      controller.signal,
    );
  }, []);

  const sendMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      if (isLoading) {
        cancelActiveResponse();
      }

      const userMessage: Message = {
        id: generateId(),
        role: 'user',
        content: trimmed,
        timestamp: new Date().toISOString(),
      };

      const next = [...messagesRef.current, userMessage];
      messagesRef.current = next;
      setMessages(next);

      pendingQuestionsRef.current.push(trimmed);
      pendingUserIdsRef.current.push(userMessage.id);
      setIsLoading(true);

      if (responseTimerRef.current !== null) {
        window.clearTimeout(responseTimerRef.current);
      }
      responseTimerRef.current = window.setTimeout(() => {
        void startResponse();
      }, QUESTION_DEBOUNCE_MS);
    },
    [cancelActiveResponse, isLoading, startResponse],
  );

  const startNewChat = useCallback(() => {
    stopGenerating();
    const id = newConvId();
    const welcome = { ...WELCOME_MESSAGE, id: 'welcome', timestamp: new Date().toISOString() };
    sessionIdRef.current = newSessionId();
    setConvId(id);
    messagesRef.current = [welcome];
    setMessages([welcome]);
  }, [stopGenerating]);

  const loadConversation = useCallback((conv: Conversation) => {
    stopGenerating();
    sessionIdRef.current = conv.sessionId;
    setConvId(conv.id);
    messagesRef.current = conv.messages;
    setMessages(conv.messages);
  }, [stopGenerating]);

  return {
    messages,
    isLoading,
    streamingMessageId,
    suggestedQuestions,
    sendMessage,
    stopGenerating,
    startNewChat,
    loadConversation,
    convId,
  };
};

export const useConversations = () => {
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);

  const refresh = useCallback(() => {
    setConversations(loadConversations());
  }, []);

  const search = useCallback((keyword: string): Conversation[] => {
    const convs = loadConversations();
    if (!keyword.trim()) return convs;
    const lower = keyword.toLowerCase();
    return convs
      // welcome만 있는 빈 대화 제외 (사용자 메시지가 하나라도 있어야 의미 있는 대화)
      .filter((c) => c.messages.some((m) => m.role === 'user'))
      // 키워드 매칭 (제목 또는 메시지 본문)
      .filter(
        (c) =>
          c.title.toLowerCase().includes(lower) ||
          c.messages.some((m) => m.content.toLowerCase().includes(lower)),
      )
      // 최신순 정렬
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }, []);

  return { conversations, refresh, search };
};
