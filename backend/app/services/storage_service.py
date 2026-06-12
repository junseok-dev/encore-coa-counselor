from __future__ import annotations

import json
import shutil
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import urlparse

from app.config import get_settings

try:
    import boto3
except ImportError:  # pragma: no cover
    boto3 = None


ROOT = Path(__file__).resolve().parent.parent.parent.parent
DATA_DIR = ROOT / "data"
PDF_DIR = DATA_DIR / "pdfs"
MANAGED_DOCS_DIR = DATA_DIR / "managed_docs"
MANAGED_JSON_DIR = DATA_DIR / "managed_json"
MANAGED_CHUNKS_DIR = DATA_DIR / "managed_chunks"
MANAGED_EMBEDDINGS_DIR = DATA_DIR / "managed_embeddings"
FAISS_DIR = DATA_DIR / "faiss_index"

_FAISS_FILES = ("index.faiss", "index.pkl")


def _get_s3_client():
    settings = get_settings()
    if not settings.aws_s3_bucket or boto3 is None:
        return None, None
    session = boto3.session.Session(
        aws_access_key_id=settings.aws_access_key_id or None,
        aws_secret_access_key=settings.aws_secret_access_key or None,
        region_name=settings.aws_region or None,
    )
    return session.client("s3"), settings


def build_s3_key(*parts: str) -> str:
    settings = get_settings()
    cleaned = [part.strip("/") for part in parts if part and part.strip("/")]
    prefix = settings.aws_s3_prefix.rstrip("/")
    return "/".join([prefix, *cleaned]) if prefix else "/".join(cleaned)


def build_s3_uri(storage_key: str) -> str:
    settings = get_settings()
    return f"s3://{settings.aws_s3_bucket}/{storage_key}"


def is_s3_uri(path_value: str | None) -> bool:
    return bool(path_value and path_value.startswith("s3://"))


def parse_s3_uri(path_value: str) -> tuple[str, str]:
    parsed = urlparse(path_value)
    bucket = parsed.netloc
    key = parsed.path.lstrip("/")
    if not bucket or not key:
        raise ValueError(f"Invalid S3 URI: {path_value}")
    return bucket, key


def upload_faiss_to_s3() -> None:
    client, settings = _get_s3_client()
    if client is None:
        return
    prefix = f"{settings.aws_s3_prefix.rstrip('/')}/faiss"
    for filename in _FAISS_FILES:
        local_path = FAISS_DIR / filename
        if local_path.exists():
            client.upload_file(str(local_path), settings.aws_s3_bucket, f"{prefix}/{filename}")


def download_faiss_from_s3() -> bool:
    client, settings = _get_s3_client()
    if client is None:
        return False
    FAISS_DIR.mkdir(parents=True, exist_ok=True)
    prefix = f"{settings.aws_s3_prefix.rstrip('/')}/faiss"
    downloaded = False
    for filename in _FAISS_FILES:
        local_path = FAISS_DIR / filename
        try:
            client.download_file(settings.aws_s3_bucket, f"{prefix}/{filename}", str(local_path))
            downloaded = True
        except Exception:
            pass
    return downloaded


def ensure_storage_dirs() -> None:
    for directory in (
        PDF_DIR,
        MANAGED_DOCS_DIR,
        MANAGED_JSON_DIR,
        MANAGED_CHUNKS_DIR,
        MANAGED_EMBEDDINGS_DIR,
    ):
        directory.mkdir(parents=True, exist_ok=True)


def upload_file_to_s3(local_path: Path, storage_key: str) -> str | None:
    client, settings = _get_s3_client()
    if client is None:
        return None
    client.upload_file(str(local_path), settings.aws_s3_bucket, storage_key)
    return build_s3_uri(storage_key)


def upload_bytes_to_s3(content: bytes, storage_key: str, content_type: str | None = None) -> str | None:
    client, settings = _get_s3_client()
    if client is None:
        return None
    extra_args = {"ContentType": content_type} if content_type else None
    with NamedTemporaryFile(delete=False) as temp_file:
        temp_file.write(content)
        temp_path = Path(temp_file.name)
    try:
        if extra_args:
            client.upload_file(str(temp_path), settings.aws_s3_bucket, storage_key, ExtraArgs=extra_args)
        else:
            client.upload_file(str(temp_path), settings.aws_s3_bucket, storage_key)
    finally:
        safe_unlink(str(temp_path))
    return build_s3_uri(storage_key)


def upload_text_to_s3(content: str, storage_key: str, content_type: str = "text/plain; charset=utf-8") -> str | None:
    return upload_bytes_to_s3(content.encode("utf-8"), storage_key, content_type=content_type)


def upload_json_to_s3(payload: object, storage_key: str) -> str | None:
    return upload_text_to_s3(
        json.dumps(payload, ensure_ascii=False, indent=2),
        storage_key,
        content_type="application/json; charset=utf-8",
    )


def read_text_from_storage(path_value: str | None) -> str | None:
    if not path_value:
        return None
    if is_s3_uri(path_value):
        client, _ = _get_s3_client()
        if client is None:
            return None
        bucket, key = parse_s3_uri(path_value)
        response = client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read().decode("utf-8")
    path = Path(path_value)
    if not path.exists() or not path.is_file():
        return None
    return path.read_text(encoding="utf-8")


def storage_exists(path_value: str | None) -> bool:
    if not path_value:
        return False
    if is_s3_uri(path_value):
        client, _ = _get_s3_client()
        if client is None:
            return False
        bucket, key = parse_s3_uri(path_value)
        try:
            client.head_object(Bucket=bucket, Key=key)
            return True
        except Exception:
            return False
    path = Path(path_value)
    return path.exists() and path.is_file()


def delete_s3_key(storage_key: str | None) -> None:
    if not storage_key:
        return
    client, settings = _get_s3_client()
    if client is None:
        return
    if is_s3_uri(storage_key):
        bucket, key = parse_s3_uri(storage_key)
        client.delete_object(Bucket=bucket, Key=key)
        return
    client.delete_object(Bucket=settings.aws_s3_bucket, Key=storage_key)


def delete_storage_path(path_value: str | None) -> None:
    if not path_value:
        return
    if is_s3_uri(path_value):
        delete_s3_key(path_value)
        return
    safe_unlink(path_value)


def safe_unlink(path_value: str | None) -> None:
    if not path_value:
        return
    path = Path(path_value)
    if path.exists() and path.is_file():
        path.unlink()


def safe_rmtree(path_value: str | None) -> None:
    if not path_value:
        return
    path = Path(path_value)
    if path.exists() and path.is_dir():
        shutil.rmtree(path)
