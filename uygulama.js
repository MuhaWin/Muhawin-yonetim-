'use strict';
/* MuhaWin Yönetim (telefon) — masaüstündeki renderer/yonetim.js ile aynı sunucu işlevleri, telefona göre arayüz. */
(()=>{
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const N=s=>String(s||'').toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');
const tl=n=>Number(n||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2});
const trD=s=>{if(!s)return '—';const d=new Date(String(s).length===10?s+'T12:00:00':s);return isNaN(d)?'—':d.toLocaleDateString('tr-TR');};
const trDT=s=>s?new Date(s).toLocaleString('tr-TR',{dateStyle:'short',timeStyle:'short'}):'—';
const iso=d=>{const x=new Date(d);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
const bugun=()=>iso(new Date());
const r2=n=>Math.round((+n||0)*100)/100;
const toplam=p=>r2((+p.tutar||0)*(1+(+p.kdv_orani||0)/100));
const LS={al(k){try{return localStorage.getItem(k);}catch(e){return null;}},yaz(k,v){try{if(v==null)localStorage.removeItem(k);else localStorage.setItem(k,v);}catch(e){}}};

const MODAD={fatura:'Muhasebe İşlemleri',ekstre:'MuhaWin lisansı',okc:'Hızlı Fiş Girişi',ozel:'Ofisinize Özel Çözümler',denetim:'Denetim ve Analiz',gecici:'Geçici Vergi İşlemleri',personel:'Personel'};
const LISANS='ekstre';     // TEK LİSANS: lisans / deneme / kod 'ekstre' kaydında tutulur, tüm modülleri açar
const OZEL=[{id:'cek',ad:'Çek / Senet Kayıtları'},{id:'mikro',ad:'Mikro Denetim'}];
const EYLEM={bilgi:'Bilgi düzenlendi',deneme:'Deneme süresi',lisans:'Lisans verildi',bitis:'Bitiş tarihi ayarlandı',lisans_bitir:'Lisans bitirildi',kapat:'Hesap kapatıldı',ac:'Hesap açıldı',
  pin_hata:'Yönetim şifresi hatalı',pin_giris:'Yönetime giriş',pin_degisti:'Yönetim şifresi değişti',ozel:'Özel çözüm tanımı',
  pc_sifirla:'Bilgisayarlar sıfırlandı',pc_sil:'Bilgisayar silindi',sil:'Üyelik silindi',satis:'Satış kaydı',satis_duzelt:'Satış düzeltildi',satis_sil:'Satış silindi',kod_uret:'Lisans kodu üretildi',ayar:'Ayarlar değişti'};
const YONTEM=['Havale / EFT','Kredi kartı','Nakit','Çek','Diğer'];
const mad=m=>MODAD[m]||m;

/* ================= sunucu ================= */
let oturum=null;   // {access_token, refresh_token, expires_at, email}
function trErr(j,st){
  const m=String((j&&(j.msg||j.message||j.error_description||j.error))||'');const c=j&&(j.error_code||j.code);
  if(c==='email_not_confirmed'||/not confirmed/i.test(m))return 'E-posta adresi henüz doğrulanmadı.';
  if(c==='invalid_credentials'||c==='invalid_grant'||/invalid login/i.test(m))return 'E-posta ya da şifre hatalı.';
  if(c==='over_request_rate_limit'||/rate limit/i.test(m))return 'Çok sık deneme yapıldı. Biraz bekleyin.';
  if(/Yetkisiz/i.test(m))return 'Bu işlem için yetkiniz yok.';
  if(/schema cache|Could not find the function/i.test(m))return 'Lisans sunucusunda yönetim güncellemesi yok (supabase-yonetim.sql).';
  if(st===401)return 'Oturum süresi doldu. Yeniden giriş yapın.';
  return m||('Sunucu hatası ('+st+').');
}
async function istek(yol,{govde,belirtec,yontem='POST'}={}){
  const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),20000);let r;
  try{r=await fetch(SUPA+yol,{method:yontem,signal:ctl.signal,headers:{apikey:ANON,'Content-Type':'application/json',Authorization:'Bearer '+(belirtec||ANON)},body:govde===undefined?undefined:JSON.stringify(govde)});}
  catch(e){throw new Error('Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.');}
  finally{clearTimeout(t);}
  const txt=await r.text();let j=null;try{j=txt?JSON.parse(txt):null;}catch(e){}
  if(!r.ok){const e=new Error(trErr(j,r.status));e.status=r.status;throw e;}
  return j;
}
function oturumKur(j,email){
  oturum={access_token:j.access_token,refresh_token:j.refresh_token,expires_at:Date.now()+(j.expires_in||3600)*1000,email:String(email||(j.user&&j.user.email)||'').toLowerCase()};
  LS.yaz(OTURUM_ANAHTAR,JSON.stringify({refresh_token:oturum.refresh_token,email:oturum.email}));
}
async function belirtec(){
  if(!oturum)throw new Error('Önce giriş yapın.');
  if(Date.now()>oturum.expires_at-60000){
    const j=await istek('/auth/v1/token?grant_type=refresh_token',{govde:{refresh_token:oturum.refresh_token}});oturumKur(j,oturum.email);}
  return oturum.access_token;
}
const rpc=async(fn,args)=>istek('/rest/v1/rpc/'+fn,{govde:args||{},belirtec:await belirtec()});
const call=(fn,a)=>rpc(fn,a).catch(e=>{if(e.status===401){cikis(true);}throw e;});

/* ================= lisans kodu ================= */
const KOD_ALFABE='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const kodNorm=k=>String(k||'').toUpperCase().replace(/[^0-9A-Z]/g,'').replace(/[IL]/g,'1').replace(/O/g,'0').replace(/U/g,'V');
async function kodOzet(k){const v=kodNorm(k);if(v.length!==50)throw new Error('Lisans kodu 50 haneli olmalı.');
  const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function kodUret(adet){const L=new Set();while(L.size<adet){const b=crypto.getRandomValues(new Uint8Array(50));let s='';for(let i=0;i<50;i++)s+=KOD_ALFABE[b[i]&31];L.add(s);}return [...L];}
const kodGrupla=k=>k.match(/.{5}/g).join('-');

/* ================= durum ================= */
const st={ekran:'giris',tab:'pano',users:[],dash:null,pays:[],batches:[],ayar:null,log:[],ofisler:[],yuk:false,hata:'',
  q:'',durum:'',sira:'yeni',pf:{aralik:'yil',bas:'',bit:'',durum:''},acik:null,uye:null,sonKod:null,kilitZaman:0};
const uyeAd=u=>{const r=u.reg||{},f=u.fatura||{};return f.unvan||r.buro||'';};
const bul=id=>st.users.find(u=>u.id===id);
function ms(u){
  const L=Object.values(u.modules||{}).filter(x=>x&&x.active!==false&&x.type!=='soon');
  if(!L.length)return {valid:u.valid,type:u.type,daysLeft:u.daysLeft,expires:u.expires,license_end:u.license_end,trial_end:u.trial_end};
  const en=a=>a.sort((x,y)=>(y.daysLeft||0)-(x.daysLeft||0))[0];
  return en(L.filter(x=>x.valid&&x.type==='pool'))||en(L.filter(x=>x.valid))||L.find(x=>x.type==='disabled')||en(L.filter(x=>x.type==='pool'&&x.expired))||L.find(x=>x.trialExpired)||L.find(x=>x.trialAvailable)||L[0];}
function durum(u){
  if(u.disabled)return 'kapali';const x=ms(u);
  if(x.type==='soon')return 'yok';if(x.valid&&x.type==='pool')return 'lisansli';if(x.valid)return 'deneme';if(x.trialAvailable)return 'kullanmadi';return 'doldu';}
const DURUM={lisansli:['iyi','lisanslı'],deneme:['uyar','deneme'],doldu:['kotu','süresi doldu'],kullanmadi:['','kullanmadı'],kapali:['kotu','kapalı'],yok:['','—']};
function chip(u,uzun){const d=durum(u);const [c,t]=DURUM[d];const x=ms(u);return `<span class="chip ${c}">${esc(t+(uzun&&(d==='lisansli'||d==='deneme')?' · '+x.daysLeft+' gün':''))}</span>`;}
const bitecek=u=>{if(u.disabled)return false;const x=ms(u);return x.valid&&x.type==='pool'&&x.daysLeft<=30;};
const bitisOf=u=>{const x=ms(u);const e=x.type==='pool'?x.license_end:x.trial_end;return e?new Date(e).getTime():9e15;};

/* ================= arayüz yardımcıları ================= */
let toastT=null;
function toast(m){let t=$('.toast');if(!t){t=document.createElement('div');t.className='toast';t.setAttribute('role','status');document.body.appendChild(t);}
  t.textContent=m;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>{t.hidden=true;},2800);}
function levha(html){
  return new Promise(res=>{const K=$('#katman');K.innerHTML=`<div class="perde" data-perde="1"><div class="levha" role="dialog" aria-modal="true">${html}</div></div>`;
    const bitir=v=>{K.innerHTML='';res(v);};
    K.querySelector('[data-perde]').addEventListener('click',e=>{if(e.target.dataset.perde)bitir(null);const b=e.target.closest('[data-sec]');if(b){
      const g=K.querySelector('[data-girdi]');bitir(b.dataset.sec==='__iptal'?null:b.dataset.sec==='__tamam'?(g?g.value:true):b.dataset.sec);}});
    const g=K.querySelector('[data-girdi]');if(g){g.addEventListener('keydown',e=>{if(e.key==='Enter'&&g.tagName!=='TEXTAREA'){e.preventDefault();bitir(g.value);}});setTimeout(()=>g.focus(),60);}
  });
}
const sec=(baslik,metin,ops)=>levha(`<h3>${esc(baslik)}</h3>${metin?`<p>${esc(metin)}</p>`:''}<div class="secenek">${ops.map(o=>`<button class="btn tam${o.ana?' ana':''}${o.tehlike?' tehlike':''}" data-sec="${esc(o.deger)}">${esc(o.ad)}</button>`).join('')}<button class="btn tam" data-sec="__iptal">Vazgeç</button></div>`);
const onayla=(baslik,metin,evet,tehlike)=>levha(`<h3>${esc(baslik)}</h3><p>${esc(metin)}</p><div class="secenek"><button class="btn tam ${tehlike===false?'ana':'tehlike'}" data-sec="__tamam">${esc(evet)}</button><button class="btn tam" data-sec="__iptal">Vazgeç</button></div>`).then(v=>v===true);
const yaziSor=(baslik,metin,def,evet,tur)=>levha(`<h3>${esc(baslik)}</h3><p>${esc(metin)}</p><input data-girdi="1" type="${tur||'text'}" value="${esc(def||'')}"${tur==='number'?' inputmode="numeric"':''}><div class="secenek"><button class="btn tam ana" data-sec="__tamam">${esc(evet)}</button><button class="btn tam" data-sec="__iptal">Vazgeç</button></div>`).then(v=>v===null?null:String(v));
const hataMetni=e=>String(e&&e.message||e);

/* ================= giriş ================= */
function girisCiz(hata){
  st.ekran='giris';document.body.className='giris';
  $('#kok').innerHTML=`<div class="giris-kutu"><div class="logo"><img src="apple-touch-icon.png" alt=""><div><h1>MuhaWin Yönetim</h1><div class="not">Üyeler · satışlar · lisanslar</div></div></div>
    ${hata?`<div class="hata">${esc(hata)}</div>`:''}
    <form id="girisF" autocomplete="on"><label for="gE">E-posta</label><input id="gE" type="email" autocomplete="username" value="${esc(SAHIP)}" autocapitalize="off">
    <label for="gS">Şifre</label><input id="gS" type="password" autocomplete="current-password">
    <div style="margin-top:16px"><button class="btn ana tam" id="gB" type="submit">Giriş yap</button></div></form>
    <p class="not" style="margin-top:16px">MuhaWin programındaki hesap şifrenizle girin. Bu panel yalnız ${esc(SAHIP)} hesabıyla açılır.</p></div>`;
  $('#girisF').addEventListener('submit',async e=>{e.preventDefault();const email=$('#gE').value.trim().toLowerCase(),sifre=$('#gS').value;
    if(email!==SAHIP){girisCiz('Bu panel yalnız '+SAHIP+' hesabıyla kullanılabilir.');return;}
    if(!sifre){$('#gS').focus();return;}
    $('#gB').disabled=true;$('#gB').textContent='Giriş yapılıyor…';
    try{const j=await istek('/auth/v1/token?grant_type=password',{govde:{email,password:sifre}});oturumKur(j,email);pinCiz();}
    catch(x){girisCiz(hataMetni(x));}});
}
function pinCiz(hata){
  st.ekran='pin';document.body.className='giris';
  $('#kok').innerHTML=`<div class="giris-kutu"><div class="logo"><img src="apple-touch-icon.png" alt=""><div><h1>Yönetim şifresi</h1><div class="not">${esc(oturum?oturum.email:'')}</div></div></div>
    ${hata?`<div class="hata">${esc(hata)}</div>`:''}
    <form id="pinF"><label for="pP">Programdaki yönetim şifresi</label><input id="pP" class="pin" type="password" inputmode="numeric" autocomplete="off">
    <div style="margin-top:16px"><button class="btn ana tam" id="pB" type="submit">Aç</button></div></form>
    <div style="margin-top:12px"><button class="btn tam" id="pX">Çıkış yap</button></div></div>`;
  setTimeout(()=>{const i=$('#pP');if(i)i.focus();},60);
  $('#pX').onclick=()=>cikis();
  $('#pinF').addEventListener('submit',async e=>{e.preventDefault();const pin=$('#pP').value;if(!pin)return;$('#pB').disabled=true;
    try{const r=await call('admin_pin_check',{p_pin:pin});
      if(r&&r.ok){st.kilitZaman=Date.now();anaCiz();yukle(['users','dash','ayar']);return;}
      pinCiz((r&&r.reason)||'Şifre hatalı.'+(r&&r.kalan!=null&&r.kalan>=0?' Kalan deneme: '+r.kalan:''));}
    catch(x){if(oturum)pinCiz(hataMetni(x));}});
}
function cikis(sure){oturum=null;LS.yaz(OTURUM_ANAHTAR,null);st.users=[];st.dash=null;st.pays=[];st.uye=null;girisCiz(sure?'Oturum süresi doldu. Yeniden giriş yapın.':'');}
function kilitle(){if(st.ekran==='ana'||st.ekran==='uye'){$('#katman').innerHTML='';pinCiz('Panel kilitlendi. Şifreyi yeniden yazın.');}}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){st.gizlenme=Date.now();return;}
  if(st.gizlenme&&Date.now()-st.gizlenme>KILIT_DK*60e3)kilitle();});

/* ================= yükleme ================= */
async function yukle(neler){
  st.yuk=true;st.hata='';ciz();const K=new Set(neler);
  try{const is=[];
    if(K.has('users'))is.push(call('admin_users').then(x=>{st.users=x||[];}));
    if(K.has('ayar'))is.push(call('admin_settings').then(x=>{st.ayar=x;}));
    if(K.has('dash'))is.push(call('admin_dashboard').then(x=>{st.dash=x;}));
    if(K.has('pays'))is.push(call('admin_payments',payAralik()).then(x=>{st.pays=x||[];}));
    if(K.has('kod'))is.push(call('admin_code_batches').then(x=>{st.batches=x||[];}));
    if(K.has('log'))is.push(call('admin_log_list',{p_limit:300}).then(x=>{st.log=x||[];}));
    if(K.has('ofis'))is.push(call('admin_offices').then(x=>{st.ofisler=x||[];}));
    await Promise.all(is);
  }catch(e){st.hata=hataMetni(e);}
  st.yuk=false;ciz();
}
function payAralik(){const p=st.pf;const y=new Date().getFullYear(),m=new Date().getMonth();
  if(p.aralik==='ay')return {p_from:iso(new Date(y,m,1)),p_to:iso(new Date(y,m+1,0))};
  if(p.aralik==='yil')return {p_from:y+'-01-01',p_to:y+'-12-31'};
  if(p.aralik==='gecenyil')return {p_from:(y-1)+'-01-01',p_to:(y-1)+'-12-31'};
  if(p.aralik==='ozel')return {p_from:p.bas||null,p_to:p.bit||null};
  return {p_from:null,p_to:null};}

/* ================= ana ekran ================= */
const SEKME=[['pano','Pano','▦'],['uyeler','Üyeler','☺'],['satis','Satışlar','₺'],['kod','Kodlar','⚿'],['diger','Diğer','☰']];
const DIGER=[['ofis','Ofisler ve özel çözümler'],['ayar','Ayarlar ve duyuru'],['log','İşlem günlüğü']];
function anaCiz(){
  st.ekran='ana';document.body.className='';
  $('#kok').innerHTML=`<header class="ust"><h1 id="baslik"></h1><button class="ikonbtn" id="yenile" aria-label="Yenile" title="Yenile">⟳</button></header>
    <main id="govde"></main>
    <nav class="alt" id="altnav">${SEKME.map(([k,v,i])=>`<button data-tab="${k}"><b aria-hidden="true">${i}</b>${esc(v)}</button>`).join('')}</nav><div id="uyeSayfa"></div>`;
  ciz();
}
function sekme(t){st.tab=t;window.scrollTo(0,0);
  const gerek={satis:['pays'],kod:['kod'],log:['log'],pano:['dash'],ofis:['ofis']}[t];
  if(gerek)yukle(gerek);else ciz();}
function ciz(){
  if(st.ekran!=='ana'&&st.ekran!=='uye')return;
  const ana=['ofis','ayar','log'].includes(st.tab)?'diger':st.tab;
  document.querySelectorAll('#altnav [data-tab]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.tab===ana)));
  const bas={pano:'Pano',uyeler:'Üyeler',satis:'Satışlar ve tahsilat',kod:'Lisans kodları',diger:'Diğer',ofis:'Ofisler',ayar:'Ayarlar ve duyuru',log:'İşlem günlüğü'}[st.tab];
  $('#baslik').textContent=bas;
  const f={pano,uyeler,satis:satislar,kod:kodlar,diger,ofis:ofisler,ayar:ayarlar,log:gunluk}[st.tab]||pano;
  const ust=(st.hata?`<div class="hata">${esc(st.hata)}</div>`:'')+(st.yuk?'<p class="not">Yükleniyor…</p>':'');
  const odak=document.activeElement&&document.activeElement.id==='uQ'?document.activeElement.selectionStart:null;
  $('#govde').innerHTML=ust+f();
  if(odak!=null){const q=$('#uQ');if(q){q.focus();try{q.setSelectionRange(odak,odak);}catch(e){}}}
  if(st.ekran==='uye'&&st.uye)uyeCiz(st.uye);
}

/* ---- pano ---- */
function pano(){
  const U=st.users,d=st.dash||{};const now=Date.now();
  const kutu=(k,v,f)=>`<button class="kutu" ${f?`data-f="${f}"`:'disabled'}><div class="k">${esc(k)}</div><div class="v">${v}</div></button>`;
  const say=k=>U.filter(u=>durum(u)===k).length;
  const aktif7=d.aktif_7!=null?d.aktif_7:U.filter(u=>u.last_seen&&now-new Date(u.last_seen)<7*864e5).length;
  const ayl=(d.aylik||[]).slice(-12);const mx=Math.max(1,...ayl.map(a=>+a.uye||0)),mt=Math.max(1,...ayl.map(a=>+a.tahsil||0));
  const AY=['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
  const bit=(d.bitecek||[]).slice(0,20);
  const son=(d.son_uyeler||[...U].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,8));
  return `<div class="kutular">${kutu('Üye',U.length,'tum')}${kutu('Bu ay yeni',d.yeni_ay??'—','yeni')}${kutu('Son 7 gün aktif',aktif7,'aktif')}${kutu('30 günde bitecek',U.filter(bitecek).length,'bitecek')}
      ${kutu('Lisanslı',say('lisansli'),'lisansli')}${kutu('Denemede',say('deneme'),'deneme')}${kutu('Süresi doldu',say('doldu'),'doldu')}${kutu('Doğrulanmamış',U.filter(u=>u.confirmed===false).length,'dogrulanmamis')}
      ${kutu('Tahsilat · bu ay',tl(d.tahsil_ay)+' ₺','')}${kutu('Bekleyen tahsilat',tl(d.bekleyen)+' ₺','odeme')}</div>
    <div class="kart"><h2>Son üyeler</h2>${son.map(x=>`<div class="sat"><button class="lnk" data-u="${esc(x.id)}">${esc(x.buro||(x.reg||{}).buro||x.email)}</button><span class="not">${trD(x.created_at)}</span></div>`).join('')||'<p class="not">Yok.</p>'}</div>
    <div class="kart"><h2>30 gün içinde bitecek lisanslar</h2>${bit.map(b=>`<div class="sat"><span><button class="lnk" data-u="${esc(b.user_id)}">${esc(b.buro||b.email)}</button><br><span class="not">${trD(b.ends_at)}</span></span><button class="btn kucuk" data-satis="${esc(b.user_id)}">Uzat / sat</button></div>`).join('')||'<p class="not">Yok.</p>'}</div>
    ${ayl.length?`<div class="kart"><h2>Son 12 ay</h2><div class="cubuk">${ayl.map(a=>{const [,m]=String(a.ay).split('-');return `<div class="c" title="${esc(a.uye+' üye · '+tl(a.tahsil)+' ₺')}"><div class="ikili"><i class="u" style="height:${Math.round(100*(+a.uye||0)/mx)}%"></i><i class="t" style="height:${Math.round(100*(+a.tahsil||0)/mt)}%"></i></div><span>${AY[+m-1]||''}</span></div>`;}).join('')}</div>
      <p class="not" style="margin:6px 0 0"><span class="lej" style="background:var(--vurgu);margin-left:0"></span>yeni üye<span class="lej" style="background:var(--iyi)"></span>tahsilat</p></div>`:''}
    ${d.surumler&&Object.keys(d.surumler).length?`<div class="kart"><h2>Kullanılan sürümler <span class="not">(30 gün)</span></h2>${Object.entries(d.surumler).sort((a,b)=>String(b[0]).localeCompare(String(a[0]),'tr',{numeric:true})).map(([v,n])=>`<div class="sat"><span class="mono">${esc(v)}</span><b>${n}</b></div>`).join('')}</div>`:''}`;
}

/* ---- üyeler ---- */
function suzulmus(){
  const q=N(st.q);const now=Date.now();
  const L=st.users.filter(u=>{
    if(q){const r=u.reg||{},f=u.fatura||{};if(!N([u.email,r.buro,r.yetkili,r.telefon,r.vkn,f.unvan,f.vkn,u.admin_note,(u.office||{}).name].join(' ')).includes(q))return false;}
    const d=st.durum;if(!d||d==='tum')return true;
    if(d==='bitecek')return bitecek(u);if(d==='dogrulanmamis')return u.confirmed===false;if(d==='kapali')return !!u.disabled;
    if(d==='aktif')return u.last_seen&&now-new Date(u.last_seen)<7*864e5;
    if(d==='yeni'){const a=new Date();return new Date(u.created_at)>=new Date(a.getFullYear(),a.getMonth(),1);}
    if(d==='odeme')return +u.due>0;if(d==='ofis')return !!u.office;
    return durum(u)===d;});
  const S={yeni:(a,b)=>String(b.created_at).localeCompare(String(a.created_at)),giris:(a,b)=>String(b.last_seen||'').localeCompare(String(a.last_seen||'')),
    ad:(a,b)=>String(uyeAd(a)||a.email).localeCompare(String(uyeAd(b)||b.email),'tr'),bitis:(a,b)=>bitisOf(a)-bitisOf(b)};
  return L.sort(S[st.sira]||S.yeni);
}
const opt=(v,t,c)=>`<option value="${esc(v)}"${String(c)===String(v)?' selected':''}>${esc(t)}</option>`;
function uyeler(){
  const L=suzulmus();
  return `<div class="filtre"><input class="tam" type="search" id="uQ" placeholder="Ara: e-posta, büro, VKN, telefon" value="${esc(st.q)}" autocapitalize="off">
      <select id="uD" aria-label="Durum">${[['','Tüm üyeler'],['yeni','Bu ay üye olan'],['lisansli','Lisanslı'],['deneme','Denemede'],['doldu','Süresi doldu'],['kullanmadi','Hiç açmadı'],['bitecek','30 günde bitecek'],['odeme','Ödemesi bekleyen'],['aktif','Son 7 gün aktif'],['ofis','Ofise bağlı'],['dogrulanmamis','Doğrulanmamış'],['kapali','Kapalı hesap']].map(([v,t])=>opt(v,t,st.durum)).join('')}</select>
      <select id="uS" aria-label="Sıralama">${[['yeni','Yeni üye önce'],['giris','Son giriş'],['ad','Ada göre'],['bitis','Bitişi yakın']].map(([v,t])=>opt(v,t,st.sira)).join('')}</select></div>
    <div class="dugmeler" style="margin:0 0 10px;align-items:center"><span class="not" style="flex:1">${L.length} üye</span><button class="btn kucuk" id="uMail">E-postaları kopyala</button><button class="btn kucuk ana" data-satis="">+ Satış</button></div>
    <div class="liste">${L.slice(0,400).map(u=>{const r=u.reg||{};return `<button class="satir${u.disabled?' kapali':''}" data-u="${esc(u.id)}"><div class="bas"><span class="ad">${esc(uyeAd(u)||u.email||'(adsız)')}</span>${chip(u,true)}</div>
      <div class="alt">${esc(u.email||'')}${r.telefon?' · '+esc(r.telefon):''}</div>
      <div class="alt">Üyelik ${trD(u.created_at)} · son giriş ${trD(u.last_seen)}${u.office?' · '+esc(u.office.name):''}${u.confirmed===false?' · <b style="color:var(--uyar)">doğrulanmadı</b>':''}${+u.due?' · <b style="color:var(--kotu)">'+tl(u.due)+' ₺ bekliyor</b>':''}</div></button>`;}).join('')||'<p class="not">Üye yok.</p>'}</div>
    ${L.length>400?'<p class="not">İlk 400 üye gösteriliyor; aramayı daraltın.</p>':''}`;
}

/* ---- üye ayrıntısı (tam ekran) ---- */
const FATURA=[['unvan','Unvan / ad soyad'],['vkn','VKN / TCKN'],['vd','Vergi dairesi'],['adres','Adres'],['il','İl'],['ilce','İlçe'],['eposta','Fatura e-postası'],['telefon','Telefon']];
function faturaVarsayilan(u){const r=u.reg||{},f=u.fatura||{};
  return {unvan:f.unvan??r.buro??'',vkn:f.vkn??r.vkn??'',vd:f.vd??r.vd??'',adres:f.adres??r.adres??'',il:f.il??r.il??'',ilce:f.ilce??'',eposta:f.eposta??r.eposta??u.email??'',telefon:f.telefon??r.telefon??'',efatura:f.efatura??''};}
async function uyeAc(id){
  st.acik=id;st.ekran='uye';let u=bul(id)||{id};st.uye=u;uyeCiz(u,true);
  try{const d=await call('admin_user_detail',{p_user:id});u={...u,...d};const i=st.users.findIndex(x=>x.id===id);if(i>=0)st.users[i]={...st.users[i],...d};}
  catch(e){toast(hataMetni(e));}
  if(st.acik!==id)return;st.uye=u;uyeCiz(u);
}
function uyeKapat(){st.acik=null;st.uye=null;st.ekran='ana';$('#uyeSayfa').innerHTML='';ciz();}
function uyeCiz(u,yukleniyor){
  const r=u.reg||{};const fv=faturaVarsayilan(u);const x=ms(u);const e=x.type==='pool'?x.license_end:x.trial_end;const o=u.office_detail||u.office;
  const tel=String(r.telefon||'').replace(/[^\d+]/g,'');
  $('#uyeSayfa').innerHTML=`<div class="sayfa" id="uyeS"><header class="ust"><button class="ikonbtn" id="uGeri" aria-label="Geri">‹</button><h1>${esc(uyeAd(u)||u.email||'Üye')}</h1></header><main>
    ${yukleniyor?'<p class="not">Yükleniyor…</p>':''}
    <div class="kart"><div class="sat"><b style="overflow-wrap:anywhere">${esc(u.email||'')}</b>${chip(u,true)}</div>
      <div class="not">Üyelik ${trD(u.created_at)} · son giriş ${trDT(u.last_seen)} · sürüm ${esc(u.app_version||'—')} · ${u.devices||0} bilgisayar</div>
      ${u.confirmed===false?'<div class="bilgi" style="margin:8px 0 0">E-posta adresi doğrulanmadı; üye e-postasındaki kodu girmeden programa giremez.</div>':''}
      ${u.disabled?`<div class="hata" style="margin:8px 0 0">Hesap kapalı${u.note?': '+esc(u.note):''}</div>`:''}
      <div class="dugmeler"><a class="btn kucuk" href="mailto:${esc(u.email||'')}?subject=MuhaWin">E-posta</a>${tel?`<a class="btn kucuk" href="tel:${esc(tel)}">Ara</a><a class="btn kucuk" href="https://wa.me/${esc(tel.replace(/^\+/,'').replace(/^0/,'90'))}">WhatsApp</a>`:''}<button class="btn kucuk ana" data-satis="${esc(u.id)}">+ Satış / lisans</button></div></div>
    <div class="kart"><h2>MuhaWin lisansı <span class="not">— tüm modülleri açar</span></h2>
      <div class="sat"><span>Durum</span>${chip(u,true)}</div><div class="sat"><span>Bitiş</span><span class="mono">${trD(x.expires||e)}</span></div>
      <div class="dugmeler"><button class="btn kucuk" data-i="trial">Deneme</button><button class="btn kucuk ana" data-i="grant">Lisans ver</button><button class="btn kucuk" data-i="bitis">Bitiş tarihi</button><button class="btn kucuk tehlike" data-i="end">Bitir</button></div>
      ${(u.licenses||[]).length?`<details><summary>Lisans geçmişi (${u.licenses.length})</summary>${u.licenses.map(l=>`<div class="sat"><span>${l.source==='kod'?'lisans kodu':'yönetici'}${l.note?' · '+esc(l.note):''}</span><span class="mono not">${trD(l.starts_at)} – ${trD(l.ends_at)}</span></div>`).join('')}</details>`:''}</div>
    ${o&&o.name?`<div class="kart"><h2>Ofis</h2><div class="sat"><span>${esc(o.name)}</span><span class="not">Luca üye no ${esc(o.luca_uye_no||'—')}</span></div>${o.owner_email?`<div class="not">Sahibi: ${esc(o.owner_email)}</div>`:''}
      ${o.id?`<div style="margin-top:6px">${OZEL.map(z=>`<label class="onay"><input type="checkbox" data-oz="${esc(o.id)}" value="${z.id}"${(o.ozel||[]).includes(z.id)?' checked':''}> ${esc(z.ad)}</label>`).join('')}</div>`:''}
      ${u.office_detail&&(u.office_detail.members||[]).length>1?`<details><summary>Ofis üyeleri (${u.office_detail.members.length})</summary>${u.office_detail.members.map(m=>`<div class="sat"><button class="lnk" data-u="${esc(m.user_id)}">${esc(m.email)}</button><span class="not">${m.is_owner?'sahibi':m.role==='yonetici'?'yönetici':'çalışan'}</span></div>`).join('')}</details>`:''}</div>`:''}
    <div class="kart"><h2>Satışlar ve tahsilat</h2>${(u.payments||[]).length?satisListe(u.payments,true):'<p class="not">Satış kaydı yok.</p>'}</div>
    <div class="kart"><h2>Fatura bilgileri</h2>${FATURA.map(([k,l])=>`<label for="f_${k}">${esc(l)}</label><input id="f_${k}" value="${esc(fv[k]||'')}">`).join('')}
      <label for="f_efatura">e-Fatura mükellefi</label><select id="f_efatura">${opt('','—',fv.efatura)}${opt('evet','Evet (e-Fatura)',fv.efatura)}${opt('hayir','Hayır (e-Arşiv)',fv.efatura)}</select>
      <label for="f_not">Yönetici notu (yalnız siz görürsünüz)</label><textarea id="f_not" rows="2">${esc(u.admin_note||'')}</textarea>
      <div class="dugmeler"><button class="btn ana" data-i="kaydet">Kaydet</button><button class="btn" data-i="kopyala">Kopyala</button></div>
      <details><summary>Üyenin girdiği büro bilgileri</summary>${[['buro','Büro'],['yetkili','Yetkili'],['telefon','Telefon'],['eposta','E-posta'],['vd','Vergi dairesi'],['vkn','VKN/TCKN'],['adres','Adres'],['il','İl']].map(([k,l])=>`<div class="sat"><span class="not">${l}</span><span class="sag">${esc(r[k]||'—')}</span></div>`).join('')}</details></div>
    <div class="kart"><h2>Bilgisayarlar</h2>${(u.device_list||[]).map(d=>`<div class="sat"><span>${esc(d.name||'(adsız)')}<br><span class="not">son giriş ${trDT(d.last_seen)}</span></span><button class="btn kucuk tehlike" data-i="pcsil" data-pc="${esc(d.device_id)}">Sil</button></div>`).join('')||`<p class="not">${u.devices?u.devices+' bilgisayar kayıtlı.':'Kayıtlı bilgisayar yok.'}</p>`}
      <div class="dugmeler"><button class="btn kucuk" data-i="dev">Tüm bilgisayarları sıfırla</button></div></div>
    ${(u.log||[]).length?`<div class="kart"><h2>İşlem geçmişi</h2>${u.log.slice(0,30).map(g=>`<div class="sat"><span>${esc(EYLEM[g.action]||g.action)}<br><span class="not">${esc(detayMetin(g.detail))}</span></span><span class="not mono">${trDT(g.at)}</span></div>`).join('')}</div>`:''}
    <div class="kart"><h2>Hesap</h2><p class="not" style="margin:0">Kapatılan hesap programa giremez. Silme geri alınamaz (satış kayıtları e-postasıyla kalır).</p>
      <div class="dugmeler"><button class="btn${u.disabled?' ana':' tehlike'}" data-i="dis">${u.disabled?'Hesabı aç':'Hesabı kapat'}</button><button class="btn tehlike" data-i="sil">Üyeliği sil…</button></div></div>
  </main></div>`;
}
function detayMetin(d){if(!d)return '';const p=[];if(d.modul)p.push(mad(d.modul));if(d.ofis)p.push(d.ofis);if(d.ozel)p.push((d.ozel||[]).map(x=>(OZEL.find(o=>o.id===x)||{ad:x}).ad).join(', ')||'özel çözüm kaldırıldı');if(d.gun)p.push(d.gun+' gün');if(d.tarih)p.push(trD(d.tarih));if(d.tutar!=null)p.push(tl(d.tutar)+' ₺');if(d.adet!=null)p.push(d.adet+' kod');if(d.parti)p.push(d.parti);if(d.pc)p.push(d.pc);if(d.not)p.push(d.not);if(d.durum)p.push(d.durum);if(d.email)p.push(d.email);return p.join(' · ');}
function formFatura(){const f={};FATURA.forEach(([k])=>{const el=$('#f_'+k);if(el)f[k]=el.value.trim();});f.efatura=$('#f_efatura').value;return f;}
async function uyeIslem(k,b){
  const id=st.acik;const u=st.uye||bul(id)||{};const m=LISANS;
  const yenile=async()=>{await yukle(['users']);if(st.acik===id)await uyeAc(id);};
  try{
    if(k==='kopyala'){const f=formFatura();const t=[f.unvan,f.vkn?'VKN/TCKN: '+f.vkn:'',f.vd?'Vergi dairesi: '+f.vd:'',[f.adres,f.ilce,f.il].filter(Boolean).join(' '),f.eposta?'E-posta: '+f.eposta:'',f.telefon?'Tel: '+f.telefon:''].filter(Boolean).join('\n');
      try{await navigator.clipboard.writeText(t);toast('Fatura bilgileri kopyalandı.');}catch(x){toast('Kopyalanamadı.');}return;}
    if(k==='kaydet'){const r=await call('admin_user_update',{p_user:id,p_fatura:formFatura(),p_admin_note:$('#f_not').value.trim()});const i=st.users.findIndex(x=>x.id===id);if(i>=0)st.users[i]={...st.users[i],...r};st.uye={...u,...r};toast('Üye bilgileri kaydedildi.');return;}
    if(k==='trial'){const v=await sec('Deneme süresi',u.email+'\nBugünden itibaren kaç gün?',[{ad:'7 gün',deger:'7'},{ad:'14 gün',deger:'14'},{ad:'30 gün',deger:'30',ana:true},{ad:'Denemeyi bitir',deger:'0',tehlike:true}]);if(v==null)return;
      await call('admin_set_trial',{p_user:id,p_days_from_now:+v,p_module:m});}
    else if(k==='grant'){let v=await sec('Lisans ver',u.email+'\nMevcut süreye eklenir. Ücretli satışsa "+ Satış / lisans" ile kaydedin.',[{ad:'1 yıl',deger:'365',ana:true},{ad:'6 ay',deger:'182'},{ad:'3 ay',deger:'91'},{ad:'1 ay',deger:'30'},{ad:'Başka…',deger:'x'}]);if(v==null)return;
      if(v==='x'){const t=await yaziSor('Lisans ver','Kaç gün eklensin?','365','Devam','number');if(t==null)return;v=parseInt(t,10);if(!(v>0)){toast('Geçerli bir gün sayısı yazın.');return;}}
      const not=await yaziSor('Lisans notu','İsteğe bağlı (ör. hediye, kampanya)','yönetici','Lisansı ver');if(not==null)return;
      await call('admin_grant',{p_user:id,p_days:+v,p_note:not||'yönetici',p_module:m});}
    else if(k==='bitis'){const x=ms(u);const e=(x.type==='pool'?x.license_end:null)||'';const t=await yaziSor('Bitiş tarihi','Lisans bu tarihin sonunda biter (kısaltır ya da uzatır).',e?iso(e):iso(Date.now()+365*864e5),'Kaydet','date');if(!t)return;
      await call('admin_set_license_end',{p_user:id,p_module:m,p_end:t});}
    else if(k==='end'){if(!(await onayla('Lisans bitirilsin mi?',u.email+' kullanıcısının lisansı bugün itibarıyla sona erecek.','Evet, bitir')))return;await call('admin_end_license',{p_user:id,p_module:m});}
    else if(k==='dev'){if(!(await onayla('Bilgisayarlar sıfırlansın mı?','Kayıtlı tüm bilgisayarlar silinir; üye yeniden girdiğinde yeni bilgisayar kaydedilir.','Evet, sıfırla')))return;await call('admin_reset_devices',{p_user:id});}
    else if(k==='pcsil'){if(!(await onayla('Bilgisayar silinsin mi?','Üye bu bilgisayardan yeniden girerse tekrar kaydedilir.','Sil')))return;await call('admin_remove_device',{p_user:id,p_device:b.dataset.pc});}
    else if(k==='dis'){let not=null;if(!u.disabled){not=await yaziSor('Hesap kapatılsın mı?',u.email+' programa giremeyecek. Üyeye gösterilecek not (isteğe bağlı):','','Hesabı kapat');if(not==null)return;}
      await call('admin_set_disabled',{p_user:id,p_disabled:!u.disabled,p_note:not||null});}
    else if(k==='sil'){const t=await yaziSor('Üyelik silinsin mi? (geri alınamaz)','Onay için üyenin e-posta adresini yazın:\n'+u.email,'','Üyeliği sil','email');if(t==null)return;
      await call('admin_user_delete',{p_user:id,p_confirm_email:t.trim()});toast(u.email+' üyeliği silindi.');uyeKapat();await yukle(['users','dash']);return;}
    else return;
    toast('Güncellendi.');await yenile();
  }catch(x){toast(hataMetni(x));}
}

/* ---- satışlar ---- */
function satisListe(L,uyeIci){
  return `<div class="liste">${L.map(p=>{const top=toplam(p);const dc=p.durum==='odendi'?'iyi':p.durum==='iptal'?'':'uyar';const dt={odendi:'tahsil edildi',bekliyor:'bekliyor',iptal:'iptal'}[p.durum]||p.durum;
    return `<div class="satir" style="cursor:default"><div class="bas"><span class="ad">${uyeIci?esc(p.fatura_no||'Fatura numarasız'):(p.user_id?`<button class="lnk" data-u="${esc(p.user_id)}">${esc(p.buro||p.cur_email||p.email||'')}</button>`:esc(p.email||'(silinmiş üye)'))}</span><b class="mono">${tl(top)} ₺</b></div>
      <div class="alt">${trD(p.fatura_tarihi||p.created_at)}${uyeIci?'':' · '+esc(p.fatura_no||'fatura no yok')} · ${p.days} gün · KDV %${+p.kdv_orani} · <span class="chip ${dc}">${esc(dt)}</span>${p.odeme_tarihi?' · ödeme '+trD(p.odeme_tarihi):''}${p.yontem?' · '+esc(p.yontem):''}</div>
      ${p.note?`<div class="alt">${esc(p.note)}</div>`:''}
      <div class="dugmeler">${p.durum==='bekliyor'?`<button class="btn kucuk ana" data-p="odendi" data-id="${p.id}">Tahsil edildi</button>`:''}<button class="btn kucuk" data-p="duzelt" data-id="${p.id}">Düzelt</button><button class="btn kucuk tehlike" data-p="sil" data-id="${p.id}">Sil</button></div></div>`;}).join('')||'<p class="not">Kayıt yok.</p>'}</div>`;
}
function satislar(){
  const p=st.pf;const L=st.pays.filter(x=>!p.durum||x.durum===p.durum);const g=L.filter(x=>x.durum!=='iptal');
  const net=r2(g.reduce((s,x)=>s+(+x.tutar||0),0)),top=r2(g.reduce((s,x)=>s+toplam(x),0));
  const tah=r2(g.filter(x=>x.durum==='odendi').reduce((s,x)=>s+toplam(x),0)),bek=r2(g.filter(x=>x.durum==='bekliyor').reduce((s,x)=>s+toplam(x),0));
  return `<div class="filtre"><select id="pA" aria-label="Dönem">${[['ay','Bu ay'],['yil','Bu yıl'],['gecenyil','Geçen yıl'],['tum','Tümü'],['ozel','Tarih aralığı']].map(([v,t])=>opt(v,t,p.aralik)).join('')}</select>
      <select id="pD" aria-label="Durum">${[['','Tüm durumlar'],['bekliyor','Bekleyen'],['odendi','Tahsil edilen'],['iptal','İptal']].map(([v,t])=>opt(v,t,p.durum)).join('')}</select>
      ${p.aralik==='ozel'?`<input type="date" id="pB" value="${esc(p.bas)}" aria-label="Başlangıç"><input type="date" id="pE" value="${esc(p.bit)}" aria-label="Bitiş">`:''}</div>
    <div class="kutular"><div class="kutu"><div class="k">Satış (KDV hariç)</div><div class="v">${tl(net)}</div></div><div class="kutu"><div class="k">Toplam (KDV dahil)</div><div class="v">${tl(top)}</div></div>
      <div class="kutu"><div class="k">Tahsil edilen</div><div class="v">${tl(tah)}</div></div><div class="kutu"><div class="k">Bekleyen</div><div class="v">${tl(bek)}</div></div></div>
    <div class="dugmeler" style="margin:0 0 10px"><span class="not" style="flex:1;align-self:center">${L.length} kayıt · tutarlar ₺</span><button class="btn ana" data-satis="">+ Satış / lisans</button></div>
    ${satisListe(L,false)}`;
}
function uyeBul(v){const q=String(v||'').trim().toLowerCase();if(!q)return null;
  return st.users.find(x=>String(x.email).toLowerCase()===q)||(st.users.filter(x=>N(uyeAd(x))===N(v)).length===1?st.users.find(x=>N(uyeAd(x))===N(v)):null);}
function satisForm(on){
  const fy=(st.ayar||{}).fiyatlar||{};const yeni=!on||!on.id;
  const p={user_id:'',module:LISANS,days:365,kdv_orani:20,durum:'bekliyor',fatura_tarihi:bugun(),yontem:YONTEM[0],lisans_ver:true,...(on||{})};
  if(yeni&&p.tutar==null&&fy[LISANS]!=null)p.tutar=fy[LISANS];
  const u=p.user_id?bul(p.user_id):null;
  const K=$('#katman');
  K.innerHTML=`<div class="sayfa" style="z-index:50"><header class="ust"><button class="ikonbtn" data-sf="vaz" aria-label="Kapat">✕</button><h1>${yeni?'Satış / lisans kaydı':'Satışı düzelt'}</h1></header><main>
    <div class="kart">
      <label for="sU">Üye</label>${yeni?`<input id="sU" list="sUL" placeholder="e-posta ya da büro adı" value="${esc(u?u.email:'')}" autocomplete="off" autocapitalize="off"><datalist id="sUL">${st.users.map(x=>`<option value="${esc(x.email)}">${esc(uyeAd(x))}</option>`).join('')}</datalist>`:`<div><b>${esc(u?u.email:(p.email||''))}</b></div>`}<div class="not" id="sUN">${u?esc(uyeAd(u)):''}</div>
      <label for="sG">Süre (gün)</label><select id="sGs">${[['365','1 yıl'],['182','6 ay'],['91','3 ay'],['30','1 ay'],['x','Başka']].map(([v,t])=>opt(v,t,['365','182','91','30'].includes(String(p.days))?String(p.days):'x')).join('')}</select>
      <input id="sG" type="number" inputmode="numeric" min="1" max="3660" value="${esc(p.days)}" style="margin-top:6px" aria-label="Gün">
      <label for="sT">Tutar (KDV hariç, ₺)</label><input id="sT" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(p.tutar??'')}">
      <label for="sK">KDV</label><select id="sK">${[20,10,1,0].map(v=>opt(v,'%'+v,+p.kdv_orani)).join('')}</select>
      <div class="sat" style="margin-top:8px"><span>Toplam</span><b id="sTop" class="mono">—</b></div>
      <label for="sFN">Fatura no</label><input id="sFN" value="${esc(p.fatura_no||'')}" autocapitalize="characters">
      <label for="sFT">Fatura tarihi</label><input id="sFT" type="date" value="${esc(p.fatura_tarihi||'')}">
      <label for="sD">Durum</label><select id="sD">${opt('bekliyor','Ödeme bekleniyor',p.durum)}${opt('odendi','Tahsil edildi',p.durum)}${opt('iptal','İptal',p.durum)}</select>
      <label for="sOT">Ödeme tarihi</label><input id="sOT" type="date" value="${esc(p.odeme_tarihi||'')}">
      <label for="sY">Ödeme yöntemi</label><select id="sY">${YONTEM.map(v=>opt(v,v,p.yontem)).join('')}</select>
      <label for="sN">Not</label><input id="sN" value="${esc(p.note||'')}">
      ${yeni?`<label class="onay"><input type="checkbox" id="sL"${p.lisans_ver?' checked':''}> Lisansı şimdi tanımla (mevcut süreye <span id="sLG">${esc(p.days)}</span> gün eklenir)</label>`:`<p class="not">${p.license_id?'Bu satışla lisans tanımlandı. Süreyi değiştirmek için üyenin sayfasında "Bitiş tarihi"ni kullanın.':'Bu satışla lisans tanımlanmamış.'}</p>`}
      <div class="hata" id="sE" hidden></div>
      <div class="dugmeler"><button class="btn ana tam" data-sf="kaydet">${yeni?'Kaydet':'Değişiklikleri kaydet'}</button></div></div></main></div>`;
  const hesap=()=>{const t=+$('#sT').value||0,k=+$('#sK').value||0;$('#sTop').textContent=tl(r2(t*(1+k/100)))+' ₺';const g=$('#sLG');if(g)g.textContent=$('#sG').value||'?';};
  ['#sT','#sK','#sG'].forEach(s=>$(s).addEventListener('input',hesap));hesap();
  $('#sGs').addEventListener('change',()=>{const v=$('#sGs').value;if(v!=='x')$('#sG').value=v;else $('#sG').focus();hesap();});
  $('#sG').addEventListener('input',()=>{const v=$('#sG').value;$('#sGs').value=['365','182','91','30'].includes(v)?v:'x';});
  $('#sD').addEventListener('change',()=>{if($('#sD').value==='odendi'&&!$('#sOT').value)$('#sOT').value=bugun();});
  const su=$('#sU');if(su)su.addEventListener('input',()=>{const x=uyeBul(su.value);$('#sUN').textContent=x?uyeAd(x)||x.email:'';});
  K.firstChild.addEventListener('click',async e=>{const b=e.target.closest('[data-sf]');if(!b)return;
    if(b.dataset.sf==='vaz'){K.innerHTML='';return;}
    const err=$('#sE');err.hidden=true;const hata=m=>{err.textContent=m;err.hidden=false;err.scrollIntoView({block:'center'});};
    const uu=yeni?uyeBul(su.value):u;if(yeni&&!uu){hata('Listeden bir üye seçin (e-posta adresini tam yazın).');return;}
    const g=parseInt($('#sG').value,10);if(!(g>0&&g<=3660)){hata('Süre 1–3660 gün olmalı.');return;}
    const kayit={id:p.id||null,user_id:uu?uu.id:p.user_id,module:p.module||LISANS,days:g,tutar:$('#sT').value||'0',kdv_orani:$('#sK').value,
      fatura_no:$('#sFN').value.trim(),fatura_tarihi:$('#sFT').value,durum:$('#sD').value,odeme_tarihi:$('#sOT').value,yontem:$('#sY').value,note:$('#sN').value.trim(),
      lisans_ver:yeni&&$('#sL').checked};
    b.disabled=true;
    try{await call('admin_payment_save',{p:kayit});K.innerHTML='';
      toast(yeni?(kayit.lisans_ver?'Satış kaydedildi ve lisans tanımlandı.':'Satış kaydedildi.'):'Satış kaydı güncellendi.');
      await yukle(['users','dash','pays']);if(st.acik)await uyeAc(st.acik);}
    catch(x){hata(hataMetni(x));b.disabled=false;}});
}
async function satisIslem(k,id){
  const p=st.pays.find(x=>String(x.id)===String(id))||((st.uye||{}).payments||[]).find(x=>String(x.id)===String(id));if(!p)return;
  try{
    if(k==='duzelt'){satisForm(p);return;}
    if(k==='odendi'){await call('admin_payment_save',{p:{...p,durum:'odendi',odeme_tarihi:bugun()}});toast('Tahsil edildi olarak işaretlendi.');}
    else if(k==='sil'){if(!(await onayla('Satış kaydı silinsin mi?',`${p.fatura_no||'Fatura numarasız kayıt'} · ${tl(toplam(p))} ₺. Bu satışla verilen lisans geri alınmaz (gerekirse üyenin sayfasından bitirin).`,'Evet, sil')))return;await call('admin_payment_delete',{p_id:p.id});toast('Satış kaydı silindi.');}
    await yukle(['users','dash','pays']);if(st.acik)await uyeAc(st.acik);
  }catch(x){toast(hataMetni(x));}
}

/* ---- lisans kodları ---- */
function kodlar(){
  const k=st.sonKod;
  return `<div class="kart"><h2>Kod sorgula</h2><p class="not" style="margin:0 0 6px">Müşterinin elindeki kodun kim tarafından kullanıldığını gösterir. Kodun kendisi sunucuya gönderilmez.</p>
      <input id="kQ" class="kod" placeholder="XXXXX-XXXXX-… (50 karakter)" autocapitalize="characters" autocomplete="off" spellcheck="false">
      <div class="dugmeler"><button class="btn ana" id="kS">Sorgula</button></div><div id="kR"></div></div>
    <div class="kart"><h2>Yeni lisans kodu üret</h2><p class="not" style="margin:0">Kodlar bu telefonda üretilir; sunucuya yalnız özetleri gider. Kodları GİZLİ tutun, her müşteriye bir kod verin. Üretimden sonra kodları kaydetmeyi ya da paylaşmayı unutmayın; bu ekrandan çıkınca bir daha gösterilmez.</p>
      <label for="kA">Adet</label><input id="kA" type="number" inputmode="numeric" min="1" max="200" value="1">
      <label for="kG">Süre (gün)</label><input id="kG" type="number" inputmode="numeric" min="1" max="3660" value="365">
      <label for="kP">Parti adı (isteğe bağlı)</label><input id="kP" placeholder="ör. ekim-kampanya">
      <div class="dugmeler"><button class="btn ana" id="kU">Kodları üret</button></div><div class="hata" id="kE" hidden></div>
      ${k?`<div class="ayrac"></div><div class="bilgi" style="background:var(--iyi-bg);color:var(--iyi)">${k.added} kod eklendi · ${esc(k.parti)} · ${k.gun} gün</div>
        ${k.kodlar.map((x,i)=>`<div class="sat"><span class="kod">${esc(x)}</span><button class="btn kucuk" data-kk="${i}">Kopyala</button></div>`).join('')}
        <div class="dugmeler"><button class="btn" id="kTum">Tümünü kopyala</button><button class="btn" id="kCsv">CSV dosyası (GİZLİ)</button></div>`:''}</div>
    <div class="kart"><h2>Kod partileri</h2>${st.batches.length?st.batches.map(b=>`<div class="sat"><span>${esc(b.batch)}<br><span class="not">${b.days} gün</span></span><span class="sag mono">${b.used} / ${b.total}<br><span class="not">kalan ${b.total-b.used}</span></span></div>`).join(''):'<p class="not">Bilgi yok.</p>'}</div>`;
}
async function kodSorgu(){
  const R=$('#kR');R.innerHTML='<p class="not">Sorgulanıyor…</p>';
  try{const r=await call('admin_code_lookup',{p_hash:await kodOzet($('#kQ').value)});
    R.innerHTML=!r||!r.found?'<div class="hata" style="margin:10px 0 0">Bu kod sistemde yok.</div>':`<div style="margin-top:8px"><div class="sat"><span class="not">Süre</span><span>${r.days} gün</span></div><div class="sat"><span class="not">Parti</span><span>${esc(r.batch||'—')}</span></div>
      <div class="sat"><span class="not">Durum</span><span class="sag">${r.used_by?`<span class="chip kotu">kullanıldı</span><br>${trDT(r.used_at)} · <button class="lnk" data-u="${esc(r.used_by)}">${esc(r.used_email||r.used_by)}</button>`:'<span class="chip iyi">kullanılmadı</span>'}</span></div></div>`;}
  catch(x){R.innerHTML=`<div class="hata" style="margin:10px 0 0">${esc(hataMetni(x))}</div>`;}
}
async function kodUretIslem(){
  const e=$('#kE');e.hidden=true;const adet=Math.floor(+$('#kA').value||0),gun=Math.floor(+$('#kG').value||0);
  const hata=m=>{e.textContent=m;e.hidden=false;};
  if(!(adet>=1&&adet<=200)){hata('Adet 1–200 olmalı (daha fazlası için masaüstü programı kullanın).');return;}
  if(!(gun>=1&&gun<=3660)){hata('Süre 1–3660 gün olmalı.');return;}
  const parti=$('#kP').value.trim().slice(0,60)||`${LISANS}-${bugun()}-${adet}-tel`;
  if(!(await onayla(adet+' lisans kodu üretilsin mi?',`${gun} gün · parti: ${parti}\nKodlar yalnız bir kez gösterilir.`,'Üret',false)))return;
  const b=$('#kU');b.disabled=true;
  try{const kodlar=kodUret(adet);const hashes=await Promise.all(kodlar.map(kodOzet));
    const r=await call('admin_codes_add',{p_hashes:hashes,p_days:gun,p_module:LISANS,p_batch:parti});
    st.sonKod={added:(r&&r.added)||0,parti,gun,kodlar:kodlar.map(kodGrupla)};toast(st.sonKod.added+' lisans kodu üretildi.');await yukle(['kod','dash']);}
  catch(x){hata(hataMetni(x));b.disabled=false;}
}
async function kodCsv(){
  const k=st.sonKod;if(!k)return;
  const csv='\ufeff'+['sira;modul;gun;parti;kod',...k.kodlar.map((x,i)=>`${i+1};${LISANS};${k.gun};${k.parti};${x}`)].join('\r\n');
  const ad=`GIZLI-${LISANS}-lisans-kodlari-${k.parti}.csv`.replace(/[\\/:*?"<>|]/g,'-');
  const dosya=new File([csv],ad,{type:'text/csv'});
  try{if(navigator.canShare&&navigator.canShare({files:[dosya]})){await navigator.share({files:[dosya],title:ad});return;}}catch(x){if(x&&x.name==='AbortError')return;}
  const a=document.createElement('a');a.href=URL.createObjectURL(dosya);a.download=ad;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},2000);
}

/* ---- diğer ---- */
function diger(){
  return `<div class="liste">${DIGER.map(([k,v])=>`<button class="satir" data-tab="${k}"><div class="bas"><span class="ad">${esc(v)}</span><span class="not">›</span></div></button>`).join('')}</div>
    <div class="kart" style="margin-top:12px"><div class="sat"><span>Oturum</span><span class="not">${esc(oturum?oturum.email:'')}</span></div>
      <div class="dugmeler"><button class="btn" id="kilit">Kilitle</button><button class="btn tehlike" id="cikis">Çıkış yap</button></div>
      <p class="not" style="margin:10px 0 0">Panel ${KILIT_DK} dakika arka planda kalınca kilitlenir; yönetim şifresi yeniden sorulur.</p></div>`;
}
function ofisler(){
  const L=st.ofisler||[];
  return `<p class="not" style="margin:0 0 10px">"Ofisinize Özel Çözümler" bölümünü yalnız burada işaretlediğiniz ofisler görür.</p>
    <div class="liste">${L.map(o=>`<div class="satir" style="cursor:default"><div class="bas"><span class="ad">${esc(o.name)}</span><span class="not">${o.uye||0} kişi</span></div>
      <div class="alt">Luca üye no ${esc(o.luca_uye_no||'—')} · sahibi ${bul(o.owner)?`<button class="lnk" data-u="${esc(o.owner)}">${esc(o.owner_email||'')}</button>`:esc(o.owner_email||'')}</div>
      ${OZEL.map(z=>`<label class="onay"><input type="checkbox" data-oz="${esc(o.id)}" value="${z.id}"${(o.ozel||[]).includes(z.id)?' checked':''}> ${esc(z.ad)}</label>`).join('')}</div>`).join('')||'<p class="not">Henüz ofis yok.</p>'}</div>`;
}
async function ozelKaydet(cb){
  const oid=cb.dataset.oz;const liste=[...document.querySelectorAll('[data-oz]')].filter(x=>x.dataset.oz===oid&&x.checked).map(x=>x.value);
  try{const r=await call('admin_office_set_ozel',{p_office:oid,p_ozel:liste});const o=(st.ofisler||[]).find(x=>x.id===oid);if(o)o.ozel=(r&&r.ozel)||liste;
    toast(liste.length?'Özel çözüm tanımlandı; ofis üyeleri bir sonraki girişte görür.':'Özel çözüm kaldırıldı.');}
  catch(x){toast(hataMetni(x));cb.checked=!cb.checked;}
}
function ayarlar(){
  const a=st.ayar||{};const du=a.duyuru||null;const fy=a.fiyatlar||{};
  return `<div class="kart"><h2>Duyuru <span class="not">— tüm üyelere gösterilir</span></h2>
      ${du?`<div class="bilgi"><b>Yayında:</b> ${esc(du.metin)}<br><span class="not">${trDT(du.tarih)}${du.bitis?' · '+trD(du.bitis)+' tarihine kadar':''}</span></div>`:'<p class="not">Yayında duyuru yok.</p>'}
      <label for="dM">Metin</label><textarea id="dM" rows="3" maxlength="1000">${esc(du?du.metin:'')}</textarea>
      <label for="dT">Tür</label><select id="dT">${opt('bilgi','Bilgi',du?du.tur:'bilgi')}${opt('uyari','Uyarı',du?du.tur:'')}</select>
      <label for="dB">Son gün (isteğe bağlı)</label><input id="dB" type="date" value="${esc(du&&du.bitis||'')}">
      <div class="dugmeler"><button class="btn ana" id="dY">Yayınla</button>${du?'<button class="btn tehlike" id="dK">Duyuruyu kaldır</button>':''}</div></div>
    <div class="kart"><h2>Genel</h2>
      <label for="aMD">Hesap başına bilgisayar</label><input id="aMD" type="number" inputmode="numeric" min="1" max="50" value="${esc(a.max_devices??2)}">
      <label for="aOD">Çevrimdışı çalışma (gün)</label><input id="aOD" type="number" inputmode="numeric" min="1" max="30" value="${esc(a.offline_days??3)}">
      <label for="aF">Liste fiyatı (KDV hariç, ₺)</label><input id="aF" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(fy[LISANS]??'')}">
      <div class="dugmeler"><button class="btn ana" id="aK">Ayarları kaydet</button></div></div>
    <div class="kart"><h2>Yönetim şifresi</h2><p class="not" style="margin:0">Masaüstü programdaki yönetim şifresiyle aynıdır; burada değiştirirseniz orada da değişir.</p>
      <label for="p0">Mevcut şifre</label><input type="password" id="p0" autocomplete="off" inputmode="numeric">
      <label for="p1">Yeni şifre</label><input type="password" id="p1" autocomplete="off" placeholder="4–32 karakter">
      <label for="p2">Yeni şifre (tekrar)</label><input type="password" id="p2" autocomplete="off">
      <div class="dugmeler"><button class="btn" id="pS">Şifreyi değiştir</button></div><p class="not" id="pM"></p></div>`;
}
async function ayarKaydet(){
  const fy={...((st.ayar||{}).fiyatlar||{})};const v=$('#aF').value;if(v!=='')fy[LISANS]=String(r2(v));
  try{st.ayar=await call('admin_settings_set',{p:{max_devices:+$('#aMD').value,offline_days:+$('#aOD').value,fiyatlar:fy}});toast('Ayarlar kaydedildi.');ciz();}catch(x){toast(hataMetni(x));}
}
async function duyuru(kaldir){
  const metin=$('#dM').value.trim();
  if(!kaldir&&!metin){toast('Duyuru metnini yazın.');return;}
  if(kaldir&&!(await onayla('Duyuru kaldırılsın mı?','Üyeler artık bu duyuruyu görmeyecek.','Evet, kaldır')))return;
  if(!kaldir&&!(await onayla('Duyuru yayınlansın mı?','Tüm üyeler programı açınca görür:\n'+metin,'Yayınla',false)))return;
  try{st.ayar=await call('admin_settings_set',{p:{duyuru:kaldir?null:{metin,tur:$('#dT').value,bitis:$('#dB').value||null}}});toast(kaldir?'Duyuru kaldırıldı.':'Duyuru yayınlandı.');ciz();}catch(x){toast(hataMetni(x));}
}
async function pinDegis(){
  const m=$('#pM');const a=$('#p0').value,b=$('#p1').value,c=$('#p2').value;m.textContent='';
  if(b!==c){m.textContent='Yeni şifreler aynı değil.';return;}
  if(!/^\S{4,32}$/.test(b)){m.textContent='Yeni şifre 4–32 karakter olmalı, boşluk içermemeli.';return;}
  try{const r=await call('admin_pin_set',{p_old:a,p_new:b});if(r&&r.ok){['#p0','#p1','#p2'].forEach(x=>$(x).value='');m.textContent='Şifre değiştirildi.';toast('Yönetim şifresi değiştirildi.');}else m.textContent=(r&&r.reason)||'Değiştirilemedi.';}
  catch(x){m.textContent=hataMetni(x);}
}
function gunluk(){
  return `<div class="liste">${st.log.map(g=>`<div class="satir" style="cursor:default"><div class="bas"><span class="ad">${esc(EYLEM[g.action]||g.action)}</span><span class="not mono">${trDT(g.at)}</span></div>
    <div class="alt">${g.target&&bul(g.target)?`<button class="lnk" data-u="${esc(g.target)}">${esc(g.email||'')}</button>`:esc(g.email||'—')}${g.detail?' · '+esc(detayMetin(g.detail)):''}</div></div>`).join('')||'<p class="not">Kayıt yok.</p>'}</div>`;
}

/* ================= olaylar ================= */
document.addEventListener('click',e=>{
  if(st.ekran!=='ana'&&st.ekran!=='uye')return;
  const t=e.target;if(t.closest('#katman .perde'))return;
  const tb=t.closest('[data-tab]');if(tb){if(st.ekran==='uye')uyeKapat();sekme(tb.dataset.tab);return;}
  if(t.closest('#yenile')){yukle(['users','dash','ayar',...({satis:['pays'],kod:['kod'],log:['log'],ofis:['ofis']}[st.tab]||[])]);return;}
  if(t.closest('#uGeri')){uyeKapat();return;}
  const f=t.closest('[data-f]');if(f){st.durum=f.dataset.f==='tum'?'':f.dataset.f;sekme('uyeler');return;}
  const sat=t.closest('[data-satis]');if(sat){satisForm({user_id:sat.dataset.satis||''});return;}
  const pd=t.closest('[data-p]');if(pd){satisIslem(pd.dataset.p,pd.dataset.id);return;}
  const ii=t.closest('[data-i]');if(ii){uyeIslem(ii.dataset.i,ii);return;}
  const uu=t.closest('[data-u]');if(uu){uyeAc(uu.dataset.u);return;}
  const kk=t.closest('[data-kk]');if(kk&&st.sonKod){navigator.clipboard.writeText(st.sonKod.kodlar[+kk.dataset.kk]).then(()=>toast('Kod kopyalandı.'),()=>toast('Kopyalanamadı.'));return;}
  if(t.closest('#kTum')&&st.sonKod){navigator.clipboard.writeText(st.sonKod.kodlar.join('\n')).then(()=>toast(st.sonKod.kodlar.length+' kod kopyalandı.'),()=>toast('Kopyalanamadı.'));return;}
  if(t.closest('#kCsv')){kodCsv();return;}
  if(t.closest('#kS')){kodSorgu();return;}
  if(t.closest('#kU')){kodUretIslem();return;}
  if(t.closest('#uMail')){const L=suzulmus().filter(u=>!u.disabled).map(u=>u.email).filter(Boolean);navigator.clipboard.writeText(L.join('; ')).then(()=>toast(L.length+' e-posta adresi kopyalandı.'),()=>toast('Kopyalanamadı.'));return;}
  if(t.closest('#aK')){ayarKaydet();return;}
  if(t.closest('#dY')){duyuru(false);return;}
  if(t.closest('#dK')){duyuru(true);return;}
  if(t.closest('#pS')){pinDegis();return;}
  if(t.closest('#kilit')){kilitle();return;}
  if(t.closest('#cikis')){onayla('Çıkış yapılsın mı?','Tekrar girmek için hesap şifreniz gerekir.','Çıkış yap').then(v=>{if(v)cikis();});return;}
});
document.addEventListener('input',e=>{if(e.target.id==='uQ'){st.q=e.target.value;ciz();}});
document.addEventListener('change',e=>{const id=e.target.id;
  if(id==='uD'){st.durum=e.target.value;ciz();}else if(id==='uS'){st.sira=e.target.value;ciz();}
  else if(id==='pA'){st.pf.aralik=e.target.value;if(e.target.value!=='ozel')yukle(['pays']);else ciz();}
  else if(id==='pB'||id==='pE'){st.pf[id==='pB'?'bas':'bit']=e.target.value;yukle(['pays']);}
  else if(id==='pD'){st.pf.durum=e.target.value;ciz();}
  else if(e.target.dataset&&e.target.dataset.oz){ozelKaydet(e.target);}});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='kQ'){e.preventDefault();kodSorgu();}});

/* ================= başlangıç ================= */
(async()=>{
  let k=null;try{k=JSON.parse(LS.al(OTURUM_ANAHTAR)||'null');}catch(e){}
  if(k&&k.refresh_token&&k.email===SAHIP){
    $('#kok').innerHTML='<div class="giris-kutu"><p class="not">Oturum açılıyor…</p></div>';
    try{const j=await istek('/auth/v1/token?grant_type=refresh_token',{govde:{refresh_token:k.refresh_token}});oturumKur(j,k.email);pinCiz();return;}
    catch(e){LS.yaz(OTURUM_ANAHTAR,null);girisCiz(e.status?'Oturum süresi doldu. Yeniden giriş yapın.':hataMetni(e));return;}
  }
  girisCiz();
})();
window.__mwy={st,kodOzet,kodNorm};
})();
