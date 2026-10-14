# Codex desktop HTTP configuration (unreleased)

This setup applies to the M2 development candidate. It is not part of the
accepted v0.1.0 release. Synthetic forwarding tests and configuration parsing
do not establish complete desktop compatibility.

## Configure the local service

Start the verified candidate on loopback with:

```powershell
$env:INLAY_UPSTREAM_BASE_URL = 'https://chatgpt.com/backend-api/codex'
$env:INLAY_OBSERVATION = 'structural'
$env:INLAY_RECURRENCE_PROBE = 'exact-item'
$env:INLAY_HISTORY_DIR = 'C:\inlay-data\history'
pnpm start
```

Choose a private local history directory. The dashboard should report Running
and history ready before changing the client. Authentication remains owned by
Codex; no credential is copied into Inlay configuration.

## Configure the client

For a Windows desktop client signed in with ChatGPT, add the following to
`%USERPROFILE%\.codex\config.toml`. Keep `model_provider` at the top level,
before any table headers. Keep the existing model and other settings.

```toml
model_provider = "inlay"

[model_providers.inlay]
name = "Inlay local"
base_url = "http://127.0.0.1:8787/v1"
wire_api = "responses"
requires_openai_auth = true
supports_websockets = false
```

Restart Codex desktop, check the selected provider/model, and use a fresh local
task. Existing tasks can retain their original provider. This user-level
configuration can also affect other Codex clients sharing the same config.

The fixed model-discovery route forwards `/models` and its query to the
configured upstream. It does not translate the catalog, observe model metadata,
retain headers or count discovery as a model exchange. The response route
continues to forward HTTP Responses/SSE. WebSocket, voice, sign-in, MCP and
plugin traffic are outside this path. No discovery endpoint is added for other
provider protocols.

## Verify and restore

During ordinary use, check that admitted and forwarding counts increase, then
that outcomes appear and active handlers return to zero. Verify streaming,
tool execution and a follow-up turn in the client. A model list alone, or an
increasing forwarding counter, does not prove provider receipt, task success or
complete client capability preservation. Reported usage is available only when
it reaches the observation boundary; missing values remain unavailable.

If client behavior fails, restore the prior `model_provider` selection (remove
it if the default OpenAI provider was previously used), remove only the added
`model_providers.inlay` table, and restart desktop. Keep Inlay running if the
local dashboard/history is still useful; do not delete history to reset routing.
When routing is active, the local service must remain available for model calls.

Reference: [ChatGPT sign-in through a gateway](https://learn.chatgpt.com/docs/enterprise/sign-in-with-chatgpt-through-a-gateway),
[provider configuration](https://learn.chatgpt.com/docs/config-file/config-reference),
and [Windows client setup](https://learn.chatgpt.com/docs/enterprise/connect-to-a-gateway).
