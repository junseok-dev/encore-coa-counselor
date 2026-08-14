import unicodedata


def clean_data_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value or "")
    return " ".join(normalized.strip().split())


def data_name_key(value: str) -> str:
    return clean_data_name(value).casefold()
