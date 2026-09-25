import * as engineSrcDomainEvents from "@ragents/engine/src/domain/events";
import * as engineSrcHttpContracts from "@ragents/engine/src/http/contracts";
import * as engineSrcRpcContract from "@ragents/engine/src/rpc/contract";
import * as hostChatAttachments from "@ragents/host/chat-attachments";
import * as hostPluginSupportActorProgramsContract from "@ragents/host/plugin-support/actor-programs/contract";
import * as webAccessContext from "@ragents/web/AccessContext";
import * as webDiffCode from "@ragents/web/DiffCode";
import * as webPluginRegistry from "@ragents/web/PluginRegistry";
import * as webSourceCode from "@ragents/web/SourceCode";
import * as webStatusGroup from "@ragents/web/StatusGroup";
import * as webToolbar from "@ragents/web/Toolbar";
import * as webAccessToken from "@ragents/web/access-token";
import * as webActorConversation from "@ragents/web/actor-conversation";
import * as webApi from "@ragents/web/api";
import * as webChatViewSettings from "@ragents/web/chat-view-settings";
import * as webChatChatInputToolbar from "@ragents/web/chat/ChatInputToolbar";
import * as webChatChatMessages from "@ragents/web/chat/ChatMessages";
import * as webChatChatPanel from "@ragents/web/chat/ChatPanel";
import * as webChatDetailModeSwitch from "@ragents/web/chat/DetailModeSwitch";
import * as webChatMarkdown from "@ragents/web/chat/Markdown";
import * as webChatStoppedActorNotice from "@ragents/web/chat/StoppedActorNotice";
import * as webChatChatTarget from "@ragents/web/chat/chat-target";
import * as webChatUseAttachmentCapabilities from "@ragents/web/chat/useAttachmentCapabilities";
import * as webChatUseChat from "@ragents/web/chat/useChat";
import * as webLanguageServerLanguageServerPlugin from "@ragents/web/language-server/language-server-plugin";
import * as webLibFormat from "@ragents/web/lib/format";
import * as webLibGuards from "@ragents/web/lib/guards";
import * as webLibHttp from "@ragents/web/lib/http";
import * as webLibLabels from "@ragents/web/lib/labels";
import * as webLibLocalStorageSetting from "@ragents/web/lib/local-storage-setting";
import * as webPageOpener from "@ragents/web/page-opener";
import * as webProductProductModelSettings from "@ragents/web/product/ProductModelSettings";
import * as webProductStartOptions from "@ragents/web/product/start-options";
import * as webRpc from "@ragents/web/rpc";
import * as webRunPanelHost from "@ragents/web/run-panel/host";
import * as webRunPanelInputBridge from "@ragents/web/run-panel/input-bridge";
import * as webRunView from "@ragents/web/run-view";
import * as webTheme from "@ragents/web/theme";
import * as webToolLine from "@ragents/web/toolLine";
import * as webUi from "@ragents/web/ui";
import * as webUiDialog from "@ragents/web/ui/dialog";
import * as react from "react";
import * as reactDom from "react-dom";
import * as reactJsxRuntime from "react/jsx-runtime";
import * as typebox from "typebox";
import { HOST_MODULES_GLOBAL } from "@ragents/host/host-api";

/** Every module of the web host API that has values, under its specifier; plugin bundles read them from here instead of carrying a copy. */
export const hostModules: Readonly<Record<string, object>> = {
  "@ragents/engine/src/domain/events": engineSrcDomainEvents,
  "@ragents/engine/src/http/contracts": engineSrcHttpContracts,
  "@ragents/engine/src/rpc/contract": engineSrcRpcContract,
  "@ragents/host/chat-attachments": hostChatAttachments,
  "@ragents/host/plugin-support/actor-programs/contract": hostPluginSupportActorProgramsContract,
  "@ragents/web/AccessContext": webAccessContext,
  "@ragents/web/DiffCode": webDiffCode,
  "@ragents/web/PluginRegistry": webPluginRegistry,
  "@ragents/web/SourceCode": webSourceCode,
  "@ragents/web/StatusGroup": webStatusGroup,
  "@ragents/web/Toolbar": webToolbar,
  "@ragents/web/access-token": webAccessToken,
  "@ragents/web/actor-conversation": webActorConversation,
  "@ragents/web/api": webApi,
  "@ragents/web/chat-view-settings": webChatViewSettings,
  "@ragents/web/chat/ChatInputToolbar": webChatChatInputToolbar,
  "@ragents/web/chat/ChatMessages": webChatChatMessages,
  "@ragents/web/chat/ChatPanel": webChatChatPanel,
  "@ragents/web/chat/DetailModeSwitch": webChatDetailModeSwitch,
  "@ragents/web/chat/Markdown": webChatMarkdown,
  "@ragents/web/chat/StoppedActorNotice": webChatStoppedActorNotice,
  "@ragents/web/chat/chat-target": webChatChatTarget,
  "@ragents/web/chat/useAttachmentCapabilities": webChatUseAttachmentCapabilities,
  "@ragents/web/chat/useChat": webChatUseChat,
  "@ragents/web/language-server/language-server-plugin": webLanguageServerLanguageServerPlugin,
  "@ragents/web/lib/format": webLibFormat,
  "@ragents/web/lib/guards": webLibGuards,
  "@ragents/web/lib/http": webLibHttp,
  "@ragents/web/lib/labels": webLibLabels,
  "@ragents/web/lib/local-storage-setting": webLibLocalStorageSetting,
  "@ragents/web/page-opener": webPageOpener,
  "@ragents/web/product/ProductModelSettings": webProductProductModelSettings,
  "@ragents/web/product/start-options": webProductStartOptions,
  "@ragents/web/rpc": webRpc,
  "@ragents/web/run-panel/host": webRunPanelHost,
  "@ragents/web/run-panel/input-bridge": webRunPanelInputBridge,
  "@ragents/web/run-view": webRunView,
  "@ragents/web/theme": webTheme,
  "@ragents/web/toolLine": webToolLine,
  "@ragents/web/ui": webUi,
  "@ragents/web/ui/dialog": webUiDialog,
  "react": react,
  "react-dom": reactDom,
  "react/jsx-runtime": reactJsxRuntime,
  "typebox": typebox,
};

/** Puts the register where the shims of the plugin bundles look; the host web calls it before any bundle loads. */
export const installHostModules = (): void => {
  Object.assign(globalThis, { [HOST_MODULES_GLOBAL]: hostModules });
};
