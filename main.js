const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'config.json');

let db = null, aktifArsivYolu = null, mainWindow, splashWindow;

function getConfig() {
  if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath));
  return { arsivYolu: null, tema: 'dark' };
}
function setConfig(data) { fs.writeFileSync(configPath, JSON.stringify({ ...getConfig(), ...data })); }

// --- YENİ NESİL AĞ (NETWORK) MİMARİSİ İÇİN AKILLI YOL ÇÖZÜCÜ ---
function tamYoluGetir(dbYolu) {
  if (!dbYolu) return "";
  // Eğer yol "C:\", "Z:\" gibi bir sürücü harfi içeriyorsa veya "\\" ile ağ paylaşımı olarak başlıyorsa (ESKİ KAYITLAR)
  if (dbYolu.includes(':\\') || dbYolu.startsWith('\\\\')) {
    return dbYolu;
  }
  // Eğer göreceli bir yolsa (YENİ KAYITLAR), mevcut bilgisayarın arşiv yoluyla anında birleştir
  return path.join(aktifArsivYolu, dbYolu);
}

function initDB(yol) {
  aktifArsivYolu = yol;
  db = new sqlite3.Database(path.join(yol, 'ndys_veritabani.db'), (err) => {
    if (!err) db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  });
  
  db.run(`CREATE TABLE IF NOT EXISTS sistem_bilgi (id INTEGER PRIMARY KEY, versiyon TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS evraklar (id INTEGER PRIMARY KEY AUTOINCREMENT, evrak_sayisi TEXT, evrak_tarihi TEXT, evrak_konusu TEXT, kategori TEXT, kisa_aciklama TEXT, dosya_yolu TEXT, okunan_metin TEXT, kayit_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP)`, () => {
    db.run(`ALTER TABLE evraklar ADD COLUMN okunan_metin TEXT`, () => {}); 
  });
  
  db.run(`CREATE TABLE IF NOT EXISTS kategoriler (id INTEGER PRIMARY KEY AUTOINCREMENT, ad TEXT UNIQUE, renk TEXT DEFAULT '#4db8ff')`, () => {
    db.run(`ALTER TABLE kategoriler ADD COLUMN renk TEXT DEFAULT '#4db8ff'`, () => {
      db.get(`SELECT COUNT(*) as count FROM kategoriler`, (err, row) => {
        if (row && row.count === 0) {
          ["Mahkeme Yazıları", "İsimlendirme Yazıları", "Genel Vatandaş Dilekçeleri"].forEach(k => db.run(`INSERT INTO kategoriler (ad, renk) VALUES (?, '#4db8ff')`, [k]));
        }
      });
    }); 
  });
}

function createWindows() {
  splashWindow = new BrowserWindow({ width: 550, height: 380, transparent: true, frame: false, alwaysOnTop: true, icon: path.join(__dirname, 'icon.ico') });
  splashWindow.loadFile('splash.html');
  
  mainWindow = new BrowserWindow({
    width: 1500, height: 900, frame: false, show: false, transparent: true, hasShadow: false, 
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.loadFile('index.html');
  setTimeout(() => { splashWindow.close(); mainWindow.show(); }, 4000); 
}

app.whenReady().then(() => {
  const config = getConfig();
  if (config.arsivYolu && fs.existsSync(config.arsivYolu)) initDB(config.arsivYolu);
  createWindows();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-close', () => mainWindow.close());
ipcMain.on('force-quit', () => app.quit());
ipcMain.on('window-maximize', () => { if (mainWindow.isMaximized()) { mainWindow.unmaximize(); } else { mainWindow.maximize(); } });

ipcMain.handle('versiyon-kontrol', async (e, appVersion) => {
  if(!db) return { durum: 'db_yok' };
  return new Promise((resolve) => {
    db.get(`SELECT versiyon FROM sistem_bilgi WHERE id = 1`, (err, row) => {
      if (!row) {
        db.run(`INSERT INTO sistem_bilgi (id, versiyon) VALUES (1, ?)`, [appVersion]);
        resolve({ durum: 'guncellendi', dbVersiyon: appVersion });
      } else {
        const vApp = appVersion.split('.').map(Number);
        const vDb = row.versiyon.split('.').map(Number);
        let cmp = 0;
        for(let i=0; i<3; i++) { if(vApp[i] > vDb[i]) { cmp = 1; break; } if(vApp[i] < vDb[i]) { cmp = -1; break; } }
        
        if (cmp > 0) { db.run(`UPDATE sistem_bilgi SET versiyon = ? WHERE id = 1`, [appVersion]); resolve({ durum: 'guncellendi', dbVersiyon: appVersion }); } 
        else if (cmp < 0) { resolve({ durum: 'eski', dbVersiyon: row.versiyon }); } 
        else { resolve({ durum: 'guncel', dbVersiyon: row.versiyon }); }
      }
    });
  });
});

ipcMain.handle('ayarlari-getir', () => getConfig());
ipcMain.handle('ayarlari-kaydet', (e, data) => { setConfig(data); return true; });
ipcMain.handle('klasor-sec', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled) return { basarili: false, iptal: true };
  setConfig({ arsivYolu: result.filePaths[0] });
  initDB(result.filePaths[0]);
  return { basarili: true, yol: result.filePaths[0] };
});

ipcMain.handle('kategorileri-getir', () => new Promise(res => db ? db.all(`SELECT ad, renk FROM kategoriler ORDER BY ad ASC`, [], (err, rows) => res(err ? [] : rows)) : res([])));
ipcMain.handle('kategori-ekle', async (e, data) => new Promise(res => db.run(`INSERT INTO kategoriler (ad, renk) VALUES (?, ?)`, [data.ad, data.renk], err => res({ basarili: !err, mesaj: err?.message }))));
ipcMain.handle('kategori-sil', async (e, ad) => new Promise(res => db.run(`DELETE FROM kategoriler WHERE ad = ?`, [ad], err => res({ basarili: !err, mesaj: err?.message }))));
ipcMain.handle('kategori-duzenle', async (e, { eskiAd, yeniAd, yeniRenk }) => {
  try {
    if(eskiAd !== yeniAd) {
      const evraklar = await new Promise((res, rej) => db.all(`SELECT id, dosya_yolu FROM evraklar WHERE kategori = ?`, [eskiAd], (err, rows) => err ? rej(err) : res(rows)));
      fs.readdirSync(aktifArsivYolu).forEach(yil => { 
        const eskiYol = path.join(aktifArsivYolu, yil, eskiAd);
        const yeniYol = path.join(aktifArsivYolu, yil, yeniAd);
        if (yil.length === 4 && fs.existsSync(eskiYol)) fs.renameSync(eskiYol, yeniYol); 
      });
      evraklar.forEach(evrak => {
        // Eski yolu ve yeni yolu esnek bir şekilde değiştirir
        let yeniDosyaYolu = evrak.dosya_yolu.replace(`\\${eskiAd}\\`, `\\${yeniAd}\\`).replace(`/${eskiAd}/`, `/${yeniAd}/`);
        db.run(`UPDATE evraklar SET kategori = ?, dosya_yolu = ? WHERE id = ?`, [yeniAd, yeniDosyaYolu, evrak.id]);
      });
    }
    db.run(`UPDATE kategoriler SET ad = ?, renk = ? WHERE ad = ?`, [yeniAd, yeniRenk, eskiAd]);
    return { basarili: true };
  } catch (err) { return { basarili: false }; }
});

ipcMain.handle('evrak-kaydet', async (e, data) => {
  try {
    const yil = data.evrakTarihi.split('-')[0];
    const kategoriKlasoru = path.join(aktifArsivYolu, yil, data.kategori);
    if (!fs.existsSync(path.join(aktifArsivYolu, yil))) fs.mkdirSync(path.join(aktifArsivYolu, yil));
    if (!fs.existsSync(kategoriKlasoru)) fs.mkdirSync(kategoriKlasoru);
    
    const dosyaAdi = `${data.evrakTarihi}_${data.evrakSayisi}_${data.evrakKonusu.replace(/[/\\?%*:|"<>]/g, '-')}_${Date.now()}.pdf`;
    
    // İşletim sistemine dosyayı yazmak için Mutlak Yol kullanılır
    const mutlakYol = path.join(kategoriKlasoru, dosyaAdi);
    // Veritabanına taşınabilir olması için GÖRECELİ YOL kaydedilir
    const goreceliYol = path.join(yil, data.kategori, dosyaAdi); 

    fs.writeFileSync(mutlakYol, Buffer.from(data.pdfBuffer));
    return new Promise((res, rej) => db.run(`INSERT INTO evraklar (evrak_sayisi, evrak_tarihi, evrak_konusu, kategori, kisa_aciklama, dosya_yolu, okunan_metin) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
      [data.evrakSayisi, data.evrakTarihi, data.evrakKonusu, data.kategori, "", goreceliYol, data.okunanMetin], err => err ? rej(err.message) : res({ basarili: true })));
  } catch (err) { return { basarili: false, mesaj: err.message }; }
});

ipcMain.handle('evrak-guncelle', async (e, data) => {
  try {
    const eski = await new Promise((res, rej) => db.get(`SELECT * FROM evraklar WHERE id = ?`, [data.id], (err, row) => err ? rej(err) : res(row)));
    
    let goreceliYol = eski.dosya_yolu;
    let mutlakYol = tamYoluGetir(eski.dosya_yolu);

    if (eski.evrak_tarihi !== data.evrakTarihi || eski.kategori !== data.kategori || eski.evrak_sayisi !== data.evrakSayisi || eski.evrak_konusu !== data.evrakKonusu) {
      const yil = data.evrakTarihi.split('-')[0];
      const kategoriKlasoru = path.join(aktifArsivYolu, yil, data.kategori);
      
      if (!fs.existsSync(path.join(aktifArsivYolu, yil))) fs.mkdirSync(path.join(aktifArsivYolu, yil));
      if (!fs.existsSync(kategoriKlasoru)) fs.mkdirSync(kategoriKlasoru);
      
      const dosyaAdi = `${data.evrakTarihi}_${data.evrakSayisi}_${data.evrakKonusu.replace(/[/\\?%*:|"<>]/g, '-')}_${Date.now()}.pdf`;
      const yeniMutlakYol = path.join(kategoriKlasoru, dosyaAdi);
      
      goreceliYol = path.join(yil, data.kategori, dosyaAdi); // Yeni taşınabilir yol
      
      if (fs.existsSync(mutlakYol)) fs.renameSync(mutlakYol, yeniMutlakYol);
    }
    return new Promise((res, rej) => db.run(`UPDATE evraklar SET evrak_sayisi=?, evrak_tarihi=?, evrak_konusu=?, kategori=?, okunan_metin=?, dosya_yolu=? WHERE id=?`, 
      [data.evrakSayisi, data.evrakTarihi, data.evrakKonusu, data.kategori, data.okunanMetin, goreceliYol, data.id], err => err ? rej(err.message) : res({ basarili: true })));
  } catch (err) { return { basarili: false, mesaj: err.code === 'EBUSY' ? "Dosya kullanımda!" : err.message }; }
});

ipcMain.handle('evrak-sil', async (e, id) => {
  try {
    const evrak = await new Promise(res => db.get(`SELECT dosya_yolu FROM evraklar WHERE id = ?`, [id], (err, row) => res(row)));
    const mutlakYol = tamYoluGetir(evrak.dosya_yolu); // Gerçek yolu süzgeçten geçirir
    if (fs.existsSync(mutlakYol)) fs.unlinkSync(mutlakYol);
    return new Promise(res => db.run(`DELETE FROM evraklar WHERE id = ?`, [id], err => res({ basarili: !err, mesaj: err?.message })));
  } catch (err) { return { basarili: false, mesaj: err.code === 'EBUSY' ? "Dosya açık, silinemez." : err.message }; }
});

ipcMain.handle('evrakleri-getir', () => new Promise(res => db ? db.all("SELECT * FROM evraklar ORDER BY evrak_tarihi DESC", [], (err, rows) => res(err ? [] : rows)) : res([])));

ipcMain.handle('pdf-oku', async (e, yol) => { 
  try { 
    const mutlakYol = tamYoluGetir(yol); // Veritabanındaki yolu bilgisayara uyarlar
    return { basarili: true, veri: fs.readFileSync(mutlakYol).toString('base64') }; 
  } catch (err) { return { basarili: false, mesaj: err.message }; } 
});

ipcMain.handle('pdf-disa-aktar', async (e, kaynakYol, onerilenIsim) => {
  const mutlakYol = tamYoluGetir(kaynakYol); // Veritabanındaki yolu bilgisayara uyarlar
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: onerilenIsim, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (!canceled && filePath) { fs.copyFileSync(mutlakYol, filePath); return { basarili: true }; }
  return { basarili: false };
});
