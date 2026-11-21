(function(S){
  const e=S.util.esc;
  const paths={home:'M3 10 12 3l9 7v10H3z M9 20v-6h6v6',grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',fish:'M3 12c5-9 12-9 17 0-5 9-12 9-17 0z M3 12 1 7v10z M15 10h.01',water:'M12 2C9 7 5 10 5 14a7 7 0 0 0 14 0c0-4-4-7-7-12z M8 15a4 4 0 0 0 4 4',task:'M9 5H5v16h14V5h-4 M9 3h6v4H9z M8 12l2 2 5-5 M8 18h8',shop:'M3 10h18l-2-7H5z M4 10v11h16V10 M9 21v-7h6v7',order:'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6',truck:'M3 6h12v11H3z M15 10h4l3 4v3h-7 M7 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4 M18 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4',box:'M3 7 12 2l9 5v11l-9 5-9-5z M3 7l9 5 9-5 M12 12v11',money:'M3 5h18v14H3z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',help:'M9 8a3 3 0 1 1 4 3v3 M12 18h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',bell:'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z M10 21h4',offer:'m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z',clock:'M12 7v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'};
  const icon=name=>'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[name]||paths.fish)+'"/></svg>';
  const labels={urgent:'! เร่งตรวจและตอบสนอง',watch:'△ เฝ้าระวังและตรวจเพิ่ม',routine:'○ ติดตามตามแผน',unknown:'? ยังประเมินได้ไม่ครบ',complete:'มีข้อมูลตามชุดเดโม',missing:'ขาดบางค่า',stale:'ข้อมูลเก่า',check:'ต้องตรวจข้อมูล',requested:'คำขอซื้อ',allocated:'รอผู้เกี่ยวข้องยืนยัน',waiting:'รอผู้เกี่ยวข้องยืนยัน',confirmed:'ยืนยันแล้ว',preparing:'กำลังเตรียม',sent:'ส่งแล้ว',received:'รับครบ',partial:'รับบางส่วน',closed:'ปิดออเดอร์',cancelled:'ยกเลิก',draft:'ร่าง',approved:'อนุมัติแล้ว',harvested:'จับแล้ว',unassigned:'ยังไม่มีผู้รับ',assigned:'รับงานแล้ว',working:'กำลังทำ',followup:'รอติดตาม/ส่งต่อ',done:'เสร็จพร้อมหลักฐาน',passed:'ผ่านการตรวจคุณภาพ',pending:'ยังไม่ผ่านการยืนยัน',rejected:'ปฏิเสธ/ไม่ผ่าน',accepted:'ตอบรับแล้ว',expired:'หมดอายุ',scheduled:'นัดรับส่ง',cold:'พักเย็น',dispatch:'พร้อมจัดส่ง',hold:'พักตรวจคุณภาพ'};
  const link=(href,text,cls='btn secondary')=>'<a class="'+cls+'" href="'+e(href)+'">'+e(text)+'</a>';
  let toastTimer, submitting = false, currentForm = null;
  const U=S.ui={
    e,icon,link,label:key=>labels[key]||key,
    tag:(key,text)=>'<span class="tag '+e(key)+'">'+e(text||labels[key]||key)+'</span>',
    state:()=>S.store.get(),user:()=>S.util.user(S.store.get()),
    html(selector,html){const el=document.querySelector(selector);if(el)el.innerHTML=html;},
    toast(text,error=false){const t=document.querySelector('#toast');if(!t)return;t.textContent=text;t.className='toast'+(error?' error':'');t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.hidden=true,5500);},
    empty(title,description='',href='',text='เริ่มต้น'){return '<div class="empty">'+icon('fish')+'<h3>'+e(title)+'</h3><p>'+e(description)+'</p>'+(href?'<div class="actions">'+link(href,text)+'</div>':'')+'</div>';},
    async submit(action, redirect) {
      if (submitting) throw Error('กำลังบันทึก กรุณารอสักครู่');
      const { actionId, ...command } = action;
      const form = currentForm;
      const requestId = S.retry.request(command);
      submitting = true;
      try {
        const state = await S.domain.dispatch({ ...command, actionId: requestId });
        S.retry.finish(command);
        if (form) S.retry.clearForm(form);
        U.toast(S.cloud.enabled ? 'บันทึกข้อมูลกลุ่มสำเร็จ' : 'บันทึกสำเร็จในเดโม');
        if (redirect) location.href = typeof redirect === 'function' ? redirect(state) : redirect;
        else { U.render(); }
        return state;
      } finally { submitting = false; }
    },
    render() {
      U.shell();
      if (!S.store.issue()) S.page?.();
    },
    async act(action,redirect){try{return await U.submit(action,redirect);}catch(err){U.toast(err.message,true);return null;}},
    form(form, handler) {
      if (!form) return;
      S.retry.restore(form);
      for (const type of ['input', 'change']) {
        form.removeEventListener(type, form.sparkCapture);
      }
      form.sparkCapture = () => S.retry.capture(form);
      for (const type of ['input', 'change']) form.addEventListener(type, form.sparkCapture);
      form.onsubmit = async event => {
        event.preventDefault();
        if (currentForm) return;
        const button = event.submitter, errorBox = form.querySelector('.form-error');
        if (errorBox) errorBox.hidden = true;
        S.retry.capture(form);
        currentForm = form;
        try {
          if (button) button.disabled = true;
          await handler(new FormData(form), form, event);
        } catch (error) {
          if (errorBox) { errorBox.textContent = error.message; errorBox.hidden = false; errorBox.tabIndex = -1; errorBox.focus(); }
          U.toast(error.message, true);
        } finally {
          currentForm = null;
          if (button?.isConnected) button.disabled = false;
        }
      };
    },
    confirm(title,text,callback){document.querySelector('#confirm-title').textContent=title;document.querySelector('#confirm-copy').textContent=text;const dlg=document.querySelector('#confirm-dialog'),button=document.querySelector('#confirm-yes');button.onclick=async()=>{button.disabled=true;try{await callback();dlg.close();}catch(err){U.toast(err.message,true);}finally{button.disabled=false;}};dlg.showModal();},
    gate(roles){if(roles.includes(U.user().role))return true;U.html('#role-gate','<div class="notice warning">หน้านี้ใช้บทบาท '+roles.map(r=>S.config.roleNames[r]).join(' หรือ ')+(S.cloud.enabled?'':' <button class="btn small secondary" data-role-open>สลับบทบาท</button>')+'</div>');return false;},
    allowedCages(s){const u=S.util.user(s);return s.cages.filter(c=>u.role==='coordinator'||c.ownerId===u.id);},
    allowedOrders(s){const u=S.util.user(s);return s.orders.filter(o=>u.role==='coordinator'||o.buyerId===u.id||s.cages.some(c=>(c.id===o.cageId||(o.cageIds||[]).includes(c.id))&&c.ownerId===u.id));},
    allowedPlans(s){const u=S.util.user(s);return s.plans.filter(p=>u.role==='coordinator'||s.cages.some(c=>c.id===p.cageId&&c.ownerId===u.id));},
    risk(s,c){return S.evaluateCageRisk(S.calc.latest(s,c.id),s.observations,S.config,s.demoNow,c.species,{openUrgentIncident:s.incidents.some(i=>i.cageId===c.id&&i.status!=='closed'&&i.urgency==='urgent')});},
    missing(text){U.html('#detail-content',U.empty('ไม่พบข้อมูล '+text,'ตรวจเลขรายการหรือเลือกบัญชีที่เกี่ยวข้อง','dashboard.html','กลับภาพรวม'));},
    timeline(s,key){return '<ol class="timeline">'+s.audit.filter(a=>a.entityId===key).map(a=>'<li>'+e(a.message)+'<small>'+e(S.util.date(a.at))+' • '+e(s.users.find(u=>u.id===a.actorId)?.name||'สมาชิกกลุ่ม')+'</small></li>').join('')+'</ol>';},
    cageCard(s,c){const r=U.risk(s,c),o=S.calc.latest(s,c.id);return '<article class="card cage-card '+r.urgency+'"><div class="card-head"><div><span class="cage-id">กระชัง '+e(c.id)+'</span><h3>'+e(c.name)+'</h3></div>'+U.tag(r.urgency)+'</div><strong class="metric">'+S.util.kg(c.liveKg)+'</strong><p class="small muted">น้ำหนักมีชีวิตประมาณการ</p><div class="badge-row">'+U.tag(r.dataQuality)+'</div><p class="small muted">'+e(r.missingFields.includes('do')?'ยังประเมินออกซิเจนไม่ได้':r.missingFields.length?'ขาด '+r.missingFields.join(', '):'ยังไม่ตัดสินความปลอดภัยจากตัวเลขน้ำ')+'</p><div class="waterline"><span>วัดล่าสุด</span><span>'+e(o?S.util.date(o.measuredAt):'ไม่มีข้อมูล')+'</span></div><div class="actions">'+link('cage-detail.html?id='+c.id,'รายละเอียด')+link('record-water.html?cage='+c.id,'บันทึกค่าน้ำ','btn')+'</div></article>';},
    orderCard(s,o){return '<article class="card"><div class="card-head"><div><span class="cage-id">'+e(o.id)+'</span><h3>'+e(s.products.find(p=>p.id===o.productId).name)+'</h3><p class="small muted">'+e(s.users.find(u=>u.id===o.buyerId).name)+'</p></div>'+U.tag(o.status)+'</div><dl class="key-value"><dt>ขอซื้อ / จัดสรร / รับจริง</dt><dd>'+S.util.kg(o.requestedKg)+' / '+S.util.kg(o.allocatedKg)+' / '+S.util.kg(o.acceptedKg)+'</dd></dl><div class="actions">'+link('order-detail.html?id='+o.id,'ดูออเดอร์')+'</div></article>';},
    scenario(name) {
      if (S.cloud.enabled) return;
      U.confirm('เริ่มเดโมใหม่?', 'ล้างรายการทดลองของปลาศาลาหุมในเบราว์เซอร์นี้และเริ่มจากข้อมูลตัวอย่าง', () => {
        S.store.reset(name);
        S.retry.clear();
        location.href = name === 'normal' ? 'dashboard.html?mode=demo' :
          name === 'missing' ? 'risk.html?cage=C04' : 'record-water.html?cage=C03';
      });
    },
    shell(){
      let s;
      try{s=U.state();}catch(err){
        document.body.innerHTML='<main class="shell-error card"><h1>เปิดข้อมูลสาธิตไม่ได้</h1><p>'+e(err.message)+'</p><div class="actions"><button class="btn secondary" id="export-broken">ส่งออกข้อมูลเดิม</button><button class="btn danger" id="recover">ยืนยันเริ่มชุดใหม่</button></div></main>';
        document.querySelector('#export-broken').onclick=()=>S.util.download('spark-backup.json',S.store.raw());
        document.querySelector('#recover').onclick=()=>{if(window.confirm('แทนที่ข้อมูลเดิมด้วยชุดสาธิตใหม่?'))try{S.store.reset('normal');S.retry.clear();location.reload();}catch(e){window.alert('ยังจัดเก็บไม่ได้: '+e.message);}};return;
      }
      const u=S.util.user(s),page=document.body.dataset.page,group=S.cloud.enabled;
      document.body.classList.toggle('group-mode', group);
      const nav=[['dashboard','grid','ภาพรวม'],['cages','fish',u.role==='farmer'?'กระชังของฉัน':'กระชังในโครงการ'],['tasks','task','งานดูแล'],['harvest','water','แผนจับปลา'],['marketplace','shop','สั่งปลา'],['orders','order','ออเดอร์'],['offers','offer','ข้อเสนอ'],['allocation','grid','จัดสรรปลา'],['delivery','truck','รอบส่ง'],['lots','box','ล็อตและสต็อก'],['finance','money','เงินรับสุทธิ'],['mortality','fish','บันทึกการตาย'],['analytics','grid','ประวัติและ ML'],['partners','shop','GI และ Thai SELECT'],['trips','truck','เที่ยวเรือ'],['guide','help','วิธีใช้ / สาธิต']];
      const permitted=nav.filter(n=>u.role==='coordinator'||(u.role==='buyer'?['dashboard','marketplace','orders','offers','delivery','guide'].includes(n[0]):!['allocation','offers','partners','marketplace'].includes(n[0])));
      const active=p=>page===p||({'cage-detail':'cages','record-water':'cages',risk:'cages',order:'marketplace','order-detail':'orders','lot-detail':'lots'}[page]===p);
      const navLink=([p,i,t])=>'<a class="nav-item '+(active(p)?'active':'')+'" href="'+p+'.html" '+(active(p)?'aria-current="page"':'')+'>'+icon(i)+e(t)+'</a>';
      const primary=['dashboard','cages','mortality','orders','finance'];
      const navMarkup=u.role==='farmer'?permitted.filter(n=>primary.includes(n[0])).map(navLink).join('')+'<details class="nav-more"><summary>งานและข้อมูลเพิ่มเติม</summary>'+permitted.filter(n=>!primary.includes(n[0])).map(navLink).join('')+'</details>':permitted.map(navLink).join('');
      U.html('#app-sidebar','<a class="brand" href="index.html">'+icon('fish')+'<span>'+e(S.config.name)+'<small>บ้านศาลาหุม</small></span></a><div class="nav-label">พื้นที่ทำงานของคุณ</div><nav aria-label="เมนูหลัก">'+navMarkup+'</nav><div class="sidebar-foot"><div class="line"></div>บ้านศาลาหุม · สงขลา<br><br><span class="tag">'+(group?'โหมดกลุ่ม':'โหมดเดโม')+'</span></div>');
      const unread=s.notifications.filter(n=>n.userId===u.id&&!n.read).length;
      const account = '<span class="avatar">' + e(u.name.slice(0,1)) + '</span><span class="account-name">' +
        e(u.name) + '<small>' + e(S.config.roleNames[u.role]) + '</small></span>';
      U.html('#app-header','<a class="mobile-brand" href="index.html">'+icon('fish')+e(S.config.name)+'</a><div class="header-context"><strong>บ้านศาลาหุม · อ.สิงหนคร จ.สงขลา</strong>'+e(group?s.groupName:'โหมดเดโม')+'</div><div class="header-actions"><button class="btn small secondary mobile-menu" id="nav-open" type="button">เมนู</button><button id="notifications-open" class="icon-button" aria-label="แจ้งเตือน">'+icon('bell')+(unread?'<span class="notification-count">'+unread+'</span>':'')+'</button>'+
        (group?'<div class="account">'+account+'</div>':'<button class="account" data-role-open aria-label="สลับบทบาท">'+account+'</button>')+'</div>');
      const mobile=(u.role==='buyer'?['dashboard','marketplace','orders','offers','guide']:u.role==='farmer'?['dashboard','cages','tasks','finance','guide']:['dashboard','cages','orders','harvest','guide']).map(p=>nav.find(n=>n[0]===p));
      U.html('#bottom-nav',mobile.map(([p,i,t])=>'<a href="'+p+'.html" class="'+(active(p)?'active':'')+'">'+icon(i)+'<span>'+e(t.replace('ของกลุ่ม','').replace(' / สาธิต',''))+'</span></a>').join(''));
      U.html('#role-gate','');
      const footer = document.querySelector('.page-footer');
      if (footer && !footer.querySelector('.privacy-review-link')) {
        footer.insertAdjacentHTML('beforeend', '<a class="privacy-review-link" href="'+e(window.SparkPrivacy.reviewHref())+'">การใช้ข้อมูลส่วนบุคคล</a>');
      }
      document.querySelectorAll('[data-clock]').forEach(el=>el.textContent=group?'เวลาไทย · '+S.util.date(s.demoNow):S.util.date(s.demoNow)+' • เวลาเดโม');
      if(!['mortality','analytics','partners','trips'].includes(page))S.guidedDemo.mount(s);
      document.querySelector('#notifications-open').onclick=()=>{
        U.html('#notification-list',s.notifications.filter(n=>n.userId===u.id).reverse().map(n=>'<div class="row"><div>'+e(n.text)+'<br>'+link(n.url,'เปิดรายการ','btn small secondary')+'</div>'+(!n.read?'<button class="btn small secondary" data-read="'+e(n.id)+'">อ่านแล้ว</button>':'<small>อ่านแล้ว</small>')+'</div>').join('')||'<p class="muted">ยังไม่มีแจ้งเตือนใหม่</p>');
        document.querySelectorAll('[data-read]').forEach(b=>b.onclick=async()=>{await U.act({type:'READ_NOTIFICATION',id:b.dataset.read});document.querySelector('#notifications-open').click();});
        const d=document.querySelector('#notification-dialog');if(!d.open)d.showModal();
      };
      if(location.protocol==='file:')U.html('#connection-notice','<div class="notice warning">เปิดแบบ file:// โปรดใช้ HTTP Server เพื่อให้ข้อมูลต่อเนื่องระหว่างหน้า <a href="guide.html#server">ดูวิธีเปิด</a></div>');
      S.cloud.mount();
      U.html('#all-nav',permitted.map(([p,i,t])=>'<a class="nav-item" href="'+p+'.html">'+icon(i)+e(t)+'</a>').join(''));
      document.querySelector('#nav-open').onclick=()=>document.querySelector('#nav-dialog').showModal();
    },
    openRoles(){
      if (S.cloud.enabled) return;
      const s=U.state();U.html('#role-list',Object.keys(S.config.roleNames).map(role=>'<div class="eyebrow">'+S.config.roleNames[role]+'</div>'+s.users.filter(u=>u.role===role).map(u=>'<button class="role-choice '+(u.id===s.currentUserId?'selected':'')+'" data-user="'+u.id+'"><span class="avatar">'+e(u.name.slice(0,1))+'</span><span>'+e(u.name)+'<small>บัญชีสมมติ • '+u.id+'</small></span></button>').join('')).join(''));
      document.querySelectorAll('[data-user]').forEach(b=>b.onclick=()=>{document.querySelector('#role-dialog').close();U.act({type:'SET_USER',userId:b.dataset.user},location.href);});document.querySelector('#role-dialog').showModal();
    }
  };
  document.addEventListener('DOMContentLoaded',async()=>{
    if (!window.SparkPrivacy) return;
    await window.SparkPrivacy.ready;
    if (S.cloud.enabled) document.body.style.visibility = 'hidden';
    let ready;
    try { ready = await S.cloud.init(); }
    finally { document.body.style.visibility = ''; }
    if (!ready) return;
    const shared=document.createElement('div');shared.innerHTML='<div id="toast" class="toast" hidden role="status" aria-live="polite"></div><dialog id="nav-dialog" aria-labelledby="nav-title"><div class="card-head"><h2 id="nav-title">เมนูทั้งหมด</h2><button class="btn small secondary" data-close>ปิด</button></div><nav id="all-nav"></nav></dialog><dialog id="role-dialog" aria-labelledby="role-title"><div class="card-head"><h2 id="role-title">เลือกบทบาททดลอง</h2><button class="btn small secondary" data-close>ปิด</button></div><p class="small muted">ข้อมูลต่อเนื่องในเบราว์เซอร์เดียวกัน ทุกชื่อเป็นสมมติ</p><div id="role-list"></div></dialog><dialog id="confirm-dialog" aria-labelledby="confirm-title"><h2 id="confirm-title"></h2><p id="confirm-copy" style="margin-top:12px"></p><div class="actions"><button class="btn danger" id="confirm-yes">ยืนยัน</button><button class="btn secondary" data-close>กลับ</button></div></dialog><dialog id="notification-dialog" aria-labelledby="notification-title"><div class="card-head"><h2 id="notification-title">การแจ้งเตือน</h2><button class="btn small secondary" data-close>ปิด</button></div><p class="small muted">อ่านแจ้งเตือนไม่ได้แปลว่างานเสร็จ</p><div id="notification-list"></div></dialog>';
    document.body.append(shared);document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
    document.addEventListener('click',event=>{if(event.target.closest('[data-role-open]'))U.openRoles();});
    U.render();
  });
  window.addEventListener('spark:external',()=>U.toast('อีกแท็บเปลี่ยนข้อมูลแล้ว โหลดหน้านี้ใหม่ก่อนทำรายการ',true));
})(SPARK);
