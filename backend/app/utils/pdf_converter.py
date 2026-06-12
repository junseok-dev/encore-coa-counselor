import asyncio
import os
import re
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory

import pypdfium2 as pdfium
import pytesseract

try:
    import opendataloader_pdf
except ImportError:  # pragma: no cover - surfaced as runtime setup guidance
    opendataloader_pdf = None

ROOT = Path(__file__).resolve().parent.parent.parent.parent
DOCS_DIR = ROOT / "data" / "docs"
TESSERACT_CANDIDATES = [
    Path(r"C:\Users\Playdata\AppData\Local\Programs\Tesseract-OCR\tesseract.exe"),
    Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
]

_executor = ThreadPoolExecutor(max_workers=2)


def _configure_tesseract() -> None:
    if shutil.which("tesseract"):
        return
    for candidate in TESSERACT_CANDIDATES:
        if candidate.exists():
            pytesseract.pytesseract.tesseract_cmd = str(candidate)
            return


def _clean_ocr_text(text: str) -> str:
    normalized = text.replace("\r\n", "\n")
    normalized = re.sub(r"[ \t]+", " ", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    lines = []
    for raw_line in normalized.split("\n"):
        line = raw_line.strip()
        if not line:
            lines.append("")
            continue
        if re.fullmatch(r"[-_=~.]{3,}", line):
            continue
        lines.append(line)
    cleaned = "\n".join(lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _line_is_reasonable(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if len(stripped) < 2:
        return False
    if re.fullmatch(r"[\W_]+", stripped):
        return False

    suspicious_marks = stripped.count("?") + stripped.count("�")
    if suspicious_marks >= 3:
        return False

    cjk_count = len(re.findall(r"[\u3400-\u4DBF\u4E00-\u9FFF]", stripped))
    if cjk_count >= 2:
        return False

    weird_ratio = suspicious_marks / max(len(stripped), 1)
    if weird_ratio > 0.06:
        return False

    return True


def _ocr_pdf_to_markdown(pdf_path: Path) -> str:
    _configure_tesseract()
    doc = pdfium.PdfDocument(str(pdf_path))
    pages: list[str] = []
    for index in range(len(doc)):
        image = doc[index].render(scale=2.4).to_pil()
        text = pytesseract.image_to_string(image, lang="kor+eng")
        text = _clean_ocr_text(text)
        if text:
            pages.append(f"## 페이지 {index + 1}\n\n{text}")
    return "\n\n".join(pages).strip() + "\n"


def _is_sparse_markdown(md_content: str) -> bool:
    body = md_content.strip()
    if not body:
        return True
    meaningful_chars = re.findall(r"[가-힣A-Za-z0-9]", body)
    return len(meaningful_chars) < 80


def _sanitize_markdown(md_content: str) -> str:
    text = md_content.replace("\r\n", "\n")
    text = re.sub(r"<br\s*/?>\s*<br\s*/?>", " / ", text, flags=re.I)
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.I)
    text = re.sub(r"```.*?```", "", text, flags=re.S)

    sanitized_lines: list[str] = []
    for raw_line in text.split("\n"):
        line = raw_line
        line = re.sub(r"!\[[^\]]*]\(<[^>]*>\)", "", line)
        line = re.sub(r"!\[[^\]]*]\([^)]*\)", "", line)
        line = re.sub(r"<img\b[^>]*>", "", line, flags=re.I)

        stripped = line.strip()
        if not stripped:
            sanitized_lines.append("")
            continue

        if re.fullmatch(r"\d{1,3}", stripped):
            continue
        if re.fullmatch(r"[\s\W_]+", stripped):
            continue
        if re.search(r"[\u2500-\u257F]", stripped):
            continue
        if re.fullmatch(r"image\s*\d+", stripped, flags=re.I):
            continue

        if stripped.startswith("|") and stripped.endswith("|"):
            cells = [cell.strip() for cell in stripped.strip("|").split("|")]
            non_empty_cells = [cell for cell in cells if cell]
            if len(non_empty_cells) == 1:
                continue

        if not stripped.startswith("#") and not _line_is_reasonable(stripped):
            continue

        sanitized_lines.append(line.rstrip())

    text = "\n".join(sanitized_lines)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() + "\n"


def _ensure_java_available() -> None:
    if shutil.which("java"):
        return

    candidates = []
    java_home = os.environ.get("JAVA_HOME")
    if java_home:
        candidates.append(Path(java_home) / "bin")

    program_files = os.environ.get("ProgramFiles")
    if program_files:
        candidates.extend(
            [
                Path(program_files) / "Java" / "jdk-26.0.1" / "bin",
                Path(program_files) / "Java" / "jdk-21" / "bin",
                Path(program_files) / "Java" / "jdk-17" / "bin",
                Path(program_files) / "Java" / "latest" / "bin",
            ]
        )

    for candidate in candidates:
        java_exe = candidate / "java.exe"
        if java_exe.exists():
            os.environ["PATH"] = f"{candidate}{os.pathsep}{os.environ.get('PATH', '')}"
            if "JAVA_HOME" not in os.environ:
                os.environ["JAVA_HOME"] = str(candidate.parent)
            return

    raise RuntimeError(
        "Java 11+ was not found. Set JAVA_HOME and include %JAVA_HOME%\\bin in PATH."
    )


def _pdf_to_md_filename(pdf_name: str) -> str:
    stem = Path(pdf_name).stem
    safe = re.sub(r"[^\w]+", "_", stem).strip("_")
    return f"{safe or 'document'}.md"


def _find_generated_markdown(output_dir: Path, pdf_path: Path) -> Path:
    expected_name = f"{pdf_path.stem}.md"
    candidates = sorted(output_dir.rglob("*.md"))
    if not candidates:
        raise ValueError(f"Markdown output not found for {pdf_path.name}")

    for candidate in candidates:
        if candidate.name == expected_name:
            return candidate
    return candidates[0]


def _convert_sync(pdf_path: Path) -> Path:
    if opendataloader_pdf is None:
        raise RuntimeError(
            "opendataloader-pdf is not installed. Run `pip install -U opendataloader-pdf` "
            "and make sure Java 11+ is available."
        )
    _ensure_java_available()

    with TemporaryDirectory() as tmp_dir:
        work_dir = Path(tmp_dir)
        output_dir = work_dir / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        input_pdf = work_dir / "input.pdf"
        shutil.copy2(pdf_path, input_pdf)
        opendataloader_pdf.convert(
            input_path=[str(input_pdf)],
            output_dir=str(output_dir),
            format="markdown",
        )
        generated_md = _find_generated_markdown(output_dir, input_pdf)
        md_content = _sanitize_markdown(generated_md.read_text(encoding="utf-8"))
        if _is_sparse_markdown(md_content):
            md_content = _ocr_pdf_to_markdown(pdf_path)

    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    md_path = DOCS_DIR / _pdf_to_md_filename(pdf_path.name)
    md_path.write_text(md_content, encoding="utf-8")
    return md_path


async def convert_pdf_to_md(pdf_path: Path, api_key: str | None = None) -> Path:
    del api_key
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _convert_sync, pdf_path)
