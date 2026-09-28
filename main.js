const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400, height: 850, minWidth: 1100, minHeight: 768,
        frame: false, transparent: false, backgroundColor: '#f0f4f8',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true, nodeIntegration: false
        }
    });
    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.close());

async function acquireLock(archiveRoot) {
    const lockPath = path.join(archiveRoot, 'dys_database.lock');
    let retries = 0;
    while (fs.existsSync(lockPath) && retries < 50) {
        await new Promise(resolve => setTimeout(resolve, 100)); retries++;
    }
    fs.writeFileSync(lockPath, 'locked'); return lockPath;
}
function releaseLock(lockPath) { if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath); }

ipcMain.handle('check-folder', (event, folderPath) => {
    try { return fs.existsSync(folderPath); } catch { return false; }
});

ipcMain.handle('check-version', (event, archiveRoot, appVersion) => {
    try {
        const versionPath = path.join(archiveRoot, 'version.json');
        if (fs.existsSync(versionPath)) {
            const data = JSON.parse(fs.readFileSync(versionPath, 'utf-8'));
            if (data.version > appVersion) return { ok: false, dbVer: data.version };
        }
        fs.writeFileSync(versionPath, JSON.stringify({ version: appVersion })); return { ok: true };
    } catch(e) { return { ok: true }; }
});

ipcMain.handle('get-categories', async (event, archiveRoot) => {
    const catPath = path.join(archiveRoot, 'dys_categories.json');
    if (!fs.existsSync(catPath)) {
        const defaultCats = ["Genel Evrak", "İsimlendirme Kararları", "Encümen Kararları", "Gelen Evrak", "Giden Evrak"];
        fs.writeFileSync(catPath, JSON.stringify(defaultCats, null, 2));
        return defaultCats;
    }
    return JSON.parse(fs.readFileSync(catPath, 'utf-8'));
});

ipcMain.handle('save-categories', async (event, archiveRoot, categories) => {
    try {
        const lockPath = await acquireLock(archiveRoot);
        try { fs.writeFileSync(path.join(archiveRoot, 'dys_categories.json'), JSON.stringify(categories, null, 2)); } 
        finally { releaseLock(lockPath); }
        return { success: true };
    } catch(e) { return { success: false }; }
});

ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Ortak Arşiv Klasörünü Seçin' });
    return result.filePaths[0] || null;
});

ipcMain.handle('select-pdf', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], title: 'PDF Dosyasını Seçin', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    return result.filePaths[0] || null;
});

ipcMain.handle('load-db', async (event, archivePath) => {
    const dbPath = path.join(archivePath, 'dys_database.json');
    if (!fs.existsSync(dbPath)) return [];
    return JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
});

ipcMain.handle('save-doc', async (event, data) => {
    try {
        const { sourcePdf, archiveRoot, year, category, docDate, docNo, title, note } = data;
        const safeCategory = category ? category.replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ\s]/gi, '').trim() : 'Genel Evrak';
        
        const destFolder = path.join(archiveRoot, year, safeCategory);
        if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });
        
        const safeTitle = title.replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ]/gi, '_');
        const safeNo = docNo.replace(/[^a-zA-Z0-9]/gi, '-');
        
        const fileName = `${year}-${safeNo}-${safeTitle}-${Date.now()}.pdf`;
        const destPath = path.join(destFolder, fileName);
        fs.copyFileSync(sourcePdf, destPath);
        
        const lockPath = await acquireLock(archiveRoot);
        try {
            const dbPath = path.join(archiveRoot, 'dys_database.json');
            let db = [];
            if (fs.existsSync(dbPath)) db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
            db.unshift({ id: Date.now(), year, category: safeCategory, docDate, docNo, title, note, fileName, filePath: destPath, dateAdded: new Date().toISOString() });
            fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
        } finally { releaseLock(lockPath); }
        return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('update-doc', async (event, data) => {
    try {
        const { id, sourcePdf, archiveRoot, year, category, oldYear, oldCategory, docDate, docNo, title, note, oldFilePath } = data;
        let finalFilePath = oldFilePath;
        let finalFileName = path.basename(oldFilePath);
        const safeCategory = category ? category.replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ\s]/gi, '').trim() : 'Genel Evrak';

        if (sourcePdf) {
            const destFolder = path.join(archiveRoot, year, safeCategory);
            if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });
            const safeTitle = title.replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ]/gi, '_');
            const safeNo = docNo.replace(/[^a-zA-Z0-9]/gi, '-');
            finalFileName = `${year}-${safeNo}-${safeTitle}-${Date.now()}.pdf`;
            finalFilePath = path.join(destFolder, finalFileName);
            fs.copyFileSync(sourcePdf, finalFilePath);
            if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
        } else if (year !== oldYear || category !== oldCategory) {
            const destFolder = path.join(archiveRoot, year, safeCategory);
            if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });
            finalFilePath = path.join(destFolder, finalFileName);
            if (fs.existsSync(oldFilePath)) fs.renameSync(oldFilePath, finalFilePath);
        }

        const lockPath = await acquireLock(archiveRoot);
        try {
            const dbPath = path.join(archiveRoot, 'dys_database.json');
            let db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
            const index = db.findIndex(d => d.id === id);
            if(index !== -1) {
                db[index] = { ...db[index], year, category: safeCategory, docDate, docNo, title, note, fileName: finalFileName, filePath: finalFilePath };
                fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
            }
        } finally { releaseLock(lockPath); }
        return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('delete-doc', async (event, data) => {
    try {
        const { id, filePath, archiveRoot } = data;
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        const lockPath = await acquireLock(archiveRoot);
        try {
            const dbPath = path.join(archiveRoot, 'dys_database.json');
            let db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
            db = db.filter(d => d.id !== id);
            fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
        } finally { releaseLock(lockPath); }
        return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
});
