import { ipcMain } from "electron";
import { v4 as uuidv4 } from "uuid";
import {
  listFolders,
  createFolder,
  deleteFolder,
  setConversationFolder,
} from "../db/repos/folders.repo";

export function registerFoldersIpc(): void {
  ipcMain.handle("folders:list", async () => {
    return listFolders();
  });

  ipcMain.handle("folders:create", async (_e, name: string) => {
    return createFolder(uuidv4(), name);
  });

  ipcMain.handle("folders:delete", async (_e, id: string) => {
    deleteFolder(id);
  });

  ipcMain.handle(
    "conversations:set-folder",
    async (_e, convId: string, folderId: string | null) => {
      setConversationFolder(convId, folderId);
    },
  );
}
