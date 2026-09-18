# RAgents HTTP-Management-API

[OpenAPI 3.1](openapi.json)

Diese Referenz entsteht aus den registrierten Routenverträgen. Interne und externe Agenten verwenden dieselbe HTTP-API.

Basis: /api/plugins/ragents.overseer

Die Shellvariable RAGENTS_API_BASE_URL enthält die Serveradresse, nicht den API-Pfad. Falls RAGENTS_API_TOKEN gesetzt ist, bei Anfragen den Header Authorization: Bearer <Token> senden. Der Token gehört nicht in Ausgaben oder Dokumente.

Run-Pfade akzeptieren eine Run-ID, einen eindeutigen Titel oder eine stabile Referenz wie Lauf 1. Titel und Referenzen im URL-Pfad kodieren; IDs aus Antworten per Programm weiterverwenden, nicht vom Modell abschreiben lassen.

Verschachtelte RunView-Domänenwerte und Ereignis-Payloads sind offene JSON-Objekte mit Verweis auf ihre TypeScript-Domänentypen. Diese HTTP-Referenz behauptet dafür kein vollständiges JSON-Schema. Die getrennte run-api.d.ts beschreibt die eingebettete TypeScript-Laufzeit und ist kein HTTP-SDK.

Dieses Profil verlangt keine Anmeldung. Profile mit users verwenden Sitzungscookies; ohne users kann ACCESS_TOKEN den bisherigen Zugang schützen.

Lesen braucht runs.read, Änderungen zusätzlich runs.write. Freie Starts benötigen runs.create, technische Ansichten runs.inspect. Die Rechte gelten auch für eingeschränkten anonymen Zugang. Anmeldefehler liefern 401, fehlende Rechte 403. Der interne Koordinator besitzt eine getrennte lokale Dienstidentität.

## Routenübersicht

| Methode | Pfad | Operation | Rechte bei Benutzeranmeldung |
| --- | --- | --- | --- |
| GET | /api/plugins/ragents.overseer/runs | listRuns | runs.read |
| POST | /api/plugins/ragents.overseer/runs | createRun | runs.read, runs.write, runs.create |
| GET | /api/plugins/ragents.overseer/runs/{run} | readRun | runs.read, runs.inspect |
| GET | /api/plugins/ragents.overseer/runs/{run}/events | readEvents | runs.read, runs.inspect |
| POST | /api/plugins/ragents.overseer/runs/{run}/messages | sendMessage | runs.read, runs.write |
| POST | /api/plugins/ragents.overseer/runs/{run}/stop | stopRun | runs.read, runs.write |
| GET | /api/plugins/ragents.overseer/catalog | readCatalog | runs.read, runs.inspect |
| GET | /api/plugins/ragents.overseer/openapi.json | readOpenApi | runs.read, runs.inspect |
| GET | /api/plugins/ragents.overseer/reference.md | readHttpReference | runs.read, runs.inspect |

## Beispiel: Runs finden und Journal lesen

In einer Shell mit Node.js und gesetzter RAGENTS_API_BASE_URL ausführen. Kennungen werden direkt aus der Antwort weiterverwendet.

```sh
node --input-type=module <<'JS'
const base = process.env.RAGENTS_API_BASE_URL;
if (!base) throw new Error("RAGENTS_API_BASE_URL fehlt");
let cookie;
if (process.env.RAGENTS_USER || process.env.RAGENTS_PASSWORD) {
  if (!process.env.RAGENTS_USER || !process.env.RAGENTS_PASSWORD) throw new Error("RAGENTS_USER und RAGENTS_PASSWORD gemeinsam setzen");
  const login = await fetch(new URL("/api/access/login", base), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: process.env.RAGENTS_USER, password: process.env.RAGENTS_PASSWORD }) });
  if (!login.ok) throw new Error("Anmeldung fehlgeschlagen");
  cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}
const request = async ({ method, path, body }) => {
  const headers = { "Content-Type": "application/json" };
  if (process.env.RAGENTS_API_TOKEN) headers.Authorization = `Bearer ${process.env.RAGENTS_API_TOKEN}`;
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(new URL(path, base), { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
};
const runs = await request({ method: "GET", path: "/api/plugins/ragents.overseer/runs" });
if (runs.length === 0) console.log("Keine Runs vorhanden");
else console.log(await request({ method: "GET", path: "/api/plugins/ragents.overseer/runs/" + encodeURIComponent(runs[0].runId) + "/events?limit=2" }));
JS
```

## Beispiel: Run erstellen, beauftragen und stoppen

Dieser Ablauf erzeugt einen neuen Run und stoppt ausschließlich diesen. Die Startannahme ist kein Nachweis eines abgeschlossenen Modellauftrags.

```sh
node --input-type=module <<'JS'
const base = process.env.RAGENTS_API_BASE_URL;
if (!base) throw new Error("RAGENTS_API_BASE_URL fehlt");
let cookie;
if (process.env.RAGENTS_USER || process.env.RAGENTS_PASSWORD) {
  if (!process.env.RAGENTS_USER || !process.env.RAGENTS_PASSWORD) throw new Error("RAGENTS_USER und RAGENTS_PASSWORD gemeinsam setzen");
  const login = await fetch(new URL("/api/access/login", base), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: process.env.RAGENTS_USER, password: process.env.RAGENTS_PASSWORD }) });
  if (!login.ok) throw new Error("Anmeldung fehlgeschlagen");
  cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}
const request = async ({ method, path, body }) => {
  const headers = { "Content-Type": "application/json" };
  if (process.env.RAGENTS_API_TOKEN) headers.Authorization = `Bearer ${process.env.RAGENTS_API_TOKEN}`;
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(new URL(path, base), { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
};
const created = await request({ method: "POST", path: "/api/plugins/ragents.overseer/runs", body: {"title":"HTTP-Beispiel","message":"Antworte kurz mit Bereit."} });
console.log(await request({ method: "POST", path: "/api/plugins/ragents.overseer/runs/" + encodeURIComponent(created.runId) + "/messages", body: {"message":"Nenne den nächsten sinnvollen Schritt."} }));
console.log(await request({ method: "POST", path: "/api/plugins/ragents.overseer/runs/" + encodeURIComponent(created.runId) + "/stop", body: {} }));
JS
```

## GET /api/plugins/ragents.overseer/runs

Vorhandene Unterhaltungen des Profils mit stabilen Referenzen auflisten; der globale Chat gehört nicht zu dieser Liste.

### Antwort 200

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "required": [
      "runId",
      "title",
      "reference",
      "updatedAt"
    ],
    "properties": {
      "runId": {
        "type": "string"
      },
      "title": {
        "type": "string"
      },
      "reference": {
        "type": "string"
      },
      "createdAt": {
        "type": "number"
      },
      "updatedAt": {
        "type": "number"
      },
      "running": {
        "type": "boolean"
      },
      "metadata": {
        "type": "object",
        "patternProperties": {
          "^.*$": {}
        }
      }
    },
    "additionalProperties": false
  }
}
```

## POST /api/plugins/ragents.overseer/runs

Einen Run mit serverseitiger ID und Titel anlegen. Genau eine Startform: message, installiertes script (Kennung oder eindeutiger Titel), oder packageDirectory (vorhandenes lokales Run-Script-Paket). input ist nur bei script/packageDirectory erlaubt. Die Antwort wartet auf Vorbereitung, Check, Test und Installation; accepted bestätigt noch kein fertiges Modellergebnis.

### JSON-Body

```json
{
  "anyOf": [
    {
      "type": "object",
      "required": [
        "title",
        "message"
      ],
      "properties": {
        "title": {
          "type": "string",
          "minLength": 1,
          "pattern": "\\S"
        },
        "options": {
          "type": "object",
          "patternProperties": {
            "^.*$": {}
          }
        },
        "message": {
          "type": "string",
          "minLength": 1,
          "pattern": "\\S"
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "title",
        "script"
      ],
      "properties": {
        "title": {
          "type": "string",
          "minLength": 1,
          "pattern": "\\S"
        },
        "options": {
          "type": "object",
          "patternProperties": {
            "^.*$": {}
          }
        },
        "script": {
          "type": "string",
          "minLength": 1,
          "pattern": "\\S"
        },
        "input": {}
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "title",
        "packageDirectory"
      ],
      "properties": {
        "title": {
          "type": "string",
          "minLength": 1,
          "pattern": "\\S"
        },
        "options": {
          "type": "object",
          "patternProperties": {
            "^.*$": {}
          }
        },
        "packageDirectory": {
          "type": "string",
          "minLength": 1,
          "description": "Absoluter Pfad eines RUN.md/setup.ts/tests.json-Pakets auf dem Server. Ein lokaler Shellclient setzt seinen tatsächlich vorhandenen Paketpfad ein; dies ist kein Upload."
        },
        "input": {}
      },
      "additionalProperties": false
    }
  ]
}
```

### Antwort 201

```json
{
  "type": "object",
  "required": [
    "runId",
    "title",
    "reference",
    "accepted"
  ],
  "properties": {
    "runId": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "reference": {
      "type": "string"
    },
    "accepted": {
      "type": "boolean",
      "const": true
    }
  },
  "additionalProperties": false
}
```

## GET /api/plugins/ragents.overseer/runs/{run}

Die aktuelle ungekürzte RunView lesen; verschachtelte Domänenwerte sind als offene JSON-Objekte dokumentiert.

### Pfadparameter

```json
{
  "type": "object",
  "required": [
    "run"
  ],
  "properties": {
    "run": {
      "type": "string",
      "minLength": 1,
      "maxLength": 512,
      "description": "Run-ID, eindeutiger Titel oder stabile Referenz wie Lauf 1; im Pfad URL-kodieren."
    }
  },
  "additionalProperties": false
}
```

### Antwort 200

```json
{
  "type": "object",
  "required": [
    "id",
    "revision",
    "title",
    "ownerId",
    "primaryActorId",
    "createdAt",
    "forkedFrom",
    "actors",
    "inputs",
    "turns",
    "subscriptions",
    "pluginStates",
    "actions",
    "artifacts"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "revision": {
      "type": "integer"
    },
    "title": {
      "type": "string"
    },
    "ownerId": {
      "type": "string"
    },
    "primaryActorId": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "createdAt": {
      "type": "string"
    },
    "forkedFrom": {
      "anyOf": [
        {
          "type": "object",
          "required": [
            "runId",
            "sequence"
          ],
          "properties": {
            "runId": {
              "type": "string"
            },
            "sequence": {
              "type": "integer"
            }
          },
          "additionalProperties": false
        },
        {
          "type": "null"
        }
      ]
    },
    "actors": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {},
        "additionalProperties": true,
        "x-typescript-type": "Actor",
        "x-source": "packages/ragents/src/domain/model.ts",
        "description": "Ungekürzter Domänenwert Actor; verschachtelte Felder sind hier bewusst ein offenes JSON-Schema."
      }
    },
    "inputs": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {},
        "additionalProperties": true,
        "x-typescript-type": "ActorInput",
        "x-source": "packages/ragents/src/domain/model.ts",
        "description": "Ungekürzter Domänenwert ActorInput; verschachtelte Felder sind hier bewusst ein offenes JSON-Schema."
      }
    },
    "turns": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {},
        "additionalProperties": true,
        "x-typescript-type": "Turn",
        "x-source": "packages/ragents/src/domain/model.ts",
        "description": "Ungekürzter Domänenwert Turn; verschachtelte Felder sind hier bewusst ein offenes JSON-Schema."
      }
    },
    "subscriptions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {},
        "additionalProperties": true,
        "x-typescript-type": "EventSubscription",
        "x-source": "packages/ragents/src/domain/model.ts",
        "description": "Ungekürzter Domänenwert EventSubscription; verschachtelte Felder sind hier bewusst ein offenes JSON-Schema."
      }
    },
    "pluginStates": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {},
        "additionalProperties": true,
        "x-typescript-type": "PluginState",
        "x-source": "packages/ragents/src/domain/model.ts",
        "description": "Ungekürzter Domänenwert PluginState; verschachtelte Felder sind hier bewusst ein offenes JSON-Schema."
      }
    },
    "actions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {},
        "additionalProperties": true,
        "x-typescript-type": "Action",
        "x-source": "packages/ragents/src/domain/model.ts",
        "description": "Ungekürzter Domänenwert Action; verschachtelte Felder sind hier bewusst ein offenes JSON-Schema."
      }
    },
    "artifacts": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {},
        "additionalProperties": true,
        "x-typescript-type": "Artifact",
        "x-source": "packages/ragents/src/domain/model.ts",
        "description": "Ungekürzter Domänenwert Artifact; verschachtelte Felder sind hier bewusst ein offenes JSON-Schema."
      }
    }
  },
  "additionalProperties": false
}
```

## GET /api/plugins/ragents.overseer/runs/{run}/events

Das vollständige Journal seitenweise in Sequenzreihenfolge lesen. Solange hasMore wahr ist, nextAfter als after der nächsten Anfrage verwenden. type filtert einen exakten Ereignistyp.

### Pfadparameter

```json
{
  "type": "object",
  "required": [
    "run"
  ],
  "properties": {
    "run": {
      "type": "string",
      "minLength": 1,
      "maxLength": 512,
      "description": "Run-ID, eindeutiger Titel oder stabile Referenz wie Lauf 1; im Pfad URL-kodieren."
    }
  },
  "additionalProperties": false
}
```

### Query

```json
{
  "type": "object",
  "properties": {
    "after": {
      "type": "integer",
      "minimum": 0,
      "default": 0
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 200,
      "default": 50
    },
    "type": {
      "anyOf": [
        {
          "type": "string",
          "const": "run.created"
        },
        {
          "type": "string",
          "const": "run.forked"
        },
        {
          "type": "string",
          "const": "run.primary-actor-selected"
        },
        {
          "type": "string",
          "const": "run.title-changed"
        },
        {
          "type": "string",
          "const": "agent.spawned"
        },
        {
          "type": "string",
          "const": "script.created"
        },
        {
          "type": "string",
          "const": "actor.input.enqueued"
        },
        {
          "type": "string",
          "const": "turn.started"
        },
        {
          "type": "string",
          "const": "turn.finished"
        },
        {
          "type": "string",
          "const": "turn.interrupted"
        },
        {
          "type": "string",
          "const": "model.output.completed"
        },
        {
          "type": "string",
          "const": "model.reasoning.completed"
        },
        {
          "type": "string",
          "const": "runtime.output.recorded"
        },
        {
          "type": "string",
          "const": "tool.call.started"
        },
        {
          "type": "string",
          "const": "tool.call.source"
        },
        {
          "type": "string",
          "const": "tool.call.completed"
        },
        {
          "type": "string",
          "const": "tool.call.failed"
        },
        {
          "type": "string",
          "const": "actor.tools.opened"
        },
        {
          "type": "string",
          "const": "actor.stopped"
        },
        {
          "type": "string",
          "const": "actor.restarted"
        },
        {
          "type": "string",
          "const": "subscription.created"
        },
        {
          "type": "string",
          "const": "subscription.removed"
        },
        {
          "type": "string",
          "const": "subscription.failed"
        },
        {
          "type": "string",
          "const": "plugin.state-replaced"
        },
        {
          "type": "string",
          "const": "plugin.state-patched"
        },
        {
          "type": "string",
          "const": "action.proposed"
        },
        {
          "type": "string",
          "const": "action.resolved"
        },
        {
          "type": "string",
          "const": "artifact.published"
        }
      ]
    }
  },
  "additionalProperties": false
}
```

### Antwort 200

```json
{
  "type": "object",
  "required": [
    "runId",
    "title",
    "reference",
    "events",
    "nextAfter",
    "hasMore"
  ],
  "properties": {
    "runId": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "reference": {
      "type": "string"
    },
    "events": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "eventId",
          "runId",
          "sequence",
          "schemaVersion",
          "occurredAt",
          "actorId",
          "commandId",
          "correlationId",
          "causationId",
          "type",
          "payload"
        ],
        "properties": {
          "eventId": {
            "type": "string"
          },
          "runId": {
            "type": "string"
          },
          "sequence": {
            "type": "integer",
            "minimum": 1
          },
          "schemaVersion": {
            "type": "number",
            "const": 3
          },
          "occurredAt": {
            "type": "string"
          },
          "actorId": {
            "type": "string"
          },
          "commandId": {
            "type": "string"
          },
          "correlationId": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "causationId": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "type": {
            "anyOf": [
              {
                "type": "string",
                "const": "run.created"
              },
              {
                "type": "string",
                "const": "run.forked"
              },
              {
                "type": "string",
                "const": "run.primary-actor-selected"
              },
              {
                "type": "string",
                "const": "run.title-changed"
              },
              {
                "type": "string",
                "const": "agent.spawned"
              },
              {
                "type": "string",
                "const": "script.created"
              },
              {
                "type": "string",
                "const": "actor.input.enqueued"
              },
              {
                "type": "string",
                "const": "turn.started"
              },
              {
                "type": "string",
                "const": "turn.finished"
              },
              {
                "type": "string",
                "const": "turn.interrupted"
              },
              {
                "type": "string",
                "const": "model.output.completed"
              },
              {
                "type": "string",
                "const": "model.reasoning.completed"
              },
              {
                "type": "string",
                "const": "runtime.output.recorded"
              },
              {
                "type": "string",
                "const": "tool.call.started"
              },
              {
                "type": "string",
                "const": "tool.call.source"
              },
              {
                "type": "string",
                "const": "tool.call.completed"
              },
              {
                "type": "string",
                "const": "tool.call.failed"
              },
              {
                "type": "string",
                "const": "actor.tools.opened"
              },
              {
                "type": "string",
                "const": "actor.stopped"
              },
              {
                "type": "string",
                "const": "actor.restarted"
              },
              {
                "type": "string",
                "const": "subscription.created"
              },
              {
                "type": "string",
                "const": "subscription.removed"
              },
              {
                "type": "string",
                "const": "subscription.failed"
              },
              {
                "type": "string",
                "const": "plugin.state-replaced"
              },
              {
                "type": "string",
                "const": "plugin.state-patched"
              },
              {
                "type": "string",
                "const": "action.proposed"
              },
              {
                "type": "string",
                "const": "action.resolved"
              },
              {
                "type": "string",
                "const": "artifact.published"
              }
            ]
          },
          "payload": {
            "type": "object",
            "properties": {},
            "additionalProperties": true,
            "x-typescript-type": "EventPayloads[EventType]",
            "x-source": "packages/ragents/src/domain/events.ts",
            "description": "Ungekürzter Domänenwert EventPayloads[EventType]; verschachtelte Felder sind hier bewusst ein offenes JSON-Schema."
          }
        },
        "additionalProperties": false
      }
    },
    "nextAfter": {
      "type": "integer",
      "minimum": 0
    },
    "hasMore": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

## POST /api/plugins/ragents.overseer/runs/{run}/messages

Eine Chatnachricht an den primären LLM-Actor einreihen; TypeScript als Primary wird mit actor-chat-unsupported abgewiesen. Die Antwort bestätigt nur das Einreihen, weder Verarbeitung noch Abschluss. Ein laufender Turn wird dadurch nicht ersetzt.

### Pfadparameter

```json
{
  "type": "object",
  "required": [
    "run"
  ],
  "properties": {
    "run": {
      "type": "string",
      "minLength": 1,
      "maxLength": 512,
      "description": "Run-ID, eindeutiger Titel oder stabile Referenz wie Lauf 1; im Pfad URL-kodieren."
    }
  },
  "additionalProperties": false
}
```

### JSON-Body

```json
{
  "type": "object",
  "required": [
    "message"
  ],
  "properties": {
    "message": {
      "type": "string",
      "minLength": 1,
      "pattern": "\\S"
    }
  },
  "additionalProperties": false
}
```

### Antwort 202

```json
{
  "type": "object",
  "required": [
    "runId",
    "title",
    "reference",
    "accepted"
  ],
  "properties": {
    "runId": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "reference": {
      "type": "string"
    },
    "accepted": {
      "type": "boolean",
      "const": true
    }
  },
  "additionalProperties": false
}
```

## POST /api/plugins/ragents.overseer/runs/{run}/stop

Den Run über seine normale Stoppgrenze stoppen und die Bereinigung abwarten; die Unterhaltung bleibt erhalten.

### Pfadparameter

```json
{
  "type": "object",
  "required": [
    "run"
  ],
  "properties": {
    "run": {
      "type": "string",
      "minLength": 1,
      "maxLength": 512,
      "description": "Run-ID, eindeutiger Titel oder stabile Referenz wie Lauf 1; im Pfad URL-kodieren."
    }
  },
  "additionalProperties": false
}
```

### JSON-Body

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### Antwort 200

```json
{
  "type": "object",
  "required": [
    "runId",
    "title",
    "reference",
    "stopped"
  ],
  "properties": {
    "runId": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "reference": {
      "type": "string"
    },
    "stopped": {
      "type": "boolean",
      "const": true
    }
  },
  "additionalProperties": false
}
```

## GET /api/plugins/ragents.overseer/catalog

Installierte Start-Einstiege und Startoptionen mit Eingabeschemata, Standardwerten und Wählbarkeit lesen. POST /runs startet Nachrichten, installierte Scripts oder lokale Pakete via packageDirectory. Skills liefern bearbeitbare Aufträge für message; dabei den Skillnamen als Arbeitsanleitung nennen.

### Antwort 200

```json
{
  "type": "object",
  "required": [
    "entries",
    "options"
  ],
  "properties": {
    "entries": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "title",
          "description",
          "action"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "title": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "action": {
            "anyOf": [
              {
                "type": "string",
                "const": "skill"
              },
              {
                "type": "string",
                "const": "script"
              }
            ]
          }
        },
        "additionalProperties": true,
        "x-typescript-type": "PublicStartEntry"
      }
    },
    "options": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "schema",
          "value",
          "selectable",
          "presentation"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "schema": {
            "type": "object",
            "patternProperties": {
              "^.*$": {}
            }
          },
          "value": {},
          "selectable": {
            "type": "boolean"
          },
          "presentation": {}
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

## GET /api/plugins/ragents.overseer/openapi.json

OpenAPI 3.1 direkt aus den ausführbaren Routenverträgen lesen.

### Antwort 200

```json
{
  "type": "object",
  "patternProperties": {
    "^.*$": {}
  }
}
```

## GET /api/plugins/ragents.overseer/reference.md

Lesbare HTTP-Referenz direkt aus denselben Routenverträgen lesen.

### Antwort 200

```json
{
  "type": "string"
}
```
