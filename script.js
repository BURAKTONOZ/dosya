let tumEvraklar = [], aktifKategoriler = [], seciliYil = null, seciliKategori = null;
let modalModu = 'yeni', seciliKartId = null, currentFile = null;

function ozelUyari(mesaj) { document.getElementById('alert-message').innerText = mesaj; document.getElementById('custom-alert').classList.add('show'); }
function ozelOnay(mesaj, cb) { document.getElementById('confirm-message').innerText = mesaj; document.getElementById('confirm-yes').onclick = () => { document.getElementById('custom-confirm').classList.remove('show'); cb(); }; document.getElementById('custom-confirm').classList.add('show'); }
const formatTR = (t) => t ? t.split('-').reverse().join('.') : '';

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); document.getElementById('arama-kutusu').focus(); }
  if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); modalAc('yeni'); }
  if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); ayarlarModalAc(); }
  if (e.key === 'Escape') { 
    if(document.body.classList.contains('focus-mode')) odakModuGecis();
    else { panelKapat(); modalKapat(); document.getElementById('custom-alert').classList.remove('show'); document.getElementById('custom-confirm').classList.remove('show'); }
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  const config = await window.api.ayarlariGetir();
  if (!config.arsivYolu) { document.getElementById('setup-overlay').classList.add('show'); document.getElementById('setup-title').innerText = "İlk Kurulum"; } 
  else { document.getElementById('guncel-yol').innerText = "Şu anki yol: " + config.arsivYolu; await yukle(); }
});

async function klasorSecmeIslemi() {
  const sonuc = await window.api.klasorSec();
  if (sonuc.basarili) { document.getElementById('guncel-yol').innerText = "Şu anki yol: " + sonuc.yol; document.getElementById('setup-overlay').classList.remove('show'); await yukle(); } 
  else if (!sonuc.iptal) ozelUyari("Hata: " + sonuc.mesaj);
}

async function yukle() {
  tumEvraklar = await window.api.evrakleriGetir();
  aktifKategoriler = await window.api.kategorileriGetir();
  agacYapisiniCiz();
  aramaYap();
}

function agacYapisiniCiz() {
  const tree = document.getElementById('tree-menu');
  tree.innerHTML = `<div class="tree-item"><div class="tree-year ${!seciliYil ? 'active' : ''}" onclick="filtreUygula(null, null)">📁 Tüm Arşiv</div></div>`;
  const yillar = [...new Set(tumEvraklar.map(e => e.evrak_tarihi.split('-')[0]))].sort().reverse();
  yillar.forEach(yil => {
    if(!yil) return;
    const buYilinKategorileri = [...new Set(tumEvraklar.filter(e => e.evrak_tarihi.startsWith(yil)).map(e => e.kategori))].sort();
    let subHtml = buYilinKategorileri.map(kat => `<div class="tree-cat ${seciliYil===yil && seciliKategori===kat ? 'active' : ''}" onclick="filtreUygula('${yil}', '${kat}', event)">📄 ${kat}</div>`).join('');
    const isOpen = seciliYil === yil ? 'open' : '';
    tree.innerHTML += `<div class="tree-item ${isOpen}"><div class="tree-year ${seciliYil===yil && !seciliKategori ? 'active' : ''}" onclick="toggleTree(this, '${yil}')">📅 ${yil}</div><div class="tree-sub">${subHtml}</div></div>`;
  });
}

window.toggleTree = function(el, yil) {
  el.parentElement.classList.toggle('open');
  filtreUygula(yil, null); 
}

window.filtreUygula = function(yil, kategori, event) {
  if(event) event.stopPropagation();
  seciliYil = yil; seciliKategori = kategori;
  
  let baslik = yil ? (kategori ? `${yil} / ${kategori}` : `${yil} Evrakları`) : "Tüm Arşiv";
  document.getElementById('aktif-baslik').innerText = baslik;
  
  agacYapisiniCiz(); 
  aramaYap();
}

document.getElementById('arama-kutusu').addEventListener('input', aramaYap);
function aramaYap() {
  const kel = document.getElementById('arama-kutusu').value.toLowerCase();
  let filt = tumEvraklar;
  if(seciliYil) filt = filt.filter(e => e.evrak_tarihi.startsWith(seciliYil));
  if(seciliKategori) filt = filt.filter(e => e.kategori === seciliKategori);
  if(kel) filt = filt.filter(e => e.evrak_konusu.toLowerCase().includes(kel) || e.evrak_sayisi.includes(kel) || e.kategori.toLowerCase().includes(kel));
  kartlariCiz(filt);
}

function kartlariCiz(liste) {
  const container = document.getElementById('cards-container');
  container.innerHTML = '';
  if (liste.length === 0) return container.innerHTML = '<p style="color:var(--text-muted); text-align:center; margin-top:20px;">Evrak bulunamadı.</p>';
  
  liste.forEach(evrak => {
    const card = document.createElement('div');
    card.className = `a4-card ${seciliKartId === evrak.id ? 'active' : ''}`;
    card.onclick = () => { if(seciliKartId === evrak.id) { panelKapat(); } else { seciliKartId = evrak.id; belgeGoster(evrak.dosya_yolu, evrak.evrak_konusu); aramaYap(); } };
    
    card.innerHTML = `
      <div class="a4-header">
        <span class="a4-no">Sayı: ${evrak.evrak_sayisi}</span>
        <span class="a4-date">${formatTR(evrak.evrak_tarihi)}</span>
      </div>
      <div class="a4-subject">${evrak.evrak_konusu}</div>
      <div class="a4-category">${evrak.kategori}</div>
      <div class="a4-desc">${evrak.kisa_aciklama}</div>
      
      <div class="card-hover-menu">
        <button class="card-btn" onclick="event.stopPropagation(); modalAc('duzenle', ${evrak.id})" title="Düzenle">DÜZENLE</button>
        <button class="card-btn danger" onclick="event.stopPropagation(); evrakSil(${evrak.id})" title="Sil">SİL</button>
      </div>
    `;
    container.appendChild(card);
  });
}

window.evrakSil = function(id) {
  ozelOnay("Evrakı kalıcı olarak silmek istediğinize emin misiniz?", async () => {
    const snc = await window.api.evrakSil(id);
    if(snc.basarili) { if(seciliKartId === id) panelKapat(); await yukle(); } else ozelUyari(snc.mesaj); 
  }); 
};

document.getElementById('ctx-disa-aktar').onclick = async () => {
  if(!seciliKartId) return;
  const evrak = tumEvraklar.find(e => e.id === seciliKartId);
  const isim = `${evrak.evrak_sayisi}_${evrak.evrak_konusu}.pdf`.replace(/[/\\?%*:|"<>]/g, '-');
  const snc = await window.api.pdfDisaAktar(evrak.dosya_yolu, isim);
  if(snc.basarili) ozelUyari("PDF başarıyla kaydedildi!");
};

async function belgeGoster(yol, konu) {
  document.getElementById('pdf-view-title').innerText = konu;
  const sonuc = await window.api.pdfOku(yol);
  if(sonuc.basarili) {
    const byteCharacters = atob(sonuc.veri);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
    document.getElementById('pdf-frame-view').src = URL.createObjectURL(new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' }));
    document.getElementById('pdf-panel').classList.remove('hidden');
    document.getElementById('pdf-panel').classList.add('open');
    document.body.classList.add('pdf-open'); 
  } else ozelUyari("PDF Açılamadı: " + sonuc.mesaj);
}

window.panelKapat = function() { 
  seciliKartId = null; 
  document.getElementById('pdf-panel').classList.remove('open'); 
  document.getElementById('pdf-panel').classList.add('hidden'); 
  document.body.classList.remove('pdf-open', 'focus-mode'); 
  document.getElementById('focus-btn').innerText = "🔲";
  setTimeout(()=> document.getElementById('pdf-frame-view').src="", 400); 
  aramaYap(); 
}

// ODAK MODU (TAM EKRAN PDF)
window.odakModuGecis = function() {
  const btn = document.getElementById('focus-btn');
  document.body.classList.toggle('focus-mode');
  if(document.body.classList.contains('focus-mode')) btn.innerText = "🔳"; else btn.innerText = "🔲";
}

const dragZone = document.getElementById('drag-zone');
const pdfInput = document.getElementById('pdf-file');
const pdfInputEdit = document.getElementById('pdf-file-edit');
const preview = document.getElementById('modal-pdf-preview');

dragZone.onclick = () => pdfInput.click();
dragZone.ondragover = (e) => { e.preventDefault(); dragZone.classList.add('dragover'); };
dragZone.ondragleave = () => dragZone.classList.remove('dragover');
dragZone.ondrop = (e) => { e.preventDefault(); dragZone.classList.remove('dragover'); if(e.dataTransfer.files[0]) dosyaIsle(e.dataTransfer.files[0]); };
pdfInput.onchange = function() { if (this.files[0]) dosyaIsle(this.files[0]); };
pdfInputEdit.onchange = function() { if (this.files[0]) dosyaIsle(this.files[0]); };

function dosyaIsle(file) {
  if(file.type !== "application/pdf") return ozelUyari("Sadece PDF seçin.");
  currentFile = file;
  dragZone.style.display = 'none'; preview.style.display = 'block';
  preview.src = URL.createObjectURL(file);
  document.getElementById('pdf-upload-title').innerText = file.name;
  document.getElementById('btn-pdf-degistir').style.display = 'inline-block';
}

window.modalAc = function(mod, id = null) {
  modalModu = mod; currentFile = null;
  document.getElementById('modal-baslik').innerText = mod === 'yeni' ? "Yeni Evrak Ekle" : "Evrak Düzenle";
  document.getElementById('kaydet-btn').innerText = mod === 'yeni' ? "Kaydet" : "Güncelle";
  document.getElementById('evrak-kategori').innerHTML = aktifKategoriler.map(k => `<option value="${k}">${k}</option>`).join('');
  
  if(mod === 'yeni') {
    ['evrak-id','evrak-sayisi','evrak-tarihi','evrak-konusu','evrak-aciklama'].forEach(i => document.getElementById(i).value = "");
    dragZone.style.display = 'flex'; preview.style.display = 'none'; preview.src = "";
    document.getElementById('pdf-upload-title').innerText = "PDF Yükle";
    document.getElementById('btn-pdf-degistir').style.display = 'none';
  } else {
    const evrak = tumEvraklar.find(e => e.id === id);
    document.getElementById('evrak-id').value = evrak.id;
    document.getElementById('evrak-kategori').value = evrak.kategori;
    document.getElementById('evrak-sayisi').value = evrak.evrak_sayisi;
    document.getElementById('evrak-tarihi').value = evrak.evrak_tarihi;
    document.getElementById('evrak-konusu').value = evrak.evrak_konusu;
    document.getElementById('evrak-aciklama').value = evrak.kisa_aciklama;
    
    dragZone.style.display = 'none'; preview.style.display = 'block';
    document.getElementById('pdf-upload-title').innerText = "Mevcut PDF";
    document.getElementById('btn-pdf-degistir').style.display = 'inline-block';
    
    window.api.pdfOku(evrak.dosya_yolu).then(snc => {
      if(snc.basarili) {
        const byteCharacters = atob(snc.veri);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
        preview.src = URL.createObjectURL(new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' }));
      }
    });
  }
  document.getElementById('modal-overlay').classList.add('show');
}
window.modalKapat = function() { document.getElementById('modal-overlay').classList.remove('show'); }

document.getElementById('kaydet-btn').onclick = async () => {
  const id = document.getElementById('evrak-id').value;
  const kategori = document.getElementById('evrak-kategori').value;
  const sayi = document.getElementById('evrak-sayisi').value;
  const tarih = document.getElementById('evrak-tarihi').value;
  const konu = document.getElementById('evrak-konusu').value;
  const aciklama = document.getElementById('evrak-aciklama').value;

  if (!kategori || !sayi || !tarih || !konu) return ozelUyari("Eksik alanları doldurun.");
  if (modalModu === 'yeni' && !currentFile) return ozelUyari("PDF yüklemek zorunludur.");

  document.getElementById('kaydet-btn').innerText = "İşleniyor...";
  const data = { id, kategori, evrakSayisi: sayi, evrakTarihi: tarih, evrakKonusu: konu, evrakAciklama: aciklama, pdfBuffer: currentFile ? await currentFile.arrayBuffer() : null };
  const sonuc = modalModu === 'yeni' ? await window.api.evrakKaydet(data) : await window.api.evrakGuncelle(data);
  
  if (sonuc.basarili) { modalKapat(); await yukle(); } else ozelUyari(sonuc.mesaj); 
};

window.ayarlarModalAc = async function() {
  document.getElementById('guncel-yol').innerText = "Yol: " + ((await window.api.ayarlariGetir()).arsivYolu || "Seçilmedi");
  document.getElementById('setup-kapat-btn').style.display = 'block';
  kategoriListesiniCiz(); document.getElementById('setup-overlay').classList.add('show');
}
window.ayarlarModalKapat = () => document.getElementById('setup-overlay').classList.remove('show');

function kategoriListesiniCiz() { document.getElementById('kategori-listesi').innerHTML = aktifKategoriler.map(k => `<div class="kategori-item"><input type="text" value="${k}" id="kat-input-${k}"><div class="kategori-item-actions"><button class="btn-action" onclick="kategoriGuncelle('${k}')">Kaydet</button><button class="btn-action btn-delete" onclick="kategoriSil('${k}')">Sil</button></div></div>`).join(''); }

window.kategoriEkle = async function() {
  const yeni = document.getElementById('yeni-kategori-input').value.trim();
  if(!yeni || aktifKategoriler.includes(yeni)) return;
  const sonuc = await window.api.kategoriEkle(yeni);
  if(sonuc.basarili) { aktifKategoriler.push(yeni); document.getElementById('yeni-kategori-input').value = ""; kategoriListesiniCiz(); } else ozelUyari("Hata: " + sonuc.mesaj);
}
window.kategoriSil = function(kategori) { ozelOnay(`"${kategori}" silinsin mi?`, async () => { const snc = await window.api.kategoriSil(kategori); if(snc.basarili) { aktifKategoriler = aktifKategoriler.filter(k => k !== kategori); kategoriListesiniCiz(); await yukle(); } else ozelUyari(snc.mesaj); }); }
window.kategoriGuncelle = async function(eskiAd) {
  const yeniAd = document.getElementById(`kat-input-${eskiAd}`).value.trim();
  if(!yeniAd || eskiAd === yeniAd) return;
  const sonuc = await window.api.kategoriDuzenle({ eskiAd, yeniAd });
  if(sonuc.basarili) { aktifKategoriler = await window.api.kategorileriGetir(); kategoriListesiniCiz(); await yukle(); ozelUyari("Kategori güncellendi."); } else ozelUyari(sonuc.mesaj);
}
