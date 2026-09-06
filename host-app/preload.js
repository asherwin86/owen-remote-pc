// Exposes only these three narrow calls to the renderer — never the raw
// ipcRenderer/require, and never nut-js itself — so a compromised or buggy
// renderer can't do anything beyond "ask what screen source exists" and
// "ask main to inject one specific input event", not run arbitrary Node code.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hostAPI", {
  getScreenSource: () => ipcRenderer.invoke("get-screen-source"),
  getScreenSize: () => ipcRenderer.invoke("get-screen-size"),
  injectInput: (cmd) => ipcRenderer.invoke("inject-input", cmd),
  getServerInfo: () => ipcRenderer.invoke("get-server-info"),
  onUpdateStatus: (callback) => ipcRenderer.on("update-status", (_event, text) => callback(text)),
});
