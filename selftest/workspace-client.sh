#!/usr/bin/env bash
# Ende-zu-Ende-Probe des Arbeitsplatz-Executors: Server mit dem Profil developer,
# kopfloser Arbeitsplatz auf selftest/workspace-project, Runs mit Bindung client.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project="${WORKSPACE_PROJECT:-$root/selftest/workspace-project}"
profile="developer"
port="${PORT:-4715}"
base="http://localhost:$port"
logs="${LOG_DIR:-${TMPDIR:-/tmp}/ragents-selftest}"
label="selftest-arbeitsplatz"

usage() {
    cat <<'EOF'
Verwendung: selftest/workspace-client.sh <befehl>
  up             Server (Profil developer) und Arbeitsplatz starten
  down           beide beenden
  status         Zugang, angemeldete Arbeitsplätze und Prozesse zeigen
  run <text>     Run mit Bindung client anlegen und die Nachricht schicken; gibt die Run-Id aus
  journal <id>   Werkzeugaufrufe und Modellantworten des Runs lesen
  stop <id>      den laufenden Turn des Runs abbrechen

Umgebung: OPENROUTER_API_KEY (Pflicht), DATA_DIR, LOG_DIR, PORT, WORKSPACE_PROJECT.
Die Sprachserver des Arbeitsplatzes holt sein Start selbst (pnpm provision --workspace);
ROSLYN_LANGUAGE_SERVER und FSHARP_LANGUAGE_SERVER übersteuern den Werkzeugordner.
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
        echo "== Server startet (Log $logs/server.log)"
        (cd "$root" && nohup ./start.sh "$profile" > "$logs/server.log" 2>&1 &)
        until curl -s -m 2 -o /dev/null "$base/api/access"; do sleep 2; done
    fi
    echo "== Server auf $base"
    if [ -z "$(client_id)" ]; then
        echo "== Arbeitsplatz startet (Log $logs/client.log)"
        (cd "$root" && nohup pnpm workspace-client "$base" "$project" --label "$label" > "$logs/client.log" 2>&1 &)
        until [ -n "$(client_id)" ]; do sleep 2; done
    fi
    echo "== Arbeitsplatz $(client_id) auf $project"
}

down() {
    pkill -f "run-workspace-client.ts $base" || true
    pkill -f "pnpm workspace-client $base" || true
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | xargs -r kill || true
    echo "== beendet"
}

status() {
    curl -s -m 5 "$base/api/access"; echo
    rpc ragents.workspace.clients.list '{}'; echo
    pgrep -fl "run-workspace-client.ts" || echo "kein Arbeitsplatz"
}

new_run() {
    local text="$1" id client
    client="$(client_id)"
    [ -n "$client" ] || { echo "Kein Arbeitsplatz angemeldet; erst 'up'." >&2; exit 1; }
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
if not os.path.exists(path): sys.exit(f"Journal fehlt: {path}")
for line in open(path):
    for event in json.loads(line)["events"]:
        kind=event["type"]; payload=event.get("payload") or {}
        if kind=="tool.call.started": print(event["sequence"],"start",payload.get("name"),json.dumps(payload.get("input"))[:300])
        elif kind=="tool.call.completed": print(event["sequence"],"fertig",payload.get("name"),"\n",str(payload.get("output"))[:2000])
        elif kind=="tool.call.failed": print(event["sequence"],"gescheitert",payload.get("name"),str(payload.get("error"))[:600])
        elif kind=="model.output.completed": print(event["sequence"],"modell:",str(payload.get("text"))[:2000])
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
