const API_URL="https://script.google.com/macros/s/AKfycby8fykRZF7A-NltmZf2qY-rfvt0Vg4wHsqA5rM1trZzkIul5Xy4G-99CItq-Y6sDKHs/exec";
const QUICK_USERS=['Alex Tutt','Christoph Leiber','Dirk Henseler','Dominic Kuhl','Michael Schüller','René Wolber'];
let token='',user='',users=[],employees=[],selectedUser='',currentPreview=null,action='Ausgabe';
let scanner=null,cameras=[],cameraIndex=0,running=false,lastCode='',lastAt=0;
let currentLabelDevice=null,qrMode='new';
const $=id=>document.getElementById(id);

window.addEventListener('DOMContentLoaded',init);

async function init(){
  bind();
  if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
  try{
    const res=await jsonp('listUsers');
    users=(res.users||[]).sort((a,b)=>a.name.localeCompare(b.name,'de'));
    renderQuickUsers();
  }catch(e){
    $('quickUsers').innerHTML=`<div class="message err">${escapeHtml(e.message)}</div>`;
  }finally{
    $('splash').classList.add('hidden');$('app').classList.remove('hidden');
  }
}

function bind(){
  $('otherUserBtn').onclick=openOtherUsers;$('backToUsers').onclick=showPersonStep;$('loginBtn').onclick=login;
  $('logoutBtn').onclick=logout;$('startBtn').onclick=startScanner;$('stopBtn').onclick=stopScanner;
  $('switchBtn').onclick=switchCamera;$('previewBtn').onclick=previewManual;
  $('issueBtn').onclick=()=>setAction('Ausgabe');$('returnBtn').onclick=()=>setAction('Rücknahme');$('bookBtn').onclick=book;
  $('bookingNav').onclick=()=>showPage('booking');$('qrNav').onclick=()=>showPage('qr');
  $('newQrMode').onclick=()=>setQrMode('new');$('reprintQrMode').onclick=()=>setQrMode('reprint');
  $('nextIdBtn').onclick=refreshNextId;$('createDeviceBtn').onclick=createDevice;
  $('loadDeviceBtn').onclick=loadDeviceForReprint;$('downloadLabelBtn').onclick=downloadLabel;$('printLabelBtn').onclick=printLabel;
  $('pin').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
  $('reprintDeviceId').addEventListener('keydown',e=>{if(e.key==='Enter')loadDeviceForReprint()});
}

function renderQuickUsers(){
  $('quickUsers').innerHTML=QUICK_USERS.map(name=>userButton(name)).join('');
  document.querySelectorAll('[data-user]').forEach(btn=>btn.onclick=()=>chooseUser(btn.dataset.user));
}
function userButton(name){
  const exists=users.some(u=>u.name===name);
  return `<button class="employee-button" data-user="${escapeAttr(name)}" ${exists?'':'disabled'}>
    <span class="employee-icon"><span class="material-symbols-rounded">person</span></span>
    <span><strong>${escapeHtml(name)}</strong><small>${exists?'Benutzer auswählen':'Noch nicht als aktiver Benutzer angelegt'}</small></span>
    <span class="material-symbols-rounded">chevron_right</span></button>`;
}
function chooseUser(name){
  selectedUser=name;$('selectedUserName').textContent=name;$('personStep').classList.add('hidden');$('pinStep').classList.remove('hidden');
  $('pin').value='';hide('loginMsg');setTimeout(()=>$('pin').focus(),100);
}
function showPersonStep(){selectedUser='';$('pinStep').classList.add('hidden');$('personStep').classList.remove('hidden');}
function openOtherUsers(){
  const others=users.filter(u=>!QUICK_USERS.includes(u.name));
  const html=others.length?others.map(u=>`<button class="employee-button modal-user" data-modal-user="${escapeAttr(u.name)}">
    <span class="employee-icon"><span class="material-symbols-rounded">person</span></span>
    <span><strong>${escapeHtml(u.name)}</strong><small>Benutzer auswählen</small></span>
    <span class="material-symbols-rounded">chevron_right</span></button>`).join(''):'<p class="scan-hint">Keine weiteren aktiven Benutzer vorhanden.</p>';
  $('modalRoot').innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><div class="modal">
    <div class="modal-head"><h2>Anderen Benutzer auswählen</h2><button class="icon-button" id="closeModal"><span class="material-symbols-rounded">close</span></button></div>
    <div class="modal-body employee-list">${html}</div></div></div>`;
  $('closeModal').onclick=closeModal;$('modalBackdrop').onclick=e=>{if(e.target.id==='modalBackdrop')closeModal()};
  document.querySelectorAll('[data-modal-user]').forEach(btn=>btn.onclick=()=>{const n=btn.dataset.modalUser;closeModal();chooseUser(n)});
}
function closeModal(){$('modalRoot').innerHTML=''}

function show(id,text,type='err'){const n=$(id);n.textContent=text;n.className='message '+type;n.classList.remove('hidden')}
function hide(id){$(id).classList.add('hidden')}
function busy(btn,on){btn.disabled=on;btn.dataset.label??=btn.innerHTML;btn.innerHTML=on?'Bitte warten …':btn.dataset.label}

function jsonp(actionName,payload={}){
  return new Promise((resolve,reject)=>{
    const cb='eh_'+Date.now()+'_'+Math.random().toString(36).slice(2),script=document.createElement('script');
    let done=false;const finish=(err,data)=>{if(done)return;done=true;clearTimeout(timer);delete window[cb];script.remove();err?reject(err):resolve(data)};
    const timer=setTimeout(()=>finish(new Error('Zeitüberschreitung bei der Verbindung.')),20000);
    window[cb]=data=>{if(data&&data.ok===false&&data.error)return finish(new Error(data.error));finish(null,data)};
    const body=btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    script.onerror=()=>finish(new Error('Backend nicht erreichbar. Apps Script bitte als neue Version bereitstellen.'));
    script.src=`${API_URL}?api=1&action=${encodeURIComponent(actionName)}&callback=${encodeURIComponent(cb)}&data=${encodeURIComponent(body)}&_=${Date.now()}`;
    document.head.appendChild(script);
  });
}
async function sha256(text){const data=new TextEncoder().encode(text),hash=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('')}

async function login(){
  hide('loginMsg');const pin=$('pin').value.trim();
  if(!selectedUser)return show('loginMsg','Bitte zuerst eine Person auswählen.');
  if(!/^\d{4,8}$/.test(pin))return show('loginMsg','Bitte eine PIN mit 4 bis 8 Ziffern eingeben.');
  busy($('loginBtn'),true);
  try{
    const res=await jsonp('loginHash',{userName:selectedUser,pinHash:await sha256(pin)});
    token=res.token;user=res.name;employees=res.employees||[];$('userName').textContent=user;fillEmployees();
    $('loginView').classList.add('hidden');$('appView').classList.remove('hidden');$('pin').value='';showPage('booking');refreshNextId();
  }catch(e){show('loginMsg',e.message)}finally{busy($('loginBtn'),false)}
}
async function logout(){await stopScanner();try{if(token)await jsonp('logout',{token})}catch(_){}token='';user='';selectedUser='';currentPreview=null;currentLabelDevice=null;
  $('appView').classList.add('hidden');$('loginView').classList.remove('hidden');$('deviceCard').classList.add('hidden');$('bookingCard').classList.add('hidden');$('labelCard').classList.add('hidden');showPersonStep();
}
function fillEmployees(){const sel=$('employee');sel.innerHTML='<option value="">Bitte auswählen</option>';employees.forEach(e=>{const o=document.createElement('option');o.value=e.name;o.textContent=e.name;sel.appendChild(o)})}

async function showPage(page){
  const booking=page==='booking';
  $('bookingPage').classList.toggle('hidden',!booking);$('qrPage').classList.toggle('hidden',booking);
  $('bookingNav').classList.toggle('active',booking);$('qrNav').classList.toggle('active',!booking);
  if(booking){setTimeout(startScanner,150)}else{await stopScanner();if(!$('newDeviceId').value)refreshNextId()}
}

async function startScanner(){
  if(running)return;hide('bookingMsg');
  try{
    if(typeof Html5Qrcode==='undefined')throw new Error('Scanner-Bibliothek nicht geladen. Internetverbindung prüfen.');
    if(!scanner)scanner=new Html5Qrcode('reader',{verbose:false});
    if(!cameras.length){cameras=await Html5Qrcode.getCameras();if(!cameras.length)throw new Error('Keine Kamera gefunden.');const i=cameras.findIndex(c=>/back|rear|environment|rück/i.test(c.label||''));cameraIndex=i>=0?i:cameras.length-1}
    $('scanHint').textContent='Kamera wird gestartet …';const size=Math.min(310,Math.max(210,Math.floor(innerWidth*.7)));
    await scanner.start(cameras[cameraIndex].id,{fps:18,qrbox:{width:size,height:size},aspectRatio:1.333333,disableFlip:true},onScan,()=>{});
    running=true;$('startBtn').disabled=true;$('stopBtn').disabled=false;$('switchBtn').disabled=cameras.length<2;$('scanHint').textContent='Scanner läuft – QR-Code ruhig in den gelben Rahmen halten.';
  }catch(e){$('scanHint').textContent=cameraError(e);$('startBtn').disabled=false}
}
async function stopScanner(){if(scanner&&running){try{await scanner.stop()}catch(_){}running=false}$('startBtn').disabled=false;$('stopBtn').disabled=true;$('switchBtn').disabled=true}
async function switchCamera(){if(cameras.length<2)return;await stopScanner();cameraIndex=(cameraIndex+1)%cameras.length;await startScanner()}
async function onScan(text){const now=Date.now();if(!text||(text===lastCode&&now-lastAt<3000))return;lastCode=text;lastAt=now;$('rawQr').value=text;if(navigator.vibrate)navigator.vibrate(100);$('scanHint').textContent='QR-Code erkannt.';await stopScanner();await preview(text)}
function cameraError(e){const t=String(e?.message||e||'');if(/NotAllowed|Permission|denied/i.test(t))return 'Kamerazugriff nicht erlaubt. Bitte in den Browser-Einstellungen Kamera zulassen.';if(/NotReadable|Could not start/i.test(t))return 'Kamera wird bereits verwendet. Andere Kamera-App schließen.';return 'Kamera konnte nicht gestartet werden: '+t}

function previewManual(){const raw=$('rawQr').value.trim();if(!raw)return show('bookingMsg','Bitte QR-Inhalt einfügen.');preview(raw)}
async function preview(raw){try{const res=await jsonp('previewQr',{token,rawQr:raw});currentPreview=res;$('deviceCard').classList.remove('hidden');$('bookingCard').classList.remove('hidden');renderDevice(res);setAction(res.current&&res.current.status==='Ausgegeben'?'Rücknahme':'Ausgabe');$('deviceCard').scrollIntoView({behavior:'smooth',block:'start'})}catch(e){show('bookingMsg',e.message)}}
function renderDevice(res){const p=res.parsed||{},c=res.current||{};$('dId').textContent=p.id||c.id||'Nicht erkannt';$('dName').textContent=c.name||p.name||'Nicht erkannt';$('dModel').textContent=c.model||p.model||'–';$('dManufacturer').textContent=c.manufacturer||p.manufacturer||'–';$('dSerial').textContent=c.serial||p.serial||'–';$('dStatus').textContent=c.status||'Neu / unbekannt';$('dCurrent').textContent=res.current?(c.employee?`${c.employee}${c.location?' – '+c.location:''}`:(c.location||'–')):'–';$('manualName').value=c.name||p.name||''}
function setAction(a){action=a;$('issueBtn').classList.toggle('active',a==='Ausgabe');$('returnBtn').classList.toggle('active',a==='Rücknahme');$('employeeWrap').classList.toggle('hidden',a==='Rücknahme');$('locationWrap').classList.toggle('hidden',a==='Rücknahme');$('bookBtn').innerHTML=`<span class="material-symbols-rounded">save</span>${a==='Ausgabe'?'Ausgabe speichern':'Rücknahme speichern'}`}

async function book(){
  hide('bookingMsg');const raw=$('rawQr').value.trim();if(!raw)return show('bookingMsg','Bitte zuerst ein Gerät scannen.');if(action==='Ausgabe'&&!$('employee').value)return show('bookingMsg','Bitte Mitarbeiter auswählen.');
  busy($('bookBtn'),true);
  try{const res=await jsonp('bookDevice',{data:{token,rawQr:raw,action,employee:$('employee').value,location:$('location').value.trim(),note:$('note').value.trim(),manualName:$('manualName').value.trim()}});show('bookingMsg',res.message||'Gespeichert.','ok');resetAfterBooking()}catch(e){show('bookingMsg',e.message)}finally{busy($('bookBtn'),false)}
}
function resetAfterBooking(){$('rawQr').value='';$('manualName').value='';$('employee').value='';$('location').value='';$('note').value='';currentPreview=null;$('deviceCard').classList.add('hidden');setTimeout(()=>{startScanner();$('reader').scrollIntoView({behavior:'smooth',block:'center'})},900)}

function setQrMode(mode){
  qrMode=mode;const isNew=mode==='new';
  $('newQrMode').classList.toggle('active',isNew);$('reprintQrMode').classList.toggle('active',!isNew);
  $('newQrForm').classList.toggle('hidden',!isNew);$('reprintQrForm').classList.toggle('hidden',isNew);
  $('labelCard').classList.add('hidden');currentLabelDevice=null;hide('createDeviceMsg');hide('reprintDeviceMsg');
  if(isNew&&!$('newDeviceId').value)refreshNextId();
}

async function refreshNextId(){
  if(!token)return;busy($('nextIdBtn'),true);
  try{const res=await jsonp('getNextDeviceId',{token});$('newDeviceId').value=res.id||''}catch(e){show('createDeviceMsg',e.message)}finally{busy($('nextIdBtn'),false)}
}

async function createDevice(){
  hide('createDeviceMsg');
  const data={token,id:$('newDeviceId').value,name:$('newDeviceName').value.trim(),model:$('newDeviceModel').value.trim(),manufacturer:$('newDeviceManufacturer').value.trim(),serial:$('newDeviceSerial').value.trim(),location:$('newDeviceLocation').value.trim()};
  if(!data.id.trim())return show('createDeviceMsg','Bitte eine Geräte-ID eingeben.');
  if(!data.name)return show('createDeviceMsg','Bitte eine Bezeichnung eingeben.');
  busy($('createDeviceBtn'),true);
  try{
    const res=await jsonp('createDevice',{data});
    currentLabelDevice=res.device;await renderLabel(currentLabelDevice);show('createDeviceMsg',res.message||'Gerät wurde angelegt.','ok');
    $('newDeviceId').value=res.nextId||'';$('newDeviceName').value='';$('newDeviceModel').value='';$('newDeviceManufacturer').value='';$('newDeviceSerial').value='';$('newDeviceLocation').value='Lager';
    $('labelCard').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){show('createDeviceMsg',e.message)}finally{busy($('createDeviceBtn'),false)}
}

async function loadDeviceForReprint(){
  hide('reprintDeviceMsg');const id=$('reprintDeviceId').value.trim();if(!id)return show('reprintDeviceMsg','Bitte eine Geräte-ID eingeben.');
  busy($('loadDeviceBtn'),true);
  try{const res=await jsonp('getDeviceForQr',{token,id});currentLabelDevice=res.device;await renderLabel(currentLabelDevice);show('reprintDeviceMsg','Gerät gefunden. Etikett kann gedruckt werden.','ok');$('labelCard').scrollIntoView({behavior:'smooth',block:'start'})}catch(e){show('reprintDeviceMsg',e.message)}finally{busy($('loadDeviceBtn'),false)}
}

function normalizeClientId(value){return String(value||'').replace(/\s+/g,'').replace(/[^A-Za-z0-9._-]/g,'').toUpperCase()}
function formatDeviceId(value){const id=normalizeClientId(value);return /^\d{6}$/.test(id)?id.replace(/(\d{3})(\d{3})/,'$1 $2'):id}
function fitCanvasText(ctx,text,maxWidth,startSize,minSize=26){let size=startSize;do{ctx.font=`800 ${size}px Arial, sans-serif`;if(ctx.measureText(text).width<=maxWidth)return size;size-=2}while(size>minSize);return minSize}
function shortenCanvasText(ctx,text,maxWidth){let out=String(text||'–');if(ctx.measureText(out).width<=maxWidth)return out;while(out.length>1&&ctx.measureText(out+'…').width>maxWidth)out=out.slice(0,-1);return out+'…'}

async function renderLabel(device){
  if(typeof QRCode==='undefined')throw new Error('QR-Code-Bibliothek konnte nicht geladen werden. Internetverbindung prüfen.');
  const id=normalizeClientId(device.id);if(!id)throw new Error('Geräte-ID fehlt.');
  const holder=document.createElement('div');holder.style.position='fixed';holder.style.left='-9999px';document.body.appendChild(holder);
  new QRCode(holder,{text:id,width:600,height:600,colorDark:'#000000',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
  await new Promise(r=>setTimeout(r,30));
  const qr=holder.querySelector('canvas')||holder.querySelector('img');
  if(!qr){holder.remove();throw new Error('QR-Code konnte nicht erzeugt werden.');}
  const canvas=$('labelCanvas'),ctx=canvas.getContext('2d');const W=canvas.width,H=canvas.height;
  ctx.clearRect(0,0,W,H);ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);ctx.strokeStyle='#111';ctx.lineWidth=10;
  ctx.beginPath();ctx.roundRect(5,5,W-10,H-10,48);ctx.stroke();
  ctx.imageSmoothingEnabled=false;ctx.drawImage(qr,45,75,600,600);ctx.imageSmoothingEnabled=true;holder.remove();
  const x=725,max=W-x-55;
  ctx.fillStyle='#24272b';ctx.textBaseline='alphabetic';
  ctx.font='800 58px Arial, sans-serif';ctx.fillText('ELEKTRO HENSELER',x,90);
  const visibleId=formatDeviceId(id);fitCanvasText(ctx,visibleId,max,132,72);ctx.fillStyle='#000';ctx.fillText(shortenCanvasText(ctx,visibleId,max),x,245);
  fitCanvasText(ctx,String(device.name||'Gerät'),max,60,34);ctx.fillText(shortenCanvasText(ctx,String(device.name||'Gerät'),max),x,390);
  ctx.fillStyle='#30343a';ctx.font='400 38px Arial, sans-serif';
  const makerModel=[device.manufacturer,device.model].filter(Boolean).join(' · ')||'Hersteller / Modell nicht angegeben';
  ctx.fillText(shortenCanvasText(ctx,makerModel,max),x,495);
  ctx.font='400 35px Arial, sans-serif';ctx.fillText(shortenCanvasText(ctx,`SN: ${device.serial||'–'}`,max),x,555);
  ctx.font='600 30px Arial, sans-serif';ctx.fillStyle='#555';ctx.fillText(shortenCanvasText(ctx,`ToolTrack · ${device.location||'Lager'}`,max),x,650);
  $('labelDeviceSummary').innerHTML=`<strong>${escapeHtml(formatDeviceId(id))} – ${escapeHtml(device.name||'Gerät')}</strong><span>${escapeHtml([device.manufacturer,device.model].filter(Boolean).join(' · ')||'Keine Hersteller-/Modellangabe')} · SN: ${escapeHtml(device.serial||'–')}</span>`;
  $('labelCard').classList.remove('hidden');
}

function downloadLabel(){if(!currentLabelDevice)return;const a=document.createElement('a');a.href=$('labelCanvas').toDataURL('image/png');a.download=`ToolTrack_${formatDeviceId(currentLabelDevice.id).replace(/\s+/g,'_')}.png`;a.click()}
function printLabel(){
  if(!currentLabelDevice)return;const url=$('labelCanvas').toDataURL('image/png');const w=window.open('','_blank');if(!w)return alert('Druckfenster wurde blockiert. Pop-ups für ToolTrack bitte zulassen.');
  w.document.write(`<!doctype html><html><head><title>ToolTrack ${escapeHtml(formatDeviceId(currentLabelDevice.id))}</title><style>@page{size:85mm 43mm;margin:0}html,body{margin:0;padding:0;width:85mm;height:43mm;overflow:hidden}img{display:block;width:85mm;height:42.5mm;object-fit:fill}</style></head><body><img src="${url}" onload="setTimeout(()=>window.print(),150)"></body></html>`);w.document.close();
}

function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function escapeAttr(s){return escapeHtml(s)}
