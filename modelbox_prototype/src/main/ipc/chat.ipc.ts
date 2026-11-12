import { ipcMain } from "electron";
import { v4 as uuidv4 } from "uuid";
import {
  listConversations,
  listArchivedConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
  toggleArchive,
  searchConversations,
} from "../db/repos/conversations.repo";
import {
  listMessages,
  createMessage,
  deleteMessage,
  deleteMessagesFrom,
  updateMessage,
} from "../db/repos/messages.repo";
import type { ChatParams } from "@shared/types";

export function registerChatIpc(): void {
  ipcMain.handle("conversations:list", async () => {
    return listConversations();
  });

  ipcMain.handle("conversations:get", async (_e, id: string) => {
    return getConversation(id);
  });

  ipcMain.handle(
    "conversations:create",
    async (
      _e,
      payload: {
        title: string;
        modelId?: string;
        instanceId?: string;
        instanceHost?: string;
        instancePort?: number;
        systemPrompt?: string;
        chatParams?: ChatParams;
      },
    ) => {
      const id = uuidv4();
      return createConversation({ id, ...payload });
    },
  );

  ipcMain.handle(
    "conversations:update",
    async (_e, id: string, patch: Parameters<typeof updateConversation>[1]) => {
      return updateConversation(id, patch);
    },
  );

  ipcMain.handle("conversations:delete", async (_e, id: string) => {
    deleteConversation(id);
  });

  ipcMain.handle("conversations:toggle-archive", async (_e, id: string) => {
    return toggleArchive(id);
  });

  ipcMain.handle("conversations:list-archived", async () => {
    return listArchivedConversations();
  });

  ipcMain.handle("conversations:search", async (_e, query: string) => {
    return searchConversations(query);
  });

  ipcMain.handle("messages:list", async (_e, conversationId: string) => {
    return listMessages(conversationId);
  });

  ipcMain.handle("messages:delete", async (_e, messageId: string) => {
    deleteMessage(messageId);
  });

  ipcMain.handle(
    "messages:deleteFrom",
    async (_e, conversationId: string, fromMessageId: string) => {
      deleteMessagesFrom(conversationId, fromMessageId);
    },
  );

  ipcMain.handle(
    "messages:update",
    async (_e, id: string, patch: { content?: string }) => {
      return updateMessage(id, patch);
    },
  );

  ipcMain.handle(
    "messages:create",
    async (
      _e,
      payload: {
        conversationId: string;
        role: "user" | "assistant" | "system";
        content: string;
        tokenCount?: number;
        tokensPerSecond?: number;
        thinkDurationMs?: number;
        contextTokens?: number;
        contextSize?: number;
        promptProcessingMs?: number;
      },
    ) => {
      const id = uuidv4();
      return createMessage({ id, ...payload });
    },
  );
}
