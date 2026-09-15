"""JSON-lines tool adapter. Imports tool functions, never AIAgent or Hermes CLI."""
import contextlib
import json
import os
import sys

protocol = sys.stdout
# Keep import/status prints out of the protocol.
with contextlib.redirect_stdout(sys.stderr):
    from model_tools import get_tool_definitions, handle_function_call

toolsets = json.loads(os.environ.get("KOORDYNATOR_BRIDGE_TOOLSETS", '["skills"]'))
with contextlib.redirect_stdout(sys.stderr):
    definitions = get_tool_definitions(enabled_toolsets=toolsets, quiet_mode=True, skip_tool_search_assembly=True)
allowed = set(json.loads(os.environ["KOORDYNATOR_BRIDGE_ALLOWED"]))
definitions = [d for d in definitions if d["function"]["name"] in allowed]
names = [d["function"]["name"] for d in definitions]
protocol.write(json.dumps({"ready": True, "tools": definitions}) + "\n")
protocol.flush()
for line in sys.stdin:
    req = None
    try:
        req = json.loads(line)
        name = req["name"]
        if name not in names:
            raise ValueError("TOOL_NOT_ALLOWED")
        if not isinstance(req.get("arguments"), dict):
            raise ValueError("TOOL_ARGUMENTS_INVALID")
        with contextlib.redirect_stdout(sys.stderr):
            result = handle_function_call(name, req["arguments"], task_id=req["sessionId"],
                session_id=req["sessionId"], tool_call_id=req["id"], user_task=req.get("userTask", ""),
                enabled_tools=names, enabled_toolsets=toolsets)
        payload = {"id": req["id"], "result": result}
    except Exception as exc:
        payload = {"id": req.get("id") if isinstance(req, dict) else None, "error": str(exc)}
    protocol.write(json.dumps(payload, ensure_ascii=False) + "\n")
    protocol.flush()
