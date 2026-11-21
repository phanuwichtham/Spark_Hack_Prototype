(function(){
  const frame=document.querySelector('#preview'),status=document.querySelector('#status'),report=document.querySelector('#report');
  const rows=[['dashboard.html','farmer'],['cages.html','farmer'],['cage-detail.html?id=C01','farmer'],['record-water.html?cage=C01','farmer'],['harvest.html','farmer'],['finance.html','farmer'],['mortality.html','farmer'],['tasks.html','farmer'],['traceability.html?cage=C01','farmer'],['help.html','farmer'],['guide.html','farmer'],['analytics.html','farmer'],['trips.html','farmer'],['marketplace.html','buyer'],['order.html?product=P01','buyer'],['orders.html','buyer'],['offers.html','buyer'],['delivery.html','buyer'],['allocation.html','coordinator'],['partners.html','coordinator'],['lots.html','coordinator'],['dashboard.html','coordinator'],['risk.html?cage=C01','farmer'],['order-detail.html?id=missing','buyer'],['lot-detail.html?id=missing','coordinator'],['index.html','farmer'],['reset-password.html','farmer']];
  const settle=()=>{frame.getBoundingClientRect();frame.contentDocument.documentElement.getBoundingClientRect();return Promise.resolve();};
  document.querySelector('#run').onclick=async()=>{
    document.querySelector('#run').disabled=true;let checks=0;const errors=[];report.textContent='';
    for(const [route,role]of rows){
      status.textContent='กำลังตรวจ '+route+' · '+role;
      await new Promise(resolve=>{frame.onload=resolve;frame.src='../'+route+(route.includes('?')?'&':'?')+'mode=demo&as='+role;});
      let doc=frame.contentDocument;doc.querySelector('#privacy-accept')?.click();
      const standalone=['index.html','reset-password.html'].includes(route);
      for(let n=0;n<100&&!standalone&&!doc.querySelector('#friendly-tools');n++)await new Promise(resolve=>setTimeout(resolve,30));
      if(!standalone&&!doc.querySelector('#friendly-tools'))errors.push(route+': หน้าหรือเมนูเปิดไม่ครบ');
      const ids=[...doc.querySelectorAll('[id]')].map(x=>x.id);if(new Set(ids).size!==ids.length)errors.push(route+': รหัสช่องซ้ำ');
      for(const width of [320,375,768,1280]){
        frame.width=String(width);await settle();
        if(doc.documentElement.scrollWidth>width+1)errors.push(route+' '+width+': เนื้อหาล้นจอ '+doc.documentElement.scrollWidth);
        for(const el of doc.querySelectorAll('button.btn,input:not([type=hidden]):not([type=checkbox]):not([type=radio]),.bottom-nav a')){const rect=el.getBoundingClientRect();if(rect.width&&rect.height&&rect.height<44)errors.push(route+' '+width+': ปุ่มหรือช่องเล็กเกินไป '+(el.textContent||el.id).trim().slice(0,40));}
        checks++;
      }
      if(role==='farmer'&&['dashboard.html','record-water.html?cage=C01','finance.html'].includes(route)){const wasLarge=doc.body.classList.contains('large-text');if(!wasLarge)doc.querySelector('#friendly-font').click();frame.width='320';await settle();if(doc.documentElement.scrollWidth>321)errors.push(route+' ตัวอักษรใหญ่: เนื้อหาล้นจอ');if(!wasLarge)doc.querySelector('#friendly-font').click();checks++;}
      if(role==='farmer'&&route==='dashboard.html'&&doc.querySelectorAll('.quick-actions .quick-action').length!==4)errors.push('หน้าหลักผู้เลี้ยง: ปุ่มหลักไม่ครบ 4 งาน');
      if(role==='buyer'&&doc.querySelector('.bottom-nav a[href="finance.html"]'))errors.push('ผู้ซื้อเห็นเมนูเงินผู้เลี้ยง');
      report.textContent+='ตรวจแล้ว '+route+' · '+role+'\n';
    }
    status.textContent='ตรวจครบ '+checks+' กรณี · พบปัญหา '+errors.length+' รายการ';report.textContent+='\n'+(errors.length?errors.join('\n'):'ผ่านทั้งหมด');document.querySelector('#run').disabled=false;
  };
})();
