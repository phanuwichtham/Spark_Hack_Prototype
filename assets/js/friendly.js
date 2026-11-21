(function(S){
  'use strict';
  const U=S.ui,e=U.e;
  let receipt=null,reviewing=false;
  const descriptions={
    dashboard:['หน้าหลัก','เลือกสิ่งที่ต้องการทำวันนี้'],
    cages:['กระชังของฉัน','เลือกกระชังเพื่อจดข้อมูล ดูการดูแล หรือติดตามการขาย'],
    'cage-detail':['ข้อมูลกระชัง','ดูบันทึกล่าสุดและเลือกสิ่งที่จะทำกับกระชังนี้'],
    'record-water':['จดข้อมูลวันนี้','เลือกสิ่งที่ตรวจพบ กรอกเฉพาะที่ทราบ แล้วตรวจทานก่อนบันทึก'],
    risk:['สิ่งที่ควรทำต่อ','อ่านสิ่งที่ต้องตรวจเพิ่ม แล้วเปิดงานดูแลหรือติดต่อผู้ประสาน'],
    tasks:['งานดูแลปลา','ดูว่างานไหนรอทำ ใครช่วยดูแล และบันทึกผลเมื่อทำแล้ว'],
    harvest:['นัดจับปลา','ตรวจวันจับ ปริมาณปลา และรายการขายที่เกี่ยวข้อง'],
    finance:['เงินของฉัน','แยกยอดหลังหักค่าใช้จ่าย เงินที่บันทึกว่าจ่ายแล้ว และยอดที่ยังไม่ได้รับ'],
    marketplace:['เลือกซื้อปลา','เลือกชนิดปลาและจำนวนที่ต้องการ แล้วส่งคำขอให้ผู้ประสานตรวจ'],
    order:['ขอซื้อปลา','ตรวจสินค้า ระบุวันรับ และตรวจยอดก่อนส่งคำขอ'],
    orders:['รายการซื้อขาย','เลือกรายการเพื่อดูว่าถึงขั้นไหนและมีอะไรที่ต้องตอบ'],
    'order-detail':['รายละเอียดซื้อขาย','ตรวจปริมาณ ราคา นัดหมาย และคำยืนยันของแต่ละฝ่าย'],
    allocation:['แบ่งปลาให้รายการซื้อ','เลือกกระชังและปริมาณ พร้อมระบุเหตุผลก่อนขอเจ้าของยืนยัน'],
    offers:['ข้อเสนอซื้อขาย','ตรวจจำนวน ราคา และวันรับก่อนตอบข้อเสนอ'],
    delivery:['นัดส่งและรับปลา','ดูนัดส่งและบันทึกน้ำหนักที่ร้านรับจริง'],
    lots:['ปลาที่จับแล้ว','ดูปลาที่เตรียมส่ง ปลาที่พักเย็น และประวัติแต่ละชุด'],
    'lot-detail':['ประวัติชุดปลา','ตรวจที่มาของปลา การส่งมอบ และหลักฐานที่เกี่ยวข้อง'],
    mortality:['จดจำนวนปลาตาย','บันทึกตามช่วงที่ตรวจจริง แยกตรวจแล้วไม่พบออกจากยังไม่ได้ตรวจ'],
    analytics:['ประวัติและผลวิเคราะห์','ดูข้อมูลที่ผ่านมาและผลวิเคราะห์ที่ยังอยู่ระหว่างทดลอง'],
    partners:['ร้านคู่ค้าและหลักฐาน','ติดตามการติดต่อร้านและเอกสารประกอบของปลา'],
    trips:['จดเที่ยวเรือ','บันทึกสิ่งที่ได้และค่าใช้จ่ายของเที่ยวที่ออกจริง'],
    traceability:['ประวัติการเลี้ยงปลา','ดูหรือบันทึกวิธีเลี้ยง อาหาร ยา และหลักฐานที่เกี่ยวข้อง'],
    guide:['วิธีใช้และทดลอง','เลือกคำแนะนำตามงาน หรือทดลองด้วยข้อมูลสมมติ'],
    help:['ให้ผู้ประสานช่วย','เตรียมข้อมูลที่จะบอกผู้ประสานและดูวิธีทำงานที่ใช้บ่อย']
  };
  function storageKey(){return 'spark-friendly-receipt:'+(S.cloud.enabled?'group:'+S.databaseConfig.workspace:'demo')+':'+U.user().id;}
  function insertBeforeContent(node){const heading=document.querySelector('main .page-heading');if(heading)heading.after(node);else document.querySelector('main')?.prepend(node);}
  function removeReceipt(){receipt=null;document.querySelector('#save-receipt')?.remove();}
  function drawReceipt(){
    if(!receipt)return;
    document.querySelector('#save-receipt')?.remove();
    const node=document.createElement('section');node.id='save-receipt';node.className='friendly-receipt'+(receipt.error?' friendly-failure':'');
    node.setAttribute('role',receipt.error?'alert':'status');node.tabIndex=-1;
    node.innerHTML='<button type="button" class="btn secondary receipt-close">ปิด</button><h2>'+e(receipt.title)+'</h2><p>'+e(receipt.message)+'</p>'+(receipt.detail?'<p>'+e(receipt.detail)+'</p>':'')+(receipt.error?'<p>สิ่งที่กรอกยังอยู่ในหน้านี้ ตรวจข้อความข้างช่องแล้วลองอีกครั้งได้</p>':'');
    node.querySelector('button').onclick=removeReceipt;insertBeforeContent(node);
    if(receipt.focus){node.focus({preventScroll:true});node.scrollIntoView({block:'start',behavior:'auto'});receipt.focus=false;}
  }
  function receiptFor(action,state){
    const names={RECORD_WATER:'บันทึกข้อมูลวันนี้แล้ว',RECORD_MORTALITY:'บันทึกผลตรวจปลาตายแล้ว',VOID_MORTALITY:'ยกเลิกบันทึกที่กรอกผิดแล้ว',ADD_CAGE:'เพิ่มกระชังแล้ว',ADJUST_CAGE:'ปรับจำนวนประมาณการแล้ว',CREATE_ORDER:'ส่งคำขอซื้อแล้ว',CONFIRM_ORDER:'บันทึกคำยืนยันแล้ว',ASSIST_CONFIRM:'บันทึกคำยืนยันของเจ้าของแล้ว',ALLOCATE:'บันทึกการแบ่งปลาแล้ว',CREATE_PLAN:'บันทึกร่างนัดจับแล้ว',APPROVE_PLAN:'อนุมัตินัดจับแล้ว',HARVEST:'บันทึกน้ำหนักจับจริงแล้ว',RECEIVE:'บันทึกน้ำหนักรับจริงแล้ว',DISPATCH:'บันทึกว่าส่งปลาแล้ว',COLLECT:'บันทึกว่ารับเงินจากร้านแล้ว',PAYOUT:'บันทึกว่าจ่ายเงินให้ผู้เลี้ยงแล้ว',RECORD_TRIP:'บันทึกเที่ยวเรือแล้ว',RECORD_CONTACT:'บันทึกการติดต่อแล้ว',RECORD_HUSBANDRY:'บันทึกการเลี้ยงแล้ว',SAVE_HUSBANDRY:'บันทึกการเลี้ยงแล้ว',SET_COSTS:'บันทึกค่าใช้จ่ายแล้ว',SET_LISTING:'บันทึกปริมาณเปิดขายแล้ว'};
    if(!names[action.type])return;
    let detail='บันทึกโดย '+U.user().name+' · '+S.util.date(state.demoNow);
    const cage=state.cages.find(c=>c.id===action.cageId);
    if(cage)detail='กระชัง '+cage.id+' · '+cage.name+' · '+detail;
    receipt={title:names[action.type],message:S.cloud.enabled?'บันทึกเข้าข้อมูลกลุ่มเรียบร้อยแล้ว':'บันทึกในชุดทดลองเรียบร้อยแล้ว ข้อมูลนี้เป็นข้อมูลสมมติ',detail,focus:true};
    try{sessionStorage.setItem(storageKey(),JSON.stringify(receipt));}catch(_){/* Current page retains it in memory. */}
  }
  function consumeReceipt(){
    try{const saved=sessionStorage.getItem(storageKey());if(saved){receipt=JSON.parse(saved);sessionStorage.removeItem(storageKey());}}catch(_){}
    drawReceipt();
  }
  function confirmTransaction(a){
    const types=['CONFIRM_ORDER','PAYOUT','COLLECT','RECEIVE','DISPATCH'];
    if(!types.includes(a.type))return Promise.resolve(true);
    if(reviewing)return Promise.resolve(false);
    const s=U.state(),u=U.user();
    let title='',lines=[],yes='ยืนยันรายการนี้';
    if(a.type==='CONFIRM_ORDER'){
      const o=U.allowedOrders(s).find(o=>o.id===a.orderId);
      if(!o)return Promise.resolve(true);
      const ownCages=s.cages.filter(c=>c.ownerId===u.id).map(c=>c.id);
      const amount=u.role==='farmer'?s.reservations.filter(r=>r.orderId===o.id&&ownCages.includes(r.cageId)&&r.status!=='released').reduce((n,r)=>n+r.kg,0):o.allocatedKg;
      title=u.role==='farmer'?'ตรวจรายการก่อนยืนยันขาย':'ตรวจรายการก่อนยืนยันซื้อ';
      lines=['รายการ '+o.id,'ปลา: '+(s.products.find(p=>p.id===o.productId)?.name||''),'ปริมาณที่ยืนยัน: '+S.util.kg(amount),'ราคา: '+S.util.money(o.priceSatang)+' ต่อกิโลกรัม','มูลค่าก่อนหักรายการที่ตกลง: '+S.util.money(Math.round(amount*o.priceSatang)),'วันรับปลา: '+o.receiveDate+' '+o.window,'สถานที่: '+o.place];
      const plans=s.plans.filter(p=>(o.planIds||[o.planId]).includes(p.id));
      if(plans.length)lines.push('ค่าใช้จ่ายที่ระบุไว้ระดับแผน: '+plans.map(p=>S.util.money(p.costs.pack+p.costs.transport+p.costs.group)).join(' / ')+' คิดระดับแผน ไม่หักเต็มก้อนซ้ำทุกรายการ');
      else lines.push('ยังไม่มีค่าใช้จ่ายในแผน ให้ตรวจสอบยอดหักกับผู้ประสานก่อนตอบรับ');
      yes=u.role==='farmer'?'ยืนยันขายตามรายการนี้':'ยืนยันซื้อตามรายการนี้';
    }else if(a.type==='PAYOUT'){
      const p=U.allowedPlans(s).find(p=>p.id===a.planId);if(!p)return Promise.resolve(true);
      title='บันทึกว่าจ่ายเงินแล้ว';lines=['แผน '+p.id,'ผู้รับ: '+(s.users.find(x=>x.id===s.cages.find(c=>c.id===p.cageId)?.ownerId)?.name||''),'จำนวน: '+S.util.money(S.calc.finance(s,p.id).unpaid),'กดเมื่อจ่ายเงินจริงและตรวจหลักฐานแล้ว การกดนี้เป็นการลงบันทึกในเว็บ'];
      yes='จ่ายเงินจริงแล้ว บันทึกรายการ';
    }else if(a.type==='COLLECT'){
      const o=U.allowedOrders(s).find(o=>o.id===a.orderId);if(!o)return Promise.resolve(true);
      title='บันทึกว่ารับเงินแล้ว';lines=['รายการ '+o.id,'ยอดตามน้ำหนักที่ร้านรับจริง: '+S.util.money(Math.round(o.acceptedKg*o.priceSatang)),'กดเมื่อได้รับเงินจริงและตรวจหลักฐานแล้ว'];yes='ได้รับเงินจริงแล้ว บันทึกรายการ';
    }else{
      const d=s.deliveries.find(d=>d.id===a.deliveryId);if(!d)return Promise.resolve(true);
      title=a.type==='RECEIVE'?'ตรวจน้ำหนักก่อนยืนยันรับปลา':'ตรวจรายการก่อนบันทึกส่ง';
      lines=['รอบส่ง '+d.id,'น้ำหนักส่ง: '+S.util.kg(d.kg)];
      if(a.type==='RECEIVE'){lines.push('น้ำหนักที่รับจริง: '+S.util.kg(Number(a.acceptedKg)));if(a.issue)lines.push('สิ่งที่แจ้ง: '+a.issue);yes='ยืนยันน้ำหนักที่รับจริง';}
      else{lines.push('กดเมื่อส่งปลาออกตามรายการนี้แล้ว');yes='ส่งปลาแล้ว บันทึกรายการ';}
    }
    reviewing=true;
    return new Promise(resolve=>{
      let dlg=document.querySelector('#transaction-review');
      if(!dlg){dlg=document.createElement('dialog');dlg.id='transaction-review';dlg.setAttribute('aria-labelledby','transaction-title');document.body.append(dlg);}
      dlg.innerHTML='<h2 id="transaction-title">'+e(title)+'</h2><p class="confirm-copy" style="margin-top:18px">'+e(lines.join('\n'))+'</p>'+(S.cloud.enabled?'':'<p class="notice" style="margin-top:18px">รายการนี้เป็นการทดลองด้วยข้อมูลสมมติ</p>')+'<div class="actions"><button class="btn" type="button" id="transaction-yes">'+e(yes)+'</button><button class="btn secondary" type="button" id="transaction-back">กลับไปตรวจอีกครั้ง</button></div>';
      let settled=false;
      function finish(value){if(settled)return;settled=true;reviewing=false;dlg.close();resolve(value);}
      dlg.querySelector('#transaction-yes').onclick=()=>finish(true);
      dlg.querySelector('#transaction-back').onclick=()=>finish(false);
      dlg.oncancel=event=>{event.preventDefault();finish(false);};
      dlg.showModal();dlg.querySelector('#transaction-back').focus();
    });
  }
  function tools(){
    let node=document.querySelector('#friendly-tools');
    if(!node){node=document.createElement('section');node.id='friendly-tools';node.className='friendly-tools';document.querySelector('main.page')?.prepend(node);}
    const u=U.user();
    node.innerHTML='<div class="friendly-person"><strong>'+e(u.name)+'</strong><small>'+e(S.config.roleNames[u.role])+' · '+(S.cloud.enabled?'ข้อมูลของกลุ่ม':'กำลังทดลองด้วยข้อมูลสมมติ')+'</small></div><div class="actions"><button type="button" id="friendly-font" class="btn secondary" aria-pressed="'+document.body.classList.contains('large-text')+'">'+(document.body.classList.contains('large-text')?'ตัวอักษรขนาดปกติ':'ขยายตัวอักษร')+'</button><a class="btn secondary" id="friendly-help-shortcut" href="help.html">ให้ผู้ประสานช่วย</a></div>';
    node.querySelector('#friendly-font').onclick=()=>{document.body.classList.toggle('large-text');try{localStorage.setItem('spark-friendly-large',document.body.classList.contains('large-text')?'1':'0');}catch(_){}tools();};
  }
  function clarifyMortality(){
    const f=document.querySelector('#mortality-form');if(!f)return;
    const select=f.elements.inspection;
    const sync=()=>{f.elements.deaths.disabled=select.value==='unknown';f.elements.deaths.required=select.value==='checked';};
    select.addEventListener('change',sync);sync();
    const labels={periodStart:'ตรวจตั้งแต่เมื่อไร (เวลาไทย)',periodEnd:'ตรวจถึงเมื่อไร (เวลาไทย)',population:'จำนวนปลาโดยประมาณตอนเริ่มช่วงตรวจ (ตัว)',deaths:'พบปลาตายกี่ตัวในช่วงนี้'};
    for(const[name,label]of Object.entries(labels)){const field=f.elements[name];if(field)f.querySelector('label[for="'+field.id+'"]').textContent=label;}
    const extra=document.createElement('details');extra.className='friendly-details wide';extra.innerHTML='<summary>สาเหตุที่สงสัยและสิ่งที่ทำเพื่อดูแลเพิ่มเติม</summary>';
    for(const name of ['causeStatus','cause','causeEvidence','response']){const field=f.elements[name];if(field)extra.append(field.closest('.field'));}
    f.querySelector('.pilot-fields').append(extra);
  }
  function mount(){
    const main=document.querySelector('main.page');if(!main)return;
    document.body.dataset.role=U.user().role;
    const page=document.body.dataset.page,info=descriptions[page];
    if(info){const heading=main.querySelector('.page-heading');if(heading){const h=heading.querySelector('h1'),p=heading.querySelector('p');if(h)h.textContent=(page==='cages'&&U.user().role==='coordinator')?'กระชังในกลุ่ม':(page==='finance'&&U.user().role==='coordinator')?'เงินรับและจ่ายของกลุ่ม':info[0];if(p)p.textContent=info[1];document.title=(h?.textContent||info[0])+' | ปลาศาลาหุม';}}
    tools();consumeReceipt();
    const demo=document.querySelector('#demo-steps');
    if(demo&&!demo.closest('#friendly-demo-guide')){const disclosure=document.createElement('details');disclosure.id='friendly-demo-guide';disclosure.className='friendly-details';disclosure.innerHTML='<summary>ตัวช่วยเดินตามขั้นตอนทดลอง</summary>';demo.before(disclosure);disclosure.append(demo);}
    if(page==='mortality')clarifyMortality();
    main.querySelectorAll('input[type=number]').forEach(x=>{if(!x.inputMode)x.inputMode=x.step&&x.step!=='1'?'decimal':'numeric';});
    main.querySelectorAll('a[href]').forEach(a=>{const href=a.getAttribute('href');if(!href||href[0]==='#')return;const url=new URL(href,location.href);if(url.origin===location.origin&&url.pathname.endsWith('.html')&&!url.searchParams.has('mode')){url.searchParams.set('mode',S.cloud.enabled?'group':'demo');a.setAttribute('href',url.pathname.split('/').pop()+url.search+url.hash);}});
  }
  S.friendly={mount,receiptFor,confirmTransaction,
    busy(on){const f=document.querySelector('#'+(document.activeElement?.form?.id||'water-form'));if(f)f.setAttribute('aria-busy',String(on));if(on)removeReceipt();},
    failed(error){receipt={title:'ยังไม่ได้บันทึกสำเร็จ',message:error.message,error:true,focus:true};drawReceipt();}
  };
  try{document.body.classList.toggle('large-text',localStorage.getItem('spark-friendly-large')==='1');}catch(_){}
  const original=S.page;S.page=function(){original?.();mount();};
  document.addEventListener('invalid',event=>{for(let node=event.target.parentElement;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;},true);
})(SPARK);
