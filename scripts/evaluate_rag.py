"""
RAG 파이프라인 RAGAS 평가 스크립트.

사용법:
    cd c:/Workspaces/document-chatbot_practice
    python scripts/evaluate_rag.py

결과:
    data/eval_results/eval_YYYYMMDD_HHMMSS.json  - 질문별 상세 결과
    data/eval_results/ragas_YYYYMMDD_HHMMSS.csv  - RAGAS 메트릭 CSV
"""

import asyncio
import io
import json
import sys
from datetime import datetime
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from dotenv import load_dotenv
load_dotenv(ROOT / "backend" / ".env")

from app.config import get_settings
from app.services.rag_service import get_rag_service
from app.services.faq_service import search_faq
from app.services.openai_service import get_ai_response

from ragas import EvaluationDataset, evaluate
from ragas.dataset_schema import SingleTurnSample
from ragas.metrics._faithfulness import faithfulness as _faithfulness
from ragas.metrics._answer_relevance import answer_relevancy as _answer_relevancy
from ragas.metrics._context_precision import context_precision as _context_precision
from ragas.metrics._context_recall import context_recall as _context_recall
from langchain_openai import ChatOpenAI
from langchain_openai import OpenAIEmbeddings as LCOpenAIEmbeddings


def _split_contexts(context_str: str) -> list[str]:
    if not context_str:
        return []
    return [c.strip() for c in context_str.split("\n\n---\n\n") if c.strip()]


def _check_hallucination(answer: str) -> bool:
    no_info_signals = [
        "죄송", "담당", "문의", "확인이 필요", "정확한 정보",
        "안내해 드리기 어렵", "별도 문의", "채널톡", "playdata@",
        # 모델이 실제로 사용하는 거절/유보 표현 보강 (키워드 고정이라 놓치던 케이스)
        "어려워요", "어렵네요", "어렵습니다", "어려워서", "어려운",
        "확인이 어렵", "확인하기 어렵", "말씀드리기 어렵", "안내하긴 어렵", "안내드리기",
        "확정", "단정", "딱 잘라",
        "구체적으로 적혀", "적혀 있진 않", "나와 있지 않", "안내돼 있지 않", "안내되어 있지 않",
    ]
    return any(signal in answer for signal in no_info_signals)


async def _collect_data(testset: list, rag) -> tuple[list, list, list]:
    import os
    os.system("")  # Windows ANSI 활성화
    GREEN = "\033[92m"
    RED   = "\033[91m"
    RESET = "\033[0m"
    COLS  = 13

    ragas_samples = []
    detail_results = []
    hallucination_results = []

    print("수집 중 (초록=컨텍스트 있음  빨강=없음/거부):\n")

    for i, item in enumerate(testset, 1):
        q = item["question"]
        ground_truth = item["ground_truth"]
        q_type = item["type"]

        if q_type == "faq":
            faq_answer = search_faq(q)
            if faq_answer:
                answer, contexts, source = faq_answer, [], "faq"
            else:
                context_str = rag.search(q, top_k=6)
                contexts = _split_contexts(context_str)
                answer, _ = await get_ai_response(q, context_str)
                source = "document" if context_str else "ai"
        else:
            context_str = rag.search(q, top_k=6)
            contexts = _split_contexts(context_str)
            answer, _ = await get_ai_response(q, context_str)
            source = "document" if context_str else "ai"

        detail_results.append({
            "id": item["id"],
            "question": q,
            "answer": answer,
            "contexts": contexts,
            "ground_truth": ground_truth,
            "source": source,
            "type": q_type,
            "category": item["category"],
            "difficulty": item["difficulty"],
        })

        if q_type == "no_answer":
            refused = _check_hallucination(answer)
            hallucination_results.append({
                "id": item["id"],
                "question": q,
                "answer": answer,
                "correctly_refused": refused,
            })
            passed = refused
        else:
            passed = source in ("faq", "document") and bool(contexts or source == "faq")

        dot = f"{GREEN}●{RESET}" if passed else f"{RED}●{RESET}"
        # 행 시작에 레이블 출력
        if (i - 1) % COLS == 0:
            row_start = item["id"]
            print(f"  {row_start}  ", end="", flush=True)
        print(f"{dot} ", end="", flush=True)

        # 행 끝 또는 마지막 질문
        if i % COLS == 0 or i == len(testset):
            print()

        if q_type == "no_answer" or source == "faq":
            continue

        if not contexts:
            continue

        ragas_samples.append(
            SingleTurnSample(
                user_input=q,
                response=answer,
                retrieved_contexts=contexts,
                reference=ground_truth or "",
            )
        )
        detail_results[-1]["_ragas_idx"] = len(ragas_samples) - 1

    return ragas_samples, detail_results, hallucination_results


def _print_dots(testset: list, detail_results: list, hallucination_results: list, ragas_df) -> None:
    import os
    os.system("")  # Windows ANSI 활성화

    GREEN = "\033[92m"
    RED   = "\033[91m"
    RESET = "\033[0m"

    hall_map = {r["id"]: r["correctly_refused"] for r in hallucination_results}
    detail_map = {r["id"]: r for r in detail_results}

    dots = []
    for item in testset:
        d = detail_map[item["id"]]
        if item["type"] == "no_answer":
            passed = hall_map.get(item["id"], False)
        else:
            idx = d.get("_ragas_idx")
            if idx is not None and idx < len(ragas_df):
                faith = ragas_df.iloc[idx].get("faithfulness")
                passed = bool(faith >= 0.5) if faith is not None and faith == faith else False
            else:
                passed = False
        dots.append((item["id"], passed))

    cols = 13
    total = len(dots)
    passed_count = sum(1 for _, p in dots if p)

    print("\n" + "=" * 44)
    print("  결과 도트  (초록=통과  빨강=실패)")
    print("=" * 44)
    for i, (qid, passed) in enumerate(dots):
        dot = f"{GREEN}●{RESET}" if passed else f"{RED}●{RESET}"
        print(f" {dot}", end="")
        if (i + 1) % cols == 0 or i == total - 1:
            start_id = dots[i - (i % cols)][0]
            end_id   = dots[i][0]
            print(f"  {start_id}~{end_id}")
    print(f"\n  통과 {passed_count} / 실패 {total - passed_count} / 전체 {total}")
    print("=" * 44)


def _run_ragas(ragas_samples: list, settings) -> object:
    # answer_relevancy는 답변에서 여러 질문을 생성해 평균내므로 약간의 온도가 필요(temperature=0이면
    # 동일 생성만 나와 "1 generation instead of 3" 경고로 점수가 비정상적으로 낮아짐).
    eval_llm = ChatOpenAI(model="gpt-4o-mini", api_key=settings.openai_api_key, temperature=0.3)
    eval_embeddings = LCOpenAIEmbeddings(
        model="text-embedding-3-small",
        api_key=settings.openai_api_key,
    )
    metrics = [_faithfulness, _answer_relevancy, _context_precision, _context_recall]
    for m in metrics:
        m.llm = None
        if hasattr(m, "embeddings"):
            m.embeddings = None

    from ragas.run_config import RunConfig
    run_cfg = RunConfig(max_retries=3, max_wait=60)

    dataset = EvaluationDataset(samples=ragas_samples)
    return evaluate(
        dataset,
        metrics=metrics,
        llm=eval_llm,
        embeddings=eval_embeddings,
        run_config=run_cfg,
        batch_size=4,
    )


def main():
    settings = get_settings()
    rag = get_rag_service()

    testset = json.loads(
        (ROOT / "data" / "testset.json").read_text(encoding="utf-8")
    )["testset"]

    print(f"총 {len(testset)}개 질문 처리 중...\n")

    ragas_samples, detail_results, hallucination_results = asyncio.run(
        _collect_data(testset, rag)
    )

    print(f"\nRAGAS 평가 실행 중 ({len(ragas_samples)}개)...")
    if not ragas_samples:
        print("  [경고] RAGAS 평가 대상 샘플이 없습니다.")
        scores = {"faithfulness": None, "answer_relevancy": None,
                  "context_precision": None, "context_recall": None}
        result = None
    else:
        result = _run_ragas(ragas_samples, settings)
        scores = (
            result.to_pandas()[
                ["faithfulness", "answer_relevancy", "context_precision", "context_recall"]
            ]
            .mean()
            .round(4)
            .to_dict()
        )

    hallucination_pass = sum(1 for r in hallucination_results if r["correctly_refused"])
    hallucination_total = len(hallucination_results)

    summary = {
        "timestamp": datetime.now().isoformat(),
        "total_questions": len(testset),
        "ragas_evaluated": len(ragas_samples),
        "hallucination_tested": hallucination_total,
        "scores": scores,
        "hallucination": {
            "pass": hallucination_pass,
            "fail": hallucination_total - hallucination_pass,
            "pass_rate": round(hallucination_pass / hallucination_total, 4) if hallucination_total else None,
            "detail": hallucination_results,
        },
        "detail": detail_results,
    }

    output_dir = ROOT / "data" / "eval_results"
    output_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    json_path = output_dir / f"eval_{ts}.json"
    csv_path = output_dir / f"ragas_{ts}.csv"

    json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    if result is not None:
        result.to_pandas().to_csv(csv_path, index=False, encoding="utf-8-sig")
        ragas_df = result.to_pandas()
    else:
        import pandas as pd
        ragas_df = pd.DataFrame()
    _print_dots(testset, detail_results, hallucination_results, ragas_df)

    def _fmt(v):
        return f"{v:.3f}" if v is not None else "N/A"

    print("\n" + "=" * 40)
    print("  RAGAS 평가 결과")
    print("=" * 40)
    print(f"  Faithfulness      : {_fmt(scores['faithfulness'])}")
    print(f"  Answer Relevancy  : {_fmt(scores['answer_relevancy'])}")
    print(f"  Context Precision : {_fmt(scores['context_precision'])}")
    print(f"  Context Recall    : {_fmt(scores['context_recall'])}")
    print(f"  Hallucination 방어 : {hallucination_pass}/{hallucination_total}")
    print("=" * 40)
    print(f"\n  JSON : {json_path}")
    if result is not None:
        print(f"  CSV  : {csv_path}")


if __name__ == "__main__":
    main()
