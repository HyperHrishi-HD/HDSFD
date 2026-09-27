"""Provider-neutral School Connect parsing and persistence helpers.

This module deliberately accepts exported school data only. It does not accept
or store school passwords, session cookies, access tokens, or client secrets.
"""

import csv
import hashlib
import io
import json
import re
import uuid
from datetime import datetime

MAX_IMPORT_BYTES = 1_500_000
MAX_RECORDS = 1_000
MAX_TEXT_LENGTH = 2_000

SUPPORTED_FORMATS = ("ics", "csv")
SUPPORTED_PROVIDERS = (
    "ics",
    "csv",
    "google_classroom",
    "canvas",
    "schoology",
    "classlink",
    "clever",
    "hac",
    "powerschool",
)

SENSITIVE_SOURCE_KEYS = {
    "password",
    "passwd",
    "secret",
    "token",
    "access_token",
    "refresh_token",
    "client_secret",
    "credentials",
    "cookie",
    "session",
}

SQLITE_SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS school_sources (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        provider TEXT NOT NULL,
        display_name TEXT NOT NULL,
        external_url TEXT,
        status TEXT NOT NULL DEFAULT 'not_configured',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(owner, id)
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS school_sources_owner_idx
    ON school_sources(owner, updated_at)
    """,
    """
    CREATE TABLE IF NOT EXISTS school_records (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        source_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        record_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(owner, source_id, external_id)
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS school_records_owner_idx
    ON school_records(owner, source_id, updated_at)
    """,
    """
    CREATE TABLE IF NOT EXISTS school_imports (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        source_id TEXT NOT NULL,
        import_format TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        imported_count INTEGER NOT NULL DEFAULT 0,
        created_count INTEGER NOT NULL DEFAULT 0,
        updated_count INTEGER NOT NULL DEFAULT 0,
        warnings_json TEXT NOT NULL DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(owner, source_id, content_hash)
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS school_imports_owner_idx
    ON school_imports(owner, created_at)
    """,
)


def ensure_school_tables(conn):
    """Create the local compatibility tables used by either Flask runtime."""
    for statement in SQLITE_SCHEMA:
        conn.execute(statement)
    conn.commit()


def clean_text(value, limit=MAX_TEXT_LENGTH):
    if value is None:
        return ""
    value = str(value).replace("\x00", "")
    value = " ".join(value.split())
    return value[:limit].strip()


def clean_multiline(value, limit=MAX_TEXT_LENGTH):
    if value is None:
        return ""
    value = str(value).replace("\x00", "")
    return value[:limit].strip()


def normalize_header(value):
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


def content_hash(content):
    if isinstance(content, bytes):
        raw = content
    else:
        raw = str(content).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def stable_external_id(source_kind, *values):
    normalized = "|".join(clean_text(v, 500).lower() for v in values)
    digest = hashlib.sha256((source_kind + "|" + normalized).encode("utf-8")).hexdigest()
    return f"{source_kind}:{digest[:40]}"


def default_source_id(owner, import_format):
    digest = hashlib.sha256(f"{owner}|{import_format}".encode("utf-8")).hexdigest()[:24]
    return f"manual_{import_format}_{digest}"


def validate_source_payload(data):
    """Return safe source metadata or raise ValueError for secret-like input."""
    if not isinstance(data, dict):
        raise ValueError("Source payload must be an object")
    for key in data:
        if normalize_header(key) in SENSITIVE_SOURCE_KEYS:
            raise ValueError("School credentials and tokens are not accepted")

    provider = clean_text(data.get("provider"), 50).lower()
    if provider not in SUPPORTED_PROVIDERS:
        raise ValueError("Unsupported school provider")

    display_name = clean_text(data.get("display_name") or data.get("name") or provider, 120)
    if not display_name:
        raise ValueError("Source display name is required")

    external_url = clean_text(data.get("external_url") or data.get("url"), 500)
    if external_url and not re.match(r"^https?://", external_url, re.IGNORECASE):
        raise ValueError("Source URL must use http or https")

    status = "not_configured" if provider not in ("ics", "csv") else "ready"
    return {
        "provider": provider,
        "display_name": display_name,
        "external_url": external_url or None,
        "status": status,
    }


def _decode_content(content):
    if isinstance(content, bytes):
        if len(content) > MAX_IMPORT_BYTES:
            raise ValueError("Import file is too large")
        try:
            return content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise ValueError("Import file must be UTF-8 text") from exc
    text = str(content)
    if len(text.encode("utf-8")) > MAX_IMPORT_BYTES:
        raise ValueError("Import file is too large")
    return text.lstrip("\ufeff")


def _unfold_ics_lines(text):
    unfolded = []
    for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw_line.startswith((" ", "\t")) and unfolded:
            unfolded[-1] += raw_line[1:]
        else:
            unfolded.append(raw_line)
    return unfolded


def _unescape_ics(value):
    return (
        str(value or "")
        .replace("\\N", "\n")
        .replace("\\n", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
    )


def _parse_ics_property(line):
    if ":" not in line:
        return None, {}, ""
    left, value = line.split(":", 1)
    pieces = left.split(";")
    name = pieces[0].upper().strip()
    params = {}
    for piece in pieces[1:]:
        if "=" in piece:
            key, param_value = piece.split("=", 1)
            params[key.upper().strip()] = param_value.strip().strip('"')
    return name, params, _unescape_ics(value)


def _iso_datetime(value, params=None):
    value = clean_text(value, 80)
    params = params or {}
    if not value:
        return None, None, False
    if re.match(r"^\d{8}$", value):
        return f"{value[0:4]}-{value[4:6]}-{value[6:8]}", params.get("TZID"), True

    timezone_name = params.get("TZID")
    is_utc = value.endswith("Z")
    raw = value[:-1] if is_utc else value
    if re.match(r"^\d{8}T\d{6}$", raw):
        try:
            parsed = datetime.strptime(raw, "%Y%m%dT%H%M%S")
            result = parsed.strftime("%Y-%m-%dT%H:%M:%S")
            if is_utc:
                result += "+00:00"
            return result, "UTC" if is_utc else timezone_name, False
        except ValueError:
            return value, timezone_name, False
    return value, timezone_name, False


def _record_from_ics(properties):
    summary = clean_text(properties.get("SUMMARY", ("", {}))[0])
    description = clean_multiline(properties.get("DESCRIPTION", ("", {}))[0])
    location = clean_text(properties.get("LOCATION", ("", {}))[0], 300)
    uid = clean_text(properties.get("UID", ("", {}))[0], 200)
    start, timezone_name, start_all_day = _iso_datetime(*properties.get("DTSTART", ("", {})))
    end, end_timezone, end_all_day = _iso_datetime(*properties.get("DTEND", ("", {})))
    timezone_name = timezone_name or end_timezone
    if not summary and not start:
        return None, "Event is missing both SUMMARY and DTSTART"
    if not summary:
        summary = "School event"

    external_id = uid or stable_external_id("ics", summary, start or "", end or "", location)
    record_type = "event" if start or end else "assignment"
    return {
        "external_id": external_id[:200],
        "record_type": record_type,
        "title": summary,
        "description": description,
        "course": "",
        "due_at": start if record_type == "assignment" else None,
        "start_at": start,
        "end_at": end,
        "timezone": timezone_name,
        "all_day": bool(start_all_day or end_all_day),
        "location": location,
        "status": "completed" if properties.get("STATUS", ("", {}))[0].upper() == "COMPLETED" else "active",
    }, None


def parse_ics(content):
    text = _decode_content(content)
    records = []
    warnings = []
    current = None
    in_event = False

    for line_number, line in enumerate(_unfold_ics_lines(text), start=1):
        marker = line.strip().upper()
        if marker == "BEGIN:VEVENT":
            if current is not None:
                warnings.append(f"Line {line_number}: nested VEVENT was closed")
            current = {}
            in_event = True
            continue
        if marker == "END:VEVENT":
            if current is None:
                warnings.append(f"Line {line_number}: END:VEVENT without BEGIN:VEVENT")
            else:
                record, warning = _record_from_ics(current)
                if record:
                    records.append(record)
                if warning:
                    warnings.append(f"Line {line_number}: {warning}")
            current = None
            in_event = False
            continue
        if not in_event or not line.strip():
            continue
        name, params, value = _parse_ics_property(line)
        if name:
            current[name] = (value, params)

    if current is not None:
        warnings.append("File ended before END:VEVENT")
        record, warning = _record_from_ics(current)
        if record:
            records.append(record)
        if warning:
            warnings.append(warning)

    if not records and not warnings:
        warnings.append("No VEVENT records found")
    return records[:MAX_RECORDS], warnings[:100]


def _row_value(row, aliases):
    for alias in aliases:
        if alias in row and clean_text(row.get(alias)):
            return row.get(alias)
    return ""


def _record_from_csv_row(row, row_number, source_kind="csv"):
    title = clean_text(_row_value(row, ("title", "summary", "name", "assignment", "task", "event")))
    description = clean_multiline(_row_value(row, ("description", "details", "notes", "body")))
    course = clean_text(_row_value(row, ("course", "class", "subject", "course_name")), 160)
    due_at = clean_text(_row_value(row, ("due", "due_date", "deadline", "due_at")), 80)
    start_at = clean_text(_row_value(row, ("start", "start_date", "start_at", "datetime")), 80)
    end_at = clean_text(_row_value(row, ("end", "end_date", "end_at")), 80)
    location = clean_text(_row_value(row, ("location", "room")), 300)
    external_id = clean_text(_row_value(row, ("external_id", "id", "uid", "assignment_id")), 200)
    status_value = clean_text(_row_value(row, ("status", "state", "completion")), 40).lower()
    if not title:
        return None, f"Row {row_number}: title or assignment is required"
    if not external_id:
        external_id = stable_external_id(source_kind, title, course, due_at, start_at, location)

    record_type = "event" if start_at or end_at else "assignment"
    if record_type == "assignment" and not due_at:
        due_at = start_at or None
    return {
        "external_id": external_id,
        "record_type": record_type,
        "title": title,
        "description": description,
        "course": course,
        "due_at": due_at,
        "start_at": start_at or None,
        "end_at": end_at or None,
        "timezone": clean_text(_row_value(row, ("timezone", "tz")), 80) or None,
        "all_day": clean_text(_row_value(row, ("all_day", "all_day_event")), 10).lower() in ("1", "true", "yes", "y"),
        "location": location,
        "status": "completed" if status_value in ("completed", "complete", "done", "submitted") else "active",
    }, None


def parse_csv(content):
    text = _decode_content(content)
    try:
        reader = csv.DictReader(io.StringIO(text, newline=""))
    except csv.Error as exc:
        raise ValueError("Invalid CSV file") from exc
    if not reader.fieldnames:
        raise ValueError("CSV file must include a header row")

    fieldnames = [normalize_header(field) for field in reader.fieldnames]
    if not any(field in fieldnames for field in ("title", "summary", "name", "assignment", "task", "event")):
        raise ValueError("CSV must include a title, assignment, or event column")

    records = []
    warnings = []
    for row_number, raw_row in enumerate(reader, start=2):
        if row_number > MAX_RECORDS + 1:
            warnings.append(f"Only the first {MAX_RECORDS} rows were imported")
            break
        row = {}
        for original_key, value in raw_row.items():
            row[normalize_header(original_key)] = value
        record, warning = _record_from_csv_row(row, row_number)
        if record:
            records.append(record)
        if warning:
            warnings.append(warning)
    return records, warnings[:100]


def parse_import(import_format, content):
    import_format = clean_text(import_format, 10).lower()
    if import_format not in SUPPORTED_FORMATS:
        raise ValueError("Import format must be ics or csv")
    if import_format == "ics":
        records, warnings = parse_ics(content)
    else:
        records, warnings = parse_csv(content)
    return {
        "format": import_format,
        "content_hash": content_hash(content),
        "records": records,
        "warnings": warnings,
    }


def new_source_id():
    return f"school_{uuid.uuid4().hex}"


def public_source(row):
    if hasattr(row, "keys"):
        get = row.__getitem__
    else:
        get = row.get
    return {
        "id": get("id"),
        "provider": get("provider"),
        "display_name": get("display_name"),
        "external_url": get("external_url"),
        "status": get("status"),
        "created_at": get("created_at"),
        "updated_at": get("updated_at"),
    }


def record_payload(record, owner, source_id, imported_at):
    payload = dict(record)
    payload.update({
        "type": "academic_record",
        "owner": owner,
        "source_id": source_id,
        "imported_at": imported_at,
    })
    return payload


def serialize_record(record):
    return json.dumps(record, ensure_ascii=True, separators=(",", ":"))


def now_iso():
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
