#!/usr/bin/env bash
# End-to-end probe of the workspace executor: server with the developer profile,
# headless workspace on selftest/workspace-project, runs with binding client.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project="${WORKSPACE_PROJECT:-$root/selftest/workspace-project}"
profile="developer"
port="${PORT:-4715}"
base="http://localhost:$port"
logs="${LOG_DIR:-${TMPDIR:-/tmp}/ragents-selftest}"
label="selftest-workspace"

usage() {
    cat <<'EOF'
Usage: selftest/workspace-client.sh <command>
  up             start server (profile developer) and workspace
  down           stop both
  status         show access, registered workspaces and processes
  run <text>     create a run with binding client and send the message; prints the run id
  journal <id>   read the run's tool calls and model responses
  stop <id>      cancel the run's current turn

Environment: OPENROUTER_API_KEY (required), DATA_DIR, LOG_DIR, PORT, WORKSPACE_PROJECT.
The workspace's startup fetches its language servers itself (pnpm provision --workspace);
ROSLYN_LANGUAGE_SERVER and FSHARP_LANGUAGE_SERVER override the tool folder.
EOF
}

rpc() {
    curl -s -m 180 -X POST "$base/rpc" -H 'content-type: application/json' \
        -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}"
}

client_id() {
    rpc ragents.workspace.clients.list '{}' | python3 -c \
        'import json,sys; entries=json.load(sys.stdin)["result"]; print(entries[0]["id"] if entries else "")'
}

data_directory() {
    echo "${DATA_DIR:-$HOME/.local/share/ragents/developer}"
}

up() {
    mkdir -p "$logs"
    if ! curl -s -m 2 -o /dev/null "$base/api/access"; then
        echo "== Server starting (log $logs/server.log)"
        (cd "$root" && nohup ./start.sh "$profile" > "$logs/server.log" 2>&1 &)
        until curl -s -m 2 -o /dev/null "$base/api/access"; do sleep 2; done
    fi
    echo "== Server on $base"
    if [ -z "$(client_id)" ]; then
        echo "== Workspace starting (log $logs/client.log)"
        (cd "$root" && nohup pnpm workspace-client "$base" "$project" --label "$label" > "$logs/client.log" 2>&1 &)
        until [ -n "$(client_id)" ]; do sleep 2; done
    fi
    echo "== Workspace $(client_id) on $project"
}

down() {
    pkill -f "run-workspace-client.ts $base" || true
    pkill -f "pnpm workspace-client $base" || true
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | xargs -r kill || true
    echo "== stopped"
}

status() {
    curl -s -m 5 "$base/api/access"; echo
    rpc ragents.workspace.clients.list '{}'; echo
    pgrep -fl "run-workspace-client.ts" || echo "no workspace"
}

new_run() {
    local text="$1" id client
    client="$(client_id)"
    [ -n "$client" ] || { echo "No workspace registered; run 'up' first." >&2; exit 1; }
    id="$(python3 -c 'import uuid; print(uuid.uuid4())')"
    rpc ragents.startOptions.select \
        "{\"runId\":\"$id\",\"optionId\":\"ragents.workspace.binding\",\"value\":{\"kind\":\"client\",\"client\":\"$client\",\"label\":\"$label\",\"path\":\"$project\"}}" > /dev/null
    python3 -c '
import json,sys,urllib.request
run,text,base=sys.argv[1],sys.argv[2],sys.argv[3]
body=json.dumps({"jsonrpc":"2.0","id":1,"method":"ragents.chat.send","params":{"runId":run,"text":text}}).encode()
urllib.request.urlopen(urllib.request.Request(base+"/rpc",body,{"content-type":"application/json"}),timeout=180).read()
' "$id" "$text" "$base"
    echo "$id"
}

journal() {
    python3 -c '
import json,os,sys
path=os.path.join(sys.argv[1],"runs",sys.argv[2],"journal.jsonl")
if not os.path.exists(path): sys.exit(f"Journal is missing: {path}")
for line in open(path):
    for event in json.loads(line)["events"]:
        kind=event["type"]; payload=event.get("payload") or {}
        if kind=="tool.call.started": print(event["sequence"],"start",payload.get("name"),json.dumps(payload.get("input"))[:300])
        elif kind=="tool.call.completed": print(event["sequence"],"done",payload.get("name"),"\n",str(payload.get("output"))[:2000])
        elif kind=="tool.call.failed": print(event["sequence"],"failed",payload.get("name"),str(payload.get("error"))[:600])
        elif kind=="model.output.completed": print(event["sequence"],"model:",str(payload.get("text"))[:2000])
        elif kind in ("turn.interrupted","turn.failed"): print(event["sequence"],kind,json.dumps(payload)[:300])
' "$(data_directory)" "$2"
}

case "${1:-}" in
    up) up ;;
    down) down ;;
    status) status ;;
    run) shift; [ $# -gt 0 ] || { usage; exit 1; }; new_run "$*" ;;
    journal) [ $# -eq 2 ] || { usage; exit 1; }; journal "$@" ;;
    stop) [ $# -eq 2 ] || { usage; exit 1; }; rpc ragents.chat.stop "{\"runId\":\"$2\"}"; echo ;;
    *) usage; exit 1 ;;
esac
