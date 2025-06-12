from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import hashlib
import re
from pathlib import Path


_QUOTE_CHARS = '"\'`«»“”‘’'
_SPACE_RE = re.compile(r"\s+")


def normalize_text(value) -> str:
    text = "" if value is None else str(value)
    text = text.strip()
    for char in _QUOTE_CHARS:
        text = text.replace(char, "")
    text = text.replace("（", "(").replace("）", ")")
    text = text.replace("№", "NO")
    text = _SPACE_RE.sub(" ", text)
    return text.upper()


def normalize_station_name(value) -> str:
    text = normalize_text(value)
    text = re.sub(r"^(АЗС|AЗС|AZS)\s+", "", text)
    return _SPACE_RE.sub(" ", text).strip()


def file_sha256(path: str | Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean_str(value):
    if value is None:
        return None
    if isinstance(value, float) and value != value:
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    return text


def parse_date(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = clean_str(value)
    if not text:
        return None
    text = text.replace("/", "-").replace(".", "-")
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        return None


def parse_decimal(value):
    text = clean_str(value)
    if not text:
        return None
    text = text.replace(" ", "").replace(",", ".")
    try:
        return Decimal(text)
    except InvalidOperation:
        return None
