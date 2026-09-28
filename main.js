const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

const DB_FILE = 'dys_database.json';
const CAT_FILE = 'dys_categories.json';
const TEXT_DIR = 'dys_text';
const LOCK_FILE = 'dys_database.lock';

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400, height: 850, minWidth: 1100, minHeight: 700,
        frame: false, transparent: false, backgroundColor: '#f5eedd', show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true, nodeIntegration: false
        }
    });
    mainWindow.loadFile('index.html');
    mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

const winOf = (e) => BrowserWindow.fromWebContents(e.sender) || mainWindow;
ipcMain.on('window-minimize', (e) => winOf(e).minimize());
ipcMain.on('window-maximize', (e) => { const w = winOf(e); w.isMaximized() ? w.unmaximize() : w.maximize(); });
ipcMain.on('window-close', (e) => winOf(e).close());

/* ---------- Yardımcılar ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Atomik kilit: aynı anda yalnızca bir kişi yazabilir. 15 sn'den eski kilit (çökmüş program) otomatik temizlenir.
async function acquireLock(archiveRoot) {
    const lockPath = path.join(archiveRoot, LOCK_FILE);
    for (let i = 0; i < 100; i++) {
        try { fs.closeSync(fs.openSync(lockPath, 'wx')); return lockPath; }
        catch (e) {
            if (e.code !== 'EEXIST') throw e;
            try { if (Date.now() - fs.statSync(lockPath).mtimeMs > 15000) fs.unlinkSync(lockPath); } catch {}
            await sleep(100);
        }
    }
    throw new Error('Veritabanı meşgul, lütfen tekrar deneyin.');
}
function releaseLock(lockPath) { try { if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath); } catch {} }

// Önce geçici dosyaya yazıp sonra değiştirir: yarım kalan yazma veritabanını bozmaz
function writeJson(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
}
function readDb(archiveRoot) {
    const dbPath = path.join(archiveRoot, DB_FILE);
    return fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, 'utf-8')) : [];
}
const safeFolder = (c) => (c ? c.replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ\s]/gi, '').trim() : '') || 'Genel Evrak';
function makeFileName(year, docNo, title) {
    const safeTitle = String(title).replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ]/gi, '_').slice(0, 80);
    const safeNo = String(docNo).replace(/[^a-zA-Z0-9]/gi, '-') || 'x';
    return `${year}-${safeNo}-${safeTitle}-${Date.now()}.pdf`;
}
function moveFile(from, to) {
    try { fs.renameSync(from, to); }
    catch { fs.copyFileSync(from, to); fs.unlinkSync(from); }
}
// Yaklaşık benzersiz sayısal id (iki kullanıcı aynı milisaniyede kayıt yapsa bile çakışmaz)
// Sürüm karşılaştırma: "2.1.0" > "2.0.9" > 1 (eski sayısal sürümler de desteklenir)
function cmpVer(a, b) {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
    return 0;
}
const newId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

/* ---------- Klasör / versiyon ---------- */
ipcMain.handle('check-folder', (event, folderPath) => {
    try { return fs.existsSync(folderPath); } catch { return false; }
});

ipcMain.handle('check-version', (event, archiveRoot, appVersion) => {
    try {
        const versionPath = path.join(archiveRoot, 'version.json');
        if (fs.existsSync(versionPath)) {
            const data = JSON.parse(fs.readFileSync(versionPath, 'utf-8'));
            if (cmpVer(data.version, appVersion) > 0) return { ok: false, dbVer: data.version };
        }
        fs.writeFileSync(versionPath, JSON.stringify({ version: appVersion }));
        return { ok: true };
    } catch (e) { return { ok: true }; }
});

ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Ortak Arşiv Klasörünü Seçin' });
    return result.filePaths[0] || null;
});

ipcMain.handle('select-pdf', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], title: 'PDF Dosyasını Seçin', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    return result.filePaths[0] || null;
});

/* ---------- Kategoriler ---------- */
ipcMain.handle('get-categories', async (event, archiveRoot) => {
    const catPath = path.join(archiveRoot, CAT_FILE);
    const defaultCats = ["Genel Evrak", "İsimlendirme Kararları", "Encümen Kararları", "Gelen Evrak", "Giden Evrak"];
    try {
        if (!fs.existsSync(catPath)) { writeJson(catPath, defaultCats); return defaultCats; }
        return JSON.parse(fs.readFileSync(catPath, 'utf-8'));
    } catch { return defaultCats; }
});

ipcMain.handle('save-categories', async (event, archiveRoot, categories) => {
    let lockPath;
    try {
        lockPath = await acquireLock(archiveRoot);
        writeJson(path.join(archiveRoot, CAT_FILE), categories);
        return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
    finally { if (lockPath) releaseLock(lockPath); }
});

/* ---------- Evraklar ---------- */
ipcMain.handle('load-db', async (event, archivePath) => {
    try { return readDb(archivePath); } catch { return []; }
});

ipcMain.handle('save-doc', async (event, data) => {
    let lockPath, destPath;
    try {
        const { sourcePdf, archiveRoot, year, category, docDate, docNo, title, note } = data;
        lockPath = await acquireLock(archiveRoot);
        const db = readDb(archiveRoot);

        const destFolder = path.join(archiveRoot, String(year), safeFolder(category));
        fs.mkdirSync(destFolder, { recursive: true });
        const fileName = makeFileName(year, docNo, title);
        destPath = path.join(destFolder, fileName);
        fs.copyFileSync(sourcePdf, destPath);

        const doc = { id: newId(), year: String(year), category: category || 'Genel Evrak', docDate, docNo, title, note, fileName, filePath: destPath, dateAdded: new Date().toISOString() };
        db.unshift(doc);
        writeJson(path.join(archiveRoot, DB_FILE), db);
        return { success: true, doc };
    } catch (error) {
        // Kayıt başarısızsa yetim PDF bırakma
        try { if (destPath && fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
        return { success: false, error: error.message };
    } finally { if (lockPath) releaseLock(lockPath); }
});

ipcMain.handle('update-doc', async (event, data) => {
    let lockPath;
    try {
        const { id, sourcePdf, archiveRoot, year, category, docDate, docNo, title, note, oldFilePath } = data;
        lockPath = await acquireLock(archiveRoot);
        const db = readDb(archiveRoot);
        const index = db.findIndex((d) => d.id === id);
        if (index === -1) throw new Error('Kayıt bulunamadı (başka biri silmiş olabilir).');
        const old = db[index];

        let finalFilePath = oldFilePath || old.filePath;
        let finalFileName = path.basename(finalFilePath);
        const destFolder = path.join(archiveRoot, String(year), safeFolder(category));

        if (sourcePdf) {
            fs.mkdirSync(destFolder, { recursive: true });
            finalFileName = makeFileName(year, docNo, title);
            finalFilePath = path.join(destFolder, finalFileName);
            fs.copyFileSync(sourcePdf, finalFilePath);
            if (fs.existsSync(old.filePath)) fs.unlinkSync(old.filePath);
        } else if (String(year) !== String(old.year) || safeFolder(category) !== safeFolder(old.category)) {
            fs.mkdirSync(destFolder, { recursive: true });
            const target = path.join(destFolder, finalFileName);
            if (fs.existsSync(finalFilePath)) moveFile(finalFilePath, target);
            finalFilePath = target;
        }

        db[index] = { ...old, year: String(year), category: category || 'Genel Evrak', docDate, docNo, title, note, fileName: finalFileName, filePath: finalFilePath };
        writeJson(path.join(archiveRoot, DB_FILE), db);
        return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
    finally { if (lockPath) releaseLock(lockPath); }
});

ipcMain.handle('delete-doc', async (event, data) => {
    let lockPath;
    try {
        const { id, filePath, archiveRoot } = data;
        lockPath = await acquireLock(archiveRoot);
        // Önce kaydı sil, sonra dosyayı: yarım kalırsa kayıtsız PDF kalır, PDF'siz kayıt kalmaz
        const db = readDb(archiveRoot).filter((d) => d.id !== id);
        writeJson(path.join(archiveRoot, DB_FILE), db);
        try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
        try { fs.unlinkSync(path.join(archiveRoot, TEXT_DIR, id + '.json')); } catch {}
        return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
    finally { if (lockPath) releaseLock(lockPath); }
});

/* ---------- OCR / metin dosyaları (arşivde dys_text/<id>.json) ---------- */
const norm = (t) => String(t || '').replace(/İ/g, 'i').replace(/I/g, 'i').toLowerCase()
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');

ipcMain.handle('read-pdf', async (e, p) => { try { return fs.readFileSync(p); } catch { return null; } });

ipcMain.handle('get-text', async (e, root, id) => {
    try { return JSON.parse(fs.readFileSync(path.join(root, TEXT_DIR, id + '.json'), 'utf-8')); } catch { return null; }
});
ipcMain.handle('save-text', async (e, root, id, obj) => {
    try {
        fs.mkdirSync(path.join(root, TEXT_DIR), { recursive: true });
        writeJson(path.join(root, TEXT_DIR, id + '.json'), obj);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('text-ids', async (e, root) => {
    try { return fs.readdirSync(path.join(root, TEXT_DIR)).filter((f) => f.endsWith('.json')).map((f) => Number(f.slice(0, -5))); } catch { return []; }
});
// PDF içi arama: sorgudaki tüm kelimeler aynı sayfada geçmeli. Sonuç: { id: [sayfa numaraları] }
ipcMain.handle('search-text', async (e, root, query) => {
    const words = norm(query).split(/\s+/).filter(Boolean), out = {};
    if (!words.length) return out;
    let files = [];
    try { files = fs.readdirSync(path.join(root, TEXT_DIR)).filter((f) => f.endsWith('.json')); } catch { return out; }
    for (const f of files) {
        try {
            const t = JSON.parse(fs.readFileSync(path.join(root, TEXT_DIR, f), 'utf-8'));
            const hits = [];
            (t.pages || []).forEach((pg, i) => { const n = norm(pg); if (words.every((w) => n.includes(w))) hits.push(i + 1); });
            if (hits.length) out[f.slice(0, -5)] = hits;
        } catch {}
    }
    return out;
});
