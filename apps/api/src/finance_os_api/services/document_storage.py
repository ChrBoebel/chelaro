import asyncio
import hashlib
import os
import tempfile
import unicodedata
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

import aiofiles
from fastapi import UploadFile

from finance_os_api.errors import ApiError

CHUNK_SIZE = 1024 * 1024


@dataclass(frozen=True, slots=True)
class StagedDocument:
    path: Path
    sha256: str
    size_bytes: int
    filename: str
    content_type: str


class LocalDocumentStorage:
    def __init__(self, *, document_root: Path, quarantine_root: Path, max_bytes: int) -> None:
        self.document_root = document_root.resolve()
        self.quarantine_root = quarantine_root.resolve()
        self.max_bytes = max_bytes

    def prepare_directories(self) -> None:
        self.document_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.quarantine_root.mkdir(parents=True, exist_ok=True, mode=0o700)

    async def stage(self, upload: UploadFile) -> StagedDocument:
        self.prepare_directories()
        file_descriptor, temporary_name = tempfile.mkstemp(
            prefix="finance-os-",
            suffix=".upload",
            dir=self.quarantine_root,
        )
        os.close(file_descriptor)
        temporary_path = Path(temporary_name)
        digest = hashlib.sha256()
        size_bytes = 0
        prefix = b""

        try:
            async with aiofiles.open(temporary_path, "wb") as destination:
                while chunk := await upload.read(CHUNK_SIZE):
                    size_bytes += len(chunk)
                    if size_bytes > self.max_bytes:
                        raise ApiError(
                            status_code=413,
                            code="file_too_large",
                            message=f"Files may not exceed {self.max_bytes} bytes.",
                        )
                    if len(prefix) < 16:
                        prefix = (prefix + chunk)[:16]
                    digest.update(chunk)
                    await destination.write(chunk)

            if size_bytes == 0:
                raise ApiError(
                    status_code=422,
                    code="empty_document",
                    message="The uploaded document is empty.",
                )

            content_type = detect_content_type(prefix)
            if content_type is None:
                raise ApiError(
                    status_code=415,
                    code="unsupported_document_type",
                    message="Only PDF, PNG, and JPEG documents are supported.",
                )

            return StagedDocument(
                path=temporary_path,
                sha256=digest.hexdigest(),
                size_bytes=size_bytes,
                filename=safe_filename(upload.filename),
                content_type=content_type,
            )
        except Exception:
            await unlink_if_exists(temporary_path)
            raise

    async def commit(self, staged: StagedDocument) -> str:
        storage_key = f"{staged.sha256[:2]}/{staged.sha256[2:4]}/{staged.sha256}"
        destination = self.resolve(storage_key)
        await asyncio.to_thread(destination.parent.mkdir, parents=True, exist_ok=True, mode=0o700)

        try:
            await asyncio.to_thread(os.link, staged.path, destination)
        except FileExistsError:
            pass
        finally:
            await unlink_if_exists(staged.path)
        return storage_key

    async def discard(self, staged: StagedDocument) -> None:
        await unlink_if_exists(staged.path)

    def resolve(self, storage_key: str) -> Path:
        path = (self.document_root / storage_key).resolve()
        if not path.is_relative_to(self.document_root):
            raise ApiError(
                status_code=500,
                code="invalid_storage_key",
                message="Stored document path is invalid.",
            )
        return path


def detect_content_type(prefix: bytes) -> str | None:
    if prefix.startswith(b"%PDF-"):
        return "application/pdf"
    if prefix.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if prefix.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    return None


def safe_filename(filename: str | None) -> str:
    normalized = unicodedata.normalize("NFC", (filename or "document").replace("\\", "/"))
    basename = PurePosixPath(normalized).name
    cleaned = "".join(character for character in basename if character.isprintable())
    cleaned = cleaned.strip().strip(".")
    return cleaned[:240] or "document"


async def unlink_if_exists(path: Path) -> None:
    with suppress(FileNotFoundError):
        await asyncio.to_thread(path.unlink)
