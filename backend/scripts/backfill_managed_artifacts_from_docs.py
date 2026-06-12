from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from app.config import get_settings  # noqa: E402
from app.db.database import SessionLocal  # noqa: E402
from app.db.models import DocumentRecord  # noqa: E402
from app.services.admin_service import _artifact_key  # noqa: E402
from app.services.rag_service import get_rag_service  # noqa: E402
from app.services.storage_service import upload_json_to_s3, upload_text_to_s3  # noqa: E402


DOCS_DIR = ROOT.parent / "data" / "docs"
CATALOG_PATH = DOCS_DIR / "catalog.json"


def _load_catalog_map() -> dict[str, dict[str, str]]:
    if not CATALOG_PATH.exists():
        return {}
    payload = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    result: dict[str, dict[str, str]] = {}
    for item in payload.get("documents", []):
        source_path = item.get("path", "")
        stem = Path(source_path).stem
        if stem:
            result[stem] = {
                "title": item.get("title") or stem,
                "category": item.get("category") or "document",
            }
    return result


def backfill() -> None:
    catalog_map = _load_catalog_map()
    rag = get_rag_service()
    settings = get_settings()
    db = SessionLocal()

    try:
        rows = db.query(DocumentRecord).order_by(DocumentRecord.id.asc()).all()
        updated_count = 0

        for row in rows:
            if row.parser_type == "faq_json":
                continue

            source_md = DOCS_DIR / f"{row.logical_name}.md"
            if not source_md.exists():
                continue

            md_content = source_md.read_text(encoding="utf-8")
            catalog_meta = catalog_map.get(row.logical_name, {})
            title = catalog_meta.get("title", row.logical_name)
            category = catalog_meta.get("category", "document")

            md_storage = upload_text_to_s3(md_content, _artifact_key(row.logical_name, row.version, "document.md"))

            chunks = rag.build_chunks_for_markdown(
                md_content,
                {
                    "file": row.logical_name,
                    "title": title,
                    "category": category,
                    "document_id": row.id,
                    "source_type": "document",
                },
            )
            rag.replace_document_chunks(db, row.id, chunks)

            json_payload = {
                "document_id": row.id,
                "logical_name": row.logical_name,
                "version": row.version,
                "original_filename": row.original_filename,
                "title": title,
                "category": category,
                "status": row.status,
                "chunk_count": len(chunks),
            }
            chunk_payload = [
                {
                    "index": index,
                    "content": chunk.page_content,
                    "metadata": chunk.metadata,
                }
                for index, chunk in enumerate(chunks)
            ]
            embedding_payload = {
                "document_id": row.id,
                "embedding_model": settings.embedding_model,
                "strategy": "backfill",
                "chunk_count": len(chunks),
            }

            json_storage = upload_json_to_s3(json_payload, _artifact_key(row.logical_name, row.version, "document.json"))
            chunk_storage = upload_json_to_s3(chunk_payload, _artifact_key(row.logical_name, row.version, "chunks.json"))
            embedding_storage = upload_json_to_s3(
                embedding_payload,
                _artifact_key(row.logical_name, row.version, "embedding.json"),
            )

            if not all([md_storage, json_storage, chunk_storage, embedding_storage]):
                continue

            row.md_path = md_storage
            row.json_path = json_storage
            row.chunk_path = chunk_storage
            row.embedding_path = embedding_storage
            updated_count += 1
            db.commit()

            print(f"[updated] document_id={row.id} logical_name={row.logical_name} version={row.version}")

        print(f"Done. Updated {updated_count} document rows.")
    finally:
        db.close()


if __name__ == "__main__":
    backfill()
