# 엔코어캠퍼스 AI 상담 챗봇.

> 교육 과정 안내 및 상담을 위한 문서 기반 RAG 챗봇 시스템

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [기술 스택](#2-기술-스택)
3. [시스템 아키텍처](#3-시스템-아키텍처)
4. [RAG 파이프라인](#4-rag-파이프라인)
5. [응답 처리 흐름](#5-응답-처리-흐름)
6. [데이터베이스 구조](#6-데이터베이스-구조)
7. [API 엔드포인트](#7-api-엔드포인트)
8. [AWS 인프라 및 배포](#8-aws-인프라-및-배포)
9. [보안 설계](#9-보안-설계)
10. [프론트엔드 구조](#10-프론트엔드-구조)
11. [관리자 대시보드 기능](#11-관리자-대시보드-기능)
12. [RAGAS 품질 평가](#12-rag-품질-평가-결과-ragas)
13. [디렉토리 구조](#13-디렉토리-구조)
14. [로컬 개발 환경](#14-로컬-개발-환경)
15. [프로젝트 진화 (Before → After)](#15-프로젝트-진화-before--after)

---

## 1. 프로젝트 개요

엔코어캠퍼스의 교육 과정(AI 오케스트레이션, ML 엔지니어, MLOps 등) 관련 문서와 FAQ를 기반으로 사용자 질문에 자동 답변하는 상담 챗봇입니다.

> 📈 최초 릴리스 이후 운영 로그를 분석하며 라우팅·검색·모델·답변 스타일을 단계적으로 개선해 왔습니다. 무엇이 왜 어떻게 바뀌었고 결과가 어땠는지는 **[15. 프로젝트 진화 (Before → After)](#15-프로젝트-진화-before--after)** 에 정리되어 있습니다.

**주요 기능:**

- 과정 소개, 지원 대상, 커리큘럼, 운영 정책, 환불 규정 등 안내
- **하이브리드 라우터** — 명백한 질문(개강 시점·버튼)은 결정적으로 즉시, 애매한 자연어는 LLM이 의미로 분기(FAQ 직답·RAG·상담연결 등). 키워드 점수 충돌 없이 정확 라우팅, 회귀 게이트(48케이스)로 검증
- 실시간 스트리밍 응답 (Server-Sent Events, 진짜 토큰 스트리밍)
- 대화 이력 기반 맥락 파악 — 연속 질문·짧은 후속("둘 다야")도 자연스럽게 이어서 답변
- **결론 먼저·짧게** — 물어본 것에 결론부터, 짧은 말풍선(기본 1~2개)으로. 되묻기 대신 '답할 수 있는 다음 선택지'로 닫음(되묻기 루프 차단)
- **새 대화 / 기록** — 헤더에서 새 대화 시작(현재 대화는 기록에 자동 저장), 기록에서 과거 대화 복원
- 여러 질문 동시 처리 — 한 메시지에 여러 질문이 있을 때 통합 답변
- 관리자 대시보드: 문서 업로드/승인, FAQ 관리, 프롬프트 편집, 상담 기록 조회, 데이터 관리, DB 브라우저(행 편집·삭제 + 안전 테이블 DROP), 권한 관리, 설정
- DB 브라우저 호버 툴팁 + 편집 불가 사유 안내 — 잘못 만지면 안 되는 테이블에 이유까지 표시
- 공식 홈페이지 자동 안내 — 자료가 부족하면 답변 끝에 `https://encorecampus.ai/` 마크다운 링크 자동 부착
- 채널톡 상담 매니저 연결 자동 승격 — 응답 본문에서 "채널톡" 언급을 감지해 파란 버튼 자동 노출
- 모바일 폼팩터 채팅 UI — 둥근 카드 + 그라데이션 배경, 스크롤 위치 conversation별 복원
- 말풍선 분할 가이드 — 맥락 전환·호흡·항목 단위 3단 기준, 의미 이모티콘(📅 💰 🎓 💻 등)으로 구조 시각화
- **핵심 사실 상주 + 추론** — 수업시간·기간·비용 등 핵심 사실을 시스템 프롬프트에 상시 포함해, 검색에 안 잡히는 대화체·추론형 질문도 회피 없이 답변(낮은 검색 점수로 하드 거절하지 않음)
- **FAQ 답변 재서술** — 저장된 FAQ 카드를 사실·수치 보존한 채 짧은 상담 말투로 LLM이 다시 표현(생성 답변과 톤 통일)
- Google OAuth 2.0 기반 관리자 인증 (JWT 세션, 등록된 이메일만 접근)
- 런타임 LLM 모델 변경 (재시작 없이 OpenAI 모델 즉시 교체)
- 카테고리별 Fernet 암호화 관리 (ON/OFF 토글 + 일괄 암호화↔복호화)
- Guardrail(디에스컬레이션): 인젝션·개인정보는 하드 차단, 욕설/분노는 실제 의도(환불·문의 등) 동반 시 차단 대신 상담 연결·답변으로 전환

---

## 2. 기술 스택

### 백엔드

| 분류              | 기술                                                                        |
| ----------------- | --------------------------------------------------------------------------- |
| 웹 프레임워크     | FastAPI + Uvicorn                                                           |
| ORM               | SQLAlchemy                                                                  |
| 데이터베이스      | AWS Aurora RDS (PostgreSQL 호환)                                            |
| LLM               | OpenAI GPT (런타임 모델 선택 가능, 기본 `gpt-5.4-mini`)                   |
| 임베딩            | OpenAI `text-embedding-3-large` (3072차원)                                |
| 벡터 DB           | FAISS (로컬 인덱스, S3 동기화)                                              |
| LangChain         | `langchain-openai`, `langchain-community`, `langchain-text-splitters` |
| PDF 처리          | `opendataloader-pdf`                                                      |
| 오브젝트 스토리지 | AWS S3 (`boto3`)                                                          |
| 암호화            | `cryptography` (Fernet 대칭 암호화)                                       |
| 인증              | `google-auth[requests]` + `PyJWT` (Google OAuth 2.0 + JWT)              |
| 엑셀 내보내기     | `openpyxl`                                                                |

### 프론트엔드

| 분류            | 기술                                            |
| --------------- | ----------------------------------------------- |
| 프레임워크      | React 18 + TypeScript                           |
| 번들러          | Vite                                            |
| UI              | Tailwind CSS                                    |
| HTTP            | Axios                                           |
| 라우팅          | React Router v6                                 |
| 마크다운 렌더링 | react-markdown                                  |
| 아이콘          | lucide-react                                    |
| OAuth           | `@react-oauth/google` (Google One Tap 로그인) |

### 인프라 / DevOps

| 분류              | 기술                                       |
| ----------------- | ------------------------------------------ |
| 서버              | AWS EC2                                    |
| 데이터베이스      | AWS Aurora RDS (PostgreSQL)                |
| 오브젝트 스토리지 | AWS S3                                     |
| CI/CD             | GitHub Actions (self-hosted runner on EC2) |
| 프로세스 관리     | systemd (`chatbot.service`)              |

---

## 3. 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                         사용자 브라우저                           │
│           React + TypeScript (Vite, Tailwind CSS)               │
│  ChatPage ─── AdminPage ─── AdminSessionPage                    │
│      ↕              ↕                                           │
│  useChat.ts      api.ts (Axios)                                 │
└─────────────────────┬───────────────────────────────────────────┘
                      │ HTTP / Server-Sent Events
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│              AWS EC2 — FastAPI 백엔드 (포트 8888)                 │
│                                                                  │
│  ┌─────────────────┐   ┌──────────────────────────────────────┐ │
│  │  routers/        │   │  services/                           │ │
│  │  ├ chat.py       │   │  ├ rag_service.py      (벡터 검색)  │ │
│  │  └ admin.py      │──▶│  ├ document_service.py (검색 전략)  │ │
│  └─────────────────┘   │  ├ openai_service.py   (LLM 호출)   │ │
│                         │  ├ faq_service.py      (FAQ 매칭)   │ │
│                         │  ├ guardrail_service.py(안전 필터)  │ │
│                         │  ├ prompt_service.py   (프롬프트)   │ │
│                         │  ├ admin_service.py    (문서 관리)  │ │
│                         │  └ storage_service.py  (S3 연동)    │ │
│                         └──────────────────────────────────────┘ │
│                                    │                             │
│          ┌─────────────────────────┼──────────────────┐         │
│          ▼                         ▼                  ▼         │
│  ┌───────────────────┐  ┌──────────────────┐  ┌─────────────┐  │
│  │ AWS Aurora RDS    │  │  FAISS 인덱스     │  │  AWS S3     │  │
│  │ (PostgreSQL 호환)  │  │  (EC2 로컬 캐시)  │  │             │  │
│  │                   │  │                  │  │ /faiss/     │  │
│  │ chat_sessions     │  │ text-embedding   │  │ /documents/ │  │
│  │ chat_messages     │  │ -3-large 3072dim  │  │ /faq/       │  │
│  │ chat_logs         │  │                  │  │             │  │
│  │ documents         │  └──────────────────┘  └─────────────┘  │
│  │ chunks            │         ↕ (동기화)                        │
│  │ faqs              │      S3 ↔ EC2                            │
│  │ prompt_configs    │                                           │
│  │ admin_audit_logs  │                                           │
│  │ custom_tables     │  ← 데이터 관리: 테이블 메타데이터           │
│  │ custom_columns    │  ← 데이터 관리: 컬럼 정의                   │
│  │ cdata_{id}        │  ← 데이터 관리: 실제 SQL 데이터 테이블      │
│  └───────────────────┘                                           │
└─────────────────────────────────────────────────────────────────┘
                      │
                      ▼ OpenAI API
              gpt-5.4-mini  +  text-embedding-3-large
```

---

## 4. RAG 파이프라인

### 4.1 전체 흐름

```
사용자 질문 입력
        │
        ▼
┌───────────────────────────────────────────────────────┐
│                  검색 전략 결정                         │
│  (document_service.py → build_retrieval_plan)         │
│                                                       │
│  비교 질문    → MMR 검색                               │
│  비용/기간    → Hybrid + 규정/과정 파일 지정            │
│  인젝션 감지  → Keyword 검색                           │
│  기본         → Hybrid 검색                            │
└───────────────┬───────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────┐
│              하이브리드 검색 (rag_service.py)           │
│                                                       │
│  ┌─────────────────┐  ┌─────────────┐  ┌──────────┐  │
│  │  Vector Search  │  │ MMR Search  │  │ Keyword  │  │
│  │  (FAISS         │  │ (다양성     │  │ Search   │  │
│  │   Cosine 유사도) │  │  확보)      │  │ (토큰    │  │
│  └────────┬────────┘  └──────┬──────┘  │ 오버랩)  │  │
│           └─────────┬────────┘         └────┬─────┘  │
│                     ▼                        │        │
│              Reciprocal Rank Fusion          │        │
│                     +                        │        │
│               리랭킹 (Rerank)  ◀─────────────┘        │
│                                                       │
│  리랭킹 가중치:                                        │
│  - 벡터 유사도     × 5.0                               │
│  - 키워드 오버랩   × 1.8                               │
│  - 완전 문구 매칭  + 3.0 (보너스)                      │
│  - 헤더 토큰 매칭  × 1.2                               │
└───────────────┬───────────────────────────────────────┘
                │
                ▼ 최종 top_k 문서
┌───────────────────────────────────────────────────────┐
│        LangGraph 파이프라인 (graph_service.py)         │
│                                                       │
│   retrieve ──▶ generate_node (gpt-5.4-mini)           │
│        (검색 점수 낮아도 하드 거절 안 함:             │
│         핵심 사실 시트 + 추론으로 답변)               │
│                 │                                     │
│                 ▼                                     │
│              (top_score < VERIFY_THRESHOLD?)          │
│                 │ Yes                                 │
│                 ▼                                     │
│              verify_node (사실성 재검증) ───▶ END     │
└───────────────────────────────────────────────────────┘
                │
                ▼
        Server-Sent Events 토큰 단위 스트리밍
        + 후처리: 채널톡 언급 시 source="handoff" 자동 승격
```

- 검색 점수가 낮아도 **하드 거절하지 않음** — 핵심 사실 시트(`CANONICAL_FACTS`)가 시스템 프롬프트에 상주해 LLM이 사실+추론으로 답하고, 진짜 범위 밖 질문은 라우터의 `out_of_scope`가 rag 이전에 거른다 (`reject_threshold`는 호환 위해 정의만 유지)
- `verify_threshold = 3.5` (`.env`로 조정 가능) — 점수가 낮은 경우 verify_node가 문서 기반으로 답변을 재검증 (비스트리밍 경로)
- LangSmith 추적 가능 — `.env`에 `LANGSMITH_TRACING=true` (구 비표준 키 `LANGSMITH_TRACING_V2`도 자동 호환). 공유 OpenAI client를 `wrap_openai`로 래핑해 라우터·의도·생성·스트리밍·verify 전 경로가 기록됨

### 4.2 임베딩 및 벡터 저장소

```python
# 임베딩 모델 (settings.embedding_model, .env로 교체 가능)
OpenAIEmbeddings(model="text-embedding-3-large")  # 3072차원

# FAISS 인덱스 — EC2 로컬에 캐시, S3와 양방향 동기화
vectorstore = FAISS.load_local(FAISS_DIR, embeddings)
vectorstore.save_local(FAISS_DIR)

# S3 동기화
storage_service.download_faiss_from_s3()  # 서버 시작 시
storage_service.upload_faiss_to_s3()      # 인덱스 재구성 후
```

### 4.3 청킹 전략

```python
RecursiveCharacterTextSplitter.from_language(
    language=Language.MARKDOWN,
    chunk_size=1200,   # 최대 1200자
    chunk_overlap=150  # 150자 겹침 (문맥 유지)
)

# 청크 메타데이터
{
    "source_type": "document | faq",
    "title": "문서 제목",
    "category": "과정 상세 | 운영규정 | 플레이데이터 정보",
    "file": "logical_name"
}
```

### 4.4 검색 파일 분류

```python
COURSE_FILES     = ["course_ai_orchestration", "course_ml_engineer", "course_mlops"]
PLAYDATA_FILES   = ["playdata_intro", "campus_info", "homepage_intro"]
REGULATION_FILES = ["national_training_card_eligibility",
                    "national_training_card_regulation",
                    "vocational_training_regulation"]
LAW_FILES        = ["privacy_law", "fair_labeling_law"]
```

---

## 5. 응답 처리 흐름

> **하이브리드 라우터** — 기존엔 키워드 점수 매칭·의도분류·결정적 단축 등 5겹 휴리스틱이 겹쳐
> "취업"이 "선발"로 새는 등 의미 충돌이 잦았다. 이를 **1 게이트 + 1 라우터**로 단순화:
> 명백한 건 결정적으로(즉시·무료), 애매한 자연어는 LLM이 의미로 라우팅한다.

```
POST /api/chat/stream
        │
        ▼
[1] Guardrail 체크 (guardrail_service.py)
    ├─ 프롬프트 인젝션 / 개인정보 요청 → source="guardrail" (하드 차단)
    └─ 욕설·분노는 '진짜 서비스 의도'(환불/취소/문의 등) 동반 시 차단하지 않고 라우터로 전달
        │ (통과)
        ▼
[2] 하이브리드 라우터 (router_service.route)
    ├─ 결정적 패스: is_schedule_query(개강 '시점') / 버튼·질문 정확일치 → 즉시 결정 (LLM 미경유)
    ├─ LLM 라우터 (gpt-5.4-nano, temperature=0, 구조화 출력):
    │     handler + faq_id(FAQ 후보를 '의미'로 선택) + search_query(맥락 반영) + slots
    └─ LLM 실패 시 → 키워드 fallback (안전망)
        │
        ▼
[3] handler 분기
    greeting     → source="faq"      (인사 고정 응답)
    schedule     → source="faq"      (개강 일정 FAQ)
    faq(faq_id)  → source="faq"      (라우터가 고른 FAQ 답변을 새 상담 말투로 LLM 재서술)
    rag(query)   → LangGraph(retrieve → generate → verify) → source="document" | "ai"
    cancel       → source="handoff"  (채널톡 버튼 자동 노출)
    handoff      → source="handoff"
    out_of_scope → source="fallback" (교육 무관 / 법 내용)
    guide        → source="faq"      (카테고리 메뉴) — 단, 대화 맥락이 있으면 rag로 강등(후속답변 보호)
        │
        ▼
[4] 후처리
    ├─ 본문 URL/채널톡 마크다운 링크 sanitize, "채널톡" 언급 시 source="handoff" 승격
    └─ 어떤 경로도 빈 답변이면 안전 폴백을 스트리밍 (빈 말풍선 방지)

응답 source 타입:
  "faq"       — FAQ DB 직접 답변      "document"  — 문서 검색 후 LLM 생성
  "fallback"  — 범위 밖/오류 응답      "guardrail" — 안전장치 차단 응답
  "handoff"   — 채널톡 상담 매니저 연결
```

**회귀 게이트** — 라우팅 변경은 `scripts/diag_router.py`(라벨셋 `data/routing_evalset.json`, 48케이스)로
배포 전 검증한다. 현재 하이브리드 라우터 48/48(100%), 기존 휴리스틱 41/48(85%).
alias에 없는 패러프레이즈("일자리 연결해줘?"→취업지원)도 의미로 정확 라우팅.

---

## 6. 데이터베이스 구조

**Aurora RDS (PostgreSQL 호환)** — `DATABASE_URL` 환경변수로 연결

### 테이블 목록

| 테이블               | 설명                                                | 암호화 적용 필드                                       |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| `chat_sessions`    | 사용자 채팅 세션                                    | `encrypted_user_name`                                |
| `chat_messages`    | 개별 메시지                                         | `content`                                            |
| `chat_logs`        | 상담 로그 (API 비용 포함)                           | `question`, `answer`, `retrieval_chunks`         |
| `documents`        | 업로드 문서 메타                                    | `original_filename`, `error_message` (설정에 따라) |
| `chunks`           | 문서 청크                                           | `content`                                            |
| `faqs`             | FAQ 항목                                            | 암호화 설정에 따라 선택적 적용                         |
| `prompt_configs`   | 시스템 프롬프트 관리                                | 암호화 설정에 따라 선택적 적용                         |
| `app_settings`     | 런타임 앱 설정 (활성 LLM 모델 등 — 재시작·.env 없이 영구화) | —                                              |
| `admin_users`      | 관리자 권한 이메일 목록                             | —                                                     |
| `admin_audit_logs` | 관리자 작업 감시 로그                               | —                                                     |
| `cancel_requests`  | 취소/환불 요청 기록                                 | —                                                     |
| `processing_logs`  | 문서 처리 상태 로그                                 | —                                                     |
| `custom_tables`    | 데이터 관리 탭: 사용자 정의 테이블 메타데이터       | —                                                     |
| `custom_columns`   | 데이터 관리 탭: 컬럼 정의 (text/number/date)        | —                                                     |
| `cdata_{id}`       | 데이터 관리 탭: 실제 데이터 저장 테이블 (동적 생성) | —                                                     |

### 암호화 방식

```python
# Fernet 대칭 암호화 (utils/crypto.py)
# 저장 형식: "enc::<base64_token>"
encrypt("민감한 텍스트")          # → "enc::gAAAAAB..."
decrypt_if_needed("enc::gAAAAAB...") # → "민감한 텍스트"
```

카테고리별 암호화 ON/OFF는 `.env`의 `ENCRYPT_FAQ` / `ENCRYPT_PROMPT` / `ENCRYPT_DOCUMENT` 값으로 제어되며, 관리자 대시보드 설정 탭에서 토글 및 일괄 마이그레이션(평문↔암호화) 가능. 채팅 내용은 항상 암호화.

### SQLite → Aurora RDS 마이그레이션

로컬 개발 시 생성된 SQLite 데이터를 Aurora RDS로 이전할 때:

```bash
cd backend
python scripts/migrate_sqlite_to_rds.py
```

---

## 7. API 엔드포인트

### 채팅 API

| 메서드   | 경로                    | 설명                  |
| -------- | ----------------------- | --------------------- |
| `POST` | `/api/chat`           | 동기 채팅 (단일 응답) |
| `POST` | `/api/chat/stream`    | 스트리밍 채팅 (SSE)   |
| `GET`  | `/api/chat/suggested` | 추천 질문 목록        |

### 관리자 API (`Authorization: Bearer <JWT>` 헤더 필요)

**인증**

| 메서드   | 경로                       | 설명                                          |
| -------- | -------------------------- | --------------------------------------------- |
| `POST` | `/api/admin/auth/verify` | Google ID Token 검증 → JWT 발급 (8시간 유효) |

**권한 관리**

| 메서드     | 경로                               | 설명                      |
| ---------- | ---------------------------------- | ------------------------- |
| `GET`    | `/api/admin/permissions`         | 등록된 관리자 이메일 목록 |
| `POST`   | `/api/admin/permissions`         | 이메일 추가               |
| `DELETE` | `/api/admin/permissions/{email}` | 이메일 제거               |

**문서 관리**

| 메서드     | 경로                                  | 설명                                 |
| ---------- | ------------------------------------- | ------------------------------------ |
| `POST`   | `/api/admin/upload-pdf`             | PDF 업로드 → Markdown 변환          |
| `POST`   | `/api/admin/upload-md`              | Markdown 직접 업로드                 |
| `POST`   | `/api/admin/upload-faq-md`          | FAQ Markdown 업로드                  |
| `POST`   | `/api/admin/import-catalog`         | 카탈로그 일괄 가져오기               |
| `GET`    | `/api/admin/documents`              | 문서 목록                            |
| `GET`    | `/api/admin/documents/{id}`         | 문서 상세                            |
| `POST`   | `/api/admin/documents/{id}/approve` | 문서 승인 → 인덱싱 대상 포함        |
| `POST`   | `/api/admin/documents/{id}/reject`  | 문서 반려                            |
| `POST`   | `/api/admin/documents/{id}/restore` | 문서 복원                            |
| `DELETE` | `/api/admin/documents/{id}`         | 문서 삭제                            |
| `POST`   | `/api/admin/documents/{id}/retry`   | 처리 재시도                          |
| `POST`   | `/api/admin/reindex`                | FAISS 인덱스 전체 재구성 + S3 동기화 |

**FAQ 관리**

| 메서드     | 경로                     | 설명     |
| ---------- | ------------------------ | -------- |
| `GET`    | `/api/admin/faqs`      | FAQ 목록 |
| `POST`   | `/api/admin/faqs`      | FAQ 생성 |
| `PUT`    | `/api/admin/faqs/{id}` | FAQ 수정 |
| `DELETE` | `/api/admin/faqs/{id}` | FAQ 삭제 |

**프롬프트 관리**

| 메서드     | 경로                         | 설명          |
| ---------- | ---------------------------- | ------------- |
| `GET`    | `/api/admin/prompts`       | 프롬프트 목록 |
| `POST`   | `/api/admin/prompts`       | 프롬프트 생성 |
| `PUT`    | `/api/admin/prompts/{key}` | 프롬프트 수정 |
| `DELETE` | `/api/admin/prompts/{key}` | 프롬프트 삭제 |

**모니터링**

| 메서드  | 경로                            | 설명                                              |
| ------- | ------------------------------- | ------------------------------------------------- |
| `GET` | `/api/admin/sessions`         | 세션 목록                                         |
| `GET` | `/api/admin/sessions/{id}`    | 세션 상세                                         |
| `GET` | `/api/admin/logs`             | 처리 로그                                         |
| `GET` | `/api/admin/audit-logs`       | 관리자 감시 로그                                  |
| `GET` | `/api/admin/chat-logs`        | 상담 로그 (start_date, end_date, session_id 필터) |
| `GET` | `/api/admin/chat-logs/export` | 상담 로그 Excel 내보내기                          |

**설정**

| 메서드   | 경로                                          | 설명                                                  |
| -------- | --------------------------------------------- | ----------------------------------------------------- |
| `GET`  | `/api/admin/settings/model`                 | 현재 모델 + OpenAI 사용 가능 모델 목록                |
| `PUT`  | `/api/admin/settings/model`                 | LLM 모델 변경 (`app_settings`에 영구화 + 캐시 clear, 재시작 불필요) |
| `PUT`  | `/api/admin/settings/superadmin`            | 최상위 관리자 이메일 변경 (슈퍼어드민 본인만)         |
| `PUT`  | `/api/admin/password`                       | 레거시 관리자 비밀번호 변경                           |
| `GET`  | `/api/admin/settings/encryption`            | 카테고리별 암호화 설정 + 암호화/평문 레코드 수        |
| `PUT`  | `/api/admin/settings/encryption/{category}` | 암호화 ON/OFF 토글 (faq / prompt / document)          |
| `POST` | `/api/admin/settings/encryption/migrate`    | 해당 카테고리 전체 레코드 일괄 암호화↔복호화         |

**데이터 관리** (사용자 정의 데이터 테이블)

| 메서드     | 경로                                                  | 설명                                                       |
| ---------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| `GET`    | `/api/admin/data-tables`                            | 테이블 목록                                                |
| `POST`   | `/api/admin/data-tables`                            | 테이블 생성 → RDS에 실제 `cdata_{id}` SQL 테이블 CREATE |
| `GET`    | `/api/admin/data-tables/export-all`                 | 모든 테이블을 개요+시트별로 묶어 Excel 1개 다운로드        |
| `DELETE` | `/api/admin/data-tables/{id}`                       | 테이블 삭제 →`cdata_{id}` DROP TABLE                    |
| `GET`    | `/api/admin/data-tables/{id}`                       | 테이블 상세 (컬럼 + 데이터 행)                             |
| `POST`   | `/api/admin/data-tables/{id}/columns`               | 컬럼 추가 → ALTER TABLE ADD COLUMN                        |
| `PUT`    | `/api/admin/data-tables/{id}/columns/{cid}`         | 컬럼 이름 변경 → ALTER TABLE RENAME COLUMN                |
| `POST`   | `/api/admin/data-tables/{id}/columns/{cid}/reorder` | 컬럼 순서 위/아래 이동                                     |
| `DELETE` | `/api/admin/data-tables/{id}/columns/{cid}`         | 컬럼 삭제 → ALTER TABLE DROP COLUMN                       |
| `POST`   | `/api/admin/data-tables/{id}/rows`                  | 행 추가 → INSERT INTO                                     |
| `PUT`    | `/api/admin/data-tables/{id}/rows/{rid}`            | 행 수정 → UPDATE                                          |
| `DELETE` | `/api/admin/data-tables/{id}/rows/{rid}`            | 행 삭제 → DELETE                                          |
| `GET`    | `/api/admin/data-tables/{id}/export`                | 개별 테이블 Excel 내보내기                                 |
| `POST`   | `/api/admin/data-tables/{id}/import`                | CSV / Excel 파일로 행 일괄 가져오기                        |

**DB 브라우저** (RDS 전체 테이블 조회)

| 메서드  | 경로                            | 설명                                                      |
| ------- | ------------------------------- | --------------------------------------------------------- |
| `GET` | `/api/admin/db/tables`        | RDS 전체 테이블 목록 + 각 테이블 한국어 설명              |
| `GET` | `/api/admin/db/tables/{name}` | 테이블 데이터 페이지네이션 조회 (암호화 필드 자동 복호화) |

---

## 8. AWS 인프라 및 배포

### 인프라 구성

```
GitHub main 브랜치 push
        │
        ▼
GitHub Actions (self-hosted runner — EC2 위에서 직접 실행)
        │
        ├─ 1. git fetch && git reset --hard origin/main
        ├─ 2. backend/.env 생성 (GitHub Secrets → 환경변수 주입)
        ├─ 3. source backend/venv/bin/activate
        ├─ 4. pip install -r backend/requirements.txt
        ├─ 5. cd frontend && npm install && npm run build
        └─ 6. sudo systemctl restart chatbot
                │
                ▼
        EC2 인스턴스
        ├─ 백엔드: uvicorn (포트 8888)
        ├─ 프론트엔드: Vite 빌드 정적 파일
        └─ FAISS 인덱스: EC2 로컬 (/data/faiss_index/)
```

### AWS 서비스 역할

| 서비스     | 용도                                                            |
| ---------- | --------------------------------------------------------------- |
| EC2        | 백엔드(FastAPI) + 프론트엔드(빌드 결과물) 호스팅                |
| Aurora RDS | 운영 데이터베이스 (PostgreSQL 호환, 고가용성)                   |
| S3         | FAISS 인덱스 + 문서 파일(PDF, MD, JSON, 청크, 임베딩) 영구 저장 |

### S3 버킷 구조

```
s3://<bucket>/document-chatbot/
├── faiss/
│   ├── index.faiss        ← FAISS 벡터 인덱스
│   └── index.pkl          ← 메타데이터 (문서 ID 매핑)
└── documents/
    └── <logical_name>/
        └── v<N>/
            ├── document.md
            ├── chunks.json
            └── embeddings.npy
```

### GitHub Secrets (배포 환경변수)

| 시크릿 이름               | 용도                                                     |
| ------------------------- | -------------------------------------------------------- |
| `OPENAI_API_KEY`        | OpenAI API 인증                                          |
| `ENCRYPTION_KEY`        | Fernet 암호화 키 (base64)                                |
| `ADMIN_PASSWORD`        | 레거시 (현재 Google OAuth로 대체, 유지 가능)             |
| `DATABASE_URL`          | Aurora RDS 연결 문자열                                   |
| `AWS_ACCESS_KEY_ID`     | AWS 자격증명                                             |
| `AWS_SECRET_ACCESS_KEY` | AWS 자격증명                                             |
| `AWS_S3_BUCKET`         | S3 버킷명                                                |
| `CHANNEL_TALK_URL`      | 채널톡 상담원 연결 URL                                   |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth 클라이언트 ID (프론트 + 백엔드 공용)        |
| `JWT_SECRET`            | JWT 서명 비밀키 (8시간 세션 토큰)                        |
| `ADMIN_EMAIL`           | 최초 부트스트랩 관리자 이메일 (DB 없이도 항상 접근 가능) |
| `LANGSMITH_API_KEY`     | LangSmith 추적                                           |
| `LANGSMITH_PROJECT`     | LangSmith 프로젝트명                                     |

---

## 9. 보안 설계

### Guardrail (guardrail_service.py)

감지 항목 및 처리:

| 항목                                            | 처리 방식        |
| ----------------------------------------------- | ---------------- |
| 프롬프트 인젝션 (DAN mode, 역할극, 시스템 무시) | **하드 차단** (LLM에 닿으면 안 됨) |
| 개인정보 (주민등록번호·카드·계좌 패턴)          | **하드 차단** + 안내 |
| 욕설/비하 · 분노/비난                           | **의도 기반 분기** (아래) |
| 경쟁사 언급                                     | 엔코아 강점 소개로 전환 |

**욕설/분노 정책 (디에스컬레이션)** — 화난 진짜 고객을 차단해 이탈시키지 않는다:

- 욕설·분노가 **환불/취소/문의 등 실제 서비스 의도와 함께** 오면 → 차단하지 않고 **라우터로 전달**
  → 환불/취소·불만은 **상담 매니저 연결(handoff)**, 단순 정보질문은 **차분히 답변**.
- **의도 없는 순수 욕설/분노**만 → 부드러운 경계 메시지("편하게 말씀해 주세요, 도와드릴게요").
- 인젝션·개인정보는 정책과 무관하게 **항상 하드 차단**.

### 데이터 암호화

- **알고리즘**: Fernet (AES-128-CBC + HMAC-SHA256)
- **대상**: 사용자 이름, 메시지 내용, 상담 질문/답변, FAQ 전체 내용
- **식별자**: 암호화된 값은 `enc::` 접두사로 구분하여 선택적 복호화

### 관리자 인증 (Google OAuth 2.0 + JWT)

```
1. 관리자 → Google One Tap 로그인 → Google ID Token 발급
2. POST /api/admin/auth/verify  { credential: "<Google ID Token>" }
   → google-auth로 토큰 검증
   → 이메일이 ADMIN_EMAIL 또는 admin_users 테이블에 있으면 허용
   → JWT(8시간 유효, HS256) 발급

3. 이후 모든 /api/admin/* 요청:
   Authorization: Bearer <JWT>

4. 401 응답 시 프론트엔드가 토큰 삭제 + 페이지 리로드
```

부트스트랩: `.env`의 `ADMIN_EMAIL`은 DB 미등록 상태에서도 항상 접근 허용 → 최초 설정 후 `admin_users`에 추가 이메일 등록 가능.

### 관리자 감시 로그 (admin_audit_logs)

모든 관리자 작업(문서 업로드/승인/삭제, FAQ 수정, 프롬프트 변경)이 `admin_audit_logs` 테이블에 기록됨

---

## 10. 프론트엔드 구조

### 페이지 구성

| 경로                    | 컴포넌트                 | 설명                     |
| ----------------------- | ------------------------ | ------------------------ |
| `/`                   | `ChatPage.tsx`         | 메인 채팅 인터페이스     |
| `/admin`              | `AdminPage.tsx`        | 관리자 대시보드 (8개 탭) |
| `/admin/sessions/:id` | `AdminSessionPage.tsx` | 세션 상세                |

**AdminPage 탭 구성**

| 탭            | 설명                                                                         |
| ------------- | ---------------------------------------------------------------------------- |
| 문서 관리     | PDF/Markdown 업로드, 승인/반려, 재시도                                       |
| FAQ 관리      | FAQ 조회/생성/수정/삭제                                                      |
| 프롬프트      | 시스템 프롬프트 런타임 편집                                                  |
| 로그/내보내기 | 상담 로그 필터 조회 + Excel 내보내기                                         |
| 데이터 관리   | 커스텀 SQL 테이블 CRUD + 컬럼 이름/순서 변경 + CSV·Excel 가져오기·내보내기 |
| DB 브라우저   | RDS 전체 테이블 탐색 + 암호화 필드 복호화 표시                               |
| 설정          | LLM 모델 선택 + 카테고리별 암호화 ON/OFF + 일괄 마이그레이션                 |
| 권한 관리     | 관리자 이메일 추가/제거                                                      |

### 핵심 커스텀 훅 (useChat.ts)

```typescript
const {
    messages,            // 메시지 목록
    isLoading,           // 응답 대기 중
    suggestedQuestions,  // 추천 질문 버튼
    sendMessage,         // 메시지 전송
    stopGenerating,      // 응답 중단
    startNewChat,        // 새 대화 시작 (헤더 버튼) — 현재 대화는 기록에 자동 저장 후 새 세션
    loadConversation,    // 과거 대화 복원 (기록 패널)
} = useChat()
```

### 스트리밍 응답 처리

```typescript
// Server-Sent Events — 토큰 단위 수신 → 메시지 실시간 업데이트
await chatApi.streamMessage(
    sessionId, message, history,
    onToken,  // 토큰마다 화면 업데이트
    onDone,   // 완료 시 source 정보 수신
    onError
)
```

### 세션 저장소 (sessionStorage)

```typescript
"chatConversations:v2"      // 대화 목록 (제목, 메시지, 세션ID)
"chatCurrentConvId:v2"      // 현재 대화 ID
"chatScroll:v1:{convId}"    // conversation별 스크롤 위치 (새로고침/뒤로가기 후 복원)
"adminToken"                // 관리자 JWT (탭 세션 한정, 8시간 유효)
```

### 스크롤 위치 복원

- 대화별로 마지막 스크롤 위치를 sessionStorage에 저장 → 새로고침·뒤로가기 후에도 같은 위치
- 사용자가 위쪽을 보는 중이면 새 토큰이 와도 따라가지 않음 (맨 아래 80px 이내일 때만 auto-scroll)

### 모바일 폼팩터 채팅 UI

- 화면 가운데 모바일 폰 비율 카드(`max-w-[440px]`) 형태로 고정 — 데스크탑·태블릿·모바일 모두 같은 경험
- 둥근 모서리(`rounded-[2.25rem]`) + 부드러운 그라데이션 배경(`radial-gradient`) + 그림자(`shadow-[0_24px_80px_rgba(15,23,42,0.18)]`)
- 헤더: AI 로고 + "코아 / 엔코아 AI 캠퍼스 상담 챗봇" + **새 대화**·홈·기록 버튼
  - **새 대화**: 진행 중 응답 중단 + 새 세션으로 리셋(현재 대화는 기록에 자동 저장 → 잃지 않음)
  - **기록**: 과거 대화 검색·복원
- 말풍선: 사용자(파란 배경 우측 정렬) · AI(흰색 카드 좌측 정렬 + AI 아바타)
- 추천 질문(`SuggestedQuestions`): 두 줄을 하나의 `overflow-x-auto` 컨테이너로 묶어 좌우 함께 스크롤
- 입력란: 텍스트영역 자동 높이 조절(세로 중앙 정렬), Enter로 전송 / Shift+Enter 줄바꿈

### 말풍선 가독성

- 마크다운 목록(`-`)을 `<ul>/<li>`로 변환, 항목 사이 `space-y-2`(8px) 간격
- 마크다운 링크는 파란 글자 + 밑줄 + 외부 링크 화살표(↗)로 명확히 구분, 새 탭으로 열림
- **강조 렌더링(`normalizeEmphasis`)**: `**굵게**`가 화면에 `**` 리터럴로 새지 않게 정규화 — ① 스트리밍/분할로 안 닫힌 `**` 균형 맞춤, ② 닫는 `**`가 구두점 뒤에 와 CommonMark가 안 닫는 경우(예: `...영상)**을`) 폭0 문자 삽입으로 닫힘 보장. 강조는 `font-bold`로 진하게.
- **빈 말풍선 방지**: 백엔드가 빈 답변으로 끝나면 안전 폴백을 스트리밍하고, 프론트도 보이는 글자 없는 조각은 말풍선에서 제외(스트리밍 중 미완성 마크다운 흡수).
- 백엔드 후처리(`response_formatter`)가 잘못된 별표 표기(`** 단어 **`)와 문장 끝 줄바꿈을 자동 정규화
- `MAX_BUBBLES = 8` — 한 답변이 헤더 + 항목 여러 개로 쪼개져도 모두 노출

---

## 11. 관리자 대시보드 기능

### 인증 흐름

Google One Tap 로그인 → ID Token 전송 → 백엔드 검증 → JWT 발급 → sessionStorage 저장 → 이후 모든 API에 Bearer 자동 첨부. 401 수신 시 자동 로그아웃.

### 설정 탭

**LLM 모델 선택**

- OpenAI API에서 사용 가능한 채팅 모델 목록 실시간 조회 (TTS·이미지·임베딩·레거시 모델 자동 제외)
- 라디오 카드 방식 — 모델별 설명·속도·컨텍스트·입출력 단가($/1M tok) 표시
- 추천순·지능순·가성비순·가격순·속도순 정렬, 클릭마다 오름/내림 토글
- 선택 후 "선택한 모델로 적용" → `.env` 즉시 갱신 + 설정 캐시 clear → 재시작 없이 반영

**암호화 설정**

```
카테고리별 암호화 관리:
  ┌──────────────────┬────────┬───────┬───────┐
  │ 카테고리          │ 암호화  │ 암호화 │ 평문  │
  │                  │ ON/OFF │  건수 │  건수 │
  ├──────────────────┼────────┼───────┼───────┤
  │ FAQ 내용          │ 토글   │   N건 │   M건 │
  │ 프롬프트 내용     │ 토글   │   N건 │   M건 │
  │ 문서 파일명·검토  │ 토글   │   N건 │   M건 │
  │ 채팅 내용         │ 항상 ON│  (고정)│       │
  └──────────────────┴────────┴───────┴───────┘

토글: .env 갱신 → 이후 쓰기 시 반영
마이그레이션 버튼: 기존 레코드 전체를 즉시 암호화↔복호화
```

### 권한 관리 탭

- **최상위 관리자 카드**: `.env`의 `ADMIN_EMAIL` 계정을 상단에 별도 표시. 삭제 불가·모든 권한 보유
- **관리자 목록**: 이메일·추가자(added_by)·추가 일시 표시. 현재 로그인 계정에 "나" 뱃지
- **관리자 추가/제거**: 이메일 입력 후 추가, 불필요 시 제거
- **최상위 관리자 이메일 변경**: 슈퍼어드민 본인 로그인 시에만 변경 폼 노출. 변경 후 2초 뒤 자동 로그아웃

### 데이터 관리 탭 (커스텀 SQL 테이블)

비개발자도 브라우저에서 구조화 데이터를 관리할 수 있는 기능:

```
1. 테이블 생성 → RDS에 cdata_{id} CREATE
2. 컬럼 추가 (text/number/date) → ALTER TABLE ADD COLUMN
3. 컬럼 이름 변경 → ALTER TABLE RENAME COLUMN
4. 컬럼 순서 변경 (↑↓) → sort_order 재정렬
5. 행 CRUD → INSERT / UPDATE / DELETE
6. CSV / Excel 가져오기 → 헤더 자동 매핑 후 일괄 INSERT
7. Excel 내보내기 (개별) → 선택 테이블 .xlsx
8. Excel 내보내기 (전체) → 개요 시트 + 테이블별 시트로 구성
```

- 컬럼 타입 → SQL 매핑: `text` → TEXT, `number` → NUMERIC, `date` → DATE
- 생성된 테이블은 DB 브라우저 탭에서도 즉시 확인 가능

### DB 브라우저 탭

RDS Aurora의 전체 테이블을 안전하게 탐색·편집:

- 모든 시스템 테이블에 한국어 설명 + 호버 시 풀텍스트·컬럼 일람 floating 카드
- `cdata_*` 테이블은 데이터 관리에서 입력한 테이블명/설명으로 표시
- 암호화된 필드(`enc::` 접두사) 자동 복호화 후 원문 표시
- 페이지네이션 지원 (기본 50행, 최대 200행/페이지)
- **행 편집·삭제 (화이트리스트)** — `faqs`, `chat_logs`, `processing_logs`, `cancel_requests` 4개 테이블에 한해 ✏️🗑 버튼 노출. 보호 컬럼(`id`, `created_at`, `updated_at`)은 수정 불가, 암호화 카테고리 토글 상태에 맞춰 자동 enc 처리, 모든 변경은 `admin_audit_logs`에 기록
- **테이블 자체 삭제 (화이트리스트)** — `cdata_*` 동적 테이블 및 `chat_logs`/`processing_logs`/`cancel_requests`/`admin_audit_logs` 로그성 테이블에 한해 🗑 "테이블 삭제" 버튼. `cdata_*` 삭제 시 `custom_tables`·`custom_columns` 메타도 함께 정리
- **편집·삭제 불가 사유 안내** — `chunks`(FAISS 의존)·`documents`(문서 검토 탭 전용)·`chat_messages`/`chat_sessions`(대화 무결성)·`admin_users`(권한 관리 탭 전용)·`prompt_configs`(프롬프트 탭 전용)·`faqs`(FAQ 관리 탭 전용) 등은 헤더 아래 호박색 배너로 "왜 안 되는지" 한 줄 안내

### 문서 검토 탭

- PDF → MD 변환, 일반 MD 등록, MD → FAQ JSON 변환, **FAISS 인덱스 재구성** 4종 카드
- "FAISS 인덱스 재구성" 호박색 카드: 승인된 모든 문서를 재임베딩하고 인덱스 재생성 + S3 자동 동기화. 문서 본문 변경 후 한 번 눌러야 검색 결과에 반영됨

---

## 12. RAG 품질 평가 결과 (RAGAS)

평가 일시: 2026-06-01 | 평가 도구: [RAGAS](https://github.com/explodinggradients/ragas)
구성: 생성 모델 `gpt-5.4-nano`, 임베딩 `text-embedding-3-large` (3072차원) | 총 **102문항** (RAGAS 채점 87 + 환각/거절 테스트 15)

> ※ 개인정보보호법·표시광고법 등 **"법 내용을 설명해달라"는 질문**은 답변 대상이 아니라 **거절 대상**이므로(법은 내부 준수 기준으로만 사용, 내용은 노출 안 함) 거절 테스트로 분류해 측정함.

### RAGAS 4대 지표 (RAGAS 채점 87문항)

| 지표                  | 점수          | 설명                                                |
| --------------------- | ------------- | --------------------------------------------------- |
| **Context Recall**    | **0.929**     | 정답에 필요한 문서를 빠짐없이 검색했는지 (재현율)    |
| **Context Precision** | **0.746**     | 검색된 문서 중 실제 필요한 비율 (정밀도)            |
| **Faithfulness**      | **0.740**     | 답변이 검색된 문서 내용에 근거한 비율               |
| **Answer Relevancy**  | **0.095** ⚠️  | 측정 아티팩트(아래 해석) — 품질 신호로 신뢰하지 않음 |

### Hallucination / 법률 거절 테스트 (15문항)

| 항목             | 결과                                                |
| ---------------- | --------------------------------------------------- |
| 테스트 케이스    | 15개 (문서에 없는 정보 + 법률 내용 질문)            |
| 자동 통과        | 11/15 (73%)                                         |
| **실질 통과**    | **~14/15** — 자동 미탐 3건은 정상 거절을 키워드 탐지기가 못 센 것, **사실 날조 0건** |

### 해석 — 왜 이 값인가

- **Context Recall 0.93**: 3072차원 임베딩 + 인덱스 재구성으로 거의 모든 질문에서 근거 문서를 찾음.
- **Context Precision 0.75**: 관련 문서를 잘 찾되 노이즈 일부 혼입 — 리랭커/top_k 재튜닝 여지.
- **Faithfulness 0.74**: 답변의 약 3/4가 문서 근거. 나머지는 상담형 공감·일반조언 패딩. 생성 모델 A/B(`nano`↔`mini`)에서 동일 → **모델 무관, 프롬프트 영향** (프롬프트 강화로 0.69→0.74 개선).
- **Answer Relevancy 0.095 ⚠️**: `1 generation` 설정 + 되묻기 스타일이 겹쳐 0으로 수렴하는 **측정 아티팩트**. 실제 관련성과 무관 → **품질 지표로 신뢰하지 않음**.
- **환각/거절**: **사실 날조 0건**. 자동 통과율(11/15)이 낮은 건 키워드 기반 탐지기가 정상 거절을 못 센 것으로, 실질 ~14/15.
- ⚠️ 위 수치는 **하이브리드 라우터 도입·"먼저 답하기" 답변 스타일 변경 이전** 측정값이다. RAGAS는 라우팅을 거치지 않고 RAG 코어만 측정하므로 라우팅 변경 영향은 없으나, 생성 스타일 변화는 재측정 시 Faithfulness에 반영될 수 있다(상향 기대).

---

## 13. 디렉토리 구조

```
document-chatbot_practice/
├── .github/
│   └── workflows/
│       └── deploy.yml              ← CI/CD (EC2 self-hosted runner)
│
├── backend/
│   ├── app/
│   │   ├── main.py                 ← FastAPI 애플리케이션 진입점
│   │   ├── config.py               ← 설정 (pydantic-settings, .env 로드)
│   │   ├── db/
│   │   │   ├── models.py           ← SQLAlchemy ORM 모델 (custom_tables, custom_columns 포함)
│   │   │   ├── database.py         ← Aurora RDS 연결 및 세션
│   │   │   ├── crud.py             ← CRUD 유틸리티
│   │   │   └── migrations.py       ← 스키마 마이그레이션
│   │   ├── routers/
│   │   │   ├── chat.py             ← 채팅 API 라우터
│   │   │   └── admin.py            ← 관리자 API 라우터
│   │   ├── services/
│   │   │   ├── rag_service.py      ← FAISS 벡터 검색 + 하이브리드 검색
│   │   │   ├── document_service.py ← 검색 전략 결정 (build_retrieval_plan)
│   │   │   ├── openai_service.py   ← gpt-5.4-mini 호출 + FAQ 재서술 + SSE 스트리밍 (wrap_openai 추적)
│   │   │   ├── router_service.py    ← 하이브리드 라우터 (결정적 패스 + LLM 의미 라우팅)
│   │   │   ├── graph_service.py     ← LangGraph 파이프라인 (retrieve→generate→verify, 핵심 사실 시트 상주)
│   │   │   ├── intent_service.py    ← LLM 의도 분류 (라우터 보조)
│   │   │   ├── model_settings.py    ← 런타임 LLM 모델 영구화 (app_settings 테이블)
│   │   │   ├── faq_service.py      ← FAQ 유사도 매칭
│   │   │   ├── guardrail_service.py← 입력 안전 필터
│   │   │   ├── admin_service.py    ← 문서 업로드/처리/승인 워크플로우
│   │   │   ├── prompt_service.py   ← Aurora RDS 기반 프롬프트 런타임 관리
│   │   │   ├── storage_service.py  ← AWS S3 파일 입출력
│   │   │   ├── transformation_service.py ← FAQ Markdown → DB 변환
│   │   │   └── response_formatter.py← 응답 마크다운 포매팅
│   │   ├── models/
│   │   │   ├── chat.py             ← Pydantic 요청/응답 스키마
│   │   │   └── session.py
│   │   └── utils/
│   │       ├── crypto.py           ← Fernet 암호화/복호화
│   │       └── pdf_converter.py    ← PDF → Markdown 변환
│   ├── scripts/
│   │   └── migrate_sqlite_to_rds.py ← SQLite → Aurora RDS 데이터 이전
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx                 ← 라우팅 설정
│   │   ├── pages/
│   │   │   ├── ChatPage.tsx
│   │   │   ├── AdminPage.tsx
│   │   │   └── AdminSessionPage.tsx
│   │   ├── components/chat/
│   │   │   ├── ChatWindow.tsx
│   │   │   ├── InputBar.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── SuggestedQuestions.tsx
│   │   │   └── HistoryPanel.tsx
│   │   ├── hooks/useChat.ts
│   │   ├── services/api.ts
│   │   └── types/index.ts
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
│
├── data/
│   ├── faiss_index/                ← FAISS 인덱스 (git 제외, S3 동기화)
│   ├── faq/                        ← FAQ JSON
│   ├── docs/                       ← 원본 문서
│   ├── managed_docs/               ← 관리 대상 Markdown
│   ├── managed_chunks/             ← 청크 파일
│   ├── managed_embeddings/         ← 임베딩 벡터
│   └── managed_json/               ← JSON 변환본
│
└── scripts/                        ← 유틸리티 스크립트 (PDF 처리 등)
```

---

## 14. 로컬 개발 환경

### 사전 요구사항

- **Python 3.12+**
- **Node.js 18+** (Vite 5 호환)
- OpenAI API 키 (`OPENAI_API_KEY`)
- AWS 자격증명 (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`)
- (선택) Google OAuth Client ID — 관리자 페이지 로그인 테스트용

### 환경변수 (`backend/.env`)

```env
# OpenAI
OPENAI_API_KEY=sk-...
MODEL_NAME=gpt-5.4-mini                 # 생성 모델 (관리자 콘솔에서 런타임 교체 가능)
INTENT_MODEL_NAME=gpt-5.4-nano         # 라우터/의도 분류 모델
EMBEDDING_MODEL=text-embedding-3-large # 검색 임베딩 (3072차원)
REJECT_THRESHOLD=1.0                    # (재설계 후 미사용 — 하드 거절 폐지, 호환 위해 유지)
VERIFY_THRESHOLD=3.5                    # 이 미만이면 사실성 재검증

# Database (Aurora RDS 또는 로컬 PostgreSQL)
DATABASE_URL=postgresql://user:password@host:5432/chatbot

# AWS
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=your-bucket-name
AWS_S3_PREFIX=document-chatbot

# 보안
ENCRYPTION_KEY=<Fernet 키, 32바이트 base64>
JWT_SECRET=<무작위 문자열, 32자 이상>

# 관리자 부트스트랩
ADMIN_EMAIL=you@example.com
GOOGLE_CLIENT_ID=<Google OAuth 클라이언트 ID>

# 채널톡·홈페이지
CHANNEL_TALK_URL=https://...
HOMEPAGE_URL=https://encorecampus.ai/

# LangSmith (선택)
LANGSMITH_API_KEY=...
LANGSMITH_PROJECT=document-chatbot
LANGSMITH_TRACING=true
```

`backend/.env.example`을 복사해서 시작하세요. ENCRYPTION_KEY는 다음으로 생성:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### 백엔드 실행

```bash
cd backend

# 가상환경 생성 (최초 1회)
python -m venv venv

# 활성화
# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

# 의존성 설치
pip install -r requirements.txt

# 서버 시작 (포트 8888)
python -m uvicorn app.main:app --reload --port 8888 --host 0.0.0.0
```

→ <http://localhost:8888>
→ API 문서: <http://localhost:8888/docs>

### 프론트엔드 실행

```bash
cd frontend

# 의존성 설치 (최초 1회)
npm install

# 개발 서버 시작 (포트 5173, HMR 지원)
npm run dev
```

→ <http://localhost:5173>

### 한 번에 실행 (Windows)

루트의 두 스크립트 중 편한 걸 사용:

```bash
# CMD
start_servers.bat

# PowerShell
.\start_servers.ps1
```

각각 백엔드·프론트 터미널 두 개가 자동으로 열립니다. 브라우저로 <http://localhost:5173> 접속.

### 자주 쓰는 명령

| 작업 | 명령 |
|------|------|
| 백엔드 의존성 추가 | `pip install <패키지> && pip freeze > requirements.txt` |
| 프론트 타입체크 + 빌드 | `npm run build` (`tsc && vite build`) |
| 프론트 린트 | `npm run lint` |
| DB 스키마 자동 적용 | 백엔드 시작 시 `migrate_database()` 자동 실행 |
| FAISS 인덱스 재구성 | 관리자 페이지 → 문서 검토 → "🗑 FAISS 인덱스 재구성" |
| SQLite → RDS 마이그레이션 | `cd backend && python scripts/migrate_sqlite_to_rds.py` |

### 트러블슈팅

- **포트 충돌**: 8888·5173이 이미 사용 중이면 `--port` 옵션 또는 `vite.config.ts`에서 변경
- **DB 연결 실패**: `DATABASE_URL` 확인. RDS 사용 시 보안그룹에 로컬 IP 허용 필요
- **OpenAI 401**: API 키 만료 또는 사용량 초과
- **FAISS 인덱스 없음**: 서버 첫 시작 시 S3에서 다운로드. S3 권한 또는 버킷명 확인
- **관리자 로그인 실패**: `ADMIN_EMAIL`이 `.env`에 설정돼 있는지 + Google OAuth Client ID가 같은 도메인(localhost)에 등록돼 있는지

---

## 15. 프로젝트 진화 (Before → After)

> 최초 릴리스(2026-06-12) 이후 **운영 대화 로그(약 854건, 5.5주)** 를 분석해
> "데이터 → 분석 → 실모델 A/B 검증 → 패치" 사이클로 시스템을 다듬어 왔습니다.
> 아래는 주요 변화의 전/후 대조와 그 근거·결과입니다.

### 한눈에 보기

| 영역          | Before                                          | After                                                          | 결과 / 근거                                  |
| ------------- | ----------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------- |
| 라우팅        | 5겹 휴리스틱 (키워드 점수·의도분류·결정 단축 혼재) | 1 게이트 + 1 하이브리드 라우터 (결정적 패스 + LLM 의미 라우팅)   | 회귀 게이트 41/48(85%) → **48/48(100%)**     |
| 검색 임베딩   | `text-embedding-3-small` (1536d)                | `text-embedding-3-large` (3072d) + 인덱스 재구성               | **Context Recall 0.93**                      |
| 생성 모델     | `gpt-5-mini`                                     | `gpt-5.4-nano` (런타임 교체 가능, `app_settings` 영구화)        | 비용·속도↓, 사실성은 모델 무관(아래)         |
| 답변 스타일   | 캐묻기형 (되묻기 잦음)                           | "먼저 답하기" (결론 우선, 1회만 되묻기) + 되묻기 연쇄 차단      | 대화 단축, 결론 도달률↑                      |
| 사실성        | 일반론·과정 혼입·취업률 환각 위험                | 과정 격리 + 멀티턴 정정 + 취업률/법률 결정적 가드              | 환각 **사실 날조 0건** (실질 ~14/15)         |
| 관측성        | trace 미기록                                    | `wrap_openai`로 전 경로 LangSmith 추적                          | 운영 로그 기반 회귀 검증 루프 확립           |
| 안전 정책     | 욕설·분노 일괄 차단                             | 디에스컬레이션 (서비스 의도 동반 시 상담 연결)                 | 진성 고객 이탈 방지                          |
| 응답 동작     | 문서 받아쓰기형 (긴 답·되묻기 루프·자꾸 회피)   | 사실 근거 추론형 상담사 (짧게·결론 먼저·선택지로 닫기) + FAQ 재서술 + 생성 모델 mini | 길이 614→201자·되묻기 63→0%·회피 36→2% (100문항) |

### 1) 라우팅 재설계 — 5겹 휴리스틱 → 1게이트 + 1라우터

- **무엇을·왜**: 키워드 점수 매칭·의도분류·결정적 단축이 겹쳐 의미 충돌이 잦았다 (예: "취업"이 "선발"로 오라우팅).
- **어떻게**: 명백한 질문(개강 시점·버튼 정확일치)은 LLM 없이 결정적으로 처리하고, 애매한 자연어는 LLM 라우터(`gpt-5.4-nano`, temperature=0, 구조화 출력)가 handler + faq_id + search_query를 '의미'로 선택. LLM 실패 시 키워드 fallback 안전망.
- **결과**: `scripts/diag_router.py`(48케이스 회귀 게이트) 기준 **85% → 100%**. alias에 없는 패러프레이즈("일자리 연결해줘?" → 취업지원)도 정확 분류.

### 2) 검색 임베딩 상향 — 1536d → 3072d

- **무엇을·왜**: 근거 문서 검색 재현율을 높이려고 `text-embedding-3-large`(3072차원)로 교체하고 FAISS 인덱스를 재구성.
- **결과**: **Context Recall 0.93** — 거의 모든 질문에서 근거 문서를 확보.

### 3) 생성 모델 — gpt-5-mini → gpt-5.4-nano (+ 런타임 교체)

- **무엇을·왜**: 비용·속도 최적화를 위해 nano 계열로 이동. 관리자 콘솔에서 재시작 없이 모델 교체가 가능하고, 선택값은 `app_settings` 테이블에 영구 저장돼 배포 후에도 유지된다.
- **핵심 발견**: 생성 모델 A/B(`nano` ↔ `mini`)에서 Faithfulness가 **동일** → 답변 사실성은 모델이 아니라 **프롬프트가 좌우**한다. 프롬프트 강화로 **Faithfulness 0.69 → 0.74** 개선.

### 4) 답변 스타일 — 캐묻기 → "먼저 답하기"

- **무엇을·왜**: 과도하게 되묻는 흐름을 결론 우선으로 전환. 다만 "먼저 답하기"가 **되묻기 연쇄**로 변질되는 부작용을 운영 로그에서 발견.
- **어떻게**: 직전 답변이 질문이고 사용자가 방금 답한 턴에는 추가 확인질문을 막고, 결론 + 다음 행동(지원/상담)으로 닫도록 강제(`NO_REASK_DIRECTIVE`). 첫 되묻기는 허용, 결론을 주면 자동 해제.

### 5) 사실성·안전 강화 (운영 로그 854건 분석)

- **과정 간 커리큘럼 혼입 차단**: 한 과정만 지목된 질문은 타 과정 문서를 검색에서 제외 (오케스트레이션 질문에 MLOps의 Kubernetes·CI/CD를 끌어오는 환각 방지) + 프롬프트에 전이 금지 규칙.
- **멀티턴 정정 원칙**: 봇 자신의 과단정 답변을 사실로 굳히지 않고, "맞지?" 식 유도에 무조건 동의하지 않음.
- **취업률·법률 결정적 가드**: 미사용이던 결정적 답변을 라우터 앞단에 연결해 환각 수치로 인한 표시·광고법 리스크 차단.
- **결과**: 환각 **사실 날조 0건**(실질 ~14/15).

### 6) 관측성 — LangSmith 추적 복구

- **무엇을·왜**: trace가 전혀 안 남던 문제를 2단계로 수정. ① `.env`를 `os.environ`에도 반영 + 트레이싱 플래그를 표준 키(`LANGSMITH_TRACING`)로 정규화. ② 라이브 `/stream`이 우회하던 공유 OpenAI client를 `wrap_openai`로 래핑해 라우터·의도·생성·스트리밍·verify **전 경로 자동 기록**.
- **결과**: 운영 로그 기반 회귀 검증 루프의 토대 마련.

### 7) 응답 동작 재설계 — 수동적 FAQ봇 → 능동적 AI 상담사 (2026-06)

#### 문제 상황

운영 로그(LangSmith)를 확인해 보니 챗봇이 사용자의 질문에 바로 답하기보다 문서 내용을 길게 옮겨 적는 경향이 있었다. 답변 길이가 길어 사용자가 읽기 어렵고, 간단히 추론해서 답할 수 있는 질문에도 "확인된 자료가 없다"는 식으로 회피하거나 되묻는 흐름이 반복됐다. FAQ 답변도 저장된 문장을 그대로 노출하는 경우가 많아, 실제 상담 대화라기보다는 정적인 FAQ 페이지를 읽어 주는 느낌이 강했다.

라이브 점검 과정에서는 더 구체적인 문제가 드러났다. 나이 제한·지원 자격처럼 교육 과정과 직접 관련된 질문이 가끔 `out_of_scope`로 오분류됐고, 사용자가 "뭔소리야", "엥", "다시 설명해줘"처럼 이해하지 못했다는 반응을 보이면 직전 맥락을 쉽게 풀어 설명하기보다 상담 연결이나 일반 안내로 빠지는 경우가 있었다. 또한 "문서 기준으로는", "자료에 없어서"처럼 내부 데이터 한계를 드러내는 표현이 답변에 섞였고, 사용자가 말한 나이·거주 형태 같은 민감한 개인 특성을 답변에서 그대로 되받는 위험도 있었다.

#### 해결 방법

응답 생성 프롬프트를 `CHAT_STYLE_GUIDE` 중심의 긴 규칙 묶음에서 `COUNSELOR_GUIDE` 중심의 상담사형 지침으로 재설계했다. 핵심 원칙은 결론 먼저 답하기, 짧게 말하기, 문서에 같은 문장이 없어도 핵심 사실과 상식으로 합리적으로 추론하기, 불필요한 되묻기를 줄이고 실제로 답할 수 있는 다음 선택지만 제안하기였다. 취업률·법률·경쟁사 비교·개인정보·외부 컨설팅·브랜딩·구체 통계·민감 특성처럼 안전하게 제한해야 하는 영역은 코드와 프롬프트 양쪽에서 고정했다.

검색 점수가 낮으면 바로 거절하던 흐름도 바꿨다. `CANONICAL_FACTS`(핵심 사실 시트)를 시스템 프롬프트에 상주시켜 교육비, 기간, 지원 자격 같은 자주 쓰는 사실은 검색 실패에 흔들리지 않게 했고, RAG 검색 결과가 약하더라도 LLM이 사실과 추론으로 먼저 답하도록 했다. 대신 진짜 교육 범위 밖 질문은 라우터가 RAG 이전 단계에서 걸러내도록 역할을 분리했다.

FAQ 응답도 개선했다. 저장된 FAQ 카드를 그대로 반환하지 않고 `restyle_faq_answer`를 통해 사실·수치·조건은 보존한 채 짧은 상담 말투로 다시 표현하도록 했다. 메뉴성 FAQ(`guide`)도 같은 방식으로 재서술해, 버튼이나 FAQ에서 온 답변과 생성 답변의 톤이 크게 달라지지 않도록 맞췄다.

라이브 점검에서 발견된 사례는 별도로 보정했다. 혼란 표현("뭔소리야·엥")은 상담사 연결이 아니라 직전 대화 맥락을 보고 더 쉽게 재설명하도록 라우팅했고, 비유나 예시는 한 번만 사용한 뒤 실제 상담 흐름으로 돌아오게 했다. 평균 나이·입사자 수처럼 확정 수치를 줄 수 없는 질문은 "자료가 없어서"라는 메타 설명 없이 자연스럽게 안내를 제한하도록 했고, 나이 제한 여부는 "나이 제한 없음"으로 명확히 답하도록 했다. 민감한 개인 특성은 답변에서 되받아 강조하지 않도록 했으며, 오타와 축약 표현은 앞뒤 맥락으로 의도를 추론하게 했다.

생성 모델은 짧은 프롬프트에서 지시 준수와 추론 품질이 더 안정적인 `gpt-5.4-mini`로 조정했다. 운영 반영 시 DB의 `active_model`도 `gpt-5.4-mini`로 맞춰야 한다.

#### 결과

실제 로그 100문항 기준으로 답변 길이 중앙값이 **614자 → 201자**로 줄었다. 되묻기 비율은 **63% → 0%**, 회피 응답은 **36% → 2%**로 개선됐고, 적대적 안전 배터리도 **13/13** 통과했다. 결과적으로 챗봇은 문서를 길게 읽어 주는 FAQ봇에서, 사용자의 질문 의도를 파악해 짧고 명확하게 답하는 상담사형 챗봇에 가까워졌다.

> ⚠️ [12. RAG 품질 평가](#12-rag-품질-평가-결과-ragas)의 RAGAS 수치는 **라우터 재설계·"먼저 답하기" 도입 이전** 측정값이다(RAGAS는 라우팅을 거치지 않고 RAG 코어만 측정). 생성 스타일 변화는 재측정 시 Faithfulness에 반영될 수 있다(상향 기대).

---

## 문서 업로드 → 서비스 적용 흐름

```
1. 관리자가 Markdown 문서 업로드
   POST /api/admin/upload-md
        │
        ▼
2. 자동 처리
   청크 분할 (1200자/150자 overlap)
   → OpenAI 임베딩 생성
   → ChunkRecord Aurora RDS 저장
   → 파일 S3 업로드
   status: "uploaded" → "review"
        │
        ▼
3. 관리자 승인
   POST /api/admin/documents/{id}/approve
   is_active = true, status = "ready"
        │
        ▼
4. FAISS 인덱스 재구성
   POST /api/admin/reindex
   → 활성 문서 전체 로드
   → 인덱스 재빌드
   → EC2 로컬 저장 + S3 동기화
        │
        ▼
5. 새 문서 내용이 검색에 즉시 반영
```

---

