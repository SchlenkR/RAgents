# RAgents: building block reference

> Public tools, operations, actor program templates, and Start page templates of the showcase profile, generated from the actual contracts.

[Run setup guide and complete packages](run-setup.md) | [Developer reference](developer.md) | [JSON-RPC-API](rpc-api.md) | [LLM index](llms.txt)

## Functions and native tools

Domain functions are called in snippets and actor programs through context.functions. Equipped LLM actors automatically receive the function names available to them with short descriptions. typescript_api returns their types and optional long descriptions on request by name, typescript_eval executes snippets. This is the static inventory. Availability and selection depend on actor, grants, and run. Custom actor functions extend this inventory during a run.

### actor_input

Enqueue Actor Input

Send plain text and optional artifacts to one existing actor of this run, such as a task, an answer or a question; it receives no routing envelope.

It reaches an actor that already exists; agent_spawn creates a new one. This only confirms enqueueing, not processing, an answer or completion; an answer reaches you only as a later input, for example through a subscription to the recipient's events. An agent in the middle of a turn receives the text in that turn before its next model request; otherwise it starts the agent's next turn. Agents interpret natural language. TypeScript actors only process their programmed input protocol: use their documented functions, or send an exact supported program input after inspecting the program. Never address an unknown script with a natural-language task or assume an idle or completed turn means the requested work happened.

Owner: engine. Scope: per-turn. Native model tool: yes. Availability: conditional.

Only with the capability actor.input.

#### Input

```json
{
  "type": "object",
  "required": [
    "to",
    "message"
  ],
  "properties": {
    "to": {
      "type": "string",
      "minLength": 1,
      "description": "Recipient: the @handle or ID of an actor of this run, as actor_list or agent_spawn name it; an address is room.name, a bare name means your room, otherwise the main room"
    },
    "message": {
      "type": "string",
      "minLength": 1,
      "description": "Plain text the recipient receives as it is, without your context"
    },
    "artifactIds": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "uniqueItems": true,
      "description": "Artifacts to attach; the sender must be able to read them, and the recipient may read them afterwards"
    }
  },
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "array",
  "items": {
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
            "description": "ID of the enqueued input"
          },
          "actorId": {
            "type": "string",
            "description": "ID of the receiving actor"
          }
        },
        "additionalProperties": false
      }
    },
    "additionalProperties": false
  },
  "description": "The journal events of this call. The payload names the ids of the result; it does not repeat inputs and hashes."
}
```

### actor_list

List Actors

List existing actors with their identity, lifecycle and the size of their function selection.

Check before spawning: reuse suitable participants, including actors created by a setup or another actor. Only kind agent is a conversational partner. A script executes its programmed input protocol; it does not interpret arbitrary natural-language requests. Inspect its documented functions or program before using it. toolNames: true also lists the names of each fixed selection. An actor's address is room.name, the main room has no prefix; handle is written from your room, so it is exactly what actor_input and the other functions take.

Owner: engine. Scope: per-turn. Native model tool: yes. Availability: conditional.

Only with the capability actor.input.

#### Input

```json
{
  "type": "object",
  "properties": {
    "toolNames": {
      "type": "boolean",
      "description": "Also list the tool names of each actor with a fixed selection."
    }
  },
  "additionalProperties": false
}
```

#### Result

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
      "description",
      "toolCount"
    ],
    "properties": {
      "id": {
        "type": "string"
      },
      "handle": {
        "type": "string",
        "description": "The actor's address from your room: its handle, prefixed with room. when it stands in another room than yours and not in the main room"
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
      "description": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      },
      "toolCount": {
        "anyOf": [
          {
            "type": "integer",
            "minimum": 0
          },
          {
            "type": "null"
          }
        ],
        "description": "Number of selected tools; 0 is a plain LLM, null an open, dynamically resolved toolset."
      },
      "toolNames": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "description": "Only with toolNames: true, for a fixed selection."
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

Owner: ragents.actor-programs. Scope: per-turn. Native model tool: yes. Availability: conditional.

For executable actors with agent.spawn and plugin.state.write.

#### Input

```json
{
  "type": "object",
  "required": [
    "name"
  ],
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^(?:[a-z][a-z0-9-]{0,63}\\.)?[a-z][a-z0-9-]{0,63}$",
      "description": "Package under @actors/ to check, build, test and activate; a bare name means your room's package, otherwise the main room's, room.name another room's"
    },
    "actor": {
      "type": "string",
      "description": "self or @handle of an existing actor that takes the package; an activated package keeps its actor"
    }
  },
  "additionalProperties": false
}
```

#### Result

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
      "type": "string",
      "description": "@handle of the actor that holds the package"
    },
    "views": {
      "type": "number",
      "description": "Number of activated views"
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

Look up actor program guide and controls

Read Mini-App control contracts or the actor-program authoring guide.

With topic: guide, explain the TypeScript package workflow through actor_program_activate. Otherwise list control names, or select one component (for example Form) for only its TypeScript props and supporting types. Import controls from @ragents/client/ui and use these exact props.

Owner: ragents.actor-programs. Scope: per-turn. Native model tool: yes. Availability: always.

Typed UI reference of the installed actor program plugin.

#### Input

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

#### Result

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
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "files"
      ],
      "properties": {
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

Edit files in the returned directory using workspace tools: @actors/name, in a room @actors/room.name. The package belongs to your room.

Owner: ragents.actor-programs. Scope: per-turn. Native model tool: yes. Availability: conditional.

For executable actors with agent.spawn and plugin.state.write.

#### Input

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
      "pattern": "^[a-z][a-z0-9-]{0,63}$",
      "description": "Name of the new package: lowercase letters, digits and hyphens; its files go to @actors/name"
    },
    "template": {
      "anyOf": [
        {
          "type": "string",
          "const": "blank",
          "description": "A pure React view on the existing actor without an additional server function."
        },
        {
          "type": "string",
          "const": "chat",
          "description": "Reusable chat with history and optional input to the actor of this view."
        },
        {
          "type": "string",
          "const": "controls",
          "description": "Local demo with form, table, files, tasks, flow diagram, SVG connections, messages, document, and diff without function calls."
        },
        {
          "type": "string",
          "const": "text-analysis",
          "description": "A TypeScript actor analyzes texts with its own function, state, and React view."
        },
        {
          "type": "string",
          "const": "headless-counter",
          "description": "A TypeScript actor counts inputs in its state and offers the same work as a function."
        },
        {
          "type": "string",
          "const": "shared-list",
          "description": "An actor owns a function and a React view for the same list state."
        }
      ],
      "description": "Template for the first files"
    }
  },
  "additionalProperties": false
}
```

#### Result

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
      "type": "string",
      "description": "Package folder for the file tools and as bash cwd"
    },
    "files": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Created files relative to the package folder"
    }
  },
  "additionalProperties": false
}
```

### actor_program_diagnostics

Actor Program Diagnostics

Read the last project diagnostics.

Changed errors are automatically supplied before the next model request.

Owner: ragents.actor-programs. Scope: per-turn. Native model tool: yes. Availability: conditional.

For executable actors with agent.spawn and plugin.state.write.

#### Input

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^(?:[a-z][a-z0-9-]{0,63}\\.)?[a-z][a-z0-9-]{0,63}$",
      "description": "Only this package; omitted, every package checked for this actor; a bare name means your room's package, otherwise the main room's, room.name another room's"
    }
  },
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "string"
}
```

### actor_program_ensure

Ensure Actor Program

Make a package active once: return it when active, restart its stopped actor, activate it when installed, or install a shared package of the profile.

Safe to call on every start: an active package is returned unchanged and not rebuilt. status names what happened. actor_program_activate instead rebuilds and reactivates.

Owner: ragents.actor-programs. Scope: per-turn. Native model tool: yes. Availability: conditional.

For executable actors with agent.spawn and plugin.state.write.

#### Input

```json
{
  "type": "object",
  "required": [
    "name"
  ],
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^(?:[a-z][a-z0-9-]{0,63}\\.)?[a-z][a-z0-9-]{0,63}$",
      "description": "Package of this run or a shared actor package of the profile, which lives in the main room; a bare name means your room's package, otherwise the main room's, room.name another room's"
    }
  },
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "object",
  "required": [
    "actorId",
    "handle",
    "status"
  ],
  "properties": {
    "actorId": {
      "type": "string"
    },
    "handle": {
      "type": "string"
    },
    "status": {
      "anyOf": [
        {
          "type": "string",
          "const": "active"
        },
        {
          "type": "string",
          "const": "restarted"
        },
        {
          "type": "string",
          "const": "activated"
        },
        {
          "type": "string",
          "const": "installed"
        }
      ],
      "description": "active: already active, unchanged; restarted: its stopped actor was restarted; activated: built and activated from this run's package folder; installed: the shared package was installed"
    }
  },
  "additionalProperties": false
}
```

### actor_program_list

List Actor Programs

List active actor packages, functions and views.

A visible view is already open as a tab for the user. A view's ref is the package-name/view-key reference that view functions accept.

Owner: ragents.actor-programs. Scope: per-turn. Native model tool: yes. Availability: conditional.

For executable actors with agent.spawn and plugin.state.write.

#### Input

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

#### Result

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
            "ref",
            "title",
            "visible"
          ],
          "properties": {
            "name": {
              "type": "string"
            },
            "ref": {
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

Owner: ragents.actor-programs. Scope: per-turn. Native model tool: yes. Availability: conditional.

For executable actors with agent.spawn and plugin.state.write.

#### Input

```json
{
  "type": "object",
  "required": [
    "name"
  ],
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^(?:[a-z][a-z0-9-]{0,63}\\.)?[a-z][a-z0-9-]{0,63}$",
      "description": "Name of the active package; a bare name means your room's package, otherwise the main room's, room.name another room's"
    }
  },
  "additionalProperties": false
}
```

#### Result

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

Restart a stopped actor in this actor's branch. It becomes idle with its history and state unchanged and accepts inputs again.

An actor that is not stopped is refused. A stopped former primary actor becomes the primary actor again if no other was chosen in the meantime and this actor holds run.configure. Event subscriptions removed by the stop stay removed.

Owner: engine. Scope: per-turn. Native model tool: yes. Availability: conditional.

Only with the capability execution.stopOwned.

#### Input

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
      "description": "Handle or ID of the stopped actor"
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "description": "Why it restarts; recorded in the journal"
    }
  },
  "additionalProperties": false
}
```

#### Result

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
            "const": "actor.restarted"
          },
          "payload": {
            "type": "object",
            "required": [
              "actorId"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID of the restarted actor"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
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
                "description": "ID of the primary actor"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      }
    ]
  },
  "description": "The journal events of this call. The payload names the ids of the result; it does not repeat inputs and hashes."
}
```

### actor_stop

Stop Actor

Stop an actor in this actor's branch together with its active descendants.

Owner: engine. Scope: per-turn. Native model tool: yes. Availability: conditional.

Only with the capability execution.stopOwned.

#### Input

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
      "description": "Handle or ID"
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "description": "Why it stops; recorded in the journal and shown with the stopped actors"
    }
  },
  "additionalProperties": false
}
```

#### Result

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
            "const": "turn.interrupted"
          },
          "payload": {
            "type": "object",
            "required": [
              "turnId"
            ],
            "properties": {
              "turnId": {
                "type": "string",
                "description": "ID of the interrupted turn"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
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
              "actorId"
            ],
            "properties": {
              "actorId": {
                "type": "string",
                "description": "ID of the stopped actor"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
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
              "subscriptionId"
            ],
            "properties": {
              "subscriptionId": {
                "type": "string",
                "description": "ID of the removed subscription"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      }
    ]
  },
  "description": "The journal events of this call. The payload names the ids of the result; it does not repeat inputs and hashes."
}
```

### actor_view_set_visibility

Show or hide Actor View

Set surface visibility by package-name/view-key or @handle/view-key.

Use names you chose; the server resolves the view ID. A unique view title also works.

Owner: ragents.actor-programs. Scope: per-turn. Native model tool: yes. Availability: conditional.

For executable actors with agent.spawn and plugin.state.write.

#### Input

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
      "description": "package-name/view-key or @handle/view-key of an activated view, without the surface entity prefix app:. No generated IDs needed."
    },
    "visible": {
      "type": "boolean",
      "description": "true shows the view as a tab for the user, false hides it"
    }
  },
  "additionalProperties": false
}
```

#### Result

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

### actor_view_snapshot

Read actor view

Render a visible actor view in this run's browser and return what it shows as accessible structure, plus browser errors.

view is package-name/view-key (the ref in actor_program_list), @handle/view-key or a unique title. The server resolves the address; never open a view with browser_navigate. The run browser stays on the view, so browser_take_screenshot captures it, and browser_click, browser_type and browser_check with target.frame "iframe" operate it. A hidden view is an error. It needs a server that requires no sign-in and that the machine of the run's workspace can reach.

Owner: ragents.browser. Scope: per-turn. Native model tool: yes. Availability: conditional.

Only in a profile with the plugin ragents.actor-programs.

#### Input

```json
{
  "type": "object",
  "required": [
    "view"
  ],
  "properties": {
    "view": {
      "type": "string",
      "minLength": 1,
      "description": "Visible view as package-name/view-key, @handle/view-key or unique title."
    }
  },
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "object",
  "required": [
    "view",
    "snapshot",
    "truncated",
    "errors"
  ],
  "properties": {
    "view": {
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

### agent_spawn

Spawn Agent

Create an LLM agent actor in this run and optionally give it its first task; it works in its own turns while you continue.

It creates exactly one agent in this run: never a new run, never a TypeScript actor, and never a prepared setup, which run_script_start starts where it is offered. Check actor_list first when available: actor_input gives a further task to an existing actor, while the same name here creates another actor with a suffix. Read model_list before the first spawn and pass a model-bearing profile or an explicit model; the caller's model is not inherited. The agent inherits your delegable capabilities, but its function selection is required and never inherited: exact names, [] for a plain LLM without runtime, workspace or host functions, or null for the open, dynamically resolved set; drivers without plain-LLM isolation are rejected. Nothing waits for the agent: the call returns its reference at once. Its answers are model.output.completed events of its turns and reach you only as later inputs of a subscription made with event_subscribe; failed or interrupted turns reach you as automatic notices. A task given here starts at once, so a subscription made afterwards can miss its first answer: when you need that answer, create the agent without a task, subscribe to its events, then send the task with actor_input. A fork starts with an unchanged copy of the model context of an LLM agent of this run up to the end of that agent's last finished turn; nothing of its running turn is copied, a source without a finished turn is rejected, and the fork still gets its own instructions, functions and model, with its first task after the copy.

Owner: engine. Scope: per-turn. Native model tool: yes. Availability: conditional.

Only with the capability agent.spawn.

#### Input

```json
{
  "type": "object",
  "required": [
    "description",
    "name",
    "tools"
  ],
  "properties": {
    "description": {
      "type": "string",
      "minLength": 1,
      "maxLength": 160,
      "description": "A short (3-5 word) label of the agent's task for the participants overview, such as \"checks the comment rule\""
    },
    "prompt": {
      "type": "string",
      "minLength": 1,
      "description": "The task for the agent to perform, enqueued as its first input in the same command so that it starts at once; it gets none of your context, so state everything it needs and what it should report. Omit it for an idle agent that gets its first input later through actor_input"
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "description": "Name to address the agent by as @name, for example in actor_input: letters, digits, dash and underscore; a taken name gets a numeric suffix, and the result names the actual handle. The agent joins your room"
    },
    "instructions": {
      "type": "string",
      "minLength": 1,
      "description": "Lasting role and working rules for the agent's system prompt in all its turns, such as output format and limits; omitted, it has none of its own, and a profile from model_list supplies none"
    },
    "displayName": {
      "type": "string",
      "minLength": 1,
      "description": "Display name; defaults to the name"
    },
    "forkOf": {
      "type": "string",
      "minLength": 1,
      "description": "Handle or ID of an LLM agent of this run whose model context up to the end of its last finished turn is copied into the new agent"
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
          },
          {
            "type": "string",
            "const": "script.start"
          }
        ]
      },
      "uniqueItems": true,
      "description": "Capabilities the new agent does not inherit; otherwise it gets every delegable capability of this actor"
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
      ],
      "description": "Normally omitted: the profile's driver, otherwise agent, which runs a model; manual and script need no model."
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
      ],
      "description": "Reasoning level; must be one model_list names for the model, defaults to the profile's level."
    },
    "turnTimeoutMs": {
      "type": "integer",
      "minimum": 1000,
      "description": "Milliseconds after which a turn of the agent is aborted; defaults to the profile's limit, otherwise none."
    },
    "isolateWorkspace": {
      "type": "boolean",
      "description": "Currently without effect: every actor of a run works in the run's shared workspace."
    }
  },
  "additionalProperties": false
}
```

#### Result

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
      "description": "Actual handle, including any suffix assigned during creation; the address from your room."
    }
  },
  "additionalProperties": false
}
```

### artifact_publish

Publish Artifact

Publish text as a new immutable artifact of this run and return its ID.

Another actor may read it once it is attached to an actor_input for that actor; the run owner may read every artifact. A change is a new artifact that names its predecessor.

Owner: engine. Scope: per-turn. Native model tool: yes. Availability: conditional.

Only with the capability artifact.publish.

#### Input

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
      "minLength": 1,
      "description": "Short name of the artifact, also its name as an attachment"
    },
    "mediaType": {
      "type": "string",
      "minLength": 1,
      "description": "Media type such as text/markdown or application/json; text, JSON and XML types are read back as text"
    },
    "content": {
      "type": "string",
      "description": "Text content, stored as UTF-8"
    },
    "previousVersionId": {
      "type": "string",
      "minLength": 1,
      "description": "ID of the earlier artifact this one succeeds as a new version; it stays unchanged and must be readable by this actor"
    }
  },
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "array",
  "items": {
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
              "id"
            ],
            "properties": {
              "id": {
                "type": "string",
                "description": "ID of the artifact; artifact_read reads it with this"
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
  "description": "The journal events of this call. The payload names the ids of the result; it does not repeat inputs and hashes."
}
```

### artifact_read

Read Artifact

Read the content and metadata of an artifact that this actor published or received attached to one of its inputs.

The run owner may read every artifact. Text, JSON and XML media types come back as UTF-8 text, all others as base64.

Owner: engine. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every turn.

#### Input

```json
{
  "type": "object",
  "required": [
    "artifactId"
  ],
  "properties": {
    "artifactId": {
      "type": "string",
      "minLength": 1,
      "description": "ID of the artifact, as artifact_publish returns it"
    }
  },
  "additionalProperties": false
}
```

#### Result

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

Question

Asks the user 1 to 4 multiple-choice questions and ends your turn; the answers arrive later together as a new message.

Always use this tool when you need a decision or missing information from the user (e.g. choosing a branch or a time range), instead of only asking in your text. Call it as the only tool of your response: your turn ends with the questions, and the answers arrive as one new message with one line per question. Ask related questions together in one call. The user can always answer any question freely instead of choosing an option, so do not add an "Other" option and expect arbitrary text. With multiSelect the user may choose several options of that question. If the user writes a message instead, the questions are closed and that message arrives.

Owner: ragents.ask. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every turn; the question always goes to the user of the run.

#### Input

```json
{
  "type": "object",
  "required": [
    "questions"
  ],
  "properties": {
    "questions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "question",
          "header",
          "options",
          "multiSelect"
        ],
        "properties": {
          "question": {
            "type": "string",
            "description": "The complete question, clear and specific, ending with a question mark, e.g. \"Which library should we use for date formatting?\""
          },
          "header": {
            "type": "string",
            "maxLength": 12,
            "description": "Very short label shown as a chip, at most 12 characters, e.g. \"Library\" or \"Approach\""
          },
          "options": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "label",
                "description"
              ],
              "properties": {
                "label": {
                  "type": "string",
                  "description": "The text of the choice the user sees and selects; concise, 1 to 5 words"
                },
                "description": {
                  "type": "string",
                  "description": "What this option means or what happens if it is chosen, e.g. its trade-offs"
                }
              }
            },
            "minItems": 2,
            "maxItems": 4,
            "description": "2 to 4 distinct choices with different labels, mutually exclusive unless multiSelect is true; no \"Other\" option, free text is always possible"
          },
          "multiSelect": {
            "type": "boolean",
            "description": "true lets the user choose several options of this question; false for exactly one"
          }
        }
      },
      "minItems": 1,
      "maxItems": 4,
      "description": "1 to 4 different questions, shown together; the user answers all of them at once"
    }
  }
}
```

#### Result

```json
{
  "type": "string"
}
```

### bash

bash

Execute a shell command in the run's workspace, or with cwd in one of its roots, with sandbox restrictions.

Execute a bash command in the working directory, or in the folder given as cwd. Every call starts there; a cd does not carry over to the next call. Returns stdout and stderr; a nonzero exit code is reported at the end of the result (for example grep without a match), not as a tool error. Output is truncated to the last 2000 lines or 20KB (whichever is hit first), and lines longer than 1000 characters are shortened. If anything was cut, the full output is saved to a temp file. rg searches recursively by default; its -r flag means replace and rewrites every match, it does not mean recursive. A command is stopped after 120000 ms unless you pass a larger timeout in milliseconds (at most 3600000); builds, test runs, installs and other long commands need one. Commands cannot run in the background: a call returns when its command has finished.

Owner: ragents.workspace. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

```json
{
  "type": "object",
  "required": [
    "command"
  ],
  "properties": {
    "command": {
      "type": "string",
      "description": "The command to execute"
    },
    "timeout": {
      "type": "number",
      "exclusiveMinimum": 0,
      "maximum": 3600000,
      "default": 120000,
      "description": "Optional timeout in milliseconds (default 120000, max 3600000)"
    },
    "description": {
      "type": "string",
      "description": "Clear, concise description of what this command does in active voice, 5-10 words, for example \"List files in current directory\"; the user reads it, often without seeing the command"
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Not available here: true is rejected, because a call ends with its command. Run long commands in the foreground with a larger timeout"
    },
    "cwd": {
      "type": "string",
      "description": "Folder to run the command in: relative to the working directory or starting with a workspace alias such as @actors/<name>; defaults to the working directory"
    }
  },
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "string"
}
```

### browser_check

Check browser result

Assert visible target/text, resulting URL and absence of browser errors. Fails on mismatch; records successful evidence for this page until the next action/navigation/error. Supply at least one assertion. Browser errors are checked by default. Visibility assertions wait at most 5 seconds, shorter than actions.

Owner: ragents.browser. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

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
      "minLength": 1,
      "description": "Text expected to be visible, case-insensitive and as a part, inside target if given, otherwise anywhere on the page; cannot be combined with count."
    },
    "url": {
      "type": "string",
      "minLength": 1,
      "description": "Expected page address, exact or as a glob pattern such as **/done."
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

#### Result

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

Click in browser

Click a uniquely identified visible element with Playwright auto-waiting. Returns the actual resulting page. Ambiguous or absent targets are errors.

Owner: ragents.browser. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

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

#### Result

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

Close browser

Close this run's browser and discard its cookies. Saved screenshots remain where they were stored.

Owner: ragents.browser. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

#### Result

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

### browser_navigate

Navigate browser

Navigate this run's isolated headless browser to an HTTP(S) page. Returns its accessible structure and browser errors. Reuses the current run browser; other runs have separate cookies and processes.

Owner: ragents.browser. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

```json
{
  "type": "object",
  "required": [
    "url"
  ],
  "properties": {
    "url": {
      "type": "string",
      "minLength": 1,
      "description": "HTTP or HTTPS address; an error status of the response fails the call."
    }
  },
  "additionalProperties": false
}
```

#### Result

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

### browser_press_key

Press browser key

Press a key or chord such as Enter, Escape, Tab or ControlOrMeta+A on the focused element, or on target after focusing it. Returns the resulting page.

Owner: ragents.browser. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

```json
{
  "type": "object",
  "required": [
    "key"
  ],
  "properties": {
    "key": {
      "type": "string",
      "minLength": 1,
      "description": "Playwright key name, character or chord, such as Enter, ArrowLeft, a or ControlOrMeta+A."
    },
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

#### Result

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

### browser_resize

Resize browser

Resize the page viewport in CSS pixels, for example to check a narrow layout. The default is 1920 x 1080 (16:9) and screenshots use the viewport size at scale 1; the chosen size stays for the run until changed again. Returns the resulting page.

Owner: ragents.browser. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

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
      "maximum": 3840,
      "description": "Viewport width in CSS pixels."
    },
    "height": {
      "type": "integer",
      "minimum": 240,
      "maximum": 2160,
      "description": "Viewport height in CSS pixels."
    }
  },
  "additionalProperties": false
}
```

#### Result

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

### browser_select_option

Select in browser

Select options in a native select element; several values select several options of a multiple select. For custom dropdowns use browser_click on the trigger and the visible option.

Owner: ragents.browser. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

```json
{
  "type": "object",
  "required": [
    "target",
    "values"
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
    "values": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "minItems": 1,
      "description": "Value or visible label of each option to select."
    }
  },
  "additionalProperties": false
}
```

#### Result

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

Read browser

Read the current real page's accessible structure, title, URL and errors. Use role/name or labels for subsequent actions; snapshot reference IDs never need to be copied.

Owner: ragents.browser. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

#### Result

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

### browser_take_screenshot

Capture browser

Capture the real browser page as a PNG file where filename names it, by default a new file under @documents/browser/. Name filename next to the report that shows it and embed it with a path relative to the report. Call browser_view_screenshot to see the latest capture as an image.

Owner: ragents.browser. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

```json
{
  "type": "object",
  "properties": {
    "label": {
      "type": "string",
      "maxLength": 200,
      "description": "Name of the capture in the run's browser evidence; defaults to Browser screenshot."
    },
    "filename": {
      "type": "string",
      "minLength": 1,
      "description": "Where the PNG goes, named as read names a file: relative to the working directory on the machine where the browser runs, or starting with @documents, e.g. @documents/review/shots/home.png; defaults to a new file under @documents/browser/."
    },
    "fullPage": {
      "type": "boolean",
      "description": "Capture the whole scrollable page instead of the viewport; defaults to false."
    }
  },
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "string"
}
```

### browser_type

Type in browser

Type text into an input or textarea chosen by accessible label or another semantic target, firing the normal input events. Returns the resulting page.

Owner: ragents.browser. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

```json
{
  "type": "object",
  "required": [
    "target",
    "text"
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
    "text": {
      "type": "string",
      "description": "Text that replaces the content of the field, unless slowly is set."
    },
    "submit": {
      "type": "boolean",
      "description": "Press Enter afterwards, for example to submit a form."
    },
    "slowly": {
      "type": "boolean",
      "description": "Type one character at a time without clearing the field first, to trigger key handlers."
    }
  },
  "additionalProperties": false
}
```

#### Result

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

View browser screenshot

View this run's latest screenshot as native image input without a path. Invoke this native tool directly to receive pixels; calling it through TypeScript only verifies image availability. Requires an image-capable model for native image input.

Owner: ragents.browser. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "string"
}
```

### copy

Copy

Copy a file or a folder within the roots of the run, unchanged and binary-safe, also between the workstation and the server.

Use it to move evidence and reports between the working directory and @documents instead of retyping files. The destination names the copy itself, not a folder to put it in; a folder is copied with everything in it, and existing files at the destination are overwritten. One call carries at most 16 MiB and 1000 files.

Owner: ragents.workspace. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

```json
{
  "type": "object",
  "required": [
    "source",
    "destination"
  ],
  "properties": {
    "source": {
      "type": "string",
      "minLength": 1,
      "description": "The file or folder to copy, named exactly as read names a file: relative to the working directory, absolute in a root of the run, or starting with an alias such as @documents"
    },
    "destination": {
      "type": "string",
      "minLength": 1,
      "description": "Where the copy goes, named exactly as read names a file: relative to the working directory, absolute in a root of the run, or starting with an alias such as @documents; only a writable root, never @skills"
    }
  },
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "string"
}
```

### edit

edit

Replace an exact string in a file within the run's writable workspace roots.

Perform an exact string replacement in a file. Read the file with read in this conversation first; editing a file you have not read fails. old_string must match the file exactly, including whitespace and indentation; copy it from the read output without the line number and tab before each line. The edit fails if old_string is not unique in the file: add surrounding lines to make it unique, or set replace_all to change every occurrence. One call makes one replacement; for several changes call edit several times. An empty old_string creates a new file with new_string as its content.

Owner: ragents.workspace. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

```json
{
  "type": "object",
  "required": [
    "file_path",
    "old_string",
    "new_string"
  ],
  "properties": {
    "file_path": {
      "type": "string",
      "description": "The path of the file to modify: relative to the working directory, absolute, or starting with a workspace alias such as @actors"
    },
    "old_string": {
      "type": "string",
      "description": "The text to replace"
    },
    "new_string": {
      "type": "string",
      "description": "The text to replace it with (must be different from old_string)"
    },
    "replace_all": {
      "type": "boolean",
      "description": "Replace all occurrences of old_string (default false)"
    }
  },
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "string"
}
```

### event_query

Query Events

Read journal events in this run, optionally filtered by event ID, actor or event type.

Owner: engine. Scope: per-turn. Native model tool: no. Availability: conditional.

Only with the capability event.subscribe.

#### Input

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
      "uniqueItems": true,
      "description": "Only events with these event IDs"
    },
    "actorIds": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "uniqueItems": true,
      "description": "Only events written in the name of these actors, as @handle or ID"
    },
    "eventTypes": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "uniqueItems": true,
      "description": "Every journal event type can be queried. Only the observable types can be subscribed to; event_subscribe shows them."
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 500,
      "description": "Return only the latest matching events, at most this many; defaults to 100"
    }
  },
  "additionalProperties": false
}
```

#### Result

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

Source actors may be named by id or handle. Every matching observable event arrives without loss as its own new ActorInput for this actor. Use it when each event matters; to be woken only once a derived state meets a condition, use a watch where one is offered.

Owner: engine. Scope: per-turn. Native model tool: no. Availability: conditional.

Only with the capability event.subscribe.

#### Input

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
      "uniqueItems": true,
      "description": "Only events of these actors, as @handle or ID: a turn end counts for the turn's actor, a stop or restart for the stopped actor, any other event for its author; omitted, every actor"
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
      "uniqueItems": true,
      "description": "Only events of actors of these kinds; omitted, every kind"
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
      "uniqueItems": true,
      "description": "Event types to deliver; only these observable types can be subscribed to"
    },
    "includeSelf": {
      "type": "boolean",
      "description": "Also deliver events of this actor itself; defaults to false"
    }
  },
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "object",
  "required": [
    "subscriptionId",
    "sources"
  ],
  "properties": {
    "subscriptionId": {
      "type": "string",
      "description": "ID of the subscription; event_unsubscribe takes it as subscriptionId"
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
      "description": "The resolved source actors as @handle where resolvable, otherwise as ID; null = all."
    }
  },
  "additionalProperties": false
}
```

### event_subscription_list

List Event Subscriptions

List this actor's event subscriptions, including inactive and failed ones.

Owner: engine. Scope: per-turn. Native model tool: no. Availability: conditional.

Only with the capability event.subscribe.

#### Input

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

#### Result

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
            "description": "ID of the subscription; event_unsubscribe takes it as subscriptionId"
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
            "description": "Source actors as ID; null = all. ID and @handle are equivalent as input."
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
            "description": "The same sources as @handle where resolvable; otherwise the ID."
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
            "description": "ID of the subscription; event_unsubscribe takes it as subscriptionId"
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
            "description": "Source actors as ID; null = all. ID and @handle are equivalent as input."
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
            "description": "The same sources as @handle where resolvable; otherwise the ID."
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
            "description": "ID of the subscription; event_unsubscribe takes it as subscriptionId"
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
            "description": "Source actors as ID; null = all. ID and @handle are equivalent as input."
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
            "description": "The same sources as @handle where resolvable; otherwise the ID."
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

Owner: engine. Scope: per-turn. Native model tool: no. Availability: conditional.

Only with the capability event.subscribe.

#### Input

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
      "description": "subscriptionId from event_subscribe or event_subscription_list"
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "description": "Why the subscription ends; recorded in the journal, and its deliveries that still wait are discarded"
    }
  },
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "null",
  "description": "Done; an error throws."
}
```

### fsharp_close

Close FSAC

Stop the FSAC language server instance of one root; without root every FSAC instance of this conversation. Other languages and other conversations stay untouched.

Owner: ragents.lsp-fsharp. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

```json
{
  "type": "object",
  "properties": {
    "root": {
      "type": "string",
      "description": "The open root to stop; omit for every instance of this run"
    }
  }
}
```

#### Result

```json
{
  "type": "string"
}
```

### fsharp_diagnostics

FSAC diagnostics

Current FSAC diagnostics (errors, warnings on request) for .fs, .fsi, .fsx files from the running language server, without building. Without paths: all changed files of every open root according to git. With paths every file is answered by the instance whose root contains it; root asks one instance.

Owner: ragents.lsp-fsharp. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

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

#### Result

```json
{
  "type": "string"
}
```

### fsharp_open

Open FSAC

Start a FSAC language server instance for this run's workspace and load the .sln file (or a single .fsproj). Afterwards every edit or write of a .fs, .fsi, .fsx file gets its diagnostics appended automatically, and fsharp_diagnostics is available. Idempotent for the same root; other roots stay open.

Owner: ragents.lsp-fsharp. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

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

#### Result

```json
{
  "type": "string"
}
```

### model_list

List Models and Profiles

List the execution profiles and provider models available for agent_spawn.

Owner: engine. Scope: per-turn. Native model tool: yes. Availability: conditional.

Only with the capability agent.spawn.

#### Input

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
      ],
      "description": "Lists only the models of this driver; it does not filter the profiles, which are always listed in full"
    }
  },
  "additionalProperties": false
}
```

#### Result

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
            "description": "Thinking levels that agent_spawn accepts for this model."
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

### read

read

Read a file with line numbers, or an image, within the run's allowed workspace roots.

Read a file. Results are returned in cat -n format: each line is its line number starting at 1, a tab, then the line as it is in the file. By default it reads up to 2000 lines from the start of the file; offset and limit read a specific part, and a note names the offset to continue with. Lines longer than 2000 characters are truncated, and the output stops at 50KB. Images (jpg, png, gif, webp, bmp) are returned as attachments. Do not re-read a file you just edited or wrote to check it: edit and write fail if their change did not apply.

Owner: ragents.workspace. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

```json
{
  "type": "object",
  "required": [
    "file_path"
  ],
  "properties": {
    "file_path": {
      "type": "string",
      "description": "The path of the file to read: relative to the working directory, absolute, or starting with a workspace alias such as @actors"
    },
    "offset": {
      "type": "integer",
      "minimum": 0,
      "description": "The line number to start reading from (1-based). Only provide if the file is too large to read at once"
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "description": "The number of lines to read. Only provide if the file is too large to read at once"
    }
  },
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "string"
}
```

### roslyn_close

Close Roslyn

Stop the Roslyn language server instance of one root; without root every Roslyn instance of this conversation. Other languages and other conversations stay untouched.

Owner: ragents.lsp-roslyn. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

```json
{
  "type": "object",
  "properties": {
    "root": {
      "type": "string",
      "description": "The open root to stop; omit for every instance of this run"
    }
  }
}
```

#### Result

```json
{
  "type": "string"
}
```

### roslyn_diagnostics

Roslyn diagnostics

Current Roslyn diagnostics (errors, warnings on request) for .cs files from the running language server, without building. Without paths: all changed files of every open root according to git. With paths every file is answered by the instance whose root contains it; root asks one instance.

Owner: ragents.lsp-roslyn. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

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

#### Result

```json
{
  "type": "string"
}
```

### roslyn_open

Open Roslyn

Start a Roslyn language server instance for this run's workspace and load the .sln file (or a single .csproj). Afterwards every edit or write of a .cs file gets its diagnostics appended automatically, and roslyn_diagnostics is available. Idempotent for the same root; other roots stay open.

Owner: ragents.lsp-roslyn. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

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

#### Result

```json
{
  "type": "string"
}
```

### roslyn_solutions

Roslyn Solutions

List the solution files (.sln, .slnx) of this run's workspace and mark which ones the Roslyn language server has open. roslyn_open loads another one in addition; the open ones stay open.

Owner: ragents.lsp-roslyn. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

```json
{
  "type": "object",
  "properties": {}
}
```

#### Result

```json
{
  "type": "string"
}
```

### run_configure

Configure Run

Set the run title and/or choose the primary actor the chat talks to. Give title, primaryActor or both; the primary actor must be an active agent or TypeScript actor of this run.

Owner: engine. Scope: per-turn. Native model tool: yes. Availability: conditional.

Only with the capability run.configure.

#### Input

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200,
      "description": "New title of the run"
    },
    "primaryActor": {
      "type": "string",
      "minLength": 1,
      "description": "Handle or ID of the actor the user's chat talks to"
    }
  },
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "null",
  "description": "Done; an error throws."
}
```

### run_script_list

List run scripts

The run scripts of this profile that can join this run: entry, title, description, and whether each can start now or why not.

Owner: ragents.runtime. Scope: per-turn. Native model tool: yes. Availability: conditional.

Only with the capability script.start, which the coordinator holds and passes to no agent it spawns.

#### Input

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "required": [
      "entry",
      "title",
      "description",
      "available"
    ],
    "properties": {
      "entry": {
        "type": "string"
      },
      "title": {
        "type": "string"
      },
      "description": {
        "type": "string"
      },
      "available": {
        "type": "boolean"
      },
      "reason": {
        "type": "string"
      }
    },
    "additionalProperties": false
  }
}
```

### run_script_start

Start run script

Start a run script from run_script_list inside this run, in a room of its own; returns its actor's address and which start of it this is.

A run script is a prepared setup of this profile: a TypeScript actor that arranges its own participants and views in this run; for a single new LLM agent use agent_spawn instead. entry is the entry from run_script_list; input is the script's start value, if it takes one. The script joins the run without changing the primary actor. Every start opens a new room named after the script (name, name-2, ...) with its own actors, so a repeated start never reuses the actors of an earlier one; handle is the setup actor's address from your room, such as name-2.name. When it finishes a start, you receive its summary and result as a message; do not wait or poll for it in the same turn.

Owner: ragents.runtime. Scope: per-turn. Native model tool: yes. Availability: conditional.

Only with the capability script.start, which the coordinator holds and passes to no agent it spawns.

#### Input

```json
{
  "type": "object",
  "required": [
    "entry"
  ],
  "properties": {
    "entry": {
      "type": "string",
      "minLength": 1,
      "description": "The entry from run_script_list"
    },
    "input": {
      "description": "Start value of the script; omit it for none"
    }
  },
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "object",
  "required": [
    "handle",
    "count"
  ],
  "properties": {
    "handle": {
      "type": "string"
    },
    "count": {
      "type": "integer",
      "minimum": 1
    }
  },
  "additionalProperties": false
}
```

### run_stop

Stop run

Initiates the complete stop of your own run: running turns, tools, subagents and plugin services. Conversation and files are kept. Also cancels your own turn; acceptance is not a confirmation of completed cleanup. Use immediately when the user wants a complete cancellation; do not send a cancel message to busy agents.

Owner: ragents.orchestration. Scope: per-turn. Native model tool: yes. Availability: conditional.

For the primary actor with execution.stopOwned in its own run.

#### Input

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

#### Result

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

Show document

Shows a file or a document completely in the interface: any file read reaches, also an image, or text you wrote.

ALWAYS use this tool when the user wants to see the content of a file or a longer document, instead of copying or paraphrasing it in the chat answer. Name an existing file by its path and never retype its content: the display reads the file itself, where it lies, also on a workstation or under @documents. Relative links and images inside a shown document resolve against its folder. Text goes in as content only when you produced it yourself.

Owner: ragents.documents. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

```json
{
  "type": "object",
  "required": [
    "title"
  ],
  "properties": {
    "title": {
      "type": "string",
      "description": "Title of the display, e.g. the file name"
    },
    "file_path": {
      "type": "string",
      "minLength": 1,
      "description": "The file to show, named as read names it: relative to the working directory, absolute, or starting with an alias such as @documents; the display reads it, so its content is never retyped. file_path and content exclude each other: valid are { title, file_path } for a file read reaches and { title, content } for text you wrote, each with an optional format; exactly one of the two must be set."
    },
    "content": {
      "type": "string",
      "description": "The complete text you produced yourself; never the content of an existing file, which file_path names instead. file_path and content exclude each other: valid are { title, file_path } for a file read reaches and { title, content } for text you wrote, each with an optional format; exactly one of the two must be set."
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
      "description": "Rendering; defaults to the file extension for a file and to markdown for content"
    }
  },
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "string"
}
```

### todo_write

Write To-do List

Create and update this agent's to-do list, which the user sees as its working plan; every call replaces the whole list.

Use it for work of three or more distinct steps, for several tasks from the user, or when the user asks for a list; skip it for a single straightforward step or a pure question. Send the complete list every time. Keep exactly one item in progress while work remains and mark it completed right after the work actually happened, never in advance; when blocked, keep it in progress and add an item for the blocker. Give every item both forms: the imperative such as "Run tests" and the present continuous shown while it runs, such as "Running tests".

Owner: ragents.todo. Scope: per-turn. Native model tool: yes. Availability: conditional.

Only for agents with the capability plugin.state.write.

#### Input

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
          "content",
          "status",
          "activeForm"
        ],
        "properties": {
          "content": {
            "type": "string",
            "minLength": 1,
            "description": "What needs to be done, in the imperative, such as \"Run tests\""
          },
          "status": {
            "anyOf": [
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
                "const": "completed"
              }
            ],
            "description": "pending = not started, in_progress = being worked on, one item at a time, completed = actually done"
          },
          "activeForm": {
            "type": "string",
            "minLength": 1,
            "description": "The same step in the present continuous, shown while it is in progress, such as \"Running tests\""
          }
        },
        "additionalProperties": false
      },
      "description": "The updated todo list, complete and in order; it replaces the previous one"
    }
  },
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "null"
}
```

### typescript_api

TypeScript API

Discover the typed functions available to this actor. Omit names for a compact searchable list; pass exact names for their entries in RAgentsCapabilityMap with field documentation and the matching guidance. JSON schemas with validation constraints are added only on request. Functions are called as await context.functions.name(input) from snippets and actor programs; context: true returns the declarations of context itself once.

Owner: ragents.runtime. Scope: per-turn. Native model tool: yes. Availability: conditional.

For active executable actors with a function selection.

#### Input

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
    },
    "context": {
      "type": "boolean",
      "description": "Alone: the declarations of context itself (run, actor, state, log, std with mediators), the same for every function."
    }
  },
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "object",
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
    },
    "hint": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

### typescript_close

Close TypeScript

Stop the TypeScript language server instance of one root; without root every TypeScript instance of this conversation. Other languages and other conversations stay untouched.

Owner: ragents.lsp-typescript. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

```json
{
  "type": "object",
  "properties": {
    "root": {
      "type": "string",
      "description": "The open root to stop; omit for every instance of this run"
    }
  }
}
```

#### Result

```json
{
  "type": "string"
}
```

### typescript_diagnostics

TypeScript diagnostics

Current TypeScript diagnostics (errors, warnings on request) for .ts, .tsx, .mts, .cts, .js, .jsx files from the running language server, without building. Without paths: all changed files of every open root according to git. With paths every file is answered by the instance whose root contains it; root asks one instance.

Owner: ragents.lsp-typescript. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

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

#### Result

```json
{
  "type": "string"
}
```

### typescript_eval

Evaluate TypeScript

Typecheck and execute a one-off TypeScript snippet as the calling actor, with the same context.functions API as actor programs. Supply code or a workspace path containing an async function body: await and return are supported; use await import() for Node modules. Return a JSON value; no return yields null. context.log captures output. Locals and context.state last for this execution only. Function calls can change the run and are not rolled back on later failure. Use an actor program for persistent state and future messages or events.

Owner: ragents.runtime. Scope: per-turn. Native model tool: yes. Availability: conditional.

For active executable actors with a function selection.

#### Input

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

#### Result

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

Open TypeScript

Start a TypeScript language server instance for this run's workspace and load the directory whose tsconfig.json projects should be served (e.g. src). Afterwards every edit or write of a .ts, .tsx, .mts, .cts, .js, .jsx file gets its diagnostics appended automatically, and typescript_diagnostics is available. Idempotent for the same root; other roots stay open.

Owner: ragents.lsp-typescript. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

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

#### Result

```json
{
  "type": "string"
}
```

### watch_create

Create watch

Observes an actor of this run and wakes another with a background message as soon as the condition, written as a TypeScript function body, returns a reason for the changed state. No model: the condition is type-checked on creation and afterwards run deterministically on every change of the observed state, once the observed actor has come to rest; stalledForSeconds appears after stallAfterSeconds without activity and again after each further period. An identical watch is not created twice.

Use a watch to be woken once a derived state meets a condition; to receive every matching event without loss as its own input, use event_subscribe instead.

Owner: ragents.watch. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every run.

#### Input

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
      "description": "Observed actor as @handle or id"
    },
    "condition": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4000,
      "description": "Wake condition as a TypeScript function body of (now: WatchState, before: WatchState) => string | undefined; returns the wake reason as text or undefined. WatchState: source { lifecycle idle|running|stopped, completedTurns, lastTurn { status, reason? }, pendingInputs, pendingActions, lastOutput? }, observed (result of the observe operation as Record<string, unknown>), stalledForSeconds (only when stalled). before is the state at the last wake. Example: return now.source.completedTurns > before.source.completedTurns && now.observed?.phase !== \"ready\" ? \"Turn ended, task not finished\" : undefined;"
    },
    "target": {
      "type": "string",
      "minLength": 1,
      "description": "Actor to wake as @handle or id; if omitted, the caller"
    },
    "observe": {
      "type": "string",
      "minLength": 1,
      "description": "Named operation without input whose result extends the observed state and is compared by difference"
    },
    "instruction": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2000,
      "description": "Text appended to every wake, e.g. how the woken actor should react"
    },
    "stallAfterSeconds": {
      "type": "integer",
      "minimum": 1,
      "description": "Seconds without an event of the observed actor after which the state reports stalledForSeconds"
    }
  },
  "additionalProperties": false
}
```

#### Result

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
      "description": "Id of the watch for watch_remove"
    },
    "source": {
      "type": "string",
      "description": "Observed actor as @handle"
    },
    "target": {
      "type": "string",
      "description": "Woken actor as @handle"
    },
    "condition": {
      "type": "string",
      "description": "Wake condition as a TypeScript function body"
    },
    "observe": {
      "type": "string",
      "description": "Named operation whose result belongs to the observed state"
    },
    "stallAfterSeconds": {
      "type": "integer",
      "description": "Seconds without an event of the observed actor after which the state reports a stall"
    },
    "wakes": {
      "type": "integer",
      "description": "Number of wakes so far"
    },
    "lastEvaluatedAt": {
      "type": "string",
      "description": "Time of the last evaluation"
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
          "description": "Time of the evaluation"
        },
        "wake": {
          "type": "boolean",
          "description": "Whether the watch woke"
        },
        "reason": {
          "type": "string",
          "description": "Reason the condition returned, or 'Condition not met'"
        },
        "changes": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Changes since the last wake that the evaluation saw"
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

### watch_list

List watches

Lists the watches of this run with condition, number of wakes and last verdict.

Owner: ragents.watch. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every run.

#### Input

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

#### Result

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
        "description": "Id of the watch for watch_remove"
      },
      "source": {
        "type": "string",
        "description": "Observed actor as @handle"
      },
      "target": {
        "type": "string",
        "description": "Woken actor as @handle"
      },
      "condition": {
        "type": "string",
        "description": "Wake condition as a TypeScript function body"
      },
      "observe": {
        "type": "string",
        "description": "Named operation whose result belongs to the observed state"
      },
      "stallAfterSeconds": {
        "type": "integer",
        "description": "Seconds without an event of the observed actor after which the state reports a stall"
      },
      "wakes": {
        "type": "integer",
        "description": "Number of wakes so far"
      },
      "lastEvaluatedAt": {
        "type": "string",
        "description": "Time of the last evaluation"
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
            "description": "Time of the evaluation"
          },
          "wake": {
            "type": "boolean",
            "description": "Whether the watch woke"
          },
          "reason": {
            "type": "string",
            "description": "Reason the condition returned, or 'Condition not met'"
          },
          "changes": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "Changes since the last wake that the evaluation saw"
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

Remove watch

Removes a watch of this run; afterwards it no longer wakes.

Owner: ragents.watch. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every run.

#### Input

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
      "description": "Id from watch_create or watch_list"
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "description": "Reason for the removal"
    }
  },
  "additionalProperties": false
}
```

#### Result

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

Create or overwrite a file within the run's writable workspace roots.

Write a file, overwriting it if one exists, and create its parent folders. Overwriting an existing file you have not read with read in this conversation fails. Prefer edit for changes to an existing file; use write for new files or complete rewrites.

Owner: ragents.workspace. Scope: per-turn. Native model tool: yes. Availability: always.

Available in every model turn.

#### Input

```json
{
  "type": "object",
  "required": [
    "file_path",
    "content"
  ],
  "properties": {
    "file_path": {
      "type": "string",
      "description": "The path of the file to write: relative to the working directory, absolute, or starting with a workspace alias such as @actors"
    },
    "content": {
      "type": "string",
      "description": "The content to write to the file"
    }
  },
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "string"
}
```

## Operations

### actor_input

Enqueues a normal text input for an actor under the bound identity - as an agent or, from an app action, as the owner of the run. Only confirms the enqueueing. TypeScript actors understand only their programmed input protocol, no free-form tasks.

Owner: ragents.orchestration.

#### Operator policy

```json
"direct"
```

#### Input

```json
{
  "type": "object",
  "required": [
    "to",
    "message"
  ],
  "properties": {
    "to": {
      "type": "string",
      "minLength": 1,
      "description": "Recipient: the @handle or ID of an actor of this run, as actor_list or agent_spawn name it; an address is room.name, a bare name means your room, otherwise the main room"
    },
    "message": {
      "type": "string",
      "minLength": 1,
      "description": "Plain text the recipient receives as it is, without your context"
    },
    "artifactIds": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "uniqueItems": true,
      "description": "Artifacts to attach; the sender must be able to read them, and the recipient may read them afterwards"
    }
  },
  "additionalProperties": false
}
```

#### Result

```json
{
  "type": "array",
  "items": {
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
            "description": "ID of the enqueued input"
          },
          "actorId": {
            "type": "string",
            "description": "ID of the receiving actor"
          }
        },
        "additionalProperties": false
      }
    },
    "additionalProperties": false
  },
  "description": "The journal events of this call. The payload names the ids of the result; it does not repeat inputs and hashes."
}
```

## Actor program templates

### blank: Blank mini-app

A pure React view on the existing actor without an additional server function.

#### package.json

```json
{
  "name": "blank",
  "private": true,
  "type": "module",
  "ragents": {
    "title": "My view",
    "description": "A small interface of the existing actor.",
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
  <UI.AppLayout title="My view">
    <UI.Stack><p>Ready for your content.</p></UI.Stack>
  </UI.AppLayout>
);

const root = document.getElementById("root");
if (!root) throw new Error("The #root element is missing.");
createRoot(root).render(<App />);
```

### chat: Actor chat

Reusable chat with history and optional input to the actor of this view.

#### package.json

```json
{
  "name": "chat",
  "private": true,
  "type": "module",
  "ragents": {
    "title": "Actor chat",
    "description": "Shows the conversation with an actor and sends it user input.",
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
import { context } from "@ragents/client";

const App = () => (
  <UI.Chat actor={"@" + context.actor.handle} className="h-full" showInput placeholder="Message to the actor" />
);

const root = document.getElementById("root");
if (!root) throw new Error("The #root element is missing.");
createRoot(root).render(<App />);
```

### controls: Try UI controls

Local demo with form, table, files, tasks, flow diagram, SVG connections, messages, document, and diff without function calls.

#### package.json

```json
{
  "name": "controls",
  "private": true,
  "type": "module",
  "ragents": {
    "title": "Try UI controls",
    "description": "A local demo of the available mini-app controls. Values and files stay in this view.",
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
import * as UI from "@ragents/client/ui";

type FormValues = Parameters<typeof UI.Form>[0]["values"];
type Row = { id: string; name: string; count: number };
const rows: Row[] = [
  { id: "analysis", name: "Analysis", count: 12 },
  { id: "review", name: "Review", count: 4 },
  { id: "notes", name: "Documentation", count: 8 },
];

const App = () => {
  const [values, setValues] = React.useState<FormValues>({ title: "Review results", notes: "", count: 3, mode: "review", approved: false });
  const [selected, setSelected] = React.useState<string[]>([]);
  const [files, setFiles] = React.useState<File[]>([]);
  const [result, setResult] = React.useState("No form values applied yet.");
  const [messages, setMessages] = React.useState<Parameters<typeof UI.MessageList>[0]["messages"]>([
    { key: "editorial", sender: "Editorial", text: "The notice should stay **short and clear**." },
    { key: "review", sender: "Text review", text: "Opening hours and the repair notice are kept." },
  ]);
  const [done, setDone] = React.useState(false);
  return <UI.AppLayout title="Try UI controls" description="Local demo: no agents, uploads, or server actions. Values and file selection stay only in this view and are reset on reload.">
    <UI.Stack gap="large">
      <UI.Form title="Form" fields={[
        { id: "title", label: "Task", type: "text", placeholder: "What should be worked on?", required: true },
        { id: "notes", label: "Notes", type: "textarea", rows: 3, placeholder: "What should be taken into account while working on it?", hint: "Multi-line text stays aligned in the form." },
        { id: "count", label: "Count", type: "number", placeholder: "Number of results", hint: "1 to 10 results.", required: true, min: 1, max: 10 },
        { id: "mode", label: "Mode", type: "select", options: [{ value: "review", label: "Review" }, { value: "draft", label: "Draft" }] },
        { id: "approved", label: "Selection confirmed", type: "checkbox", required: true },
      ]} values={values} onChange={setValues} onSubmit={async (next) => { setResult(JSON.stringify(next, null, 2)); }} submitLabel="Show values locally" />
      <UI.Stack gap="small">
        <UI.DataTable<Row> title="Data table" rows={rows} rowKey={(row) => row.id} filterable
          selectedKeys={selected} onSelectionChange={setSelected}
          columns={[{ id: "name", label: "Work", value: (row) => row.name, sortable: true }, { id: "count", label: "Results", value: (row) => row.count, sortable: true }]}
          actions={[{ id: "select", label: "Select", onClick: (row) => { setSelected([row.id]); } }]} />
        <p aria-live="polite">{selected.length} rows selected</p>
      </UI.Stack>
      <UI.FilePicker label="Local file selection" files={files} onChange={setFiles} maxFiles={5} maxBytes={10 * 1024 * 1024} />
      <UI.Stack gap="small">
        <UI.TaskProgress title="Example tasks" tasks={[
          { id: "read", label: "Read documents", status: "done" },
          { id: "review", label: "Review results", status: done ? "done" : "pending", description: "Local example status, no running actor." },
        ]} />
        <UI.Stack direction="row"><UI.Button onClick={() => setDone((current) => !current)}>Toggle example status</UI.Button></UI.Stack>
      </UI.Stack>
      <UI.Stack gap="small">
        <h2>Flow diagram</h2>
        <p>The diagram gets its state from the same data as the task list.</p>
        <UI.FlowDiagram label={done ? "Intake, review done, result ready" : "Intake, review running, result pending"}
          nodes={[
            { id: "input", label: "Intake", detail: "Documents are available", status: "done", kind: "service" },
            { id: "check", label: "Review", detail: done ? "Review completed" : "Documents are being reviewed", status: done ? "done" : "active", kind: "agent" },
            { id: "result", label: "Result", detail: done ? "Result ready" : "Waiting for the review", status: done ? "done" : "pending", kind: "actor" },
          ]}
          edges={[{ source: "input", target: "check" }, { source: "check", target: "result" }]} />
      </UI.Stack>
      <UI.Stack gap="small">
        <h2>SVG connections</h2>
        <p>SvgEdge draws the edges. Nodes, labels, and positions are in the code of this view.</p>
        <svg viewBox="0 0 360 160" role="img" aria-label={done ? "Intake done, review completed, result ready" : "Intake done, review running, result open"}
          className="block h-auto w-full text-[13px]">
          <UI.SvgEdge d="M112 42 L144 42" tone={done ? "success" : "warning"} active={!done} />
          <UI.SvgEdge d="M252 42 C320 42 320 118 252 118" arrow={done ? "end" : "none"} tone={done ? "success" : "neutral"} lineStyle={done ? "solid" : "dashed"} />
          <UI.SvgEdge d="M144 118 C64 118 64 96 64 72" arrow="both" tone="accent" />
          {[{ x: 8, y: 12, label: "Intake", status: "Done" },
            { x: 148, y: 12, label: "Review", status: done ? "Done" : "Running" },
            { x: 148, y: 88, label: "Result", status: done ? "Ready" : "Open" }].map((node) => <g key={node.label}>
              <rect x={node.x} y={node.y} width="104" height="56" rx="8" className="fill-background stroke-border-strong" />
              <text x={node.x + 52} y={node.y + 23} textAnchor="middle" className="fill-foreground font-semibold">{node.label}</text>
              <text x={node.x + 52} y={node.y + 42} textAnchor="middle" className="fill-muted-foreground text-[11px]">{node.status}</text>
            </g>)}
        </svg>
      </UI.Stack>
      <UI.Stack gap="small">
        <UI.MessageList messages={messages} label="Local editorial notes" />
        <UI.Stack direction="row"><UI.Button onClick={() => setMessages((current) => [...current, {
          key: "note-" + current.length, sender: current.length % 2 ? "Text review" : "Editorial",
          text: "Local example note " + (current.length - 1) + ": This message was just added.",
        }])}>Add local message</UI.Button></UI.Stack>
      </UI.Stack>
      <UI.DocumentViewer title="Local form result" format="text" content={result} />
      <UI.DiffViewer title="Example change" patch={"--- a/result.txt\n+++ b/result.txt\n@@ -1 +1 @@\n-Status: open\n+Status: reviewed"} />
    </UI.Stack>
  </UI.AppLayout>;
};

const root = document.getElementById("root");
if (!root) throw new Error("The #root element is missing.");
createRoot(root).render(<App />);
```

### text-analysis: Text analysis

A TypeScript actor analyzes texts with its own function, state, and React view.

#### package.json

```json
{
  "name": "text-analysis",
  "private": true,
  "type": "module",
  "ragents": {
    "title": "Text analysis",
    "description": "Counts characters, words, and lines and remembers the number of analyses.",
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
  const [result, setResult] = React.useState("Ready");

  const analyse = async (next: FormValues): Promise<void> => {
    const answer = await context.capabilities.call("analyse", { text: String(next.text ?? "") });
    setResult([
      `Characters: ${answer.characters}`,
      `Words: ${answer.words}`,
      `Lines: ${answer.lines}`,
    ].join("\n"));
  };

  return (
    <UI.AppLayout title="Text analysis" description={<>Analyses: {state.analyses ?? 0}</>}>
      <UI.Grid>
        <UI.Form fields={[
          { id: "text", label: "Text", type: "textarea", rows: 6, placeholder: "Enter text" },
        ]} values={values} onChange={setValues} onSubmit={analyse} submitLabel="Analyze" />
        <UI.Stack><pre aria-live="polite" className="min-h-[90px] overflow-auto rounded-md border border-border bg-muted p-2.5 font-mono whitespace-pre-wrap">{result}</pre></UI.Stack>
      </UI.Grid>
    </UI.AppLayout>
  );
};

const root = document.getElementById("root");
if (!root) throw new Error("The #root element is missing.");
createRoot(root).render(<App />);
```

#### src/contract.ts

```typescript
import { Type } from "typebox";

export const contract = {
  state: Type.Object({ analyses: Type.Optional(Type.Integer({"minimum": 0})) }, {"additionalProperties": false}),
  functions: {
    analyse: {
      label: "Analyze text",
      description: "Counts words, characters, and lines without external effects.",
      tool: { name: "analyse_text" },
      input: Type.Object({ text: Type.String({"description": "The text to analyze."}) }, {"additionalProperties": false}),
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

test("counts words, lines, and further analyses", async () => {
  const context = createTestContext<Static<typeof contract.state>>({ state: {} });
  assert.deepEqual(await program.functions.analyse({"text": "  Hello world\nNew line  "}, context), {"text": "Hello world\nNew line", "characters": 20, "words": 4, "lines": 2, "analyses": 1});
  assert.deepEqual(await program.functions.analyse({"text": ""}, context), {"text": "", "characters": 0, "words": 0, "lines": 0, "analyses": 2});
  assert.deepEqual(context.state.read(), {"analyses": 2});
});
```

### headless-counter: Counter without interface

A TypeScript actor counts inputs in its state and offers the same work as a function.

#### package.json

```json
{
  "name": "headless-counter",
  "private": true,
  "type": "module",
  "ragents": {
    "title": "Counter",
    "description": "Collects incoming texts without model calls or interface.",
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
      label: "Count text",
      input: Type.Object({ text: Type.String() }, { additionalProperties: false }),
      output: Type.Object({ count: Type.Integer(), texts: Type.Array(Type.String()) }, { additionalProperties: false }),
      tool: { name: "record_text" },
    },
    inspect: {
      label: "Read counter",
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

test("inputs and functions share the same counter", async () => {
  const context = createTestContext<Static<typeof contract.state>>({ state: {} });
  for (const content of ["one", "two", "three"]) {
    await program.onInput!({ id: content, content, artifactIds: [], sourceEventIds: [], subscriptionId: null, event: null }, context);
  }
  assert.deepEqual(await program.functions.inspect({}, context), { texts: ["one", "two", "three"], count: 3 });
  assert.deepEqual(await program.functions.record({ text: "four" }, context), { texts: ["one", "two", "three", "four"], count: 4 });
  assert.deepEqual(context.state.read(), { texts: ["one", "two", "three", "four"], count: 4 });
});
```

### shared-list: Shared list of an actor

An actor owns a function and a React view for the same list state.

#### package.json

```json
{
  "name": "shared-list",
  "private": true,
  "type": "module",
  "ragents": {
    "title": "Shared list",
    "description": "Collects texts from the app and from an agent tool in a shared list.",
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
  const [status, setStatus] = React.useState("Ready");
  const entries = state.entries ?? [];

  const append = async (next: FormValues): Promise<void> => {
    const answer = await context.capabilities.call("append", { text: String(next.text ?? "") });
    setValues({ text: "" });
    setStatus(`Added: ${answer.text}`);
  };

  return (
    <UI.AppLayout title="Shared list" description={<>{entries.length} {entries.length === 1 ? "item" : "items"}</>}>
      <UI.Grid>
        <UI.Form fields={[
          { id: "text", label: "New item", type: "textarea", placeholder: "Enter text" },
        ]} values={values} onChange={setValues} onSubmit={append} submitLabel="Add" />
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
if (!root) throw new Error("The #root element is missing.");
createRoot(root).render(<App />);
```

#### src/contract.ts

```typescript
import { Type } from "typebox";

export const contract = {
  state: Type.Object({ entries: Type.Optional(Type.Array(Type.String())) }, {"additionalProperties": false}),
  functions: {
    append: {
      label: "Add entry",
      description: "Appends the entered text to the shared list.",
      input: Type.Object({ text: Type.String({"description": "The text for the new list entry."}) }, {"additionalProperties": false}),
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

test("adds entries without losing existing entries", async () => {
  const context = createTestContext<Static<typeof contract.state>>({ state: {} });
  assert.deepEqual(await program.functions.append({"text": "  First entry  "}, context), {"text": "First entry", "entries": ["First entry"]});
  assert.deepEqual(await program.functions.append({"text": "Second entry"}, context), {"text": "Second entry", "entries": ["First entry", "Second entry"]});
  assert.deepEqual(context.state.read(), {"entries": ["First entry", "Second entry"]});
});
```

## Actor program

actor_program_create creates a package under @actors/<name>/ with fixed local dependencies. File tools and language servers use this alias, Bash uses the same alias as cwd. Before model requests, short diagnostic deltas of changed projects appear. actor_program_diagnostics returns the last complete state, actor_program_activate checks, builds, tests, and activates the package.

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

## Actor backend contract

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

## Mini-app client

The client API is generated from the actor contract in @ragents/client. The general reference shows the structure without concrete functions. The package contains the specialized type files for the TypeScript compiler and the language server.

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

## Type contract of the mini-app UI

Entry point: apps/web/src/actor-programs/client-ui/contracts.d.ts. All locally referenced type files follow automatically; TypeScript generates declarations from implementation files. External standard types such as React and DOM belong to their libraries. In the app package, these building blocks are available for regular import as @ragents/client/ui; context and useAppState are imported from @ragents/client.

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

#### apps/web/src/actor-programs/client-ui/chat-contracts.d.ts

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

/** An action waiting for input from the user; payload and result belong to the plugin in owner, a set status marks it done. */
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
  /** Sender identity for the display, independent of role and bubble label. */
  sender?: string;
  text: string;
  textCursor?: ChatTextCursor;
  closed?: boolean;
  attachments?: ChatAttachment[];
  tool?: ToolInfo;
  action?: PendingAction;
  /** ISO time of the message, shown with showTimestamps. */
  at?: string;
  /** The actor input behind an incoming message; the steering mark belongs to it. */
  inputId?: string;
  /** The message went into a turn that was already running instead of starting its own. */
  steered?: boolean;
  /** A colored bubble instead of plain text, for example in conversations of several parties. */
  bubble?: { color: string; side: "start" | "end"; label?: string };
}
```

#### apps/web/src/actor-programs/client-ui/contracts.d.ts

```typescript
import type { ReactElement, ReactNode } from "react";
import type { ChatAttachment, ChatAttachmentCapabilities, ChatAttachmentInput, Message } from "./chat-contracts";

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
  /** The selection stays local; the view decides about reading and transferring. */
  onChange: (files: File[]) => void | Promise<void>;
  /** File extensions or MIME types, e.g. .csv,image/*; also checked for drop and paste. */
  accept?: string;
  multiple?: boolean;
  /** Maximum number of files in the whole selection; default 10, exactly one file with multiple=false. */
  maxFiles?: number;
  /** Maximum total size in bytes; default 20 MiB. */
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
/** Equal responsive columns based on the container width, including inside a surface frame. */
export declare function Grid(props: GridProps): ReactElement;
```

#### apps/web/src/actor-programs/client-ui/message-list-contracts.d.ts

```typescript
import type { ReactElement, ReactNode } from "react";
import type { ChatAttachment } from "./chat-contracts";

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
  /** Language for code highlighting; alternatively filename determines the language. */
  language?: string;
  filename?: string;
}

export interface DiffViewerProps {
  title?: string;
  /** An existing unified diff; the control compares no files and writes nothing. */
  patch: string;
  emptyText?: string;
  /** Language for code highlighting; alternatively filename or the path in the diff determines the language. */
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
import { type ReactNode } from "react";
import { useRender } from "@base-ui/react/use-render";
import { type VariantProps } from "class-variance-authority";
type BadgeDisplay = "badge" | "dot";
/** In "dot" mode every Badge below shows a small info dot and keeps its text for screen readers only. */
declare function BadgeDisplayProvider({ children, value }: {
    children: ReactNode;
    value: BadgeDisplay;
}): import("react").JSX.Element;
declare const badgeVariants: (props?: ({
    variant?: "default" | "destructive" | "link" | "secondary" | "outline" | "ghost" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
declare function Badge({ className, variant, render, ...props }: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>): import("react").ReactElement<unknown, string | import("react").JSXElementConstructor<any>>;
export { Badge, BadgeDisplayProvider, badgeVariants };
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
export type ModalScope = "page" | "run" | "workspace" | "surface";
export type DialogSize = "small" | "medium" | "large" | "wide" | "full";
export declare const RunModalContext: React.Context<HTMLElement | null>;
export declare const WorkspaceModalContext: React.Context<HTMLElement | null>;
export declare const SurfaceModalContext: React.Context<HTMLElement | null>;
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
export { Badge, BadgeDisplayProvider, badgeVariants } from "./badge";
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
export { ConnectionStateIcon, connectionStateTone, RunStateIcon, runStateTone } from "./state-icon";
export { StopButton, StopGlyph } from "./stop-button";
export { connectionStateWord, runStateWord, type ConnectionStateName, type RunStateName } from "./state-vocabulary";
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
/** Controlled grouped selection with a detail page and a return path on narrow screens. */
export declare function ListDetail({ label, items, selectedId, onSelect, disabled, toolbar, detailHeader, children, detailFooter, emptyState, detailLabel, className }: ListDetailProps): import("react").JSX.Element;
```

#### apps/web/src/ui/popover.d.ts

```typescript
import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
declare function Popover({ ...props }: PopoverPrimitive.Root.Props): React.JSX.Element;
declare function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props): React.JSX.Element;
declare function PopoverContent({ className, align, alignOffset, side, sideOffset, anchor, collisionPadding, container, keepMounted, dim, ...props }: PopoverPrimitive.Popup.Props & Pick<PopoverPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset" | "anchor" | "collisionPadding"> & Pick<PopoverPrimitive.Portal.Props, "container" | "keepMounted"> & {
    /** Dims the rest of the page so the pop-out stands out; a click outside closes it. */
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
/** The time in the list: now, 5min, 3h, 2d, from seven days on the date. Without "ago", without a special case for yesterday. */
export declare const shortTime: (at: number, now?: number) => string;
/** The same time written out; it appears only in the title of the compact time. */
export declare const longTime: (at: number, now?: number) => string;
```

#### apps/web/src/ui/SectionLabel.d.ts

```typescript
import type { ComponentProps, ReactNode } from "react";
/** The small uppercase group label above a section; extra content is pushed to the opposite end. */
export declare function SectionLabel({ className, ...props }: ComponentProps<"div">): import("react").JSX.Element;
/** A page section's heading in the same label style: the count next to the title, an action at the opposite end. */
export declare function SectionHeading({ title, count, children }: {
    title: string;
    count?: number;
    children?: ReactNode;
}): import("react").JSX.Element;
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
/** What a surface shows while it has no content yet: ongoing work, an error or a calm notice. */
export interface StartupNoticeState {
    kind: "working" | "error" | "waiting" | "stopped";
    title: string;
    detail: string;
}
/** The one loading state for surface, run panel and its start: title, a progress bar while work is running, below it what is happening right now. */
export declare function StartupNotice({ children, className, state }: {
    children?: ReactNode;
    className?: string;
    state: StartupNoticeState;
}): import("react").JSX.Element;
```

#### apps/web/src/ui/state-icon.d.ts

```typescript
import { type ConnectionStateName, type RunStateName } from "./state-vocabulary";
export declare const runStateTone: (state: RunStateName) => string;
export declare const connectionStateTone: (state: ConnectionStateName) => string;
/** The whole run state in one glyph: the tone carries the state, a dot inside the ring says something is new. */
export declare function RunStateIcon({ state, open, notice, className }: {
    state: RunStateName;
    open?: number;
    notice?: "unseen" | "updated";
    className?: string;
}): import("react").JSX.Element;
export declare function ConnectionStateIcon({ state, className }: {
    state: ConnectionStateName;
    className?: string;
}): import("react").JSX.Element;
```

#### apps/web/src/ui/state-vocabulary.d.ts

```typescript
/** The vocabulary of all pages: exactly one word per state, which appears in the panel only as a title. */
export type RunStateName = "running" | "waiting" | "paused" | "idle" | "ended" | "failed" | "cancelled";
export type ConnectionStateName = "connected" | "ready" | "starting" | "login-required" | "unreachable" | "stopped" | "failed" | "forbidden";
/** When a run is waiting, the word names the number of open inputs; a tool name never appears in the state. */
export declare const runStateWord: (state: RunStateName, open?: number) => string;
export declare const connectionStateWord: (state: ConnectionStateName) => string;
```

#### apps/web/src/ui/stop-button.d.ts

```typescript
import { SquareIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "./button";
/** The one stop glyph: a filled red square; a state icon never carries it. */
export declare function StopGlyph({ className, ...props }: Omit<ComponentProps<typeof SquareIcon>, "fill">): import("react").JSX.Element;
/** Every stop button looks the same: the glyph as the icon, the word in the tooltip, red at rest and on hover. */
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

[Count characters, words, and lines](#start-ragents.reference.80-actor-text-analysis), [Pass a list through four AI helpers](#start-ragents.reference.20-circle-of-four), [Clarify a decision](#start-ragents.reference.decision-brief), [Learning goal in stages](#start-ragents.reference.learning-sprint), [Count messages without AI](#start-ragents.reference.70-headless-counter), [Hide notes and find them again](#start-ragents.reference.90-actor-notes), [Maintain a list in the chat and in a window](#start-ragents.reference.100-shared-actor-list), [Set up collection board](#start-ragents.reference.shared-actor-list), [Set up conversation circle](#start-ragents.reference.conversation-circle), [Moderated round without coordinator](#start-ragents.reference.moderated-round), [Set up balcony wizard](#start-ragents.reference.balcony-wizard), [Editorial workbench](#start-ragents.reference.150-editorial-workbench), [Learning afternoon](#start-ragents.reference.learning-afternoon), [Start word game](#start-ragents.reference.word-game), [Learning companion with materials](#start-ragents.reference.160-learning-companion), [Image collection with captions](#start-ragents.reference.170-photo-collection), [Decision workbench](#start-ragents.reference.180-decision-workbench), [Review texts and share results selectively](#start-ragents.reference.190-review-queue), [Find errors in an appointment list](#start-ragents.reference.200-typescript-diagnostics), [Hand a conversation over to a moderator](#start-ragents.reference.210-moderator-handover), [Approve proposals together](#start-ragents.reference.220-actor-approval-list), [One list in two views](#start-ragents.reference.230-shared-state-views), [Collect answers automatically](#start-ragents.reference.240-live-result-list), [Balcony wizard](#start-ragents.reference.250-balcony-wizard), [Open the helper behind a mini-app](#example-mini-app-owner-inspector), [Switch between chat and apps](#example-switch-chat-and-apps), [Keep an eye on two runs](#example-global-run-overview), [Start a prepared circle globally](#example-global-prepared-run), [Start over after planning](#example-reset-completed-global-chat), [Cancel a reset at first](#example-reset-without-losing-draft), [Set up the coordinator for short answers](#example-coordinator-model-settings), [Choose the model for short titles](#example-title-model-selection), [Turn off automatic titles](#example-disable-generated-titles), [Map a capability to its plugin](#example-extension-capability-settings), [See the language server as a run process](#example-language-server-process), [Open a short-lived local preview](#example-local-preview-process), [Read a draft in the file tree](#example-workspace-draft-preview), [Compare files with the same name in two runs](#example-separate-run-files), [Find a shared list again after a restart](#example-restore-shared-list), [Continue two conversation histories after a restart](#example-restore-conversation-context), [Discuss your own sketch in the chat](#example-image-paste-conversation), [Compare a short clip with its schedule](#example-video-and-document-drop)

### Concept demo

[Hello world on the surface](#start-ragents.reference.95-hello-world), [Count characters, words, and lines](#start-ragents.reference.80-actor-text-analysis), [Pass a list through four AI helpers](#start-ragents.reference.20-circle-of-four), [Clarify a decision](#start-ragents.reference.decision-brief), [Have a message delivered](#start-ragents.reference.30-llm-without-runtime-knowledge), [Learning goal in stages](#start-ragents.reference.learning-sprint), [Complete three tasks in order](#start-ragents.reference.35-actor-input-fifo), [Listen in on other helpers selectively](#start-ragents.reference.40-subscription-matrix), [Turn a forwarding off again](#start-ragents.reference.50-subscription-removal), [Stop a helper in the conversation circle](#start-ragents.reference.60-stop-in-the-circle), [Pass on a note selectively](#start-ragents.reference.65-artifact-least-privilege), [Count messages without AI](#start-ragents.reference.70-headless-counter), [Find errors in C# and TypeScript](#start-ragents.reference.75-lsp-demo), [Hide notes and find them again](#start-ragents.reference.90-actor-notes), [Maintain a list in the chat and in a window](#start-ragents.reference.100-shared-actor-list), [Set up collection board](#start-ragents.reference.shared-actor-list), [See question, tasks, and document together](#start-ragents.reference.110-all-card-slots), [Set up conversation circle](#start-ragents.reference.conversation-circle), [Moderated round without coordinator](#start-ragents.reference.moderated-round), [Set up balcony wizard](#start-ragents.reference.balcony-wizard), [Editorial workbench](#start-ragents.reference.150-editorial-workbench), [Learning afternoon](#start-ragents.reference.learning-afternoon), [Start word game](#start-ragents.reference.word-game), [Learning companion with materials](#start-ragents.reference.160-learning-companion), [Image collection with captions](#start-ragents.reference.170-photo-collection), [Take stock of the run](#start-ragents.reference.run-roster), [Decision workbench](#start-ragents.reference.180-decision-workbench), [Add a quick note](#start-ragents.reference.quick-note), [Review texts and share results selectively](#start-ragents.reference.190-review-queue), [Find errors in an appointment list](#start-ragents.reference.200-typescript-diagnostics), [Hand a conversation over to a moderator](#start-ragents.reference.210-moderator-handover), [Approve proposals together](#start-ragents.reference.220-actor-approval-list), [One list in two views](#start-ragents.reference.230-shared-state-views), [Collect answers automatically](#start-ragents.reference.240-live-result-list), [Balcony wizard](#start-ragents.reference.250-balcony-wizard), [Open the helper behind a mini-app](#example-mini-app-owner-inspector), [Switch between chat and apps](#example-switch-chat-and-apps), [Keep an eye on two runs](#example-global-run-overview), [Start a prepared circle globally](#example-global-prepared-run), [Start over after planning](#example-reset-completed-global-chat), [Cancel a reset at first](#example-reset-without-losing-draft), [Set up the coordinator for short answers](#example-coordinator-model-settings), [Choose the model for short titles](#example-title-model-selection), [Turn off automatic titles](#example-disable-generated-titles), [Map a capability to its plugin](#example-extension-capability-settings), [See the language server as a run process](#example-language-server-process), [Open a short-lived local preview](#example-local-preview-process), [Read a draft in the file tree](#example-workspace-draft-preview), [Compare files with the same name in two runs](#example-separate-run-files), [Find a shared list again after a restart](#example-restore-shared-list), [Continue two conversation histories after a restart](#example-restore-conversation-context), [Discuss your own sketch in the chat](#example-image-paste-conversation), [Compare a short clip with its schedule](#example-video-and-document-drop)

| Concept | Examples |
| --- | --- |
| Agent teams | [Pass a list through four AI helpers](#start-ragents.reference.20-circle-of-four), [Have a message delivered](#start-ragents.reference.30-llm-without-runtime-knowledge), [Learning companion with materials](#start-ragents.reference.160-learning-companion), [Image collection with captions](#start-ragents.reference.170-photo-collection), [Review texts and share results selectively](#start-ragents.reference.190-review-queue), [Hand a conversation over to a moderator](#start-ragents.reference.210-moderator-handover), [Approve proposals together](#start-ragents.reference.220-actor-approval-list) |
| TypeScript actors | [Count characters, words, and lines](#start-ragents.reference.80-actor-text-analysis), [Pass a list through four AI helpers](#start-ragents.reference.20-circle-of-four), [Count messages without AI](#start-ragents.reference.70-headless-counter), [Hide notes and find them again](#start-ragents.reference.90-actor-notes), [Maintain a list in the chat and in a window](#start-ragents.reference.100-shared-actor-list), [Decision workbench](#start-ragents.reference.180-decision-workbench), [Collect answers automatically](#start-ragents.reference.240-live-result-list) |
| Subscriptions | [Pass a list through four AI helpers](#start-ragents.reference.20-circle-of-four), [Have a message delivered](#start-ragents.reference.30-llm-without-runtime-knowledge), [Listen in on other helpers selectively](#start-ragents.reference.40-subscription-matrix), [Turn a forwarding off again](#start-ragents.reference.50-subscription-removal), [Collect answers automatically](#start-ragents.reference.240-live-result-list) |
| Input queue | [Complete three tasks in order](#start-ragents.reference.35-actor-input-fifo), [Review texts and share results selectively](#start-ragents.reference.190-review-queue) |
| Stopping actors | [Have a message delivered](#start-ragents.reference.30-llm-without-runtime-knowledge), [Stop a helper in the conversation circle](#start-ragents.reference.60-stop-in-the-circle), [Review texts and share results selectively](#start-ragents.reference.190-review-queue) |
| Artifacts and access | [Pass on a note selectively](#start-ragents.reference.65-artifact-least-privilege), [Review texts and share results selectively](#start-ragents.reference.190-review-queue) |
| App navigation | [Open the helper behind a mini-app](#example-mini-app-owner-inspector), [Switch between chat and apps](#example-switch-chat-and-apps) |
| Mini-apps | [Hello world on the surface](#start-ragents.reference.95-hello-world), [Count characters, words, and lines](#start-ragents.reference.80-actor-text-analysis), [Hide notes and find them again](#start-ragents.reference.90-actor-notes), [Maintain a list in the chat and in a window](#start-ragents.reference.100-shared-actor-list), [Editorial workbench](#start-ragents.reference.150-editorial-workbench), [Learning companion with materials](#start-ragents.reference.160-learning-companion), [Image collection with captions](#start-ragents.reference.170-photo-collection), [Decision workbench](#start-ragents.reference.180-decision-workbench), [Review texts and share results selectively](#start-ragents.reference.190-review-queue), [Approve proposals together](#start-ragents.reference.220-actor-approval-list), [One list in two views](#start-ragents.reference.230-shared-state-views), [Collect answers automatically](#start-ragents.reference.240-live-result-list), [Balcony wizard](#start-ragents.reference.250-balcony-wizard) |
| Actor state | [Count characters, words, and lines](#start-ragents.reference.80-actor-text-analysis), [Count messages without AI](#start-ragents.reference.70-headless-counter), [Hide notes and find them again](#start-ragents.reference.90-actor-notes), [Maintain a list in the chat and in a window](#start-ragents.reference.100-shared-actor-list), [Decision workbench](#start-ragents.reference.180-decision-workbench), [Approve proposals together](#start-ragents.reference.220-actor-approval-list), [One list in two views](#start-ragents.reference.230-shared-state-views), [Collect answers automatically](#start-ragents.reference.240-live-result-list), [Balcony wizard](#start-ragents.reference.250-balcony-wizard) |
| LLM actor with view | [Learning companion with materials](#start-ragents.reference.160-learning-companion), [Image collection with captions](#start-ragents.reference.170-photo-collection), [Approve proposals together](#start-ragents.reference.220-actor-approval-list) |
| Actor chat | [Learning companion with materials](#start-ragents.reference.160-learning-companion), [Image collection with captions](#start-ragents.reference.170-photo-collection) |
| Controlled chat | [Decision workbench](#start-ragents.reference.180-decision-workbench), [Approve proposals together](#start-ragents.reference.220-actor-approval-list) |
| Language diagnostics | [Find errors in C# and TypeScript](#start-ragents.reference.75-lsp-demo), [Find errors in an appointment list](#start-ragents.reference.200-typescript-diagnostics) |
| Primary actor | [Moderated round without coordinator](#start-ragents.reference.moderated-round), [Set up balcony wizard](#start-ragents.reference.balcony-wizard), [Learning afternoon](#start-ragents.reference.learning-afternoon), [Hand a conversation over to a moderator](#start-ragents.reference.210-moderator-handover) |
| Start guide | [Set up collection board](#start-ragents.reference.shared-actor-list), [Set up conversation circle](#start-ragents.reference.conversation-circle) |
| Questions | [See question, tasks, and document together](#start-ragents.reference.110-all-card-slots), [Hand a conversation over to a moderator](#start-ragents.reference.210-moderator-handover) |
| To-dos | [See question, tasks, and document together](#start-ragents.reference.110-all-card-slots), [Hand a conversation over to a moderator](#start-ragents.reference.210-moderator-handover) |
| Journal inspection | [Complete three tasks in order](#start-ragents.reference.35-actor-input-fifo), [Listen in on other helpers selectively](#start-ragents.reference.40-subscription-matrix), [Stop a helper in the conversation circle](#start-ragents.reference.60-stop-in-the-circle), [Count messages without AI](#start-ragents.reference.70-headless-counter), [Review texts and share results selectively](#start-ragents.reference.190-review-queue) |
| Run scripts | [Set up collection board](#start-ragents.reference.shared-actor-list), [Set up conversation circle](#start-ragents.reference.conversation-circle), [Moderated round without coordinator](#start-ragents.reference.moderated-round), [Set up balcony wizard](#start-ragents.reference.balcony-wizard), [Learning afternoon](#start-ragents.reference.learning-afternoon), [Start word game](#start-ragents.reference.word-game), [Take stock of the run](#start-ragents.reference.run-roster), [Add a quick note](#start-ragents.reference.quick-note) |
| Skills | [Clarify a decision](#start-ragents.reference.decision-brief), [Learning goal in stages](#start-ragents.reference.learning-sprint) |
| Actor functions | [Count characters, words, and lines](#start-ragents.reference.80-actor-text-analysis), [Count messages without AI](#start-ragents.reference.70-headless-counter), [Hide notes and find them again](#start-ragents.reference.90-actor-notes), [Maintain a list in the chat and in a window](#start-ragents.reference.100-shared-actor-list), [Editorial workbench](#start-ragents.reference.150-editorial-workbench), [Approve proposals together](#start-ragents.reference.220-actor-approval-list), [One list in two views](#start-ragents.reference.230-shared-state-views), [Balcony wizard](#start-ragents.reference.250-balcony-wizard) |
| View visibility | [Count characters, words, and lines](#start-ragents.reference.80-actor-text-analysis), [Hide notes and find them again](#start-ragents.reference.90-actor-notes) |
| Global coordinator | [Keep an eye on two runs](#example-global-run-overview), [Start a prepared circle globally](#example-global-prepared-run) |
| Conversation reset | [Start over after planning](#example-reset-completed-global-chat), [Cancel a reset at first](#example-reset-without-losing-draft) |
| Settings and model selection | [Set up the coordinator for short answers](#example-coordinator-model-settings), [Choose the model for short titles](#example-title-model-selection), [Turn off automatic titles](#example-disable-generated-titles), [Map a capability to its plugin](#example-extension-capability-settings) |
| Process display | [See the language server as a run process](#example-language-server-process), [Open a short-lived local preview](#example-local-preview-process) |
| Files and workspace | [Read a draft in the file tree](#example-workspace-draft-preview), [Compare files with the same name in two runs](#example-separate-run-files) |
| Recovery after restart | [Find a shared list again after a restart](#example-restore-shared-list), [Continue two conversation histories after a restart](#example-restore-conversation-context) |
| Multimodal input | [Discuss your own sketch in the chat](#example-image-paste-conversation), [Compare a short clip with its schedule](#example-video-and-document-drop) |

## Walkthroughs

Walkthroughs explain step by step how to use existing functions in the interface. They are documentation, not additional start cards or evidence of completed model runs. You can follow the steps in the application.

<a id="example-mini-app-owner-inspector"></a>

### Open the helper behind a mini-app

The app and its owner's chat share one run.

User workflow. Tags: Use case, Concept demo, App navigation.

1. In the showcase profile, open Set up collection board and complete the guide. Expected: The list is available as a mini-app.
2. Open Chat and use the addressee selector's inspection action for the list owner. Expected: Its chat and details are available in Inspection.
3. Open the list app again. Expected: The same app and its entries remain available.

<a id="example-switch-chat-and-apps"></a>

### Switch between chat and apps

Browser tabs keep drafts; VS Code opens one editor per app.

User workflow. Tags: Use case, Concept demo, App navigation.

1. Create two mini-apps in one run. Expected: Both become available without changing the selected chat.
2. In the browser, type an unsent chat draft, open an app and enter local input, then switch to Chat and back. Expected: Exactly one view is visible and both drafts survive.
3. In VS Code, open an app twice, move its editor to another group and open it again from the panel. Expected: The same editor is focused in its current group.
4. Hide the selected browser app. Expected: Chat is selected; showing the app again does not change selection. Questions and news remain in chat.

<a id="example-global-run-overview"></a>

### Keep an eye on two runs

The global coordinator reads existing runs while the current surface stays open.

User workflow. Tags: Use case, Concept demo, Global coordinator.

1. In the showcase profile, create two short runs about a reading list and a weekly plan and wait for their answers.
2. Click the Global coordinator input in the header to open its history. Ask for a brief overview of both runs with their current progress.
3. Open the run list via the overview corner or Cmd+I on macOS or Ctrl+I, select both runs, and compare the answer with their actual conversations. Expected: The global chat can take both journals into account; switching runs keeps its own history.
4. Type an unsent draft at the top, press Escape, and open the history again. Expected: The dropdown closes without stopping anything; the draft, the current run, and the global conversation are kept.

<a id="example-global-prepared-run"></a>

### Start a prepared circle globally

The global coordinator picks a run script from the existing catalog and creates a new run with it.

User workflow. Tags: Use case, Concept demo, Global coordinator.

1. Click the Global coordinator input in the header and ask: Show the available prepared run scripts and start Set up conversation circle on the topic of learning together with two rounds.
2. After sending, wait for the answer in the history. If the start value is unclear, answer the question based on the catalog shown; do not copy a model id or run id.
3. Open the new run from the run list. Expected: A separate run with the requested topic and the prepared setup is created. Acceptance of the start alone does not prove a completed conversation contribution.
4. After the first actual contribution, open Actors at the bottom and select a conversation partner in the inspector. At the top of the global chat, ask: What does this actor do? Expected: The question receives the run and the selected actor as separate orientation; the visible question text stays unchanged.
5. After sending, open another run. Expected: The question already sent stays bound to its original selection, even if it is processed only later. The global history and both runs stay reachable separately.

<a id="example-reset-completed-global-chat"></a>

### Start over after planning

A confirmed reset clears the global conversation and keeps existing runs and the model selection.

User workflow. Tags: Use case, Concept demo, Conversation reset.

1. Complete a short planning session in the global chat. Keep a normal run open and note the current global model and reasoning selection.
2. Choose Reset conversation and explicitly confirm the confirmation shown. Wait for the success message.
3. Expected: The history, input draft, and attachments of the global chat are empty; the open normal run and the model and reasoning selection remain.
4. Send a new short message. Expected: It starts a fresh global conversation. The reset itself did not start a new model task.

<a id="example-reset-without-losing-draft"></a>

### Cancel a reset at first

The confirmation protects a conversation draft you still need; only the confirmed second attempt clears it.

User workflow. Tags: Use case, Concept demo, Conversation reset.

1. Type a short draft in the global chat without sending it. Open Reset conversation and cancel the confirmation.
2. Expected: The draft and the existing history are kept. Merely showing the confirmation resets nothing.
3. Open Reset conversation again and confirm this time. Do not send another message during the reset.
4. Expected: After success, the draft and history are empty. On an error, its message stays visible and allows a retry; an error must not count as a successful reset.

<a id="example-coordinator-model-settings"></a>

### Set up the coordinator for short answers

Model and reasoning are chosen directly in the global chat and can be found again in the settings.

User workflow. Tags: Use case, Concept demo, Settings and model selection.

1. Open the global history via the toolbar input and, in the dropdown above the history, choose an offered model and a reasoning level available there. Do not assume a level that is not offered.
2. Wait for the confirmed save and then ask a short question. Expected: New work uses the saved selection; a turn that is already running is not changed retroactively.
3. Open the gear and look at the Global coordinator setting under Models. Expected: Both views show the same confirmed selection.
4. If a model change is rejected because of media that already exists, note the visible error message. Expected: The previous valid selection is kept.

<a id="example-title-model-selection"></a>

### Choose the model for short titles

A separate model condenses the task in the run list without changing the agents' models.

User workflow. Tags: Use case, Concept demo, Settings and model selection.

1. Open Settings, Models, and Titles via the gear. With a large list, use the search to find an offered model, select it, and choose Save.
2. Wait for the confirmed save. Expected: The selection stays in the form; Global coordinator as well as New runs and agents keep their own settings.
3. Start a new run with a more detailed task and open the run list. Expected: The original task is already visible. As soon as an automatic title has been generated and saved successfully, the short title appears without an additional manual list refresh. No fixed response time is assumed.
4. Set a different model selection as a draft and choose Discard changes. Expected: The confirmed selection returns; a title that was already generated is not replaced.

<a id="example-disable-generated-titles"></a>

### Turn off automatic titles

New generation can be disabled; existing and explicitly set titles are kept.

User workflow. Tags: Use case, Concept demo, Settings and model selection.

1. Look at a run with an already generated short title in the run list. Under Settings, Models, Titles, select No automatic titles and save.
2. Reload the application and look at the setting again. Expected: The deactivation is saved; the existing short title stays unchanged.
3. Start another run with a normal task. Expected: The run list shows the task without requesting an automatic short title for it.
4. Optionally start Set up collection board and enter a name in the guide. Expected: The prepared flow still sets its own run title. A title model that is enabled again later does not overwrite this name.

<a id="example-extension-capability-settings"></a>

### Map a capability to its plugin

The two views of the settings open up the same inventory from different directions.

User workflow. Tags: Use case, Concept demo, Settings and model selection.

1. Open the settings via the gear and switch to Plugins. In By plugin, select the actor program plugin and look at its tools and web contributions.
2. Switch to By capability, select Tools, and search for actor_program. Expected: The matching contributions appear with their respective plugin as owner.
3. Open the link to the actor program plugin. Expected: Its complete inventory is visible again; a previous search filter does not hide the detail page.
4. Switch to Models and open the coordinator model selection. Only values that are actually offered can be selected; an invalid combination is not silently replaced.

<a id="example-language-server-process"></a>

### See the language server as a run process

A TypeScript check makes the associated language server visible in the process display.

User workflow. Tags: Use case, Concept demo, Process display.

1. In the showcase profile, run the skill template Find errors in an appointment list. It requires an available TypeScript language server; a missing prerequisite must be reported as an error.
2. After the language server has been opened, look at the run's shared header. Expected: The managed language server appears as a process belonging to this run.
3. Open another run and switch back. Expected: The process display follows the selected run and is not a shared list of all processes on the machine.
4. The process display is for observation. It offers no stop button; missing operating system permissions or tools are reported as a visible error.

<a id="example-local-preview-process"></a>

### Open a short-lived local preview

A time-limited demo web process appears in the header with its detected port.

User workflow. Tags: Use case, Concept demo, Process display.

1. In a separate showcase run, ask the coordinator to prepare a small Node demo process in the run workspace: It only serves a neutral greeting text, binds exclusively to 127.0.0.1 on a free port, and exits by itself after two minutes. Do not install additional packages and do not replace a product server.
2. Have the prepared demo process started and look at the header while it runs. Expected: The process appears with a link to its detected open port.
3. Open the port link only on the same machine. Expected: The local demo response appears; with a remote server, its loopback address is not the browser's address.
4. Wait for the intended automatic end. Expected: The entry disappears after the next process refresh. Stopping the run or closing a tab is not promised here to end a detached service.

<a id="example-workspace-draft-preview"></a>

### Read a draft in the file tree

A run writes a small text; the files tab shows its content and a later change without an editor of its own.

User workflow. Tags: Use case, Concept demo, Files and workspace.

1. In a new showcase run, ask the coordinator to create the file reading-list.md with three neutral reading topics in the run workspace.
2. Open the Files tab, expand the workspace, and select reading-list.md. Expected: The written text appears as a preview.
3. Have a fourth topic added in the chat and return to the preview that is still open. Expected: The file change becomes visible in the file browser.
4. Expected: The files tab stays a read-only view. Changes are made by the assigned actor and its file tools, not by a built-in editor or delete button.

<a id="example-separate-run-files"></a>

### Compare files with the same name in two runs

Two independent workspaces contain their own files with the same name.

User workflow. Tags: Use case, Concept demo, Files and workspace.

1. Create a showcase run Reading list and have it write notes.md with the content Prepare reading.
2. Create a second showcase run Weekly plan and have it also write notes.md, this time with the content Plan the week. Do not copy any file between runs.
3. Open the Files tab in both runs one after the other and read notes.md. Expected: The same file name shows the respective content of each run workspace.
4. Have a line added only in the weekly plan and check both previews again. Expected: The file of the reading list run is unchanged.

<a id="example-restore-shared-list"></a>

### Find a shared list again after a restart

A completed actor function is kept when the same profile is restarted normally.

User workflow. Tags: Use case, Concept demo, Recovery after restart.

1. In the showcase profile, open Set up collection board and complete the guide. Add a clearly recognizable entry and wait for the confirmed update of the list.
2. Let all running work finish. Stop the local server yourself using the start method used for this installation and restart it with the same profile and data directory. Do not delete any data and do not start a second server instance in parallel.
3. Open the application again and select the same run. Expected: The conversation, the mini-app, and the confirmed list entry are present again.
4. Check the list for duplicate entries. Expected: The restart restores the saved state but does not run the already completed add action again. The journal alone does not replace a complete backup of the other run files.

<a id="example-restore-conversation-context"></a>

### Continue two conversation histories after a restart

A normal run and the global coordinator each keep their own history.

User workflow. Tags: Use case, Concept demo, Recovery after restart.

1. In a normal showcase run, discuss three learning goals and request a brief overview of this run in the global chat. Wait for both answers to complete and note the global model selection.
2. Restart the local server yourself using the existing start method, with the same profile and data directory. Do not remove any files or transfer them between installations.
3. Open the normal run and then the global chat. Expected: Both previous histories and the global model selection are kept.
4. In the normal run, ask for the next step on the learning goals. Treat the new answer as new work; the restart did not repeat old model calls. A turn that was still open during the restart would have been completed as interrupted and is not run again automatically.

<a id="example-image-paste-conversation"></a>

### Discuss your own sketch in the chat

An image from the clipboard is checked before sending and then shown as an attachment in the history.

User workflow. Tags: Use case, Concept demo, Multimodal input.

1. Copy a harmless sketch of your own to the clipboard. Open a new run and choose an offered model that supports image input.
2. Paste the image into the chat input with Cmd+V or Ctrl+V. Expected: An image preview appears, can be removed again before sending, and has not been sent merely by pasting.
3. Send with the question Which three shapes do you recognize? Expected: After successful acceptance, the message and a persistent image attachment are in the history; the answer is checked against the actual sketch.
4. If the target model does not support image input, the composer must block sending with an understandable message. No matching model in the catalog is a missing prerequisite, not a reason for a claimed image finding.

<a id="example-video-and-document-drop"></a>

### Compare a short clip with its schedule

Video and PDF are explicitly sent to a suitable model via drag and drop.

User workflow. Tags: Use case, Concept demo, Multimodal input.

1. Prepare a short, harmless video clip of your own and a small PDF schedule. Open a chat with an offered model whose published input capabilities allow both video and native PDFs. If there is no such model, this flow cannot be run.
2. Drag both files into the chat input. Expected: The clip gets a preview and the PDF a file label; attachments can be removed individually. Fix visible size or capability errors before sending.
3. Send with the question Which planned steps are visible in the clip? and compare the actual answer with the clip and the schedule. Expected: The attachments stay reachable again in the history.
4. Without video or PDF support, sending stays blocked. There is no silent OCR fallback here and no promise that every offered model understands the files.

## Start page templates

### Category: Mini-apps

<a id="start-ragents.reference.95-hello-world"></a>

### ragents.reference.95-hello-world: Hello world on the surface

Shows the smallest setup of a mini-app on the existing actor: a pure display without a new actor or server function.

Tags: Concept demo, Mini-apps.

```json
{
  "id": "ragents.reference.95-hello-world",
  "owner": "ragents.reference",
  "title": "Hello world on the surface",
  "description": "Shows the smallest setup of a mini-app on the existing actor: a pure display without a new actor or server function.",
  "order": 5,
  "tags": [
    "Concept demo",
    "Mini-apps"
  ],
  "action": "skill",
  "skill": "95-hello-world",
  "category": "Mini-apps",
  "prompt": "I would like a small interface on the surface for your existing actor that simply says Hello world. It should do nothing else. Do not create a new actor or a server function for it."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/95-hello-world/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Hello world on the surface",
  "message": "Use the skill 95-hello-world for this task.\n\nI would like a small interface on the surface for your existing actor that simply says Hello world. It should do nothing else. Do not create a new actor or a server function for it."
}
```

<a id="start-ragents.reference.80-actor-text-analysis"></a>

### ragents.reference.80-actor-text-analysis: Count characters, words, and lines

Shows how the chat and a mini-app use the same TypeScript function and the same call counter. Hiding keeps the actor state.

Tags: Use case, Concept demo, TypeScript actors, Actor functions, Actor state, Mini-apps, View visibility.

```json
{
  "id": "ragents.reference.80-actor-text-analysis",
  "owner": "ragents.reference",
  "title": "Count characters, words, and lines",
  "description": "Shows how the chat and a mini-app use the same TypeScript function and the same call counter. Hiding keeps the actor state.",
  "order": 10,
  "tags": [
    "Use case",
    "Concept demo",
    "TypeScript actors",
    "Actor functions",
    "Actor state",
    "Mini-apps",
    "View visibility"
  ],
  "action": "skill",
  "skill": "80-actor-text-analysis",
  "category": "Mini-apps",
  "prompt": "I would like a text analysis with a text field, a count button, and understandable errors. A TypeScript actor counts characters, words, lines, and its calls without AI. Check \"The world is big.\" and \"And beautiful.\" as two lines: 6 words. The interface shows the same call counter. Hide it and show it again; the state is kept. Use shared layout and form building blocks: input and result side by side, stacked when space is tight."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/80-actor-text-analysis/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Count characters, words, and lines",
  "message": "Use the skill 80-actor-text-analysis for this task.\n\nI would like a text analysis with a text field, a count button, and understandable errors. A TypeScript actor counts characters, words, lines, and its calls without AI. Check \"The world is big.\" and \"And beautiful.\" as two lines: 6 words. The interface shows the same call counter. Hide it and show it again; the state is kept. Use shared layout and form building blocks: input and result side by side, stacked when space is tight."
}
```

<a id="start-ragents.reference.90-actor-notes"></a>

### ragents.reference.90-actor-notes: Hide notes and find them again

Shows an automatically placed mini-app with note selection. When hiding and showing it again, the actor and notes are kept.

Tags: Use case, Concept demo, TypeScript actors, Actor functions, Actor state, Mini-apps, View visibility.

```json
{
  "id": "ragents.reference.90-actor-notes",
  "owner": "ragents.reference",
  "title": "Hide notes and find them again",
  "description": "Shows an automatically placed mini-app with note selection. When hiding and showing it again, the actor and notes are kept.",
  "order": 90,
  "tags": [
    "Use case",
    "Concept demo",
    "TypeScript actors",
    "Actor functions",
    "Actor state",
    "Mini-apps",
    "View visibility"
  ],
  "action": "skill",
  "skill": "90-actor-notes",
  "category": "Mini-apps",
  "prompt": "I would like a TypeScript actor for my notes. Its interface with input and counter should appear on the surface by itself: a searchable list of titles on the left, the selected note on the right. Add a first note through its function. Hide the interface briefly and show it again without deleting the actor or resetting notes. Leave it open for entering my next idea."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/90-actor-notes/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Hide notes and find them again",
  "message": "Use the skill 90-actor-notes for this task.\n\nI would like a TypeScript actor for my notes. Its interface with input and counter should appear on the surface by itself: a searchable list of titles on the left, the selected note on the right. Add a first note through its function. Hide the interface briefly and show it again without deleting the actor or resetting notes. Leave it open for entering my next idea."
}
```

<a id="start-ragents.reference.100-shared-actor-list"></a>

### ragents.reference.100-shared-actor-list: Maintain a list in the chat and in a window

Shows, while building a mini-app, how the interface and the coordinator use the same function of a TypeScript actor and change the same list.

Tags: Use case, Concept demo, TypeScript actors, Actor functions, Actor state, Mini-apps.

```json
{
  "id": "ragents.reference.100-shared-actor-list",
  "owner": "ragents.reference",
  "title": "Maintain a list in the chat and in a window",
  "description": "Shows, while building a mini-app, how the interface and the coordinator use the same function of a TypeScript actor and change the same list.",
  "order": 100,
  "tags": [
    "Use case",
    "Concept demo",
    "TypeScript actors",
    "Actor functions",
    "Actor state",
    "Mini-apps"
  ],
  "action": "skill",
  "skill": "100-shared-actor-list",
  "category": "Mini-apps",
  "prompt": "I would like a shared list on a TypeScript actor without an AI list helper. I add entries through its interface, you through the same function as a tool. Both ways immediately show the same state, even when the chat is idle. Actually add an entry and leave the interface in place. Use shared layout and form building blocks: multi-line input and list side by side, stacked when space is tight."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/100-shared-actor-list/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Maintain a list in the chat and in a window",
  "message": "Use the skill 100-shared-actor-list for this task.\n\nI would like a shared list on a TypeScript actor without an AI list helper. I add entries through its interface, you through the same function as a tool. Both ways immediately show the same state, even when the chat is idle. Actually add an entry and leave the interface in place. Use shared layout and form building blocks: multi-line input and list side by side, stacked when space is tight."
}
```

<a id="start-ragents.reference.150-editorial-workbench"></a>

### ragents.reference.150-editorial-workbench: Editorial workbench

Shows how a mini-app combines text editing, individually acceptable changes, and an edit log into an editorial workbench.

Tags: Actor functions, Use case, Concept demo, Mini-apps.

```json
{
  "id": "ragents.reference.150-editorial-workbench",
  "owner": "ragents.reference",
  "title": "Editorial workbench",
  "description": "Shows how a mini-app combines text editing, individually acceptable changes, and an edit log into an editorial workbench.",
  "order": 150,
  "tags": [
    "Actor functions",
    "Use case",
    "Concept demo",
    "Mini-apps"
  ],
  "action": "skill",
  "skill": "150-editorial-workbench",
  "category": "Mini-apps",
  "prompt": "I would like an editorial workbench: repair cafe, Saturday 10 am to 2 pm, community center, volunteer help, no guarantee. On the left I choose original or short version, on the right I change text and target audience and accept cuts one by one. Show changes and task progress, compare word count and approval in a table. A helper counts the words; a log shows sender, acceptances, and reversals. Publish nothing."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/150-editorial-workbench/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Editorial workbench",
  "message": "Use the skill 150-editorial-workbench for this task.\n\nI would like an editorial workbench: repair cafe, Saturday 10 am to 2 pm, community center, volunteer help, no guarantee. On the left I choose original or short version, on the right I change text and target audience and accept cuts one by one. Show changes and task progress, compare word count and approval in a table. A helper counts the words; a log shows sender, acceptances, and reversals. Publish nothing."
}
```

<a id="start-ragents.reference.160-learning-companion"></a>

### ragents.reference.160-learning-companion: Learning companion with materials

Shows a mini-app of an AI tutor with an embedded actor chat. Locally chosen materials enter the conversation only after an explicit action.

Tags: Use case, Concept demo, Agent teams, Mini-apps, LLM actor with view, Actor chat.

```json
{
  "id": "ragents.reference.160-learning-companion",
  "owner": "ragents.reference",
  "title": "Learning companion with materials",
  "description": "Shows a mini-app of an AI tutor with an embedded actor chat. Locally chosen materials enter the conversation only after an explicit action.",
  "order": 160,
  "tags": [
    "Use case",
    "Concept demo",
    "Agent teams",
    "Mini-apps",
    "LLM actor with view",
    "Actor chat"
  ],
  "action": "skill",
  "skill": "160-learning-companion",
  "category": "Mini-apps",
  "prompt": "I would like an AI tutor with its own interface on the surface: open and read text materials, and talk to exactly this tutor next to them. I want to choose between explanation, example, and comprehension check. The selected file should be used in the conversation only after my click. Questions without a file should work too. Use the existing chat, file, and selection building blocks."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/160-learning-companion/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Learning companion with materials",
  "message": "Use the skill 160-learning-companion for this task.\n\nI would like an AI tutor with its own interface on the surface: open and read text materials, and talk to exactly this tutor next to them. I want to choose between explanation, example, and comprehension check. The selected file should be used in the conversation only after my click. Questions without a file should work too. Use the existing chat, file, and selection building blocks."
}
```

<a id="start-ragents.reference.170-photo-collection"></a>

### ragents.reference.170-photo-collection: Image collection with captions

Shows a mini-app of an AI writing helper with image previews, editable captions, and a direct chat. Selecting local images does not send them to the AI yet.

Tags: Use case, Concept demo, Agent teams, Mini-apps, LLM actor with view, Actor chat.

```json
{
  "id": "ragents.reference.170-photo-collection",
  "owner": "ragents.reference",
  "title": "Image collection with captions",
  "description": "Shows a mini-app of an AI writing helper with image previews, editable captions, and a direct chat. Selecting local images does not send them to the AI yet.",
  "order": 170,
  "tags": [
    "Use case",
    "Concept demo",
    "Agent teams",
    "Mini-apps",
    "LLM actor with view",
    "Actor chat"
  ],
  "action": "skill",
  "skill": "170-photo-collection",
  "category": "Mini-apps",
  "prompt": "I would like an AI writing helper with its own interface for a small image collection: drag images in, see previews, search the list, and edit title, caption, and alt text for each image. Next to it I want a chat with exactly this writing helper and a readable overview of all captions. My images stay local until I send something in the chat myself. Use the existing building blocks."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/170-photo-collection/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Image collection with captions",
  "message": "Use the skill 170-photo-collection for this task.\n\nI would like an AI writing helper with its own interface for a small image collection: drag images in, see previews, search the list, and edit title, caption, and alt text for each image. Next to it I want a chat with exactly this writing helper and a readable overview of all captions. My images stay local until I send something in the chat myself. Use the existing building blocks."
}
```

<a id="start-ragents.reference.180-decision-workbench"></a>

### ragents.reference.180-decision-workbench: Decision workbench

Shows a strictly guided conversation without AI calls. A TypeScript actor keeps answers and progress; changes to the decision draft become visible.

Tags: Use case, Concept demo, TypeScript actors, Actor state, Mini-apps, Controlled chat.

```json
{
  "id": "ragents.reference.180-decision-workbench",
  "owner": "ragents.reference",
  "title": "Decision workbench",
  "description": "Shows a strictly guided conversation without AI calls. A TypeScript actor keeps answers and progress; changes to the decision draft become visible.",
  "order": 180,
  "tags": [
    "Use case",
    "Concept demo",
    "TypeScript actors",
    "Actor state",
    "Mini-apps",
    "Controlled chat"
  ],
  "action": "skill",
  "skill": "180-decision-workbench",
  "category": "Mini-apps",
  "prompt": "I would like a local decision aid: library or cafe as a place to study? Fixed questions guide me through goal, options, and criteria, record my decision, and show the progress. If I change my mind, I want to see the difference from the previous draft. A TypeScript actor keeps the shared progress and the answers. This should be a clearly recognizable guide without AI calls, using the existing chat building blocks."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/180-decision-workbench/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Decision workbench",
  "message": "Use the skill 180-decision-workbench for this task.\n\nI would like a local decision aid: library or cafe as a place to study? Fixed questions guide me through goal, options, and criteria, record my decision, and show the progress. If I change my mind, I want to see the difference from the previous draft. A TypeScript actor keeps the shared progress and the answers. This should be a clearly recognizable guide without AI calls, using the existing chat building blocks."
}
```

<a id="start-ragents.reference.190-review-queue"></a>

### ragents.reference.190-review-queue: Review texts and share results selectively

Shows the input queue, selective result sharing, and stopping an actor using three text reviews. The mini-app collects unprotected status messages.

Tags: Journal inspection, Use case, Concept demo, Agent teams, Input queue, Stopping actors, Artifacts and access, Mini-apps.

```json
{
  "id": "ragents.reference.190-review-queue",
  "owner": "ragents.reference",
  "title": "Review texts and share results selectively",
  "description": "Shows the input queue, selective result sharing, and stopping an actor using three text reviews. The mini-app collects unprotected status messages.",
  "order": 190,
  "tags": [
    "Journal inspection",
    "Use case",
    "Concept demo",
    "Agent teams",
    "Input queue",
    "Stopping actors",
    "Artifacts and access",
    "Mini-apps"
  ],
  "action": "skill",
  "skill": "190-review-queue",
  "category": "Mini-apps",
  "prompt": "I would like three separate text reviews for the neighborhood party, which I queue during the first review. Only the designated recipient may read the first result; also test an access without sharing. After that, you sign the reviewer off. Prove order, access, and stop. An interface of the existing coordinator shows only unprotected status messages from various senders on the surface. I want to be able to add a note of my own."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/190-review-queue/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Review texts and share results selectively",
  "message": "Use the skill 190-review-queue for this task.\n\nI would like three separate text reviews for the neighborhood party, which I queue during the first review. Only the designated recipient may read the first result; also test an access without sharing. After that, you sign the reviewer off. Prove order, access, and stop. An interface of the existing coordinator shows only unprotected status messages from various senders on the surface. I want to be able to add a note of my own."
}
```

<a id="start-ragents.reference.220-actor-approval-list"></a>

### ragents.reference.220-actor-approval-list: Approve proposals together

Shows an AI list helper with its own mini-app and shared state. Its proposals can be confirmed through a function without waiting for another AI answer.

Tags: Use case, Concept demo, Agent teams, Actor functions, Actor state, Mini-apps, LLM actor with view, Controlled chat.

```json
{
  "id": "ragents.reference.220-actor-approval-list",
  "owner": "ragents.reference",
  "title": "Approve proposals together",
  "description": "Shows an AI list helper with its own mini-app and shared state. Its proposals can be confirmed through a function without waiting for another AI answer.",
  "order": 220,
  "tags": [
    "Use case",
    "Concept demo",
    "Agent teams",
    "Actor functions",
    "Actor state",
    "Mini-apps",
    "LLM actor with view",
    "Controlled chat"
  ],
  "action": "skill",
  "skill": "220-actor-approval-list",
  "category": "Mini-apps",
  "prompt": "I would like an AI list helper with its own interface. There I review and confirm its proposals; confirmed entries are shown next to them. The helper uses the same functions and the same list when I ask it for an entry in the chat. Have it make a real proposal. Approval by button should confirm its saved proposal without another AI answer. After that I want to enter one myself."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/220-actor-approval-list/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Approve proposals together",
  "message": "Use the skill 220-actor-approval-list for this task.\n\nI would like an AI list helper with its own interface. There I review and confirm its proposals; confirmed entries are shown next to them. The helper uses the same functions and the same list when I ask it for an entry in the chat. Have it make a real proposal. Approval by button should confirm its saved proposal without another AI answer. After that I want to enter one myself."
}
```

<a id="start-ragents.reference.230-shared-state-views"></a>

### ragents.reference.230-shared-state-views: One list in two views

Shows two mini-app views of the same actor state. Changes appear in both; one view can be hidden independently.

Tags: Use case, Concept demo, Actor functions, Actor state, Mini-apps.

```json
{
  "id": "ragents.reference.230-shared-state-views",
  "owner": "ragents.reference",
  "title": "One list in two views",
  "description": "Shows two mini-app views of the same actor state. Changes appear in both; one view can be hidden independently.",
  "order": 230,
  "tags": [
    "Use case",
    "Concept demo",
    "Actor functions",
    "Actor state",
    "Mini-apps"
  ],
  "action": "skill",
  "skill": "230-shared-state-views",
  "category": "Mini-apps",
  "prompt": "I would like a task list with two small windows: in one I add and complete tasks, in the other I only see the open and completed counts. Both belong to the same helper and use the same data. Actually add a task and complete it. Both windows should update immediately. Then hide only the summary and show it again; my list is kept."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/230-shared-state-views/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "One list in two views",
  "message": "Use the skill 230-shared-state-views for this task.\n\nI would like a task list with two small windows: in one I add and complete tasks, in the other I only see the open and completed counts. Both belong to the same helper and use the same data. Actually add a task and complete it. Both windows should update immediately. Then hide only the summary and show it again; my list is kept."
}
```

<a id="start-ragents.reference.240-live-result-list"></a>

### ragents.reference.240-live-result-list: Collect answers automatically

Shows how a TypeScript actor automatically collects finished agent answers through a subscription. Further contributions from the same helper also make the list grow.

Tags: Use case, Concept demo, TypeScript actors, Subscriptions, Actor state, Mini-apps.

```json
{
  "id": "ragents.reference.240-live-result-list",
  "owner": "ragents.reference",
  "title": "Collect answers automatically",
  "description": "Shows how a TypeScript actor automatically collects finished agent answers through a subscription. Further contributions from the same helper also make the list grow.",
  "order": 240,
  "tags": [
    "Use case",
    "Concept demo",
    "TypeScript actors",
    "Subscriptions",
    "Actor state",
    "Mini-apps"
  ],
  "action": "skill",
  "skill": "240-live-result-list",
  "category": "Mini-apps",
  "prompt": "I would like two AI helpers that each suggest a short idea for a shared learning afternoon. Their finished answers should automatically appear in a small result list on the surface. A programmed collector remembers the contributions; no further AI should copy the texts for this. Then have one helper add a second idea. The list should grow by itself, even while you are not writing anything in the chat."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/240-live-result-list/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Collect answers automatically",
  "message": "Use the skill 240-live-result-list for this task.\n\nI would like two AI helpers that each suggest a short idea for a shared learning afternoon. Their finished answers should automatically appear in a small result list on the surface. A programmed collector remembers the contributions; no further AI should copy the texts for this. Then have one helper add a second idea. The list should grow by itself, even while you are not writing anything in the chat."
}
```

<a id="start-ragents.reference.250-balcony-wizard"></a>

### ragents.reference.250-balcony-wizard: Balcony wizard

Shows how to build a standalone mini-app for an adaptive AI interview. The LLM chooses the questions, the form limits the conversation to five answers.

Tags: Use case, Concept demo, Mini-apps, Actor functions, Actor state.

```json
{
  "id": "ragents.reference.250-balcony-wizard",
  "owner": "ragents.reference",
  "title": "Balcony wizard",
  "description": "Shows how to build a standalone mini-app for an adaptive AI interview. The LLM chooses the questions, the form limits the conversation to five answers.",
  "order": 250,
  "tags": [
    "Use case",
    "Concept demo",
    "Mini-apps",
    "Actor functions",
    "Actor state"
  ],
  "action": "skill",
  "skill": "250-balcony-wizard",
  "category": "Mini-apps",
  "prompt": "I would like a balcony wizard as a standalone app on the surface. It mediates a limited conversation with an AI advisor in the background. After each answer, the LLM chooses the next fitting question, no fixed list of questions. After five answers there are design tips. I answer only in the app; it shows question, progress, loading, and error states. Use shared layouts and forms. No app in an LLM chat card."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/250-balcony-wizard/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Balcony wizard",
  "message": "Use the skill 250-balcony-wizard for this task.\n\nI would like a balcony wizard as a standalone app on the surface. It mediates a limited conversation with an AI advisor in the background. After each answer, the LLM chooses the next fitting question, no fixed list of questions. After five answers there are design tips. I answer only in the app; it shows question, progress, loading, and error states. Use shared layouts and forms. No app in an LLM chat card."
}
```

### Category: Collaboration

<a id="start-ragents.reference.decision-brief"></a>

### ragents.reference.decision-brief: Clarify a decision

Shows how a reusable skill guide leads a decision in the chat from criteria to a choice without creating additional actors or scripts.

Tags: Use case, Concept demo, Skills.

```json
{
  "id": "ragents.reference.decision-brief",
  "owner": "ragents.reference",
  "title": "Clarify a decision",
  "description": "Shows how a reusable skill guide leads a decision in the chat from criteria to a choice without creating additional actors or scripts.",
  "order": 20,
  "tags": [
    "Use case",
    "Concept demo",
    "Skills"
  ],
  "action": "skill",
  "skill": "decision-brief",
  "category": "Collaboration",
  "prompt": "I would like help clarifying an open decision and recording the next step."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/decision-brief/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Clarify a decision",
  "message": "Use the skill decision-brief for this task.\n\nI would like help clarifying an open decision and recording the next step."
}
```

<a id="start-ragents.reference.20-circle-of-four"></a>

### ragents.reference.20-circle-of-four: Pass a list through four AI helpers

Shows, while building a word game, how four AI helpers contribute one after another and a TypeScript actor ends the handover after twelve words.

Tags: Use case, Concept demo, Agent teams, TypeScript actors, Subscriptions.

```json
{
  "id": "ragents.reference.20-circle-of-four",
  "owner": "ragents.reference",
  "title": "Pass a list through four AI helpers",
  "description": "Shows, while building a word game, how four AI helpers contribute one after another and a TypeScript actor ends the handover after twelve words.",
  "order": 20,
  "tags": [
    "Use case",
    "Concept demo",
    "Agent teams",
    "TypeScript actors",
    "Subscriptions"
  ],
  "action": "skill",
  "skill": "20-circle-of-four",
  "category": "Collaboration",
  "prompt": "I would like four AIs named red, yellow, blue, and green that play a word game in rotation: each one appends a word that comes to mind for the last one named. After twelve contributions it is over, and I want to see the finished list as a document."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/20-circle-of-four/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Pass a list through four AI helpers",
  "message": "Use the skill 20-circle-of-four for this task.\n\nI would like four AIs named red, yellow, blue, and green that play a word game in rotation: each one appends a word that comes to mind for the last one named. After twelve contributions it is over, and I want to see the finished list as a document."
}
```

<a id="start-ragents.reference.30-llm-without-runtime-knowledge"></a>

### ragents.reference.30-llm-without-runtime-knowledge: Have a message delivered

Shows a one-way forwarding between two AI helpers that know neither the flow nor the other participant.

Tags: Concept demo, Agent teams, Subscriptions, Stopping actors.

```json
{
  "id": "ragents.reference.30-llm-without-runtime-knowledge",
  "owner": "ragents.reference",
  "title": "Have a message delivered",
  "description": "Shows a one-way forwarding between two AI helpers that know neither the flow nor the other participant.",
  "order": 30,
  "tags": [
    "Concept demo",
    "Agent teams",
    "Subscriptions",
    "Stopping actors"
  ],
  "action": "skill",
  "skill": "30-llm-without-runtime-knowledge",
  "category": "Collaboration",
  "prompt": "I would like two AIs, anna and ben, that greet each other kindly exactly once without knowing about each other or the technology behind it: anna says a warm sentence, ben replies once, then it is over. Afterwards, briefly tell me that it really was passed on in only this one direction and that everything has been cleaned up again."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/30-llm-without-runtime-knowledge/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Have a message delivered",
  "message": "Use the skill 30-llm-without-runtime-knowledge for this task.\n\nI would like two AIs, anna and ben, that greet each other kindly exactly once without knowing about each other or the technology behind it: anna says a warm sentence, ben replies once, then it is over. Afterwards, briefly tell me that it really was passed on in only this one direction and that everything has been cleaned up again."
}
```

<a id="start-ragents.reference.learning-sprint"></a>

### ragents.reference.learning-sprint: Learning goal in stages

Shows how a reusable skill guide adapts a learning unit in the chat to actual answers without creating additional actors or scripts.

Tags: Use case, Concept demo, Skills.

```json
{
  "id": "ragents.reference.learning-sprint",
  "owner": "ragents.reference",
  "title": "Learning goal in stages",
  "description": "Shows how a reusable skill guide adapts a learning unit in the chat to actual answers without creating additional actors or scripts.",
  "order": 30,
  "tags": [
    "Use case",
    "Concept demo",
    "Skills"
  ],
  "action": "skill",
  "skill": "learning-sprint",
  "category": "Collaboration",
  "prompt": "I would like a short learning unit with a fitting exercise and a next learning step."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/learning-sprint/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Learning goal in stages",
  "message": "Use the skill learning-sprint for this task.\n\nI would like a short learning unit with a fitting exercise and a next learning step."
}
```

<a id="start-ragents.reference.110-all-card-slots"></a>

### ragents.reference.110-all-card-slots: See question, tasks, and document together

Shows how task progress, a document, and an open question stay visible on an agent card at the same time.

Tags: Questions, To-dos, Concept demo.

```json
{
  "id": "ragents.reference.110-all-card-slots",
  "owner": "ragents.reference",
  "title": "See question, tasks, and document together",
  "description": "Shows how task progress, a document, and an open question stay visible on an agent card at the same time.",
  "order": 110,
  "tags": [
    "Questions",
    "To-dos",
    "Concept demo"
  ],
  "action": "skill",
  "skill": "110-all-card-slots",
  "category": "Collaboration",
  "prompt": "I would like an AI that notes three tasks for me - one done, one in progress, and one open -, also writes a short document, and finally asks me whether it should tackle the open item next. Do not answer this question for me; stop there so that I can see the task list, document, and question together and answer myself."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/110-all-card-slots/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "See question, tasks, and document together",
  "message": "Use the skill 110-all-card-slots for this task.\n\nI would like an AI that notes three tasks for me - one done, one in progress, and one open -, also writes a short document, and finally asks me whether it should tackle the open item next. Do not answer this question for me; stop there so that I can see the task list, document, and question together and answer myself."
}
```

<a id="start-ragents.reference.210-moderator-handover"></a>

### ragents.reference.210-moderator-handover: Hand a conversation over to a moderator

Shows the handover of a running chat to another primary actor. The moderator takes over as the direct contact and records the task progress.

Tags: Questions, To-dos, Use case, Concept demo, Agent teams, Primary actor.

```json
{
  "id": "ragents.reference.210-moderator-handover",
  "owner": "ragents.reference",
  "title": "Hand a conversation over to a moderator",
  "description": "Shows the handover of a running chat to another primary actor. The moderator takes over as the direct contact and records the task progress.",
  "order": 210,
  "tags": [
    "Questions",
    "To-dos",
    "Use case",
    "Concept demo",
    "Agent teams",
    "Primary actor"
  ],
  "action": "skill",
  "skill": "210-moderator-handover",
  "category": "Collaboration",
  "prompt": "I would like a workshop for a calmer workday: a planner brings two ideas, a skeptical guest examines the downsides. A moderator takes over the round and then talks directly with me in the chat so that I can pick a proposal. Show the three on the surface and actually hand the conversation over to the moderator. Its task list shows the progress."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/210-moderator-handover/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Hand a conversation over to a moderator",
  "message": "Use the skill 210-moderator-handover for this task.\n\nI would like a workshop for a calmer workday: a planner brings two ideas, a skeptical guest examines the downsides. A moderator takes over the round and then talks directly with me in the chat so that I can pick a proposal. Show the three on the surface and actually hand the conversation over to the moderator. Its task list shows the progress."
}
```

### Category: Events and flows

<a id="start-ragents.reference.35-actor-input-fifo"></a>

### ragents.reference.35-actor-input-fifo: Complete three tasks in order

Shows whether tasks queued during a running turn are processed separately and in order of arrival. The journal provides the evidence.

Tags: Journal inspection, Concept demo, Input queue.

```json
{
  "id": "ragents.reference.35-actor-input-fifo",
  "owner": "ragents.reference",
  "title": "Complete three tasks in order",
  "description": "Shows whether tasks queued during a running turn are processed separately and in order of arrival. The journal provides the evidence.",
  "order": 35,
  "tags": [
    "Journal inspection",
    "Concept demo",
    "Input queue"
  ],
  "action": "skill",
  "skill": "35-actor-input-fifo",
  "category": "Events and flows",
  "prompt": "I would like a helper that answers every text I give it with \"DONE: \" and the unchanged text, and thinks extensively beforehand on the word \"one\". While it is still working on \"one\", I send it \"two\" and \"three\" right after. Afterwards, show me with evidence that it handled all three cleanly separated and in exactly this order and that nothing got mixed up."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/35-actor-input-fifo/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Complete three tasks in order",
  "message": "Use the skill 35-actor-input-fifo for this task.\n\nI would like a helper that answers every text I give it with \"DONE: \" and the unchanged text, and thinks extensively beforehand on the word \"one\". While it is still working on \"one\", I send it \"two\" and \"three\" right after. Afterwards, show me with evidence that it handled all three cleanly separated and in exactly this order and that nothing got mixed up."
}
```

<a id="start-ragents.reference.40-subscription-matrix"></a>

### ragents.reference.40-subscription-matrix: Listen in on other helpers selectively

Shows how subscriptions filter by sender and event type. A receipt table with evidence makes matching and excluded events visible.

Tags: Journal inspection, Concept demo, Subscriptions.

```json
{
  "id": "ragents.reference.40-subscription-matrix",
  "owner": "ragents.reference",
  "title": "Listen in on other helpers selectively",
  "description": "Shows how subscriptions filter by sender and event type. A receipt table with evidence makes matching and excluded events visible.",
  "order": 40,
  "tags": [
    "Journal inspection",
    "Concept demo",
    "Subscriptions"
  ],
  "action": "skill",
  "skill": "40-subscription-matrix",
  "category": "Events and flows",
  "prompt": "I would like three AIs a, b, and c plus two listeners: one should only hear what a and b say, the other only when one of the three has actually executed something. Then have all three say something and at least one actually do something. At the end, give me a table of what arrived at which listener and what did not, and back it up with evidence."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/40-subscription-matrix/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Listen in on other helpers selectively",
  "message": "Use the skill 40-subscription-matrix for this task.\n\nI would like three AIs a, b, and c plus two listeners: one should only hear what a and b say, the other only when one of the three has actually executed something. Then have all three say something and at least one actually do something. At the end, give me a table of what arrived at which listener and what did not, and back it up with evidence."
}
```

<a id="start-ragents.reference.50-subscription-removal"></a>

### ragents.reference.50-subscription-removal: Turn a forwarding off again

Shows the effect of a removed subscription: The first message arrives, after turning it off the forwarding ends.

Tags: Concept demo, Subscriptions.

```json
{
  "id": "ragents.reference.50-subscription-removal",
  "owner": "ragents.reference",
  "title": "Turn a forwarding off again",
  "description": "Shows the effect of a removed subscription: The first message arrives, after turning it off the forwarding ends.",
  "order": 50,
  "tags": [
    "Concept demo",
    "Subscriptions"
  ],
  "action": "skill",
  "skill": "50-subscription-removal",
  "category": "Events and flows",
  "prompt": "I would like three AIs: a source, a sink, and one in between that passes every word of the source on to the sink verbatim. Have the source say \"one\" first, then take away the listening from the middle one and have the source say \"two\". Explain to me with evidence what happens the second time and whether anything still arrives at the sink."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/50-subscription-removal/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Turn a forwarding off again",
  "message": "Use the skill 50-subscription-removal for this task.\n\nI would like three AIs: a source, a sink, and one in between that passes every word of the source on to the sink verbatim. Have the source say \"one\" first, then take away the listening from the middle one and have the source say \"two\". Explain to me with evidence what happens the second time and whether anything still arrives at the sink."
}
```

<a id="start-ragents.reference.60-stop-in-the-circle"></a>

### ragents.reference.60-stop-in-the-circle: Stop a helper in the conversation circle

Shows how stopping an actor interrupts a handover chain and what subsequent actors still receive.

Tags: Journal inspection, Concept demo, Stopping actors.

```json
{
  "id": "ragents.reference.60-stop-in-the-circle",
  "owner": "ragents.reference",
  "title": "Stop a helper in the conversation circle",
  "description": "Shows how stopping an actor interrupts a handover chain and what subsequent actors still receive.",
  "order": 60,
  "tags": [
    "Journal inspection",
    "Concept demo",
    "Stopping actors"
  ],
  "action": "skill",
  "skill": "60-stop-in-the-circle",
  "category": "Events and flows",
  "prompt": "I would like four AIs red, yellow, blue, and green that pass a list around in a circle, each appending a line of its own. As soon as the list has gone all the way around once, switch blue off. Tell me with evidence why the next round fails and whether green still gets anything at all afterwards."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/60-stop-in-the-circle/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Stop a helper in the conversation circle",
  "message": "Use the skill 60-stop-in-the-circle for this task.\n\nI would like four AIs red, yellow, blue, and green that pass a list around in a circle, each appending a line of its own. As soon as the list has gone all the way around once, switch blue off. Tell me with evidence why the next round fails and whether green still gets anything at all afterwards."
}
```

### Category: Files and results

<a id="start-ragents.reference.65-artifact-least-privilege"></a>

### ragents.reference.65-artifact-least-privilege: Pass on a note selectively

Shows how explicitly passing on a note controls read access and how a rejected access leaves the sharing unchanged.

Tags: Concept demo, Artifacts and access.

```json
{
  "id": "ragents.reference.65-artifact-least-privilege",
  "owner": "ragents.reference",
  "title": "Pass on a note selectively",
  "description": "Shows how explicitly passing on a note controls read access and how a rejected access leaves the sharing unchanged.",
  "order": 65,
  "tags": [
    "Concept demo",
    "Artifacts and access"
  ],
  "action": "skill",
  "skill": "65-artifact-least-privilege",
  "category": "Files and results",
  "prompt": "I would like three AIs: the first writes a short secret note and explicitly passes it on to the second, the third only learns that the note exists. Check for me who can really read it and who cannot, and whether the rejected attempt changes anything. Do not write the content of the note out for me again."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/65-artifact-least-privilege/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Pass on a note selectively",
  "message": "Use the skill 65-artifact-least-privilege for this task.\n\nI would like three AIs: the first writes a short secret note and explicitly passes it on to the second, the third only learns that the note exists. Check for me who can really read it and who cannot, and whether the rejected attempt changes anything. Do not write the content of the note out for me again."
}
```

### Category: TypeScript without UI

<a id="start-ragents.reference.70-headless-counter"></a>

### ragents.reference.70-headless-counter: Count messages without AI

Shows a persistent TypeScript actor without an interface: It processes messages separately and keeps its list and counter between tasks.

Tags: Use case, Concept demo, TypeScript actors, Actor functions, Actor state, Journal inspection.

```json
{
  "id": "ragents.reference.70-headless-counter",
  "owner": "ragents.reference",
  "title": "Count messages without AI",
  "description": "Shows a persistent TypeScript actor without an interface: It processes messages separately and keeps its list and counter between tasks.",
  "order": 70,
  "tags": [
    "Use case",
    "Concept demo",
    "TypeScript actors",
    "Actor functions",
    "Actor state",
    "Journal inspection"
  ],
  "action": "skill",
  "skill": "70-headless-counter",
  "category": "TypeScript without UI",
  "prompt": "I would like a small TypeScript counter without an interface and without AI calls. Send it the texts \"one\", \"two\", and \"three\" one after another. It should keep each text in its own list and count along. Then read out its state and prove that three separate inputs were processed. The counter should stay ready for further texts."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/70-headless-counter/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Count messages without AI",
  "message": "Use the skill 70-headless-counter for this task.\n\nI would like a small TypeScript counter without an interface and without AI calls. Send it the texts \"one\", \"two\", and \"three\" one after another. It should keep each text in its own list and count along. Then read out its state and prove that three separate inputs were processed. The counter should stay ready for further texts."
}
```

### Category: Code and diagnostics

<a id="start-ragents.reference.75-lsp-demo"></a>

### ragents.reference.75-lsp-demo: Find errors in C# and TypeScript

Shows real language diagnostics in C# and TypeScript and how the reported errors disappear after they are corrected.

Tags: Concept demo, Language diagnostics.

```json
{
  "id": "ragents.reference.75-lsp-demo",
  "owner": "ragents.reference",
  "title": "Find errors in C# and TypeScript",
  "description": "Shows real language diagnostics in C# and TypeScript and how the reported errors disappear after they are corrected.",
  "order": 75,
  "tags": [
    "Concept demo",
    "Language diagnostics"
  ],
  "action": "skill",
  "skill": "75-lsp-demo",
  "category": "Code and diagnostics",
  "prompt": "I would like a small demonstration of the built-in language check: Create two tiny throwaway projects, one in C# and one in TypeScript, and put a deliberate error into each. Show me how the language check finds the errors and what exactly it reports. Then fix both errors, show that nothing is flagged anymore, and clean up the projects again."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/75-lsp-demo/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Find errors in C# and TypeScript",
  "message": "Use the skill 75-lsp-demo for this task.\n\nI would like a small demonstration of the built-in language check: Create two tiny throwaway projects, one in C# and one in TypeScript, and put a deliberate error into each. Show me how the language check finds the errors and what exactly it reports. Then fix both errors, show that nothing is flagged anymore, and clean up the projects again."
}
```

<a id="start-ragents.reference.200-typescript-diagnostics"></a>

### ragents.reference.200-typescript-diagnostics: Find errors in an appointment list

Shows on a TypeScript appointment list how real language diagnostics change after each individual correction. The corrected example is kept for reference.

Tags: Use case, Concept demo, Language diagnostics.

```json
{
  "id": "ragents.reference.200-typescript-diagnostics",
  "owner": "ragents.reference",
  "title": "Find errors in an appointment list",
  "description": "Shows on a TypeScript appointment list how real language diagnostics change after each individual correction. The corrected example is kept for reference.",
  "order": 200,
  "tags": [
    "Use case",
    "Concept demo",
    "Language diagnostics"
  ],
  "action": "skill",
  "skill": "200-typescript-diagnostics",
  "category": "Code and diagnostics",
  "prompt": "I would like a small TypeScript appointment list with two deliberate type errors. Let the language check find both and correct them one at a time. After each correction I want to see the real finding. At the end, the corrected example and a short comparison remain for reference. If the language check is missing, say so clearly."
}
```

[Working instructions of the skill](../../plugins/ragents.reference/skills/200-typescript-diagnostics/SKILL.md)

Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.

```json
{
  "title": "Find errors in an appointment list",
  "message": "Use the skill 200-typescript-diagnostics for this task.\n\nI would like a small TypeScript appointment list with two deliberate type errors. Let the language check find both and correct them one at a time. After each correction I want to see the real finding. At the end, the corrected example and a short comparison remain for reference. If the language check is missing, say so clearly."
}
```

### Category: Prepared workflows

<a id="start-ragents.reference.shared-actor-list"></a>

### ragents.reference.shared-actor-list: Set up collection board

A prepared setup shows an LLM list helper with its own function, mini-app, and shared state. A start guide sets the title and the first entry.

Tags: Run scripts, Use case, Concept demo, Start guide, Actor functions, Actor state, Mini-apps, LLM actor with view.

```json
{
  "id": "ragents.reference.shared-actor-list",
  "owner": "ragents.reference",
  "title": "Set up collection board",
  "description": "A prepared setup shows an LLM list helper with its own function, mini-app, and shared state. A start guide sets the title and the first entry.",
  "order": 100,
  "guide": "ragents.reference.shared-actor-list",
  "tags": [
    "Run scripts",
    "Use case",
    "Concept demo",
    "Start guide",
    "Actor functions",
    "Actor state",
    "Mini-apps",
    "LLM actor with view"
  ],
  "action": "script",
  "coordinator": true
}
```

Complete package sources are in [run-setup.md](run-setup.md).

<a id="start-ragents.reference.conversation-circle"></a>

### ragents.reference.conversation-circle: Set up conversation circle

A prepared setup shows parameterization through a start guide and the participants of a conversation circle. The coordinator then leads the rounds.

Tags: Run scripts, Use case, Concept demo, Start guide, Agent teams.

```json
{
  "id": "ragents.reference.conversation-circle",
  "owner": "ragents.reference",
  "title": "Set up conversation circle",
  "description": "A prepared setup shows parameterization through a start guide and the participants of a conversation circle. The coordinator then leads the rounds.",
  "order": 120,
  "guide": "ragents.reference.conversation-circle",
  "tags": [
    "Run scripts",
    "Use case",
    "Concept demo",
    "Start guide",
    "Agent teams"
  ],
  "action": "script",
  "coordinator": true
}
```

Complete package sources are in [run-setup.md](run-setup.md).

<a id="start-ragents.reference.moderated-round"></a>

### ragents.reference.moderated-round: Moderated round without coordinator

A prepared setup shows a run that works without a coordinator from the start. The moderator becomes the primary actor and your direct contact in the chat.

Tags: Run scripts, Use case, Concept demo, Primary actor, Agent teams.

```json
{
  "id": "ragents.reference.moderated-round",
  "owner": "ragents.reference",
  "title": "Moderated round without coordinator",
  "description": "A prepared setup shows a run that works without a coordinator from the start. The moderator becomes the primary actor and your direct contact in the chat.",
  "order": 130,
  "tags": [
    "Run scripts",
    "Use case",
    "Concept demo",
    "Primary actor",
    "Agent teams"
  ],
  "action": "script",
  "coordinator": false
}
```

Complete package sources are in [run-setup.md](run-setup.md).

<a id="start-ragents.reference.balcony-wizard"></a>

### ragents.reference.balcony-wizard: Set up balcony wizard

A prepared AI interview shows adaptive questions in a mini-app of its own. The advisor is the primary actor from the start; the form counts five answers.

Tags: Run scripts, Use case, Concept demo, Mini-apps, LLM actor with view, Controlled chat, Primary actor.

```json
{
  "id": "ragents.reference.balcony-wizard",
  "owner": "ragents.reference",
  "title": "Set up balcony wizard",
  "description": "A prepared AI interview shows adaptive questions in a mini-app of its own. The advisor is the primary actor from the start; the form counts five answers.",
  "order": 140,
  "tags": [
    "Run scripts",
    "Use case",
    "Concept demo",
    "Mini-apps",
    "LLM actor with view",
    "Controlled chat",
    "Primary actor"
  ],
  "action": "script",
  "coordinator": false
}
```

Complete package sources are in [run-setup.md](run-setup.md).

<a id="start-ragents.reference.learning-afternoon"></a>

### ragents.reference.learning-afternoon: Learning afternoon

A prepared parallel round shows two independently working AI helpers and a TypeScript collector. The mini-app takes over one answer from each exactly once.

Tags: Run scripts, Use case, Concept demo, Mini-apps, TypeScript actors, Agent teams, Subscriptions, Primary actor.

```json
{
  "id": "ragents.reference.learning-afternoon",
  "owner": "ragents.reference",
  "title": "Learning afternoon",
  "description": "A prepared parallel round shows two independently working AI helpers and a TypeScript collector. The mini-app takes over one answer from each exactly once.",
  "order": 150,
  "tags": [
    "Run scripts",
    "Use case",
    "Concept demo",
    "Mini-apps",
    "TypeScript actors",
    "Agent teams",
    "Subscriptions",
    "Primary actor"
  ],
  "action": "script",
  "coordinator": false
}
```

Complete package sources are in [run-setup.md](run-setup.md).

<a id="start-ragents.reference.word-game"></a>

### ragents.reference.word-game: Start word game

A prepared word game shows how a TypeScript actor determines order and end while four LLMs supply the words. The mini-app makes the progress visible.

Tags: Run scripts, Use case, Concept demo, Mini-apps, TypeScript actors, Agent teams, Subscriptions.

```json
{
  "id": "ragents.reference.word-game",
  "owner": "ragents.reference",
  "title": "Start word game",
  "description": "A prepared word game shows how a TypeScript actor determines order and end while four LLMs supply the words. The mini-app makes the progress visible.",
  "order": 150,
  "tags": [
    "Run scripts",
    "Use case",
    "Concept demo",
    "Mini-apps",
    "TypeScript actors",
    "Agent teams",
    "Subscriptions"
  ],
  "action": "script",
  "coordinator": false
}
```

Complete package sources are in [run-setup.md](run-setup.md).

<a id="start-ragents.reference.run-roster"></a>

### ragents.reference.run-roster: Take stock of the run

A prepared check shows a run script that also joins a running run. It lists the other participants, notes them in the shared notebook, and reports them back as its result.

Tags: Run scripts, Concept demo, TypeScript actors.

```json
{
  "id": "ragents.reference.run-roster",
  "owner": "ragents.reference",
  "title": "Take stock of the run",
  "description": "A prepared check shows a run script that also joins a running run. It lists the other participants, notes them in the shared notebook, and reports them back as its result.",
  "order": 170,
  "tags": [
    "Run scripts",
    "Concept demo",
    "TypeScript actors"
  ],
  "action": "script",
  "coordinator": false
}
```

Complete package sources are in [run-setup.md](run-setup.md).

<a id="start-ragents.reference.quick-note"></a>

### ragents.reference.quick-note: Add a quick note

A prepared one-step script shows a shared actor package: it adds a note to the notebook it shares with the roster check, in a new or a running run.

Tags: Run scripts, Concept demo, TypeScript actors.

```json
{
  "id": "ragents.reference.quick-note",
  "owner": "ragents.reference",
  "title": "Add a quick note",
  "description": "A prepared one-step script shows a shared actor package: it adds a note to the notebook it shares with the roster check, in a new or a running run.",
  "order": 180,
  "tags": [
    "Run scripts",
    "Concept demo",
    "TypeScript actors"
  ],
  "action": "script",
  "coordinator": false
}
```

Complete package sources are in [run-setup.md](run-setup.md).

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
      "ragents.orchestration",
      "ragents.workspace"
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
    "requires": [
      "ragents.ask"
    ]
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

## Dynamic tool contributions

```json
[
  "ragents.actor-programs.functions"
]
```
