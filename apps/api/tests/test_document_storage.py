from io import BytesIO
from pathlib import Path

import pytest
from fastapi import UploadFile

from finance_os_api.errors import ApiError
from finance_os_api.services.document_storage import LocalDocumentStorage, safe_filename

PDF_BYTES = b"%PDF-1.4\n% synthetic finance os fixture\n%%EOF\n"


@pytest.fixture
def storage(tmp_path: Path) -> LocalDocumentStorage:
    return LocalDocumentStorage(
        document_root=tmp_path / "documents",
        quarantine_root=tmp_path / "quarantine",
        max_bytes=1024,
    )


async def test_stages_and_commits_document_by_content_hash(
    storage: LocalDocumentStorage,
) -> None:
    upload = UploadFile(filename="invoice.pdf", file=BytesIO(PDF_BYTES))

    staged = await storage.stage(upload)
    storage_key = await storage.commit(staged)

    assert staged.content_type == "application/pdf"
    assert staged.size_bytes == len(PDF_BYTES)
    assert storage_key.endswith(staged.sha256)
    assert storage.resolve(storage_key).read_bytes() == PDF_BYTES
    assert not staged.path.exists()


async def test_commit_never_overwrites_existing_blob(storage: LocalDocumentStorage) -> None:
    first = await storage.stage(UploadFile(filename="first.pdf", file=BytesIO(PDF_BYTES)))
    second = await storage.stage(UploadFile(filename="second.pdf", file=BytesIO(PDF_BYTES)))

    first_key = await storage.commit(first)
    second_key = await storage.commit(second)

    assert first_key == second_key
    assert storage.resolve(first_key).read_bytes() == PDF_BYTES


async def test_rejects_unsupported_content_and_cleans_quarantine(
    storage: LocalDocumentStorage,
) -> None:
    upload = UploadFile(filename="invoice.pdf", file=BytesIO(b"not really a pdf"))

    with pytest.raises(ApiError, match="Only PDF") as error:
        await storage.stage(upload)

    assert error.value.status_code == 415
    assert list(storage.quarantine_root.iterdir()) == []


async def test_rejects_oversized_content(storage: LocalDocumentStorage) -> None:
    upload = UploadFile(filename="large.pdf", file=BytesIO(b"%PDF-" + (b"x" * 1024)))

    with pytest.raises(ApiError, match="may not exceed") as error:
        await storage.stage(upload)

    assert error.value.status_code == 413


@pytest.mark.parametrize(
    ("unsafe", "safe"),
    [
        ("../../bank/invoice.pdf", "invoice.pdf"),
        ("..\\..\\bank\\invoice.pdf", "invoice.pdf"),
        ("\x00\n.pdf", "pdf"),
        (None, "document"),
    ],
)
def test_sanitizes_display_filename(unsafe: str | None, safe: str) -> None:
    assert safe_filename(unsafe) == safe
