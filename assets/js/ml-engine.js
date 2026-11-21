/* Logistic regression trained in this browser. No preset prediction percentages.
 * Target: at least one observed death in a completed 24-hour inspection window.
 * Features must have been measured AND received before that window begins.
 * Experimental predictions never change care, sales, or harvest approvals.
 */
(function(S){
  'use strict';
  const DAY=86400000, names=['DO','ความเค็ม','อุณหภูมิ','pH','การเปลี่ยน DO','การเปลี่ยนความเค็ม','ชนิดปลา','เดือน sin','เดือน cos'];
  const time=x=>new Date(x).getTime(), sigmoid=z=>1/(1+Math.exp(-Math.max(-35,Math.min(35,z))));
  const average=a=>a.reduce((n,x)=>n+x,0)/a.length;
  function features(s,cage,at,synthetic){
    const t=time(at);
    const rows=(synthetic?(s.mlObservations||[]):s.observations).filter(o=>o.cageId===cage.id&&!!o.synthetic===synthetic&&time(o.measuredAt)<=t&&time(o.receivedAt||o.measuredAt)<=t)
      .sort((a,b)=>time(b.measuredAt)-time(a.measuredAt));
    const o=rows.find(x=>['do','salinity','temperature','ph'].every(k=>typeof x.values[k]==='number'&&Number.isFinite(x.values[k])));
    if(!o||t-time(o.measuredAt)>4*3600000)return null;
    const previous=rows.find(x=>x.id!==o.id&&x.point===o.point&&x.source===o.source&&time(x.measuredAt)<time(o.measuredAt)&&time(o.measuredAt)-time(x.measuredAt)<=DAY&&Number.isFinite(x.values.do)&&Number.isFinite(x.values.salinity));
    const month=new Date(t+7*3600000).getUTCMonth(),v=o.values;
    return {x:[v.do,v.salinity,v.temperature,v.ph,previous?v.do-previous.values.do:0,previous?v.salinity-previous.values.salinity:0,cage.species==='seabass'?1:0,Math.sin(month*Math.PI/6),Math.cos(month*Math.PI/6)],observationId:o.id,measuredAt:o.measuredAt};
  }
  function dataset(s,synthetic){
    return (s.mortalities||[]).filter(r=>!r.voidedAt&&r.inspection==='checked'&&!!r.synthetic===synthetic&&time(r.periodEnd)<=time(s.demoNow)&&Math.abs(time(r.periodEnd)-time(r.periodStart)-DAY)<60000)
      .flatMap(r=>{const c=s.cages.find(c=>c.id===r.cageId),f=c&&features(s,c,r.periodStart,synthetic);return f?[{...f,y:r.deaths>0?1:0,at:r.periodStart,end:r.periodEnd,labelAvailableAt:r.recordedAt||r.periodEnd,cageId:r.cageId,recordId:r.id}]:[];})
      .sort((a,b)=>time(a.at)-time(b.at)).slice(-4000);
  }
  function score(model,x){const z=x.map((v,j)=>(v-model.means[j])/model.scales[j]);return sigmoid(model.weights[0]+z.reduce((v,x,j)=>v+x*model.weights[j+1],0));}
  function train(s,synthetic){
    if(!synthetic&&(s.mortalities||[]).some(r=>r.synthetic))throw Error('แยกข้อมูลสังเคราะห์ออกจากชุดข้อมูลจริงก่อนฝึก');
    const rows=dataset(s,synthetic);
    // Engineering gates for this pilot, not proof of field validity.
    if(rows.length<40)throw Error('ยังมีข้อมูลใช้ฝึกไม่พอ: ต้องมีอย่างน้อย 40 ช่วงตรวจ 24 ชั่วโมงพร้อมค่าน้ำก่อนเริ่มช่วง (เกณฑ์ทดลองของระบบ)');
    const cutoff=time(rows[Math.floor(rows.length*.75)].at);
    const training=rows.filter(r=>time(r.end)<cutoff&&time(r.labelAvailableAt)<cutoff),test=rows.filter(r=>time(r.at)>=cutoff);
    const positives=a=>a.filter(r=>r.y===1).length;
    if(training.length<20||test.length<10||positives(training)<3||training.length-positives(training)<3||positives(test)<2||test.length-positives(test)<2)
      throw Error('ช่วงฝึก/ทดสอบยังไม่ครอบคลุมทั้งวันที่พบตายและไม่พบตายเพียงพอ เก็บข้อมูลเพิ่มก่อน');
    const means=names.map((_,j)=>average(training.map(r=>r.x[j]))),scales=names.map((_,j)=>Math.sqrt(average(training.map(r=>(r.x[j]-means[j])**2)))||1);
    const weights=Array(names.length+1).fill(0),X=training.map(r=>[1,...r.x.map((v,j)=>(v-means[j])/scales[j])]);
    for(let epoch=0;epoch<450;epoch++){
      const grad=weights.map(()=>0);
      X.forEach((x,i)=>{const error=sigmoid(x.reduce((z,v,j)=>z+v*weights[j],0))-training[i].y;x.forEach((v,j)=>grad[j]+=error*v);});
      weights.forEach((_,j)=>weights[j]-=.12*(grad[j]/X.length+(j?.015*weights[j]:0)));
    }
    const model={id:S.util.id('ML'),algorithm:'logistic-regression-v1',featureNames:names,means,scales,weights,synthetic,horizonHours:24,trainedAt:s.demoNow,
      target:'พบปลาตายอย่างน้อยหนึ่งตัวในช่วงตรวจ 24 ชั่วโมง',operationallyValidated:false,trainCount:training.length,testCount:test.length,
      cutoff:new Date(cutoff).toISOString(),trainLastEnd:training[training.length-1].end,firstAt:rows[0].at,lastAt:rows[rows.length-1].end,
      trainingRecordIds:training.map(r=>r.recordId),testRecordIds:test.map(r=>r.recordId)};
    const base=average(training.map(r=>r.y));let brier=0,baselineBrier=0,tp=0,fp=0,fn=0,tn=0;
    test.forEach(r=>{const p=score(model,r.x);brier+=(p-r.y)**2;baselineBrier+=(base-r.y)**2;if(p>=.5){if(r.y)tp++;else fp++;}else if(r.y)fn++;else tn++;});
    model.metrics={brier:brier/test.length,baselineBrier:baselineBrier/test.length,tp,fp,fn,tn,recall:tp+fn?tp/(tp+fn):null,precision:tp+fp?tp/(tp+fp):null};
    // Raw identifiers are not necessary to run or share a model.
    delete model.trainingRecordIds;delete model.testRecordIds;
    return model;
  }
  function predict(s,cage,model){
    if(!model)return {available:false,reason:'ยังไม่มีโมเดลที่ฝึกจากประวัติชุดนี้'};
    if(model.invalidatedAt)return {available:false,reason:'มีการแก้ไขประวัติ ต้องฝึกและประเมินโมเดลใหม่'};
    if(model.algorithm!=='logistic-regression-v1')return {available:false,reason:'รุ่นโมเดลไม่รองรับ'};
    if(model.metrics.brier>=model.metrics.baselineBrier)return {available:false,reason:'โมเดลยังไม่ดีกว่าค่าฐานในช่วงทดสอบ'};
    // Demo seed values are never a substitute for live observations.
    const f=features(s,cage,s.demoNow,!!model.synthetic);
    if(!f)return {available:false,reason:'ต้องมีค่าน้ำครบทั้ง 4 ค่า อายุไม่เกิน 4 ชั่วโมง และแหล่งข้อมูลตรงกับโมเดล'};
    return {available:true,score:score(model,f.x),issuedAt:s.demoNow,until:new Date(time(s.demoNow)+DAY).toISOString(),...f,modelId:model.id,synthetic:model.synthetic};
  }
  function syntheticHistory(s){
    let seed=73629;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
    const observations=[],mortalities=[],now=time(s.demoNow),last=Math.floor(now/DAY)*DAY;
    for(let d=120;d>=1;d--)for(const c of s.cages){
      const start=last-d*DAY,end=start+DAY,bad=random()<.32;
      const values={do:bad?1.8+random()*2.3:4.5+random()*2,salinity:bad?3+random()*13:18+random()*12,temperature:27+random()*5,ph:7.1+random()*.9};
      const probability=sigmoid(1.8-(values.do-2)*1.2-(values.salinity-8)*.09+(c.species==='seabass'?-.7:0));
      const deaths=random()<probability?1+Math.floor(random()*8):0;
      observations.push({id:'SYN-O-'+c.id+'-'+d,cageId:c.id,values,measuredAt:new Date(start).toISOString(),receivedAt:new Date(start).toISOString(),source:'ข้อมูลสังเคราะห์ ML',point:'จุดจำลอง',symptoms:[],synthetic:true});
      mortalities.push({id:'SYN-M-'+c.id+'-'+d,cageId:c.id,periodStart:new Date(start).toISOString(),periodEnd:new Date(end).toISOString(),recordedAt:new Date(end).toISOString(),population:300,deaths,inspection:'checked',causeStatus:'unknown',cause:'',sourceName:'ชุดสังเคราะห์',channel:'synthetic',synthetic:true});
    }
    // A fresh input for the demo prediction; the future outcome is not generated.
    for(const c of s.cages)observations.push({id:'SYN-LATEST-'+c.id,cageId:c.id,values:{do:c.id==='C03'?2.5:5.4,salinity:c.id==='C03'?8:24,temperature:29,ph:7.7},measuredAt:s.demoNow,receivedAt:s.demoNow,source:'ข้อมูลสังเคราะห์ ML',point:'จุดจำลอง',symptoms:[],synthetic:true});
    return {observations,mortalities};
  }
  S.ml={features,dataset,train,predict,syntheticHistory};
})(SPARK);
