// GÜNCEL UYGULAMA VERSİYONU (DB İLE KARŞILAŞTIRILACAK)
const APP_VERSION = "1.0.1";

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

let tumEvraklar = [], aktifKategoriler = [], seciliYil = null, seciliKategori = null;
let modalModu = 'yeni', seciliKartId = null, currentFile = null;

function ozelUyari(mesaj) { document.getElementById('alert-message').innerText = mesaj; document.getElementById('custom-alert').classList.add('show'); }
function ozelOnay(mesaj, cb) { document.getElementById('confirm-message').innerText = mesaj; document.getElementById('confirm-yes').onclick = () => { document.getElementById('custom-confirm').classList.remove('show'); cb(); }; document.getElementById('custom-confirm').classList.add('show'); }
const formatTR = (t) => t ? t.split('-').reverse().join('.') : '';

// KLAVYE ASİSTANI (CTRL+F VE OK TUŞLARI İLE SMART SCROLL)
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); document.getElementById('arama-kutusu').focus(); }
  
  const visibleCards = Array.from(document.querySelectorAll('.a4-card'));
  if (visibleCards.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    let currentIndex = visibleCards.findIndex(c => c.classList.contains('active'));
    
    if (e.key === 'ArrowDown' && currentIndex < visibleCards.length - 1) {
      visibleCards[currentIndex + 1].click();
    } else if (e.key === 'ArrowUp' && currentIndex > 0) {
      visibleCards[currentIndex - 1].click();
    } else if (e.key === 'ArrowDown' && currentIndex === -1) {
      visibleCards[0].click();
    }
  }
  if (e.key === 'Escape') { 
    if(document.body.classList.contains('focus-mode')) odakModuGecis();
    else { panelKapat(); modalKapat(); document.getElementById('custom-alert').classList.remove('show'); document.getElementById('custom-confirm').classList.remove('show'); }
  }
});

async function temaAyarla(tema) {
  if(tema === 'light') { document.body.classList.remove('dark-mode'); document.body.classList.add('light-mode'); document.getElementById('theme-toggle').innerText = '🌙'; }
  else { document.body.classList.remove('light-mode'); document.body.classList.add('dark-mode'); document.getElementById('theme-toggle').innerText = '☀️'; }
  await window.api.ayarlariKaydet({ tema: tema });
}
window.temaDegistir = async function() {
  const yeniTema = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
  await temaAyarla(yeniTema);
}

document.addEventListener('DOMContentLoaded', async () => {
  const config = await window.api.ayarlariGetir();
  temaAyarla(config.tema || 'dark');
  
  if (!config.arsivYolu) { 
    document.getElementById('setup-overlay').classList.add('show'); document.getElementById('setup-title').innerText = "İlk Kurulum"; 
  } else { 
    document.getElementById('guncel-yol').innerText = "Yol: " + config.arsivYolu; 
    
    // VERİTABANI VERSİYON KONTROLÜ
    const vCheck = await window.api.versiyonKontrol(APP_VERSION);
    if(vCheck.durum === 'eski') {
       document.getElementById('versiyon-alert').classList.add('show');
       return; // Programı durdur
    }
    await yukle(); 
  }
});

async function klasorSecmeIslemi() {
  const snc = await window.api.klasorSec();
  if(snc.basarili) { 
    document.getElementById('guncel-yol').innerText = "Yol: " + snc.yol; document.getElementById('setup-overlay').classList.remove('show'); 
    const vCheck = await window.api.versiyonKontrol(APP_VERSION);
    if(vCheck.durum === 'eski') { document.getElementById('versiyon-alert').classList.add('show'); return; }
    await yukle(); 
  } 
  else if (!snc.iptal) ozelUyari("Hata: " + snc.mesaj);
}

async function yukle() {
  tumEvraklar = await window.api.evrakleriGetir();
  aktifKategoriler = await window.api.kategorileriGetir();
  agacYapisiniCiz(); aramaYap();
}

function agacYapisiniCiz() {
  const tree = document.getElementById('tree-menu');
  tree.innerHTML = ``; 
  const yillar = [...new Set(tumEvraklar.map(e => e.evrak_tarihi.split('-')[0]))].sort().reverse();
  yillar.forEach(yil => {
    if(!yil) return;
    const kats = [...new Set(tumEvraklar.filter(e => e.evrak_tarihi.startsWith(yil)).map(e => e.kategori))].sort();
    let subHtml = kats.map(k => `<div class="tree-cat-btn ${seciliYil===yil && seciliKategori===k ? 'active' : ''}" onclick="kategoriTikla('${yil}', '${k}', event)">📄 ${k}</div>`).join('');
    tree.innerHTML += `<div class="tree-item ${seciliYil===yil ? 'open' : ''}"><div class="tree-year-btn" onclick="yilTikla('${yil}')"><span>📅 ${yil}</span><span class="chevron">▼</span></div><div class="tree-sub">${subHtml}</div></div>`;
  });
}

window.yilTikla = function(yil) {
  if (seciliYil === yil && seciliKategori === null) { seciliYil = null; document.getElementById('aktif-baslik').innerText = "Tüm Arşiv"; } 
  else { seciliYil = yil; seciliKategori = null; document.getElementById('aktif-baslik').innerText = `${yil} Yılı Evrakları`; }
  agacYapisiniCiz(); aramaYap();
}

window.kategoriTikla = function(yil, kategori, event) {
  event.stopPropagation(); seciliYil = yil; seciliKategori = kategori;
  document.getElementById('aktif-baslik').innerText = `${yil} /${kategori}`;
  agacYapisiniCiz(); aramaYap();
}

// EVRENSEL ARAMA (TEK KUTU)
document.getElementById('arama-kutusu').addEventListener('input', aramaYap);

function aramaYap() {
  const kel = document.getElementById('arama-kutusu').value.toLowerCase();
  
  let filt = tumEvraklar;
  if(seciliYil) filt = filt.filter(e => e.evrak_tarihi.startsWith(seciliYil));
  if(seciliKategori) filt = filt.filter(e => e.kategori === seciliKategori);
  
  if(kel) {
    filt = filt.filter(e => {
        return (e.evrak_konusu && e.evrak_konusu.toLowerCase().includes(kel)) || 
               (e.evrak_sayisi && e.evrak_sayisi.includes(kel)) || 
               (e.kategori && e.kategori.toLowerCase().includes(kel)) || 
               (e.okunan_metin && e.okunan_metin.toLowerCase().includes(kel));
    });
  }
  kartlariCiz(filt);
}

function kartlariCiz(liste) {
  const container = document.getElementById('cards-container');
  container.innerHTML = '';
  if (liste.length === 0) return container.innerHTML = '<p style="color:var(--text-muted); padding:20px;">Kayıt bulunamadı.</p>';
  
  liste.forEach(evrak => {
    const card = document.createElement('div');
    card.className = `a4-card ${seciliKartId === evrak.id ? 'active' : ''}`;
    card.title = (evrak.okunan_metin ? "OCR Notu:\n" + evrak.okunan_metin.substring(0, 300) + "..." : ""); 
    
    card.onclick = () => { 
      if(seciliKartId === evrak.id) { panelKapat(); } 
      else { 
        seciliKartId = evrak.id; 
        belgeGoster(evrak.dosya_yolu, evrak.evrak_konusu); 
        aramaYap(); 
        // SMART SCROLL: Seçilen kartı yumuşakça ekranın en üstüne (göz hizasına) sabitler
        setTimeout(() => { document.querySelector(`.a4-card.active`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
      } 
    };
    
    let ocrHtml = evrak.okunan_metin && evrak.okunan_metin.trim() !== "" ? `<div class="a4-ocr-snippet">"${evrak.okunan_metin.substring(0, 150).replace(/\n/g, ' ')}..."</div>` : ``;

    card.innerHTML = `
      <div class="a4-header"><span class="a4-no">No: ${evrak.evrak_sayisi}</span><span class="a4-date">${formatTR(evrak.evrak_tarihi)}</span></div>
      <div class="a4-subject">${evrak.evrak_konusu}</div>
      <div class="a4-category">${evrak.kategori}</div>
      ${ocrHtml}
      <div class="card-hover-menu">
        <button class="card-btn" onclick="event.stopPropagation(); modalAc('duzenle', ${evrak.id})" title="Düzenle">✏️</button>
        <button class="card-btn danger" onclick="event.stopPropagation(); evrakSil(${evrak.id})" title="Sil">🗑️</button>
      </div>
    `;
    container.appendChild(card);
  });
}

window.evrakSil = function(id) { ozelOnay("Kalıcı olarak silinsin mi?", async () => { const snc = await window.api.evrakSil(id); if(snc.basarili) { if(seciliKartId === id) panelKapat(); await yukle(); } else ozelUyari(snc.mesaj); }); };
document.getElementById('ctx-disa-aktar').onclick = async () => { if(seciliKartId) window.api.pdfDisaAktar(tumEvraklar.find(e => e.id === seciliKartId).dosya_yolu, "evrak.pdf"); };

async function belgeGoster(yol, konu) {
  document.getElementById('pdf-view-title').innerText = konu;
  const snc = await window.api.pdfOku(yol);
  if(snc.basarili) {
    const b = atob(snc.veri); const arr = new Uint8Array(b.length); for(let i=0;i<b.length;i++) arr[i] = b.charCodeAt(i);
    const blobUrl = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
    document.getElementById('pdf-frame-view').src = blobUrl + '#view=FitH'; // FITH = Genişliğe Sığdır
    document.getElementById('pdf-panel').classList.remove('hidden'); document.getElementById('pdf-panel').classList.add('open'); document.body.classList.add('pdf-open'); 
  }
}

window.panelKapat = function() { seciliKartId = null; document.getElementById('pdf-panel').classList.remove('open'); document.getElementById('pdf-panel').classList.add('hidden'); document.body.classList.remove('pdf-open', 'focus-mode'); document.getElementById('focus-btn').innerText = "🔲"; document.getElementById('pdf-frame-view').src=""; aramaYap(); }
window.odakModuGecis = function() { const btn = document.getElementById('focus-btn'); document.body.classList.toggle('focus-mode'); if(document.body.classList.contains('focus-mode')) btn.innerText = "🔳"; else btn.innerText = "🔲"; }

// YENİ KAYIT VE LAZER ANİMASYONLU OCR
const dragZone = document.getElementById('drag-zone');
const pdfInput = document.getElementById('pdf-file');
const preview = document.getElementById('modal-pdf-preview');

dragZone.onclick = () => pdfInput.click();
dragZone.ondragover = (e) => { e.preventDefault(); dragZone.classList.add('dragover'); };
dragZone.ondragleave = () => dragZone.classList.remove('dragover');
dragZone.ondrop = (e) => { e.preventDefault(); dragZone.classList.remove('dragover'); if(e.dataTransfer.files[0]) dosyaIsle(e.dataTransfer.files[0]); };
pdfInput.onchange = function() { if (this.files[0]) dosyaIsle(this.files[0]); };

async function dosyaIsle(file) {
  if(file.type !== "application/pdf") return ozelUyari("Sadece PDF seçin.");
  currentFile = file;
  dragZone.style.display = 'none'; preview.style.display = 'block';
  preview.src = URL.createObjectURL(file) + '#view=FitH';
  
  const arrayBuffer = await file.arrayBuffer();
  await ocrTaramasiBaslat(arrayBuffer);
}

// Eski evraklarda metni yeniden taratmak için
window.eskiMetniYenidenTara = async function() {
  const btn = document.getElementById('rescan-btn');
  btn.innerText = "⏳ Taranıyor...";
  btn.disabled = true;
  try {
     const evrak = tumEvraklar.find(e => e.id === parseInt(document.getElementById('evrak-id').value));
     const snc = await window.api.pdfOku(evrak.dosya_yolu);
     if(snc.basarili) {
       const b = atob(snc.veri); const arr = new Uint8Array(b.length); for(let i=0;i<b.length;i++) arr[i] = b.charCodeAt(i);
       await ocrTaramasiBaslat(arr.buffer);
     }
  } catch(e) { ozelUyari("Tarama hatası!"); }
  btn.innerText = "🔄 Tekrar Oku";
  btn.disabled = false;
}

async function ocrTaramasiBaslat(arrayBuffer) {
  document.getElementById('ocr-status-area').style.display = 'block';
  document.getElementById('ocr-text-container').style.display = 'none';
  document.getElementById('ocr-animation').style.display = 'block';
  document.getElementById('ocr-status-text').innerText = "Yapay Zeka Hazırlanıyor...";
  document.getElementById('evrak-okunan-metin').value = "";
  
  try {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = pdf.numPages;
    let fullText = "";
    
    const worker = await Tesseract.createWorker('tur', 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
           let yuzde = (m.progress * 100).toFixed(0);
           document.getElementById('ocr-status-text').innerText = `Yapay Zeka Taranıyor: Sayfa %${yuzde}`;
        }
      }
    });
    
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2.0 }); 
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.height = viewport.height; canvas.width = viewport.width;
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      
      const imgData = canvas.toDataURL('image/png');
      const ret = await worker.recognize(imgData);
      fullText += ret.data.text + "\n\n";
    }
    await worker.terminate();
    
    document.getElementById('ocr-animation').style.display = 'none';
    if(fullText.trim() !== "") {
      document.getElementById('evrak-okunan-metin').value = fullText;
      document.getElementById('ocr-text-container').style.display = 'block'; // Otomatik Göster
    } else { throw new Error("Boş metin"); }
  } catch (err) {
    document.getElementById('ocr-animation').style.display = 'none';
    ozelUyari("⚠️ Metin Okunamadı (Görsel çok silik veya boş olabilir)");
  }
}

window.modalAc = function(mod, id = null) {
  modalModu = mod; currentFile = null;
  document.getElementById('modal-baslik').innerText = mod === 'yeni' ? "Yeni Evrak Ekle" : "Evrak Düzenle";
  document.getElementById('evrak-kategori').innerHTML = aktifKategoriler.map(k => `<option value="${k}">${k}</option>`).join('');
  document.getElementById('ocr-status-area').style.display = 'none';
  
  if(mod === 'yeni') {
    ['evrak-id','evrak-sayisi','evrak-tarihi','evrak-konusu','evrak-okunan-metin'].forEach(i => document.getElementById(i).value = "");
    dragZone.style.display = 'flex'; preview.style.display = 'none'; preview.src = "";
  } else {
    const evrak = tumEvraklar.find(e => e.id === id);
    document.getElementById('evrak-id').value = evrak.id;
    document.getElementById('evrak-kategori').value = evrak.kategori;
    document.getElementById('evrak-sayisi').value = evrak.evrak_sayisi;
    document.getElementById('evrak-tarihi').value = evrak.evrak_tarihi;
    document.getElementById('evrak-konusu').value = evrak.evrak_konusu;
    
    // Düzenle modunda okunan metni direkt göster ve "Yeniden Tara" butonunu aktif et
    document.getElementById('evrak-okunan-metin').value = evrak.okunan_metin || "";
    document.getElementById('ocr-status-area').style.display = 'block';
    document.getElementById('ocr-text-container').style.display = 'block';
    document.getElementById('ocr-animation').style.display = 'none';
    
    dragZone.style.display = 'none'; preview.style.display = 'block';
    window.api.pdfOku(evrak.dosya_yolu).then(s => {
      if(s.basarili) {
        const b = atob(s.veri); const arr = new Uint8Array(b.length); for(let i=0;i<b.length;i++) arr[i] = b.charCodeAt(i);
        preview.src = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' })) + '#view=FitH';
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
  const okunanMetin = document.getElementById('evrak-okunan-metin').value;

  if (!kategori || !sayi || !tarih || !konu) return ozelUyari("Eksik alanları doldurun.");
  if (modalModu === 'yeni' && !currentFile) return ozelUyari("PDF yüklemek zorunludur.");

  document.getElementById('kaydet-btn').innerText = "İşleniyor...";
  const data = { id, kategori, evrakSayisi: sayi, evrakTarihi: tarih, evrakKonusu: konu, okunanMetin, pdfBuffer: currentFile ? await currentFile.arrayBuffer() : null };
  const sonuc = modalModu === 'yeni' ? await window.api.evrakKaydet(data) : await window.api.evrakGuncelle(data);
  document.getElementById('kaydet-btn').innerText = "Arşive Kaydet";
  
  if (sonuc.basarili) { modalKapat(); await yukle(); } else ozelUyari(sonuc.mesaj); 
};

window.ayarlarModalAc = async function() { document.getElementById('guncel-yol').innerText = "Yol: " + ((await window.api.ayarlariGetir()).arsivYolu || "Seçilmedi"); document.getElementById('setup-kapat-btn').style.display = 'block'; kategoriListesiniCiz(); document.getElementById('setup-overlay').classList.add('show'); }
window.ayarlarModalKapat = () => document.getElementById('setup-overlay').classList.remove('show');
function kategoriListesiniCiz() { document.getElementById('kategori-listesi').innerHTML = aktifKategoriler.map(k => `<div class="kategori-item"><input type="text" value="${k}" id="kat-input-${k}"><div style="display:flex; gap:5px;"><button class="win-btn" onclick="kategoriGuncelle('${k}')" style="width:auto; padding:0 10px;">💾</button><button class="win-btn win-close" onclick="kategoriSil('${k}')" style="width:auto; padding:0 10px;">🗑</button></div></div>`).join(''); }
window.kategoriEkle = async function() { const y = document.getElementById('yeni-kategori-input').value.trim(); if(!y||aktifKategoriler.includes(y)) return; const s = await window.api.kategoriEkle(y); if(s.basarili) { aktifKategoriler.push(y); document.getElementById('yeni-kategori-input').value = ""; kategoriListesiniCiz(); } }
window.kategoriSil = function(k) { ozelOnay(`"${k}" silinsin mi?`, async () => { const s = await window.api.kategoriSil(k); if(s.basarili) { aktifKategoriler = aktifKategoriler.filter(x => x !== k); kategoriListesiniCiz(); await yukle(); } }); }
window.kategoriGuncelle = async function(eski) { const yeni = document.getElementById(`kat-input-${eski}`).value.trim(); if(!yeni||eski===yeni) return; const s = await window.api.kategoriDuzenle({ eskiAd: eski, yeniAd: yeni }); if(s.basarili) { aktifKategoriler = await window.api.kategorileriGetir(); kategoriListesiniCiz(); await yukle(); } }
