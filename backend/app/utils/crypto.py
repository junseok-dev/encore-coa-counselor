from cryptography.fernet import Fernet

from app.config import get_settings

ENCRYPTED_PREFIX = "enc::"


def get_fernet() -> Fernet:
    """ENCRYPTION_KEY는 `Fernet.generate_key()`로 생성한 URL-safe base64 키여야 합니다."""
    settings = get_settings()
    return Fernet(settings.encryption_key.encode())


def encrypt(plain_text: str) -> str:
    """평문 문자열을 암호화하여 반환"""
    if not plain_text:
        return ""
    f = get_fernet()
    token = f.encrypt(plain_text.encode()).decode()
    return f"{ENCRYPTED_PREFIX}{token}"


def decrypt(cipher_text: str) -> str:
    """암호화된 문자열을 복호화하여 반환"""
    if not cipher_text:
        return ""
    if cipher_text.startswith(ENCRYPTED_PREFIX):
        cipher_text = cipher_text[len(ENCRYPTED_PREFIX):]
    f = get_fernet()
    return f.decrypt(cipher_text.encode()).decode()


def maybe_encrypt(value: str | None) -> str | None:
    if value is None:
        return None
    if not value or value.startswith(ENCRYPTED_PREFIX):
        return value
    return encrypt(value)


def decrypt_if_needed(value: str | None) -> str | None:
    if value is None:
        return None
    if not value:
        return value
    if value.startswith(ENCRYPTED_PREFIX):
        try:
            return decrypt(value)
        except Exception:
            return ""
    # enc:: 없이 저장된 구버전 Fernet 토큰 처리
    if value.startswith("gAAA"):
        try:
            f = get_fernet()
            return f.decrypt(value.encode()).decode()
        except Exception:
            pass
    return value
