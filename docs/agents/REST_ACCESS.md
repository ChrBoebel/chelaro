# Agent REST access

Status: Implemented development contract  
Date: 2026-08-13

Chelaro exposes a narrow REST surface for local coding agents such as Codex and Claude Code. The owner remains the authority for original documents and canonical financial changes.

## Permission matrix

| Capability | Owner token | Agent token |
| --- | ---: | ---: |
| Read the personal finance dashboard | Yes | Yes |
| Read transactions, receivables, payment history, and audit events | Yes | Yes |
| Create transactions or mutate receivables directly | Yes | No |
| Propose receivable edits, payments, or payment corrections | No | Yes |
| Read typed invoice workbook | Yes | Yes |
| Apply a direct workbook change set | Yes | No |
| Create a workbook change proposal | No | Yes |
| List, approve, or reject proposals | Yes | No |
| List, upload, or download original documents | Yes | No |

An agent cannot turn a proposal into a canonical financial mutation. Approval is a separate owner-authenticated action in the web interface or owner API.

The dashboard follows a strict cash principle: an open receivable is expected money, not income. A partial or full receivable payment becomes income only when the owner records the receipt.

## Read personal finance data

The finance endpoints return decimal money values as JSON strings. Receivables expose a stable `id` and integer `version`; agents must re-read both before creating a proposal.

```bash
curl --fail-with-body \
  --header "Authorization: Bearer $FINANCE_OS_AGENT_TOKEN" \
  http://127.0.0.1:8000/api/v1/finance/dashboard

curl --fail-with-body \
  --header "Authorization: Bearer $FINANCE_OS_AGENT_TOKEN" \
  http://127.0.0.1:8000/api/v1/finance/receivables

curl --fail-with-body \
  --header "Authorization: Bearer $FINANCE_OS_AGENT_TOKEN" \
  http://127.0.0.1:8000/api/v1/finance/receivables/<receivable-id>
```

The detail response contains the original, received, and outstanding amounts, payment purpose and method, visible reversals, actor attribution, and append-only history.

## Propose a receivable payment

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer $FINANCE_OS_AGENT_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "action": "payment_record",
    "receivable_id": "<receivable-id>",
    "expected_version": 2,
    "rationale": "Zahlung im bereitgestellten Kontoauszug erkannt",
    "payment": {
      "amount": "50.00",
      "booked_on": "2026-08-13",
      "purpose": "Zweite Rate der Reisekosten",
      "payment_method": "bank_transfer",
      "note": "Verwendungszweck geprüft"
    }
  }' \
  http://127.0.0.1:8000/api/v1/finance/change-proposals
```

Allowed finance proposal actions are:

- `receivable_create` with `receivable` containing `debtor_name`, decimal-string
  `original_amount`, ISO `currency`, optional `due_date`, and `description`;
- `receivable_update` with `changes` containing one or more of `debtor_name`, `original_amount`, `due_date`, or `description`;
- `payment_record` with `payment` containing `amount`, `booked_on`, `purpose`, `payment_method`, and optional `note`;
- `payment_reverse` with `payment_id` and `reversal_reason`.

Valid payment methods are `bank_transfer`, `cash`, `paypal`, `card`, and `other`. A pending proposal
never changes canonical finance data. When the owner approves it, the mutation and its audit event
are committed atomically and retain the agent as originator. Approval fails with
`409 stale_receivable_version` if an existing receivable changed after the proposal was created.

## Configure credentials

Set two different random secrets in the root `.env`:

```dotenv
FINANCE_OS_API_TOKEN=<owner-only-random-secret>
FINANCE_OS_AGENT_TOKEN=<different-agent-random-secret>
```

Never put the owner token into an agent configuration. Never commit either token. In local development, the API listens on `http://127.0.0.1:8000`.

## Read workbook rows

The response contains stable row IDs, typed cells, and a per-row `version`. An agent must use that version when proposing a change.

```bash
curl --fail-with-body \
  --header "Authorization: Bearer $FINANCE_OS_AGENT_TOKEN" \
  http://127.0.0.1:8000/api/v1/workbooks/invoices
```

## Propose an atomic change set

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer $FINANCE_OS_AGENT_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "rationale": "Rechnungsnummer und Kategorie aus den strukturierten Daten ergänzt",
    "changes": [
      {
        "row_id": "<row-id-from-workbook>",
        "expected_version": 1,
        "cells": {
          "invoice_number": "RE-2026-1042",
          "category": "Software"
        }
      }
    ]
  }' \
  http://127.0.0.1:8000/api/v1/workbooks/invoices/change-proposals
```

The proposal stays pending and does not alter the workbook. The owner sees a compact before/after diff in the `Rechnungen` workspace and explicitly approves or rejects it. If the row changed after the proposal was created, approval fails with `409 stale_workbook_version`; the agent must read the latest row and create a new proposal.

## Typed editable cells

The current invoice workbook accepts:

- `vendor`: text or `null`
- `invoice_number`: text or `null`
- `invoice_date`: ISO date (`YYYY-MM-DD`) or `null`
- `gross_amount`: non-negative decimal with at most two decimal places or `null`
- `currency`: three-letter uppercase ISO code such as `EUR`
- `category`: text or `null`
- `status`: `unverified`, `verified`, `open`, `paid`, or `archived`
- `notes`: text or `null`

Unknown fields and duplicate row changes are rejected. A proposal can contain up to 100 rows and is committed as one unit.

## Error handling

Errors use a stable envelope:

```json
{
  "error": {
    "code": "stale_workbook_version",
    "message": "..."
  }
}
```

Agents should branch on `error.code`, not the human-readable message. Do not retry `401`, `403`, or validation errors automatically. Re-read after a version conflict. Network and `5xx` retries should be bounded and use backoff.

## Next adapter

REST access is available now. A dedicated MCP adapter remains planned; it will call the same domain services and preserve this permission model rather than introducing a second write path.
