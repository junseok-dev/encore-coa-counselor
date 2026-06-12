from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from app.db.database import SessionLocal  # noqa: E402
from app.db.models import DocumentRecord  # noqa: E402
from app.services.admin_service import _artifact_key  # noqa: E402
from app.services.storage_service import (  # noqa: E402
    build_s3_uri,
    is_s3_uri,
    safe_unlink,
    upload_file_to_s3,
)


BASE_ARTIFACT_SPECS = [
    ("md_path", "document.md"),
    ("chunk_path", "chunks.json"),
    ("embedding_path", "embedding.json"),
]


def _migrate_document(record: DocumentRecord, *, delete_local: bool) -> dict[str, str]:
    updated: dict[str, str] = {}

    artifact_specs = list(BASE_ARTIFACT_SPECS)
    artifact_specs.insert(1, ("json_path", "faq.json" if record.parser_type == "faq_json" else "document.json"))

    for field_name, target_filename in artifact_specs:
        current_value = getattr(record, field_name)
        if not current_value or is_s3_uri(current_value):
            continue

        local_path = Path(current_value)
        if not local_path.exists() or not local_path.is_file():
            continue

        uploaded_uri = upload_file_to_s3(local_path, _artifact_key(record.logical_name, record.version, target_filename))
        if not uploaded_uri:
            continue

        setattr(record, field_name, uploaded_uri)
        updated[field_name] = uploaded_uri

        if delete_local:
            safe_unlink(str(local_path))

    if record.pdf_path and not is_s3_uri(record.pdf_path) and record.storage_key:
        record.pdf_path = build_s3_uri(record.storage_key)
        updated["pdf_path"] = record.pdf_path

    return updated


def migrate(*, delete_local: bool = False) -> None:
    db = SessionLocal()
    try:
        rows = db.query(DocumentRecord).order_by(DocumentRecord.id.asc()).all()
        migrated_count = 0

        for row in rows:
            updated = _migrate_document(row, delete_local=delete_local)
            if not updated:
                continue
            migrated_count += 1
            print(f"[updated] document_id={row.id} logical_name={row.logical_name} version={row.version}")
            for field_name, uri in updated.items():
                print(f"  - {field_name}: {uri}")

        db.commit()
        print(f"Done. Updated {migrated_count} document rows.")
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload existing managed document artifacts to S3 and rewrite document paths.")
    parser.add_argument(
        "--delete-local",
        action="store_true",
        help="Delete local files after successful upload to S3.",
    )
    args = parser.parse_args()
    migrate(delete_local=args.delete_local)


if __name__ == "__main__":
    main()
