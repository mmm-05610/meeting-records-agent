"""AG-UI protocol endpoint for the agent service.

Exposes any agent in the service over the AG-UI protocol (https://docs.ag-ui.com)
so it can be used with AG-UI compatible frontends like CopilotKit. The
LangGraph -> AG-UI event translation is handled by the official `ag-ui-langgraph`
package; this module only wires it into the service's agent registry, auth, and
tracing.

See docs/AGUI.md for usage, including how to connect a client.
"""

import logging
from collections.abc import AsyncGenerator
from typing import Any
from uuid import uuid4

from ag_ui.core import EventType, RunAgentInput
from ag_ui.encoder import EventEncoder
from ag_ui_langgraph import LangGraphAgent
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from langchain_core.runnables import RunnableConfig
from langfuse.langchain import CallbackHandler  # type: ignore[import-untyped]

from agents import DEFAULT_AGENT, AgentGraph, get_agent
from core import settings
from service.utils import ensure_model_available

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agui")

# Managed by the protocol (thread_id comes from RunAgentInput) or the checkpointer,
# so clients may not override them via forwardedProps.configurable.
RESERVED_CONFIGURABLE_KEYS = {"thread_id", "checkpoint_id", "checkpoint_ns"}

# C05: the browser may only choose the meeting scope, a public model alias and an
# evaluation strategy. Identity, evidence and saved answers always come from the server.
FORBIDDEN_FORWARDED_PROPS = {"user_id", "configurable", "sources", "answer_record", "state"}
ALLOWED_FORWARDED_PROPS = {"meeting_scope", "model", "strategy"}
ALLOWED_STRATEGIES = {"B0", "B1", "B2"}


def _base_config(
    input_data: RunAgentInput, agent_id: str, request: Request | None = None
) -> RunnableConfig:
    """Build the base RunnableConfig for an AG-UI run.

    Clients can pass configurable values (e.g. `model`, `user_id`, or custom agent
    config) in `forwardedProps.configurable` - the AG-UI equivalent of the vanilla
    API's `model` / `user_id` / `agent_config` fields. `thread_id` is taken from
    the AG-UI input by the `ag-ui-langgraph` package itself.
    """
    forwarded: dict[str, Any] = dict(input_data.forwarded_props or {})
    if forbidden := FORBIDDEN_FORWARDED_PROPS & forwarded.keys():
        raise HTTPException(
            status_code=400,
            detail=f"forwardedProps may not carry server-owned fields: {sorted(forbidden)}",
        )
    if unknown := forwarded.keys() - ALLOWED_FORWARDED_PROPS:
        logger.warning("dropping unknown forwardedProps keys: %s", sorted(unknown))
    meeting_scope = forwarded.get("meeting_scope")
    if not isinstance(meeting_scope, dict):
        raise HTTPException(
            status_code=422,
            detail="forwardedProps.meeting_scope is required for the meeting assistant",
        )

    configurable: dict[str, Any] = {
        "meeting_scope": meeting_scope,
        # The web layer has already authenticated the local account; the agent never
        # trusts a browser-supplied identity.
        "user_id": request.headers.get("x-mra-user") if request is not None else str(uuid4()),
        "run_id": str(input_data.run_id),
    }
    if (model := forwarded.get("model")) is not None:
        ensure_model_available(model)
        configurable["model"] = model
    if (strategy := forwarded.get("strategy")) is not None:
        if strategy not in ALLOWED_STRATEGIES:
            raise HTTPException(status_code=422, detail=f"unsupported strategy: {strategy}")
        configurable["strategy"] = strategy

    callbacks: list[Any] = []
    if settings.LANGFUSE_TRACING:
        callbacks.append(CallbackHandler())

    return RunnableConfig(
        configurable=configurable,
        # Recorded in checkpoint metadata so AG-UI threads show up in /threads too.
        metadata={"user_id": configurable["user_id"], "agent_id": agent_id},
        callbacks=callbacks,
    )


async def _event_stream(
    agent_id: str,
    graph: AgentGraph,
    input_data: RunAgentInput,
    config: RunnableConfig,
    encoder: EventEncoder,
) -> AsyncGenerator[str, None]:
    # A new LangGraphAgent per request: it holds per-run state and is cheap to build.
    agent = LangGraphAgent(name=agent_id, graph=graph, config=config)  # type: ignore[arg-type]
    async for event in agent.run(input_data):
        # Don't forward RAW passthrough events. Standard AG-UI clients ignore them,
        # and they expose server-side internals - including fully rendered prompts
        # from on_chat_model_start - to the caller. Remove this filter only if the
        # endpoint is consumed by a trusted middle layer and you want the full
        # event firehose (e.g. for the AG-UI Event Inspector).
        if event.type == EventType.RAW:
            continue
        yield encoder.encode(event)


@router.post("/run", operation_id="agui_run_default")
@router.post("/{agent_id}/run", operation_id="agui_run")
async def agui_run(
    input_data: RunAgentInput, request: Request, agent_id: str = DEFAULT_AGENT
) -> StreamingResponse:
    """
    Run an agent over the AG-UI protocol, streaming AG-UI events via SSE.

    Point an AG-UI client (e.g. CopilotKit's runtime or HttpAgent) at this endpoint.
    Use the same threadId across runs to continue a conversation - threads are
    persisted in the service's checkpointer and shared with the vanilla API.
    """
    try:
        graph: AgentGraph = get_agent(agent_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")

    config = _base_config(input_data, agent_id, request)
    encoder = EventEncoder(accept=request.headers.get("accept", ""))
    return StreamingResponse(
        _event_stream(agent_id, graph, input_data, config, encoder),
        media_type=encoder.get_content_type(),
    )
