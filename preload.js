const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    selectPdf: () => ipcRenderer.invoke('select-pdf'),
    loadDb: (archivePath) => ipcRenderer.invoke('load-db', archivePath),
    saveDoc: (data) => ipcRenderer.invoke('save-doc', data),
    updateDoc: (data) => ipcRenderer.invoke('update-doc', data),
    deleteDoc: (data) => ipcRenderer.invoke('delete-doc', data),

    checkFolder: (path) => ipcRenderer.invoke('check-folder', path),
    checkVersion: (path, ver) => ipcRenderer.invoke('check-version', path, ver),

    getCategories: (archiveRoot) => ipcRenderer.invoke('get-categories', archiveRoot),
    saveCategories: (archiveRoot, cats) => ipcRenderer.invoke('save-categories', archiveRoot, cats),

    minimizeApp: () => ipcRenderer.send('window-minimize'),
    maximizeApp: () => ipcRenderer.send('window-maximize'),
    closeApp: () => ipcRenderer.send('window-close')
});
