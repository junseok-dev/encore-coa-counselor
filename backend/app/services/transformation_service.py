from __future__ import annotations

import json
import re
from pathlib import Path
from typing import TypedDict

from openai import AsyncOpenAI

from app.config import get_settings


def _slugify(value: str) -> str:
    lowered = re.sub(r"[^\w]+", "_", Path(value).stem.lower()).strip("_")
    return lowered or "faq"


def _ensure_list(value: str | list[str] | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value).split(",") if item.strip()]


def normalize_faq_items(payload: object, category: str | None = None) -> list[dict]:
    items = payload if isinstance(payload, list) else []
    normalized: list[dict] = []
    for index, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            continue
        question = str(item.get("question", "")).strip()
        answer = str(item.get("answer", "")).strip()
        if not question or not answer:
            continue
        normalized.append(
            {
                "id": str(item.get("id") or f"{_slugify(question)}_{index:03d}"),
                "category": str(item.get("category") or category or "FAQ").strip(),
                "question": question,
                "answer": answer,
                "keywords": _ensure_list(item.get("keywords")),
                "aliases": _ensure_list(item.get("aliases")),
                "search_hints": _ensure_list(item.get("search_hints")),
                "source_files": _ensure_list(item.get("source_files")),
                "direct_answer": bool(item.get("direct_answer", True)),
                "top_k": int(item.get("top_k", 4) or 4),
            }
        )
    return normalized


def validate_faq_items(payload: object, category: str | None = None) -> list[dict]:
    """Validate an operator-edited FAQ payload without silently dropping rows."""
    if not isinstance(payload, list):
        raise ValueError("FAQ JSON의 최상위 값은 배열이어야 합니다.")
    if not payload:
        raise ValueError("FAQ JSON에 한 개 이상의 항목이 필요합니다.")

    normalized: list[dict] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"FAQ {index}번 항목은 JSON 객체여야 합니다.")

        if not isinstance(item.get("question"), str):
            raise ValueError(f"FAQ {index}번 항목의 question은 문자열이어야 합니다.")
        if not isinstance(item.get("answer"), str):
            raise ValueError(f"FAQ {index}번 항목의 answer는 문자열이어야 합니다.")
        question = item["question"].strip()
        answer = item["answer"].strip()
        if not question:
            raise ValueError(f"FAQ {index}번 항목에 question이 필요합니다.")
        if not answer:
            raise ValueError(f"FAQ {index}번 항목에 answer가 필요합니다.")

        top_k_value = item.get("top_k", 4)
        if isinstance(top_k_value, bool) or not isinstance(top_k_value, int):
            raise ValueError(f"FAQ {index}번 항목의 top_k는 정수여야 합니다.")
        top_k = top_k_value
        if not 1 <= top_k <= 20:
            raise ValueError(f"FAQ {index}번 항목의 top_k는 1~20이어야 합니다.")

        for list_field in ("keywords", "aliases", "search_hints", "source_files"):
            if list_field in item and not isinstance(item[list_field], list):
                raise ValueError(f"FAQ {index}번 항목의 {list_field}는 문자열 배열이어야 합니다.")
        if "direct_answer" in item and not isinstance(item["direct_answer"], bool):
            raise ValueError(f"FAQ {index}번 항목의 direct_answer는 true 또는 false여야 합니다.")
        if "id" in item and (not isinstance(item["id"], str) or not item["id"].strip()):
            raise ValueError(f"FAQ {index}번 항목의 id는 비어 있지 않은 문자열이어야 합니다.")

        normalized_item = normalize_faq_items([{**item, "top_k": top_k}], category=category)[0]
        normalized_item["id"] = normalized_item["id"].strip()
        faq_id = normalized_item["id"]
        if faq_id in seen_ids:
            raise ValueError(f"중복된 FAQ id가 있습니다: {faq_id}")
        seen_ids.add(faq_id)
        normalized.append(normalized_item)

    return normalized


class FaqConversionResult(TypedDict):
    items: list[dict]
    method: str
    warnings: list[str]


def fallback_markdown_to_faq_items(markdown: str, category: str | None = None) -> list[dict]:
    blocks = [block.strip() for block in re.split(r"\n\s*\n", markdown) if block.strip()]
    items: list[dict] = []
    current_question = ""
    current_answer_parts: list[str] = []

    for block in blocks:
        heading = re.sub(r"^#+\s*", "", block).strip()
        if heading.endswith("?") or heading.endswith("요") or block.startswith("#"):
            if current_question and current_answer_parts:
                items.append(
                    {
                        "question": current_question,
                        "answer": "\n\n".join(current_answer_parts).strip(),
                        "category": category or "FAQ",
                    }
                )
            current_question = heading
            current_answer_parts = []
        else:
            current_answer_parts.append(block)

    if current_question and current_answer_parts:
        items.append(
            {
                "question": current_question,
                "answer": "\n\n".join(current_answer_parts).strip(),
                "category": category or "FAQ",
            }
        )

    if not items and markdown.strip():
        items.append(
            {
                "question": f"{category or 'FAQ'} 안내",
                "answer": markdown.strip(),
                "category": category or "FAQ",
            }
        )

    return normalize_faq_items(items, category=category)


async def convert_markdown_to_faq_items_with_report(
    markdown: str,
    category: str | None = None,
) -> FaqConversionResult:
    settings = get_settings()
    if not settings.openai_api_key:
        return {
            "items": fallback_markdown_to_faq_items(markdown, category),
            "method": "fallback",
            "warnings": ["OpenAI API 키가 없어 규칙 기반 변환을 사용했습니다."],
        }

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    system_prompt = (
        "You convert markdown into an FAQ JSON array for an admin CMS. "
        "Return only JSON. Each item must contain id, category, question, answer, "
        "keywords, aliases, search_hints, source_files, direct_answer, top_k."
    )
    user_prompt = (
        f"Default category: {category or 'FAQ'}\n"
        "Convert the following markdown into a concise FAQ list.\n"
        "Preserve important facts and rewrite into operator-friendly answers.\n\n"
        f"{markdown}"
    )

    try:
        response = await client.chat.completions.create(
            model=settings.model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_completion_tokens=4096,
        )
        content = response.choices[0].message.content or "[]"
        items = validate_faq_items(json.loads(content), category=category)
        return {"items": items, "method": "ai", "warnings": []}
    except Exception as exc:
        return {
            "items": fallback_markdown_to_faq_items(markdown, category),
            "method": "fallback",
            "warnings": [f"AI 변환에 실패해 규칙 기반 변환을 사용했습니다. ({type(exc).__name__})"],
        }


async def convert_markdown_to_faq_items(markdown: str, category: str | None = None) -> list[dict]:
    result = await convert_markdown_to_faq_items_with_report(markdown, category=category)
    return result["items"]
