/** The number of the host API a plugin is built against; it changes with every incompatible change of a list, a listed name or a library. */
export const HOST_API_VERSION = 12;

/** A library the host shares whole, as its installed version exports it; host code instead names each value it offers. */
export const LIBRARY = "library";

type HostApiModules = Readonly<Record<string, readonly string[] | typeof LIBRARY>>;

/** The modules the host provides to plugins, per half, with the values a plugin may import; nothing else of the host may be imported by a plugin. */
export const hostApi: { readonly server: HostApiModules; readonly web: HostApiModules } = {
  server: {
    "@ragents/engine": [
      "DomainError", "RPC_ERROR_CODES", "RpcError", "ScriptDriver", "ToolRegistry", "actorByHandle",
      "actorByReference", "actorDescriptionMaxLength", "actorInputSchema", "addressFrom", "addressOf", "agentTools", "assertJsonValue", "builtinProfiles", "canonicalHash",
      "compileVirtualTypeScriptAsync", "defineRunFunction", "defineToolAvailability", "emptyUsage",
      "enqueueActorInput", "eventResultSchemaOf", "freeRoomName", "handleKey", "holdsUsable", "implement", "implementChannel", "inheritedGrants",
      "isRunId", "isThinkingLevel", "hasWorkstationOwner", "modelToolDescriptors", "pluginStateAt", "runCapabilityBindingHash",
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
      "compileAppBackend", "installServerSdk", "packageIdentity", "prepareAppProject", "prepareAppWorkspace", "projectSourceFiles",
      "readAppPackage", "typecheckServerProject",
    ],
    "@ragents/host/plugin-support/actor-programs/client-compiler": ["compileClientProject", "installClientSdk"],
    "@ragents/host/plugin-support/actor-programs/client-contracts": [
      "readClientUiComponentContracts", "readClientUiComponentNames",
    ],
    "@ragents/host/plugin-support/actor-programs/client-runtime": [
      "FRAME_BODY_CLASS", "FRAME_DOCUMENT_CLASS", "FRAME_ROOT_CLASS", "browserInputRuntime", "browserRuntimeStyles",
    ],
    "@ragents/host/plugin-support/actor-programs/contract": [
      "ACTOR_INVOCATIONS_STATE_ID", "ACTOR_PROGRAMS_STATE_ID", "ACTOR_SCRIPT_STATE_ID", "ACTOR_STATE_ID",
      "ACTOR_VIEW_ID_MAX_LENGTH", "actorProgramContracts", "relativeName", "resolveActorView",
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
    "@ragents/host/plugin-support/model-aliases": ["configuredModelAliases", "modelLabel", "validatedAliasModel"],
    "@ragents/host/plugin-support/model-choice": [
      "builtinCatalog", "modelChoiceEnvDescriptors", "modelChoiceFromEnvironment", "modelThinkingOptions",
    ],
    "@ragents/host/plugin-support/model-completion": ["aliasCompletionModelToken", "openRouterCompletionModel"],
    "@ragents/host/plugin-support/model-providers": ["configuredModelProviders"],
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
    "@ragents/host/plugin-support/thinking-level": ["checkedThinkingLevel", "roleThinkingLevel"],
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
      "executorContributionsToken", "hostAddressToken", "runtimeProviderToken", "runOwnerAccessToken", "userAccessToken", "secretEnvNamesToken", "runGuardToken", "runWorkspaceProviderToken",
      "workspaceGuardToken",
    ],
    "@ragents/host/ragents/product-runtime": ["productRuntimeToken"],
    "@ragents/host/ragents/runtime-bridge": ["runtimeBridgeToken"],
    "@ragents/host/ragents/start-option-state": ["startOptionScope", "storedStartOption"],
    "@ragents/host/ragents/workspace-runtime": [
      "gitWorkspaceViewToken", "workspaceResolverToken", "workspaceRuntimeToken",
    ],
    "@ragents/workflow": ["defineWorkflow", "workflowInstructions"],
    "@ragents/workspace-executor": [
      "BYTE_OPERATIONS", "COMMAND_OPERATIONS", "FILE_BYTES_LIMIT", "FILE_COUNT_LIMIT", "FILE_OPERATIONS", "PROCESS_OPERATIONS", "RUN_FOLDER_OPERATIONS", "RUN_MARKER_ENV", "TUNNEL_PING_INTERVAL_MS", "WORKSPACE_EXECUTOR_VERSION",
      "allowedWorkspacePath", "bytesOf", "languageServerOpenOperation", "languageServerSolutionsOperation", "listDirectory", "readTextFile", "ripgrepAvailable", "runManagedProcess", "safeProcessEnvironment", "sandboxRunEnvironment", "sandboxedLaunch",
      "shellPlatformText", "startManagedService", "tunnelCloseReason", "watchDirectory",
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
    "@ragents/engine/src/http/contracts": ["actorByHandle", "addressOf", "handleKey", "isActorAddress", "openJson", "runContracts"],
    "@ragents/engine/src/rpc/contract": ["defineChannel", "defineOperation"],
    "@ragents/host/plugin-support/actor-programs/contract": [
      "ACTOR_INVOCATIONS_STATE_ID", "ACTOR_PROGRAMS_STATE_ID", "ACTOR_STATE_ID", "ACTOR_VIEW_ID_MAX_LENGTH", "actorProgramContracts",
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
    "@ragents/web/access-token": ["accessTokenInstalled", "withAccessToken"],
    "@ragents/web/actor-conversation": ["actorChatMessages", "actorInputLabel"],
    "@ragents/web/actor-programs/client-ui/contracts": [],
    "@ragents/web/api": ["interruptActorTurn", "pauseRun", "sendActorMessage"],
    "@ragents/web/chat-view-settings": ["ChatViewSwitches", "useChatViewSettings"],
    "@ragents/web/chat/PausedRunNotice": ["PausedRunNotice"],
    "@ragents/web/chat/StoppedActorNotice": ["StoppedActorNotice"],
    "@ragents/web/chat/chat-target": ["programChatNotice", "runIsWorking", "runPausable"],
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
    "@ragents/web/run-panel/input-bridge": ["hostInputEnabled", "isRunPanelKeyboardMessage", "relayFrameInput"],
    "@ragents/web/run-apps": ["runApps", "selectedRunApp", "RunAppView"],
    "@ragents/web/run-panel/DockWorkspace": ["DockWindowActions", "DockWorkspace", "useDockActiveApp"],
    "@ragents/web/run-panel/host": ["useRunPanelHost"],
    "@ragents/web/run-view": [
      "actorAddress", "actorPluginState", "actorTone", "chatPrimaryId", "isPendingRunActorInput", "runActorFrom",
      "runArtifactContentUrl", "runViewFrom",
    ],
    "@ragents/web/theme": ["useResolvedTheme"],
    "@ragents/web/toolLine": ["withToolSummaries"],
    "@ragents/web/ui": [
      "Alert", "AlertDescription", "AlertTitle", "Badge", "Button", "Card", "Dialog", "DialogBody", "DialogContent",
      "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle", "Empty", "EmptyContent", "EmptyDescription",
      "EmptyHeader", "EmptyMedia", "EmptyTitle", "Field", "FieldDescription", "FieldTitle", "HeaderDropdown", "ImagePreview", "ImagePreviewGroup", "ImageViewer", "Input", "InteractiveItem", "Label",
      "Popover", "PopoverContent", "PopoverTrigger", "SectionLabel", "Select", "SelectContent", "SelectItem", "SelectTrigger",
      "SelectValue", "Spinner", "StartupNotice", "StopButton", "StopGlyph", "SvgEdge", "Switch", "Tabs", "TabsContent",
      "TabsList", "TabsTrigger", "Textarea", "Toggle", "ToggleGroup", "ToggleGroupItem", "buttonVariants", "cn",
    ],
    "@ragents/web/ui/dialog": ["RunModalContext"],
    "quassel": LIBRARY,
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
