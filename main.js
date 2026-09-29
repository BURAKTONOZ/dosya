const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'config.json');

let db = null, aktifArsivYolu = null, mainWindow, splashWindow;

function getConfig() {
  if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath));
  return { arsivYolu: null };
}
function setConfig(data) {
  fs.writeFileSync(configPath, JSON.stringify({ ...getConfig(), ...data }));
}

function initDB(yol) {
  aktifArsivYolu = yol;
  db = new sqlite3.Database(path.join(yol, 'ndys_veritabani.db'), (err) => {
    if (!err) db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  });
  db.run(`CREATE TABLE IF NOT EXISTS evraklar (id INTEGER PRIMARY KEY AUTOINCREMENT, evrak_sayisi TEXT, evrak_tarihi TEXT, evrak_konusu TEXT, kategori TEXT, kisa_aciklama TEXT, dosya_yolu TEXT, kayit_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS kategoriler (id INTEGER PRIMARY KEY AUTOINCREMENT, ad TEXT UNIQUE)`, () => {
    db.get(`SELECT COUNT(*) as count FROM kategoriler`, (err, row) => {
      if (row && row.count === 0) ["Mahkeme Yazıları", "İsimlendirme Yazıları", "Genel Vatandaş Dilekçeleri"].forEach(k => db.run(`INSERT INTO kategoriler (ad) VALUES (?)`, [k]));
    });
  });
}

function createWindows() {
  splashWindow = new BrowserWindow({ width: 500, height: 350, transparent: true, frame: false, alwaysOnTop: true, icon: path.join(__dirname, 'icon.ico') });
  splashWindow.loadFile('splash.html');
  mainWindow = new BrowserWindow({
    width: 1400, height: 850, frame: false, show: false, backgroundColor: '#0b0812', icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.loadFile('index.html');
  setTimeout(() => { splashWindow.close(); mainWindow.show(); }, 3500);
}

app.whenReady().then(() => {
  const config = getConfig();
  if (config.arsivYolu && fs.existsSync(config.arsivYolu)) initDB(config.arsivYolu);
  createWindows();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => mainWindow.isMaximized() ? mainWindow.restore() : mainWindow.maximize());
ipcMain.on('window-close', () => mainWindow.close());

ipcMain.handle('ayarlari-getir', () => getConfig());
ipcMain.handle('klasor-sec', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled) return { basarili: false, iptal: true };
  const secilenYol = result.filePaths[0];
  if (path.basename(secilenYol) !== 'DYS ARŞİV') return { basarili: false, mesaj: "Lütfen 'DYS ARŞİV' adındaki klasörü seçin!" };
  setConfig({ arsivYolu: secilenYol });
  initDB(secilenYol);
  return { basarili: true, yol: secilenYol };
});

ipcMain.handle('kategorileri-getir', () => new Promise(res => db ? db.all(`SELECT ad FROM kategoriler ORDER BY ad ASC`, [], (err, rows) => res(err ? [] : rows.map(r => r.ad))) : res([])));
ipcMain.handle('kategori-ekle', async (e, ad) => new Promise(res => db.run(`INSERT INTO kategoriler (ad) VALUES (?)`, [ad], err => res({ basarili: !err, mesaj: err?.message }))));
ipcMain.handle('kategori-sil', async (e, ad) => new Promise(res => db.run(`DELETE FROM kategoriler WHERE ad = ?`, [ad], err => res({ basarili: !err, mesaj: err?.message }))));
ipcMain.handle('kategori-duzenle', async (e, { eskiAd, yeniAd }) => {
  try {
    const evraklar = await new Promise((res, rej) => db.all(`SELECT id, dosya_yolu FROM evraklar WHERE kategori = ?`, [eskiAd], (err, rows) => err ? rej(err) : res(rows)));
    fs.readdirSync(aktifArsivYolu).forEach(yil => {
      if (yil.length === 4 && fs.existsSync(path.join(aktifArsivYolu, yil, eskiAd))) fs.renameSync(path.join(aktifArsivYolu, yil, eskiAd), path.join(aktifArsivYolu, yil, yeniAd));
    });
    evraklar.forEach(evrak => db.run(`UPDATE evraklar SET kategori = ?, dosya_yolu = ? WHERE id = ?`, [yeniAd, evrak.dosya_yolu.replace(`\\${eskiAd}\\`, `\\${yeniAd}\\`), evrak.id]));
    db.run(`UPDATE kategoriler SET ad = ? WHERE ad = ?`, [yeniAd, eskiAd]);
    return { basarili: true };
  } catch (err) { return { basarili: false, mesaj: err.code === 'EBUSY' ? "PDF açık. Kapatıp deneyin." : err.message }; }
});

ipcMain.handle('evrak-kaydet', async (e, data) => {
  try {
    const yil = data.evrakTarihi.split('-')[0], kategoriKlasoru = path.join(aktifArsivYolu, yil, data.kategori);
    if (!fs.existsSync(path.join(aktifArsivYolu, yil))) fs.mkdirSync(path.join(aktifArsivYolu, yil));
    if (!fs.existsSync(kategoriKlasoru)) fs.mkdirSync(kategoriKlasoru);
    const yeniPdfYolu = path.join(kategoriKlasoru, `${data.evrakTarihi}_${data.evrakSayisi}_${data.evrakKonusu.replace(/[/\\?%*:|"<>]/g, '-')}_${Date.now()}.pdf`);
    fs.writeFileSync(yeniPdfYolu, Buffer.from(data.pdfBuffer));
    return new Promise((res, rej) => db.run(`INSERT INTO evraklar (evrak_sayisi, evrak_tarihi, evrak_konusu, kategori, kisa_aciklama, dosya_yolu) VALUES (?, ?, ?, ?, ?, ?)`, 
      [data.evrakSayisi, data.evrakTarihi, data.evrakKonusu, data.kategori, data.evrakAciklama, yeniPdfYolu], err => err ? rej(err.message) : res({ basarili: true })));
  } catch (err) { return { basarili: false, mesaj: err.message }; }
});

ipcMain.handle('evrak-guncelle', async (e, data) => {
  try {
    const eski = await new Promise((res, rej) => db.get(`SELECT * FROM evraklar WHERE id = ?`, [data.id], (err, row) => err ? rej(err) : res(row)));
    let yeniYol = eski.dosya_yolu;
    if (eski.evrak_tarihi !== data.evrakTarihi || eski.kategori !== data.kategori || eski.evrak_sayisi !== data.evrakSayisi || eski.evrak_konusu !== data.evrakKonusu) {
      const yil = data.evrakTarihi.split('-')[0], kategoriKlasoru = path.join(aktifArsivYolu, yil, data.kategori);
      if (!fs.existsSync(path.join(aktifArsivYolu, yil))) fs.mkdirSync(path.join(aktifArsivYolu, yil));
      if (!fs.existsSync(kategoriKlasoru)) fs.mkdirSync(kategoriKlasoru);
      yeniYol = path.join(kategoriKlasoru, `${data.evrakTarihi}_${data.evrakSayisi}_${data.evrakKonusu.replace(/[/\\?%*:|"<>]/g, '-')}_${Date.now()}.pdf`);
      if (fs.existsSync(eski.dosya_yolu)) fs.renameSync(eski.dosya_yolu, yeniYol);
    }
    if (data.pdfBuffer) fs.writeFileSync(yeniYol, Buffer.from(data.pdfBuffer));
    return new Promise((res, rej) => db.run(`UPDATE evraklar SET evrak_sayisi=?, evrak_tarihi=?, evrak_konusu=?, kategori=?, kisa_aciklama=?, dosya_yolu=? WHERE id=?`, 
      [data.evrakSayisi, data.evrakTarihi, data.evrakKonusu, data.kategori, data.evrakAciklama, yeniYol, data.id], err => err ? rej(err.message) : res({ basarili: true })));
  } catch (err) { return { basarili: false, mesaj: err.code === 'EBUSY' ? "Dosya kullanımda!" : err.message }; }
});

ipcMain.handle('evrak-sil', async (e, id) => {
  try {
    const evrak = await new Promise(res => db.get(`SELECT dosya_yolu FROM evraklar WHERE id = ?`, [id], (err, row) => res(row)));
    if (fs.existsSync(evrak.dosya_yolu)) fs.unlinkSync(evrak.dosya_yolu);
    return new Promise(res => db.run(`DELETE FROM evraklar WHERE id = ?`, [id], err => res({ basarili: !err, mesaj: err?.message })));
  } catch (err) { return { basarili: false, mesaj: err.code === 'EBUSY' ? "Dosya açık, silinemez." : err.message }; }
});

ipcMain.handle('evrakleri-getir', () => new Promise(res => db ? db.all("SELECT * FROM evraklar ORDER BY evrak_tarihi DESC", [], (err, rows) => res(err ? [] : rows)) : res([])));
ipcMain.handle('pdf-oku', async (e, yol) => { try { return { basarili: true, veri: fs.readFileSync(yol).toString('base64') }; } catch (err) { return { basarili: false, mesaj: err.message }; } });

ipcMain.handle('pdf-disa-aktar', async (e, kaynakYol, onerilenIsim) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: onerilenIsim, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (!canceled && filePath) { fs.copyFileSync(kaynakYol, filePath); return { basarili: true }; }
  return { basarili: false };
});
ipcMain.on('pdf-yazdir-harici', (e, yol) => shell.openPath(yol));
