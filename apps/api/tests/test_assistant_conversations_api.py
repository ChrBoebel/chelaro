import sqlite3
from collections.abc import AsyncIterator
from hashlib import sha256
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import AnyHttpUrl, SecretStr

from finance_os_api.config import Settings
from finance_os_api.main import create_app


def runtime_binding(provider_thread_id: str) -> dict[str, str]:
    return {
        "provider_thread_id": provider_thread_id,
        "provider_model": "gpt-5.5",
        "provider_effort": "medium",
        "provider_service_tier": "default",
    }


OWNER_TOKEN = "conversation-test-owner-token"
AGENT_TOKEN = "conversation-test-agent-token"
ASSISTANT_TOKEN = "conversation-test-assistant-token"


@pytest.fixture
async def clients(
    tmp_path: Path,
) -> AsyncIterator[tuple[AsyncClient, AsyncClient, AsyncClient, Path]]:
    database_path = tmp_path / "finance-os.sqlite3"
    app = create_app(settings(database_path, tmp_path))
    transport = ASGITransport(app=app)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": f"Bearer {OWNER_TOKEN}"},
        ) as owner,
        AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": f"Bearer {AGENT_TOKEN}"},
        ) as agent,
        AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": f"Bearer {ASSISTANT_TOKEN}"},
        ) as assistant,
    ):
        yield owner, agent, assistant, database_path


async def test_complete_conversation_survives_api_restart(
    clients: tuple[AsyncClient, AsyncClient, AsyncClient, Path],
    tmp_path: Path,
) -> None:
    owner, _agent, assistant, database_path = clients
    created = await owner.post("/api/v1/assistant/conversations", json={})
    assert created.status_code == 201
    conversation = created.json()["data"]
    conversation_id = conversation["id"]
    assert conversation["title"] == "Neue Unterhaltung"
    assert conversation["status"] == "active"
    assert conversation["message_count"] == 0

    bound = await assistant.put(
        f"/api/v1/finance-assistant/conversations/{conversation_id}/runtime",
        json=runtime_binding("provider_thread_synthetic_1"),
    )
    assert bound.status_code == 200
    assert bound.json()["data"] == {
        "conversation_id": conversation_id,
        "provider_thread_id": "provider_thread_synthetic_1",
        "provider_model": "gpt-5.5",
        "provider_effort": "medium",
        "provider_service_tier": "default",
    }

    turn_id = "turn_synthetic_1"
    reserved = await assistant.post(
        f"/api/v1/finance-assistant/conversations/{conversation_id}/turns",
        json={
            "prompt": "Wie hoch ist mein synthetischer Testsaldo?",
            "turn_id": turn_id,
        },
    )
    assert reserved.status_code == 201
    assert reserved.json()["data"]["status"] == "reserved"

    answer = "Der synthetische Testsaldo beträgt 42,00 EUR."
    completed = await assistant.post(
        f"/api/v1/finance-assistant/conversations/{conversation_id}/turns/{turn_id}/complete",
        json={
            "messages": [
                {
                    "message_id": "message_1",
                    "sha256": sha256(answer.encode()).hexdigest(),
                    "text": answer,
                }
            ],
            "provider_turn_id": "provider_turn_synthetic_1",
        },
    )
    assert completed.status_code == 200

    messages = await owner.get(
        f"/api/v1/assistant/conversations/{conversation_id}/messages?limit=50"
    )
    assert messages.status_code == 200
    assert [(item["role"], item["text"], item["status"]) for item in messages.json()["data"]] == [
        ("user", "Wie hoch ist mein synthetischer Testsaldo?", "complete"),
        ("assistant", answer, "complete"),
    ]

    with sqlite3.connect(database_path) as connection:
        events = connection.execute(
            "SELECT event_type, details FROM assistant_conversation_events ORDER BY id"
        ).fetchall()
    assert [event[0] for event in events] == [
        "created",
        "provider_bound",
        "turn_reserved",
        "turn_completed",
    ]
    assert all(answer not in str(details) for _, details in events)
    assert all("synthetischer Testsaldo" not in str(details) for _, details in events)

    await owner.aclose()
    await assistant.aclose()

    restarted = create_app(settings(database_path, tmp_path))
    transport = ASGITransport(app=restarted)
    async with (
        restarted.router.lifespan_context(restarted),
        AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": f"Bearer {OWNER_TOKEN}"},
        ) as restarted_owner,
        AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": f"Bearer {ASSISTANT_TOKEN}"},
        ) as restarted_assistant,
    ):
        history = await restarted_owner.get(
            f"/api/v1/assistant/conversations/{conversation_id}/messages?limit=50"
        )
        runtime = await restarted_assistant.get(
            f"/api/v1/finance-assistant/conversations/{conversation_id}/runtime"
        )

    assert history.status_code == 200
    assert [item["text"] for item in history.json()["data"]] == [
        "Wie hoch ist mein synthetischer Testsaldo?",
        answer,
    ]
    assert runtime.json()["data"]["provider_thread_id"] == "provider_thread_synthetic_1"


async def test_conversation_turn_reservation_is_idempotent_and_rejects_changed_prompt(
    clients: tuple[AsyncClient, AsyncClient, AsyncClient, Path],
) -> None:
    owner, _agent, assistant, _database_path = clients
    conversation_id = (await owner.post("/api/v1/assistant/conversations", json={})).json()["data"][
        "id"
    ]
    payload = {"prompt": "Synthetische Frage", "turn_id": "turn_idempotent_1"}

    first = await assistant.post(
        f"/api/v1/finance-assistant/conversations/{conversation_id}/turns",
        json=payload,
    )
    replay = await assistant.post(
        f"/api/v1/finance-assistant/conversations/{conversation_id}/turns",
        json=payload,
    )
    conflict = await assistant.post(
        f"/api/v1/finance-assistant/conversations/{conversation_id}/turns",
        json={**payload, "prompt": "Geänderter Inhalt"},
    )

    assert first.status_code == 201
    assert replay.status_code == 200
    assert replay.json() == first.json()
    assert conflict.status_code == 409
    messages = await owner.get(
        f"/api/v1/assistant/conversations/{conversation_id}/messages?limit=50"
    )
    assert [item["text"] for item in messages.json()["data"]] == ["Synthetische Frage"]


async def test_message_pagination_reconstructs_the_complete_ordered_conversation(
    clients: tuple[AsyncClient, AsyncClient, AsyncClient, Path],
) -> None:
    owner, _agent, assistant, _database_path = clients
    conversation_id = (await owner.post("/api/v1/assistant/conversations", json={})).json()[
        "data"
    ]["id"]
    for index in (1, 2):
        turn_id = f"turn_page_{index}"
        await assistant.post(
            f"/api/v1/finance-assistant/conversations/{conversation_id}/turns",
            json={"turn_id": turn_id, "prompt": f"Frage {index}"},
        )
        await assistant.post(
            f"/api/v1/finance-assistant/conversations/{conversation_id}"
            f"/turns/{turn_id}/complete",
            json={
                "provider_turn_id": f"provider_turn_page_{index}",
                "messages": [completed_message(f"message_page_{index}", f"Antwort {index}")],
            },
        )

    newest = await owner.get(
        f"/api/v1/assistant/conversations/{conversation_id}/messages?limit=2"
    )
    cursor = newest.json()["next_before_sequence"]
    oldest = await owner.get(
        f"/api/v1/assistant/conversations/{conversation_id}/messages"
        f"?limit=2&before_sequence={cursor}"
    )

    assert [message["text"] for message in oldest.json()["data"] + newest.json()["data"]] == [
        "Frage 1",
        "Antwort 1",
        "Frage 2",
        "Antwort 2",
    ]
    assert cursor == 3
    assert oldest.json()["next_before_sequence"] is None


async def test_turn_completion_replay_rejects_changed_provider_output(
    clients: tuple[AsyncClient, AsyncClient, AsyncClient, Path],
) -> None:
    owner, _agent, assistant, _database_path = clients
    conversation_id = (await owner.post("/api/v1/assistant/conversations", json={})).json()[
        "data"
    ]["id"]
    await assistant.post(
        f"/api/v1/finance-assistant/conversations/{conversation_id}/turns",
        json={"turn_id": "turn_replay", "prompt": "Synthetische Frage"},
    )
    first = {
        "provider_turn_id": "provider_turn_replay",
        "messages": [completed_message("message_replay", "Synthetische Antwort")],
    }
    endpoint = (
        f"/api/v1/finance-assistant/conversations/{conversation_id}"
        "/turns/turn_replay/complete"
    )
    completed = await assistant.post(endpoint, json=first)
    replay = await assistant.post(endpoint, json=first)
    changed = await assistant.post(
        endpoint,
        json={
            "provider_turn_id": "provider_turn_replay",
            "messages": [completed_message("message_replay", "Geänderte Antwort")],
        },
    )

    assert completed.status_code == 200
    assert replay.status_code == 200
    assert changed.status_code == 409
    assert changed.json()["error"]["code"] == "idempotency_conflict"


async def test_provider_thread_binding_is_unique_and_immutable(
    clients: tuple[AsyncClient, AsyncClient, AsyncClient, Path],
) -> None:
    owner, _agent, assistant, _database_path = clients
    first_id = (await owner.post("/api/v1/assistant/conversations", json={})).json()["data"][
        "id"
    ]
    second_id = (await owner.post("/api/v1/assistant/conversations", json={})).json()["data"][
        "id"
    ]
    endpoint = f"/api/v1/finance-assistant/conversations/{first_id}/runtime"
    first = await assistant.put(endpoint, json=runtime_binding("provider_thread_1"))
    replay = await assistant.put(endpoint, json=runtime_binding("provider_thread_1"))
    rebound = await assistant.put(endpoint, json=runtime_binding("provider_thread_2"))
    duplicate = await assistant.put(
        f"/api/v1/finance-assistant/conversations/{second_id}/runtime",
        json=runtime_binding("provider_thread_1"),
    )

    assert first.status_code == 200
    assert replay.status_code == 200
    assert rebound.status_code == 409
    assert duplicate.status_code == 409
    assert rebound.json()["error"]["code"] == "provider_thread_conflict"
    assert duplicate.json()["error"]["code"] == "provider_thread_conflict"


async def test_owner_can_rename_archive_restore_and_delete_local_chat_content(
    clients: tuple[AsyncClient, AsyncClient, AsyncClient, Path],
) -> None:
    owner, _agent, assistant, _database_path = clients
    conversation = (await owner.post("/api/v1/assistant/conversations", json={})).json()["data"]
    conversation_id = conversation["id"]
    await assistant.post(
        f"/api/v1/finance-assistant/conversations/{conversation_id}/turns",
        json={"prompt": "Synthetischer Löschtest", "turn_id": "turn_delete_1"},
    )

    renamed = await owner.patch(
        f"/api/v1/assistant/conversations/{conversation_id}",
        json={"expected_version": 2, "title": "Testverlauf"},
    )
    assert renamed.status_code == 200
    archived = await owner.patch(
        f"/api/v1/assistant/conversations/{conversation_id}",
        json={"expected_version": 3, "status": "archived"},
    )
    assert archived.status_code == 200
    assert archived.json()["data"]["status"] == "archived"
    active = await owner.get("/api/v1/assistant/conversations?status=active")
    archived_list = await owner.get("/api/v1/assistant/conversations?status=archived")
    assert active.json()["data"] == []
    assert [item["id"] for item in archived_list.json()["data"]] == [conversation_id]

    restored = await owner.patch(
        f"/api/v1/assistant/conversations/{conversation_id}",
        json={"expected_version": 4, "status": "active"},
    )
    assert restored.status_code == 200
    deleted = await owner.delete(f"/api/v1/assistant/conversations/{conversation_id}")
    assert deleted.status_code == 204
    assert (
        await owner.get(f"/api/v1/assistant/conversations/{conversation_id}")
    ).status_code == 404
    assert (
        await owner.get(f"/api/v1/assistant/conversations/{conversation_id}/messages")
    ).status_code == 404
    assert (
        await assistant.get(f"/api/v1/finance-assistant/conversations/{conversation_id}/runtime")
    ).status_code == 404


async def test_conversation_routes_enforce_owner_and_assistant_scopes(
    clients: tuple[AsyncClient, AsyncClient, AsyncClient, Path],
) -> None:
    owner, agent, assistant, _database_path = clients
    conversation_id = (await owner.post("/api/v1/assistant/conversations", json={})).json()["data"][
        "id"
    ]

    assert (await agent.get("/api/v1/assistant/conversations")).status_code == 403
    assert (await assistant.get("/api/v1/assistant/conversations")).status_code == 403
    assert (
        await owner.get(f"/api/v1/finance-assistant/conversations/{conversation_id}/runtime")
    ).status_code == 403
    assert (
        await agent.get(f"/api/v1/finance-assistant/conversations/{conversation_id}/runtime")
    ).status_code == 403


def settings(database_path: Path, tmp_path: Path) -> Settings:
    return Settings(
        env="test",
        api_token=SecretStr(OWNER_TOKEN),
        agent_token=SecretStr(AGENT_TOKEN),
        finance_assistant_token=SecretStr(ASSISTANT_TOKEN),
        database_url=f"sqlite+aiosqlite:///{database_path}",
        document_root=tmp_path / "documents",
        quarantine_root=tmp_path / "quarantine",
        web_origin=AnyHttpUrl("http://localhost:3000"),
    )


def completed_message(message_id: str, text: str) -> dict[str, str]:
    return {
        "message_id": message_id,
        "sha256": sha256(text.encode()).hexdigest(),
        "text": text,
    }
