const API_URL="https://script.google.com/macros/s/AKfycby8fykRZF7A-NltmZf2qY-rfvt0Vg4wHsqA5rM1trZzkIul5Xy4G-99CItq-Y6sDKHs/exec";
const QUICK_USERS=['Alex Tutt','Christoph Leiber','Dirk Henseler','Dominic Kuhl','Michael Schüller','René Wolber'];
let token='',user='',users=[],employees=[],selectedUser='',currentPreview=null,action='Ausgabe';
let scanner=null,cameras=[],cameraIndex=0,running=false,lastCode='',lastAt=0;
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
    document.getElementById('quickUsers').innerHTML=`<div class="message err">${escapeHtml(e.message)}</div>`;
  }finally{
    $('splash').classList.add('hidden');$('app').classList.remove('hidden');
  }
}

function bind(){
  $('otherUserBtn').onclick=openOtherUsers;$('backToUsers').onclick=showPersonStep;$('loginBtn').onclick=login;
  $('logoutBtn').onclick=logout;$('startBtn').onclick=startScanner;$('stopBtn').onclick=stopScanner;
  $('switchBtn').onclick=switchCamera;$('previewBtn').onclick=previewManual;
  $('issueBtn').onclick=()=>setAction('Ausgabe');$('returnBtn').onclick=()=>setAction('Rücknahme');$('bookBtn').onclick=book;
  $('pin').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
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
    $('loginView').classList.add('hidden');$('appView').classList.remove('hidden');$('pin').value='';setTimeout(startScanner,250);
  }catch(e){show('loginMsg',e.message)}finally{busy($('loginBtn'),false)}
}
async function logout(){await stopScanner();try{if(token)await jsonp('logout',{token})}catch(_){}token='';user='';selectedUser='';currentPreview=null;
  $('appView').classList.add('hidden');$('loginView').classList.remove('hidden');$('deviceCard').classList.add('hidden');$('bookingCard').classList.add('hidden');showPersonStep();
}
function fillEmployees(){const sel=$('employee');sel.innerHTML='<option value="">Bitte auswählen</option>';employees.forEach(e=>{const o=document.createElement('option');o.value=e.name;o.textContent=e.name;sel.appendChild(o)})}

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
function renderDevice(res){const p=res.parsed||{},c=res.current;$('dId').textContent=p.id||'Nicht erkannt';$('dName').textContent=p.name||'Nicht erkannt';$('dModel').textContent=p.model||'–';$('dManufacturer').textContent=p.manufacturer||'–';$('dSerial').textContent=p.serial||'–';$('dStatus').textContent=c?.status||'Neu / unbekannt';$('dCurrent').textContent=c?(c.employee?`${c.employee}${c.location?' – '+c.location:''}`:(c.location||'–')):'–';$('manualName').value=p.name||''}
function setAction(a){action=a;$('issueBtn').classList.toggle('active',a==='Ausgabe');$('returnBtn').classList.toggle('active',a==='Rücknahme');$('employeeWrap').classList.toggle('hidden',a==='Rücknahme');$('locationWrap').classList.toggle('hidden',a==='Rücknahme');$('bookBtn').innerHTML=`<span class="material-symbols-rounded">save</span>${a==='Ausgabe'?'Ausgabe speichern':'Rücknahme speichern'}`}

async function book(){
  hide('bookingMsg');const raw=$('rawQr').value.trim();if(!raw)return show('bookingMsg','Bitte zuerst ein Gerät scannen.');if(action==='Ausgabe'&&!$('employee').value)return show('bookingMsg','Bitte Mitarbeiter auswählen.');
  busy($('bookBtn'),true);
  try{const res=await jsonp('bookDevice',{data:{token,rawQr:raw,action,employee:$('employee').value,location:$('location').value.trim(),note:$('note').value.trim(),manualName:$('manualName').value.trim()}});show('bookingMsg',res.message||'Gespeichert.','ok');resetAfterBooking()}catch(e){show('bookingMsg',e.message)}finally{busy($('bookBtn'),false)}
}
function resetAfterBooking(){$('rawQr').value='';$('manualName').value='';$('employee').value='';$('location').value='';$('note').value='';currentPreview=null;$('deviceCard').classList.add('hidden');setTimeout(()=>{startScanner();$('reader').scrollIntoView({behavior:'smooth',block:'center'})},900)}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function escapeAttr(s){return escapeHtml(s)}
