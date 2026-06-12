from __future__ import annotations

import json
import re
from pathlib import Path

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


async def convert_markdown_to_faq_items(markdown: str, category: str | None = None) -> list[dict]:
    settings = get_settings()
    if not settings.openai_api_key:
        return fallback_markdown_to_faq_items(markdown, category)

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
        return normalize_faq_items(json.loads(content), category=category)
    except Exception:
        return fallback_markdown_to_faq_items(markdown, category)
