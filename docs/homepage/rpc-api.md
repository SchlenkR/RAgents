# RAgents JSON-RPC-API

Diese Referenz entsteht aus den registrierten Verträgen. Interne und externe Clients verwenden dieselben Methoden.

Die API ist JSON-RPC 2.0. Eine Anfrage ist ein Objekt mit jsonrpc, id, method und params; params ist immer das Eingabeobjekt der Methode. Die Antwort enthält result oder error; error.data nennt code und status des Fehlers.

Transporte:

- HTTP: `POST /rpc` mit genau einer Nachricht je Anfrage. `GET /rpc/stream` liefert als Server-Sent-Events die Benachrichtigungen und Anfragen des Servers; das erste Ereignis `hello` nennt die Verbindungskennung, die weitere Anfragen im Header `x-ragents-connection` mitsenden.
- stdio: der Server startet mit `--stdio` und tauscht eine JSON-Nachricht je Zeile über stdin und stdout aus.

Feste Methoden der Nachrichtenschicht: rpc.subscribe, rpc.unsubscribe, rpc.event, rpc.cancel und rpc.progress. Ein Abonnement nennt channel und params und erhält eine Abonnementkennung; jede Nachricht des Kanals kommt als rpc.event.

Dieses Profil verlangt keine Anmeldung. Profile mit users verwenden Sitzungscookies; ohne users kann ACCESS_TOKEN den bisherigen Zugang schützen.

Die Shellvariable RAGENTS_API_BASE_URL enthält die Serveradresse. Falls RAGENTS_API_TOKEN gesetzt ist, bei Anfragen den Header Authorization: Bearer <Token> senden. Der Token gehört nicht in Ausgaben oder Dokumente.

```sh
curl -s "$RAGENTS_API_BASE_URL/rpc" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"ragents.overseer.listRuns","params":{}}'
```

Kennungen aus Ergebnissen werden programmgesteuert weiterverwendet, nicht abgeschrieben.

## Methodenübersicht

| Methode | Eigentümer | Rechte |
| --- | --- | --- |
| ragents.actor-programs.action | ragents.actor-programs | runs.read, runs.write |
| ragents.actor-programs.apps | ragents.actor-programs | runs.read |
| ragents.actor-programs.function | ragents.actor-programs | runs.read, runs.write, runs.inspect |
| ragents.actor-programs.function-invocation | ragents.actor-programs | runs.read, runs.inspect |
| ragents.actor-programs.invocation | ragents.actor-programs | runs.read |
| ragents.actor-programs.source | ragents.actor-programs | runs.read, runs.inspect |
| ragents.ask.answer | ragents.ask | runs.read, runs.write |
| ragents.chat.actorHistory | host | keine festen Rechte |
| ragents.chat.capabilities | host | keine festen Rechte |
| ragents.chat.send | host | keine festen Rechte |
| ragents.chat.sendToActor | host | keine festen Rechte |
| ragents.chat.start | host | keine festen Rechte |
| ragents.chat.stop | host | keine festen Rechte |
| ragents.documents.files | ragents.documents | runs.read |
| ragents.external.set | host | settings.write |
| ragents.lsp-fsharp.snapshot | ragents.lsp-fsharp | runs.read, ragents.lsp-fsharp.read |
| ragents.lsp-roslyn.snapshot | ragents.lsp-roslyn | runs.read, ragents.lsp-roslyn.read |
| ragents.lsp-typescript.snapshot | ragents.lsp-typescript | runs.read, ragents.lsp-typescript.read |
| ragents.overseer.createRun | ragents.overseer | runs.read, runs.write, runs.create |
| ragents.overseer.listRuns | ragents.overseer | runs.read |
| ragents.overseer.readCatalog | ragents.overseer | runs.read, runs.inspect |
| ragents.overseer.readEvents | ragents.overseer | runs.read, runs.inspect |
| ragents.overseer.readOpenRpc | ragents.overseer | runs.read, runs.inspect |
| ragents.overseer.readReference | ragents.overseer | runs.read, runs.inspect |
| ragents.overseer.readRun | ragents.overseer | runs.read, runs.inspect |
| ragents.overseer.reset | ragents.overseer | ragents.overseer.read, ragents.overseer.write |
| ragents.overseer.sendMessage | ragents.overseer | runs.read, runs.write |
| ragents.overseer.settings.read | ragents.overseer | ragents.overseer.read |
| ragents.overseer.settings.save | ragents.overseer | ragents.overseer.read, ragents.overseer.write, settings.write |
| ragents.overseer.stopRun | ragents.overseer | runs.read, runs.write |
| ragents.plugins.bootstrap | host | keine festen Rechte |
| ragents.processes.snapshot | ragents.processes | runs.read, ragents.processes.read |
| ragents.processes.stop | ragents.processes | runs.read, runs.write, runs.inspect |
| ragents.product.modelSettings.read | ragents.product | settings.read |
| ragents.product.modelSettings.save | ragents.product | settings.read, settings.write |
| ragents.runs.enqueueInput | host | keine festen Rechte |
| ragents.runs.events | host | keine festen Rechte |
| ragents.runs.prepare | host | runs.read, runs.write, runs.create |
| ragents.runs.resolveAction | host | keine festen Rechte |
| ragents.runs.restartActor | host | keine festen Rechte |
| ragents.runs.stopActor | host | keine festen Rechte |
| ragents.runs.stopAll | host | keine festen Rechte |
| ragents.runs.view | host | keine festen Rechte |
| ragents.sessions.delete | host | runs.read, runs.delete |
| ragents.sessions.list | host | runs.read |
| ragents.settings.read | host | settings.read |
| ragents.settings.skill | host | settings.read |
| ragents.settings.titles.read | host | settings.read |
| ragents.settings.titles.save | host | settings.write |
| ragents.startOptions.list | host | runs.read, runs.create, runs.inspect |
| ragents.startOptions.select | host | runs.read, runs.write, runs.create, runs.inspect |
| ragents.workspace.browse.list | ragents.workspace | runs.read, runs.inspect |
| ragents.workspace.browse.preview | ragents.workspace | runs.read, runs.inspect |
| ragents.workspace.clients.list | ragents.workspace | runs.read |
| ragents.workspace.clients.register | ragents.workspace | runs.write |
| ragents.workspace.clients.unregister | ragents.workspace | runs.write |

## Kanalübersicht

| Kanal | Eigentümer | Rechte |
| --- | --- | --- |
| ragents.chat | host | keine festen Rechte |
| ragents.processes | ragents.processes | runs.read, ragents.processes.read |
| ragents.run | host | keine festen Rechte |
| ragents.sessions | host | runs.read |
| ragents.workspace.browse | ragents.workspace | runs.read, runs.inspect |

## ragents.actor-programs.action

Eine Funktion einer Actor-Ansicht starten; die Antwort ist der eingereihte Aufruf.

Eigentümer: ragents.actor-programs. Rechte: runs.read, runs.write. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId",
    "appId",
    "revision",
    "actionId",
    "requestId",
    "input"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,64}$",
      "description": "Kennung des Runs"
    },
    "appId": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9_-]{0,129}$",
      "description": "Kennung der Actor-Ansicht oder des Programms"
    },
    "revision": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$",
      "description": "Revision des aktiven Actor-Pakets"
    },
    "actionId": {
      "type": "string",
      "pattern": "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$",
      "description": "Kennung der Funktion"
    },
    "requestId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200,
      "description": "Eigene Kennung des Aufrufers; wiederholte Aufrufe liefern denselben Aufruf"
    },
    "input": {
      "description": "Eingabe der Funktion nach ihrem eigenen Schema"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "ActorFunctionInvocation"
}
```

## ragents.actor-programs.apps

Die Actor-Ansichten eines Runs mit Zustand und Aufrufen; die Werkzeugliste bleibt ohne runs.inspect leer.

Eigentümer: ragents.actor-programs. Rechte: runs.read. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,64}$",
      "description": "Kennung des Runs"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "required": [
    "apps",
    "tools"
  ],
  "properties": {
    "apps": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true,
        "x-typescript-type": "ActorViewListing"
      }
    },
    "tools": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true,
        "x-typescript-type": "ActorLocalTool"
      }
    }
  },
  "additionalProperties": false
}
```

## ragents.actor-programs.function

Eine Funktion eines Actors unabhängig von seinen Ansichten starten.

Eigentümer: ragents.actor-programs. Rechte: runs.read, runs.write, runs.inspect. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId",
    "actorHandle",
    "revision",
    "functionId",
    "requestId",
    "input"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,64}$",
      "description": "Kennung des Runs"
    },
    "actorHandle": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9-]{0,63}$",
      "description": "Handle des Actors ohne @"
    },
    "revision": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$",
      "description": "Revision des aktiven Actor-Pakets"
    },
    "functionId": {
      "type": "string",
      "pattern": "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$",
      "description": "Kennung der Funktion"
    },
    "requestId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200,
      "description": "Eigene Kennung des Aufrufers; wiederholte Aufrufe liefern denselben Aufruf"
    },
    "input": {
      "description": "Eingabe der Funktion nach ihrem eigenen Schema"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "ActorFunctionInvocation"
}
```

## ragents.actor-programs.function-invocation

Den Stand eines Aufrufs einer Actor-Funktion lesen.

Eigentümer: ragents.actor-programs. Rechte: runs.read, runs.inspect. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId",
    "actorHandle",
    "invocationId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,64}$",
      "description": "Kennung des Runs"
    },
    "actorHandle": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9-]{0,63}$",
      "description": "Handle des Actors ohne @"
    },
    "invocationId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,100}$",
      "description": "Kennung des Funktionsaufrufs"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "ActorFunctionInvocation"
}
```

## ragents.actor-programs.invocation

Den Stand eines Aufrufs einer Actor-Ansicht lesen.

Eigentümer: ragents.actor-programs. Rechte: runs.read. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId",
    "appId",
    "invocationId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,64}$",
      "description": "Kennung des Runs"
    },
    "appId": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9_-]{0,129}$",
      "description": "Kennung der Actor-Ansicht oder des Programms"
    },
    "invocationId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,100}$",
      "description": "Kennung des Funktionsaufrufs"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "ActorFunctionInvocation"
}
```

## ragents.actor-programs.source

Den Quellcode eines Actor-Programms lesen.

Eigentümer: ragents.actor-programs. Rechte: runs.read, runs.inspect. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId",
    "moduleId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,64}$",
      "description": "Kennung des Runs"
    },
    "moduleId": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9_-]{0,129}$",
      "description": "Kennung der Actor-Ansicht oder des Programms"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "required": [
    "files"
  ],
  "properties": {
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "path",
          "content"
        ],
        "properties": {
          "path": {
            "type": "string",
            "minLength": 1
          },
          "content": {
            "type": "string"
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

## ragents.ask.answer

Eine Rückfrage des Laufs beantworten oder verwerfen. Rechte: runs.read und runs.write.

Eigentümer: ragents.ask. Rechte: runs.read, runs.write. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId",
    "actionId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    },
    "actionId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 80,
      "description": "Kennung der Frage"
    },
    "answer": {
      "type": "string",
      "description": "Die Antwort des Benutzers"
    },
    "dismiss": {
      "type": "boolean",
      "description": "true verwirft die Frage ohne Antwort"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "null"
}
```

## ragents.chat.actorHistory

Die Gesprächsverläufe aller Actors des Runs, ohne runs.inspect ohne Werkzeugdetails. Recht: runs.read.

Eigentümer: host. Rechte: keine festen Rechte. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "ActorConversations"
}
```

## ragents.chat.capabilities

Welche Anhänge das Modell eines Actors annimmt; der Modellname erscheint nur mit runs.inspect. Recht: runs.read.

Eigentümer: host. Rechte: keine festen Rechte. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    },
    "actor": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "ChatAttachmentCapabilities"
}
```

## ragents.chat.send

Eine Nachricht an den Koordinator des Runs; startet einen neuen Run oder funkt in einen laufenden. Rechte: runs.read und runs.write, für einen neuen Run runs.create; beim globalen Chat dessen Rechte.

Eigentümer: host. Rechte: keine festen Rechte. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    },
    "text": {
      "type": "string"
    },
    "attachments": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "name",
          "mediaType",
          "data"
        ],
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1
          },
          "mediaType": {
            "type": "string",
            "minLength": 1
          },
          "data": {
            "type": "string",
            "description": "Inhalt als Base64"
          }
        },
        "additionalProperties": false
      }
    },
    "userLocation": {
      "type": "object",
      "additionalProperties": true,
      "x-typescript-type": "ChatUserLocation"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "null"
}
```

## ragents.chat.sendToActor

Eine Nachricht an einen bestimmten LLM-Actor des Runs. Rechte wie ragents.chat.send.

Eigentümer: host. Rechte: keine festen Rechte. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId",
    "actorId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    },
    "actorId": {
      "type": "string",
      "minLength": 1
    },
    "text": {
      "type": "string"
    },
    "attachments": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "name",
          "mediaType",
          "data"
        ],
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1
          },
          "mediaType": {
            "type": "string",
            "minLength": 1
          },
          "data": {
            "type": "string",
            "description": "Inhalt als Base64"
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "null"
}
```

## ragents.chat.start

Einen Run über einen Skill- oder Run-Script-Einstieg starten, ohne Nachricht. Rechte: runs.read, runs.write und die Freigabe des Einstiegs.

Eigentümer: host. Rechte: keine festen Rechte. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId",
    "entry"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    },
    "entry": {
      "type": "string",
      "minLength": 1
    },
    "input": {}
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "null"
}
```

## ragents.chat.stop

Den laufenden Turn des Koordinators abbrechen. Rechte: runs.read und runs.write.

Eigentümer: host. Rechte: keine festen Rechte. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "null"
}
```

## ragents.documents.files

Die Dateiablage eines Laufs als Gruppen und lose Dateien. Recht: runs.read.

Eigentümer: ragents.documents. Rechte: runs.read. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "required": [
    "groups",
    "loose",
    "truncated"
  ],
  "properties": {
    "groups": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "directory",
          "files"
        ],
        "properties": {
          "directory": {
            "type": "string",
            "minLength": 1
          },
          "files": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "path",
                "size",
                "modifiedAt"
              ],
              "properties": {
                "path": {
                  "type": "string",
                  "minLength": 1
                },
                "size": {
                  "type": "integer",
                  "minimum": 0
                },
                "modifiedAt": {
                  "type": "string",
                  "minLength": 1
                }
              },
              "additionalProperties": false
            }
          }
        },
        "additionalProperties": false
      }
    },
    "loose": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "path",
          "size",
          "modifiedAt"
        ],
        "properties": {
          "path": {
            "type": "string",
            "minLength": 1
          },
          "size": {
            "type": "integer",
            "minimum": 0
          },
          "modifiedAt": {
            "type": "string",
            "minLength": 1
          }
        },
        "additionalProperties": false
      }
    },
    "truncated": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

## ragents.external.set

Den Zugang von außen ein- oder ausschalten; nur vom eigenen Rechner. Recht: settings.write.

Eigentümer: host. Rechte: settings.write. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "state"
  ],
  "properties": {
    "state": {
      "anyOf": [
        {
          "type": "string",
          "const": "on"
        },
        {
          "type": "string",
          "const": "off"
        }
      ]
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "required": [
    "external"
  ],
  "properties": {
    "external": {
      "type": "boolean"
    }
  }
}
```

## ragents.lsp-fsharp.snapshot

Zustand und Diagnosen des Sprachservers ragents.lsp-fsharp in einem Lauf. Rechte: runs.read und ragents.lsp-fsharp.read.

Eigentümer: ragents.lsp-fsharp. Rechte: runs.read, ragents.lsp-fsharp.read. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "LanguageServerSnapshot"
}
```

## ragents.lsp-roslyn.snapshot

Zustand und Diagnosen des Sprachservers ragents.lsp-roslyn in einem Lauf. Rechte: runs.read und ragents.lsp-roslyn.read.

Eigentümer: ragents.lsp-roslyn. Rechte: runs.read, ragents.lsp-roslyn.read. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "LanguageServerSnapshot"
}
```

## ragents.lsp-typescript.snapshot

Zustand und Diagnosen des Sprachservers ragents.lsp-typescript in einem Lauf. Rechte: runs.read und ragents.lsp-typescript.read.

Eigentümer: ragents.lsp-typescript. Rechte: runs.read, ragents.lsp-typescript.read. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "LanguageServerSnapshot"
}
```

## ragents.overseer.createRun

Einen Run mit serverseitiger ID und Titel anlegen. Genau eine Startform: message, installiertes script (Kennung oder eindeutiger Titel), oder packageDirectory (vorhandenes lokales Run-Script-Paket). input ist nur bei script/packageDirectory erlaubt. Das Ergebnis wartet auf Vorbereitung, Check, Test und Installation; accepted bestätigt noch kein fertiges Modellergebnis.

Eigentümer: ragents.overseer. Rechte: runs.read, runs.write, runs.create. Ausführung: der Server.

### Eingabe

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

### Ergebnis

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

## ragents.overseer.listRuns

Vorhandene Unterhaltungen des Profils mit stabilen Referenzen auflisten; der globale Chat gehört nicht zu dieser Liste.

Eigentümer: ragents.overseer. Rechte: runs.read. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### Ergebnis

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

## ragents.overseer.readCatalog

Installierte Start-Einstiege und Startoptionen mit Eingabeschemata, Standardwerten und Wählbarkeit lesen. createRun startet Nachrichten, installierte Scripts oder lokale Pakete via packageDirectory. Skills liefern bearbeitbare Aufträge für message; dabei den Skillnamen als Arbeitsanleitung nennen.

Eigentümer: ragents.overseer. Rechte: runs.read, runs.inspect. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### Ergebnis

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

## ragents.overseer.readEvents

Das vollständige Journal seitenweise in Sequenzreihenfolge lesen. Solange hasMore wahr ist, nextAfter als after der nächsten Anfrage verwenden. type filtert einen exakten Ereignistyp.

Eigentümer: ragents.overseer. Rechte: runs.read, runs.inspect. Ausführung: der Server.

### Eingabe

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
      "description": "Run-ID, eindeutiger Titel oder stabile Referenz wie Lauf 1."
    },
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

### Ergebnis

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

## ragents.overseer.readOpenRpc

OpenRPC 1.3 direkt aus denselben Verträgen lesen.

Eigentümer: ragents.overseer. Rechte: runs.read, runs.inspect. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "patternProperties": {
    "^.*$": {}
  }
}
```

## ragents.overseer.readReference

Lesbare Referenz aller registrierten Methoden und Kanäle direkt aus ihren Verträgen lesen.

Eigentümer: ragents.overseer. Rechte: runs.read, runs.inspect. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "string"
}
```

## ragents.overseer.readRun

Die aktuelle ungekürzte RunView lesen; verschachtelte Domänenwerte sind als offene JSON-Objekte dokumentiert.

Eigentümer: ragents.overseer. Rechte: runs.read, runs.inspect. Ausführung: der Server.

### Eingabe

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
      "description": "Run-ID, eindeutiger Titel oder stabile Referenz wie Lauf 1."
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

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

## ragents.overseer.reset

Das Gespräch des übergeordneten Koordinators samt Modellkontext zurücksetzen; die Modellauswahl und alle Runs bleiben erhalten.

Eigentümer: ragents.overseer. Rechte: ragents.overseer.read, ragents.overseer.write. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "confirm"
  ],
  "properties": {
    "confirm": {
      "type": "boolean",
      "const": true,
      "description": "Der Gesprächsreset muss ausdrücklich bestätigt werden."
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "null"
}
```

## ragents.overseer.sendMessage

Eine Chatnachricht an den primären LLM-Actor einreihen; TypeScript als Primary wird mit actor-chat-unsupported abgewiesen. Das Ergebnis bestätigt nur das Einreihen, weder Verarbeitung noch Abschluss. Ein laufender Turn wird dadurch nicht ersetzt.

Eigentümer: ragents.overseer. Rechte: runs.read, runs.write. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "run",
    "message"
  ],
  "properties": {
    "run": {
      "type": "string",
      "minLength": 1,
      "maxLength": 512,
      "description": "Run-ID, eindeutiger Titel oder stabile Referenz wie Lauf 1."
    },
    "message": {
      "type": "string",
      "minLength": 1,
      "pattern": "\\S"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

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

## ragents.overseer.settings.read

Die Modellauswahl des übergeordneten Koordinators mit dem verfügbaren Modellkatalog lesen.

Eigentümer: ragents.overseer. Rechte: ragents.overseer.read. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "required": [
    "provider",
    "model",
    "thinking",
    "models"
  ],
  "properties": {
    "provider": {
      "type": "string"
    },
    "model": {
      "type": "string"
    },
    "thinking": {
      "type": "string"
    },
    "models": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "provider",
          "label",
          "thinking"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "provider": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "thinking": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

## ragents.overseer.settings.save

Die Modellauswahl des übergeordneten Koordinators setzen; sie gilt ab der nächsten Antwort.

Eigentümer: ragents.overseer. Rechte: ragents.overseer.read, ragents.overseer.write, settings.write. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "provider",
    "model",
    "thinking"
  ],
  "properties": {
    "provider": {
      "type": "string",
      "minLength": 1,
      "pattern": "\\S"
    },
    "model": {
      "type": "string",
      "minLength": 1,
      "pattern": "\\S"
    },
    "thinking": {
      "type": "string",
      "minLength": 1,
      "pattern": "\\S"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "required": [
    "provider",
    "model",
    "thinking",
    "models"
  ],
  "properties": {
    "provider": {
      "type": "string"
    },
    "model": {
      "type": "string"
    },
    "thinking": {
      "type": "string"
    },
    "models": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "provider",
          "label",
          "thinking"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "provider": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "thinking": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

## ragents.overseer.stopRun

Den Run über seine normale Stoppgrenze stoppen und die Bereinigung abwarten; die Unterhaltung bleibt erhalten.

Eigentümer: ragents.overseer. Rechte: runs.read, runs.write. Ausführung: der Server.

### Eingabe

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
      "description": "Run-ID, eindeutiger Titel oder stabile Referenz wie Lauf 1."
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

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

## ragents.plugins.bootstrap

Produkt, aktive Plugins mit Web-Konfiguration und freigegebene Einstiege für die Oberfläche.

Eigentümer: host. Rechte: keine festen Rechte. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "PublicPluginProfile"
}
```

## ragents.processes.snapshot

Die beobachteten Prozesse eines Laufs mit ihren offenen Ports. Rechte: runs.read und ragents.processes.read.

Eigentümer: ragents.processes. Rechte: runs.read, ragents.processes.read. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "RunProcessSnapshot"
}
```

## ragents.processes.stop

Einen Prozess des Laufs beenden. Rechte: runs.read, runs.write und runs.inspect.

Eigentümer: ragents.processes. Rechte: runs.read, runs.write, runs.inspect. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId",
    "processId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    },
    "processId": {
      "type": "string",
      "pattern": "^[1-9][0-9]*-[a-f0-9]{64}$",
      "description": "Kennung des Prozesses aus dem Stand"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "null"
}
```

## ragents.product.modelSettings.read

Die Modellvorgaben der Agentprofile mit dem verfügbaren Modellkatalog. Recht: settings.read.

Eigentümer: ragents.product. Rechte: settings.read. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "ProductModelSettings"
}
```

## ragents.product.modelSettings.save

Die Modellvorgaben der Agentprofile speichern. Rechte: settings.read und settings.write.

Eigentümer: ragents.product. Rechte: settings.read, settings.write. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "value"
  ],
  "properties": {
    "value": {
      "type": "object",
      "additionalProperties": true,
      "x-typescript-type": "ProductModelDraft"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "ProductModelSettings"
}
```

## ragents.runs.enqueueInput

Eine Nachricht in die Warteschlange eines Actors legen.

Eigentümer: host. Rechte: keine festen Rechte. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId",
    "commandId",
    "actorId",
    "content"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    },
    "commandId": {
      "type": "string",
      "minLength": 1
    },
    "correlationId": {
      "type": "string",
      "minLength": 1
    },
    "causationId": {
      "type": "string",
      "minLength": 1
    },
    "actorId": {
      "type": "string",
      "minLength": 1
    },
    "content": {
      "type": "string",
      "minLength": 1
    },
    "artifactIds": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      }
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "RunView"
}
```

## ragents.runs.events

Alle Journalereignisse eines Runs in Sequenzreihenfolge lesen.

Eigentümer: host. Rechte: keine festen Rechte. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "additionalProperties": true,
    "x-typescript-type": "JournalEvent"
  }
}
```

## ragents.runs.prepare

Den Auftrag eines neuen Runs im Gespräch mit einer eigenen Koordinator-Instanz ausarbeiten. Rechte: runs.read, runs.write, runs.create.

Eigentümer: host. Rechte: runs.read, runs.write, runs.create. Ausführung: der Server.

### Eingabe

```json
{
  "allOf": [
    {
      "type": "object",
      "required": [
        "runId"
      ],
      "properties": {
        "runId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "description": "Kennung des Runs"
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": true,
      "x-typescript-type": "RunPreparationRequest"
    }
  ]
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "RunPreparationResponse"
}
```

## ragents.runs.resolveAction

Eine offene Rückfrage oder Aktion beantworten.

Eigentümer: host. Rechte: keine festen Rechte. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId",
    "commandId",
    "actionId",
    "decision"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    },
    "commandId": {
      "type": "string",
      "minLength": 1
    },
    "correlationId": {
      "type": "string",
      "minLength": 1
    },
    "causationId": {
      "type": "string",
      "minLength": 1
    },
    "actionId": {
      "type": "string",
      "minLength": 1
    },
    "decision": {
      "anyOf": [
        {
          "type": "string",
          "const": "approved"
        },
        {
          "type": "string",
          "const": "dismissed"
        }
      ]
    },
    "response": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "RunView"
}
```

## ragents.runs.restartActor

Einen gestoppten Actor neu starten.

Eigentümer: host. Rechte: keine festen Rechte. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId",
    "commandId",
    "actorId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    },
    "commandId": {
      "type": "string",
      "minLength": 1
    },
    "correlationId": {
      "type": "string",
      "minLength": 1
    },
    "causationId": {
      "type": "string",
      "minLength": 1
    },
    "actorId": {
      "type": "string",
      "minLength": 1
    },
    "reason": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "RunView"
}
```

## ragents.runs.stopActor

Einen Actor samt seinen beauftragten Kindern stoppen.

Eigentümer: host. Rechte: keine festen Rechte. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId",
    "commandId",
    "actorId",
    "reason"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    },
    "commandId": {
      "type": "string",
      "minLength": 1
    },
    "correlationId": {
      "type": "string",
      "minLength": 1
    },
    "causationId": {
      "type": "string",
      "minLength": 1
    },
    "actorId": {
      "type": "string",
      "minLength": 1
    },
    "reason": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "RunView"
}
```

## ragents.runs.stopAll

Den ganzen Run mit allen Agenten und Abläufen stoppen.

Eigentümer: host. Rechte: keine festen Rechte. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId",
    "commandId",
    "reason"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    },
    "commandId": {
      "type": "string",
      "minLength": 1
    },
    "correlationId": {
      "type": "string",
      "minLength": 1
    },
    "causationId": {
      "type": "string",
      "minLength": 1
    },
    "reason": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "RunView"
}
```

## ragents.runs.view

Die Laufansicht eines Runs lesen, optional den Stand nach einer Journalsequenz; null für einen noch nicht gestarteten Run.

Eigentümer: host. Rechte: keine festen Rechte. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    },
    "at": {
      "type": "integer",
      "minimum": 0
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "anyOf": [
    {
      "type": "object",
      "additionalProperties": true,
      "x-typescript-type": "RunView"
    },
    {
      "type": "null"
    }
  ]
}
```

## ragents.sessions.delete

Einen Run mit seinen Daten löschen. Rechte: runs.read und runs.delete.

Eigentümer: host. Rechte: runs.read, runs.delete. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "null"
}
```

## ragents.sessions.list

Alle Runs des Profils mit Titel, Zeiten und Metadaten. Recht: runs.read.

Eigentümer: host. Rechte: runs.read. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "additionalProperties": true,
    "x-typescript-type": "SessionInfo"
  }
}
```

## ragents.settings.read

Modelle, Plugins, Werkzeuge, Skills und Laufzeitinformationen des Profils. Recht: settings.read; nur lokal oder mit Zugang.

Eigentümer: host. Rechte: settings.read. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "SettingsResponse"
}
```

## ragents.settings.skill

Die Dateien eines registrierten Skills lesen; null, wenn er nicht registriert ist. Recht: settings.read.

Eigentümer: host. Rechte: settings.read. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "anyOf": [
    {
      "type": "object",
      "additionalProperties": true,
      "x-typescript-type": "SettingsSkillDetail"
    },
    {
      "type": "null"
    }
  ]
}
```

## ragents.settings.titles.read

Das Modell für automatische Überschriften und die Auswahl lesen. Recht: settings.read.

Eigentümer: host. Rechte: settings.read. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "TitleModelSettings"
}
```

## ragents.settings.titles.save

Das Modell für automatische Überschriften setzen oder die Erzeugung ausschalten. Recht: settings.write.

Eigentümer: host. Rechte: settings.write. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "value"
  ],
  "properties": {
    "value": {}
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "TitleModelSettings"
}
```

## ragents.startOptions.list

Die Startoptionen eines noch nicht gestarteten Runs mit Wert und Darstellung. Rechte: runs.read, runs.create, runs.inspect.

Eigentümer: host. Rechte: runs.read, runs.create, runs.inspect. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "additionalProperties": true,
    "x-typescript-type": "StartOptionState"
  }
}
```

## ragents.startOptions.select

Eine Startoption vor dem Start wählen. Rechte: runs.read, runs.write, runs.create, runs.inspect.

Eigentümer: host. Rechte: runs.read, runs.write, runs.create, runs.inspect. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId",
    "optionId",
    "value"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    },
    "optionId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "value": {}
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "StartOptionState"
}
```

## ragents.workspace.browse.list

Ein Verzeichnis im Arbeitsverzeichnis oder in der Dateiablage eines Runs auflisten.

Eigentümer: ragents.workspace. Rechte: runs.read, runs.inspect. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId",
    "root",
    "path"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    },
    "root": {
      "anyOf": [
        {
          "type": "string",
          "const": "workspace"
        },
        {
          "type": "string",
          "const": "files"
        }
      ]
    },
    "path": {
      "type": "string",
      "description": "Pfad unterhalb der Wurzel; leer ist die Wurzel selbst"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "BrowseListing"
}
```

## ragents.workspace.browse.preview

Eine Datei als Text vorschauen; zu große und binäre Dateien nennen stattdessen den Grund.

Eigentümer: ragents.workspace. Rechte: runs.read, runs.inspect. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "runId",
    "root",
    "path"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    },
    "root": {
      "anyOf": [
        {
          "type": "string",
          "const": "workspace"
        },
        {
          "type": "string",
          "const": "files"
        }
      ]
    },
    "path": {
      "type": "string",
      "description": "Pfad unterhalb der Wurzel; leer ist die Wurzel selbst"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "BrowsePreview"
}
```

## ragents.workspace.clients.list

Angemeldete Arbeitsplätze mit Verbindungsstand.

Eigentümer: ragents.workspace. Rechte: runs.read. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "required": [
      "id",
      "label",
      "hostname",
      "platform",
      "folders",
      "connected",
      "sameMachine"
    ],
    "properties": {
      "id": {
        "type": "string"
      },
      "label": {
        "type": "string",
        "minLength": 1,
        "maxLength": 120
      },
      "hostname": {
        "type": "string",
        "minLength": 1
      },
      "platform": {
        "type": "string",
        "minLength": 1
      },
      "folders": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        },
        "maxItems": 32
      },
      "connected": {
        "type": "boolean"
      },
      "sameMachine": {
        "type": "boolean"
      }
    },
    "additionalProperties": false
  }
}
```

## ragents.workspace.clients.register

Einen Arbeitsplatz anmelden oder seine Ordner erneuern; die Verbindung dieser Anfrage wird sein Rückweg und braucht einen Ereignisstrom.

Eigentümer: ragents.workspace. Rechte: runs.write. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "id",
    "label",
    "hostname",
    "platform",
    "folders"
  ],
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{8,64}$",
      "description": "Stabile Kennung des Arbeitsplatzes"
    },
    "label": {
      "type": "string",
      "minLength": 1,
      "maxLength": 120
    },
    "hostname": {
      "type": "string",
      "minLength": 1
    },
    "platform": {
      "type": "string",
      "minLength": 1
    },
    "folders": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "maxItems": 32
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "object",
  "required": [
    "id",
    "label",
    "hostname",
    "platform",
    "folders",
    "connected",
    "sameMachine"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "label": {
      "type": "string",
      "minLength": 1,
      "maxLength": 120
    },
    "hostname": {
      "type": "string",
      "minLength": 1
    },
    "platform": {
      "type": "string",
      "minLength": 1
    },
    "folders": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "maxItems": 32
    },
    "connected": {
      "type": "boolean"
    },
    "sameMachine": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

## ragents.workspace.clients.unregister

Einen Arbeitsplatz abmelden; offene Aufträge scheitern.

Eigentümer: ragents.workspace. Rechte: runs.write. Ausführung: der Server.

### Eingabe

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{8,64}$",
      "description": "Stabile Kennung des Arbeitsplatzes"
    }
  },
  "additionalProperties": false
}
```

### Ergebnis

```json
{
  "type": "null"
}
```

## Kanal ragents.chat

Der Chatverlauf des Koordinators: erst der gespeicherte Verlauf, dann live. Rechte wie das Lesen des Runs.

Eigentümer: host. Rechte: keine festen Rechte.

### Parameter

```json
{
  "type": "object",
  "required": [
    "runId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    }
  },
  "additionalProperties": false
}
```

### Nachricht

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "ChatEvent"
}
```

## Kanal ragents.processes

Der laufende Stand der Prozessüberwachung eines Laufs. Rechte: runs.read und ragents.processes.read.

Eigentümer: ragents.processes. Rechte: runs.read, ragents.processes.read.

### Parameter

```json
{
  "type": "object",
  "required": [
    "runId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    }
  },
  "additionalProperties": false
}
```

### Nachricht

```json
{
  "type": "object",
  "additionalProperties": true,
  "x-typescript-type": "RunProcessMessage"
}
```

## Kanal ragents.run

Meldet jedes neue Journalereignis eines Runs; erst ready, dann run. Rechte wie das Lesen des Runs.

Eigentümer: host. Rechte: keine festen Rechte.

### Parameter

```json
{
  "type": "object",
  "required": [
    "runId"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    }
  },
  "additionalProperties": false
}
```

### Nachricht

```json
{
  "type": "object",
  "required": [
    "kind"
  ],
  "properties": {
    "kind": {
      "anyOf": [
        {
          "type": "string",
          "const": "ready"
        },
        {
          "type": "string",
          "const": "run"
        }
      ]
    }
  }
}
```

## Kanal ragents.sessions

Meldet jede Änderung der Run-Liste. Recht: runs.read.

Eigentümer: host. Rechte: runs.read.

### Parameter

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### Nachricht

```json
{
  "type": "object",
  "required": [
    "type"
  ],
  "properties": {
    "type": {
      "type": "string",
      "const": "changed"
    }
  }
}
```

## Kanal ragents.workspace.browse

Meldet jede Änderung unterhalb der beobachteten Wurzel eines Runs.

Eigentümer: ragents.workspace. Rechte: runs.read, runs.inspect.

### Parameter

```json
{
  "type": "object",
  "required": [
    "runId",
    "root"
  ],
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "Kennung des Runs"
    },
    "root": {
      "anyOf": [
        {
          "type": "string",
          "const": "workspace"
        },
        {
          "type": "string",
          "const": "files"
        }
      ]
    }
  },
  "additionalProperties": false
}
```

### Nachricht

```json
{
  "type": "object",
  "required": [
    "changed"
  ],
  "properties": {
    "changed": {
      "type": "boolean",
      "const": true
    }
  },
  "additionalProperties": false
}
```
