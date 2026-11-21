/* Small additions to existing screens, preserving their transaction handlers. */
(function(S){
  'use strict';
  const original=S.page;
  if(!original)return;
  S.page=function(){
    original();
    const U=S.ui,e=U.e,s=S.pilot.ensure(U.state()),u=U.user(),page=document.body.dataset.page,main=document.querySelector('main');
    if(!main)return;
    main.querySelectorAll('[data-pilot-extra]').forEach(x=>x.remove());
    const section=html=>{const el=document.createElement('section');el.dataset.pilotExtra='';el.className='card pilot-view pilot-tools';el.innerHTML=html;main.querySelector('footer')?.before(el);return el;};
    const options=rows=>rows.map(([v,t])=>'<option value="'+e(v)+'">'+e(t)+'</option>').join('');
    const error='<div class="form-error" role="alert" hidden></div>';
    if(page==='cages'&&u.role!=='buyer')document.querySelector('h1').textContent=u.role==='farmer'?'กระชังของฉัน':'กระชังในโครงการ';
    if(page==='dashboard'){
      const target=document.querySelector('#dashboard-greeting');
      if(u.role==='farmer'){const saleLink=main.querySelector('aside a[href="marketplace.html"]');if(saleLink){saleLink.href='harvest.html';saleLink.textContent='ดูแผนจับของฉัน';}}
      if(u.role==='coordinator')section('<h2>ข้อมูลและการพัฒนารายได้</h2><div class="actions">'+U.link('traceability.html','ประวัติการเลี้ยงปลา')+U.link('mortality.html','บันทึกการตาย')+U.link('analytics.html','ประวัติและ Machine Learning')+U.link('trips.html','ต้นทุนเที่ยวเรือ')+(u.role==='coordinator'?U.link('partners.html','GI และตลาด Thai SELECT'):'')+'</div><p class="small">'+(S.cloud.enabled?'ใช้ข้อมูลที่บัญชีนี้มีสิทธิ์เข้าถึง':'โหมดเดโมใช้ข้อมูลสมมติ การฝึก ML สังเคราะห์เปิดจากหน้าประวัติและ Machine Learning')+'</p>');
    }
    if(page==='record-water'&&u.role!=='buyer'&&!document.querySelector('[data-friendly-water]')){
      const f=document.querySelector('main form');
      if(f&&!f.querySelector('[name=sourceName]')){
        const el=document.createElement('details');el.className='pilot-source';el.innerHTML='<summary>บันทึกแทน / แหล่งข้อมูล</summary><div class="field"><label for="water-source-name">ผู้ให้ข้อมูล</label><input id="water-source-name" name="sourceName" value="'+e(u.name)+'" maxlength="200"></div><div class="field"><label for="water-channel">ช่องทาง</label><select id="water-channel" name="channel">'+options([['self','บันทึกเอง'],['phone','โทรศัพท์'],['line','LINE / ข้อความ'],['inperson','พบตัว']])+'</select></div><p class="small">ระบบเก็บบัญชีผู้บันทึกแยกจากผู้ให้ข้อมูล</p>';f.querySelector('button[type=submit],button.btn')?.before(el);S.retry.restore(f);
      }
      section('<h2>บันทึกจำนวนที่ตรวจพบ</h2><p>หากพบปลาตาย ให้บันทึกจำนวนและช่วงเวลาที่ตรวจ เพื่อใช้ดูประวัติและพัฒนาโมเดล</p>'+U.link('mortality.html','บันทึกการตาย'));
    }
    if(page==='tasks'&&u.role!=='buyer'){
      const ids=U.allowedCages(s).map(c=>c.id),incidents=s.incidents.filter(i=>ids.includes(i.cageId)&&i.status!=='closed');
      const el=section('<h2>ติดต่อและติดตามเหตุ</h2><p>บันทึกการติดต่อจริง แยกจากการอ่านแจ้งเตือนในเว็บ ช่องทาง LINE/SMS อัตโนมัติยังไม่ได้เชื่อม</p><form id="pilot-contact"><div class="pilot-fields"><div class="field"><label for="contact-incident">เหตุที่รับเรื่อง</label><select id="contact-incident" name="incidentId">'+options(incidents.map(i=>[i.id,i.id+' · '+i.cageId]))+'</select></div><div class="field"><label for="contact-outcome">ผลการติดต่อ</label><select id="contact-outcome" name="outcome">'+options([['unreached','ยังติดต่อไม่ได้'],['reached','ติดต่อได้แล้ว'],['responding','เริ่มรับมือ'],['followup','รอติดตาม']])+'</select></div><div class="field"><label for="contact-backup">ผู้ประสานสำรอง</label><select id="contact-backup" name="backupId"><option value="">ยังไม่ระบุ</option>'+options(s.users.filter(x=>x.role==='coordinator').map(x=>[x.id,x.name]))+'</select></div><div class="field"><label for="contact-next">นัดติดตาม (ไทย)</label><input id="contact-next" name="nextAt" type="datetime-local"></div><div class="field"><label for="contact-phone">เบอร์ที่ได้รับอนุญาตให้ติดต่อ</label><input id="contact-phone" name="phone" type="tel"><a class="btn secondary small" id="pilot-dial" hidden>โทร</a></div><div class="field"><label for="contact-note">ผลที่ได้รับ / งานถัดไป</label><textarea id="contact-note" name="note" required maxlength="1000"></textarea></div></div>'+error+'<button class="btn">บันทึกผลการติดต่อ</button></form><div class="pilot-source">'+s.contacts.filter(c=>c.incidentId&&incidents.some(i=>i.id===c.incidentId)).slice(-8).reverse().map(c=>'<p>'+e(c.incidentId)+' · '+e(c.outcome)+' · '+e(S.util.date(c.recordedAt))+'<br>'+e(c.note)+'</p>').join('')+'</div>');
      U.form(el.querySelector('form'),fd=>{const d=Object.fromEntries(fd);return U.submit({type:'RECORD_CONTACT',...d,channel:'phone',sourceName:u.name,nextAt:d.nextAt?S.util.fromThaiTime(d.nextAt):null});});
      const phone=el.querySelector('[name=phone]'),dial=el.querySelector('#pilot-dial');phone.oninput=()=>{const n=phone.value.replace(/[^+0-9]/g,'');dial.hidden=!n;dial.href='tel:'+n;};
    }
    if(page==='allocation'&&u.role==='coordinator'){
      const since=new Date(s.demoNow)-30*86400000;
      section('<h2>ประวัติเพื่อประกอบการจัดสรร</h2><p>ตรวจชนิด ขนาด ปริมาณที่เจ้าของเสนอขาย และรอบส่งก่อนพิจารณาหมุนเวียนในรายที่มีเงื่อนไขใกล้เคียงกัน ผู้ประสานบันทึกเหตุผลและให้เจ้าของยืนยัน</p><div class="pilot-scroll"><table><thead><tr><th>กระชัง / เจ้าของ</th><th>จัดสรรที่ยังมีผลในรายการซื้อขาย 30 วัน</th><th>พร้อมเสนอขายประมาณการ</th></tr></thead><tbody>'+s.cages.map(c=>{const kg=s.reservations.filter(r=>r.cageId===c.id&&r.status!=='released'&&s.orders.some(o=>o.id===r.orderId&&new Date(o.createdAt)>=since&&o.status!=='cancelled')).reduce((n,r)=>n+r.kg,0);return '<tr><td>'+e(c.id)+' · '+e(s.users.find(x=>x.id===c.ownerId)?.name)+'</td><td>'+S.util.kg(kg)+'</td><td>'+S.util.kg(Math.min(c.offerKg||0,S.calc.available(s,c.id)))+'</td></tr>';}).join('')+'</tbody></table></div><p class="small">ประวัติใช้ประกอบการตัดสินใจ ไม่ใช่คำสั่งแบ่งรายได้เท่ากัน และไม่ถือว่าปลาทั้งหมดพร้อมขาย</p>');
    }
    if(page==='order'&&u.role==='buyer'){
      const spec=s.buyerSpecs.filter(x=>x.buyerId===u.id).slice(-1)[0];
      section('<h2>สเปกประจำร้านสำหรับคำขอครั้งถัดไป</h2><p>บันทึกก่อนส่งคำขอซื้อ เพื่อแนบช่วงขนาดและรูปแบบสินค้าให้ผู้ประสานตรวจ</p><form id="pilot-spec"><div class="pilot-fields"><div class="field"><label for="spec-min">น้ำหนักต่อตัวต่ำสุด (กก.)</label><input id="spec-min" name="minKg" type="number" min="0" step="0.1" required value="'+e(spec?.minKg??'')+'"></div><div class="field"><label for="spec-max">น้ำหนักต่อตัวสูงสุด (กก.)</label><input id="spec-max" name="maxKg" type="number" min="0" step="0.1" required value="'+e(spec?.maxKg??'')+'"></div><div class="field"><label for="spec-format">รูปแบบสินค้า</label><input id="spec-format" name="format" required value="'+e(spec?.format||'ปลาทั้งตัว')+'"></div><div class="field"><label for="spec-note">ข้อกำหนดเพิ่มเติม</label><input id="spec-note" name="note" value="'+e(spec?.note||'')+'"></div></div>'+error+'<button class="btn secondary">บันทึกสเปกร้าน</button></form>');
      U.form(document.querySelector('#pilot-spec'),fd=>U.submit({type:'SET_BUYER_SPEC',...Object.fromEntries(fd)}));
    }
    if(page==='order-detail'){
      const o=U.allowedOrders(s).find(x=>x.id===S.util.query('id'));
      if(!o)return;
      const p=s.plans.find(p=>p.id===o.planId),costs=p?.costs;
      section('<h2>สเปกและค่าใช้จ่ายประกอบการยืนยัน</h2><p>'+(o.buyerSpec?e(o.buyerSpec.minKg)+'–'+e(o.buyerSpec.maxKg)+' กก./ตัว · '+e(o.buyerSpec.format)+'<br>'+e(o.buyerSpec.note):'ร้านยังไม่ได้แนบช่วงขนาดเพิ่มเติม')+'</p><p>ราคา '+S.util.money(o.priceSatang)+'/กก.<br>'+(costs?'ค่าใช้จ่ายระดับแผน: แพ็ก '+S.util.money(costs.pack)+' · ขนส่ง '+S.util.money(costs.transport)+' · ประสานงาน '+S.util.money(costs.group):'ค่าแพ็ก ขนส่ง และประสานงาน: ยังไม่มีแผนค่าใช้จ่าย ต้องตกลงกับเจ้าของก่อนยืนยัน')+'</p><p class="small">ค่าใช้จ่ายระดับแผนไม่ใช่ยอดหักเต็มจำนวนซ้ำในแต่ละรายการซื้อขาย เงินหลังหักค่าใช้จ่ายยังไม่ใช่กำไรหลังหักต้นทุนเลี้ยงทั้งหมด</p>');
      if(u.role==='coordinator'&&['allocated','waiting'].includes(o.status)){
        const ownerIds=[...new Set((o.cageIds||[o.cageId]).map(id=>s.cages.find(c=>c.id===id)?.ownerId))];
        const el=section('<h2>บันทึกคำยืนยันที่ได้รับจากเจ้าของ</h2><p>ใช้เมื่อเจ้าของให้ทีมช่วยบันทึก ระบบเก็บผู้บันทึกและช่องทางแยกจากเจ้าของปลา</p><form id="assist-confirm"><div class="field"><label for="assist-owner">เจ้าของผู้ให้คำยืนยัน</label><select id="assist-owner" name="ownerId">'+options(ownerIds.filter(id=>!(o.farmerConfirmations||[]).includes(id)).map(id=>[id,s.users.find(x=>x.id===id)?.name||id]))+'</select></div><div class="field"><label for="assist-channel">ช่องทาง</label><select id="assist-channel" name="channel">'+options([['phone','โทรศัพท์'],['inperson','พบตัว'],['line','LINE / ข้อความ']])+'</select></div><div class="field"><label for="assist-proof">คำยืนยันที่ได้รับ: ปริมาณ ราคา และค่าใช้จ่ายที่ตกลง</label><textarea id="assist-proof" name="confirmationEvidence" required maxlength="1000"></textarea></div>'+error+'<button class="btn">บันทึกคำยืนยันจากเจ้าของ</button></form>');
        U.form(el.querySelector('form'),fd=>U.submit({type:'ASSIST_CONFIRM',orderId:o.id,...Object.fromEntries(fd)}));
      }
      const confirmations=o.assistedConfirmations||[];if(confirmations.length)section('<h2>หลักฐานการยืนยันผ่านผู้ช่วย</h2>'+confirmations.map(c=>'<p>'+e(s.users.find(x=>x.id===c.ownerId)?.name||c.ownerId)+' · '+e(c.channel)+' · '+e(S.util.date(c.at))+'<br>'+e(c.evidence)+'<br>บันทึกโดย '+e(s.users.find(x=>x.id===c.recorderId)?.name||c.recorderId)+'</p>').join(''));
    }
    if(page==='lot-detail'&&u.role!=='buyer'){
      const id=S.util.query('id'),records=s.giRecords.filter(g=>g.lotId===id);
      if(records.length)section('<h2>หลักฐาน GI ที่เชื่อมกับล็อต</h2>'+records.map(g=>'<p>ทะเบียนผู้ผลิต '+e(g.producerRef)+'<br>น้ำหนักขั้นต่ำที่ตรวจ '+e(g.minFishKg)+' กก./ตัว<br>'+e(g.evidence)+'<br>บันทึกเอกสารโดย '+e(g.reviewer)+'</p>').join('')+'<p class="small">แสดงเอกสารประกอบ ไม่ใช่ตราที่ออกโดยเว็บไซต์</p>');
    }
  };
})(SPARK);
