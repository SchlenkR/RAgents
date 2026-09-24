# RAgents: Bausteinreferenz

> Öffentliche Werkzeuge, Operationen, Actor-Programm-Vorlagen und Einstiege des Profils showcase, aus den tatsächlichen Verträgen erzeugt.

[Run-Setup-Anleitung und vollständige Pakete](run-setup.md) | [Entwicklerreferenz](developer.md) | [JSON-RPC-API](rpc-api.md) | [LLM-Index](llms.txt)

## Funktionen und native Werkzeuge

Fachfunktionen werden in Snippets und Actor-Programmen über context.functions aufgerufen. Ausgerüstete LLM-Actors erhalten automatisch die für sie verfügbaren Funktionsnamen mit Kurzbeschreibungen. typescript_api liefert auf Namensanfrage ihre Typen und optionalen Langbeschreibungen, typescript_eval führt Snippets aus. Dies ist der statische Bestand. Verfügbarkeit und Auswahl hängen von Actor, Grants und Run ab. Eigene Actor-Funktionen ergänzen diesen Bestand während einer Unterhaltung.

### action_propose

Propose Action

Propose an action for explicit human approval. This never executes the action directly.

Eigentümer: engine. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Nur mit der Capability action.propose.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "title"
  ],
  "properties": {
    "title": {
      "type": "string",
      "minLength": 1
    },
    "description": {
      "type": "string"
    },
    "parameters": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "name",
          "value"
        ],
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1
          },
          "value": {
            "type": "string"
          }
        }
      }
    },
    "input": {
      "type": "object",
      "required": [
        "label",
        "required"
      ],
      "properties": {
        "label": {
          "type": "string",
          "minLength": 1
        },
        "placeholder": {
          "type": "string"
        },
        "required": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "array",
  "items": {
    "anyOf": [
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.forked"
          },
          "payload": {
            "type": "object",
            "required": [
              "sourceRunId",
              "sourceSequence"
            ],
            "properties": {
              "sourceRunId": {
                "type": "string",
                "description": "ID des Quell-Runs"
              },
              "sourceSequence": {
                "type": "integer"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.primary-actor-selected"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des primären Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.title-changed"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string",
                "description": "Neuer Titel des Runs"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "agent.spawned"
          },
          "payload": {
            "type": "object",
            "required": [
              "agentId",
              "handle",
              "displayName"
            ],
            "properties": {
              "agentId": {
                "type": "string",
                "description": "ID des neuen Agenten; actor_input und actor_stop nehmen sie oder @handle"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "script.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "scriptId",
              "handle",
              "displayName"
            ],
            "properties": {
              "scriptId": {
                "type": "string",
                "description": "ID des neuen TypeScript-Actors"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.input.enqueued"
          },
          "payload": {
            "type": "object",
            "required": [
              "inputId",
              "actorId"
            ],
            "properties": {
              "inputId": {
                "type": "string",
                "description": "ID des eingereihten Inputs"
              },
              "actorId": {
                "type": "string",
                "description": "ID des empfangenden Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "inputId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des gestarteten Turns"
              },
              "inputId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.finished"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "outcome"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des beendeten Turns"
              },
              "outcome": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "reason"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des unterbrochenen Turns"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.reasoning.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "runtime.output.recorded"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.source"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "path"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "path": {
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
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name",
              "error"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              },
              "error": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.tools.opened"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "toolNames"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "Actor, dessen Werkzeuge geöffnet wurden"
              },
              "toolNames": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.stopped"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des gestoppten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.restarted"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des neu gestarteten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "subscriberId"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der neuen Subscription"
              },
              "subscriberId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.removed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der entfernten Subscription"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "sourceEventId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der gescheiterten Subscription"
              },
              "sourceEventId": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.proposed"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "title"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der vorgeschlagenen Aktion"
              },
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.resolved"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "decision"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der aufgelösten Aktion"
              },
              "decision": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "artifact.published"
          },
          "payload": {
            "type": "object",
            "required": [
              "artifact"
            ],
            "properties": {
              "artifact": {
                "type": "object",
                "required": [
                  "id",
                  "title",
                  "mediaType"
                ],
                "properties": {
                  "id": {
                    "type": "string",
                    "description": "ID des Artefakts; artifact_read liest es damit"
                  },
                  "title": {
                    "type": "string"
                  },
                  "mediaType": {
                    "type": "string"
                  }
                },
                "additionalProperties": false
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-replaced"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand ersetzt wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-patched"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand geändert wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      }
    ]
  },
  "description": "Die Journal-Events dieses Aufrufs. Die payload nennt die Kennungen des Ergebnisses; Eingaben und Hashes wiederholt sie nicht."
}
```

### actor_input

Enqueue Actor Input

Enqueue plain text and optional artifacts for one actor. The actor receives no routing envelope.

This only confirms enqueueing, not processing, an answer or completion. Agents interpret natural language. TypeScript actors only process their programmed input protocol: use their documented functions, or send an exact supported program input after inspecting the program. Never address an unknown script with a natural-language task or assume an idle or completed turn means the requested work happened.

Eigentümer: engine. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Nur mit der Capability actor.input.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "actor",
    "content"
  ],
  "properties": {
    "actor": {
      "type": "string",
      "minLength": 1,
      "description": "Actor ID oder Handle"
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
      },
      "uniqueItems": true
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "array",
  "items": {
    "anyOf": [
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.forked"
          },
          "payload": {
            "type": "object",
            "required": [
              "sourceRunId",
              "sourceSequence"
            ],
            "properties": {
              "sourceRunId": {
                "type": "string",
                "description": "ID des Quell-Runs"
              },
              "sourceSequence": {
                "type": "integer"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.primary-actor-selected"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des primären Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.title-changed"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string",
                "description": "Neuer Titel des Runs"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "agent.spawned"
          },
          "payload": {
            "type": "object",
            "required": [
              "agentId",
              "handle",
              "displayName"
            ],
            "properties": {
              "agentId": {
                "type": "string",
                "description": "ID des neuen Agenten; actor_input und actor_stop nehmen sie oder @handle"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "script.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "scriptId",
              "handle",
              "displayName"
            ],
            "properties": {
              "scriptId": {
                "type": "string",
                "description": "ID des neuen TypeScript-Actors"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.input.enqueued"
          },
          "payload": {
            "type": "object",
            "required": [
              "inputId",
              "actorId"
            ],
            "properties": {
              "inputId": {
                "type": "string",
                "description": "ID des eingereihten Inputs"
              },
              "actorId": {
                "type": "string",
                "description": "ID des empfangenden Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "inputId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des gestarteten Turns"
              },
              "inputId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.finished"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "outcome"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des beendeten Turns"
              },
              "outcome": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "reason"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des unterbrochenen Turns"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.reasoning.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "runtime.output.recorded"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.source"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "path"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "path": {
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
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name",
              "error"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              },
              "error": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.tools.opened"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "toolNames"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "Actor, dessen Werkzeuge geöffnet wurden"
              },
              "toolNames": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.stopped"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des gestoppten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.restarted"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des neu gestarteten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "subscriberId"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der neuen Subscription"
              },
              "subscriberId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.removed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der entfernten Subscription"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "sourceEventId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der gescheiterten Subscription"
              },
              "sourceEventId": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.proposed"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "title"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der vorgeschlagenen Aktion"
              },
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.resolved"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "decision"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der aufgelösten Aktion"
              },
              "decision": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "artifact.published"
          },
          "payload": {
            "type": "object",
            "required": [
              "artifact"
            ],
            "properties": {
              "artifact": {
                "type": "object",
                "required": [
                  "id",
                  "title",
                  "mediaType"
                ],
                "properties": {
                  "id": {
                    "type": "string",
                    "description": "ID des Artefakts; artifact_read liest es damit"
                  },
                  "title": {
                    "type": "string"
                  },
                  "mediaType": {
                    "type": "string"
                  }
                },
                "additionalProperties": false
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-replaced"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand ersetzt wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-patched"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand geändert wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      }
    ]
  },
  "description": "Die Journal-Events dieses Aufrufs. Die payload nennt die Kennungen des Ergebnisses; Eingaben und Hashes wiederholt sie nicht."
}
```

### actor_list

List Actors

List existing actors with their identity, lifecycle and function selection.

Check before spawning: reuse suitable participants, including actors created by a setup or another actor. Only kind agent is a conversational partner. A script executes its programmed input protocol; it does not interpret arbitrary natural-language requests. Inspect its documented functions or program before using it.

Eigentümer: engine. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Nur mit der Capability actor.input.

#### Eingabe

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "required": [
      "id",
      "handle",
      "displayName",
      "kind",
      "lifecycle",
      "createdBy",
      "tools"
    ],
    "properties": {
      "id": {
        "type": "string"
      },
      "handle": {
        "type": "string"
      },
      "displayName": {
        "type": "string"
      },
      "kind": {
        "anyOf": [
          {
            "type": "string",
            "const": "human"
          },
          {
            "type": "string",
            "const": "agent"
          },
          {
            "type": "string",
            "const": "script"
          }
        ]
      },
      "lifecycle": {
        "type": "string"
      },
      "createdBy": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      },
      "tools": {
        "anyOf": [
          {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          {
            "type": "null"
          }
        ]
      }
    },
    "additionalProperties": false
  }
}
```

### actor_program_activate

Activate Actor Program

Typecheck, build and test a package, then activate its functions and optional views.

actor self or @handle attaches to an existing actor; omitted creates a TypeScript actor for a backend, or attaches static views to self.

Eigentümer: ragents.actor-programs. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Für ausführbare Actors mit agent.spawn und plugin.state.write.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "name"
  ],
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9-]{0,63}$"
    },
    "actor": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "name",
    "actor",
    "views",
    "active"
  ],
  "properties": {
    "name": {
      "type": "string"
    },
    "actor": {
      "type": "string"
    },
    "views": {
      "type": "number"
    },
    "active": {
      "type": "boolean",
      "const": true
    }
  },
  "additionalProperties": false
}
```

### actor_program_controls

Actor-Programm-Anleitung und Controls nachschlagen

Read Mini-App control contracts or the actor-program authoring guide.

With topic: guide, explain the TypeScript package workflow through actor_program_activate. Otherwise list control names, or select one component (for example Form) for its TypeScript props and supporting types. Import controls from @ragents/client/ui and use these exact props.

Eigentümer: ragents.actor-programs. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: always.

Typisierte UI-Referenz der installierten Actor-Programm-Extension.

#### Eingabe

```json
{
  "type": "object",
  "properties": {
    "topic": {
      "anyOf": [
        {
          "type": "string",
          "const": "controls"
        },
        {
          "type": "string",
          "const": "guide"
        }
      ],
      "description": "Default controls: query component names or types. Guide: read the short package workflow without component."
    },
    "component": {
      "type": "string",
      "minLength": 1,
      "description": "Optional control name from the catalog, without UI. prefix. Only valid when topic is controls or omitted."
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "anyOf": [
    {
      "type": "object",
      "required": [
        "guide"
      ],
      "properties": {
        "guide": {
          "type": "string"
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "components"
      ],
      "properties": {
        "components": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "component": {
          "type": "string"
        },
        "files": {
          "type": "object",
          "patternProperties": {
            "^.*$": {
              "type": "string"
            }
          }
        }
      },
      "additionalProperties": false
    }
  ]
}
```

### actor_program_create

Create Actor Program

Create a private TypeScript package with fixed libraries.

Edit files under @actors/name using workspace tools.

Eigentümer: ragents.actor-programs. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Für ausführbare Actors mit agent.spawn und plugin.state.write.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "name",
    "template"
  ],
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9-]{0,63}$"
    },
    "template": {
      "anyOf": [
        {
          "type": "string",
          "const": "blank",
          "description": "Eine reine React-View am vorhandenen Actor ohne zusätzliche Serverfunktion."
        },
        {
          "type": "string",
          "const": "chat",
          "description": "Wiederverwendbarer Chat mit Verlauf und optionaler Eingabe an den Actor dieser View."
        },
        {
          "type": "string",
          "const": "controls",
          "description": "Lokale Demo mit Formular, Tabelle, Dateien, Aufgaben, Ablaufdiagramm, SVG-Verbindungen, Nachrichten, Dokument und Diff ohne Funktionsaufrufe."
        },
        {
          "type": "string",
          "const": "text-analysis",
          "description": "Ein TypeScript-Actor analysiert Texte mit eigener Funktion, Zustand und React-View."
        },
        {
          "type": "string",
          "const": "headless-counter",
          "description": "Ein TypeScript-Actor zählt Eingaben in seinem Zustand und bietet dieselbe Arbeit als Funktion an."
        },
        {
          "type": "string",
          "const": "shared-list",
          "description": "Ein Actor besitzt eine Funktion und eine React-View für denselben Listenstand."
        }
      ]
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "name",
    "directory",
    "files"
  ],
  "properties": {
    "name": {
      "type": "string"
    },
    "directory": {
      "type": "string"
    },
    "files": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "additionalProperties": false
}
```

### actor_program_diagnostics

Actor Program Diagnostics

Read the last project diagnostics.

Changed errors are automatically supplied before the next model request.

Eigentümer: ragents.actor-programs. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Für ausführbare Actors mit agent.spawn und plugin.state.write.

#### Eingabe

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9-]{0,63}$"
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "string"
}
```

### actor_program_list

List Actor Programs

List active actor packages, functions and views.

Eigentümer: ragents.actor-programs. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Für ausführbare Actors mit agent.spawn und plugin.state.write.

#### Eingabe

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "required": [
      "name",
      "actor",
      "functions",
      "views"
    ],
    "properties": {
      "name": {
        "type": "string"
      },
      "actor": {
        "type": "string"
      },
      "functions": {
        "type": "array",
        "items": {
          "type": "string"
        }
      },
      "views": {
        "type": "array",
        "items": {
          "type": "object",
          "required": [
            "name",
            "title",
            "visible"
          ],
          "properties": {
            "name": {
              "type": "string"
            },
            "title": {
              "type": "string"
            },
            "visible": {
              "type": "boolean"
            }
          }
        }
      }
    }
  }
}
```

### actor_program_remove

Remove Actor Program

Detach functions and views and stop the backend.

A TypeScript actor is stopped; an LLM actor retains its agent behavior.

Eigentümer: ragents.actor-programs. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Für ausführbare Actors mit agent.spawn und plugin.state.write.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "name"
  ],
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9-]{0,63}$"
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "removed"
  ],
  "properties": {
    "removed": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

### actor_restart

Restart Actor

Restart a stopped actor in this actor's branch. It resumes with its full history; the LLM is stateless.

Eigentümer: engine. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Nur mit der Capability execution.stopOwned.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "actorId",
    "reason"
  ],
  "properties": {
    "actorId": {
      "type": "string",
      "minLength": 1,
      "description": "Handle oder ID"
    },
    "reason": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "array",
  "items": {
    "anyOf": [
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.forked"
          },
          "payload": {
            "type": "object",
            "required": [
              "sourceRunId",
              "sourceSequence"
            ],
            "properties": {
              "sourceRunId": {
                "type": "string",
                "description": "ID des Quell-Runs"
              },
              "sourceSequence": {
                "type": "integer"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.primary-actor-selected"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des primären Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.title-changed"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string",
                "description": "Neuer Titel des Runs"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "agent.spawned"
          },
          "payload": {
            "type": "object",
            "required": [
              "agentId",
              "handle",
              "displayName"
            ],
            "properties": {
              "agentId": {
                "type": "string",
                "description": "ID des neuen Agenten; actor_input und actor_stop nehmen sie oder @handle"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "script.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "scriptId",
              "handle",
              "displayName"
            ],
            "properties": {
              "scriptId": {
                "type": "string",
                "description": "ID des neuen TypeScript-Actors"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.input.enqueued"
          },
          "payload": {
            "type": "object",
            "required": [
              "inputId",
              "actorId"
            ],
            "properties": {
              "inputId": {
                "type": "string",
                "description": "ID des eingereihten Inputs"
              },
              "actorId": {
                "type": "string",
                "description": "ID des empfangenden Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "inputId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des gestarteten Turns"
              },
              "inputId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.finished"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "outcome"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des beendeten Turns"
              },
              "outcome": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "reason"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des unterbrochenen Turns"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.reasoning.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "runtime.output.recorded"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.source"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "path"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "path": {
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
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name",
              "error"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              },
              "error": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.tools.opened"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "toolNames"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "Actor, dessen Werkzeuge geöffnet wurden"
              },
              "toolNames": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.stopped"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des gestoppten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.restarted"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des neu gestarteten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "subscriberId"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der neuen Subscription"
              },
              "subscriberId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.removed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der entfernten Subscription"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "sourceEventId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der gescheiterten Subscription"
              },
              "sourceEventId": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.proposed"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "title"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der vorgeschlagenen Aktion"
              },
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.resolved"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "decision"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der aufgelösten Aktion"
              },
              "decision": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "artifact.published"
          },
          "payload": {
            "type": "object",
            "required": [
              "artifact"
            ],
            "properties": {
              "artifact": {
                "type": "object",
                "required": [
                  "id",
                  "title",
                  "mediaType"
                ],
                "properties": {
                  "id": {
                    "type": "string",
                    "description": "ID des Artefakts; artifact_read liest es damit"
                  },
                  "title": {
                    "type": "string"
                  },
                  "mediaType": {
                    "type": "string"
                  }
                },
                "additionalProperties": false
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-replaced"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand ersetzt wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-patched"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand geändert wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      }
    ]
  },
  "description": "Die Journal-Events dieses Aufrufs. Die payload nennt die Kennungen des Ergebnisses; Eingaben und Hashes wiederholt sie nicht."
}
```

### actor_stop

Stop Actor

Stop an actor in this actor's branch together with its active descendants.

Eigentümer: engine. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Nur mit der Capability execution.stopOwned.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "actorId",
    "reason"
  ],
  "properties": {
    "actorId": {
      "type": "string",
      "minLength": 1,
      "description": "Handle oder ID"
    },
    "reason": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "array",
  "items": {
    "anyOf": [
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.forked"
          },
          "payload": {
            "type": "object",
            "required": [
              "sourceRunId",
              "sourceSequence"
            ],
            "properties": {
              "sourceRunId": {
                "type": "string",
                "description": "ID des Quell-Runs"
              },
              "sourceSequence": {
                "type": "integer"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.primary-actor-selected"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des primären Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.title-changed"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string",
                "description": "Neuer Titel des Runs"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "agent.spawned"
          },
          "payload": {
            "type": "object",
            "required": [
              "agentId",
              "handle",
              "displayName"
            ],
            "properties": {
              "agentId": {
                "type": "string",
                "description": "ID des neuen Agenten; actor_input und actor_stop nehmen sie oder @handle"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "script.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "scriptId",
              "handle",
              "displayName"
            ],
            "properties": {
              "scriptId": {
                "type": "string",
                "description": "ID des neuen TypeScript-Actors"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.input.enqueued"
          },
          "payload": {
            "type": "object",
            "required": [
              "inputId",
              "actorId"
            ],
            "properties": {
              "inputId": {
                "type": "string",
                "description": "ID des eingereihten Inputs"
              },
              "actorId": {
                "type": "string",
                "description": "ID des empfangenden Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "inputId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des gestarteten Turns"
              },
              "inputId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.finished"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "outcome"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des beendeten Turns"
              },
              "outcome": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "reason"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des unterbrochenen Turns"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.reasoning.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "runtime.output.recorded"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.source"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "path"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "path": {
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
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name",
              "error"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              },
              "error": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.tools.opened"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "toolNames"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "Actor, dessen Werkzeuge geöffnet wurden"
              },
              "toolNames": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.stopped"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des gestoppten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.restarted"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des neu gestarteten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "subscriberId"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der neuen Subscription"
              },
              "subscriberId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.removed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der entfernten Subscription"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "sourceEventId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der gescheiterten Subscription"
              },
              "sourceEventId": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.proposed"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "title"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der vorgeschlagenen Aktion"
              },
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.resolved"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "decision"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der aufgelösten Aktion"
              },
              "decision": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "artifact.published"
          },
          "payload": {
            "type": "object",
            "required": [
              "artifact"
            ],
            "properties": {
              "artifact": {
                "type": "object",
                "required": [
                  "id",
                  "title",
                  "mediaType"
                ],
                "properties": {
                  "id": {
                    "type": "string",
                    "description": "ID des Artefakts; artifact_read liest es damit"
                  },
                  "title": {
                    "type": "string"
                  },
                  "mediaType": {
                    "type": "string"
                  }
                },
                "additionalProperties": false
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-replaced"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand ersetzt wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-patched"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand geändert wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      }
    ]
  },
  "description": "Die Journal-Events dieses Aufrufs. Die payload nennt die Kennungen des Ergebnisses; Eingaben und Hashes wiederholt sie nicht."
}
```

### actor_transcript

Verlauf verdichten

Liefert den Verlauf eines Actors dieses Runs als kompaktes Transkript: Eingaben, Antworttexte und Werkzeugaufrufe je eine Zeile, Ergebnisse gekürzt, ohne Reasoning. Für Übergaben, Statusberichte und Zusammenfassungen.

Eigentümer: ragents.transcript. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Für Agenten und Skript-Actors mit der Capability event.subscribe.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "actor"
  ],
  "properties": {
    "actor": {
      "type": "string",
      "minLength": 1,
      "description": "Handle mit oder ohne @ oder ID eines Actors dieses Runs"
    },
    "maxChars": {
      "type": "integer",
      "minimum": 200,
      "maximum": 200000,
      "description": "Obergrenze in Zeichen, Standard 20000; die ältesten Zeilen entfallen zuerst"
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "actorId",
    "handle",
    "text",
    "lines",
    "truncated"
  ],
  "properties": {
    "actorId": {
      "type": "string"
    },
    "handle": {
      "type": "string"
    },
    "text": {
      "type": "string"
    },
    "lines": {
      "type": "integer",
      "minimum": 0
    },
    "truncated": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

### actor_view_set_visibility

Show or hide Actor View

Set Canvas visibility by package-name/view-key or @handle/view-key.

Use names you chose; the server resolves the view ID. A unique view title also works.

Eigentümer: ragents.actor-programs. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Für ausführbare Actors mit agent.spawn und plugin.state.write.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "view",
    "visible"
  ],
  "properties": {
    "view": {
      "type": "string",
      "minLength": 1,
      "description": "package-name/view-key or @handle/view-key of an activated view, without the Canvas entity prefix app:. No generated IDs needed."
    },
    "visible": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "view",
    "visible"
  ],
  "properties": {
    "view": {
      "type": "string"
    },
    "visible": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

### agent_spawn

Spawn Agent

Create an idle LLM agent with an explicit model or profile and function selection.

Create a new idle agent only when no existing actor fits the required role. Check actor_list first when available; actor_input reuses an existing actor. Read model_list before the first spawn and pass a model-bearing profile, or an explicit model selection from that catalog. handle and prompt alone cannot create an LLM agent; the caller's model is not inherited. It inherits delegable capabilities, but tools is required and never inherited: select exact names, [] for text-only work, or explicit null for an open, dynamically resolved toolset. An empty tools array creates a plain LLM with no runtime, workspace or host tools; drivers without plain-LLM isolation are rejected. forkOf copies the model context of an existing LLM agent of this run into the new agent at its first turn: the copy ends before any unfinished tool call and carries no reasoning; the new agent still gets its own prompt, tools and model.

Eigentümer: engine. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Nur mit der Capability agent.spawn.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "handle",
    "prompt",
    "tools"
  ],
  "properties": {
    "handle": {
      "type": "string",
      "minLength": 1
    },
    "displayName": {
      "type": "string",
      "minLength": 1,
      "description": "Anzeigename; ohne Angabe der Handle"
    },
    "prompt": {
      "type": "string"
    },
    "forkOf": {
      "type": "string",
      "minLength": 1,
      "description": "Handle oder ID eines LLM-Agenten dieses Runs, dessen bisheriger Modellkontext in den neuen Agenten kopiert wird"
    },
    "tools": {
      "anyOf": [
        {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          },
          "uniqueItems": true
        },
        {
          "type": "null"
        }
      ],
      "description": "Required explicit selection: [] for plain text-only work including app-mediated conversations; an array for exact existing tool names; null only when the task needs an open, dynamically resolved toolset. Never inherits the caller's tools. Names of future, not yet activated actor functions are invalid; choose null when those must become available later."
    },
    "withoutCapabilities": {
      "type": "array",
      "items": {
        "anyOf": [
          {
            "type": "string",
            "const": "actor.input"
          },
          {
            "type": "string",
            "const": "event.subscribe"
          },
          {
            "type": "string",
            "const": "agent.spawn"
          },
          {
            "type": "string",
            "const": "artifact.publish"
          },
          {
            "type": "string",
            "const": "plugin.state.write"
          },
          {
            "type": "string",
            "const": "action.propose"
          },
          {
            "type": "string",
            "const": "workspace.use"
          },
          {
            "type": "string",
            "const": "execution.stopOwned"
          },
          {
            "type": "string",
            "const": "run.configure"
          }
        ]
      },
      "uniqueItems": true
    },
    "profile": {
      "type": "string",
      "minLength": 1,
      "description": "Execution profile from model_list. Normally supply this field: an LLM agent needs a model-bearing profile or an explicit model. The caller's model is not inherited."
    },
    "driver": {
      "anyOf": [
        {
          "type": "string",
          "const": "manual"
        },
        {
          "type": "string",
          "const": "script"
        },
        {
          "type": "string",
          "const": "agent"
        }
      ]
    },
    "provider": {
      "type": "string",
      "minLength": 1,
      "description": "Provider from model_list for an explicit model selection; may be omitted when the profile or an unambiguous catalog entry supplies it."
    },
    "model": {
      "type": "string",
      "minLength": 1,
      "description": "Model from model_list. Required for an LLM agent unless profile supplies a model; also overrides the profile's model."
    },
    "thinking": {
      "anyOf": [
        {
          "type": "string",
          "const": "off"
        },
        {
          "type": "string",
          "const": "minimal"
        },
        {
          "type": "string",
          "const": "low"
        },
        {
          "type": "string",
          "const": "medium"
        },
        {
          "type": "string",
          "const": "high"
        },
        {
          "type": "string",
          "const": "xhigh"
        },
        {
          "type": "string",
          "const": "max"
        }
      ]
    },
    "turnTimeoutMs": {
      "type": "integer",
      "minimum": 1000
    },
    "isolateWorkspace": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "id",
    "handle"
  ],
  "properties": {
    "id": {
      "type": "string",
      "description": "Stable actor reference for actor_input and other functions."
    },
    "handle": {
      "type": "string",
      "description": "Actual unique handle, including any suffix assigned during creation."
    }
  },
  "additionalProperties": false
}
```

### artifact_publish

Publish Artifact

Publish immutable text content to the run artifact store.

Eigentümer: engine. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Nur mit der Capability artifact.publish.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "title",
    "mediaType",
    "content"
  ],
  "properties": {
    "title": {
      "type": "string",
      "minLength": 1
    },
    "mediaType": {
      "type": "string",
      "minLength": 1
    },
    "content": {
      "type": "string"
    },
    "previousVersionId": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "array",
  "items": {
    "anyOf": [
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.forked"
          },
          "payload": {
            "type": "object",
            "required": [
              "sourceRunId",
              "sourceSequence"
            ],
            "properties": {
              "sourceRunId": {
                "type": "string",
                "description": "ID des Quell-Runs"
              },
              "sourceSequence": {
                "type": "integer"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.primary-actor-selected"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des primären Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.title-changed"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string",
                "description": "Neuer Titel des Runs"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "agent.spawned"
          },
          "payload": {
            "type": "object",
            "required": [
              "agentId",
              "handle",
              "displayName"
            ],
            "properties": {
              "agentId": {
                "type": "string",
                "description": "ID des neuen Agenten; actor_input und actor_stop nehmen sie oder @handle"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "script.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "scriptId",
              "handle",
              "displayName"
            ],
            "properties": {
              "scriptId": {
                "type": "string",
                "description": "ID des neuen TypeScript-Actors"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.input.enqueued"
          },
          "payload": {
            "type": "object",
            "required": [
              "inputId",
              "actorId"
            ],
            "properties": {
              "inputId": {
                "type": "string",
                "description": "ID des eingereihten Inputs"
              },
              "actorId": {
                "type": "string",
                "description": "ID des empfangenden Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "inputId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des gestarteten Turns"
              },
              "inputId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.finished"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "outcome"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des beendeten Turns"
              },
              "outcome": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "reason"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des unterbrochenen Turns"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.reasoning.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "runtime.output.recorded"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.source"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "path"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "path": {
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
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name",
              "error"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              },
              "error": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.tools.opened"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "toolNames"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "Actor, dessen Werkzeuge geöffnet wurden"
              },
              "toolNames": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.stopped"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des gestoppten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.restarted"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des neu gestarteten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "subscriberId"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der neuen Subscription"
              },
              "subscriberId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.removed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der entfernten Subscription"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "sourceEventId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der gescheiterten Subscription"
              },
              "sourceEventId": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.proposed"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "title"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der vorgeschlagenen Aktion"
              },
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.resolved"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "decision"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der aufgelösten Aktion"
              },
              "decision": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "artifact.published"
          },
          "payload": {
            "type": "object",
            "required": [
              "artifact"
            ],
            "properties": {
              "artifact": {
                "type": "object",
                "required": [
                  "id",
                  "title",
                  "mediaType"
                ],
                "properties": {
                  "id": {
                    "type": "string",
                    "description": "ID des Artefakts; artifact_read liest es damit"
                  },
                  "title": {
                    "type": "string"
                  },
                  "mediaType": {
                    "type": "string"
                  }
                },
                "additionalProperties": false
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-replaced"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand ersetzt wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-patched"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand geändert wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      }
    ]
  },
  "description": "Die Journal-Events dieses Aufrufs. Die payload nennt die Kennungen des Ergebnisses; Eingaben und Hashes wiederholt sie nicht."
}
```

### artifact_read

Read Artifact

Read an artifact created by this actor or attached to one of its inputs. The run owner may read every artifact.

Eigentümer: engine. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: always.

In jedem Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "artifactId"
  ],
  "properties": {
    "artifactId": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "artifact",
    "encoding",
    "content"
  ],
  "properties": {
    "artifact": {
      "type": "object",
      "required": [
        "id",
        "title",
        "mediaType",
        "size",
        "previousVersionId",
        "createdBy",
        "createdAt"
      ],
      "properties": {
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "mediaType": {
          "type": "string"
        },
        "size": {
          "type": "integer",
          "minimum": 0
        },
        "previousVersionId": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "createdBy": {
          "type": "string"
        },
        "createdAt": {
          "type": "string"
        }
      },
      "additionalProperties": false
    },
    "encoding": {
      "anyOf": [
        {
          "type": "string",
          "const": "utf8"
        },
        {
          "type": "string",
          "const": "base64"
        }
      ]
    },
    "content": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

### ask_user

Rückfrage

Holt eine nötige Benutzerentscheidung mit Antwortoptionen ein und wartet auf die Antwort.

Nutze dieses Werkzeug immer, wenn du eine Entscheidung des Benutzers brauchst (z.B. Auswahl eines Branches oder eines Zeitraums), statt die Frage nur als Text zu stellen. Mit multi=true darf der Benutzer mehrere Optionen wählen; die Antwort ist dann mit '; ' verbunden. Der Benutzer kann statt einer Option auch immer frei antworten - rechne also damit, dass die Antwort beliebiger Text sein kann.

Eigentümer: ragents.ask. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: always.

In jedem Turn verfügbar; die Frage geht immer an den Benutzer des Runs.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "question",
    "options"
  ],
  "properties": {
    "question": {
      "type": "string",
      "description": "Die Frage an den Benutzer, kurz und konkret"
    },
    "options": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Antwortoptionen (2 bis 6 Stück)"
    },
    "multi": {
      "type": "boolean",
      "description": "true = Mehrfachauswahl erlaubt"
    }
  }
}
```

#### Ergebnis

```json
{
  "type": "string"
}
```

### bash

bash

Execute shell commands in the run's workspace with sandbox restrictions.

Execute a bash command in the current working directory. Returns stdout and stderr; a nonzero exit code is reported at the end of the result (for example grep without a match), not as a tool error. Output is truncated to last 2000 lines or 50KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.

Eigentümer: ragents.workspace. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "command"
  ],
  "properties": {
    "command": {
      "type": "string",
      "description": "Bash command to execute"
    },
    "timeout": {
      "type": "number",
      "description": "Timeout in seconds (optional, no default timeout)"
    }
  }
}
```

#### Ergebnis

```json
{
  "type": "string"
}
```

### browser_check

Browserergebnis prüfen

Assert visible target/text, resulting URL and absence of browser errors. Fails on mismatch; records successful evidence for this page until the next action/navigation/error. Supply at least one assertion. Browser errors are checked by default. Visibility assertions wait at most 5 seconds, shorter than actions.

Eigentümer: ragents.browser. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "properties": {
    "target": {
      "type": "object",
      "properties": {
        "role": {
          "type": "string",
          "minLength": 1,
          "description": "Accessible role, e.g. button, textbox, link, combobox."
        },
        "name": {
          "type": "string",
          "description": "Exact accessible name for role."
        },
        "label": {
          "type": "string",
          "minLength": 1,
          "description": "Exact form label."
        },
        "text": {
          "type": "string",
          "minLength": 1,
          "description": "Exact visible text."
        },
        "testId": {
          "type": "string",
          "minLength": 1,
          "description": "data-testid value."
        },
        "css": {
          "type": "string",
          "minLength": 1,
          "description": "CSS selector for elements without useful accessible names."
        },
        "frame": {
          "type": "string",
          "minLength": 1,
          "description": "CSS selector of an iframe containing the target."
        },
        "nth": {
          "type": "integer",
          "minimum": 0,
          "description": "0-based index among all matches when the target matches several elements; not together with first."
        },
        "first": {
          "type": "boolean",
          "description": "Use the first match when the target matches several elements; not together with nth."
        }
      },
      "additionalProperties": false,
      "description": "Use exactly one of role (with optional name), label, text, testId, css. Resolve semantic targets server-side; never copy snapshot element IDs. Ambiguous targets are errors naming the candidates unless nth or first selects one."
    },
    "text": {
      "type": "string",
      "minLength": 1
    },
    "url": {
      "type": "string",
      "minLength": 1
    },
    "count": {
      "type": "integer",
      "minimum": 0,
      "description": "Expected number of visible matches of target instead of exactly one; 0 asserts absence. Requires target without nth or first."
    },
    "noErrors": {
      "type": "boolean",
      "description": "true (default): the check also fails on any browser error collected since the last navigation. false: ignore browser errors and judge only the assertions; use this when the page has known noise such as 404s or third-party script errors that are not part of the check."
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "checkedAt",
    "url",
    "assertions"
  ],
  "properties": {
    "checkedAt": {
      "type": "string"
    },
    "url": {
      "type": "string"
    },
    "assertions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "additionalProperties": false
}
```

### browser_click

Im Browser klicken

Click a uniquely identified visible element with Playwright auto-waiting. Returns the actual resulting page. Ambiguous or absent targets are errors.

Eigentümer: ragents.browser. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "target"
  ],
  "properties": {
    "target": {
      "type": "object",
      "properties": {
        "role": {
          "type": "string",
          "minLength": 1,
          "description": "Accessible role, e.g. button, textbox, link, combobox."
        },
        "name": {
          "type": "string",
          "description": "Exact accessible name for role."
        },
        "label": {
          "type": "string",
          "minLength": 1,
          "description": "Exact form label."
        },
        "text": {
          "type": "string",
          "minLength": 1,
          "description": "Exact visible text."
        },
        "testId": {
          "type": "string",
          "minLength": 1,
          "description": "data-testid value."
        },
        "css": {
          "type": "string",
          "minLength": 1,
          "description": "CSS selector for elements without useful accessible names."
        },
        "frame": {
          "type": "string",
          "minLength": 1,
          "description": "CSS selector of an iframe containing the target."
        },
        "nth": {
          "type": "integer",
          "minimum": 0,
          "description": "0-based index among all matches when the target matches several elements; not together with first."
        },
        "first": {
          "type": "boolean",
          "description": "Use the first match when the target matches several elements; not together with nth."
        }
      },
      "additionalProperties": false,
      "description": "Use exactly one of role (with optional name), label, text, testId, css. Resolve semantic targets server-side; never copy snapshot element IDs. Ambiguous targets are errors naming the candidates unless nth or first selects one."
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "url",
    "title",
    "snapshot",
    "truncated",
    "errors"
  ],
  "properties": {
    "url": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "snapshot": {
      "type": "string"
    },
    "truncated": {
      "type": "boolean"
    },
    "errors": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "additionalProperties": false
}
```

### browser_close

Browser schließen

Close this run's browser and discard its cookies. Saved screenshots remain in the document library.

Eigentümer: ragents.browser. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "closed"
  ],
  "properties": {
    "closed": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

### browser_fill

Browserfeld ausfüllen

Fill an input or textarea by accessible label or another semantic target, firing the normal input events. Returns the resulting page.

Eigentümer: ragents.browser. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "target",
    "value"
  ],
  "properties": {
    "target": {
      "type": "object",
      "properties": {
        "role": {
          "type": "string",
          "minLength": 1,
          "description": "Accessible role, e.g. button, textbox, link, combobox."
        },
        "name": {
          "type": "string",
          "description": "Exact accessible name for role."
        },
        "label": {
          "type": "string",
          "minLength": 1,
          "description": "Exact form label."
        },
        "text": {
          "type": "string",
          "minLength": 1,
          "description": "Exact visible text."
        },
        "testId": {
          "type": "string",
          "minLength": 1,
          "description": "data-testid value."
        },
        "css": {
          "type": "string",
          "minLength": 1,
          "description": "CSS selector for elements without useful accessible names."
        },
        "frame": {
          "type": "string",
          "minLength": 1,
          "description": "CSS selector of an iframe containing the target."
        },
        "nth": {
          "type": "integer",
          "minimum": 0,
          "description": "0-based index among all matches when the target matches several elements; not together with first."
        },
        "first": {
          "type": "boolean",
          "description": "Use the first match when the target matches several elements; not together with nth."
        }
      },
      "additionalProperties": false,
      "description": "Use exactly one of role (with optional name), label, text, testId, css. Resolve semantic targets server-side; never copy snapshot element IDs. Ambiguous targets are errors naming the candidates unless nth or first selects one."
    },
    "value": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "url",
    "title",
    "snapshot",
    "truncated",
    "errors"
  ],
  "properties": {
    "url": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "snapshot": {
      "type": "string"
    },
    "truncated": {
      "type": "boolean"
    },
    "errors": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "additionalProperties": false
}
```

### browser_open

Browser öffnen

Open an HTTP(S) page in this run's isolated headless browser. Returns its accessible structure and browser errors. Reuses the current run browser; other runs have separate cookies and processes.

Eigentümer: ragents.browser. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "url"
  ],
  "properties": {
    "url": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "url",
    "title",
    "snapshot",
    "truncated",
    "errors"
  ],
  "properties": {
    "url": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "snapshot": {
      "type": "string"
    },
    "truncated": {
      "type": "boolean"
    },
    "errors": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "additionalProperties": false
}
```

### browser_press

Browsertaste drücken

Focus a target and press a Playwright key or chord such as Enter, Escape, Tab or ControlOrMeta+A. Returns the resulting page.

Eigentümer: ragents.browser. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "target",
    "key"
  ],
  "properties": {
    "target": {
      "type": "object",
      "properties": {
        "role": {
          "type": "string",
          "minLength": 1,
          "description": "Accessible role, e.g. button, textbox, link, combobox."
        },
        "name": {
          "type": "string",
          "description": "Exact accessible name for role."
        },
        "label": {
          "type": "string",
          "minLength": 1,
          "description": "Exact form label."
        },
        "text": {
          "type": "string",
          "minLength": 1,
          "description": "Exact visible text."
        },
        "testId": {
          "type": "string",
          "minLength": 1,
          "description": "data-testid value."
        },
        "css": {
          "type": "string",
          "minLength": 1,
          "description": "CSS selector for elements without useful accessible names."
        },
        "frame": {
          "type": "string",
          "minLength": 1,
          "description": "CSS selector of an iframe containing the target."
        },
        "nth": {
          "type": "integer",
          "minimum": 0,
          "description": "0-based index among all matches when the target matches several elements; not together with first."
        },
        "first": {
          "type": "boolean",
          "description": "Use the first match when the target matches several elements; not together with nth."
        }
      },
      "additionalProperties": false,
      "description": "Use exactly one of role (with optional name), label, text, testId, css. Resolve semantic targets server-side; never copy snapshot element IDs. Ambiguous targets are errors naming the candidates unless nth or first selects one."
    },
    "key": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "url",
    "title",
    "snapshot",
    "truncated",
    "errors"
  ],
  "properties": {
    "url": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "snapshot": {
      "type": "string"
    },
    "truncated": {
      "type": "boolean"
    },
    "errors": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "additionalProperties": false
}
```

### browser_screenshot

Browser aufnehmen

Capture the real browser page into this run's document library. The returned URL and Markdown display it to the user. Call browser_view_screenshot to inspect the latest capture as an image without copying a path.

Eigentümer: ragents.browser. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "properties": {
    "label": {
      "type": "string",
      "maxLength": 200
    },
    "fullPage": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "name",
    "path",
    "url",
    "markdown",
    "capturedAt"
  ],
  "properties": {
    "name": {
      "type": "string"
    },
    "path": {
      "type": "string"
    },
    "url": {
      "type": "string"
    },
    "markdown": {
      "type": "string"
    },
    "capturedAt": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

### browser_select

Im Browser auswählen

Choose an option by its visible label in a native select element. For custom dropdowns use browser_click on the trigger and the visible option.

Eigentümer: ragents.browser. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "target",
    "label"
  ],
  "properties": {
    "target": {
      "type": "object",
      "properties": {
        "role": {
          "type": "string",
          "minLength": 1,
          "description": "Accessible role, e.g. button, textbox, link, combobox."
        },
        "name": {
          "type": "string",
          "description": "Exact accessible name for role."
        },
        "label": {
          "type": "string",
          "minLength": 1,
          "description": "Exact form label."
        },
        "text": {
          "type": "string",
          "minLength": 1,
          "description": "Exact visible text."
        },
        "testId": {
          "type": "string",
          "minLength": 1,
          "description": "data-testid value."
        },
        "css": {
          "type": "string",
          "minLength": 1,
          "description": "CSS selector for elements without useful accessible names."
        },
        "frame": {
          "type": "string",
          "minLength": 1,
          "description": "CSS selector of an iframe containing the target."
        },
        "nth": {
          "type": "integer",
          "minimum": 0,
          "description": "0-based index among all matches when the target matches several elements; not together with first."
        },
        "first": {
          "type": "boolean",
          "description": "Use the first match when the target matches several elements; not together with nth."
        }
      },
      "additionalProperties": false,
      "description": "Use exactly one of role (with optional name), label, text, testId, css. Resolve semantic targets server-side; never copy snapshot element IDs. Ambiguous targets are errors naming the candidates unless nth or first selects one."
    },
    "label": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "url",
    "title",
    "snapshot",
    "truncated",
    "errors"
  ],
  "properties": {
    "url": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "snapshot": {
      "type": "string"
    },
    "truncated": {
      "type": "boolean"
    },
    "errors": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "additionalProperties": false
}
```

### browser_snapshot

Browser lesen

Read the current real page's accessible structure, title, URL and errors. Use role/name or labels for subsequent actions; snapshot reference IDs never need to be copied.

Eigentümer: ragents.browser. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "url",
    "title",
    "snapshot",
    "truncated",
    "errors"
  ],
  "properties": {
    "url": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "snapshot": {
      "type": "string"
    },
    "truncated": {
      "type": "boolean"
    },
    "errors": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "additionalProperties": false
}
```

### browser_view_screenshot

Browseraufnahme ansehen

View this run's latest screenshot as native image input without a path. Invoke this native tool directly to receive pixels; calling it through TypeScript only verifies image availability. Requires an image-capable model for native image input.

Eigentümer: ragents.browser. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "string"
}
```

### browser_viewport

Browsergröße setzen

Resize the page viewport in CSS pixels, for example to check a narrow layout. The default is 1920 x 1080 (16:9) and screenshots use the viewport size at scale 1; the chosen size stays for the run until changed again. Returns the resulting page.

Eigentümer: ragents.browser. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "width",
    "height"
  ],
  "properties": {
    "width": {
      "type": "integer",
      "minimum": 320,
      "maximum": 3840
    },
    "height": {
      "type": "integer",
      "minimum": 240,
      "maximum": 2160
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "url",
    "title",
    "snapshot",
    "truncated",
    "errors"
  ],
  "properties": {
    "url": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "snapshot": {
      "type": "string"
    },
    "truncated": {
      "type": "boolean"
    },
    "errors": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "additionalProperties": false
}
```

### canvas_layout_replace

Replace Canvas Layout

Arrange actors and mini-apps as tiles on the viewport-filling work surface, using a binary tree of weighted splits.

root is the whole arrangement and replaces the stored one. A tile is {entity:'@helper'} or {entity:'app:@workspace/main'}; a split is {direction:'horizontal',weights:[1,1],children:[tile,tile]}. horizontal means left/right, vertical means top/bottom, and weights give the ratio of the two children. App left, chat right at 50:50: {root:{direction:'horizontal',weights:[1,1],children:[{entity:'app:@workspace/main'},{entity:'@helper'}]}}. One tile above two tiles at 2:1: {root:{direction:'vertical',weights:[2,1],children:[{entity:'@lead'},{direction:'horizontal',weights:[1,1],children:[{entity:'@first'},{entity:'@second'}]}]}}. root:null clears the surface. Dividers are draggable, so do not resend a layout to fight a personal arrangement. Participants you do not place stay reachable through the run header.

Eigentümer: ragents.orchestration. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Nur für Agenten und Script-Actors mit der Capability plugin.state.write.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "root"
  ],
  "properties": {
    "root": {
      "anyOf": [
        {
          "$defs": {
            "CanvasTile": {
              "anyOf": [
                {
                  "type": "object",
                  "required": [
                    "entity"
                  ],
                  "properties": {
                    "entity": {
                      "type": "string",
                      "minLength": 1,
                      "description": "Actor @handle or activated mini-app app:@handle/view-key or app:program-name/view-key; the server resolves the view ID"
                    },
                    "chatInput": {
                      "type": "boolean",
                      "description": "Actor tiles only: false hides the chat composer in the tile; default true. Does not change permissions or the inspector"
                    }
                  },
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "required": [
                    "direction",
                    "weights",
                    "children"
                  ],
                  "properties": {
                    "direction": {
                      "anyOf": [
                        {
                          "type": "string",
                          "const": "horizontal"
                        },
                        {
                          "type": "string",
                          "const": "vertical"
                        }
                      ]
                    },
                    "weights": {
                      "type": "array",
                      "additionalItems": false,
                      "items": [
                        {
                          "type": "number",
                          "exclusiveMinimum": 0
                        },
                        {
                          "type": "number",
                          "exclusiveMinimum": 0
                        }
                      ],
                      "minItems": 2
                    },
                    "children": {
                      "type": "array",
                      "additionalItems": false,
                      "items": [
                        {
                          "$ref": "CanvasTile"
                        },
                        {
                          "$ref": "CanvasTile"
                        }
                      ],
                      "minItems": 2
                    }
                  },
                  "additionalProperties": false
                }
              ],
              "$id": "CanvasTile"
            }
          },
          "$ref": "CanvasTile"
        },
        {
          "type": "null"
        }
      ],
      "description": "The whole arrangement: a tile or a binary split. Maximum 64 unique tiles and 16 nested splits. null clears the surface"
    }
  }
}
```

#### Ergebnis

```json
{
  "type": "array",
  "items": {
    "anyOf": [
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.forked"
          },
          "payload": {
            "type": "object",
            "required": [
              "sourceRunId",
              "sourceSequence"
            ],
            "properties": {
              "sourceRunId": {
                "type": "string",
                "description": "ID des Quell-Runs"
              },
              "sourceSequence": {
                "type": "integer"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.primary-actor-selected"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des primären Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.title-changed"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string",
                "description": "Neuer Titel des Runs"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "agent.spawned"
          },
          "payload": {
            "type": "object",
            "required": [
              "agentId",
              "handle",
              "displayName"
            ],
            "properties": {
              "agentId": {
                "type": "string",
                "description": "ID des neuen Agenten; actor_input und actor_stop nehmen sie oder @handle"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "script.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "scriptId",
              "handle",
              "displayName"
            ],
            "properties": {
              "scriptId": {
                "type": "string",
                "description": "ID des neuen TypeScript-Actors"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.input.enqueued"
          },
          "payload": {
            "type": "object",
            "required": [
              "inputId",
              "actorId"
            ],
            "properties": {
              "inputId": {
                "type": "string",
                "description": "ID des eingereihten Inputs"
              },
              "actorId": {
                "type": "string",
                "description": "ID des empfangenden Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "inputId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des gestarteten Turns"
              },
              "inputId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.finished"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "outcome"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des beendeten Turns"
              },
              "outcome": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "reason"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des unterbrochenen Turns"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.reasoning.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "runtime.output.recorded"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.source"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "path"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "path": {
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
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name",
              "error"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              },
              "error": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.tools.opened"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "toolNames"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "Actor, dessen Werkzeuge geöffnet wurden"
              },
              "toolNames": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.stopped"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des gestoppten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.restarted"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des neu gestarteten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "subscriberId"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der neuen Subscription"
              },
              "subscriberId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.removed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der entfernten Subscription"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "sourceEventId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der gescheiterten Subscription"
              },
              "sourceEventId": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.proposed"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "title"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der vorgeschlagenen Aktion"
              },
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.resolved"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "decision"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der aufgelösten Aktion"
              },
              "decision": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "artifact.published"
          },
          "payload": {
            "type": "object",
            "required": [
              "artifact"
            ],
            "properties": {
              "artifact": {
                "type": "object",
                "required": [
                  "id",
                  "title",
                  "mediaType"
                ],
                "properties": {
                  "id": {
                    "type": "string",
                    "description": "ID des Artefakts; artifact_read liest es damit"
                  },
                  "title": {
                    "type": "string"
                  },
                  "mediaType": {
                    "type": "string"
                  }
                },
                "additionalProperties": false
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-replaced"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand ersetzt wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-patched"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand geändert wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      }
    ]
  },
  "description": "Die Journal-Events dieses Aufrufs. Die payload nennt die Kennungen des Ergebnisses; Eingaben und Hashes wiederholt sie nicht."
}
```

### document_write

Dokument ablegen

Legt eine Datei mit dem übergebenen Inhalt in der Dateiablage dieses Runs ab.

Dokumente, Berichte und Zwischenprodukte gehören in die Dateiablage, nicht ins Arbeitsverzeichnis - dort steht nur, was zum Auftrag selbst gehört. Der Benutzer sieht die Ablage im Bereich "Dokumente", nach Unterordnern gruppiert. Soll eine Datei aus dem Arbeitsbereich in die Ablage, lies sie zuerst mit read und übergib den Inhalt hier als content. Die Ablage ist kein Bash-Pfad: sie liegt nicht im Arbeitsbereich und ist nur über dieses Werkzeug beschreibbar.

Eigentümer: ragents.documents. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "path",
    "content"
  ],
  "properties": {
    "path": {
      "type": "string",
      "minLength": 1,
      "description": "Pfad in der Dateiablage, etwa thema/bericht.md"
    },
    "content": {
      "type": "string",
      "description": "Der vollständige Inhalt der Datei"
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "string"
}
```

### edit

edit

Apply exact text replacements to existing files within the run's writable workspace roots.

Edit a single file using exact text replacement. Pass expectedHash from the latest read so the edit is rejected if the file changed meanwhile. Every edits[].oldText must match a unique, non-overlapping region of the original file, or be anchored with occurrence, nearLine or replaceAll. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.

Eigentümer: ragents.workspace. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "path",
    "edits"
  ],
  "properties": {
    "path": {
      "type": "string",
      "description": "Path to the file to edit (relative or absolute)"
    },
    "expectedHash": {
      "type": "string",
      "description": "SHA-256 from the latest read. The edit is rejected if the file changed since that read.",
      "pattern": "^[a-f0-9]{64}$"
    },
    "edits": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "oldText",
          "newText"
        ],
        "properties": {
          "oldText": {
            "type": "string",
            "description": "Exact text for one targeted replacement. It must be unique in the original file unless occurrence, nearLine or replaceAll is set, and must not overlap with any other edits[].oldText in the same call."
          },
          "newText": {
            "type": "string",
            "description": "Replacement text for this targeted edit."
          },
          "occurrence": {
            "type": "number",
            "description": "1-based index of the occurrence to replace when oldText is not unique. A failed edit lists all occurrences with their line numbers, so pick the index from that list."
          },
          "nearLine": {
            "type": "number",
            "description": "1-based line number near the intended occurrence. The occurrence closest to it wins; a tie is an error."
          },
          "replaceAll": {
            "type": "boolean",
            "description": "Replace every occurrence of oldText. Cannot be combined with occurrence or nearLine, and must not be used to change only some of them."
          }
        }
      },
      "description": "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead."
    }
  }
}
```

#### Ergebnis

```json
{
  "type": "string"
}
```

### event_query

Query Events

Read journal events in this run, optionally filtered by event ID, actor or event type.

Eigentümer: engine. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Nur mit der Capability event.subscribe.

#### Eingabe

```json
{
  "type": "object",
  "properties": {
    "eventIds": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "uniqueItems": true
    },
    "actorIds": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "uniqueItems": true
    },
    "eventTypes": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "uniqueItems": true,
      "description": "Jeder Journal-Eventtyp ist abfragbar. Abonnierbar sind nur die observable Typen; event_subscribe zeigt sie."
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 500
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
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
        "type": "integer"
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
        "type": "string"
      },
      "payload": {}
    },
    "additionalProperties": false
  }
}
```

### event_subscribe

Subscribe to Events

Subscribe this actor to run events delivered as later ActorInputs.

Source actors may be named by id or handle. Matching observable events arrive as new ActorInputs for this actor.

Eigentümer: engine. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Nur mit der Capability event.subscribe.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "eventTypes"
  ],
  "properties": {
    "sourceActorIds": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "uniqueItems": true
    },
    "sourceActorKinds": {
      "type": "array",
      "items": {
        "anyOf": [
          {
            "type": "string",
            "const": "human"
          },
          {
            "type": "string",
            "const": "agent"
          },
          {
            "type": "string",
            "const": "script"
          }
        ]
      },
      "uniqueItems": true
    },
    "eventTypes": {
      "type": "array",
      "items": {
        "anyOf": [
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
            "const": "tool.call.completed"
          },
          {
            "type": "string",
            "const": "tool.call.failed"
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
      "minItems": 1,
      "uniqueItems": true
    },
    "includeSelf": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "anyOf": [
    {
      "type": "object",
      "required": [
        "subscriptionId",
        "subscriberId",
        "sourceActorIds",
        "sources",
        "sourceActorKinds",
        "eventTypes",
        "includeSelf",
        "createdBy",
        "createdAt",
        "createdSequence",
        "status"
      ],
      "properties": {
        "subscriptionId": {
          "type": "string",
          "description": "ID der Subscription; event_unsubscribe nimmt sie als subscriptionId"
        },
        "subscriberId": {
          "type": "string"
        },
        "sourceActorIds": {
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ],
          "description": "Quell-Actors als ID; null = alle. ID und @handle sind als Eingabe gleichwertig."
        },
        "sources": {
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ],
          "description": "Dieselben Quellen als @handle, soweit auflösbar; sonst die ID."
        },
        "sourceActorKinds": {
          "anyOf": [
            {
              "type": "array",
              "items": {
                "anyOf": [
                  {
                    "type": "string",
                    "const": "human"
                  },
                  {
                    "type": "string",
                    "const": "agent"
                  },
                  {
                    "type": "string",
                    "const": "script"
                  }
                ]
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "eventTypes": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "includeSelf": {
          "type": "boolean"
        },
        "createdBy": {
          "type": "string"
        },
        "createdAt": {
          "type": "string"
        },
        "createdSequence": {
          "type": "integer"
        },
        "status": {
          "type": "string",
          "const": "active"
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "subscriptionId",
        "subscriberId",
        "sourceActorIds",
        "sources",
        "sourceActorKinds",
        "eventTypes",
        "includeSelf",
        "createdBy",
        "createdAt",
        "createdSequence",
        "status",
        "endedAt",
        "reason"
      ],
      "properties": {
        "subscriptionId": {
          "type": "string",
          "description": "ID der Subscription; event_unsubscribe nimmt sie als subscriptionId"
        },
        "subscriberId": {
          "type": "string"
        },
        "sourceActorIds": {
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ],
          "description": "Quell-Actors als ID; null = alle. ID und @handle sind als Eingabe gleichwertig."
        },
        "sources": {
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ],
          "description": "Dieselben Quellen als @handle, soweit auflösbar; sonst die ID."
        },
        "sourceActorKinds": {
          "anyOf": [
            {
              "type": "array",
              "items": {
                "anyOf": [
                  {
                    "type": "string",
                    "const": "human"
                  },
                  {
                    "type": "string",
                    "const": "agent"
                  },
                  {
                    "type": "string",
                    "const": "script"
                  }
                ]
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "eventTypes": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "includeSelf": {
          "type": "boolean"
        },
        "createdBy": {
          "type": "string"
        },
        "createdAt": {
          "type": "string"
        },
        "createdSequence": {
          "type": "integer"
        },
        "status": {
          "type": "string",
          "const": "removed"
        },
        "endedAt": {
          "type": "string"
        },
        "reason": {
          "type": "string"
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "subscriptionId",
        "subscriberId",
        "sourceActorIds",
        "sources",
        "sourceActorKinds",
        "eventTypes",
        "includeSelf",
        "createdBy",
        "createdAt",
        "createdSequence",
        "status",
        "endedAt",
        "reason",
        "sourceEventId"
      ],
      "properties": {
        "subscriptionId": {
          "type": "string",
          "description": "ID der Subscription; event_unsubscribe nimmt sie als subscriptionId"
        },
        "subscriberId": {
          "type": "string"
        },
        "sourceActorIds": {
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ],
          "description": "Quell-Actors als ID; null = alle. ID und @handle sind als Eingabe gleichwertig."
        },
        "sources": {
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ],
          "description": "Dieselben Quellen als @handle, soweit auflösbar; sonst die ID."
        },
        "sourceActorKinds": {
          "anyOf": [
            {
              "type": "array",
              "items": {
                "anyOf": [
                  {
                    "type": "string",
                    "const": "human"
                  },
                  {
                    "type": "string",
                    "const": "agent"
                  },
                  {
                    "type": "string",
                    "const": "script"
                  }
                ]
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "eventTypes": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "includeSelf": {
          "type": "boolean"
        },
        "createdBy": {
          "type": "string"
        },
        "createdAt": {
          "type": "string"
        },
        "createdSequence": {
          "type": "integer"
        },
        "status": {
          "type": "string",
          "const": "failed"
        },
        "endedAt": {
          "type": "string"
        },
        "reason": {
          "type": "string"
        },
        "sourceEventId": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  ]
}
```

### event_subscription_list

List Event Subscriptions

List this actor's event subscriptions, including inactive and failed ones.

Eigentümer: engine. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Nur mit der Capability event.subscribe.

#### Eingabe

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "array",
  "items": {
    "anyOf": [
      {
        "type": "object",
        "required": [
          "subscriptionId",
          "subscriberId",
          "sourceActorIds",
          "sources",
          "sourceActorKinds",
          "eventTypes",
          "includeSelf",
          "createdBy",
          "createdAt",
          "createdSequence",
          "status"
        ],
        "properties": {
          "subscriptionId": {
            "type": "string",
            "description": "ID der Subscription; event_unsubscribe nimmt sie als subscriptionId"
          },
          "subscriberId": {
            "type": "string"
          },
          "sourceActorIds": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              {
                "type": "null"
              }
            ],
            "description": "Quell-Actors als ID; null = alle. ID und @handle sind als Eingabe gleichwertig."
          },
          "sources": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              {
                "type": "null"
              }
            ],
            "description": "Dieselben Quellen als @handle, soweit auflösbar; sonst die ID."
          },
          "sourceActorKinds": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "anyOf": [
                    {
                      "type": "string",
                      "const": "human"
                    },
                    {
                      "type": "string",
                      "const": "agent"
                    },
                    {
                      "type": "string",
                      "const": "script"
                    }
                  ]
                }
              },
              {
                "type": "null"
              }
            ]
          },
          "eventTypes": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "includeSelf": {
            "type": "boolean"
          },
          "createdBy": {
            "type": "string"
          },
          "createdAt": {
            "type": "string"
          },
          "createdSequence": {
            "type": "integer"
          },
          "status": {
            "type": "string",
            "const": "active"
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "subscriptionId",
          "subscriberId",
          "sourceActorIds",
          "sources",
          "sourceActorKinds",
          "eventTypes",
          "includeSelf",
          "createdBy",
          "createdAt",
          "createdSequence",
          "status",
          "endedAt",
          "reason"
        ],
        "properties": {
          "subscriptionId": {
            "type": "string",
            "description": "ID der Subscription; event_unsubscribe nimmt sie als subscriptionId"
          },
          "subscriberId": {
            "type": "string"
          },
          "sourceActorIds": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              {
                "type": "null"
              }
            ],
            "description": "Quell-Actors als ID; null = alle. ID und @handle sind als Eingabe gleichwertig."
          },
          "sources": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              {
                "type": "null"
              }
            ],
            "description": "Dieselben Quellen als @handle, soweit auflösbar; sonst die ID."
          },
          "sourceActorKinds": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "anyOf": [
                    {
                      "type": "string",
                      "const": "human"
                    },
                    {
                      "type": "string",
                      "const": "agent"
                    },
                    {
                      "type": "string",
                      "const": "script"
                    }
                  ]
                }
              },
              {
                "type": "null"
              }
            ]
          },
          "eventTypes": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "includeSelf": {
            "type": "boolean"
          },
          "createdBy": {
            "type": "string"
          },
          "createdAt": {
            "type": "string"
          },
          "createdSequence": {
            "type": "integer"
          },
          "status": {
            "type": "string",
            "const": "removed"
          },
          "endedAt": {
            "type": "string"
          },
          "reason": {
            "type": "string"
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "subscriptionId",
          "subscriberId",
          "sourceActorIds",
          "sources",
          "sourceActorKinds",
          "eventTypes",
          "includeSelf",
          "createdBy",
          "createdAt",
          "createdSequence",
          "status",
          "endedAt",
          "reason",
          "sourceEventId"
        ],
        "properties": {
          "subscriptionId": {
            "type": "string",
            "description": "ID der Subscription; event_unsubscribe nimmt sie als subscriptionId"
          },
          "subscriberId": {
            "type": "string"
          },
          "sourceActorIds": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              {
                "type": "null"
              }
            ],
            "description": "Quell-Actors als ID; null = alle. ID und @handle sind als Eingabe gleichwertig."
          },
          "sources": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              {
                "type": "null"
              }
            ],
            "description": "Dieselben Quellen als @handle, soweit auflösbar; sonst die ID."
          },
          "sourceActorKinds": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "anyOf": [
                    {
                      "type": "string",
                      "const": "human"
                    },
                    {
                      "type": "string",
                      "const": "agent"
                    },
                    {
                      "type": "string",
                      "const": "script"
                    }
                  ]
                }
              },
              {
                "type": "null"
              }
            ]
          },
          "eventTypes": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "includeSelf": {
            "type": "boolean"
          },
          "createdBy": {
            "type": "string"
          },
          "createdAt": {
            "type": "string"
          },
          "createdSequence": {
            "type": "integer"
          },
          "status": {
            "type": "string",
            "const": "failed"
          },
          "endedAt": {
            "type": "string"
          },
          "reason": {
            "type": "string"
          },
          "sourceEventId": {
            "type": "string"
          }
        },
        "additionalProperties": false
      }
    ]
  }
}
```

### event_unsubscribe

Remove Event Subscription

Remove one event subscription owned by this actor.

Eigentümer: engine. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Nur mit der Capability event.subscribe.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "subscriptionId",
    "reason"
  ],
  "properties": {
    "subscriptionId": {
      "type": "string",
      "minLength": 1,
      "description": "subscriptionId aus event_subscribe oder event_subscription_list"
    },
    "reason": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "array",
  "items": {
    "anyOf": [
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.forked"
          },
          "payload": {
            "type": "object",
            "required": [
              "sourceRunId",
              "sourceSequence"
            ],
            "properties": {
              "sourceRunId": {
                "type": "string",
                "description": "ID des Quell-Runs"
              },
              "sourceSequence": {
                "type": "integer"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.primary-actor-selected"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des primären Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.title-changed"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string",
                "description": "Neuer Titel des Runs"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "agent.spawned"
          },
          "payload": {
            "type": "object",
            "required": [
              "agentId",
              "handle",
              "displayName"
            ],
            "properties": {
              "agentId": {
                "type": "string",
                "description": "ID des neuen Agenten; actor_input und actor_stop nehmen sie oder @handle"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "script.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "scriptId",
              "handle",
              "displayName"
            ],
            "properties": {
              "scriptId": {
                "type": "string",
                "description": "ID des neuen TypeScript-Actors"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.input.enqueued"
          },
          "payload": {
            "type": "object",
            "required": [
              "inputId",
              "actorId"
            ],
            "properties": {
              "inputId": {
                "type": "string",
                "description": "ID des eingereihten Inputs"
              },
              "actorId": {
                "type": "string",
                "description": "ID des empfangenden Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "inputId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des gestarteten Turns"
              },
              "inputId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.finished"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "outcome"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des beendeten Turns"
              },
              "outcome": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "reason"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des unterbrochenen Turns"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.reasoning.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "runtime.output.recorded"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.source"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "path"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "path": {
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
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name",
              "error"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              },
              "error": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.tools.opened"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "toolNames"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "Actor, dessen Werkzeuge geöffnet wurden"
              },
              "toolNames": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.stopped"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des gestoppten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.restarted"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des neu gestarteten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "subscriberId"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der neuen Subscription"
              },
              "subscriberId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.removed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der entfernten Subscription"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "sourceEventId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der gescheiterten Subscription"
              },
              "sourceEventId": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.proposed"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "title"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der vorgeschlagenen Aktion"
              },
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.resolved"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "decision"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der aufgelösten Aktion"
              },
              "decision": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "artifact.published"
          },
          "payload": {
            "type": "object",
            "required": [
              "artifact"
            ],
            "properties": {
              "artifact": {
                "type": "object",
                "required": [
                  "id",
                  "title",
                  "mediaType"
                ],
                "properties": {
                  "id": {
                    "type": "string",
                    "description": "ID des Artefakts; artifact_read liest es damit"
                  },
                  "title": {
                    "type": "string"
                  },
                  "mediaType": {
                    "type": "string"
                  }
                },
                "additionalProperties": false
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-replaced"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand ersetzt wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-patched"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand geändert wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      }
    ]
  },
  "description": "Die Journal-Events dieses Aufrufs. Die payload nennt die Kennungen des Ergebnisses; Eingaben und Hashes wiederholt sie nicht."
}
```

### fsharp_close

FSAC schließen

Stop the FSAC language server instance of one root; without root every FSAC instance of this conversation. Other languages and other conversations stay untouched.

Eigentümer: ragents.lsp-fsharp. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "properties": {
    "root": {
      "type": "string",
      "description": "The open root to stop; omit for every instance of this conversation"
    }
  }
}
```

#### Ergebnis

```json
{
  "type": "string"
}
```

### fsharp_diagnostics

FSAC Diagnostik

Current FSAC diagnostics (errors, warnings on request) for .fs, .fsi, .fsx files from the running language server, without building. Without paths: all changed files of every open root according to git. With paths every file is answered by the instance whose root contains it; root asks one instance.

Eigentümer: ragents.lsp-fsharp. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "properties": {
    "paths": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Files relative to the workspace root; omit for all changed files"
    },
    "root": {
      "type": "string",
      "description": "Ask only the instance of this open root"
    },
    "warnings": {
      "type": "boolean",
      "description": "Also list warnings (default: only counted)"
    }
  }
}
```

#### Ergebnis

```json
{
  "type": "string"
}
```

### fsharp_open

FSAC öffnen

Start a FSAC language server instance for this conversation's workspace and load the .sln file (or a single .fsproj). Afterwards every edit or write of a .fs, .fsi, .fsx file gets its diagnostics appended automatically, and fsharp_diagnostics is available. Idempotent for the same root; other roots stay open.

Eigentümer: ragents.lsp-fsharp. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "root"
  ],
  "properties": {
    "root": {
      "type": "string",
      "description": "the .sln file (or a single .fsproj), relative to the workspace root"
    }
  }
}
```

#### Ergebnis

```json
{
  "type": "string"
}
```

### model_list

List Models and Profiles

List the execution profiles and provider models available for agent_spawn.

Eigentümer: engine. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Nur mit der Capability agent.spawn.

#### Eingabe

```json
{
  "type": "object",
  "properties": {
    "driver": {
      "anyOf": [
        {
          "type": "string",
          "const": "manual"
        },
        {
          "type": "string",
          "const": "script"
        },
        {
          "type": "string",
          "const": "agent"
        }
      ]
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "profiles",
    "models"
  ],
  "properties": {
    "profiles": {
      "type": "array",
      "items": {
        "anyOf": [
          {
            "type": "object",
            "required": [
              "name",
              "description",
              "turnTimeoutMs",
              "isolateWorkspace",
              "driver"
            ],
            "properties": {
              "name": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "turnTimeoutMs": {
                "anyOf": [
                  {
                    "type": "integer"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "isolateWorkspace": {
                "type": "boolean"
              },
              "driver": {
                "anyOf": [
                  {
                    "type": "string",
                    "const": "manual"
                  },
                  {
                    "type": "string",
                    "const": "script"
                  }
                ]
              }
            },
            "additionalProperties": false
          },
          {
            "type": "object",
            "required": [
              "name",
              "description",
              "turnTimeoutMs",
              "isolateWorkspace",
              "driver",
              "provider",
              "model"
            ],
            "properties": {
              "name": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "turnTimeoutMs": {
                "anyOf": [
                  {
                    "type": "integer"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "isolateWorkspace": {
                "type": "boolean"
              },
              "driver": {
                "type": "string",
                "const": "agent"
              },
              "provider": {
                "type": "string"
              },
              "model": {
                "type": "string"
              },
              "thinking": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        ]
      }
    },
    "models": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "driver",
          "provider",
          "model",
          "label",
          "thinking"
        ],
        "properties": {
          "driver": {
            "type": "string"
          },
          "provider": {
            "type": "string"
          },
          "model": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "thinking": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "Denkstufen, die agent_spawn für dieses Modell annimmt."
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

### quick_answer

Kurze Antwort

Ergänzt nach der normalen Chatantwort eine kurze Zusammenfassung von Nutzerfrage und Ergebnis.

Nach deiner normalen Chatantwort: Wiederhole die aktuelle Nutzerfrage kurz in question und fasse dein Ergebnis in text als kurzen deutschen Satz zusammen. Beide Texte dürfen jeweils höchstens 240 Zeichen lang sein und ersetzen die Chatantwort nicht.

Eigentümer: ragents.overseer. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Nur für den globalen Primary-Koordinator mit plugin.state.write.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "question",
    "text"
  ],
  "properties": {
    "question": {
      "type": "string",
      "minLength": 1,
      "maxLength": 240,
      "description": "Die aktuelle Nutzerfrage kurz in eigenen Worten wiederholen."
    },
    "text": {
      "type": "string",
      "minLength": 1,
      "maxLength": 240,
      "description": "Ein kurzer Satz mit dem Ergebnis deiner normalen Chatantwort."
    }
  }
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "ok"
  ],
  "properties": {
    "ok": {
      "type": "boolean",
      "const": true
    }
  }
}
```

### read

read

Read file contents or images within the run's allowed workspace roots.

Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.

Eigentümer: ragents.workspace. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "path"
  ],
  "properties": {
    "path": {
      "type": "string",
      "description": "Path to the file to read (relative or absolute)"
    },
    "offset": {
      "type": "number",
      "description": "Line number to start reading from (1-indexed)"
    },
    "limit": {
      "type": "number",
      "description": "Maximum number of lines to read"
    }
  }
}
```

#### Ergebnis

```json
{
  "type": "string"
}
```

### roslyn_close

Roslyn schließen

Stop the Roslyn language server instance of one root; without root every Roslyn instance of this conversation. Other languages and other conversations stay untouched.

Eigentümer: ragents.lsp-roslyn. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "properties": {
    "root": {
      "type": "string",
      "description": "The open root to stop; omit for every instance of this conversation"
    }
  }
}
```

#### Ergebnis

```json
{
  "type": "string"
}
```

### roslyn_diagnostics

Roslyn Diagnostik

Current Roslyn diagnostics (errors, warnings on request) for .cs files from the running language server, without building. Without paths: all changed files of every open root according to git. With paths every file is answered by the instance whose root contains it; root asks one instance.

Eigentümer: ragents.lsp-roslyn. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "properties": {
    "paths": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Files relative to the workspace root; omit for all changed files"
    },
    "root": {
      "type": "string",
      "description": "Ask only the instance of this open root"
    },
    "warnings": {
      "type": "boolean",
      "description": "Also list warnings (default: only counted)"
    }
  }
}
```

#### Ergebnis

```json
{
  "type": "string"
}
```

### roslyn_open

Roslyn öffnen

Start a Roslyn language server instance for this conversation's workspace and load the .sln file (or a single .csproj). Afterwards every edit or write of a .cs file gets its diagnostics appended automatically, and roslyn_diagnostics is available. Idempotent for the same root; other roots stay open.

Eigentümer: ragents.lsp-roslyn. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "root"
  ],
  "properties": {
    "root": {
      "type": "string",
      "description": "the .sln file (or a single .csproj), relative to the workspace root"
    }
  }
}
```

#### Ergebnis

```json
{
  "type": "string"
}
```

### run_configure

Configure Run

Set the run title and/or choose the primary actor the chat talks to. Give title, primaryActor or both; the primary actor must be an active agent or script actor of this run.

Eigentümer: engine. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Nur mit der Capability run.configure.

#### Eingabe

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200,
      "description": "Neuer Titel des Runs"
    },
    "primaryActor": {
      "type": "string",
      "minLength": 1,
      "description": "Handle oder ID des Actors, mit dem der Chat des Benutzers spricht"
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "array",
  "items": {
    "anyOf": [
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.forked"
          },
          "payload": {
            "type": "object",
            "required": [
              "sourceRunId",
              "sourceSequence"
            ],
            "properties": {
              "sourceRunId": {
                "type": "string",
                "description": "ID des Quell-Runs"
              },
              "sourceSequence": {
                "type": "integer"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.primary-actor-selected"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des primären Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.title-changed"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string",
                "description": "Neuer Titel des Runs"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "agent.spawned"
          },
          "payload": {
            "type": "object",
            "required": [
              "agentId",
              "handle",
              "displayName"
            ],
            "properties": {
              "agentId": {
                "type": "string",
                "description": "ID des neuen Agenten; actor_input und actor_stop nehmen sie oder @handle"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "script.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "scriptId",
              "handle",
              "displayName"
            ],
            "properties": {
              "scriptId": {
                "type": "string",
                "description": "ID des neuen TypeScript-Actors"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.input.enqueued"
          },
          "payload": {
            "type": "object",
            "required": [
              "inputId",
              "actorId"
            ],
            "properties": {
              "inputId": {
                "type": "string",
                "description": "ID des eingereihten Inputs"
              },
              "actorId": {
                "type": "string",
                "description": "ID des empfangenden Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "inputId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des gestarteten Turns"
              },
              "inputId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.finished"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "outcome"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des beendeten Turns"
              },
              "outcome": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "reason"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des unterbrochenen Turns"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.reasoning.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "runtime.output.recorded"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.source"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "path"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "path": {
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
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name",
              "error"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              },
              "error": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.tools.opened"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "toolNames"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "Actor, dessen Werkzeuge geöffnet wurden"
              },
              "toolNames": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.stopped"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des gestoppten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.restarted"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des neu gestarteten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "subscriberId"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der neuen Subscription"
              },
              "subscriberId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.removed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der entfernten Subscription"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "sourceEventId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der gescheiterten Subscription"
              },
              "sourceEventId": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.proposed"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "title"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der vorgeschlagenen Aktion"
              },
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.resolved"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "decision"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der aufgelösten Aktion"
              },
              "decision": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "artifact.published"
          },
          "payload": {
            "type": "object",
            "required": [
              "artifact"
            ],
            "properties": {
              "artifact": {
                "type": "object",
                "required": [
                  "id",
                  "title",
                  "mediaType"
                ],
                "properties": {
                  "id": {
                    "type": "string",
                    "description": "ID des Artefakts; artifact_read liest es damit"
                  },
                  "title": {
                    "type": "string"
                  },
                  "mediaType": {
                    "type": "string"
                  }
                },
                "additionalProperties": false
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-replaced"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand ersetzt wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-patched"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand geändert wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      }
    ]
  },
  "description": "Die Journal-Events dieses Aufrufs. Die payload nennt die Kennungen des Ergebnisses; Eingaben und Hashes wiederholt sie nicht."
}
```

### run_stop

Run stoppen

Leitet den vollständigen Stopp des eigenen Runs ein: laufende Turns, Werkzeuge, Unteragenten und Plugin-Dienste. Unterhaltung und Dateien bleiben erhalten. Bricht auch den eigenen Turn ab; die Annahme ist keine Bestätigung abgeschlossener Bereinigung. Bei Benutzerwunsch nach vollständigem Abbruch sofort verwenden, keine Abbruchnachricht an beschäftigte Agenten senden.

Eigentümer: ragents.orchestration. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Für den Primary-Actor mit execution.stopOwned im eigenen Run.

#### Eingabe

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "requested"
  ],
  "properties": {
    "requested": {
      "type": "boolean",
      "const": true
    }
  },
  "additionalProperties": false
}
```

### show_document

Dokument anzeigen

Zeigt Dokumente vollständig in der Oberfläche; Dateipfade gelten nur für die Dateiablage dieses Runs.

Nutze dieses Werkzeug IMMER, wenn der Benutzer den Inhalt einer Datei oder ein längeres Dokument sehen möchte - statt den Inhalt in die Chat-Antwort zu kopieren oder zu paraphrasieren. path zeigt ausschließlich eine Datei aus der Dateiablage dieses Runs an, NICHT aus deinem Arbeitsverzeichnis. Alles andere - Dateien des Arbeitsverzeichnisses und selbst erzeugte Inhalte - geht über content; stammt der Inhalt aus einer Datei, übernimm ihn dort WÖRTLICH aus dem letzten read- oder write-Ergebnis, niemals aus dem Gedächtnis neu getippt.

Eigentümer: ragents.documents. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Turn verfügbar; die Frage geht immer an den Benutzer des Runs.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "title"
  ],
  "properties": {
    "title": {
      "type": "string",
      "description": "Titel der Anzeige, z.B. der Dateiname"
    },
    "content": {
      "type": "string",
      "description": "Der vollständige Inhalt - für Dateien aus dem Arbeitsverzeichnis und für selbst erzeugte Inhalte, also alles, was nicht in der Dateiablage liegt. content und path schließen einander aus: gültig sind { title, content, format } für selbst erzeugte Inhalte und Dateien des Arbeitsverzeichnisses und { title, path, format } für Dateien der Dateiablage - genau eines von beiden muss gesetzt sein."
    },
    "path": {
      "type": "string",
      "description": "Datei aus der Dateiablage dieses Runs, relativ zur Ablage (z.B. thema/datei.md). Nur dort abgelegte Dateien sind so anzeigbar - für Pfade des Arbeitsverzeichnisses content nutzen. Der Inhalt wird direkt aus der Datei angezeigt und muss nie abgetippt werden. content und path schließen einander aus: gültig sind { title, content, format } für selbst erzeugte Inhalte und Dateien des Arbeitsverzeichnisses und { title, path, format } für Dateien der Dateiablage - genau eines von beiden muss gesetzt sein."
    },
    "format": {
      "anyOf": [
        {
          "type": "string",
          "const": "markdown"
        },
        {
          "type": "string",
          "const": "text"
        },
        {
          "type": "string",
          "const": "html"
        }
      ],
      "description": "Darstellung, Default markdown"
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "string"
}
```

### todo_replace

Replace To-do List

Replace this agent's complete to-do snapshot with its current progress.

Mark an item completed only AFTER the work actually happened, never in advance; update the list as you go so at most one item is active.

Eigentümer: ragents.todo. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: conditional.

Nur für Agenten mit der Capability plugin.state.write.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "todos"
  ],
  "properties": {
    "todos": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "text",
          "status"
        ],
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1
          },
          "text": {
            "type": "string",
            "minLength": 1
          },
          "status": {
            "anyOf": [
              {
                "type": "string",
                "const": "open"
              },
              {
                "type": "string",
                "const": "active"
              },
              {
                "type": "string",
                "const": "completed"
              },
              {
                "type": "string",
                "const": "pending"
              },
              {
                "type": "string",
                "const": "in_progress"
              },
              {
                "type": "string",
                "const": "done"
              }
            ],
            "description": "open = offen, active = in Arbeit, completed = erledigt; pending, in_progress und done werden ebenfalls angenommen"
          }
        }
      }
    }
  }
}
```

#### Ergebnis

```json
{
  "type": "array",
  "items": {
    "anyOf": [
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.forked"
          },
          "payload": {
            "type": "object",
            "required": [
              "sourceRunId",
              "sourceSequence"
            ],
            "properties": {
              "sourceRunId": {
                "type": "string",
                "description": "ID des Quell-Runs"
              },
              "sourceSequence": {
                "type": "integer"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.primary-actor-selected"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des primären Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.title-changed"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string",
                "description": "Neuer Titel des Runs"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "agent.spawned"
          },
          "payload": {
            "type": "object",
            "required": [
              "agentId",
              "handle",
              "displayName"
            ],
            "properties": {
              "agentId": {
                "type": "string",
                "description": "ID des neuen Agenten; actor_input und actor_stop nehmen sie oder @handle"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "script.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "scriptId",
              "handle",
              "displayName"
            ],
            "properties": {
              "scriptId": {
                "type": "string",
                "description": "ID des neuen TypeScript-Actors"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.input.enqueued"
          },
          "payload": {
            "type": "object",
            "required": [
              "inputId",
              "actorId"
            ],
            "properties": {
              "inputId": {
                "type": "string",
                "description": "ID des eingereihten Inputs"
              },
              "actorId": {
                "type": "string",
                "description": "ID des empfangenden Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "inputId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des gestarteten Turns"
              },
              "inputId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.finished"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "outcome"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des beendeten Turns"
              },
              "outcome": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "reason"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des unterbrochenen Turns"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.reasoning.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "runtime.output.recorded"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.source"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "path"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "path": {
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
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name",
              "error"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              },
              "error": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.tools.opened"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "toolNames"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "Actor, dessen Werkzeuge geöffnet wurden"
              },
              "toolNames": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.stopped"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des gestoppten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.restarted"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des neu gestarteten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "subscriberId"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der neuen Subscription"
              },
              "subscriberId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.removed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der entfernten Subscription"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "sourceEventId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der gescheiterten Subscription"
              },
              "sourceEventId": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.proposed"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "title"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der vorgeschlagenen Aktion"
              },
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.resolved"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "decision"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der aufgelösten Aktion"
              },
              "decision": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "artifact.published"
          },
          "payload": {
            "type": "object",
            "required": [
              "artifact"
            ],
            "properties": {
              "artifact": {
                "type": "object",
                "required": [
                  "id",
                  "title",
                  "mediaType"
                ],
                "properties": {
                  "id": {
                    "type": "string",
                    "description": "ID des Artefakts; artifact_read liest es damit"
                  },
                  "title": {
                    "type": "string"
                  },
                  "mediaType": {
                    "type": "string"
                  }
                },
                "additionalProperties": false
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-replaced"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand ersetzt wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-patched"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand geändert wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      }
    ]
  },
  "description": "Die Journal-Events dieses Aufrufs. Die payload nennt die Kennungen des Ergebnisses; Eingaben und Hashes wiederholt sie nicht."
}
```

### typescript_api

TypeScript API

Discover the typed functions available to this actor. Omit names for a compact searchable list; pass exact names for their TypeScript declarations with field documentation and the matching guidance. JSON schemas with validation constraints are added only on request. Functions are called as await context.functions.name(input) from snippets and actor programs.

Eigentümer: ragents.runtime. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: conditional.

Für aktive ausführbare Actors mit einer Funktionsauswahl.

#### Eingabe

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "minLength": 1,
      "description": "Search names and descriptions. Omit for all available names."
    },
    "names": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "minItems": 1,
      "uniqueItems": true,
      "description": "Exact function names whose complete declarations and guidance are needed."
    },
    "schemas": {
      "type": "boolean",
      "description": "With names: also return the JSON schemas including validation constraints such as lengths and patterns."
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "functions"
  ],
  "properties": {
    "functions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "name",
          "label",
          "description"
        ],
        "properties": {
          "name": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "longDescription": {
            "type": "string"
          },
          "inputSchema": {},
          "resultSchema": {}
        },
        "additionalProperties": false
      }
    },
    "declarations": {
      "type": "string"
    },
    "guidance": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

### typescript_close

TypeScript schließen

Stop the TypeScript language server instance of one root; without root every TypeScript instance of this conversation. Other languages and other conversations stay untouched.

Eigentümer: ragents.lsp-typescript. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "properties": {
    "root": {
      "type": "string",
      "description": "The open root to stop; omit for every instance of this conversation"
    }
  }
}
```

#### Ergebnis

```json
{
  "type": "string"
}
```

### typescript_diagnostics

TypeScript Diagnostik

Current TypeScript diagnostics (errors, warnings on request) for .ts, .tsx, .mts, .cts, .js, .jsx files from the running language server, without building. Without paths: all changed files of every open root according to git. With paths every file is answered by the instance whose root contains it; root asks one instance.

Eigentümer: ragents.lsp-typescript. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "properties": {
    "paths": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Files relative to the workspace root; omit for all changed files"
    },
    "root": {
      "type": "string",
      "description": "Ask only the instance of this open root"
    },
    "warnings": {
      "type": "boolean",
      "description": "Also list warnings (default: only counted)"
    }
  }
}
```

#### Ergebnis

```json
{
  "type": "string"
}
```

### typescript_eval

Evaluate TypeScript

Typecheck and execute a one-off TypeScript snippet as the calling actor, with the same context.functions API as actor programs. Supply code or a workspace path containing an async function body: await and return are supported; use await import() for Node modules. Return a JSON value; no return yields null. context.log captures output. Locals and context.state last for this execution only. Function calls can change the run and are not rolled back on later failure. Use an actor program for persistent state and future messages or events.

Eigentümer: ragents.runtime. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: conditional.

Für aktive ausführbare Actors mit einer Funktionsauswahl.

#### Eingabe

```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string",
      "minLength": 1,
      "description": "Async TypeScript function body. context is supplied; await and return work directly."
    },
    "path": {
      "type": "string",
      "minLength": 1,
      "description": "Workspace file containing the same snippet body. Use a relative path or an existing workspace alias such as @actors; generated absolute paths are not needed."
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "result",
    "logs"
  ],
  "properties": {
    "result": {},
    "logs": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "additionalProperties": false
}
```

### typescript_open

TypeScript öffnen

Start a TypeScript language server instance for this conversation's workspace and load the directory whose tsconfig.json projects should be served (e.g. src). Afterwards every edit or write of a .ts, .tsx, .mts, .cts, .js, .jsx file gets its diagnostics appended automatically, and typescript_diagnostics is available. Idempotent for the same root; other roots stay open.

Eigentümer: ragents.lsp-typescript. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "root"
  ],
  "properties": {
    "root": {
      "type": "string",
      "description": "the directory whose tsconfig.json projects should be served (e.g. src), relative to the workspace root"
    }
  }
}
```

#### Ergebnis

```json
{
  "type": "string"
}
```

### watch_create

Wächter anlegen

Beobachtet einen Actor dieses Runs und weckt einen anderen mit einer Hintergrundnachricht, sobald die als TypeScript-Funktionsrumpf formulierte Bedingung im geänderten Stand einen Grund liefert. Kein Modell: Die Bedingung wird beim Anlegen typgeprüft und danach deterministisch bei jeder Änderung des beobachteten Stands ausgeführt, sobald der beobachtete Actor zur Ruhe gekommen ist; stalledForSeconds erscheint nach stallAfterSeconds ohne Aktivität und danach je weitere Periode erneut. Ein gleicher Wächter wird nicht doppelt angelegt.

Eigentümer: ragents.watch. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: always.

In jedem Run verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "source",
    "condition"
  ],
  "properties": {
    "source": {
      "type": "string",
      "minLength": 1,
      "description": "Beobachteter Actor als @handle oder Kennung"
    },
    "condition": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4000,
      "description": "Weckbedingung als TypeScript-Funktionsrumpf von (now: WatchState, before: WatchState) => string | undefined; liefert den Weckgrund als Text oder undefined. WatchState: source { lifecycle idle|running|stopped, completedTurns, lastTurn { status, reason? }, pendingInputs, pendingActions, lastOutput? }, observed (Ergebnis der observe-Operation als Record<string, unknown>), stalledForSeconds (nur bei Stillstand). before ist der Stand bei der letzten Weckung. Beispiel: return now.source.completedTurns > before.source.completedTurns && now.observed?.phase !== \"ready\" ? \"Turn beendet, Auftrag nicht fertig\" : undefined;"
    },
    "target": {
      "type": "string",
      "minLength": 1,
      "description": "Zu weckender Actor als @handle oder Kennung; ohne Angabe der Aufrufer"
    },
    "observe": {
      "type": "string",
      "minLength": 1,
      "description": "Benannte Operation ohne Eingabe, deren Ergebnis den beobachteten Stand ergänzt und per Differenz verglichen wird"
    },
    "instruction": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2000,
      "description": "Text, der jeder Weckung angehängt wird, etwa wie der Geweckte reagieren soll"
    },
    "stallAfterSeconds": {
      "type": "integer",
      "minimum": 1,
      "description": "Sekunden ohne Ereignis des beobachteten Actors, ab denen der Stand stalledForSeconds nennt"
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "id",
    "source",
    "target",
    "condition",
    "wakes"
  ],
  "properties": {
    "id": {
      "type": "string",
      "description": "Kennung des Wächters für watch_remove"
    },
    "source": {
      "type": "string",
      "description": "Beobachteter Actor als @handle"
    },
    "target": {
      "type": "string",
      "description": "Geweckter Actor als @handle"
    },
    "condition": {
      "type": "string",
      "description": "Weckbedingung als TypeScript-Funktionsrumpf"
    },
    "observe": {
      "type": "string",
      "description": "Benannte Operation, deren Ergebnis zum beobachteten Stand gehört"
    },
    "stallAfterSeconds": {
      "type": "integer",
      "description": "Sekunden ohne Ereignis des beobachteten Actors, ab denen der Stand einen Stillstand nennt"
    },
    "wakes": {
      "type": "integer",
      "description": "Anzahl der bisherigen Weckungen"
    },
    "lastEvaluatedAt": {
      "type": "string",
      "description": "Zeitpunkt der letzten Bewertung"
    },
    "lastVerdict": {
      "type": "object",
      "required": [
        "at",
        "wake",
        "reason",
        "changes"
      ],
      "properties": {
        "at": {
          "type": "string",
          "description": "Zeitpunkt der Bewertung"
        },
        "wake": {
          "type": "boolean",
          "description": "Ob der Wächter geweckt hat"
        },
        "reason": {
          "type": "string",
          "description": "Grund, den die Bedingung geliefert hat, oder 'Bedingung nicht erfüllt'"
        },
        "changes": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Änderungen seit der letzten Weckung, die der Bewertung vorlagen"
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

### watch_list

Wächter auflisten

Listet die Wächter dieses Runs mit Bedingung, Anzahl der Weckungen und letztem Urteil.

Eigentümer: ragents.watch. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: always.

In jedem Run verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "required": [
      "id",
      "source",
      "target",
      "condition",
      "wakes"
    ],
    "properties": {
      "id": {
        "type": "string",
        "description": "Kennung des Wächters für watch_remove"
      },
      "source": {
        "type": "string",
        "description": "Beobachteter Actor als @handle"
      },
      "target": {
        "type": "string",
        "description": "Geweckter Actor als @handle"
      },
      "condition": {
        "type": "string",
        "description": "Weckbedingung als TypeScript-Funktionsrumpf"
      },
      "observe": {
        "type": "string",
        "description": "Benannte Operation, deren Ergebnis zum beobachteten Stand gehört"
      },
      "stallAfterSeconds": {
        "type": "integer",
        "description": "Sekunden ohne Ereignis des beobachteten Actors, ab denen der Stand einen Stillstand nennt"
      },
      "wakes": {
        "type": "integer",
        "description": "Anzahl der bisherigen Weckungen"
      },
      "lastEvaluatedAt": {
        "type": "string",
        "description": "Zeitpunkt der letzten Bewertung"
      },
      "lastVerdict": {
        "type": "object",
        "required": [
          "at",
          "wake",
          "reason",
          "changes"
        ],
        "properties": {
          "at": {
            "type": "string",
            "description": "Zeitpunkt der Bewertung"
          },
          "wake": {
            "type": "boolean",
            "description": "Ob der Wächter geweckt hat"
          },
          "reason": {
            "type": "string",
            "description": "Grund, den die Bedingung geliefert hat, oder 'Bedingung nicht erfüllt'"
          },
          "changes": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "Änderungen seit der letzten Weckung, die der Bewertung vorlagen"
          }
        },
        "additionalProperties": false
      }
    },
    "additionalProperties": false
  }
}
```

### watch_remove

Wächter entfernen

Entfernt einen Wächter dieses Runs; danach weckt er nicht mehr.

Eigentümer: ragents.watch. Scope: per-turn. Natives Modellwerkzeug: nein. Verfügbarkeit: always.

In jedem Run verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "id",
    "reason"
  ],
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1,
      "description": "Kennung aus watch_create oder watch_list"
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "description": "Grund der Entfernung"
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "object",
  "required": [
    "removed"
  ],
  "properties": {
    "removed": {
      "type": "boolean",
      "const": true
    }
  },
  "additionalProperties": false
}
```

### write

write

Create or overwrite files within the run's writable workspace roots.

Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.

Eigentümer: ragents.workspace. Scope: per-turn. Natives Modellwerkzeug: ja. Verfügbarkeit: always.

In jedem Modell-Turn verfügbar.

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "path",
    "content"
  ],
  "properties": {
    "path": {
      "type": "string",
      "description": "Path to the file to write (relative or absolute)"
    },
    "content": {
      "type": "string",
      "description": "Content to write to the file"
    }
  }
}
```

#### Ergebnis

```json
{
  "type": "string"
}
```

## Operationen

### actor_input

Reiht für einen Actor einen normalen Texteingang unter der gebundenen Identität ein - als Agent oder, aus einer App-Aktion, als Besitzer des Runs. Bestätigt nur das Einreihen. TypeScript-Actors verstehen ausschließlich ihr programmiertes Eingabeprotokoll, keine freien Aufträge.

Eigentümer: ragents.orchestration.

#### Bediener-Policy

```json
"direct"
```

#### Eingabe

```json
{
  "type": "object",
  "required": [
    "actor",
    "content"
  ],
  "properties": {
    "actor": {
      "type": "string",
      "minLength": 1,
      "description": "Actor ID oder Handle"
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
      },
      "uniqueItems": true
    }
  },
  "additionalProperties": false
}
```

#### Ergebnis

```json
{
  "type": "array",
  "items": {
    "anyOf": [
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.forked"
          },
          "payload": {
            "type": "object",
            "required": [
              "sourceRunId",
              "sourceSequence"
            ],
            "properties": {
              "sourceRunId": {
                "type": "string",
                "description": "ID des Quell-Runs"
              },
              "sourceSequence": {
                "type": "integer"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.primary-actor-selected"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des primären Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "run.title-changed"
          },
          "payload": {
            "type": "object",
            "required": [
              "title"
            ],
            "properties": {
              "title": {
                "type": "string",
                "description": "Neuer Titel des Runs"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "agent.spawned"
          },
          "payload": {
            "type": "object",
            "required": [
              "agentId",
              "handle",
              "displayName"
            ],
            "properties": {
              "agentId": {
                "type": "string",
                "description": "ID des neuen Agenten; actor_input und actor_stop nehmen sie oder @handle"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "script.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "scriptId",
              "handle",
              "displayName"
            ],
            "properties": {
              "scriptId": {
                "type": "string",
                "description": "ID des neuen TypeScript-Actors"
              },
              "handle": {
                "type": "string"
              },
              "displayName": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.input.enqueued"
          },
          "payload": {
            "type": "object",
            "required": [
              "inputId",
              "actorId"
            ],
            "properties": {
              "inputId": {
                "type": "string",
                "description": "ID des eingereihten Inputs"
              },
              "actorId": {
                "type": "string",
                "description": "ID des empfangenden Actors"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "inputId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des gestarteten Turns"
              },
              "inputId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.finished"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "outcome"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des beendeten Turns"
              },
              "outcome": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "turn.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "reason"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID des unterbrochenen Turns"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.output.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "model.reasoning.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "runtime.output.recorded"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "Turn, zu dem die Ausgabe gehört"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.started"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.source"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "path"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "path": {
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
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.completed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "tool.call.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId",
              "toolCallId",
              "name",
              "error"
            ],
            "properties": {
              "turnId": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string",
                "description": "ID des Werkzeugaufrufs"
              },
              "name": {
                "type": "string"
              },
              "error": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.tools.opened"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "toolNames"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "Actor, dessen Werkzeuge geöffnet wurden"
              },
              "toolNames": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.stopped"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des gestoppten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "actor.restarted"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId",
              "reason"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID des neu gestarteten Actors"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.created"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "subscriberId"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der neuen Subscription"
              },
              "subscriberId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.removed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der entfernten Subscription"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "subscription.failed"
          },
          "payload": {
            "type": "object",
            "required": [
              "subscriptionId",
              "sourceEventId",
              "reason"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID der gescheiterten Subscription"
              },
              "sourceEventId": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.proposed"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "title"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der vorgeschlagenen Aktion"
              },
              "title": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "action.resolved"
          },
          "payload": {
            "type": "object",
            "required": [
              "actionId",
              "decision"
            ],
            "properties": {
              "actionId": {
                "type": "string",
                "description": "ID der aufgelösten Aktion"
              },
              "decision": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "artifact.published"
          },
          "payload": {
            "type": "object",
            "required": [
              "artifact"
            ],
            "properties": {
              "artifact": {
                "type": "object",
                "required": [
                  "id",
                  "title",
                  "mediaType"
                ],
                "properties": {
                  "id": {
                    "type": "string",
                    "description": "ID des Artefakts; artifact_read liest es damit"
                  },
                  "title": {
                    "type": "string"
                  },
                  "mediaType": {
                    "type": "string"
                  }
                },
                "additionalProperties": false
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-replaced"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand ersetzt wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "type",
          "payload"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "plugin.state-patched"
          },
          "payload": {
            "type": "object",
            "required": [
              "pluginId"
            ],
            "properties": {
              "pluginId": {
                "type": "string",
                "description": "Plugin, dessen Zustand geändert wurde"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      }
    ]
  },
  "description": "Die Journal-Events dieses Aufrufs. Die payload nennt die Kennungen des Ergebnisses; Eingaben und Hashes wiederholt sie nicht."
}
```

## Actor-Programm-Vorlagen

### blank: Leere Mini-App

Eine reine React-View am vorhandenen Actor ohne zusätzliche Serverfunktion.

#### package.json

```json
{
  "name": "actor-view",
  "private": true,
  "type": "module",
  "ragents": {
    "title": "Meine View",
    "description": "Eine kleine Bedienoberfläche des vorhandenen Actors.",
    "views": [
      {
        "id": "main",
        "client": "src/client.tsx"
      }
    ]
  }
}
```

#### src/client.tsx

```tsx
import { createRoot } from "react-dom/client";
import * as UI from "@ragents/client/ui";

const App = () => (
  <UI.AppLayout title="Meine View">
    <UI.Stack><p>Bereit für deine Inhalte.</p></UI.Stack>
  </UI.AppLayout>
);

const root = document.getElementById("root");
if (!root) throw new Error("Das Wurzelelement #root fehlt.");
createRoot(root).render(<App />);
```

### chat: Actor-Chat

Wiederverwendbarer Chat mit Verlauf und optionaler Eingabe an den Actor dieser View.

#### package.json

```json
{
  "name": "actor-chat",
  "private": true,
  "type": "module",
  "ragents": {
    "title": "Actor-Chat",
    "description": "Zeigt das Gespräch mit einem Actor und sendet ihm Benutzereingaben.",
    "views": [
      {
        "id": "main",
        "client": "src/client.tsx",
        "width": 480,
        "height": 420
      }
    ]
  }
}
```

#### src/client.tsx

```tsx
import { createRoot } from "react-dom/client";
import * as UI from "@ragents/client/ui";
import { context } from "@ragents/client";

const App = () => (
  <UI.Chat actor={"@" + context.actor.handle} className="h-full" showInput placeholder="Nachricht an den Actor" />
);

const root = document.getElementById("root");
if (!root) throw new Error("Das Wurzelelement #root fehlt.");
createRoot(root).render(<App />);
```

### controls: UI-Controls ausprobieren

Lokale Demo mit Formular, Tabelle, Dateien, Aufgaben, Ablaufdiagramm, SVG-Verbindungen, Nachrichten, Dokument und Diff ohne Funktionsaufrufe.

#### package.json

```json
{
  "name": "controls",
  "private": true,
  "type": "module",
  "ragents": {
    "title": "UI-Controls ausprobieren",
    "description": "Eine lokale Demo der vorhandenen Mini-App-Controls. Werte und Dateien bleiben in dieser Ansicht.",
    "views": [
      {
        "id": "main",
        "client": "src/client.tsx",
        "width": 640,
        "height": 640
      }
    ]
  }
}
```

#### src/client.tsx

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import * as UI from "@ragents/client/ui";

type FormValues = Parameters<typeof UI.Form>[0]["values"];
type Row = { id: string; name: string; count: number };
const rows: Row[] = [
  { id: "analysis", name: "Analyse", count: 12 },
  { id: "review", name: "Review", count: 4 },
  { id: "notes", name: "Dokumentation", count: 8 },
];

const App = () => {
  const [values, setValues] = React.useState<FormValues>({ title: "Ergebnisse prüfen", notes: "", count: 3, mode: "review", approved: false });
  const [selected, setSelected] = React.useState<string[]>([]);
  const [files, setFiles] = React.useState<File[]>([]);
  const [result, setResult] = React.useState("Noch keine Formularwerte übernommen.");
  const [messages, setMessages] = React.useState<Parameters<typeof UI.MessageList>[0]["messages"]>([
    { key: "editorial", sender: "Redaktion", text: "Der Hinweis soll **kurz und verständlich** bleiben." },
    { key: "review", sender: "Textprüfung", text: "Öffnungszeiten und Reparaturhinweis bleiben erhalten." },
  ]);
  const [done, setDone] = React.useState(false);
  return <UI.AppLayout title="UI-Controls ausprobieren" description="Lokale Demo: keine Agenten, Uploads oder Serveraktionen. Werte und Dateiauswahl bleiben nur in dieser Ansicht und werden beim Neuladen zurückgesetzt.">
    <UI.Stack gap="large">
      <UI.Form title="Formular" fields={[
        { id: "title", label: "Auftrag", type: "text", placeholder: "Was soll bearbeitet werden?", required: true },
        { id: "notes", label: "Hinweise", type: "textarea", rows: 3, placeholder: "Was soll bei der Bearbeitung berücksichtigt werden?", hint: "Mehrzeiliger Text bleibt im Formular ausgerichtet." },
        { id: "count", label: "Anzahl", type: "number", placeholder: "Anzahl der Ergebnisse", hint: "1 bis 10 Ergebnisse.", required: true, min: 1, max: 10 },
        { id: "mode", label: "Modus", type: "select", options: [{ value: "review", label: "Prüfen" }, { value: "draft", label: "Entwerfen" }] },
        { id: "approved", label: "Auswahl bestätigt", type: "checkbox", required: true },
      ]} values={values} onChange={setValues} onSubmit={async (next) => { setResult(JSON.stringify(next, null, 2)); }} submitLabel="Werte lokal anzeigen" />
      <UI.Stack gap="small">
        <UI.DataTable<Row> title="Datentabelle" rows={rows} rowKey={(row) => row.id} filterable
          selectedKeys={selected} onSelectionChange={setSelected}
          columns={[{ id: "name", label: "Arbeit", value: (row) => row.name, sortable: true }, { id: "count", label: "Ergebnisse", value: (row) => row.count, sortable: true }]}
          actions={[{ id: "select", label: "Auswählen", onClick: (row) => { setSelected([row.id]); } }]} />
        <p aria-live="polite">{selected.length} Zeilen ausgewählt</p>
      </UI.Stack>
      <UI.FilePicker label="Lokale Dateiauswahl" files={files} onChange={setFiles} maxFiles={5} maxBytes={10 * 1024 * 1024} />
      <UI.Stack gap="small">
        <UI.TaskProgress title="Beispielaufgaben" tasks={[
          { id: "read", label: "Unterlagen lesen", status: "done" },
          { id: "review", label: "Ergebnisse prüfen", status: done ? "done" : "pending", description: "Lokaler Beispielstatus, kein laufender Actor." },
        ]} />
        <UI.Stack direction="row"><UI.Button onClick={() => setDone((current) => !current)}>Beispielstatus umschalten</UI.Button></UI.Stack>
      </UI.Stack>
      <UI.Stack gap="small">
        <h2>Ablaufdiagramm</h2>
        <p>Das Diagramm erhält seinen Zustand aus denselben Daten wie die Aufgabenliste.</p>
        <UI.FlowDiagram label={done ? "Eingang, Prüfung fertig, Ergebnis bereit" : "Eingang, Prüfung läuft, Ergebnis ausstehend"}
          nodes={[
            { id: "input", label: "Eingang", detail: "Unterlagen liegen vor", status: "done", kind: "service" },
            { id: "check", label: "Prüfung", detail: done ? "Prüfung abgeschlossen" : "Unterlagen werden geprüft", status: done ? "done" : "active", kind: "agent" },
            { id: "result", label: "Ergebnis", detail: done ? "Ergebnis bereit" : "Wartet auf die Prüfung", status: done ? "done" : "pending", kind: "actor" },
          ]}
          edges={[{ source: "input", target: "check" }, { source: "check", target: "result" }]} />
      </UI.Stack>
      <UI.Stack gap="small">
        <h2>SVG-Verbindungen</h2>
        <p>SvgEdge zeichnet die Kanten. Knoten, Beschriftungen und Positionen stehen im Code dieser Ansicht.</p>
        <svg viewBox="0 0 360 160" role="img" aria-label={done ? "Eingang fertig, Prüfung abgeschlossen, Ergebnis bereit" : "Eingang fertig, Prüfung läuft, Ergebnis offen"}
          className="block h-auto w-full text-[13px]">
          <UI.SvgEdge d="M112 42 L144 42" tone={done ? "success" : "warning"} active={!done} />
          <UI.SvgEdge d="M252 42 C320 42 320 118 252 118" arrow={done ? "end" : "none"} tone={done ? "success" : "neutral"} lineStyle={done ? "solid" : "dashed"} />
          <UI.SvgEdge d="M144 118 C64 118 64 96 64 72" arrow="both" tone="accent" />
          {[{ x: 8, y: 12, label: "Eingang", status: "Fertig" },
            { x: 148, y: 12, label: "Prüfung", status: done ? "Fertig" : "Läuft" },
            { x: 148, y: 88, label: "Ergebnis", status: done ? "Bereit" : "Offen" }].map((node) => <g key={node.label}>
              <rect x={node.x} y={node.y} width="104" height="56" rx="8" className="fill-background stroke-border-strong" />
              <text x={node.x + 52} y={node.y + 23} textAnchor="middle" className="fill-foreground font-semibold">{node.label}</text>
              <text x={node.x + 52} y={node.y + 42} textAnchor="middle" className="fill-muted-foreground text-[11px]">{node.status}</text>
            </g>)}
        </svg>
      </UI.Stack>
      <UI.Stack gap="small">
        <UI.MessageList messages={messages} label="Lokale Redaktionsnotizen" />
        <UI.Stack direction="row"><UI.Button onClick={() => setMessages((current) => [...current, {
          key: "note-" + current.length, sender: current.length % 2 ? "Textprüfung" : "Redaktion",
          text: "Lokale Beispielnotiz " + (current.length - 1) + ": Diese Nachricht wurde gerade ergänzt.",
        }])}>Lokale Nachricht ergänzen</UI.Button></UI.Stack>
      </UI.Stack>
      <UI.DocumentViewer title="Lokales Formularergebnis" format="text" content={result} />
      <UI.DiffViewer title="Beispieländerung" patch={"--- a/result.txt\n+++ b/result.txt\n@@ -1 +1 @@\n-Status: offen\n+Status: geprüft"} />
    </UI.Stack>
  </UI.AppLayout>;
};

const root = document.getElementById("root");
if (!root) throw new Error("Das Wurzelelement #root fehlt.");
createRoot(root).render(<App />);
```

### text-analysis: Textanalyse

Ein TypeScript-Actor analysiert Texte mit eigener Funktion, Zustand und React-View.

#### package.json

```json
{
  "name": "text-analysis",
  "private": true,
  "type": "module",
  "ragents": {
    "title": "Textanalyse",
    "description": "Zählt Zeichen, Wörter und Zeilen und merkt sich die Zahl der Analysen.",
    "backend": "src/server.ts",
    "views": [
      {
        "id": "main",
        "client": "src/client.tsx"
      }
    ]
  }
}
```

#### src/client.tsx

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { context, useAppState } from "@ragents/client";
import * as UI from "@ragents/client/ui";

type FormValues = Parameters<typeof UI.Form>[0]["values"];

const App = () => {
  const state = useAppState();
  const [values, setValues] = React.useState<FormValues>({ text: "" });
  const [result, setResult] = React.useState("Bereit");

  const analyse = async (next: FormValues): Promise<void> => {
    const answer = await context.capabilities.call("analyse", { text: String(next.text ?? "") });
    setResult([
      `Zeichen: ${answer.characters}`,
      `Wörter: ${answer.words}`,
      `Zeilen: ${answer.lines}`,
    ].join("\n"));
  };

  return (
    <UI.AppLayout title="Textanalyse" description={<>Analysen: {state.analyses ?? 0}</>}>
      <UI.Grid>
        <UI.Form fields={[
          { id: "text", label: "Text", type: "textarea", rows: 6, placeholder: "Text eingeben" },
        ]} values={values} onChange={setValues} onSubmit={analyse} submitLabel="Analysieren" />
        <UI.Stack><pre aria-live="polite" className="min-h-[90px] overflow-auto rounded-md border border-border bg-muted p-2.5 font-mono whitespace-pre-wrap">{result}</pre></UI.Stack>
      </UI.Grid>
    </UI.AppLayout>
  );
};

const root = document.getElementById("root");
if (!root) throw new Error("Das Wurzelelement #root fehlt.");
createRoot(root).render(<App />);
```

#### src/contract.ts

```typescript
import { Type } from "typebox";

export const contract = {
  state: Type.Object({ analyses: Type.Optional(Type.Integer({"minimum": 0})) }, {"additionalProperties": false}),
  functions: {
    analyse: {
      label: "Text analysieren",
      description: "Zählt Wörter, Zeichen und Zeilen ohne externe Wirkung.",
      tool: { name: "analyse_text" },
      input: Type.Object({ text: Type.String({"description": "Der zu analysierende Text."}) }, {"additionalProperties": false}),
      output: Type.Object({ text: Type.String(), characters: Type.Integer({"minimum": 0}), words: Type.Integer({"minimum": 0}), lines: Type.Integer({"minimum": 0}), analyses: Type.Integer({"minimum": 1}) }, {"additionalProperties": false}),
      capabilities: [],
    },
  },
} as const;
```

#### src/server.ts

```typescript
import { defineActor } from "@ragents/server";
import { contract } from "./contract.ts";

export default defineActor(contract, {
  functions: {
    analyse: async (input, context) => {
      const text = input.text.trim();
      const state = context.state.read();
      const analyses = (state.analyses ?? 0) + 1;
      context.state.replace({ analyses });

      return {
        text,
        characters: text.length,
        words: text ? text.split(/\s+/).length : 0,
        lines: text ? text.split(/\r?\n/).length : 0,
        analyses,
      };
    },
  },
});
```

#### tests/program.test.ts

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import type { Static } from "typebox";
import { createTestContext } from "@ragents/server/testing";
import { contract } from "../src/contract.ts";
import program from "../src/server.ts";

test("zählt Wörter, Zeilen und weitere Analysen", async () => {
  const context = createTestContext<Static<typeof contract.state>>({ state: {} });
  assert.deepEqual(await program.functions.analyse({"text": "  Hallo Welt\nNeue Zeile  "}, context), {"text": "Hallo Welt\nNeue Zeile", "characters": 21, "words": 4, "lines": 2, "analyses": 1});
  assert.deepEqual(await program.functions.analyse({"text": ""}, context), {"text": "", "characters": 0, "words": 0, "lines": 0, "analyses": 2});
  assert.deepEqual(context.state.read(), {"analyses": 2});
});
```

### headless-counter: Zähler ohne Oberfläche

Ein TypeScript-Actor zählt Eingaben in seinem Zustand und bietet dieselbe Arbeit als Funktion an.

#### package.json

```json
{
  "name": "headless-counter",
  "private": true,
  "type": "module",
  "ragents": {
    "title": "Zähler",
    "description": "Sammelt eingehende Texte ohne Modellaufrufe oder Oberfläche.",
    "backend": "src/server.ts"
  }
}
```

#### src/contract.ts

```typescript
import { Type } from "typebox";

const state = Type.Object({
  texts: Type.Optional(Type.Array(Type.String())),
  count: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });

export const contract = {
  state,
  functions: {
    record: {
      label: "Text zählen",
      input: Type.Object({ text: Type.String() }, { additionalProperties: false }),
      output: Type.Object({ count: Type.Integer(), texts: Type.Array(Type.String()) }, { additionalProperties: false }),
      tool: { name: "record_text" },
    },
    inspect: {
      label: "Zähler lesen",
      input: Type.Object({}, { additionalProperties: false }),
      output: state,
      tool: { name: "read_counter" },
    },
  },
  input: { capabilities: [] },
} as const;
```

#### src/server.ts

```typescript
import { defineActor } from "@ragents/server";
import type { Static } from "typebox";
import { contract } from "./contract.ts";

const record = (state: Static<typeof contract.state>, text: string) => {
  const texts = [...(state.texts ?? []), text];
  return { texts, count: texts.length };
};

export default defineActor(contract, {
  functions: {
    record: (input, context) => {
      const result = record(context.state.read(), input.text);
      context.state.replace(result);
      return result;
    },
    inspect: (_input, context) => context.state.read(),
  },
  onInput: (input, context) => {
    context.state.replace(record(context.state.read(), input.content));
  },
});
```

#### tests/program.test.ts

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import type { Static } from "typebox";
import { createTestContext } from "@ragents/server/testing";
import { contract } from "../src/contract.ts";
import program from "../src/server.ts";

test("Eingaben und Funktionen teilen denselben Zähler", async () => {
  const context = createTestContext<Static<typeof contract.state>>({ state: {} });
  for (const content of ["eins", "zwei", "drei"]) {
    await program.onInput!({ id: content, content, artifactIds: [], sourceEventIds: [], subscriptionId: null, event: null }, context);
  }
  assert.deepEqual(await program.functions.inspect({}, context), { texts: ["eins", "zwei", "drei"], count: 3 });
  assert.deepEqual(await program.functions.record({ text: "vier" }, context), { texts: ["eins", "zwei", "drei", "vier"], count: 4 });
  assert.deepEqual(context.state.read(), { texts: ["eins", "zwei", "drei", "vier"], count: 4 });
});
```

### shared-list: Gemeinsame Liste eines Actors

Ein Actor besitzt eine Funktion und eine React-View für denselben Listenstand.

#### package.json

```json
{
  "name": "shared-list",
  "private": true,
  "type": "module",
  "ragents": {
    "title": "Gemeinsame Liste",
    "description": "Sammelt Texte aus der App und aus einem Agenten-Werkzeug in einer gemeinsamen Liste.",
    "backend": "src/server.ts",
    "views": [
      {
        "id": "main",
        "client": "src/client.tsx"
      }
    ]
  }
}
```

#### src/client.tsx

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { context, useAppState } from "@ragents/client";
import * as UI from "@ragents/client/ui";

type FormValues = Parameters<typeof UI.Form>[0]["values"];

const App = () => {
  const state = useAppState();
  const [values, setValues] = React.useState<FormValues>({ text: "" });
  const [status, setStatus] = React.useState("Bereit");
  const entries = state.entries ?? [];

  const append = async (next: FormValues): Promise<void> => {
    const answer = await context.capabilities.call("append", { text: String(next.text ?? "") });
    setValues({ text: "" });
    setStatus(`Hinzugefügt: ${answer.text}`);
  };

  return (
    <UI.AppLayout title="Gemeinsame Liste" description={<>{entries.length} {entries.length === 1 ? "Eintrag" : "Einträge"}</>}>
      <UI.Grid>
        <UI.Form fields={[
          { id: "text", label: "Neuer Eintrag", type: "textarea", placeholder: "Text eingeben" },
        ]} values={values} onChange={setValues} onSubmit={append} submitLabel="Hinzufügen" />
        <UI.Stack>
          <p className="text-muted-foreground" role="status">{status}</p>
          <ul className="border-t border-border">
            {entries.map((entry, index) => <li className="min-h-[31px] border-b border-border-soft py-1.5 [overflow-wrap:anywhere]" key={index}>{entry}</li>)}
          </ul>
        </UI.Stack>
      </UI.Grid>
    </UI.AppLayout>
  );
};

const root = document.getElementById("root");
if (!root) throw new Error("Das Wurzelelement #root fehlt.");
createRoot(root).render(<App />);
```

#### src/contract.ts

```typescript
import { Type } from "typebox";

export const contract = {
  state: Type.Object({ entries: Type.Optional(Type.Array(Type.String())) }, {"additionalProperties": false}),
  functions: {
    append: {
      label: "Eintrag hinzufügen",
      description: "Hängt den eingegebenen Text an die gemeinsame Liste an.",
      input: Type.Object({ text: Type.String({"description": "Der Text für den neuen Listeneintrag."}) }, {"additionalProperties": false}),
      output: Type.Object({ text: Type.String(), entries: Type.Array(Type.String()) }, {"additionalProperties": false}),
      capabilities: [],
      tool: { name: "append_to_list", card: true },
    },
  },
} as const;
```

#### src/server.ts

```typescript
import { defineActor } from "@ragents/server";
import { contract } from "./contract.ts";

export default defineActor(contract, {
  functions: {
    append: async (input, context) => {
      const text = input.text.trim();
      const state = context.state.read();
      const entries = [...(state.entries ?? []), text];
      context.state.replace({ entries });
      return { text, entries };
    },
  },
});
```

#### tests/program.test.ts

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import type { Static } from "typebox";
import { createTestContext } from "@ragents/server/testing";
import { contract } from "../src/contract.ts";
import program from "../src/server.ts";

test("ergänzt Einträge ohne vorhandene Einträge zu verlieren", async () => {
  const context = createTestContext<Static<typeof contract.state>>({ state: {} });
  assert.deepEqual(await program.functions.append({"text": "  Erster Eintrag  "}, context), {"text": "Erster Eintrag", "entries": ["Erster Eintrag"]});
  assert.deepEqual(await program.functions.append({"text": "Zweiter Eintrag"}, context), {"text": "Zweiter Eintrag", "entries": ["Erster Eintrag", "Zweiter Eintrag"]});
  assert.deepEqual(context.state.read(), {"entries": ["Erster Eintrag", "Zweiter Eintrag"]});
});
```

## Actor-Programmpaket

actor_program_create erzeugt ein Paket unter @actors/<name>/ mit festen lokalen Abhängigkeiten. Dateiwerkzeuge und Language Server verwenden diesen Alias; Bash nutzt RAGENTS_ACTORS_DIR. Vor Modellanfragen erscheinen kurze Diagnostik-Deltas geänderter Projekte. actor_program_diagnostics liefert den letzten vollständigen Stand, actor_program_activate prüft, baut, testet und aktiviert das Paket.

```json
{
  "type": "object",
  "required": [
    "title"
  ],
  "properties": {
    "title": {
      "type": "string",
      "minLength": 1
    },
    "description": {
      "type": "string"
    },
    "backend": {
      "type": "string",
      "minLength": 1
    },
    "views": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "client"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9-]{0,63}$"
          },
          "title": {
            "type": "string",
            "minLength": 1
          },
          "client": {
            "type": "string",
            "minLength": 1
          },
          "styles": {
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

## Actor-Backendvertrag

```json
{
  "type": "object",
  "required": [
    "state",
    "functions"
  ],
  "properties": {
    "state": {
      "type": "object",
      "patternProperties": {
        "^.*$": {}
      }
    },
    "functions": {
      "type": "object",
      "patternProperties": {
        "^.*$": {
          "type": "object",
          "required": [
            "label",
            "input",
            "output"
          ],
          "properties": {
            "label": {
              "type": "string",
              "minLength": 1
            },
            "description": {
              "type": "string"
            },
            "input": {
              "type": "object",
              "patternProperties": {
                "^.*$": {}
              }
            },
            "output": {
              "type": "object",
              "patternProperties": {
                "^.*$": {}
              }
            },
            "capabilities": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "uniqueItems": true
            },
            "confirmation": {
              "type": "string"
            },
            "tool": {
              "type": "object",
              "required": [
                "name"
              ],
              "properties": {
                "name": {
                  "type": "string"
                },
                "targets": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  },
                  "minItems": 1
                },
                "card": {
                  "type": "boolean"
                }
              },
              "additionalProperties": false
            }
          },
          "additionalProperties": false
        }
      }
    },
    "input": {
      "type": "object",
      "properties": {
        "capabilities": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "uniqueItems": true
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

## Mini-App-Client

Die Client-API wird aus dem Actor-Vertrag in @ragents/client erzeugt. Die allgemeine Referenz zeigt die Struktur ohne konkrete Funktionen. Im Paket liegen die spezialisierten Typdateien für den TypeScript-Compiler und den Language Server.

### Client

```typescript
import type { ChatConnection } from "./ui";
export type AppState = Record<string, unknown>;
export type AppActions = {};
export interface AppCapabilities<Actions> {
  list(): ReadonlyArray<keyof Actions & string>;
  call<Name extends keyof Actions & string>(
    name: Name,
    input: Actions[Name] extends { readonly input: infer Input } ? Input : never,
  ): Promise<Actions[Name] extends { readonly output: infer Output } ? Output : never>;
}
export interface AppStateView<State> {
  read(): Readonly<State>;
  subscribe(listener: (state: Readonly<State>) => void): () => void;
}
export interface AppContext<State, Actions> {
  readonly ready: Promise<void>;
  readonly run: { readonly id: string };
  readonly actor: { readonly id: string; readonly handle: string };
  readonly principal: { readonly id: string; readonly kind: "operator" };
  readonly state: AppStateView<State>;
  readonly chat: ChatConnection;
  readonly capabilities: AppCapabilities<Actions>;
}
export declare const context: AppContext<AppState, AppActions>;
export declare function useAppState(): Readonly<AppState>;
```

## Typvertrag der Mini-App-UI

Einstieg: apps/web/src/actor-programs/client-ui/contracts.d.ts. Alle lokal referenzierten Typdateien folgen automatisch; Deklarationen aus Implementierungsdateien erzeugt TypeScript. Externe Standardtypen wie React und DOM gehören zu ihren Bibliotheken. Im App-Paket stehen diese Bausteine als @ragents/client/ui zum regulären Import bereit; context und useAppState werden aus @ragents/client importiert.

#### apps/server/src/chat-events.d.ts

```typescript
export type Role = "user" | "assistant" | "thinking" | "tool" | "system" | "action";
export interface ChatAttachmentInput {
    name: string;
    mediaType: string;
    data: string;
}
export interface ChatAttachment {
    name: string;
    mediaType: string;
    size: number;
    url: string;
}
export interface ChatAttachmentCapabilities {
    input: readonly string[];
    model: string;
}
export interface ToolInfo {
    id: string;
    name: string;
    arguments: string;
    result?: string;
    isError?: boolean;
}
export interface ChatTextCursor {
    conversationId: string;
    sequence: number;
    /** Accumulated non-whitespace UTF-16 units in the turn anchored by sequence. */
    offset: number;
}
export interface ChatJournalCursor {
    conversationId: string;
    eventId: string;
    sequence: number;
}
/**
 * Eine Aktion, die auf eine Eingabe des Benutzers wartet. Form und Inhalt von `payload` und
 * `result` gehören dem Plugin in `owner`; `status` gesetzt heißt: erledigt, die Karte ist Beleg.
 */
export interface PendingAction {
    actionId: string;
    owner: string | null;
    payload: unknown;
    status?: "approved" | "dismissed";
    result?: unknown;
}
export interface Message {
    key: string;
    role: Role;
    /** Absenderkennung für die Darstellung; unabhängig von Rolle und Sprechblasenlabel. */
    sender?: string;
    text: string;
    textCursor?: ChatTextCursor;
    closed?: boolean;
    attachments?: ChatAttachment[];
    tool?: ToolInfo;
    action?: PendingAction;
    /** ISO-Zeitpunkt der Nachricht; Anzeige optional (ChatMessages showTimestamps). */
    at?: string;
    /** Farbige Sprechblase statt Fliesstext, z.B. fuer Mehrparteien-Gespraeche. */
    bubble?: {
        color: string;
        side: "start" | "end";
        label?: string;
    };
}
export interface ChatStartupStatus {
    status: "preparing" | "failed";
    message: string;
}
export type ChatEvent = {
    kind: "reset";
    reason?: "conversation-reset";
    conversationId: string | null;
} | {
    kind: "replay-end";
    conversationId: string | null;
} | {
    kind: "user";
    text: string;
    at?: string;
    attachments?: ChatAttachment[];
} | {
    kind: "text";
    delta: string;
    at?: string;
    cursor: ChatTextCursor;
} | {
    kind: "thinking";
    delta: string;
    at?: string;
} | {
    kind: "tool";
    id: string;
    name: string;
    arguments: string;
    label?: string;
    at?: string;
} | {
    kind: "tool-result";
    id: string;
    result: string;
    isError?: boolean;
} | {
    kind: "action";
    actionId: string;
    owner: string | null;
    text: string;
    payload: unknown;
    at?: string;
} | {
    kind: "action-resolved";
    actionId: string;
    status: "approved" | "dismissed";
    result: unknown;
} | {
    kind: "system";
    text: string;
    at?: string;
} | {
    kind: "status";
    running: boolean;
    startup?: ChatStartupStatus;
} | {
    kind: "turn-done";
} | {
    kind: "extension";
    pluginId: string;
    type: string;
    payload?: unknown;
    at?: string;
    journal?: ChatJournalCursor;
};
/** Eingehende Nachrichten lassen den laufenden Ausgabeblock offen. */
export declare function applyEvent(messages: Message[], event: ChatEvent): Message[];
export declare function prettyJson(value: string): string;
export declare function compactToolLine(tool: ToolInfo): string;
```

#### apps/server/src/plugin-support/actor-programs/workflow/index.d.ts

```typescript
export type WorkflowStatus = "pending" | "active" | "done" | "blocked";
export interface WorkflowItem {
    label: string;
    status?: WorkflowStatus | "skipped";
    detail?: string;
}
export interface WorkflowDefinition {
    id: string;
    title: string;
    roles: Readonly<Record<string, {
        title: string;
        prompt?: string;
    }>>;
    steps: readonly {
        id: string;
        title: string;
        role: string;
        goal: string;
        prompt?: string;
        completion: {
            source: "agent" | "service" | "operator";
            description: string;
        };
        freedom: {
            mode: "fixed" | "extend";
            description: string;
            allowSkip?: boolean;
            maxItems?: number;
        };
        expansion?: {
            source: string;
            role: string;
            mode: "parallel";
            maxConcurrent: number;
        };
    }[];
    transitions: readonly {
        from: string;
        to: string;
        condition?: string;
        kind?: "return";
    }[];
}
export interface WorkflowStepState {
    status: WorkflowStatus;
    detail?: string;
    items?: readonly WorkflowItem[];
}
export interface WorkflowState {
    steps: Readonly<Record<string, WorkflowStepState>>;
    expansions?: Readonly<Record<string, readonly {
        id: string;
        title: string;
        status?: WorkflowStatus;
        detail?: string;
        items: readonly WorkflowItem[];
    }[]>>;
}
export interface WorkflowGraph {
    nodes: {
        id: string;
        label: string;
        detail?: string;
        status: WorkflowStatus;
        kind: "actor" | "agent" | "service";
        items?: readonly WorkflowItem[];
    }[];
    edges: {
        id: string;
        source: string;
        target: string;
        label?: string;
        kind?: "return";
    }[];
}
export declare function validatePromptReference(value: unknown): void;
export declare function defineWorkflow<const Definition extends WorkflowDefinition>(definition: Definition): Definition;
export declare function workflowInstructions(definition: WorkflowDefinition, role: string, readPrompt: (reference: string) => Promise<string>): Promise<string>;
export declare function workflowGraph(definition: WorkflowDefinition, state: WorkflowState): WorkflowGraph;
```

#### apps/web/src/actor-programs/client-ui/contracts.d.ts

```typescript
import type { ReactElement, ReactNode } from "react";
import type { ChatAttachment, ChatAttachmentCapabilities, ChatAttachmentInput, Message } from "../../../../server/src/chat-events";

export * from "../../ui";
export * from "./file-contracts";
export * from "./form-contracts";
export * from "./layout-contracts";
export * from "./table-contracts";
export * from "./viewer-contracts";
export * from "./message-list-contracts";
export * from "./flow-diagram-contracts";
export * from "./workflow-diagram-contracts";

export type { ChatAttachment, ChatAttachmentCapabilities, ChatAttachmentInput, Message };

export interface ChatSnapshot {
  /** Resolved sender identity of the bound actor, used as the default presentation owner. */
  owner?: string;
  readOnly?: boolean;
  attachmentCapabilities?: ChatAttachmentCapabilities;
  attachmentCapabilitiesError?: string;
  messages: Message[];
  running: boolean;
  error?: string;
}

export interface ChatConnection {
  read(actor: string): ChatSnapshot | undefined;
  subscribe(actor: string, listener: () => void): () => void;
  send(actor: string, text: string, attachments?: ChatAttachmentInput[]): Promise<void>;
}

export interface ChatMessagesProps {
  messages: Message[];
  /** Matching Message.sender renders without bubbles; null uses message defaults, actor chats default to their bound actor. */
  owner?: string | null;
  running?: boolean;
  detailMode?: "off" | "current" | "icons" | "chips" | "grouped" | "compact" | "full";
  showTimestamps?: boolean;
  emptyState?: ReactNode;
  className?: string;
}

export interface ChatInputProps {
  attachmentCapabilities?: ChatAttachmentCapabilities;
  attachmentCapabilitiesError?: string;
  onSend: (text: string, attachments?: ChatAttachmentInput[]) => void | Promise<void>;
  placeholder?: string;
  rows?: number;
  maxRows?: number;
  running?: boolean;
  disabled?: boolean;
}

interface ChatBaseProps extends Omit<ChatMessagesProps, "messages" | "running"> {
  attachmentCapabilities?: ChatAttachmentCapabilities;
  attachmentCapabilitiesError?: string;
  title?: string;
  showInput?: boolean;
  placeholder?: string;
  rows?: number;
  maxRows?: number;
}

export interface ActorChatProps extends ChatBaseProps {
  actor: string;
  messages?: never;
  onSend?: never;
  running?: never;
}

export interface ControlledChatProps extends ChatBaseProps {
  actor?: never;
  messages: Message[];
  onSend?: (text: string, attachments?: ChatAttachmentInput[]) => void | Promise<void>;
  running?: boolean;
}

export type ChatProps = ActorChatProps | ControlledChatProps;

export declare function Chat(props: ChatProps): ReactElement;
export declare function ChatMessages(props: ChatMessagesProps): ReactElement;
export declare function ChatInput(props: ChatInputProps): ReactElement;
export declare function Markdown(props: { text: string }): ReactElement;
```

#### apps/web/src/actor-programs/client-ui/file-contracts.d.ts

```typescript
import type { ReactElement } from "react";

export interface FilePickerProps {
  label: string;
  files: readonly File[];
  /** Auswahl bleibt lokal; die Ansicht entscheidet über Lesen und Übertragen. */
  onChange: (files: File[]) => void | Promise<void>;
  /** Dateiendungen oder MIME-Typen, z. B. .csv,image/*; wird auch für Drop und Paste geprüft. */
  accept?: string;
  multiple?: boolean;
  /** Höchstzahl der gesamten Auswahl; Standard 10, bei multiple=false genau eine Datei. */
  maxFiles?: number;
  /** Maximale Gesamtgröße in Bytes; Standard 20 MiB. */
  maxBytes?: number;
  disabled?: boolean;
  showPreview?: boolean;
}

export declare function FilePicker(props: FilePickerProps): ReactElement;
```

#### apps/web/src/actor-programs/client-ui/flow-diagram-contracts.d.ts

```typescript
import type { ReactElement } from "react";

export interface FlowDiagramProps {
  nodes: readonly {
    id: string;
    label: string;
    detail?: string;
    status?: "pending" | "active" | "done" | "blocked";
    running?: boolean;
    items?: readonly { label: string; status?: "pending" | "active" | "done" | "blocked" | "skipped"; detail?: string }[];
    kind?: "actor" | "agent" | "service";
    actions?: readonly { id: string; label: string; disabled?: boolean; primary?: boolean }[];
  }[];
  edges: readonly { id?: string; source: string; target: string; label?: string; kind?: "return"; status?: "pending" | "active" | "done" | "blocked" }[];
  label: string;
  /** "star" places the first node in the middle and the others around it. */
  layout?: "layered" | "star";
  direction?: "right" | "down";
  className?: string;
  height?: number;
  detailLevel?: "full" | "summary";
  /** "fit" scales the diagram into the available width and height. */
  viewport?: "interactive" | "fit-width" | "fit";
  onAction?: (nodeId: string, actionId: string) => void;
}

export declare function FlowDiagram(props: FlowDiagramProps): ReactElement;
```

#### apps/web/src/actor-programs/client-ui/form-contracts.d.ts

```typescript
import type { ReactElement } from "react";

export type FormValue = string | number | boolean | null;
export type FormValues = Readonly<Record<string, FormValue>>;
export type FormErrors = Readonly<Record<string, string>>;

interface FormFieldBase {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
}

export type FormField = FormFieldBase & (
  | { type: "text"; placeholder?: string }
  | { type: "textarea"; placeholder?: string; rows?: number }
  | { type: "number"; min?: number; max?: number; step?: number; placeholder?: string }
  | { type: "checkbox" }
  | { type: "select"; options: readonly { value: string; label: string; hint?: string }[] }
);

export interface FormProps {
  title?: string;
  fields: readonly FormField[];
  values: FormValues;
  onChange: (values: FormValues, fieldId: string) => void;
  /** Values stay controlled and are never reset after submission. */
  onSubmit?: (values: FormValues) => void | Promise<void>;
  /** Additional synchronous field errors, keyed by field ID. */
  validate?: (values: FormValues) => FormErrors | undefined;
  submitLabel?: string;
  disabled?: boolean;
  readOnly?: boolean;
}

export declare function Form(props: FormProps): ReactElement;
```

#### apps/web/src/actor-programs/client-ui/layout-contracts.d.ts

```typescript
import type { ReactElement, ReactNode } from "react";

export type LayoutGap = "small" | "normal" | "large";

export interface AppLayoutProps {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Fill a height-constrained parent; only the content scrolls, header and actions stay visible. */
  fill?: boolean;
}

export interface StackProps {
  children: ReactNode;
  gap?: LayoutGap;
  /** Rows wrap automatically when their children no longer fit. */
  direction?: "column" | "row";
}

export interface GridProps {
  children: ReactNode;
  /** Maximum columns; the available container width reduces them to two or one. */
  columns?: 2 | 3;
  gap?: LayoutGap;
}

/** App frame with shared typography, spacing, header, content and optional actions. */
export declare function AppLayout(props: AppLayoutProps): ReactElement;
/** Vertical content or a wrapping row with consistent spacing. */
export declare function Stack(props: StackProps): ReactElement;
/** Equal responsive columns based on the container width, including inside a canvas frame. */
export declare function Grid(props: GridProps): ReactElement;
```

#### apps/web/src/actor-programs/client-ui/message-list-contracts.d.ts

```typescript
import type { ReactElement, ReactNode } from "react";
import type { ChatAttachment } from "../../../../server/src/chat-events";

export interface MessageListItem {
  /** Stable key within this list. */
  key: string;
  /** Visible sender name; also determines the default bubble color. */
  sender: string;
  /** Message content as Markdown. */
  text: string;
  /** Optional ISO timestamp, shown when showTimestamps is enabled. */
  at?: string;
  attachments?: ChatAttachment[];
  /** Optional CSS color overriding the stable sender color. */
  color?: string;
  /** Bubble alignment, default start. */
  side?: "start" | "end";
}

export interface MessageListProps {
  /** Displayed in the supplied order; new props update the view. */
  messages: readonly MessageListItem[];
  /** Sender name whose messages render without bubbles; omitted or null shows all sender bubbles. */
  owner?: string | null;
  showTimestamps?: boolean;
  emptyState?: ReactNode;
  className?: string;
  /** Accessible name of the display, default Messages. */
  label?: string;
}

/** Read-only messages from named senders, with the shared chat renderer and automatic scrolling. */
export declare function MessageList(props: MessageListProps): ReactElement;
```

#### apps/web/src/actor-programs/client-ui/table-contracts.d.ts

```typescript
import type { ReactElement, ReactNode } from "react";

export type TableValue = string | number | boolean | null | undefined;
export interface TableColumn<Row> {
  id: string;
  label: string;
  /** Primitive value used for sorting, filtering and default display. */
  value: (row: Row) => TableValue;
  render?: (row: Row) => ReactNode;
  sortable?: boolean;
  /** Searched when table filtering is enabled; defaults to true. */
  filterable?: boolean;
}
export interface TableAction<Row> {
  id: string;
  label: string;
  onClick: (row: Row) => void | Promise<void>;
  disabled?: (row: Row) => boolean;
}
interface DataTableBaseProps<Row> {
  title?: string;
  rows: readonly Row[];
  columns: readonly TableColumn<Row>[];
  rowKey: (row: Row) => string;
  filterable?: boolean;
  actions?: readonly TableAction<Row>[];
  loading?: boolean;
  emptyText?: string;
}
export type DataTableProps<Row> = DataTableBaseProps<Row> & (
  | { selectedKeys: readonly string[]; onSelectionChange: (keys: string[]) => void }
  | { selectedKeys?: never; onSelectionChange?: never }
);

export declare function DataTable<Row>(props: DataTableProps<Row>): ReactElement;
```

#### apps/web/src/actor-programs/client-ui/viewer-contracts.d.ts

```typescript
import type { ReactElement } from "react";

export interface TaskItem {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error" | "skipped";
  description?: string;
}

export interface TaskProgressProps {
  title?: string;
  tasks: readonly TaskItem[];
  showProgress?: boolean;
}

export interface DocumentViewerProps {
  title?: string;
  content: string;
  format?: "text" | "markdown" | "code";
  /** Sprache für Code-Hervorhebung; alternativ bestimmt filename die Sprache. */
  language?: string;
  filename?: string;
}

export interface DiffViewerProps {
  title?: string;
  /** Bereits vorliegender Unified-Diff; das Control vergleicht keine Dateien und schreibt nichts. */
  patch: string;
  emptyText?: string;
  /** Sprache für Code-Hervorhebung; alternativ bestimmt filename oder der Pfad im Diff die Sprache. */
  language?: string;
  filename?: string;
}

export declare function TaskProgress(props: TaskProgressProps): ReactElement;
export declare function DocumentViewer(props: DocumentViewerProps): ReactElement;
export declare function DiffViewer(props: DiffViewerProps): ReactElement;
```

#### apps/web/src/actor-programs/client-ui/workflow-diagram-contracts.d.ts

```typescript
import type { ReactElement } from "react";
import type { WorkflowDefinition, WorkflowState } from "../../../../server/src/plugin-support/actor-programs/workflow/index";
import type { FlowDiagramProps } from "./flow-diagram-contracts";

export interface WorkflowDiagramProps extends Omit<FlowDiagramProps, "nodes" | "edges"> {
  definition: WorkflowDefinition;
  state: WorkflowState;
}

export declare function WorkflowDiagram(props: WorkflowDiagramProps): ReactElement;
```

#### apps/web/src/ui/alert.d.ts

```typescript
import * as React from "react";
import { type VariantProps } from "class-variance-authority";
declare const alertVariants: (props?: ({
    variant?: "default" | "destructive" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
declare function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>): React.JSX.Element;
declare function AlertTitle({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function AlertDescription({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function AlertAction({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
export { Alert, AlertTitle, AlertDescription, AlertAction };
```

#### apps/web/src/ui/badge.d.ts

```typescript
import { useRender } from "@base-ui/react/use-render";
import { type VariantProps } from "class-variance-authority";
declare const badgeVariants: (props?: ({
    variant?: "default" | "destructive" | "link" | "secondary" | "outline" | "ghost" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
declare function Badge({ className, variant, render, ...props }: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>): import("react").ReactElement<unknown, string | import("react").JSXElementConstructor<any>>;
export { Badge, badgeVariants };
```

#### apps/web/src/ui/button.d.ts

```typescript
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { type VariantProps } from "class-variance-authority";
declare const buttonVariants: (props?: ({
    variant?: "default" | "destructive" | "link" | "secondary" | "outline" | "ghost" | null | undefined;
    size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
declare function Button({ className, variant, size, ...props }: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>): import("react").JSX.Element;
export { Button, buttonVariants };
```

#### apps/web/src/ui/card.d.ts

```typescript
import * as React from "react";
declare function Card({ className, size, ...props }: React.ComponentProps<"div"> & {
    size?: "default" | "sm";
}): React.JSX.Element;
declare function CardHeader({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function CardTitle({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function CardDescription({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function CardAction({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function CardContent({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function CardFooter({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent, };
```

#### apps/web/src/ui/checkbox.d.ts

```typescript
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
declare function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props): import("react").JSX.Element;
export { Checkbox };
```

#### apps/web/src/ui/dialog.d.ts

```typescript
import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
export type ModalScope = "page" | "run" | "workspace" | "canvas";
export type DialogSize = "small" | "medium" | "large" | "wide" | "full";
export declare const RunModalContext: React.Context<HTMLElement | null>;
export declare const WorkspaceModalContext: React.Context<HTMLElement | null>;
export declare const CanvasModalContext: React.Context<HTMLElement | null>;
export declare function useModalContainer(scope: ModalScope): HTMLElement | null;
declare function Dialog({ ...props }: DialogPrimitive.Root.Props): React.JSX.Element;
declare function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props): React.JSX.Element;
declare function DialogPortal({ ...props }: DialogPrimitive.Portal.Props): React.JSX.Element;
declare function DialogClose({ ...props }: DialogPrimitive.Close.Props): React.JSX.Element;
declare function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props): React.JSX.Element;
export interface DialogContentProps extends DialogPrimitive.Popup.Props {
    scope?: ModalScope;
    size?: DialogSize;
    showCloseButton?: boolean;
    onBackdropClick?: () => void;
    overlayClassName?: string;
    keepMounted?: boolean;
    /** With keepMounted the closed dialog stays in the DOM; this keeps the container's siblings usable meanwhile. */
    open?: boolean;
}
declare function DialogContent({ className, children, scope, size, showCloseButton, onBackdropClick, overlayClassName, keepMounted, open, ref, ...props }: DialogContentProps): React.JSX.Element;
declare function DialogHeader({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function DialogBody({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function DialogFooter({ className, showCloseButton, children, ...props }: React.ComponentProps<"div"> & {
    showCloseButton?: boolean;
}): React.JSX.Element;
declare function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props): React.JSX.Element;
declare function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props): React.JSX.Element;
export { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger, };
```

#### apps/web/src/ui/dropdown-menu.d.ts

```typescript
import * as React from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
declare function DropdownMenu({ ...props }: MenuPrimitive.Root.Props): React.JSX.Element;
declare function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props): React.JSX.Element;
declare function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props): React.JSX.Element;
declare function DropdownMenuContent({ align, alignOffset, side, sideOffset, className, ...props }: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">): React.JSX.Element;
declare function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props): React.JSX.Element;
declare function DropdownMenuLabel({ className, inset, ...props }: MenuPrimitive.GroupLabel.Props & {
    inset?: boolean;
}): React.JSX.Element;
declare function DropdownMenuItem({ className, inset, variant, ...props }: MenuPrimitive.Item.Props & {
    inset?: boolean;
    variant?: "default" | "destructive";
}): React.JSX.Element;
declare function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props): React.JSX.Element;
declare function DropdownMenuSubTrigger({ className, inset, children, ...props }: MenuPrimitive.SubmenuTrigger.Props & {
    inset?: boolean;
}): React.JSX.Element;
declare function DropdownMenuSubContent({ align, alignOffset, side, sideOffset, className, ...props }: React.ComponentProps<typeof DropdownMenuContent>): React.JSX.Element;
declare function DropdownMenuCheckboxItem({ className, children, checked, inset, ...props }: MenuPrimitive.CheckboxItem.Props & {
    inset?: boolean;
}): React.JSX.Element;
declare function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props): React.JSX.Element;
declare function DropdownMenuRadioItem({ className, children, inset, ...props }: MenuPrimitive.RadioItem.Props & {
    inset?: boolean;
}): React.JSX.Element;
declare function DropdownMenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props): React.JSX.Element;
declare function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<"span">): React.JSX.Element;
export { DropdownMenu, DropdownMenuPortal, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, };
```

#### apps/web/src/ui/empty.d.ts

```typescript
import { type VariantProps } from "class-variance-authority";
declare function Empty({ className, ...props }: React.ComponentProps<"div">): import("react").JSX.Element;
declare function EmptyHeader({ className, ...props }: React.ComponentProps<"div">): import("react").JSX.Element;
declare const emptyMediaVariants: (props?: ({
    variant?: "default" | "icon" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
declare function EmptyMedia({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>): import("react").JSX.Element;
declare function EmptyTitle({ className, ...props }: React.ComponentProps<"div">): import("react").JSX.Element;
declare function EmptyDescription({ className, ...props }: React.ComponentProps<"p">): import("react").JSX.Element;
declare function EmptyContent({ className, ...props }: React.ComponentProps<"div">): import("react").JSX.Element;
export { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia, };
```

#### apps/web/src/ui/field.d.ts

```typescript
import { type VariantProps } from "class-variance-authority";
import { Label } from "./label";
declare function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">): import("react").JSX.Element;
declare function FieldLegend({ className, variant, ...props }: React.ComponentProps<"legend"> & {
    variant?: "legend" | "label";
}): import("react").JSX.Element;
declare function FieldGroup({ className, ...props }: React.ComponentProps<"div">): import("react").JSX.Element;
declare const fieldVariants: (props?: ({
    orientation?: "horizontal" | "vertical" | "responsive" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
declare function Field({ className, orientation, ...props }: React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>): import("react").JSX.Element;
declare function FieldContent({ className, ...props }: React.ComponentProps<"div">): import("react").JSX.Element;
declare function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>): import("react").JSX.Element;
declare function FieldTitle({ className, ...props }: React.ComponentProps<"div">): import("react").JSX.Element;
declare function FieldDescription({ className, ...props }: React.ComponentProps<"p">): import("react").JSX.Element;
declare function FieldSeparator({ children, className, ...props }: React.ComponentProps<"div"> & {
    children?: React.ReactNode;
}): import("react").JSX.Element;
declare function FieldError({ className, children, errors, ...props }: React.ComponentProps<"div"> & {
    errors?: Array<{
        message?: string;
    } | undefined>;
}): import("react").JSX.Element | null;
export { Field, FieldLabel, FieldDescription, FieldError, FieldGroup, FieldLegend, FieldSeparator, FieldSet, FieldContent, FieldTitle, };
```

#### apps/web/src/ui/index.d.ts

```typescript
export { cn } from "cn";
export { Alert, AlertAction, AlertDescription, AlertTitle } from "./alert";
export { Badge, badgeVariants } from "./badge";
export { Button, buttonVariants } from "./button";
export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";
export { Checkbox } from "./checkbox";
export { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger, type DialogContentProps, type DialogSize, type ModalScope, } from "./dialog";
export { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, } from "./dropdown-menu";
export { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./empty";
export { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet, FieldTitle, } from "./field";
export { Input } from "./input";
export { Label } from "./label";
export { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "./popover";
export { Progress, ProgressIndicator, ProgressLabel, ProgressTrack, ProgressValue } from "./progress";
export { RadioGroup, RadioGroupItem } from "./radio-group";
export { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger, SelectValue, } from "./select";
export { Separator } from "./separator";
export { Skeleton } from "./skeleton";
export { Spinner } from "./spinner";
export { Switch } from "./switch";
export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "./table";
export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants } from "./tabs";
export { Textarea } from "./textarea";
export { Toggle, toggleVariants } from "./toggle";
export { ToggleGroup, ToggleGroupItem } from "./toggle-group";
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";
export { ListDetail, type ListDetailItem, type ListDetailProps } from "./ListDetail";
export { longTime, shortTime } from "./relative-time";
export { SectionLabel } from "./SectionLabel";
export { StartupNotice, type StartupNoticeState } from "./startup-notice";
export { EnvironmentStateIcon, environmentStateTone, RunStateIcon, runStateTone } from "./state-icon";
export { StopButton, StopGlyph } from "./stop-button";
export { environmentStateWord, runStateWord, type EnvironmentStateName, type RunStateName } from "./state-vocabulary";
export { SvgEdge, type SvgEdgeProps } from "./SvgEdge";
export { useFileInput } from "./useFileInput";
```

#### apps/web/src/ui/input.d.ts

```typescript
import * as React from "react";
declare function Input({ className, type, ...props }: React.ComponentProps<"input">): React.JSX.Element;
export { Input };
```

#### apps/web/src/ui/label.d.ts

```typescript
import * as React from "react";
declare function Label({ className, ...props }: React.ComponentProps<"label">): React.JSX.Element;
export { Label };
```

#### apps/web/src/ui/ListDetail.d.ts

```typescript
import { type ReactNode } from "react";
export interface ListDetailItem {
    id: string;
    title: string;
    description?: string;
    group?: string;
    icon?: ReactNode;
    meta?: ReactNode;
    tone?: "neutral" | "accent" | "success" | "purple";
}
export interface ListDetailProps {
    label: string;
    items: readonly ListDetailItem[];
    selectedId?: string;
    onSelect: (id: string) => void;
    disabled?: boolean;
    toolbar?: ReactNode;
    detailHeader?: ReactNode;
    children?: ReactNode;
    detailFooter?: ReactNode;
    emptyState?: ReactNode;
    detailLabel?: string;
    className?: string;
}
/** Controlled grouped selection with a detail surface and a return path on narrow surfaces. */
export declare function ListDetail({ label, items, selectedId, onSelect, disabled, toolbar, detailHeader, children, detailFooter, emptyState, detailLabel, className }: ListDetailProps): import("react").JSX.Element;
```

#### apps/web/src/ui/popover.d.ts

```typescript
import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
declare function Popover({ ...props }: PopoverPrimitive.Root.Props): React.JSX.Element;
declare function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props): React.JSX.Element;
declare function PopoverContent({ className, align, alignOffset, side, sideOffset, anchor, collisionPadding, keepMounted, dim, ...props }: PopoverPrimitive.Popup.Props & Pick<PopoverPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset" | "anchor" | "collisionPadding"> & Pick<PopoverPrimitive.Portal.Props, "keepMounted"> & {
    /** Dunkelt den Rest der Seite ab, damit sich das Pop-out absetzt; Klick daneben schließt es. */
    dim?: boolean;
}): React.JSX.Element;
declare function PopoverHeader({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props): React.JSX.Element;
declare function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props): React.JSX.Element;
export { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger, };
```

#### apps/web/src/ui/progress.d.ts

```typescript
import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
declare function Progress({ className, children, value, ...props }: ProgressPrimitive.Root.Props): import("react").JSX.Element;
declare function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props): import("react").JSX.Element;
declare function ProgressIndicator({ className, ...props }: ProgressPrimitive.Indicator.Props): import("react").JSX.Element;
declare function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props): import("react").JSX.Element;
declare function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props): import("react").JSX.Element;
export { Progress, ProgressTrack, ProgressIndicator, ProgressLabel, ProgressValue, };
```

#### apps/web/src/ui/radio-group.d.ts

```typescript
import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
declare function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props): import("react").JSX.Element;
declare function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props): import("react").JSX.Element;
export { RadioGroup, RadioGroupItem };
```

#### apps/web/src/ui/relative-time.d.ts

```typescript
/** Die Zeit in der Liste: jetzt, 5 min, 3 h, 2 d, ab sieben Tagen das Datum. Ohne "vor", ohne Sonderfall für gestern. */
export declare const shortTime: (at: number, now?: number) => string;
/** Dieselbe Zeit ausgeschrieben; sie steht nur im title der kompakten Zeit. */
export declare const longTime: (at: number, now?: number) => string;
```

#### apps/web/src/ui/SectionLabel.d.ts

```typescript
import type { ComponentProps } from "react";
/** The small uppercase group label above a section; extra content is pushed to the opposite end. */
export declare function SectionLabel({ className, ...props }: ComponentProps<"div">): import("react").JSX.Element;
```

#### apps/web/src/ui/select.d.ts

```typescript
import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
declare const Select: typeof SelectPrimitive.Root;
declare function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props): React.JSX.Element;
declare function SelectValue({ className, ...props }: SelectPrimitive.Value.Props): React.JSX.Element;
declare function SelectTrigger({ className, size, children, ...props }: SelectPrimitive.Trigger.Props & {
    size?: "sm" | "default";
}): React.JSX.Element;
declare function SelectContent({ className, children, side, sideOffset, align, alignOffset, alignItemWithTrigger, ...props }: SelectPrimitive.Popup.Props & Pick<SelectPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger">): React.JSX.Element;
declare function SelectLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props): React.JSX.Element;
declare function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props): React.JSX.Element;
declare function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props): React.JSX.Element;
declare function SelectScrollUpButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>): React.JSX.Element;
declare function SelectScrollDownButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>): React.JSX.Element;
export { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger, SelectValue, };
```

#### apps/web/src/ui/separator.d.ts

```typescript
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
declare function Separator({ className, orientation, ...props }: SeparatorPrimitive.Props): import("react").JSX.Element;
export { Separator };
```

#### apps/web/src/ui/skeleton.d.ts

```typescript
declare function Skeleton({ className, ...props }: React.ComponentProps<"div">): import("react").JSX.Element;
export { Skeleton };
```

#### apps/web/src/ui/spinner.d.ts

```typescript
declare function Spinner({ className, ...props }: React.ComponentProps<"svg">): import("react").JSX.Element;
export { Spinner };
```

#### apps/web/src/ui/startup-notice.d.ts

```typescript
import type { ReactNode } from "react";
/** Was eine Fläche zeigt, solange sie noch keinen Inhalt hat: laufende Arbeit, einen Fehler oder einen ruhigen Hinweis. */
export interface StartupNoticeState {
    kind: "working" | "error" | "waiting" | "stopped";
    title: string;
    detail: string;
}
/** Der eine Ladezustand für Kachelfläche, Run-Panel und dessen Start: Titel, bei laufender Arbeit ein Fortschrittsbalken, darunter was gerade geschieht. */
export declare function StartupNotice({ children, className, state }: {
    children?: ReactNode;
    className?: string;
    state: StartupNoticeState;
}): import("react").JSX.Element;
```

#### apps/web/src/ui/state-icon.d.ts

```typescript
import { type EnvironmentStateName, type RunStateName } from "./state-vocabulary";
export declare const runStateTone: (state: RunStateName) => string;
export declare const environmentStateTone: (state: EnvironmentStateName) => string;
export declare function RunStateIcon({ state, open, className }: {
    state: RunStateName;
    open?: number;
    className?: string;
}): import("react").JSX.Element;
export declare function EnvironmentStateIcon({ state, className }: {
    state: EnvironmentStateName;
    className?: string;
}): import("react").JSX.Element;
```

#### apps/web/src/ui/state-vocabulary.d.ts

```typescript
/** Das Vokabular aller Seiten: je Zustand genau ein Wort, das im Panel nur als title erscheint. */
export type RunStateName = "running" | "waiting" | "idle" | "ended" | "failed" | "cancelled";
export type EnvironmentStateName = "connected" | "ready" | "starting" | "login-required" | "unreachable" | "stopped" | "failed" | "forbidden";
/** Wartet ein Run, nennt das Wort die Zahl offener Eingaben; ein Werkzeugname steht nie im Zustand. */
export declare const runStateWord: (state: RunStateName, open?: number) => string;
export declare const environmentStateWord: (state: EnvironmentStateName) => string;
```

#### apps/web/src/ui/stop-button.d.ts

```typescript
import { SquareIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "./button";
/** Die eine Stopp-Glyphe: ein gefülltes rotes Quadrat; ein Zustandssymbol trägt sie nie. */
export declare function StopGlyph({ className, ...props }: Omit<ComponentProps<typeof SquareIcon>, "fill">): import("react").JSX.Element;
/** Jeder Stopp-Knopf sieht gleich aus: die Glyphe als Symbol, das Wort im Tooltip, rot in Ruhe und beim Hover. */
export declare function StopButton({ label, busy, className, title, ...props }: Omit<ComponentProps<typeof Button>, "children" | "variant"> & {
    label: string;
    busy?: boolean;
}): import("react").JSX.Element;
```

#### apps/web/src/ui/SvgEdge.d.ts

```typescript
export interface SvgEdgeProps {
    /** Native SVG path; the caller owns endpoints, curves and layout. */
    d: string;
    /** Arrowheads follow the path direction. Default: end. */
    arrow?: "none" | "end" | "both";
    lineStyle?: "solid" | "dashed";
    tone?: "neutral" | "accent" | "success" | "warning" | "danger";
    /** Moving dashes show work in progress; reduced-motion preferences stop movement. */
    active?: boolean;
}
/** A styled connection inside the caller's SVG; nodes, labels and accessible descriptions remain caller-owned. */
export declare function SvgEdge({ d, arrow, lineStyle, tone, active }: SvgEdgeProps): import("react").JSX.Element;
```

#### apps/web/src/ui/switch.d.ts

```typescript
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
declare function Switch({ className, size, ...props }: SwitchPrimitive.Root.Props & {
    size?: "sm" | "default";
}): import("react").JSX.Element;
export { Switch };
```

#### apps/web/src/ui/table.d.ts

```typescript
import * as React from "react";
declare function Table({ className, ...props }: React.ComponentProps<"table">): React.JSX.Element;
declare function TableHeader({ className, ...props }: React.ComponentProps<"thead">): React.JSX.Element;
declare function TableBody({ className, ...props }: React.ComponentProps<"tbody">): React.JSX.Element;
declare function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">): React.JSX.Element;
declare function TableRow({ className, ...props }: React.ComponentProps<"tr">): React.JSX.Element;
declare function TableHead({ className, ...props }: React.ComponentProps<"th">): React.JSX.Element;
declare function TableCell({ className, ...props }: React.ComponentProps<"td">): React.JSX.Element;
declare function TableCaption({ className, ...props }: React.ComponentProps<"caption">): React.JSX.Element;
export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption, };
```

#### apps/web/src/ui/tabs.d.ts

```typescript
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { type VariantProps } from "class-variance-authority";
declare function Tabs({ className, orientation, ...props }: TabsPrimitive.Root.Props): import("react").JSX.Element;
declare const tabsListVariants: (props?: ({
    variant?: "default" | "line" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
declare function TabsList({ className, variant, ...props }: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>): import("react").JSX.Element;
declare function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props): import("react").JSX.Element;
declare function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props): import("react").JSX.Element;
export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
```

#### apps/web/src/ui/textarea.d.ts

```typescript
import * as React from "react";
declare function Textarea({ className, ...props }: React.ComponentProps<"textarea">): React.JSX.Element;
export { Textarea };
```

#### apps/web/src/ui/toggle-group.d.ts

```typescript
import * as React from "react";
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { type VariantProps } from "class-variance-authority";
import { toggleVariants } from "./toggle";
declare function ToggleGroup({ className, variant, size, spacing, orientation, children, ...props }: ToggleGroupPrimitive.Props & VariantProps<typeof toggleVariants> & {
    spacing?: number;
    orientation?: "horizontal" | "vertical";
}): React.JSX.Element;
declare function ToggleGroupItem({ className, children, variant, size, ...props }: TogglePrimitive.Props & VariantProps<typeof toggleVariants>): React.JSX.Element;
export { ToggleGroup, ToggleGroupItem };
```

#### apps/web/src/ui/toggle.d.ts

```typescript
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { type VariantProps } from "class-variance-authority";
declare const toggleVariants: (props?: ({
    variant?: "default" | "outline" | null | undefined;
    size?: "default" | "sm" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
declare function Toggle({ className, variant, size, ...props }: TogglePrimitive.Props & VariantProps<typeof toggleVariants>): import("react").JSX.Element;
export { Toggle, toggleVariants };
```

#### apps/web/src/ui/tooltip.d.ts

```typescript
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
declare function TooltipProvider({ delay, ...props }: TooltipPrimitive.Provider.Props): import("react").JSX.Element;
declare function Tooltip({ ...props }: TooltipPrimitive.Root.Props): import("react").JSX.Element;
declare function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props): import("react").JSX.Element;
declare function TooltipContent({ className, side, sideOffset, align, alignOffset, children, ...props }: TooltipPrimitive.Popup.Props & Pick<TooltipPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">): import("react").JSX.Element;
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
```

#### apps/web/src/ui/useFileInput.d.ts

```typescript
import { type ChangeEvent, type ClipboardEvent, type DragEvent } from "react";
export declare function useFileInput({ disabled, onFiles, onPasteText }: {
    disabled?: boolean;
    onFiles: (files: File[]) => void | Promise<void>;
    onPasteText?: (text: string) => void;
}): {
    inputRef: import("react").RefObject<HTMLInputElement | null>;
    dragging: boolean;
    clearDragging: () => void;
    inputProps: {
        ref: import("react").RefObject<HTMLInputElement | null>;
        onChange: (event: ChangeEvent<HTMLInputElement>) => void;
    };
    dropProps: {
        onDragOver: (event: DragEvent<HTMLElement>) => void;
        onDragLeave: (event: DragEvent<HTMLElement>) => void;
        onDrop: (event: DragEvent<HTMLElement>) => void;
        onPaste: (event: ClipboardEvent<HTMLElement>) => void;
    };
};
```

## Examples by task and concept

The bundled examples demonstrate how RAgents concepts work together and provide starting points for end-to-end tests. Use cases show concrete tasks; concept demos make individual capabilities observable. Links lead to prepared tasks or step-by-step walkthroughs. This overview is not evidence of completed model runs.

### Use case

[Zeichen, Wörter und Zeilen zählen](#start-ragents.reference.80-actor-text-analysis), [Eine Liste durch vier KI-Helfer reichen](#start-ragents.reference.20-circle-of-four), [Entscheidung klären](#start-ragents.reference.decision-brief), [Lernziel in Etappen](#start-ragents.reference.learning-sprint), [Nachrichten ohne KI mitzählen](#start-ragents.reference.70-headless-counter), [Notizen ausblenden und wiederfinden](#start-ragents.reference.90-actor-notes), [Eine Liste im Chat und im Fenster pflegen](#start-ragents.reference.100-shared-actor-list), [Sammelboard einrichten](#start-ragents.reference.shared-actor-list), [Gesprächsrunde einrichten](#start-ragents.reference.conversation-circle), [Moderierte Runde ohne Koordinator](#start-ragents.reference.moderated-round), [Balkon-Wizard einrichten](#start-ragents.reference.balcony-wizard), [Redaktionswerkstatt](#start-ragents.reference.150-editorial-workbench), [Lernnachmittag](#start-ragents.reference.learning-afternoon), [Wortspiel starten](#start-ragents.reference.word-game), [Lernbegleitung mit Unterlagen](#start-ragents.reference.160-learning-companion), [Bildsammlung mit Beschriftungen](#start-ragents.reference.170-photo-collection), [Entscheidungswerkstatt](#start-ragents.reference.180-decision-workbench), [Texte prüfen und Ergebnisse gezielt teilen](#start-ragents.reference.190-review-queue), [Fehler in einer Terminliste finden](#start-ragents.reference.200-typescript-diagnostics), [Gespräch an einen Moderator übergeben](#start-ragents.reference.210-moderator-handover), [Vorschläge gemeinsam freigeben](#start-ragents.reference.220-actor-approval-list), [Eine Liste in zwei Ansichten](#start-ragents.reference.230-shared-state-views), [Antworten automatisch sammeln](#start-ragents.reference.240-live-result-list), [Balkon-Wizard](#start-ragents.reference.250-balcony-wizard), [Den Helfer hinter einer Mini-App öffnen](#example-mini-app-owner-inspector), [Eine Gesprächsrunde anders aufteilen](#example-personal-tile-arrangement), [Zwei Unterhaltungen im Blick behalten](#example-global-run-overview), [Eine vorbereitete Runde global starten](#example-global-prepared-run), [Nach einer Planung neu beginnen](#example-reset-completed-global-chat), [Einen Reset zunächst abbrechen](#example-reset-without-losing-draft), [Den Koordinator für kurze Antworten einstellen](#example-coordinator-model-settings), [Das Modell für kurze Überschriften wählen](#example-title-model-selection), [Automatische Überschriften ausschalten](#example-disable-generated-titles), [Eine Fähigkeit ihrer Extension zuordnen](#example-extension-capability-settings), [Den Sprachserver als Run-Prozess sehen](#example-language-server-process), [Eine kurzlebige lokale Vorschau öffnen](#example-local-preview-process), [Einen Entwurf im Dateibaum lesen](#example-workspace-draft-preview), [Gleichnamige Dateien in zwei Runs vergleichen](#example-separate-run-files), [Eine gemeinsame Liste nach Neustart wiederfinden](#example-restore-shared-list), [Zwei Gesprächsverläufe nach Neustart fortsetzen](#example-restore-conversation-context), [Eine eigene Skizze im Chat besprechen](#example-image-paste-conversation), [Einen kurzen Clip mit seinem Ablaufplan vergleichen](#example-video-and-document-drop)

### Concept demo

[Hallo Welt auf der Arbeitsfläche](#start-ragents.reference.95-hello-world), [Zeichen, Wörter und Zeilen zählen](#start-ragents.reference.80-actor-text-analysis), [Eine Liste durch vier KI-Helfer reichen](#start-ragents.reference.20-circle-of-four), [Entscheidung klären](#start-ragents.reference.decision-brief), [Eine Nachricht überbringen lassen](#start-ragents.reference.30-llm-without-runtime-knowledge), [Lernziel in Etappen](#start-ragents.reference.learning-sprint), [Drei Aufträge der Reihe nach erledigen](#start-ragents.reference.35-actor-input-fifo), [Gezielt bei anderen Helfern mithören](#start-ragents.reference.40-subscription-matrix), [Eine Weiterleitung wieder abschalten](#start-ragents.reference.50-subscription-removal), [Einen Helfer in der Gesprächsrunde stoppen](#start-ragents.reference.60-stop-in-the-circle), [Eine Notiz gezielt weitergeben](#start-ragents.reference.65-artifact-least-privilege), [Nachrichten ohne KI mitzählen](#start-ragents.reference.70-headless-counter), [Fehler in C# und TypeScript finden](#start-ragents.reference.75-lsp-demo), [Notizen ausblenden und wiederfinden](#start-ragents.reference.90-actor-notes), [Eine Liste im Chat und im Fenster pflegen](#start-ragents.reference.100-shared-actor-list), [Sammelboard einrichten](#start-ragents.reference.shared-actor-list), [Rückfrage, Aufgaben und Dokument zusammen sehen](#start-ragents.reference.110-all-card-slots), [Gesprächsrunde einrichten](#start-ragents.reference.conversation-circle), [Moderierte Runde ohne Koordinator](#start-ragents.reference.moderated-round), [Balkon-Wizard einrichten](#start-ragents.reference.balcony-wizard), [Redaktionswerkstatt](#start-ragents.reference.150-editorial-workbench), [Lernnachmittag](#start-ragents.reference.learning-afternoon), [Wortspiel starten](#start-ragents.reference.word-game), [Lernbegleitung mit Unterlagen](#start-ragents.reference.160-learning-companion), [Bildsammlung mit Beschriftungen](#start-ragents.reference.170-photo-collection), [Entscheidungswerkstatt](#start-ragents.reference.180-decision-workbench), [Texte prüfen und Ergebnisse gezielt teilen](#start-ragents.reference.190-review-queue), [Fehler in einer Terminliste finden](#start-ragents.reference.200-typescript-diagnostics), [Gespräch an einen Moderator übergeben](#start-ragents.reference.210-moderator-handover), [Vorschläge gemeinsam freigeben](#start-ragents.reference.220-actor-approval-list), [Eine Liste in zwei Ansichten](#start-ragents.reference.230-shared-state-views), [Antworten automatisch sammeln](#start-ragents.reference.240-live-result-list), [Balkon-Wizard](#start-ragents.reference.250-balcony-wizard), [Den Helfer hinter einer Mini-App öffnen](#example-mini-app-owner-inspector), [Eine Gesprächsrunde anders aufteilen](#example-personal-tile-arrangement), [Zwei Unterhaltungen im Blick behalten](#example-global-run-overview), [Eine vorbereitete Runde global starten](#example-global-prepared-run), [Nach einer Planung neu beginnen](#example-reset-completed-global-chat), [Einen Reset zunächst abbrechen](#example-reset-without-losing-draft), [Den Koordinator für kurze Antworten einstellen](#example-coordinator-model-settings), [Das Modell für kurze Überschriften wählen](#example-title-model-selection), [Automatische Überschriften ausschalten](#example-disable-generated-titles), [Eine Fähigkeit ihrer Extension zuordnen](#example-extension-capability-settings), [Den Sprachserver als Run-Prozess sehen](#example-language-server-process), [Eine kurzlebige lokale Vorschau öffnen](#example-local-preview-process), [Einen Entwurf im Dateibaum lesen](#example-workspace-draft-preview), [Gleichnamige Dateien in zwei Runs vergleichen](#example-separate-run-files), [Eine gemeinsame Liste nach Neustart wiederfinden](#example-restore-shared-list), [Zwei Gesprächsverläufe nach Neustart fortsetzen](#example-restore-conversation-context), [Eine eigene Skizze im Chat besprechen](#example-image-paste-conversation), [Einen kurzen Clip mit seinem Ablaufplan vergleichen](#example-video-and-document-drop)

| Concept | Examples |
| --- | --- |
| Agent teams | [Eine Liste durch vier KI-Helfer reichen](#start-ragents.reference.20-circle-of-four), [Eine Nachricht überbringen lassen](#start-ragents.reference.30-llm-without-runtime-knowledge), [Lernbegleitung mit Unterlagen](#start-ragents.reference.160-learning-companion), [Bildsammlung mit Beschriftungen](#start-ragents.reference.170-photo-collection), [Texte prüfen und Ergebnisse gezielt teilen](#start-ragents.reference.190-review-queue), [Gespräch an einen Moderator übergeben](#start-ragents.reference.210-moderator-handover), [Vorschläge gemeinsam freigeben](#start-ragents.reference.220-actor-approval-list) |
| TypeScript actors | [Zeichen, Wörter und Zeilen zählen](#start-ragents.reference.80-actor-text-analysis), [Eine Liste durch vier KI-Helfer reichen](#start-ragents.reference.20-circle-of-four), [Nachrichten ohne KI mitzählen](#start-ragents.reference.70-headless-counter), [Notizen ausblenden und wiederfinden](#start-ragents.reference.90-actor-notes), [Eine Liste im Chat und im Fenster pflegen](#start-ragents.reference.100-shared-actor-list), [Entscheidungswerkstatt](#start-ragents.reference.180-decision-workbench), [Antworten automatisch sammeln](#start-ragents.reference.240-live-result-list) |
| Subscriptions | [Eine Liste durch vier KI-Helfer reichen](#start-ragents.reference.20-circle-of-four), [Eine Nachricht überbringen lassen](#start-ragents.reference.30-llm-without-runtime-knowledge), [Gezielt bei anderen Helfern mithören](#start-ragents.reference.40-subscription-matrix), [Eine Weiterleitung wieder abschalten](#start-ragents.reference.50-subscription-removal), [Antworten automatisch sammeln](#start-ragents.reference.240-live-result-list) |
| Input queue | [Drei Aufträge der Reihe nach erledigen](#start-ragents.reference.35-actor-input-fifo), [Texte prüfen und Ergebnisse gezielt teilen](#start-ragents.reference.190-review-queue) |
| Stopping actors | [Eine Nachricht überbringen lassen](#start-ragents.reference.30-llm-without-runtime-knowledge), [Einen Helfer in der Gesprächsrunde stoppen](#start-ragents.reference.60-stop-in-the-circle), [Texte prüfen und Ergebnisse gezielt teilen](#start-ragents.reference.190-review-queue) |
| Artifacts and access | [Eine Notiz gezielt weitergeben](#start-ragents.reference.65-artifact-least-privilege), [Texte prüfen und Ergebnisse gezielt teilen](#start-ragents.reference.190-review-queue) |
| Workspace layout | [Den Helfer hinter einer Mini-App öffnen](#example-mini-app-owner-inspector), [Eine Gesprächsrunde anders aufteilen](#example-personal-tile-arrangement) |
| Mini-apps | [Hallo Welt auf der Arbeitsfläche](#start-ragents.reference.95-hello-world), [Zeichen, Wörter und Zeilen zählen](#start-ragents.reference.80-actor-text-analysis), [Notizen ausblenden und wiederfinden](#start-ragents.reference.90-actor-notes), [Eine Liste im Chat und im Fenster pflegen](#start-ragents.reference.100-shared-actor-list), [Redaktionswerkstatt](#start-ragents.reference.150-editorial-workbench), [Lernbegleitung mit Unterlagen](#start-ragents.reference.160-learning-companion), [Bildsammlung mit Beschriftungen](#start-ragents.reference.170-photo-collection), [Entscheidungswerkstatt](#start-ragents.reference.180-decision-workbench), [Texte prüfen und Ergebnisse gezielt teilen](#start-ragents.reference.190-review-queue), [Vorschläge gemeinsam freigeben](#start-ragents.reference.220-actor-approval-list), [Eine Liste in zwei Ansichten](#start-ragents.reference.230-shared-state-views), [Antworten automatisch sammeln](#start-ragents.reference.240-live-result-list), [Balkon-Wizard](#start-ragents.reference.250-balcony-wizard) |
| Actor state | [Zeichen, Wörter und Zeilen zählen](#start-ragents.reference.80-actor-text-analysis), [Nachrichten ohne KI mitzählen](#start-ragents.reference.70-headless-counter), [Notizen ausblenden und wiederfinden](#start-ragents.reference.90-actor-notes), [Eine Liste im Chat und im Fenster pflegen](#start-ragents.reference.100-shared-actor-list), [Entscheidungswerkstatt](#start-ragents.reference.180-decision-workbench), [Vorschläge gemeinsam freigeben](#start-ragents.reference.220-actor-approval-list), [Eine Liste in zwei Ansichten](#start-ragents.reference.230-shared-state-views), [Antworten automatisch sammeln](#start-ragents.reference.240-live-result-list), [Balkon-Wizard](#start-ragents.reference.250-balcony-wizard) |
| LLM actor with view | [Lernbegleitung mit Unterlagen](#start-ragents.reference.160-learning-companion), [Bildsammlung mit Beschriftungen](#start-ragents.reference.170-photo-collection), [Vorschläge gemeinsam freigeben](#start-ragents.reference.220-actor-approval-list) |
| Actor chat | [Lernbegleitung mit Unterlagen](#start-ragents.reference.160-learning-companion), [Bildsammlung mit Beschriftungen](#start-ragents.reference.170-photo-collection) |
| Controlled chat | [Entscheidungswerkstatt](#start-ragents.reference.180-decision-workbench), [Vorschläge gemeinsam freigeben](#start-ragents.reference.220-actor-approval-list) |
| Language diagnostics | [Fehler in C# und TypeScript finden](#start-ragents.reference.75-lsp-demo), [Fehler in einer Terminliste finden](#start-ragents.reference.200-typescript-diagnostics) |
| Primary actor | [Moderierte Runde ohne Koordinator](#start-ragents.reference.moderated-round), [Balkon-Wizard einrichten](#start-ragents.reference.balcony-wizard), [Lernnachmittag](#start-ragents.reference.learning-afternoon), [Gespräch an einen Moderator übergeben](#start-ragents.reference.210-moderator-handover) |
| Start guide | [Sammelboard einrichten](#start-ragents.reference.shared-actor-list), [Gesprächsrunde einrichten](#start-ragents.reference.conversation-circle) |
| Questions | [Rückfrage, Aufgaben und Dokument zusammen sehen](#start-ragents.reference.110-all-card-slots), [Gespräch an einen Moderator übergeben](#start-ragents.reference.210-moderator-handover) |
| To-dos | [Rückfrage, Aufgaben und Dokument zusammen sehen](#start-ragents.reference.110-all-card-slots), [Gespräch an einen Moderator übergeben](#start-ragents.reference.210-moderator-handover) |
| Journal inspection | [Drei Aufträge der Reihe nach erledigen](#start-ragents.reference.35-actor-input-fifo), [Gezielt bei anderen Helfern mithören](#start-ragents.reference.40-subscription-matrix), [Einen Helfer in der Gesprächsrunde stoppen](#start-ragents.reference.60-stop-in-the-circle), [Nachrichten ohne KI mitzählen](#start-ragents.reference.70-headless-counter), [Texte prüfen und Ergebnisse gezielt teilen](#start-ragents.reference.190-review-queue) |
| Run scripts | [Sammelboard einrichten](#start-ragents.reference.shared-actor-list), [Gesprächsrunde einrichten](#start-ragents.reference.conversation-circle), [Moderierte Runde ohne Koordinator](#start-ragents.reference.moderated-round), [Balkon-Wizard einrichten](#start-ragents.reference.balcony-wizard), [Lernnachmittag](#start-ragents.reference.learning-afternoon), [Wortspiel starten](#start-ragents.reference.word-game) |
| Skills | [Entscheidung klären](#start-ragents.reference.decision-brief), [Lernziel in Etappen](#start-ragents.reference.learning-sprint) |
| Actor functions | [Zeichen, Wörter und Zeilen zählen](#start-ragents.reference.80-actor-text-analysis), [Nachrichten ohne KI mitzählen](#start-ragents.reference.70-headless-counter), [Notizen ausblenden und wiederfinden](#start-ragents.reference.90-actor-notes), [Eine Liste im Chat und im Fenster pflegen](#start-ragents.reference.100-shared-actor-list), [Redaktionswerkstatt](#start-ragents.reference.150-editorial-workbench), [Vorschläge gemeinsam freigeben](#start-ragents.reference.220-actor-approval-list), [Eine Liste in zwei Ansichten](#start-ragents.reference.230-shared-state-views), [Balkon-Wizard](#start-ragents.reference.250-balcony-wizard) |
| Automatic view placement | [Zeichen, Wörter und Zeilen zählen](#start-ragents.reference.80-actor-text-analysis), [Notizen ausblenden und wiederfinden](#start-ragents.reference.90-actor-notes) |
| View visibility | [Zeichen, Wörter und Zeilen zählen](#start-ragents.reference.80-actor-text-analysis), [Notizen ausblenden und wiederfinden](#start-ragents.reference.90-actor-notes) |
| Global coordinator | [Zwei Unterhaltungen im Blick behalten](#example-global-run-overview), [Eine vorbereitete Runde global starten](#example-global-prepared-run) |
| Conversation reset | [Nach einer Planung neu beginnen](#example-reset-completed-global-chat), [Einen Reset zunächst abbrechen](#example-reset-without-losing-draft) |
| Settings and model selection | [Den Koordinator für kurze Antworten einstellen](#example-coordinator-model-settings), [Das Modell für kurze Überschriften wählen](#example-title-model-selection), [Automatische Überschriften ausschalten](#example-disable-generated-titles), [Eine Fähigkeit ihrer Extension zuordnen](#example-extension-capability-settings) |
| Process display | [Den Sprachserver als Run-Prozess sehen](#example-language-server-process), [Eine kurzlebige lokale Vorschau öffnen](#example-local-preview-process) |
| Files and workspace | [Einen Entwurf im Dateibaum lesen](#example-workspace-draft-preview), [Gleichnamige Dateien in zwei Runs vergleichen](#example-separate-run-files) |
| Recovery after restart | [Eine gemeinsame Liste nach Neustart wiederfinden](#example-restore-shared-list), [Zwei Gesprächsverläufe nach Neustart fortsetzen](#example-restore-conversation-context) |
| Multimodal input | [Eine eigene Skizze im Chat besprechen](#example-image-paste-conversation), [Einen kurzen Clip mit seinem Ablaufplan vergleichen](#example-video-and-document-drop) |

## Walkthroughs

Walkthroughs explain step by step how to use existing functions in the interface. They are documentation, not additional start cards or evidence of completed model runs. You can follow the steps in the application.

<a id="example-mini-app-owner-inspector"></a>

### Den Helfer hinter einer Mini-App öffnen

Die Mini-App bleibt als Kachel sichtbar; ihr Besitzer ist auch ohne eigene Kachel erreichbar.

User workflow. Tags: Use case, Concept demo, Workspace layout.

1. Im Profil showcase Sammelboard einrichten öffnen und den Leitfaden abschließen. Erwartung: Die Liste steht als Kachel auf der Fläche; ihr Besitzer hat keine eigene Kachel.
2. In der Kopfzeile Actors öffnen und den Namen des Listenbesitzers wählen. Erwartung: Rechts öffnen sich dessen Chat und Details, ohne die Kachelaufteilung zu ändern.
3. Den Besitzer aus der Kopfzeile auf die Kachel der Liste ziehen und rechts andocken. Erwartung: Seine Kachel erscheint neben der Liste; die Mini-App bleibt bedienbar und behält ihre Einträge.
4. Die neue Kachel über das Kreuz in ihrer Kopfzeile wieder entfernen und die App erneut bedienen. Erwartung: Actor und Funktionen arbeiten weiter; sein Name bleibt in der Kopfzeile erreichbar.

<a id="example-personal-tile-arrangement"></a>

### Eine Gesprächsrunde anders aufteilen

Kacheln lassen sich persönlich umstellen und wieder auf die Programmvorgabe zurücksetzen.

User workflow. Tags: Use case, Concept demo, Workspace layout.

1. Im Profil showcase den Einstieg Gesprächsrunde einrichten ausführen und den Aufbau abwarten. Die vom Run gesetzte Aufteilung ansehen.
2. Eine Kachel an ihrer Kopfzeile fassen und am oberen Rand einer anderen Kachel andocken. Erwartung: Die Aufteilung ändert sich sofort; alle Gesprächspartner arbeiten weiter.
3. Die Trennlinie zwischen zwei Kacheln verschieben und denselben Run im selben Browser neu laden. Erwartung: Die persönliche Aufteilung bleibt erhalten; die Actors und die Programmanordnung sind unverändert.
4. In der Statusleiste Programmvorgabe übernehmen wählen. Erwartung: Die Fläche zeigt wieder die Aufteilung des Runs; der Knopf verschwindet, bis wieder eine eigene Änderung vorliegt.

<a id="example-global-run-overview"></a>

### Zwei Unterhaltungen im Blick behalten

Der übergeordnete Koordinator liest vorhandene Runs, während die aktuelle Arbeitsfläche geöffnet bleibt.

User workflow. Tags: Use case, Concept demo, Global coordinator.

1. Im Profil showcase zwei kurze Unterhaltungen zu einer Leseliste und einem Wochenplan anlegen und ihre Antworten abwarten.
2. In die Eingabe Globaler Koordinator in der Kopfzeile klicken und damit seinen Verlauf öffnen. Um eine knappe Übersicht der beiden Unterhaltungen mit ihrem jeweiligen Arbeitsstand bitten.
3. Die Run-Liste über die Übersichtsecke oder Cmd+I auf macOS beziehungsweise Ctrl+I öffnen, beide Runs auswählen und die Antwort mit ihren tatsächlichen Unterhaltungen vergleichen. Erwartung: Der globale Chat kann beide Journale berücksichtigen; ein Run-Wechsel erhält seinen eigenen Verlauf.
4. Einen ungesendeten Entwurf oben eingeben, Escape drücken und den Verlauf wieder öffnen. Erwartung: Das Dropdown schließt ohne Stopp; Entwurf, aktueller Run und globales Gespräch bleiben erhalten.

<a id="example-global-prepared-run"></a>

### Eine vorbereitete Runde global starten

Der übergeordnete Koordinator wählt aus dem vorhandenen Katalog ein Run-Script und erstellt damit einen neuen Run.

User workflow. Tags: Use case, Concept demo, Global coordinator.

1. In die Eingabe Globaler Koordinator in der Kopfzeile klicken und bitten: Zeige die verfügbaren vorbereiteten Run-Scripts und starte Gesprächsrunde einrichten zum Thema gemeinsames Lernen mit zwei Runden.
2. Nach dem Senden die Kurzantwort direkt unter der Kopfzeile abwarten. Den Hinweis anklicken und die vollständige Antwort im Verlauf lesen. Falls der Startwert unklar ist, die Rückfrage anhand des angezeigten Katalogs beantworten; keine Modellkennung oder Run-ID abschreiben.
3. Den neuen Run über die Run-Liste öffnen. Erwartung: Ein eigener Run mit dem angeforderten Thema und dem vorbereiteten Aufbau entsteht. Die Annahme des Starts allein beweist noch keinen abgeschlossenen Gesprächsbeitrag.
4. Nach dem ersten tatsächlichen Beitrag unten Actors öffnen und einen Gesprächspartner im Inspector auswählen. Oben im globalen Chat fragen: Was macht dieser Actor? Erwartung: Die Frage erhält den Run und den ausgewählten Actor als getrennte Orientierung; der sichtbare Fragetext bleibt unverändert.
5. Nach dem Absenden einen anderen Run öffnen. Erwartung: Die bereits gesendete Frage bleibt an ihre ursprüngliche Auswahl gebunden, auch wenn sie erst später bearbeitet wird. Der globale Verlauf und beide Runs bleiben getrennt erreichbar.

<a id="example-reset-completed-global-chat"></a>

### Nach einer Planung neu beginnen

Ein bestätigter Reset leert das globale Gespräch und lässt bestehende Runs und die Modellauswahl erhalten.

User workflow. Tags: Use case, Concept demo, Conversation reset.

1. Im globalen Chat eine kurze Planung abschließen. Einen normalen Run geöffnet lassen und die aktuelle globale Modell- und Reasoningwahl merken.
2. Gespräch zurücksetzen wählen und die angezeigte Bestätigung ausdrücklich bestätigen. Die erfolgreiche Rückmeldung abwarten.
3. Erwartung: Verlauf, Eingabeentwurf und Anhänge des globalen Chats sind leer; der geöffnete normale Run sowie die Modell- und Reasoningwahl bestehen weiter.
4. Eine neue kurze Nachricht senden. Erwartung: Sie beginnt ein frisches globales Gespräch. Der Reset selbst hat keinen neuen Modellauftrag gestartet.

<a id="example-reset-without-losing-draft"></a>

### Einen Reset zunächst abbrechen

Die Bestätigung schützt einen noch benötigten Gesprächsentwurf; erst der bestätigte zweite Versuch leert ihn.

User workflow. Tags: Use case, Concept demo, Conversation reset.

1. Im globalen Chat einen kurzen Entwurf eingeben, ohne ihn zu senden. Gespräch zurücksetzen öffnen und die Bestätigung abbrechen.
2. Erwartung: Entwurf und bestehender Verlauf bleiben erhalten. Die bloße Anzeige der Bestätigung setzt nichts zurück.
3. Gespräch zurücksetzen erneut öffnen und diesmal bestätigen. Während des Resets keine weitere Nachricht senden.
4. Erwartung: Nach Erfolg sind Entwurf und Verlauf leer. Bei einem Fehler bleibt dessen Meldung sichtbar und erlaubt einen erneuten Versuch; ein Fehler darf nicht als erfolgreicher Reset gelten.

<a id="example-coordinator-model-settings"></a>

### Den Koordinator für kurze Antworten einstellen

Modell und Reasoning werden direkt im globalen Chat gewählt und in den Einstellungen wiedergefunden.

User workflow. Tags: Use case, Concept demo, Settings and model selection.

1. Den globalen Verlauf über die Toolbar-Eingabe öffnen und im Dropdown oberhalb des Verlaufs ein angebotenes Modell und eine dort verfügbare Reasoning-Stufe wählen. Keine nicht angebotene Stufe voraussetzen.
2. Die bestätigte Speicherung abwarten und danach eine kurze Frage stellen. Erwartung: Neue Arbeit verwendet die gespeicherte Auswahl; ein schon laufender Turn wird dadurch nicht rückwirkend verändert.
3. Das Zahnrad öffnen und unter Modelle die Einstellung Globaler Koordinator ansehen. Erwartung: Beide Ansichten zeigen dieselbe bestätigte Auswahl.
4. Falls ein Modellwechsel wegen bereits vorhandener Medien abgelehnt wird, die sichtbare Fehlermeldung beachten. Erwartung: Die bisherige gültige Auswahl bleibt erhalten.

<a id="example-title-model-selection"></a>

### Das Modell für kurze Überschriften wählen

Ein eigenes Modell verdichtet den Auftrag in der Run-Liste, ohne die Modelle der Agenten zu ändern.

User workflow. Tags: Use case, Concept demo, Settings and model selection.

1. Über das Zahnrad Einstellungen, Modelle und Überschriften öffnen. Bei einer großen Liste mit der Suche ein angebotenes Modell finden, auswählen und Speichern wählen.
2. Die bestätigte Speicherung abwarten. Erwartung: Die Auswahl bleibt im Formular erhalten; Globaler Koordinator sowie Neue Runs und Agenten behalten ihre eigenen Einstellungen.
3. Eine neue Unterhaltung mit einem ausführlicheren Auftrag beginnen und die Run-Liste öffnen. Erwartung: Der ursprüngliche Auftrag ist bereits sichtbar. Sobald ein automatischer Titel erfolgreich erzeugt und gespeichert ist, erscheint die kurze Überschrift ohne zusätzlichen manuellen Listenabruf. Eine feste Antwortzeit wird nicht vorausgesetzt.
4. Eine andere Modellwahl als Entwurf einstellen und Änderungen verwerfen wählen. Erwartung: Die bestätigte Auswahl kehrt zurück; ein schon erzeugter Titel wird nicht ersetzt.

<a id="example-disable-generated-titles"></a>

### Automatische Überschriften ausschalten

Neue Erzeugungen lassen sich deaktivieren; vorhandene und ausdrücklich gesetzte Titel bleiben erhalten.

User workflow. Tags: Use case, Concept demo, Settings and model selection.

1. Eine Unterhaltung mit bereits erzeugtem Kurztitel in der Run-Liste ansehen. Unter Einstellungen, Modelle, Überschriften Keine automatischen Überschriften auswählen und speichern.
2. Die Anwendung neu laden und die Einstellung erneut ansehen. Erwartung: Die Deaktivierung ist gespeichert; der bestehende Kurztitel bleibt unverändert.
3. Eine weitere Unterhaltung mit einem normalen Auftrag beginnen. Erwartung: Die Run-Liste zeigt den Auftrag, ohne dafür einen automatischen Kurztitel anzufordern.
4. Optional Sammelboard einrichten starten und im Leitfaden einen Namen vorgeben. Erwartung: Der vorbereitete Ablauf setzt weiterhin seinen eigenen Run-Titel. Ein später wieder aktiviertes Titelmodell überschreibt diesen Namen nicht.

<a id="example-extension-capability-settings"></a>

### Eine Fähigkeit ihrer Extension zuordnen

Die beiden Ansichten der Einstellungen erschließen denselben Bestand aus unterschiedlichen Richtungen.

User workflow. Tags: Use case, Concept demo, Settings and model selection.

1. Über das Zahnrad die Einstellungen öffnen und zu Erweiterungen wechseln. In Nach Extension die Actor-Programm-Extension auswählen und ihre Werkzeuge und Web-Beiträge ansehen.
2. Zu Nach Fähigkeit wechseln, Werkzeuge auswählen und nach actor_program suchen. Erwartung: Die passenden Beiträge erscheinen mit ihrer jeweiligen Extension als Eigentümer.
3. Den Link zur Actor-Programm-Extension öffnen. Erwartung: Ihr vollständiges Inventar ist wieder sichtbar; ein vorheriger Suchfilter verdeckt die Detailseite nicht.
4. Zu Modelle wechseln und die Koordinator-Modellwahl öffnen. Nur tatsächlich angebotene Werte sind wählbar; eine ungültige Kombination wird nicht still ersetzt.

<a id="example-language-server-process"></a>

### Den Sprachserver als Run-Prozess sehen

Eine TypeScript-Prüfung macht den zugehörigen Sprachserver in der Prozessanzeige sichtbar.

User workflow. Tags: Use case, Concept demo, Process display.

1. Im Profil showcase den Skill-Einstieg Fehler in einer Terminliste finden ausführen. Voraussetzung ist ein verfügbarer TypeScript-Sprachserver; eine fehlende Voraussetzung muss als Fehler gemeldet werden.
2. Nach dem Öffnen des Sprachservers die gemeinsame Kopfzeile des Runs ansehen. Erwartung: Der verwaltete Sprachserver erscheint als zu diesem Run gehörender Prozess.
3. Einen anderen Run öffnen und zurückwechseln. Erwartung: Die Prozessanzeige folgt dem ausgewählten Run und ist kein gemeinsames Verzeichnis aller Rechnerprozesse.
4. Die Prozessanzeige dient der Beobachtung. Sie bietet keinen Beenden-Knopf; fehlende Betriebssystemrechte oder Werkzeuge werden als sichtbarer Fehler gemeldet.

<a id="example-local-preview-process"></a>

### Eine kurzlebige lokale Vorschau öffnen

Ein zeitlich begrenzter Demo-Webprozess erscheint mit seinem erkannten Port in der Kopfzeile.

User workflow. Tags: Use case, Concept demo, Process display.

1. In einem eigenen showcase-Run den Koordinator bitten, einen kleinen Node-Demoprozess im Run-Arbeitsverzeichnis vorzubereiten: Er liefert nur einen neutralen Begrüßungstext, bindet ausschließlich 127.0.0.1 auf einem freien Port und beendet sich nach zwei Minuten selbst. Keine zusätzlichen Pakete installieren und keinen Produktserver ersetzen.
2. Den vorbereiteten Demoprozess starten lassen und bei laufender Ausführung die Kopfzeile ansehen. Erwartung: Der Prozess erscheint mit einem Link auf seinen erkannten offenen Port.
3. Den Port-Link nur auf demselben Rechner öffnen. Erwartung: Die lokale Demoantwort erscheint; bei einem entfernten Server ist dessen Loopback-Adresse nicht die Adresse des Browsers.
4. Das vorgesehene automatische Ende abwarten. Erwartung: Der Eintrag verschwindet nach der nächsten Prozessaktualisierung. Run-Stopp oder das Schließen eines Tabs werden hier nicht als Beenden eines abgesetzten Dienstes versprochen.

<a id="example-workspace-draft-preview"></a>

### Einen Entwurf im Dateibaum lesen

Ein Run schreibt einen kleinen Text; der Dateireiter zeigt Inhalt und spätere Änderung ohne eigenen Editor.

User workflow. Tags: Use case, Concept demo, Files and workspace.

1. In einem neuen showcase-Run den Koordinator bitten, im Run-Arbeitsverzeichnis die Datei reading-list.md mit drei neutralen Lesethemen anzulegen.
2. Den Reiter Dateien öffnen, das Arbeitsverzeichnis aufklappen und reading-list.md auswählen. Erwartung: Der geschriebene Text erscheint als Vorschau.
3. Im Chat ein viertes Thema ergänzen lassen und zur weiterhin geöffneten Vorschau zurückkehren. Erwartung: Die Dateiänderung wird im Dateibrowser sichtbar.
4. Erwartung: Der Dateireiter bleibt eine Leseansicht. Änderungen erfolgen durch den beauftragten Actor und dessen Dateiwerkzeuge, nicht durch einen eingebauten Editor oder Löschknopf.

<a id="example-separate-run-files"></a>

### Gleichnamige Dateien in zwei Runs vergleichen

Zwei unabhängige Arbeitsverzeichnisse enthalten eigene Dateien mit demselben Namen.

User workflow. Tags: Use case, Concept demo, Files and workspace.

1. Einen showcase-Run Leseliste anlegen und darin notes.md mit dem Inhalt Lesen vorbereiten schreiben lassen.
2. Einen zweiten showcase-Run Wochenplan anlegen und dort ebenfalls notes.md schreiben lassen, diesmal mit dem Inhalt Woche planen. Keine Datei zwischen Runs kopieren.
3. In beiden Runs nacheinander den Reiter Dateien öffnen und notes.md lesen. Erwartung: Der gleiche Dateiname zeigt den jeweils eigenen Inhalt des Run-Arbeitsverzeichnisses.
4. Nur im Wochenplan eine Zeile ergänzen lassen und beide Vorschauen erneut prüfen. Erwartung: Die Datei des Leselisten-Runs ist unverändert.

<a id="example-restore-shared-list"></a>

### Eine gemeinsame Liste nach Neustart wiederfinden

Eine abgeschlossene Actor-Funktion bleibt beim regulären Neustart desselben Profils erhalten.

User workflow. Tags: Use case, Concept demo, Recovery after restart.

1. Im Profil showcase Sammelboard einrichten öffnen und den Leitfaden abschließen. Einen eindeutig erkennbaren Eintrag hinzufügen und die bestätigte Aktualisierung der Liste abwarten.
2. Alle laufenden Arbeiten abschließen lassen. Den lokalen Server selbst über den für diese Installation verwendeten Startweg beenden und mit demselben Profil und Datenverzeichnis neu starten. Keine Daten löschen und keine zweite Serverinstanz parallel starten.
3. Die Anwendung erneut öffnen und denselben Run auswählen. Erwartung: Gespräch, Mini-App und bestätigter Listeneintrag sind wieder vorhanden.
4. Die Liste auf doppelte Einträge prüfen. Erwartung: Der Neustart stellt gespeicherten Zustand wieder her, führt die bereits abgeschlossene Hinzufügeaktion aber nicht erneut aus. Das Journal allein ersetzt keine vollständige Sicherung der übrigen Run-Dateien.

<a id="example-restore-conversation-context"></a>

### Zwei Gesprächsverläufe nach Neustart fortsetzen

Normale Unterhaltung und globaler Koordinator behalten ihre jeweils eigene Geschichte.

User workflow. Tags: Use case, Concept demo, Recovery after restart.

1. In einem normalen showcase-Run drei Lernziele besprechen und im globalen Chat eine knappe Übersicht dieses Runs anfordern. Beide Antworten vollständig abwarten und die globale Modellwahl merken.
2. Den lokalen Server selbst über den vorhandenen Startweg neu starten, mit demselben Profil und Datenverzeichnis. Keine Dateien entfernen oder zwischen Installationen übertragen.
3. Den normalen Run und anschließend den globalen Chat öffnen. Erwartung: Beide bisherigen Verläufe und die globale Modellwahl sind erhalten.
4. Im normalen Run um den nächsten Schritt zu den Lernzielen bitten. Die neue Antwort als neue Arbeit behandeln; der Neustart hat alte Modellaufrufe nicht wiederholt. Ein beim Neustart noch offener Turn wäre unterbrochen abgeschlossen worden und wird nicht automatisch erneut ausgeführt.

<a id="example-image-paste-conversation"></a>

### Eine eigene Skizze im Chat besprechen

Ein Bild aus der Zwischenablage wird vor dem Senden geprüft und danach als Anhang im Verlauf gezeigt.

User workflow. Tags: Use case, Concept demo, Multimodal input.

1. Eine eigene unkritische Skizze in die Zwischenablage kopieren. Eine neue Unterhaltung öffnen und ein angebotenes Modell wählen, das Bildeingaben unterstützt.
2. Das Bild mit Cmd+V oder Ctrl+V in die Chat-Eingabe einfügen. Erwartung: Eine Bildvorschau erscheint, lässt sich vor dem Senden wieder entfernen und wurde noch nicht allein durch das Einfügen gesendet.
3. Mit der Frage Welche drei Formen erkennst du? senden. Erwartung: Nach erfolgreicher Annahme stehen Nachricht und dauerhafter Bildanhang im Verlauf; die Antwort wird gegen die tatsächliche Skizze geprüft.
4. Falls das Zielmodell keine Bildeingaben unterstützt, muss der Composer das Senden mit einer verständlichen Meldung blockieren. Kein passendes Modell im Katalog ist eine fehlende Voraussetzung, kein Anlass für einen behaupteten Bildbefund.

<a id="example-video-and-document-drop"></a>

### Einen kurzen Clip mit seinem Ablaufplan vergleichen

Video und PDF werden per Drag-and-drop ausdrücklich an ein geeignetes Modell gesendet.

User workflow. Tags: Use case, Concept demo, Multimodal input.

1. Einen eigenen kurzen, unkritischen Videoclip und einen kleinen PDF-Ablaufplan bereitlegen. Einen Chat mit einem angebotenen Modell öffnen, dessen veröffentlichte Eingabefähigkeiten sowohl Video als auch native PDFs erlauben. Gibt es kein solches Modell, ist dieser Ablauf nicht ausführbar.
2. Beide Dateien in die Chat-Eingabe ziehen. Erwartung: Der Clip erhält eine Vorschau und das PDF eine Dateiangabe; Anhänge lassen sich einzeln entfernen. Sichtbare Größen- oder Fähigkeitsfehler vor dem Senden beheben.
3. Mit der Frage Welche geplanten Schritte sind im Clip sichtbar? senden und die tatsächliche Antwort mit Clip und Ablaufplan vergleichen. Erwartung: Die Anhänge bleiben im Verlauf erneut erreichbar.
4. Bei fehlender Video- oder PDF-Unterstützung bleibt das Senden blockiert. Es gibt hier keine stille OCR-Ausweichverarbeitung und keine Zusage, dass jedes angebotene Modell die Dateien versteht.

## Einstiege

### Kategorie: Mini-Apps

<a id="start-ragents.reference.95-hello-world"></a>

### ragents.reference.95-hello-world: Hallo Welt auf der Arbeitsfläche

Zeigt den kleinsten Aufbau einer Mini-App am vorhandenen Actor: eine reine Anzeige ohne neuen Actor oder Serverfunktion.

Tags: Konzeptdemo, Mini-Apps.

```json
{
  "id": "ragents.reference.95-hello-world",
  "owner": "ragents.reference",
  "title": "Hallo Welt auf der Arbeitsfläche",
  "description": "Zeigt den kleinsten Aufbau einer Mini-App am vorhandenen Actor: eine reine Anzeige ohne neuen Actor oder Serverfunktion.",
  "order": 5,
  "tags": [
    "Konzeptdemo",
    "Mini-Apps"
  ],
  "action": "skill",
  "skill": "95-hello-world",
  "category": "Mini-Apps",
  "prompt": "Ich hätte gern an Deinem vorhandenen Actor eine kleine Oberfläche auf der Arbeitsfläche, die einfach nur Hallo Welt sagt. Sie soll sonst nichts tun. Lege dafür keinen neuen Actor und keine Serverfunktion an."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/95-hello-world/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Hallo Welt auf der Arbeitsfläche",
  "message": "Nutze den Skill 95-hello-world für diesen Auftrag.\n\nIch hätte gern an Deinem vorhandenen Actor eine kleine Oberfläche auf der Arbeitsfläche, die einfach nur Hallo Welt sagt. Sie soll sonst nichts tun. Lege dafür keinen neuen Actor und keine Serverfunktion an."
}
```

<a id="start-ragents.reference.80-actor-text-analysis"></a>

### ragents.reference.80-actor-text-analysis: Zeichen, Wörter und Zeilen zählen

Zeigt, wie Chat und Mini-App dieselbe TypeScript-Funktion und denselben Aufrufzähler nutzen. Ausblenden erhält den Actor-Zustand.

Tags: Anwendungsfall, Konzeptdemo, TypeScript-Actors, Actor-Funktionen, Actor-Zustand, Mini-Apps, Automatische View-Platzierung, View-Sichtbarkeit.

```json
{
  "id": "ragents.reference.80-actor-text-analysis",
  "owner": "ragents.reference",
  "title": "Zeichen, Wörter und Zeilen zählen",
  "description": "Zeigt, wie Chat und Mini-App dieselbe TypeScript-Funktion und denselben Aufrufzähler nutzen. Ausblenden erhält den Actor-Zustand.",
  "order": 10,
  "tags": [
    "Anwendungsfall",
    "Konzeptdemo",
    "TypeScript-Actors",
    "Actor-Funktionen",
    "Actor-Zustand",
    "Mini-Apps",
    "Automatische View-Platzierung",
    "View-Sichtbarkeit"
  ],
  "action": "skill",
  "skill": "80-actor-text-analysis",
  "category": "Mini-Apps",
  "prompt": "Ich hätte gern eine Textanalyse mit Textfeld, Zählknopf und verständlichen Fehlern. Ein TypeScript-Actor zählt Zeichen, Wörter, Zeilen und seine Aufrufe ohne KI. Prüfe \"Die Welt ist groß.\" und \"Und schön.\" als zwei Zeilen: 6 Wörter. Die Oberfläche zeigt denselben Aufrufzähler. Blende sie aus und wieder ein; der Zustand bleibt. Nutze gemeinsame Layout- und Formularbausteine: Eingabe und Ergebnis nebeneinander, bei wenig Platz untereinander."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/80-actor-text-analysis/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Zeichen, Wörter und Zeilen zählen",
  "message": "Nutze den Skill 80-actor-text-analysis für diesen Auftrag.\n\nIch hätte gern eine Textanalyse mit Textfeld, Zählknopf und verständlichen Fehlern. Ein TypeScript-Actor zählt Zeichen, Wörter, Zeilen und seine Aufrufe ohne KI. Prüfe \"Die Welt ist groß.\" und \"Und schön.\" als zwei Zeilen: 6 Wörter. Die Oberfläche zeigt denselben Aufrufzähler. Blende sie aus und wieder ein; der Zustand bleibt. Nutze gemeinsame Layout- und Formularbausteine: Eingabe und Ergebnis nebeneinander, bei wenig Platz untereinander."
}
```

<a id="start-ragents.reference.90-actor-notes"></a>

### ragents.reference.90-actor-notes: Notizen ausblenden und wiederfinden

Zeigt eine automatisch platzierte Mini-App mit Notizauswahl. Beim Ausblenden und Wiederanzeigen bleiben Actor und Notizen erhalten.

Tags: Anwendungsfall, Konzeptdemo, TypeScript-Actors, Actor-Funktionen, Actor-Zustand, Mini-Apps, Automatische View-Platzierung, View-Sichtbarkeit.

```json
{
  "id": "ragents.reference.90-actor-notes",
  "owner": "ragents.reference",
  "title": "Notizen ausblenden und wiederfinden",
  "description": "Zeigt eine automatisch platzierte Mini-App mit Notizauswahl. Beim Ausblenden und Wiederanzeigen bleiben Actor und Notizen erhalten.",
  "order": 90,
  "tags": [
    "Anwendungsfall",
    "Konzeptdemo",
    "TypeScript-Actors",
    "Actor-Funktionen",
    "Actor-Zustand",
    "Mini-Apps",
    "Automatische View-Platzierung",
    "View-Sichtbarkeit"
  ],
  "action": "skill",
  "skill": "90-actor-notes",
  "category": "Mini-Apps",
  "prompt": "Ich hätte gern einen TypeScript-Actor für meine Notizen. Seine Oberfläche mit Eingabe und Zähler soll von selbst auf der Arbeitsfläche erscheinen: links eine durchsuchbare Titelliste, rechts die ausgewählte Notiz. Ergänze eine erste Notiz über seine Funktion. Blende die Oberfläche kurz aus und wieder ein, ohne den Actor zu löschen oder Notizen zurückzusetzen. Lass sie zum Eintragen meiner nächsten Idee offen."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/90-actor-notes/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Notizen ausblenden und wiederfinden",
  "message": "Nutze den Skill 90-actor-notes für diesen Auftrag.\n\nIch hätte gern einen TypeScript-Actor für meine Notizen. Seine Oberfläche mit Eingabe und Zähler soll von selbst auf der Arbeitsfläche erscheinen: links eine durchsuchbare Titelliste, rechts die ausgewählte Notiz. Ergänze eine erste Notiz über seine Funktion. Blende die Oberfläche kurz aus und wieder ein, ohne den Actor zu löschen oder Notizen zurückzusetzen. Lass sie zum Eintragen meiner nächsten Idee offen."
}
```

<a id="start-ragents.reference.100-shared-actor-list"></a>

### ragents.reference.100-shared-actor-list: Eine Liste im Chat und im Fenster pflegen

Zeigt beim Aufbau einer Mini-App, wie Oberfläche und Koordinator dieselbe Funktion eines TypeScript-Actors benutzen und dieselbe Liste ändern.

Tags: Anwendungsfall, Konzeptdemo, TypeScript-Actors, Actor-Funktionen, Actor-Zustand, Mini-Apps.

```json
{
  "id": "ragents.reference.100-shared-actor-list",
  "owner": "ragents.reference",
  "title": "Eine Liste im Chat und im Fenster pflegen",
  "description": "Zeigt beim Aufbau einer Mini-App, wie Oberfläche und Koordinator dieselbe Funktion eines TypeScript-Actors benutzen und dieselbe Liste ändern.",
  "order": 100,
  "tags": [
    "Anwendungsfall",
    "Konzeptdemo",
    "TypeScript-Actors",
    "Actor-Funktionen",
    "Actor-Zustand",
    "Mini-Apps"
  ],
  "action": "skill",
  "skill": "100-shared-actor-list",
  "category": "Mini-Apps",
  "prompt": "Ich hätte gern eine gemeinsame Liste an einem TypeScript-Actor ohne KI-Listenhelfer. Ich ergänze Einträge über seine Oberfläche, Du über dieselbe Funktion als Werkzeug. Beide Wege zeigen sofort denselben Stand, auch bei ruhendem Chat. Füge wirklich einen Eintrag hinzu und lass die Oberfläche stehen. Nutze gemeinsame Layout- und Formularbausteine: mehrzeilige Eingabe und Liste nebeneinander, bei wenig Platz untereinander."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/100-shared-actor-list/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Eine Liste im Chat und im Fenster pflegen",
  "message": "Nutze den Skill 100-shared-actor-list für diesen Auftrag.\n\nIch hätte gern eine gemeinsame Liste an einem TypeScript-Actor ohne KI-Listenhelfer. Ich ergänze Einträge über seine Oberfläche, Du über dieselbe Funktion als Werkzeug. Beide Wege zeigen sofort denselben Stand, auch bei ruhendem Chat. Füge wirklich einen Eintrag hinzu und lass die Oberfläche stehen. Nutze gemeinsame Layout- und Formularbausteine: mehrzeilige Eingabe und Liste nebeneinander, bei wenig Platz untereinander."
}
```

<a id="start-ragents.reference.150-editorial-workbench"></a>

### ragents.reference.150-editorial-workbench: Redaktionswerkstatt

Zeigt, wie eine Mini-App Textbearbeitung, einzeln übernehmbare Änderungen und ein Bearbeitungsprotokoll zu einer Redaktionswerkstatt verbindet.

Tags: Actor-Funktionen, Anwendungsfall, Konzeptdemo, Mini-Apps.

```json
{
  "id": "ragents.reference.150-editorial-workbench",
  "owner": "ragents.reference",
  "title": "Redaktionswerkstatt",
  "description": "Zeigt, wie eine Mini-App Textbearbeitung, einzeln übernehmbare Änderungen und ein Bearbeitungsprotokoll zu einer Redaktionswerkstatt verbindet.",
  "order": 150,
  "tags": [
    "Actor-Funktionen",
    "Anwendungsfall",
    "Konzeptdemo",
    "Mini-Apps"
  ],
  "action": "skill",
  "skill": "150-editorial-workbench",
  "category": "Mini-Apps",
  "prompt": "Ich hätte gern eine Redaktionswerkstatt: Reparaturtreff, Samstag 10 bis 14 Uhr, Nachbarschaftshaus, ehrenamtliche Hilfe, keine Garantie. Links wähle ich Original oder Kurzfassung, rechts ändere ich Text und Zielgruppe und übernehme Kürzungen einzeln. Zeige Änderungen und Aufgabenstand, vergleiche Wortzahl und Freigabe tabellarisch. Ein Helfer zählt die Wörter; ein Protokoll zeigt Absender, Übernahmen und Rücknahmen. Veröffentliche nichts."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/150-editorial-workbench/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Redaktionswerkstatt",
  "message": "Nutze den Skill 150-editorial-workbench für diesen Auftrag.\n\nIch hätte gern eine Redaktionswerkstatt: Reparaturtreff, Samstag 10 bis 14 Uhr, Nachbarschaftshaus, ehrenamtliche Hilfe, keine Garantie. Links wähle ich Original oder Kurzfassung, rechts ändere ich Text und Zielgruppe und übernehme Kürzungen einzeln. Zeige Änderungen und Aufgabenstand, vergleiche Wortzahl und Freigabe tabellarisch. Ein Helfer zählt die Wörter; ein Protokoll zeigt Absender, Übernahmen und Rücknahmen. Veröffentliche nichts."
}
```

<a id="start-ragents.reference.160-learning-companion"></a>

### ragents.reference.160-learning-companion: Lernbegleitung mit Unterlagen

Zeigt eine eigene Mini-App eines KI-Tutors mit eingebettetem Actor-Chat. Lokal gewählte Unterlagen gelangen erst nach einer ausdrücklichen Aktion ins Gespräch.

Tags: Anwendungsfall, Konzeptdemo, Agententeams, Mini-Apps, LLM-Actor mit View, Actor-Chat.

```json
{
  "id": "ragents.reference.160-learning-companion",
  "owner": "ragents.reference",
  "title": "Lernbegleitung mit Unterlagen",
  "description": "Zeigt eine eigene Mini-App eines KI-Tutors mit eingebettetem Actor-Chat. Lokal gewählte Unterlagen gelangen erst nach einer ausdrücklichen Aktion ins Gespräch.",
  "order": 160,
  "tags": [
    "Anwendungsfall",
    "Konzeptdemo",
    "Agententeams",
    "Mini-Apps",
    "LLM-Actor mit View",
    "Actor-Chat"
  ],
  "action": "skill",
  "skill": "160-learning-companion",
  "category": "Mini-Apps",
  "prompt": "Ich hätte gern einen KI-Tutor mit eigener Oberfläche auf der Arbeitsfläche: Textunterlagen öffnen und lesen, daneben mit genau diesem Tutor sprechen. Ich möchte zwischen Erklären, Beispiel und Verständnisprüfung wählen. Die ausgewählte Datei soll erst nach meinem Klick im Gespräch verwendet werden. Fragen ohne Datei sollen auch gehen. Nutze die vorhandenen Chat-, Datei- und Auswahlbausteine."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/160-learning-companion/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Lernbegleitung mit Unterlagen",
  "message": "Nutze den Skill 160-learning-companion für diesen Auftrag.\n\nIch hätte gern einen KI-Tutor mit eigener Oberfläche auf der Arbeitsfläche: Textunterlagen öffnen und lesen, daneben mit genau diesem Tutor sprechen. Ich möchte zwischen Erklären, Beispiel und Verständnisprüfung wählen. Die ausgewählte Datei soll erst nach meinem Klick im Gespräch verwendet werden. Fragen ohne Datei sollen auch gehen. Nutze die vorhandenen Chat-, Datei- und Auswahlbausteine."
}
```

<a id="start-ragents.reference.170-photo-collection"></a>

### ragents.reference.170-photo-collection: Bildsammlung mit Beschriftungen

Zeigt eine eigene Mini-App eines KI-Schreibhelfers mit Bildvorschauen, bearbeitbaren Beschriftungen und direktem Chat. Die Auswahl lokaler Bilder sendet sie noch nicht an die KI.

Tags: Anwendungsfall, Konzeptdemo, Agententeams, Mini-Apps, LLM-Actor mit View, Actor-Chat.

```json
{
  "id": "ragents.reference.170-photo-collection",
  "owner": "ragents.reference",
  "title": "Bildsammlung mit Beschriftungen",
  "description": "Zeigt eine eigene Mini-App eines KI-Schreibhelfers mit Bildvorschauen, bearbeitbaren Beschriftungen und direktem Chat. Die Auswahl lokaler Bilder sendet sie noch nicht an die KI.",
  "order": 170,
  "tags": [
    "Anwendungsfall",
    "Konzeptdemo",
    "Agententeams",
    "Mini-Apps",
    "LLM-Actor mit View",
    "Actor-Chat"
  ],
  "action": "skill",
  "skill": "170-photo-collection",
  "category": "Mini-Apps",
  "prompt": "Ich hätte gern einen KI-Schreibhelfer mit eigener Oberfläche für eine kleine Bildsammlung: Bilder hineinziehen, Vorschauen sehen, die Liste durchsuchen und pro Bild Titel, Bildunterschrift und Alternativtext bearbeiten. Daneben möchte ich einen Chat mit genau diesem Schreibhelfer und eine lesbare Übersicht aller Beschriftungen. Meine Bilder bleiben lokal, bis ich selbst etwas im Chat sende. Nutze die vorhandenen Bausteine."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/170-photo-collection/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Bildsammlung mit Beschriftungen",
  "message": "Nutze den Skill 170-photo-collection für diesen Auftrag.\n\nIch hätte gern einen KI-Schreibhelfer mit eigener Oberfläche für eine kleine Bildsammlung: Bilder hineinziehen, Vorschauen sehen, die Liste durchsuchen und pro Bild Titel, Bildunterschrift und Alternativtext bearbeiten. Daneben möchte ich einen Chat mit genau diesem Schreibhelfer und eine lesbare Übersicht aller Beschriftungen. Meine Bilder bleiben lokal, bis ich selbst etwas im Chat sende. Nutze die vorhandenen Bausteine."
}
```

<a id="start-ragents.reference.180-decision-workbench"></a>

### ragents.reference.180-decision-workbench: Entscheidungswerkstatt

Zeigt ein fest geführtes Gespräch ohne KI-Aufrufe. Ein TypeScript-Actor hält Antworten und Fortschritt; Änderungen am Entscheidungsentwurf werden sichtbar.

Tags: Anwendungsfall, Konzeptdemo, TypeScript-Actors, Actor-Zustand, Mini-Apps, Frei gesteuerter Chat.

```json
{
  "id": "ragents.reference.180-decision-workbench",
  "owner": "ragents.reference",
  "title": "Entscheidungswerkstatt",
  "description": "Zeigt ein fest geführtes Gespräch ohne KI-Aufrufe. Ein TypeScript-Actor hält Antworten und Fortschritt; Änderungen am Entscheidungsentwurf werden sichtbar.",
  "order": 180,
  "tags": [
    "Anwendungsfall",
    "Konzeptdemo",
    "TypeScript-Actors",
    "Actor-Zustand",
    "Mini-Apps",
    "Frei gesteuerter Chat"
  ],
  "action": "skill",
  "skill": "180-decision-workbench",
  "category": "Mini-Apps",
  "prompt": "Ich hätte gern eine lokale Entscheidungshilfe: Bibliothek oder Café als Lernort? Feste Fragen führen durch Ziel, Optionen und Kriterien, protokollieren meine Entscheidung und zeigen den Fortschritt. Bei einer Meinungsänderung will ich den Unterschied zum vorherigen Entwurf sehen. Ein TypeScript-Actor führt den gemeinsamen Fortschritt und die Antworten. Das soll eine klar erkennbare Anleitung ohne KI-Aufrufe sein, mit den vorhandenen Chatbausteinen."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/180-decision-workbench/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Entscheidungswerkstatt",
  "message": "Nutze den Skill 180-decision-workbench für diesen Auftrag.\n\nIch hätte gern eine lokale Entscheidungshilfe: Bibliothek oder Café als Lernort? Feste Fragen führen durch Ziel, Optionen und Kriterien, protokollieren meine Entscheidung und zeigen den Fortschritt. Bei einer Meinungsänderung will ich den Unterschied zum vorherigen Entwurf sehen. Ein TypeScript-Actor führt den gemeinsamen Fortschritt und die Antworten. Das soll eine klar erkennbare Anleitung ohne KI-Aufrufe sein, mit den vorhandenen Chatbausteinen."
}
```

<a id="start-ragents.reference.190-review-queue"></a>

### ragents.reference.190-review-queue: Texte prüfen und Ergebnisse gezielt teilen

Zeigt an drei Textprüfungen die Input-Warteschlange, gezielte Ergebnisfreigaben und den Actor-Stopp. Die Mini-App sammelt ungeschützte Statusmeldungen.

Tags: Journalprüfung, Anwendungsfall, Konzeptdemo, Agententeams, Input-Warteschlange, Actor-Stopp, Artefakte und Zugriff, Mini-Apps.

```json
{
  "id": "ragents.reference.190-review-queue",
  "owner": "ragents.reference",
  "title": "Texte prüfen und Ergebnisse gezielt teilen",
  "description": "Zeigt an drei Textprüfungen die Input-Warteschlange, gezielte Ergebnisfreigaben und den Actor-Stopp. Die Mini-App sammelt ungeschützte Statusmeldungen.",
  "order": 190,
  "tags": [
    "Journalprüfung",
    "Anwendungsfall",
    "Konzeptdemo",
    "Agententeams",
    "Input-Warteschlange",
    "Actor-Stopp",
    "Artefakte und Zugriff",
    "Mini-Apps"
  ],
  "action": "skill",
  "skill": "190-review-queue",
  "category": "Mini-Apps",
  "prompt": "Ich hätte gern drei getrennte Textprüfungen zum Nachbarschaftsfest, die ich während der ersten Prüfung einreihe. Nur der bestimmte Empfänger darf das erste Ergebnis lesen; prüfe auch einen Zugriff ohne Freigabe. Danach meldest du den Prüfer ab. Belege Reihenfolge, Zugriff und Stopp. Eine Oberfläche des vorhandenen Koordinators zeigt auf der Fläche nur ungeschützte Statusmeldungen verschiedener Absender. Eine eigene Notiz möchte ich ergänzen können."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/190-review-queue/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Texte prüfen und Ergebnisse gezielt teilen",
  "message": "Nutze den Skill 190-review-queue für diesen Auftrag.\n\nIch hätte gern drei getrennte Textprüfungen zum Nachbarschaftsfest, die ich während der ersten Prüfung einreihe. Nur der bestimmte Empfänger darf das erste Ergebnis lesen; prüfe auch einen Zugriff ohne Freigabe. Danach meldest du den Prüfer ab. Belege Reihenfolge, Zugriff und Stopp. Eine Oberfläche des vorhandenen Koordinators zeigt auf der Fläche nur ungeschützte Statusmeldungen verschiedener Absender. Eine eigene Notiz möchte ich ergänzen können."
}
```

<a id="start-ragents.reference.220-actor-approval-list"></a>

### ragents.reference.220-actor-approval-list: Vorschläge gemeinsam freigeben

Zeigt einen KI-Listenhelfer mit eigener Mini-App und gemeinsamem Zustand. Seine Vorschläge lassen sich per Funktion bestätigen, ohne eine weitere KI-Antwort abzuwarten.

Tags: Anwendungsfall, Konzeptdemo, Agententeams, Actor-Funktionen, Actor-Zustand, Mini-Apps, LLM-Actor mit View, Frei gesteuerter Chat.

```json
{
  "id": "ragents.reference.220-actor-approval-list",
  "owner": "ragents.reference",
  "title": "Vorschläge gemeinsam freigeben",
  "description": "Zeigt einen KI-Listenhelfer mit eigener Mini-App und gemeinsamem Zustand. Seine Vorschläge lassen sich per Funktion bestätigen, ohne eine weitere KI-Antwort abzuwarten.",
  "order": 220,
  "tags": [
    "Anwendungsfall",
    "Konzeptdemo",
    "Agententeams",
    "Actor-Funktionen",
    "Actor-Zustand",
    "Mini-Apps",
    "LLM-Actor mit View",
    "Frei gesteuerter Chat"
  ],
  "action": "skill",
  "skill": "220-actor-approval-list",
  "category": "Mini-Apps",
  "prompt": "Ich hätte gern einen KI-Listenhelfer mit eigener Oberfläche. Dort prüfe und bestätige ich seine Vorschläge; bestätigte Einträge stehen daneben. Der Helfer benutzt dieselben Funktionen und dieselbe Liste, wenn ich ihn im Chat um einen Eintrag bitte. Lass ihn einen echten Vorschlag machen. Die Freigabe per Knopf soll ohne weitere KI-Antwort seinen gespeicherten Vorschlag bestätigen. Danach möchte ich selbst einen eingeben."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/220-actor-approval-list/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Vorschläge gemeinsam freigeben",
  "message": "Nutze den Skill 220-actor-approval-list für diesen Auftrag.\n\nIch hätte gern einen KI-Listenhelfer mit eigener Oberfläche. Dort prüfe und bestätige ich seine Vorschläge; bestätigte Einträge stehen daneben. Der Helfer benutzt dieselben Funktionen und dieselbe Liste, wenn ich ihn im Chat um einen Eintrag bitte. Lass ihn einen echten Vorschlag machen. Die Freigabe per Knopf soll ohne weitere KI-Antwort seinen gespeicherten Vorschlag bestätigen. Danach möchte ich selbst einen eingeben."
}
```

<a id="start-ragents.reference.230-shared-state-views"></a>

### ragents.reference.230-shared-state-views: Eine Liste in zwei Ansichten

Zeigt zwei Mini-App-Ansichten desselben Actor-Zustands. Änderungen erscheinen in beiden; eine Ansicht lässt sich unabhängig ausblenden.

Tags: Anwendungsfall, Konzeptdemo, Actor-Funktionen, Actor-Zustand, Mini-Apps.

```json
{
  "id": "ragents.reference.230-shared-state-views",
  "owner": "ragents.reference",
  "title": "Eine Liste in zwei Ansichten",
  "description": "Zeigt zwei Mini-App-Ansichten desselben Actor-Zustands. Änderungen erscheinen in beiden; eine Ansicht lässt sich unabhängig ausblenden.",
  "order": 230,
  "tags": [
    "Anwendungsfall",
    "Konzeptdemo",
    "Actor-Funktionen",
    "Actor-Zustand",
    "Mini-Apps"
  ],
  "action": "skill",
  "skill": "230-shared-state-views",
  "category": "Mini-Apps",
  "prompt": "Ich hätte gern eine Aufgabenliste mit zwei kleinen Fenstern: In einem ergänze und erledige ich Aufgaben, im anderen sehe ich nur offene und erledigte Anzahlen. Beide gehören zum selben Helfer und benutzen dieselben Daten. Ergänze wirklich eine Aufgabe und erledige sie. Beide Fenster sollen sofort mitziehen. Danach blende nur die Zusammenfassung aus und wieder ein; meine Liste bleibt erhalten."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/230-shared-state-views/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Eine Liste in zwei Ansichten",
  "message": "Nutze den Skill 230-shared-state-views für diesen Auftrag.\n\nIch hätte gern eine Aufgabenliste mit zwei kleinen Fenstern: In einem ergänze und erledige ich Aufgaben, im anderen sehe ich nur offene und erledigte Anzahlen. Beide gehören zum selben Helfer und benutzen dieselben Daten. Ergänze wirklich eine Aufgabe und erledige sie. Beide Fenster sollen sofort mitziehen. Danach blende nur die Zusammenfassung aus und wieder ein; meine Liste bleibt erhalten."
}
```

<a id="start-ragents.reference.240-live-result-list"></a>

### ragents.reference.240-live-result-list: Antworten automatisch sammeln

Zeigt, wie ein TypeScript-Actor fertige Agentenantworten per Abonnement automatisch sammelt. Auch weitere Beiträge desselben Helfers lassen die Liste wachsen.

Tags: Anwendungsfall, Konzeptdemo, TypeScript-Actors, Subscriptions, Actor-Zustand, Mini-Apps.

```json
{
  "id": "ragents.reference.240-live-result-list",
  "owner": "ragents.reference",
  "title": "Antworten automatisch sammeln",
  "description": "Zeigt, wie ein TypeScript-Actor fertige Agentenantworten per Abonnement automatisch sammelt. Auch weitere Beiträge desselben Helfers lassen die Liste wachsen.",
  "order": 240,
  "tags": [
    "Anwendungsfall",
    "Konzeptdemo",
    "TypeScript-Actors",
    "Subscriptions",
    "Actor-Zustand",
    "Mini-Apps"
  ],
  "action": "skill",
  "skill": "240-live-result-list",
  "category": "Mini-Apps",
  "prompt": "Ich hätte gern zwei KI-Helfer, die je eine kurze Idee für einen gemeinsamen Lernnachmittag vorschlagen. Ihre fertigen Antworten sollen automatisch in einer kleinen Ergebnisliste auf der Arbeitsfläche erscheinen. Ein programmierter Sammler merkt sich die Beiträge; dafür soll keine weitere KI die Texte kopieren. Lass danach einen Helfer eine zweite Idee ergänzen. Die Liste soll von selbst wachsen, auch wenn Du im Chat gerade nichts schreibst."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/240-live-result-list/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Antworten automatisch sammeln",
  "message": "Nutze den Skill 240-live-result-list für diesen Auftrag.\n\nIch hätte gern zwei KI-Helfer, die je eine kurze Idee für einen gemeinsamen Lernnachmittag vorschlagen. Ihre fertigen Antworten sollen automatisch in einer kleinen Ergebnisliste auf der Arbeitsfläche erscheinen. Ein programmierter Sammler merkt sich die Beiträge; dafür soll keine weitere KI die Texte kopieren. Lass danach einen Helfer eine zweite Idee ergänzen. Die Liste soll von selbst wachsen, auch wenn Du im Chat gerade nichts schreibst."
}
```

<a id="start-ragents.reference.250-balcony-wizard"></a>

### ragents.reference.250-balcony-wizard: Balkon-Wizard

Zeigt den Aufbau einer eigenständigen Mini-App für ein adaptives KI-Interview. Das LLM wählt die Fragen, das Formular begrenzt das Gespräch auf fünf Antworten.

Tags: Anwendungsfall, Konzeptdemo, Mini-Apps, Actor-Funktionen, Actor-Zustand.

```json
{
  "id": "ragents.reference.250-balcony-wizard",
  "owner": "ragents.reference",
  "title": "Balkon-Wizard",
  "description": "Zeigt den Aufbau einer eigenständigen Mini-App für ein adaptives KI-Interview. Das LLM wählt die Fragen, das Formular begrenzt das Gespräch auf fünf Antworten.",
  "order": 250,
  "tags": [
    "Anwendungsfall",
    "Konzeptdemo",
    "Mini-Apps",
    "Actor-Funktionen",
    "Actor-Zustand"
  ],
  "action": "skill",
  "skill": "250-balcony-wizard",
  "category": "Mini-Apps",
  "prompt": "Ich hätte gern einen Balkon-Wizard als eigenständige App auf dem Canvas. Sie vermittelt ein begrenztes Gespräch mit einem KI-Berater im Hintergrund. Nach jeder Antwort wählt das LLM die nächste passende Frage, keine feste Fragenliste. Nach fünf Antworten gibt es Gestaltungstipps. Ich antworte nur in der App; sie zeigt Frage, Fortschritt, Lade- und Fehlerzustände. Nutze gemeinsame Layouts und Formulare. Keine App in einer LLM-Chatkarte."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/250-balcony-wizard/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Balkon-Wizard",
  "message": "Nutze den Skill 250-balcony-wizard für diesen Auftrag.\n\nIch hätte gern einen Balkon-Wizard als eigenständige App auf dem Canvas. Sie vermittelt ein begrenztes Gespräch mit einem KI-Berater im Hintergrund. Nach jeder Antwort wählt das LLM die nächste passende Frage, keine feste Fragenliste. Nach fünf Antworten gibt es Gestaltungstipps. Ich antworte nur in der App; sie zeigt Frage, Fortschritt, Lade- und Fehlerzustände. Nutze gemeinsame Layouts und Formulare. Keine App in einer LLM-Chatkarte."
}
```

### Kategorie: Zusammenarbeit

<a id="start-ragents.reference.20-circle-of-four"></a>

### ragents.reference.20-circle-of-four: Eine Liste durch vier KI-Helfer reichen

Zeigt beim Aufbau eines Wortspiels, wie vier KI-Helfer nacheinander beitragen und ein TypeScript-Actor die Weitergabe nach zwölf Wörtern beendet.

Tags: Anwendungsfall, Konzeptdemo, Agententeams, TypeScript-Actors, Subscriptions.

```json
{
  "id": "ragents.reference.20-circle-of-four",
  "owner": "ragents.reference",
  "title": "Eine Liste durch vier KI-Helfer reichen",
  "description": "Zeigt beim Aufbau eines Wortspiels, wie vier KI-Helfer nacheinander beitragen und ein TypeScript-Actor die Weitergabe nach zwölf Wörtern beendet.",
  "order": 20,
  "tags": [
    "Anwendungsfall",
    "Konzeptdemo",
    "Agententeams",
    "TypeScript-Actors",
    "Subscriptions"
  ],
  "action": "skill",
  "skill": "20-circle-of-four",
  "category": "Zusammenarbeit",
  "prompt": "Ich hätte gern vier KIs mit den Namen rot, gelb, blau und grün, die reihum ein Wortspiel spielen: jede hängt ein Wort an, das ihr zum zuletzt genannten einfällt. Nach zwölf Beiträgen ist Schluss, und ich will die fertige Liste als Dokument sehen."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/20-circle-of-four/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Eine Liste durch vier KI-Helfer reichen",
  "message": "Nutze den Skill 20-circle-of-four für diesen Auftrag.\n\nIch hätte gern vier KIs mit den Namen rot, gelb, blau und grün, die reihum ein Wortspiel spielen: jede hängt ein Wort an, das ihr zum zuletzt genannten einfällt. Nach zwölf Beiträgen ist Schluss, und ich will die fertige Liste als Dokument sehen."
}
```

<a id="start-ragents.reference.decision-brief"></a>

### ragents.reference.decision-brief: Entscheidung klären

Zeigt, wie eine wiederverwendbare Skill-Anleitung eine Entscheidung im Chat von Kriterien zur Auswahl führt, ohne zusätzliche Actors oder Scripts anzulegen.

Tags: Anwendungsfall, Konzeptdemo, Skills.

```json
{
  "id": "ragents.reference.decision-brief",
  "owner": "ragents.reference",
  "title": "Entscheidung klären",
  "description": "Zeigt, wie eine wiederverwendbare Skill-Anleitung eine Entscheidung im Chat von Kriterien zur Auswahl führt, ohne zusätzliche Actors oder Scripts anzulegen.",
  "order": 20,
  "tags": [
    "Anwendungsfall",
    "Konzeptdemo",
    "Skills"
  ],
  "action": "skill",
  "skill": "decision-brief",
  "category": "Zusammenarbeit",
  "prompt": "Ich hätte gern Hilfe dabei, eine offene Entscheidung zu klären und den nächsten Schritt festzuhalten."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/decision-brief/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Entscheidung klären",
  "message": "Nutze den Skill decision-brief für diesen Auftrag.\n\nIch hätte gern Hilfe dabei, eine offene Entscheidung zu klären und den nächsten Schritt festzuhalten."
}
```

<a id="start-ragents.reference.30-llm-without-runtime-knowledge"></a>

### ragents.reference.30-llm-without-runtime-knowledge: Eine Nachricht überbringen lassen

Zeigt eine einseitige Weiterleitung zwischen zwei KI-Helfern, die den Ablauf und den anderen Teilnehmer nicht kennen.

Tags: Konzeptdemo, Agententeams, Subscriptions, Actor-Stopp.

```json
{
  "id": "ragents.reference.30-llm-without-runtime-knowledge",
  "owner": "ragents.reference",
  "title": "Eine Nachricht überbringen lassen",
  "description": "Zeigt eine einseitige Weiterleitung zwischen zwei KI-Helfern, die den Ablauf und den anderen Teilnehmer nicht kennen.",
  "order": 30,
  "tags": [
    "Konzeptdemo",
    "Agententeams",
    "Subscriptions",
    "Actor-Stopp"
  ],
  "action": "skill",
  "skill": "30-llm-without-runtime-knowledge",
  "category": "Zusammenarbeit",
  "prompt": "Ich hätte gern zwei KIs, anna und ben, die sich genau einmal freundlich begrüßen, ohne voneinander oder von der Technik dahinter zu wissen: anna sagt einen herzlichen Satz, ben antwortet einmal darauf, danach ist Schluss. Sag mir hinterher kurz, dass wirklich nur in diese eine Richtung weitergereicht wurde und danach alles wieder aufgeräumt ist."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/30-llm-without-runtime-knowledge/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Eine Nachricht überbringen lassen",
  "message": "Nutze den Skill 30-llm-without-runtime-knowledge für diesen Auftrag.\n\nIch hätte gern zwei KIs, anna und ben, die sich genau einmal freundlich begrüßen, ohne voneinander oder von der Technik dahinter zu wissen: anna sagt einen herzlichen Satz, ben antwortet einmal darauf, danach ist Schluss. Sag mir hinterher kurz, dass wirklich nur in diese eine Richtung weitergereicht wurde und danach alles wieder aufgeräumt ist."
}
```

<a id="start-ragents.reference.learning-sprint"></a>

### ragents.reference.learning-sprint: Lernziel in Etappen

Zeigt, wie eine wiederverwendbare Skill-Anleitung eine Lerneinheit im Chat an tatsächliche Antworten anpasst, ohne zusätzliche Actors oder Scripts anzulegen.

Tags: Anwendungsfall, Konzeptdemo, Skills.

```json
{
  "id": "ragents.reference.learning-sprint",
  "owner": "ragents.reference",
  "title": "Lernziel in Etappen",
  "description": "Zeigt, wie eine wiederverwendbare Skill-Anleitung eine Lerneinheit im Chat an tatsächliche Antworten anpasst, ohne zusätzliche Actors oder Scripts anzulegen.",
  "order": 30,
  "tags": [
    "Anwendungsfall",
    "Konzeptdemo",
    "Skills"
  ],
  "action": "skill",
  "skill": "learning-sprint",
  "category": "Zusammenarbeit",
  "prompt": "Ich hätte gern eine kurze Lerneinheit mit einer passenden Übung und einem nächsten Lernschritt."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/learning-sprint/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Lernziel in Etappen",
  "message": "Nutze den Skill learning-sprint für diesen Auftrag.\n\nIch hätte gern eine kurze Lerneinheit mit einer passenden Übung und einem nächsten Lernschritt."
}
```

<a id="start-ragents.reference.110-all-card-slots"></a>

### ragents.reference.110-all-card-slots: Rückfrage, Aufgaben und Dokument zusammen sehen

Zeigt, wie Aufgabenstand, Dokument und eine offene Rückfrage gleichzeitig an einer Agentenkarte sichtbar bleiben.

Tags: Rückfragen, To-dos, Konzeptdemo.

```json
{
  "id": "ragents.reference.110-all-card-slots",
  "owner": "ragents.reference",
  "title": "Rückfrage, Aufgaben und Dokument zusammen sehen",
  "description": "Zeigt, wie Aufgabenstand, Dokument und eine offene Rückfrage gleichzeitig an einer Agentenkarte sichtbar bleiben.",
  "order": 110,
  "tags": [
    "Rückfragen",
    "To-dos",
    "Konzeptdemo"
  ],
  "action": "skill",
  "skill": "110-all-card-slots",
  "category": "Zusammenarbeit",
  "prompt": "Ich hätte gern eine KI, die mir drei Aufgaben notiert - eine erledigte, eine in Arbeit und eine offene -, dazu ein kurzes Dokument schreibt und mich zum Schluss fragt, ob sie den offenen Punkt als Nächstes angehen soll. Antworte diese Frage nicht für mich, sondern halt dort an, damit ich Aufgabenliste, Dokument und Frage zusammen sehe und selbst antworten kann."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/110-all-card-slots/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Rückfrage, Aufgaben und Dokument zusammen sehen",
  "message": "Nutze den Skill 110-all-card-slots für diesen Auftrag.\n\nIch hätte gern eine KI, die mir drei Aufgaben notiert - eine erledigte, eine in Arbeit und eine offene -, dazu ein kurzes Dokument schreibt und mich zum Schluss fragt, ob sie den offenen Punkt als Nächstes angehen soll. Antworte diese Frage nicht für mich, sondern halt dort an, damit ich Aufgabenliste, Dokument und Frage zusammen sehe und selbst antworten kann."
}
```

<a id="start-ragents.reference.210-moderator-handover"></a>

### ragents.reference.210-moderator-handover: Gespräch an einen Moderator übergeben

Zeigt die Übergabe eines laufenden Chats an einen anderen Primary-Actor. Der Moderator übernimmt als direkter Ansprechpartner und hält den Aufgabenfortschritt fest.

Tags: Rückfragen, To-dos, Anwendungsfall, Konzeptdemo, Agententeams, Primary-Actor.

```json
{
  "id": "ragents.reference.210-moderator-handover",
  "owner": "ragents.reference",
  "title": "Gespräch an einen Moderator übergeben",
  "description": "Zeigt die Übergabe eines laufenden Chats an einen anderen Primary-Actor. Der Moderator übernimmt als direkter Ansprechpartner und hält den Aufgabenfortschritt fest.",
  "order": 210,
  "tags": [
    "Rückfragen",
    "To-dos",
    "Anwendungsfall",
    "Konzeptdemo",
    "Agententeams",
    "Primary-Actor"
  ],
  "action": "skill",
  "skill": "210-moderator-handover",
  "category": "Zusammenarbeit",
  "prompt": "Ich hätte gern einen Workshop für einen ruhigeren Arbeitstag: Ein Planer bringt zwei Ideen mit, ein skeptischer Gast prüft die Nachteile. Ein Moderator übernimmt die Runde und spricht danach direkt mit mir im Chat, damit ich einen Vorschlag auswählen kann. Zeig die drei auf der Fläche und übergib das Gespräch wirklich an den Moderator. Seine Aufgabenliste zeigt den Fortschritt."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/210-moderator-handover/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Gespräch an einen Moderator übergeben",
  "message": "Nutze den Skill 210-moderator-handover für diesen Auftrag.\n\nIch hätte gern einen Workshop für einen ruhigeren Arbeitstag: Ein Planer bringt zwei Ideen mit, ein skeptischer Gast prüft die Nachteile. Ein Moderator übernimmt die Runde und spricht danach direkt mit mir im Chat, damit ich einen Vorschlag auswählen kann. Zeig die drei auf der Fläche und übergib das Gespräch wirklich an den Moderator. Seine Aufgabenliste zeigt den Fortschritt."
}
```

### Kategorie: Ereignisse und Abläufe

<a id="start-ragents.reference.35-actor-input-fifo"></a>

### ragents.reference.35-actor-input-fifo: Drei Aufträge der Reihe nach erledigen

Zeigt, ob während eines laufenden Turns eingereihte Aufträge getrennt und in Eingangsreihenfolge verarbeitet werden. Das Journal liefert die Belege.

Tags: Journalprüfung, Konzeptdemo, Input-Warteschlange.

```json
{
  "id": "ragents.reference.35-actor-input-fifo",
  "owner": "ragents.reference",
  "title": "Drei Aufträge der Reihe nach erledigen",
  "description": "Zeigt, ob während eines laufenden Turns eingereihte Aufträge getrennt und in Eingangsreihenfolge verarbeitet werden. Das Journal liefert die Belege.",
  "order": 35,
  "tags": [
    "Journalprüfung",
    "Konzeptdemo",
    "Input-Warteschlange"
  ],
  "action": "skill",
  "skill": "35-actor-input-fifo",
  "category": "Ereignisse und Abläufe",
  "prompt": "Ich hätte gern einen Helfer, der jeden Text, den ich ihm gebe, mit \"ERLEDIGT: \" und dem unveränderten Text beantwortet und beim Wort \"eins\" vorher ausgiebig nachdenkt. Während er noch an \"eins\" sitzt, schiebe ich ihm \"zwei\" und \"drei\" hinterher. Zeig mir danach mit Belegen, dass er alle drei sauber getrennt und genau in dieser Reihenfolge abgearbeitet hat und nichts vermischt wurde."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/35-actor-input-fifo/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Drei Aufträge der Reihe nach erledigen",
  "message": "Nutze den Skill 35-actor-input-fifo für diesen Auftrag.\n\nIch hätte gern einen Helfer, der jeden Text, den ich ihm gebe, mit \"ERLEDIGT: \" und dem unveränderten Text beantwortet und beim Wort \"eins\" vorher ausgiebig nachdenkt. Während er noch an \"eins\" sitzt, schiebe ich ihm \"zwei\" und \"drei\" hinterher. Zeig mir danach mit Belegen, dass er alle drei sauber getrennt und genau in dieser Reihenfolge abgearbeitet hat und nichts vermischt wurde."
}
```

<a id="start-ragents.reference.40-subscription-matrix"></a>

### ragents.reference.40-subscription-matrix: Gezielt bei anderen Helfern mithören

Zeigt, wie Abonnements nach Absender und Ereignisart filtern. Eine belegte Empfangstabelle macht passende und ausgeschlossene Ereignisse sichtbar.

Tags: Journalprüfung, Konzeptdemo, Subscriptions.

```json
{
  "id": "ragents.reference.40-subscription-matrix",
  "owner": "ragents.reference",
  "title": "Gezielt bei anderen Helfern mithören",
  "description": "Zeigt, wie Abonnements nach Absender und Ereignisart filtern. Eine belegte Empfangstabelle macht passende und ausgeschlossene Ereignisse sichtbar.",
  "order": 40,
  "tags": [
    "Journalprüfung",
    "Konzeptdemo",
    "Subscriptions"
  ],
  "action": "skill",
  "skill": "40-subscription-matrix",
  "category": "Ereignisse und Abläufe",
  "prompt": "Ich hätte gern drei KIs a, b und c und dazu zwei Zuhörer: der eine soll nur mitbekommen, was a und b sagen, der andere nur, wenn eine der drei tatsächlich etwas ausgeführt hat. Lass danach alle drei etwas sagen und mindestens eine wirklich etwas tun. Gib mir am Ende eine Tabelle, bei welchem Zuhörer was angekommen ist und was nicht, und belege sie."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/40-subscription-matrix/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Gezielt bei anderen Helfern mithören",
  "message": "Nutze den Skill 40-subscription-matrix für diesen Auftrag.\n\nIch hätte gern drei KIs a, b und c und dazu zwei Zuhörer: der eine soll nur mitbekommen, was a und b sagen, der andere nur, wenn eine der drei tatsächlich etwas ausgeführt hat. Lass danach alle drei etwas sagen und mindestens eine wirklich etwas tun. Gib mir am Ende eine Tabelle, bei welchem Zuhörer was angekommen ist und was nicht, und belege sie."
}
```

<a id="start-ragents.reference.50-subscription-removal"></a>

### ragents.reference.50-subscription-removal: Eine Weiterleitung wieder abschalten

Zeigt die Wirkung eines entfernten Abonnements: Die erste Nachricht kommt an, nach dem Abschalten endet die Weiterleitung.

Tags: Konzeptdemo, Subscriptions.

```json
{
  "id": "ragents.reference.50-subscription-removal",
  "owner": "ragents.reference",
  "title": "Eine Weiterleitung wieder abschalten",
  "description": "Zeigt die Wirkung eines entfernten Abonnements: Die erste Nachricht kommt an, nach dem Abschalten endet die Weiterleitung.",
  "order": 50,
  "tags": [
    "Konzeptdemo",
    "Subscriptions"
  ],
  "action": "skill",
  "skill": "50-subscription-removal",
  "category": "Ereignisse und Abläufe",
  "prompt": "Ich hätte gern drei KIs: eine Quelle, eine Senke und eine dazwischen, die jedes Wort der Quelle wortgleich an die Senke durchreicht. Lass die Quelle zuerst \"eins\" sagen, nimm der mittleren danach das Mithören wieder weg und lass die Quelle \"zwei\" sagen. Erklär mir mit Belegen, was beim zweiten Mal passiert und ob bei der Senke noch etwas ankommt."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/50-subscription-removal/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Eine Weiterleitung wieder abschalten",
  "message": "Nutze den Skill 50-subscription-removal für diesen Auftrag.\n\nIch hätte gern drei KIs: eine Quelle, eine Senke und eine dazwischen, die jedes Wort der Quelle wortgleich an die Senke durchreicht. Lass die Quelle zuerst \"eins\" sagen, nimm der mittleren danach das Mithören wieder weg und lass die Quelle \"zwei\" sagen. Erklär mir mit Belegen, was beim zweiten Mal passiert und ob bei der Senke noch etwas ankommt."
}
```

<a id="start-ragents.reference.60-stop-in-the-circle"></a>

### ragents.reference.60-stop-in-the-circle: Einen Helfer in der Gesprächsrunde stoppen

Zeigt, wie der Stopp eines Actors eine Übergabekette unterbricht und was nachfolgende Actors noch erhalten.

Tags: Journalprüfung, Konzeptdemo, Actor-Stopp.

```json
{
  "id": "ragents.reference.60-stop-in-the-circle",
  "owner": "ragents.reference",
  "title": "Einen Helfer in der Gesprächsrunde stoppen",
  "description": "Zeigt, wie der Stopp eines Actors eine Übergabekette unterbricht und was nachfolgende Actors noch erhalten.",
  "order": 60,
  "tags": [
    "Journalprüfung",
    "Konzeptdemo",
    "Actor-Stopp"
  ],
  "action": "skill",
  "skill": "60-stop-in-the-circle",
  "category": "Ereignisse und Abläufe",
  "prompt": "Ich hätte gern vier KIs rot, gelb, blau und grün, die im Kreis eine Liste weiterreichen und jede eine eigene Zeile anhängt. Sobald die Liste einmal ganz herum war, schalte blau ab. Erzähl mir mit Belegen, woran die nächste Runde scheitert und ob grün danach überhaupt noch etwas bekommt."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/60-stop-in-the-circle/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Einen Helfer in der Gesprächsrunde stoppen",
  "message": "Nutze den Skill 60-stop-in-the-circle für diesen Auftrag.\n\nIch hätte gern vier KIs rot, gelb, blau und grün, die im Kreis eine Liste weiterreichen und jede eine eigene Zeile anhängt. Sobald die Liste einmal ganz herum war, schalte blau ab. Erzähl mir mit Belegen, woran die nächste Runde scheitert und ob grün danach überhaupt noch etwas bekommt."
}
```

### Kategorie: Dateien und Ergebnisse

<a id="start-ragents.reference.65-artifact-least-privilege"></a>

### ragents.reference.65-artifact-least-privilege: Eine Notiz gezielt weitergeben

Zeigt, wie die ausdrückliche Weitergabe einer Notiz den Lesezugriff steuert und ein abgelehnter Zugriff die Freigabe unverändert lässt.

Tags: Konzeptdemo, Artefakte und Zugriff.

```json
{
  "id": "ragents.reference.65-artifact-least-privilege",
  "owner": "ragents.reference",
  "title": "Eine Notiz gezielt weitergeben",
  "description": "Zeigt, wie die ausdrückliche Weitergabe einer Notiz den Lesezugriff steuert und ein abgelehnter Zugriff die Freigabe unverändert lässt.",
  "order": 65,
  "tags": [
    "Konzeptdemo",
    "Artefakte und Zugriff"
  ],
  "action": "skill",
  "skill": "65-artifact-least-privilege",
  "category": "Dateien und Ergebnisse",
  "prompt": "Ich hätte gern drei KIs: die erste schreibt eine kurze geheime Notiz und gibt sie ausdrücklich an die zweite weiter, die dritte erfährt nur, dass es die Notiz gibt. Prüf für mich, wer sie wirklich lesen kann und wer nicht, und ob der abgelehnte Versuch daran etwas ändert. Den Inhalt der Notiz schreibst Du mir dabei nicht noch einmal hin."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/65-artifact-least-privilege/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Eine Notiz gezielt weitergeben",
  "message": "Nutze den Skill 65-artifact-least-privilege für diesen Auftrag.\n\nIch hätte gern drei KIs: die erste schreibt eine kurze geheime Notiz und gibt sie ausdrücklich an die zweite weiter, die dritte erfährt nur, dass es die Notiz gibt. Prüf für mich, wer sie wirklich lesen kann und wer nicht, und ob der abgelehnte Versuch daran etwas ändert. Den Inhalt der Notiz schreibst Du mir dabei nicht noch einmal hin."
}
```

### Kategorie: TypeScript ohne Oberfläche

<a id="start-ragents.reference.70-headless-counter"></a>

### ragents.reference.70-headless-counter: Nachrichten ohne KI mitzählen

Zeigt einen dauerhaften TypeScript-Actor ohne Oberfläche: Er verarbeitet Nachrichten getrennt und behält Liste und Zähler zwischen Aufträgen.

Tags: Anwendungsfall, Konzeptdemo, TypeScript-Actors, Actor-Funktionen, Actor-Zustand, Journalprüfung.

```json
{
  "id": "ragents.reference.70-headless-counter",
  "owner": "ragents.reference",
  "title": "Nachrichten ohne KI mitzählen",
  "description": "Zeigt einen dauerhaften TypeScript-Actor ohne Oberfläche: Er verarbeitet Nachrichten getrennt und behält Liste und Zähler zwischen Aufträgen.",
  "order": 70,
  "tags": [
    "Anwendungsfall",
    "Konzeptdemo",
    "TypeScript-Actors",
    "Actor-Funktionen",
    "Actor-Zustand",
    "Journalprüfung"
  ],
  "action": "skill",
  "skill": "70-headless-counter",
  "category": "TypeScript ohne Oberfläche",
  "prompt": "Ich hätte gern einen kleinen TypeScript-Zähler ohne Oberfläche und ohne KI-Aufrufe. Schicke ihm nacheinander die Texte \"eins\", \"zwei\" und \"drei\". Er soll jeden Text in seiner eigenen Liste behalten und mitzählen. Danach lies seinen Stand aus und belege, dass drei getrennte Eingaben verarbeitet wurden. Der Zähler soll für weitere Texte bereitbleiben."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/70-headless-counter/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Nachrichten ohne KI mitzählen",
  "message": "Nutze den Skill 70-headless-counter für diesen Auftrag.\n\nIch hätte gern einen kleinen TypeScript-Zähler ohne Oberfläche und ohne KI-Aufrufe. Schicke ihm nacheinander die Texte \"eins\", \"zwei\" und \"drei\". Er soll jeden Text in seiner eigenen Liste behalten und mitzählen. Danach lies seinen Stand aus und belege, dass drei getrennte Eingaben verarbeitet wurden. Der Zähler soll für weitere Texte bereitbleiben."
}
```

### Kategorie: Code und Diagnose

<a id="start-ragents.reference.75-lsp-demo"></a>

### ragents.reference.75-lsp-demo: Fehler in C# und TypeScript finden

Zeigt echte Sprachdiagnosen in C# und TypeScript und wie die gemeldeten Fehler nach ihrer Korrektur verschwinden.

Tags: Konzeptdemo, Sprachprüfung.

```json
{
  "id": "ragents.reference.75-lsp-demo",
  "owner": "ragents.reference",
  "title": "Fehler in C# und TypeScript finden",
  "description": "Zeigt echte Sprachdiagnosen in C# und TypeScript und wie die gemeldeten Fehler nach ihrer Korrektur verschwinden.",
  "order": 75,
  "tags": [
    "Konzeptdemo",
    "Sprachprüfung"
  ],
  "action": "skill",
  "skill": "75-lsp-demo",
  "category": "Code und Diagnose",
  "prompt": "Ich hätte gern eine kleine Vorführung der eingebauten Sprachprüfung: Lege zwei winzige Wegwerf-Projekte an, eines in C# und eines in TypeScript, und baue in beide einen absichtlichen Fehler ein. Zeig mir, wie die Sprachprüfung die Fehler findet und was sie genau meldet. Danach behebst Du beide Fehler, zeigst, dass nichts mehr angemeckert wird, und räumst die Projekte wieder weg."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/75-lsp-demo/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Fehler in C# und TypeScript finden",
  "message": "Nutze den Skill 75-lsp-demo für diesen Auftrag.\n\nIch hätte gern eine kleine Vorführung der eingebauten Sprachprüfung: Lege zwei winzige Wegwerf-Projekte an, eines in C# und eines in TypeScript, und baue in beide einen absichtlichen Fehler ein. Zeig mir, wie die Sprachprüfung die Fehler findet und was sie genau meldet. Danach behebst Du beide Fehler, zeigst, dass nichts mehr angemeckert wird, und räumst die Projekte wieder weg."
}
```

<a id="start-ragents.reference.200-typescript-diagnostics"></a>

### ragents.reference.200-typescript-diagnostics: Fehler in einer Terminliste finden

Zeigt an einer TypeScript-Terminliste, wie sich echte Sprachdiagnosen nach jeder einzelnen Korrektur ändern. Das korrigierte Beispiel bleibt zum Nachlesen erhalten.

Tags: Anwendungsfall, Konzeptdemo, Sprachprüfung.

```json
{
  "id": "ragents.reference.200-typescript-diagnostics",
  "owner": "ragents.reference",
  "title": "Fehler in einer Terminliste finden",
  "description": "Zeigt an einer TypeScript-Terminliste, wie sich echte Sprachdiagnosen nach jeder einzelnen Korrektur ändern. Das korrigierte Beispiel bleibt zum Nachlesen erhalten.",
  "order": 200,
  "tags": [
    "Anwendungsfall",
    "Konzeptdemo",
    "Sprachprüfung"
  ],
  "action": "skill",
  "skill": "200-typescript-diagnostics",
  "category": "Code und Diagnose",
  "prompt": "Ich hätte gern eine kleine TypeScript-Terminliste mit zwei absichtlichen Typfehlern. Lass die Sprachprüfung beide finden und korrigiere sie einzeln. Nach jeder Korrektur möchte ich den echten Befund sehen. Am Ende bleiben das korrigierte Beispiel und ein kurzer Vergleich zum Nachlesen. Falls die Sprachprüfung fehlt, sag das klar."
}
```

[Arbeitsanleitung des Skills](../../plugins/ragents.reference/skills/200-typescript-diagnostics/SKILL.md)

Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.

```json
{
  "title": "Fehler in einer Terminliste finden",
  "message": "Nutze den Skill 200-typescript-diagnostics für diesen Auftrag.\n\nIch hätte gern eine kleine TypeScript-Terminliste mit zwei absichtlichen Typfehlern. Lass die Sprachprüfung beide finden und korrigiere sie einzeln. Nach jeder Korrektur möchte ich den echten Befund sehen. Am Ende bleiben das korrigierte Beispiel und ein kurzer Vergleich zum Nachlesen. Falls die Sprachprüfung fehlt, sag das klar."
}
```

### Kategorie: Prepared workflows

<a id="start-ragents.reference.shared-actor-list"></a>

### ragents.reference.shared-actor-list: Sammelboard einrichten

Ein vorbereitetes Setup zeigt einen LLM-Listenhelfer mit eigener Funktion, Mini-App und gemeinsamem Zustand. Ein Startleitfaden legt Titel und ersten Eintrag fest.

Tags: Run-Scripts, Anwendungsfall, Konzeptdemo, Startleitfaden, Actor-Funktionen, Actor-Zustand, Mini-Apps, LLM-Actor mit View.

```json
{
  "id": "ragents.reference.shared-actor-list",
  "owner": "ragents.reference",
  "title": "Sammelboard einrichten",
  "description": "Ein vorbereitetes Setup zeigt einen LLM-Listenhelfer mit eigener Funktion, Mini-App und gemeinsamem Zustand. Ein Startleitfaden legt Titel und ersten Eintrag fest.",
  "order": 100,
  "guide": "ragents.reference.shared-actor-list",
  "tags": [
    "Run-Scripts",
    "Anwendungsfall",
    "Konzeptdemo",
    "Startleitfaden",
    "Actor-Funktionen",
    "Actor-Zustand",
    "Mini-Apps",
    "LLM-Actor mit View"
  ],
  "action": "script",
  "coordinator": true
}
```

Vollständige Paketquellen stehen in [run-setup.md](run-setup.md).

<a id="start-ragents.reference.conversation-circle"></a>

### ragents.reference.conversation-circle: Gesprächsrunde einrichten

Ein vorbereitetes Setup zeigt die Parametrisierung durch einen Startleitfaden und die Anordnung einer Gesprächsrunde. Der Koordinator führt anschließend die Runden.

Tags: Run-Scripts, Anwendungsfall, Konzeptdemo, Startleitfaden, Agententeams.

```json
{
  "id": "ragents.reference.conversation-circle",
  "owner": "ragents.reference",
  "title": "Gesprächsrunde einrichten",
  "description": "Ein vorbereitetes Setup zeigt die Parametrisierung durch einen Startleitfaden und die Anordnung einer Gesprächsrunde. Der Koordinator führt anschließend die Runden.",
  "order": 120,
  "guide": "ragents.reference.conversation-circle",
  "tags": [
    "Run-Scripts",
    "Anwendungsfall",
    "Konzeptdemo",
    "Startleitfaden",
    "Agententeams"
  ],
  "action": "script",
  "coordinator": true
}
```

Vollständige Paketquellen stehen in [run-setup.md](run-setup.md).

<a id="start-ragents.reference.moderated-round"></a>

### ragents.reference.moderated-round: Moderierte Runde ohne Koordinator

Ein vorbereiteter Aufbau zeigt einen Run, der von Anfang an ohne Koordinator arbeitet. Der Moderator wird Primary-Actor und direkter Ansprechpartner im Chat.

Tags: Run-Scripts, Anwendungsfall, Konzeptdemo, Primary-Actor, Agententeams.

```json
{
  "id": "ragents.reference.moderated-round",
  "owner": "ragents.reference",
  "title": "Moderierte Runde ohne Koordinator",
  "description": "Ein vorbereiteter Aufbau zeigt einen Run, der von Anfang an ohne Koordinator arbeitet. Der Moderator wird Primary-Actor und direkter Ansprechpartner im Chat.",
  "order": 130,
  "tags": [
    "Run-Scripts",
    "Anwendungsfall",
    "Konzeptdemo",
    "Primary-Actor",
    "Agententeams"
  ],
  "action": "script",
  "coordinator": false
}
```

Vollständige Paketquellen stehen in [run-setup.md](run-setup.md).

<a id="start-ragents.reference.balcony-wizard"></a>

### ragents.reference.balcony-wizard: Balkon-Wizard einrichten

Ein vorbereitetes KI-Interview zeigt adaptive Fragen in einer eigenen Mini-App. Der Berater ist von Anfang an Primary-Actor; das Formular zählt fünf Antworten.

Tags: Run-Scripts, Anwendungsfall, Konzeptdemo, Mini-Apps, LLM-Actor mit View, Frei gesteuerter Chat, Primary-Actor.

```json
{
  "id": "ragents.reference.balcony-wizard",
  "owner": "ragents.reference",
  "title": "Balkon-Wizard einrichten",
  "description": "Ein vorbereitetes KI-Interview zeigt adaptive Fragen in einer eigenen Mini-App. Der Berater ist von Anfang an Primary-Actor; das Formular zählt fünf Antworten.",
  "order": 140,
  "tags": [
    "Run-Scripts",
    "Anwendungsfall",
    "Konzeptdemo",
    "Mini-Apps",
    "LLM-Actor mit View",
    "Frei gesteuerter Chat",
    "Primary-Actor"
  ],
  "action": "script",
  "coordinator": false
}
```

Vollständige Paketquellen stehen in [run-setup.md](run-setup.md).

<a id="start-ragents.reference.learning-afternoon"></a>

### ragents.reference.learning-afternoon: Lernnachmittag

Eine vorbereitete Parallelrunde zeigt zwei unabhängig arbeitende KI-Helfer und einen TypeScript-Sammler. Die Mini-App übernimmt einmalig je eine Antwort.

Tags: Run-Scripts, Anwendungsfall, Konzeptdemo, Mini-Apps, TypeScript-Actors, Agententeams, Subscriptions, Primary-Actor.

```json
{
  "id": "ragents.reference.learning-afternoon",
  "owner": "ragents.reference",
  "title": "Lernnachmittag",
  "description": "Eine vorbereitete Parallelrunde zeigt zwei unabhängig arbeitende KI-Helfer und einen TypeScript-Sammler. Die Mini-App übernimmt einmalig je eine Antwort.",
  "order": 150,
  "tags": [
    "Run-Scripts",
    "Anwendungsfall",
    "Konzeptdemo",
    "Mini-Apps",
    "TypeScript-Actors",
    "Agententeams",
    "Subscriptions",
    "Primary-Actor"
  ],
  "action": "script",
  "coordinator": false
}
```

Vollständige Paketquellen stehen in [run-setup.md](run-setup.md).

<a id="start-ragents.reference.word-game"></a>

### ragents.reference.word-game: Wortspiel starten

Ein vorbereitetes Wortspiel zeigt, wie ein TypeScript-Actor Reihenfolge und Ende festlegt, während vier LLMs die Wörter liefern. Die Mini-App macht den Fortschritt sichtbar.

Tags: Run-Scripts, Anwendungsfall, Konzeptdemo, Mini-Apps, TypeScript-Actors, Agententeams, Subscriptions.

```json
{
  "id": "ragents.reference.word-game",
  "owner": "ragents.reference",
  "title": "Wortspiel starten",
  "description": "Ein vorbereitetes Wortspiel zeigt, wie ein TypeScript-Actor Reihenfolge und Ende festlegt, während vier LLMs die Wörter liefern. Die Mini-App macht den Fortschritt sichtbar.",
  "order": 150,
  "tags": [
    "Run-Scripts",
    "Anwendungsfall",
    "Konzeptdemo",
    "Mini-Apps",
    "TypeScript-Actors",
    "Agententeams",
    "Subscriptions"
  ],
  "action": "script",
  "coordinator": false
}
```

Vollständige Paketquellen stehen in [run-setup.md](run-setup.md).

## Plugins

```json
[
  {
    "id": "ragents.orchestration",
    "requires": []
  },
  {
    "id": "ragents.workspace",
    "requires": []
  },
  {
    "id": "ragents.product",
    "requires": [
      "ragents.orchestration",
      "ragents.workspace"
    ]
  },
  {
    "id": "ragents.overseer",
    "requires": []
  },
  {
    "id": "ragents.activity",
    "requires": []
  },
  {
    "id": "ragents.processes",
    "requires": []
  },
  {
    "id": "ragents.documents",
    "requires": [
      "ragents.orchestration"
    ]
  },
  {
    "id": "ragents.browser",
    "requires": [
      "ragents.documents"
    ]
  },
  {
    "id": "ragents.ask",
    "requires": []
  },
  {
    "id": "ragents.todo",
    "requires": []
  },
  {
    "id": "ragents.watch",
    "requires": [
      "ragents.orchestration"
    ]
  },
  {
    "id": "ragents.transcript",
    "requires": [
      "ragents.orchestration"
    ]
  },
  {
    "id": "ragents.actor-programs",
    "requires": [
      "ragents.orchestration",
      "ragents.ask"
    ]
  },
  {
    "id": "ragents.reference",
    "requires": [
      "ragents.orchestration",
      "ragents.actor-programs"
    ]
  },
  {
    "id": "ragents.lsp-roslyn",
    "requires": []
  },
  {
    "id": "ragents.lsp-fsharp",
    "requires": []
  },
  {
    "id": "ragents.lsp-typescript",
    "requires": []
  },
  {
    "id": "ragents.model-relay",
    "requires": []
  },
  {
    "id": "ragents.profile-distribution",
    "requires": []
  }
]
```

## Dynamische Werkzeugbeiträge

```json
[
  "ragents.actor-programs.functions"
]
```
