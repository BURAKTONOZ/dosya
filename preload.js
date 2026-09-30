const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  klasorSec: () => ipcRenderer.invoke('klasor-sec'),
  ayarlariGetir: () => ipcRenderer.invoke('ayarlari-getir'),
  kategorileriGetir: () => ipcRenderer.invoke('kategorileri-getir'),
  kategoriEkle: (ad) => ipcRenderer.invoke('kategori-ekle', ad),
  kategoriSil: (ad) => ipcRenderer.invoke('kategori-sil', ad),
  kategoriDuzenle: (data) => ipcRenderer.invoke('kategori-duzenle', data),
  evrakKaydet: (data) => ipcRenderer.invoke('evrak-kaydet', data),
  evrakGuncelle: (data) => ipcRenderer.invoke('evrak-guncelle', data),
  evrakSil: (id) => ipcRenderer.invoke('evrak-sil', id),
  evrakleriGetir: () => ipcRenderer.invoke('evrakleri-getir'),
  pdfOku: (yol) => ipcRenderer.invoke('pdf-oku', yol),
  pdfDisaAktar: (yol, isim) => ipcRenderer.invoke('pdf-disa-aktar', yol, isim)
});
