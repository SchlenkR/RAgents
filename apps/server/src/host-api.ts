/** The number of the host API a plugin is built against; it changes with every incompatible change of a list, a listed name or a library. */
export const HOST_API_VERSION = 5;

/** A library the host shares whole, as its installed version exports it; host code instead names each value it offers. */
export const LIBRARY = "library";

type HostApiModules = Readonly<Record<string, readonly string[] | typeof LIBRARY>>;

/** The modules the host provides to plugins, per half, with the values a plugin may import; nothing else of the host may be imported by a plugin. */
export const hostApi: { readonly server: HostApiModules; readonly web: HostApiModules } = {
  server: {
    "@ragents/engine": [
      "DomainError", "RPC_ERROR_CODES", "RpcError", "ScriptDriver", "ToolRegistry", "actorByHandle",
      "actorByReference", "actorDescriptionMaxLength", "actorInputSchema", "agentTools", "assertJsonValue", "builtinProfiles", "canonicalHash",
      "compileVirtualTypeScriptAsync", "defineRunFunction", "defineToolAvailability", "emptyUsage",
      "enqueueActorInput", "eventResultSchema", "handleKey", "holdsUsable", "implement", "implementChannel",
      "isRunId", "isThinkingLevel", "modelToolDescriptors", "pluginStateAt", "runCapabilityBindingHash",
      "runCapabilityContractHash", "schemaComplaints", "scriptInputOf", "serviceToken",
    ],
    "@ragents/engine/src/domain/events": ["eventTypeMap"],
    "@ragents/engine/src/http/contracts": ["handleKey", "openJson"],
    "@ragents/engine/src/rpc/contract": ["defineChannel", "defineOperation"],
    "@ragents/host/access-service": ["profileAccessCookieName"],
    "@ragents/host/api/reference": ["methodReference", "openRpcDocument"],
    "@ragents/host/chat-context": [],
    "@ragents/host/chat-handler": [],
    "@ragents/host/config": ["hostConfigKeys"],
    "@ragents/host/config-definition": ["isEnvironmentReference", "isProvisionedReference"],
    "@ragents/host/config-file": [
      "SECRET_KEY_PATTERN", "configFilePath", "configuredUsers", "resolveAnonymousUser", "resolveProfileUsers",
    ],
    "@ragents/host/host-version": ["readHostApiVersion", "readHostVersion", "readPackageVersion"],
    "@ragents/host/plugin-support/actor-programs/app-project": [
      "compileAppBackend", "installServerSdk", "prepareAppProject", "prepareAppWorkspace", "projectSourceFiles",
      "readAppPackage", "typecheckServerProject",
    ],
    "@ragents/host/plugin-support/actor-programs/client-compiler": ["compileClientProject", "installClientSdk"],
    "@ragents/host/plugin-support/actor-programs/client-contracts": [
      "readClientUiComponentContracts", "readClientUiComponentNames",
    ],
    "@ragents/host/plugin-support/actor-programs/client-runtime": [
      "FRAME_BODY_CLASS", "FRAME_DOCUMENT_CLASS", "FRAME_ROOT_CLASS", "browserRuntimeStyles",
    ],
    "@ragents/host/plugin-support/actor-programs/contract": [
      "ACTOR_INVOCATIONS_STATE_ID", "ACTOR_PROGRAMS_STATE_ID", "ACTOR_SCRIPT_STATE_ID", "ACTOR_STATE_ID",
      "actorProgramContracts", "resolveActorView",
    ],
    "@ragents/host/plugin-support/actor-programs/service": ["actorProgramsToken"],
    "@ragents/host/plugin-support/actor-programs/tailwind": ["buildTailwind"],
    "@ragents/host/plugin-support/actor-programs/workflow/prompt-reader": ["createPromptReader"],
    "@ragents/host/plugin-support/agent-tool": ["toolDescriptorFrom"],
    "@ragents/host/plugin-support/await-with-signal": ["awaitWithSignal"],
    "@ragents/host/plugin-support/chat-display-policy": [
      "chatDisplayEnvDescriptors", "chatDisplayPolicyFromEnvironment",
    ],
    "@ragents/host/plugin-support/front-matter": ["frontMatterOf"],
    "@ragents/host/plugin-support/http": [
      "PayloadTooLargeError", "guardedJsonRoute", "readBody", "readJsonBody", "withAbort", "writeJson",
    ],
    "@ragents/host/plugin-support/language-server/plugin": ["createLanguageServerPlugin"],
    "@ragents/host/plugin-support/model-choice": [
      "builtinCatalog", "modelChoiceEnvDescriptors", "modelChoiceFromEnvironment", "modelThinkingOptions",
    ],
    "@ragents/host/plugin-support/model-completion": ["openRouterCompletionModel"],
    "@ragents/host/plugin-support/model-upstreams": ["modelUpstreamsToken"],
    "@ragents/host/plugin-support/plugin-config": ["declaredEnvironment"],
    "@ragents/host/plugin-support/plugin-folder": ["folderSystemPrompts", "pluginAsset", "pluginFolder"],
    "@ragents/host/plugin-support/plugin-module": [],
    "@ragents/host/plugin-support/plugins-root": ["bundlesRoot", "isPluginPath"],
    "@ragents/host/plugin-support/process-sandbox": ["PROCESS_SANDBOX_DEFAULT_NETWORK", "ServerProcessSandbox"],
    "@ragents/host/plugin-support/product-model-settings": ["ProductModelSettingsStore", "productModelSettingsMethods"],
    "@ragents/host/plugin-support/product-relay": ["RELAY_PROVIDER", "createRelayCatalog"],
    "@ragents/host/plugin-support/product-start-options": ["productStartOptions"],
    "@ragents/host/plugin-support/prompt": ["boundToTools", "handlebarsPrompt", "systemPromptSelectionPrompt"],
    "@ragents/host/plugin-support/provision": [
      "DOTNET_INSTRUCTION", "dotnetRuntimeMajors", "downloadArchive", "hostPackageFolder", "provisionGap",
      "provisionReady", "readProvisionStamp", "readZipNames", "unpackArchive", "writeProvisionStamp",
    ],
    "@ragents/host/plugin-support/skills": ["skillEnvDescriptors", "skillsFromEnvironment"],
    "@ragents/host/plugin-support/system-prompts": ["lazySystemPromptCatalog", "systemPromptEnvDescriptors"],
    "@ragents/host/plugin-support/thinking-level": ["checkedThinkingLevel"],
    "@ragents/host/plugin-support/tool-availability": ["alwaysAvailable", "facesOperator"],
    "@ragents/host/plugin-support/workspace-ownership": ["syncWorkspaceOwnership"],
    "@ragents/host/plugin-support/workspace-sandbox-host": [
      "WorkspaceSandboxHost", "sandboxServicesToken", "withDomainCause",
    ],
    "@ragents/host/profile/plugin-discovery": ["discoverPluginIds", "resolvePluginEntries"],
    "@ragents/host/protocol": ["Protocol"],
    "@ragents/host/ragents/document-store": ["documentStoreToken"],
    "@ragents/host/ragents/global-chat": ["globalChatToken", "runManagementToken"],
    "@ragents/host/ragents/host-services": [
      "hostAddressToken", "runtimeProviderToken", "secretEnvNamesToken", "runGuardToken", "runWorkspaceProviderToken", "workspaceGuardToken",
    ],
    "@ragents/host/ragents/product-runtime": ["productRuntimeToken"],
    "@ragents/host/ragents/runtime-bridge": ["runtimeBridgeToken"],
    "@ragents/host/ragents/start-option-state": ["startOptionScope", "storedStartOption"],
    "@ragents/host/ragents/workspace-runtime": [
      "gitWorkspaceViewToken", "workspaceResolverToken", "workspaceRuntimeToken",
    ],
    "@ragents/workflow": ["defineWorkflow", "workflowInstructions"],
    "@ragents/workspace-executor": [
      "BROWSER_EXECUTABLE_VARIABLE", "BROWSER_OPERATIONS", "COMMAND_OPERATIONS", "FILE_OPERATIONS",
      "FSHARP_SERVER_FILE", "FSHARP_SERVER_VARIABLE", "PROCESS_OPERATIONS", "ROSLYN_SERVER_FILE",
      "ROSLYN_SERVER_VARIABLE", "RUN_FOLDER_OPERATIONS", "RUN_MARKER_ENV", "WORKSPACE_EXECUTOR_VERSION", "fsharpAdapter", "listDirectory",
      "readTextFile", "roslynAdapter", "runManagedProcess", "safeProcessEnvironment", "sandboxRunEnvironment", "sandboxedLaunch",
      "shellPlatformText", "startManagedService", "typescriptAdapter", "watchDirectory",
    ],
    "@ragents/workspace-executor/src/git-config-environment": ["withGitConfigPairs"],
    "@ragents/workspace-executor/src/managed-process": ["ProcessGroupJoinError"],
    "@ragents/workspace-executor/src/session-ident": ["stopUidProcesses"],
    "handlebars": LIBRARY,
    "playwright-core": LIBRARY,
    "tar": LIBRARY,
    "typebox": LIBRARY,
    "typebox/value": LIBRARY,
  },
  web: {
    "@ragents/engine/src/domain/events": ["eventTypeMap"],
    "@ragents/engine/src/domain/json": [],
    "@ragents/engine/src/http/contracts": ["actorByHandle", "handleKey", "openJson", "runContracts"],
    "@ragents/engine/src/rpc/contract": ["defineChannel", "defineOperation"],
    "@ragents/host/chat-attachments": ["parseChatAttachments"],
    "@ragents/host/chat-events": [],
    "@ragents/host/plugin-support/actor-programs/contract": [
      "ACTOR_INVOCATIONS_STATE_ID", "ACTOR_PROGRAMS_STATE_ID", "ACTOR_STATE_ID", "actorProgramContracts",
    ],
    "@ragents/web/AccessContext": ["useAccess"],
    "@ragents/web/DiffCode": ["DiffCode"],
    "@ragents/web/PluginRegistry": [
      "SurfaceControllerProvider", "ChatStepsProvider", "chatDisplayPolicyFrom", "pluginRoutePrefixFrom",
      "useActionRenderer", "useSurfaceController", "useChatSteps", "useToolRenderer", "workspaceAccessible",
    ],
    "@ragents/web/SourceCode": ["SourceCode"],
    "@ragents/web/StatusGroup": ["StatusGroup"],
    "@ragents/web/Toolbar": ["ToolbarCopy", "ToolbarItem", "ToolbarLabel", "ToolbarText"],
    "@ragents/web/access-token": ["withAccessToken"],
    "@ragents/web/actor-conversation": ["actorChatMessages", "actorInputLabel"],
    "@ragents/web/actor-programs/client-ui/contracts": [],
    "@ragents/web/api": ["interruptActorTurn", "sendActorMessage"],
    "@ragents/web/chat-view-settings": ["ChatViewSwitches", "useChatViewSettings"],
    "@ragents/web/chat/ChatInputToolbar": ["ChatInputToolbar"],
    "@ragents/web/chat/ChatMessages": ["ChatMessages"],
    "@ragents/web/chat/ChatPanel": ["ChatPanel"],
    "@ragents/web/chat/DetailModeSwitch": ["DetailModeSwitch"],
    "@ragents/web/chat/Markdown": ["Markdown"],
    "@ragents/web/chat/StoppedActorNotice": ["StoppedActorNotice"],
    "@ragents/web/chat/chat-target": ["programChatNotice", "runIsWorking"],
    "@ragents/web/chat/types": [],
    "@ragents/web/chat/useAttachmentCapabilities": ["getAttachmentCapabilities", "useAttachmentCapabilities"],
    "@ragents/web/chat/useChat": ["useChat"],
    "@ragents/web/language-server/language-server-plugin": ["languageServerWebPlugin"],
    "@ragents/web/lib/format": ["formatBytes"],
    "@ragents/web/lib/guards": ["hasExactKeys", "isRecord"],
    "@ragents/web/lib/http": ["errorFrom"],
    "@ragents/web/lib/labels": ["thinkingLabel"],
    "@ragents/web/lib/local-storage-setting": ["createLocalStorageSetting"],
    "@ragents/web/page-opener": ["useOptionalPageOpener"],
    "@ragents/web/product/ProductModelSettings": ["ProductModelSettings"],
    "@ragents/web/product/start-options": ["productStartOptions"],
    "@ragents/web/rpc": ["rpc"],
    "@ragents/web/run-panel/host": ["useCenterElements", "useRunPanelHost"],
    "@ragents/web/run-view": [
      "actorPluginState", "actorTone", "chatPrimaryId", "isPendingRunActorInput", "runActorFrom",
      "runArtifactContentUrl", "runViewFrom",
    ],
    "@ragents/web/theme": ["useResolvedTheme"],
    "@ragents/web/toolLine": ["withToolSummaries"],
    "@ragents/web/ui": [
      "Alert", "AlertDescription", "AlertTitle", "Badge", "Button", "Card", "Dialog", "DialogBody", "DialogContent",
      "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle", "Empty", "EmptyContent", "EmptyDescription",
      "EmptyHeader", "EmptyMedia", "EmptyTitle", "Field", "FieldDescription", "FieldTitle", "Input", "Label",
      "Popover", "PopoverContent", "SectionLabel", "Select", "SelectContent", "SelectItem", "SelectTrigger",
      "SelectValue", "Spinner", "StartupNotice", "StopButton", "StopGlyph", "Switch", "Tabs", "TabsContent",
      "TabsList", "TabsTrigger", "Textarea", "Toggle", "ToggleGroup", "ToggleGroupItem", "buttonVariants", "cn",
    ],
    "@ragents/web/ui/dialog": ["RunModalContext"],
    "react": LIBRARY,
    "react-dom": LIBRARY,
    "react/jsx-runtime": LIBRARY,
    "typebox": LIBRARY,
  },
};

/** The global under which the host web keeps its register of the web modules; plugin bundles read them from there. */
export const HOST_MODULES_GLOBAL = "__ragentsHostModules";

export type HostApiHalf = keyof typeof hostApi;

export const hostApiModules = (half: HostApiHalf): readonly string[] => Object.keys(hostApi[half]);

/** Host code and libraries whose module state, context or class identity the host shares; a plugin never carries its own copy. */
export const hostOnly = (specifier: string): boolean => /^(react|react-dom)(\/|$)|^@ragents\/(?!plugins\/)/.test(specifier);

export const providedByHost = (half: HostApiHalf, specifier: string): boolean =>
  Object.hasOwn(hostApi[half], specifier.replace(/\.(js|ts|tsx)$/, ""));
