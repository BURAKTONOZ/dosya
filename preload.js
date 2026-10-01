const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  forceQuit: () => ipcRenderer.send('force-quit'),
  versiyonKontrol: (ver) => ipcRenderer.invoke('versiyon-kontrol', ver),
  klasorSec: () => ipcRenderer.invoke('klasor-sec'),
  ayarlariGetir: () => ipcRenderer.invoke('ayarlari-getir'),
  ayarlariKaydet: (data) => ipcRenderer.invoke('ayarlari-kaydet', data),
  kategorileriGetir: () => ipcRenderer.invoke('kategorileri-getir'),
  kategoriEkle: (data) => ipcRenderer.invoke('kategori-ekle', data),
  kategoriSil: (ad) => ipcRenderer.invoke('kategori-sil', ad),
  kategoriDuzenle: (data) => ipcRenderer.invoke('kategori-duzenle', data),
  evrakKaydet: (data) => ipcRenderer.invoke('evrak-kaydet', data),
  evrakGuncelle: (data) => ipcRenderer.invoke('evrak-guncelle', data),
  evrakSil: (id) => ipcRenderer.invoke('evrak-sil', id),
  evrakleriGetir: () => ipcRenderer.invoke('evrakleri-getir'),
  pdfOku: (yol) => ipcRenderer.invoke('pdf-oku', yol),
  pdfDisaAktar: (yol, isim) => ipcRenderer.invoke('pdf-disa-aktar', yol, isim)
});