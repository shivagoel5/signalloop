// SignalLoop live demo: one campaign cycle at a time. Set the goal -> what happened -> next test -> campaign ->
// what happened and what SignalLoop learned -> the next test. Ramp and Square run on the same product, and Compare
// shows them side by side. Opening the page or switching tabs makes no request: only loading past results,
// recommending a test, creating the campaign, running it and starting over call the API. The session is fetched
// only if this browser's saved copy is out of date.
(function(){
  var demo=document.getElementById('demo');if(!demo)return;
  var CH={email:'Email',linkedin:'LinkedIn',instagram:'Instagram',facebook:'Facebook',blog:'Blog'};
  var FIT={primary:'Primary ICP',secondary:'Secondary ICP',user:'End user'};
  var STAGES=[['setup','Set the goal'],['results','What happened'],['strategy','Next test'],['content','Campaign']];
  var WORKING={run:'Running the campaign and measuring the simulated response…',strategy:'SignalLoop is weighing your strategy against the results…',content:'Writing the campaign for the approved test…'};
  var DECISIONS={explore:'New test',exploit:'Builds on a win',retest:'Retest'};
  var STATUS={significant:'significant',no_clear_difference:'no clear difference',not_enough_evidence:'not enough evidence'};
  var RESULT_LINE={adopt_new_variant:'The new version won, so it became the control.',keep_control:'The control held.',not_enough_evidence:'There wasn\'t enough evidence to decide yet.'};
  var TOOL_NAMES={getStrategyContext:'your strategy (goal, ICP, positioning, messages to test)',getEvidenceSummary:'what past campaigns taught and what is still unknown',getAudiencePerformance:'audience results',getChannelPerformance:'channel results',getMessagingPerformance:'message results',getContentPerformance:'content-format results',getAudienceProfile:'the audience profile',getPreviousContent:'content already tested',getMessagingHistory:'message history',getTopPerformingContent:'best-performing content',getBrandContext:'brand and proof rules',getContentConstraints:'channel rules'};

  function $(id){return document.getElementById(id)}
  var STATIC=JSON.parse($('demo-static').textContent);
  var panel=$('demo-panel'),scroller=$('demo-scroll'),actionbar=$('demo-actionbar'),stepper=$('demo-stepper'),historyEl=$('demo-history'),resetBtn=$('demo-reset'),objSel=$('demo-objective'),goalBox=$('demo-goal');
  var tabs=[].slice.call(demo.querySelectorAll('.scn'));
  var company='ramp',state=null,busy=false,viewing=null,historyOpen=false,lastShown=null,sessionId=getSessionId();

  function getSessionId(){
    var id=null;try{id=localStorage.getItem('signalloop-session')}catch(e){}
    if(!id||!/^[a-z0-9-]{16,64}$/i.test(id)){
      id=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():('s-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12));
      try{localStorage.setItem('signalloop-session',id)}catch(e){}
    }
    return id;
  }
  function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n}
  function pct(x){x=x||0;return (x*100).toFixed(x<0.01?2:1)+'%'}
  function num(x){return Number(x||0).toLocaleString('en-US')}
  function pp(x){return (x>0?'+':'')+x+'pp'}
  function cap(s){s=String(s||'');return s.charAt(0).toUpperCase()+s.slice(1)}
  function find(list,id){return (list||[]).filter(function(x){return x.id===id})[0]}
  function aud(id){var a=find(state&&state.audiences,id)||find(STATIC.companies[company]&&STATIC.companies[company].audiences,id);return a?a.name:id}
  function angle(id){var a=find(state&&state.angles,id)||find(ctx()&&ctx().messages,id);return a?a.label:id}
  function ctype(id){var a=find(state&&state.contentTypes,id);return a?a.label:id}
  function ctx(){return STATIC.companies[company]&&STATIC.companies[company].context}
  function fitTag(audienceId){var a=find(ctx()&&ctx().audiences,audienceId);return a?el('span','fit fit-'+a.fit,FIT[a.fit]):null}
  // Describes a row from its own data: which campaign a new version is for, and where the current control came from.
  function variantLabel(c){
    var id=c.contentVariantId||(c.variant&&c.variant.contentVariantId)||'',from=/^exp(\d+)-test$/.exec(id);
    if(c.role==='test')return 'New version'+(from?' · campaign '+from[1]:'');
    if(c.role==='control')return 'Current control · '+(from?'from campaign '+from[1]:'original message');
    return 'Original message';
  }
  function table(head,rows,numFrom,hideOnMobile){
    var wrap=el('div','dtable-wrap'),t=el('table','dtable'),thead=el('thead'),tb=el('tbody'),hr=el('tr');
    function cls(i){return [i>=numFrom?'num':'',(hideOnMobile||[]).indexOf(i)>=0?'hm':''].join(' ').trim()||null}
    head.forEach(function(h,i){var th=el('th',cls(i),h);th.scope='col';hr.appendChild(th)});
    thead.appendChild(hr);t.appendChild(thead);
    rows.forEach(function(r){var tr=el('tr',r.cls||null);r.cells.forEach(function(c,i){tr.appendChild(el('td',cls(i),c))});tb.appendChild(tr)});
    t.appendChild(tb);wrap.appendChild(t);return wrap}
  function kv(parent,pairs,cls){
    var dl=el('dl',cls||'kv');
    pairs.forEach(function(p){
      if(p[1]==null||p[1]==='')return;
      dl.appendChild(el('dt',null,p[0]));var dd=el('dd');
      if(Array.isArray(p[1])){var ul=el('ul','dlist');p[1].forEach(function(x){ul.appendChild(el('li',null,x))});dd.appendChild(ul)}else dd.textContent=p[1];
      dl.appendChild(dd)});
    parent.appendChild(dl);return dl}
  function api(method,route,body){
    var url='/api/'+route,init={method:method,headers:{'Content-Type':'application/json'}};
    if(method==='GET')url+='?sessionId='+encodeURIComponent(sessionId)+'&company='+company;
    else init.body=JSON.stringify(Object.assign({sessionId:sessionId,company:company},body||{}));
    return fetch(url,init).then(function(r){return r.json().catch(function(){return {}}).then(function(b){return {ok:r.ok,status:r.status,body:b}})}).catch(function(){return {network:true}});
  }

  // --- state: saved in this browser, refreshed from the server only when it turns out to be stale ---
  function storageKey(){return 'signalloop-state-'+sessionId+'-'+company}
  function saveState(){try{localStorage.setItem(storageKey(),JSON.stringify(state))}catch(e){}}
  function savedState(){
    try{var s=JSON.parse(localStorage.getItem(storageKey())||'null');return s&&s.companyKey===company&&s.measurementVersion===STATIC.measurementVersion?s:null}catch(e){return null}
  }
  function emptyState(){
    var info=STATIC.companies[company];
    return {company:info.name,companyKey:company,objective:objSel.value?find(STATIC.objectives,objSel.value):null,objectives:STATIC.objectives,
      experimentCount:0,maxExperiments:STATIC.maxExperiments,experiments:[],analytics:null,pendingPlan:null,labels:STATIC.labels,audiences:info.audiences,angles:[],contentTypes:[]};
  }
  async function refreshFromServer(){
    var res=await api('GET','session');
    if(res.network||!res.ok)return false;
    state=res.body;saveState();return true;
  }
  function stageOf(){
    if(!state||!state.experimentCount)return 'setup';
    if(!state.pendingPlan)return 'results';
    return state.pendingPlan.spec?'content':'strategy';
  }
  function stageIndex(id){for(var i=0;i<STAGES.length;i++)if(STAGES[i][0]===id)return i;return -1}

  // --- rendering ---
  function renderAll(){
    var comparing=company==='compare';
    tabs.forEach(function(t){var on=t.getAttribute('data-company')===company;t.classList.toggle('on',on);t.setAttribute('aria-selected',on?'true':'false')});
    demo.classList.toggle('comparing',comparing);
    if(state&&state.objective)objSel.value=state.objective.id;
    goalBox.hidden=comparing||stageOf()==='setup';
    resetBtn.hidden=comparing;stepper.hidden=comparing;
    if(comparing){renderCompare()}else{renderStepper();renderPanel();renderHistory()}
    syncControls();
  }
  function syncControls(){
    resetBtn.disabled=busy||!state||!state.experimentCount;objSel.disabled=busy;
    tabs.forEach(function(t){t.disabled=busy});
    [stepper,panel,actionbar].forEach(function(root){[].slice.call(root.querySelectorAll('button')).forEach(function(b){b.disabled=busy||b.hasAttribute('data-blocked')})});
  }
  function renderStepper(){
    var cur=stageIndex(stageOf());stepper.textContent='';
    STAGES.forEach(function(s,i){
      var li=el('li',[i<cur?'done':'',i===cur?'current':'',viewing===s[0]?'shown':''].join(' ').trim()||null);
      // Earlier steps of the current cycle can be opened again; setting the goal is only the starting point.
      var canView=i<cur&&i>0,b=el(canView?'button':'span','step');
      if(canView){b.type='button';b.addEventListener('click',function(){viewing=s[0];renderAll()})}
      if(i===cur)b.setAttribute('aria-current','step');
      b.appendChild(el('span','step-n',i<cur?'✓':String(i+1)));b.appendChild(el('span','step-t',s[1]));
      li.appendChild(b);stepper.appendChild(li);
    });
  }
  // The step's content goes in the scrolling panel; its button, progress and errors go in the bar pinned under it.
  function renderPanel(){
    panel.textContent='';actionbar.textContent='';actionbar.hidden=true;
    var cur=stageOf(),shown=viewing||cur;
    ({setup:renderSetup,results:renderResults,strategy:renderStrategy,content:renderContent})[shown](!viewing);
    if(viewing){
      var bar=el('div','viewing'),back=el('button','btn run','Back to '+STAGES[stageIndex(cur)][1].toLowerCase());
      bar.appendChild(el('span',null,'You are looking at an earlier step.'));back.type='button';
      back.addEventListener('click',function(){viewing=null;renderAll()});
      bar.appendChild(back);actionbar.appendChild(bar);actionbar.hidden=false;
    }
    var key=company+':'+shown+':'+(state?state.experimentCount:0);
    if(key!==lastShown){scroller.scrollTop=0;lastShown=key}
  }
  function head(step,title,tags){
    var i=stageIndex(step);
    panel.appendChild(el('div','stage-k','Step '+(i+1)+' · '+STAGES[i][1]));
    panel.appendChild(el('h3','stage-h',title));
    if(tags&&tags.length){var t=el('div','tags');tags.forEach(function(x){t.appendChild(el('span','chip '+(x[1]||''),x[0]))});panel.appendChild(t)}
  }
  function note(text,cls){panel.insertBefore(el('div',cls||'dnote',text),panel.firstChild)}
  // A blocked action stays disabled and its hint says what is missing.
  function action(label,route,hint,blocked,extra){
    var btn=el('button','btn run',label);btn.type='button';
    if(blocked)btn.setAttribute('data-blocked','');
    btn.addEventListener('click',function(){act(route,extra)});
    if(hint)actionbar.appendChild(el('span','dsub',hint));
    actionbar.appendChild(btn);actionbar.hidden=false;
  }
  function looked(x){return cap((x.toolCalls||[]).map(function(c){return TOOL_NAMES[c.name]||c.name}).join(', '))+'.'}
  function section(title,cls){var s=el('div','block'+(cls?' '+cls:''));s.appendChild(el('div','block-k',title));return s}

  // Step 1: what SignalLoop already knows about the company, and the goal the marketer sets.
  function renderSetup(live){
    var info=STATIC.companies[company],c=info.context,goal=objSel.value;
    head('setup','What SignalLoop knows about '+info.name,[[c.market]]);
    var grid=el('div','knows');
    var seg=section('Segments · '+c.segmentation);
    var ul=el('ul','seglist');
    c.audiences.forEach(function(a){
      var base=find(info.audiences,a.id),li=el('li'),top=el('div','seg-top');
      top.appendChild(el('b',null,base.name));top.appendChild(el('span','fit fit-'+a.fit,FIT[a.fit]));li.appendChild(top);
      li.appendChild(el('div','dsub',a.role+' · '+base.channels.map(function(x){return CH[x]}).join(', ')));ul.appendChild(li);
    });
    seg.appendChild(ul);grid.appendChild(seg);
    var msg=section('Messages to test');
    var ml=el('ul','msglist');
    c.messages.forEach(function(x){
      var li=el('li'+'');li.appendChild(el('b',null,x.label));
      if(x.role)li.appendChild(el('span','msg-role'+(/^lead/.test(x.role)?' lead':''),cap(x.role)));
      ml.appendChild(li);
    });
    msg.appendChild(ml);grid.appendChild(msg);
    panel.appendChild(grid);

    var g=section('What is this campaign for?','goal');
    var row=el('div','goal-chips');
    STATIC.objectives.forEach(function(o){
      var b=el('button','goal-chip'+(goal===o.id?' on':''));b.type='button';b.setAttribute('aria-pressed',goal===o.id?'true':'false');
      b.appendChild(el('b',null,o.label));b.appendChild(el('span',null,'judged on '+o.metric));
      b.addEventListener('click',function(){objSel.value=o.id;objSel.dispatchEvent(new Event('change'))});
      row.appendChild(b);
    });
    g.appendChild(row);panel.appendChild(g);
    if(live)action('Load past campaign results','run',goal?'A past campaign sent each audience its current message on every channel. Results are simulated.':'Choose what this campaign is for first.',!goal);
  }

  function renderResults(live){
    var a=state.analytics,L=a.latest,t=L.testVsControl,s=a.signal;
    if(t){
      head('results','What happened in campaign '+L.experimentNumber,[['Simulated result','sim'],['Judged on '+s.label]]);
      panel.appendChild(verdict(t,L,s));
      panel.appendChild(learnedCard(t));
      var more=el('details','data');more.appendChild(el('summary',null,'Everything SignalLoop noticed'));
      more.appendChild(findings(a));panel.appendChild(more);
    }else{
      head('results','What happened in the past campaign',[['Simulated result','sim'],['Judged on '+s.label]]);
      var best=bestCell(a);
      if(best){
        var h=el('div','headline');h.appendChild(el('div','block-k','Strongest result for this goal'));
        var v=el('div','headline-v');v.appendChild(el('b',null,best.audience+' × '+best.channel));v.appendChild(el('span','headline-n',pct(best.rate)+' '+s.label));
        h.appendChild(v);h.appendChild(el('div','dsub',num(best.events)+' '+s.event+' from '+num(best.reach)+' people reached'));panel.appendChild(h);
      }
      panel.appendChild(matrix(a,s,best));
      panel.appendChild(findings(a));
    }
    panel.appendChild(numbers(a,L,s));
    if(!live)return;
    if(state.experimentCount>=state.maxExperiments){actionbar.appendChild(el('span','dsub','This session has reached '+state.maxExperiments+' campaigns. Start over to run more.'));actionbar.hidden=false}
    else action('Recommend the next test','strategy',t?'The next recommendation has to build on this result. You approve it before anything is created.':'SignalLoop weighs your strategy against these results. You approve its pick before anything is created.');
  }
  // The best audience x channel on the goal's signal, among cells with enough events to be read (else all tested cells).
  function bestCell(a){
    var min=(state.guardrail&&state.guardrail[a.signal.id])||0,cells=[];
    state.audiences.forEach(function(p){(a.byAudience[p.id]||{channels:[]}).channels.forEach(function(c){if(c.tested)cells.push({audience:p.name,channel:c.label,rate:c.rate,events:c.events,reach:c.reach,key:p.id+':'+c.channel})})});
    var pool=cells.filter(function(c){return c.events>=min});if(!pool.length)pool=cells;
    return pool.sort(function(x,y){return y.rate-x.rate})[0]||null;
  }
  function matrix(a,s,best){
    var chans=[];state.audiences.forEach(function(p){p.channels.forEach(function(c){if(chans.indexOf(c)<0)chans.push(c)})});
    var box=section('Past campaign · '+s.label+' by audience and channel'),wrap=el('div','dtable-wrap'),t=el('table','matrix'),hr=el('tr');
    hr.appendChild(el('th',null,'Audience'));chans.forEach(function(c){hr.appendChild(el('th','num',CH[c]))});
    var thead=el('thead');thead.appendChild(hr);t.appendChild(thead);var tb=el('tbody');
    state.audiences.forEach(function(p){
      var tr=el('tr'),th=el('th');th.scope='row';th.appendChild(el('span',null,p.name));var f=fitTag(p.id);if(f)th.appendChild(f);tr.appendChild(th);
      chans.forEach(function(ch){
        var row=(a.byAudience[p.id]||{channels:[]}).channels.filter(function(x){return x.channel===ch})[0];
        var td=el('td','num'+(best&&best.key===p.id+':'+ch?' best':''),row&&row.tested?pct(row.rate):'—');
        if(row&&row.tested)td.title=num(row.events)+' '+s.event+' from '+num(row.reach)+' reached';
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);wrap.appendChild(t);box.appendChild(wrap);return box;
  }
  function findings(a){
    var two=el('div','two');
    two.appendChild(findingCard('What SignalLoop noticed',a.learnings,'Nothing conclusive yet.',''));
    two.appendChild(findingCard('Still unknown',a.knowledgeGaps,'No open questions flagged.','gaps'));
    return two;
  }
  function findingCard(title,items,empty,cls){
    var c=el('div','card finding'+(cls?' '+cls:''));c.appendChild(el('div','card-t',title));
    if(!items||!items.length){c.appendChild(el('p','dsub',empty));return c}
    var ul=el('ul','ins');items.forEach(function(i){ul.appendChild(el('li',null,i.text))});c.appendChild(ul);return c;
  }
  function numbers(a,L,s){
    var d=el('details','data');d.appendChild(el('summary',null,'View the numbers'));
    d.appendChild(el('p','dsub',a.objective.label+' is judged on '+s.noun+': '+s.definition+'. SignalLoop only calls a winner with at least '+s.minEvents+' '+s.event+' per version and a statistically significant difference.'));
    if(a.observations&&a.observations.length){
      d.appendChild(el('div','dlab dsubhead','Other observations'));
      var ob=el('ul','ins');a.observations.forEach(function(o){ob.appendChild(el('li',null,o.text))});d.appendChild(ob);
    }
    d.appendChild(el('div','dlab dsubhead','Campaign '+L.experimentNumber));
    d.appendChild(table(['Version','Audience','Channel','Message','Content','Reach',cap(s.event),s.label,'CTR'],L.cells.map(function(c){
      return {cells:[variantLabel(c),aud(c.audienceId),CH[c.channel],angle(c.messagingAngle),ctype(c.contentType),num(c.reach),num(c.events),pct(c.rate),pct(c.ctr)]}}),5,[0,4,8]));
    d.appendChild(el('div','dlab dsubhead','All campaigns so far, by audience'));
    d.appendChild(table(['Audience','Reach',cap(s.event),s.label,'vs other audiences'],a.audiences.filter(function(x){return x.reach>0}).map(function(x){
      return {cells:[x.name,num(x.reach),num(x.events),pct(x.rate),x.vsOthers?pp(x.vsOthers.deltaPp)+' ('+STATUS[x.vsOthers.status]+')':'—']}}),1));
    return d;
  }
  // The result, then the three facts behind it kept apart: observed difference, evidence bar, significance.
  function verdict(t,L,s){
    var test=L.cells.filter(function(c){return c.role==='test'})[0],ctrl=L.cells.filter(function(c){return c.role==='control'})[0];
    var won=t.decision==='adopt_new_variant',lost=t.decision==='keep_control'&&t.significant;
    var box=el('div','verdict'+(won?' win':lost?' lose':t.decision==='not_enough_evidence'?' open':''));
    var heads={adopt_new_variant:'The new version won',keep_control:t.significant?'The current control won':'No clear difference',not_enough_evidence:'Not enough evidence to decide yet'};
    box.appendChild(el('div','verdict-h',heads[t.decision]));
    box.appendChild(el('div','dsub',String(t.summary||'').replace(/new variant/g,'new version')));
    var g=el('div','versus');
    [test,ctrl].forEach(function(c){
      if(!c)return;
      var v=el('div','vs-card'+(c.role==='test'?' test':''));
      v.appendChild(el('div','vs-l',variantLabel(c)));v.appendChild(el('div','vs-ctr',pct(c.rate)));
      v.appendChild(el('div','dsub',s.label+' · '+num(c.events)+' '+s.event+' of '+num(c.reach)+' reached'));
      if(c.headline)v.appendChild(el('div','vs-h','“'+c.headline+'”'));
      v.appendChild(el('div','dsub',angle(c.messagingAngle)+' · '+ctype(c.contentType)));
      g.appendChild(v);
    });
    box.appendChild(g);
    kv(box,[['Observed difference',pp(t.deltaPp)+' '+s.noun],
      ['Evidence bar',(t.enoughEvidence?'Met':'Not met')+': '+num(t.eventsA)+' and '+num(t.eventsB)+' '+s.event+', needs '+t.minEvents+' each'],
      ['Statistically significant',t.enoughEvidence?(t.significant?'Yes (about 95% confidence)':'No'):'Not judged below the evidence bar']],'kv compact facts');
    var any=test||ctrl;box.appendChild(el('div','dsub',aud(any.audienceId)+' on '+CH[any.channel]+', audience split 50/50.'));
    return box;
  }
  // Keep / change, worked out in code from the result itself.
  function learnedCard(t){
    var where=aud(t.audienceId)+' × '+CH[t.channel],keep=[],change=[];
    if(t.decision==='adopt_new_variant'){
      keep.push('New control: '+t.test.label);keep.push('Where it was proven: '+where);
      change.push('Test something new against the new control: another message, format or channel');
    }else if(t.decision==='keep_control'){
      keep.push('Control: '+t.control.label);keep.push('Where it was tested: '+where);
      change.push((t.significant?'Drop ':'Move on from ')+t.test.label+' here');change.push('Test a different message or format');
    }else{
      keep.push('Control, for now: '+t.control.label);keep.push('Where it was tested: '+where);
      change.push('No verdict on '+t.test.label+' yet');change.push('Retest with more people, or test something else');
    }
    var card=el('div','learned-card');card.appendChild(el('div','block-k','What SignalLoop learned'));
    var grid=el('div','lc-grid');
    [['Keep',keep,'keep'],[t.decision==='not_enough_evidence'?'Still open':'Change',change,'change']].forEach(function(col){
      var c=el('div','lc-col '+col[2]);c.appendChild(el('div','lc-h',col[0]));var ul=el('ul');col[1].forEach(function(x){ul.appendChild(el('li',null,x))});c.appendChild(ul);grid.appendChild(c);
    });
    card.appendChild(grid);card.appendChild(el('div','dsub','The next recommendation has to build on this result.'));
    return card;
  }

  // Step 3: the recommendation answers the four questions first, then why, then what it costs and how sure it is.
  function renderStrategy(live){
    var plan=state.pendingPlan,m=plan.marketing,r=m.recommendation;
    var madeFor=find(STATIC.objectives,m.objectiveId)||{label:m.objectiveId,metric:''},current=find(STATIC.objectives,objSel.value);
    var changed=Boolean(current&&m.objectiveId&&current.id!==m.objectiveId);
    head('strategy','What should we test next?',[['AI recommendation','ai'],['For '+madeFor.label+' · '+(DECISIONS[r.decisionType]||r.decisionType)]]);
    if(changed)panel.appendChild(el('div','dnote','You changed the goal to '+current.label+'. This recommendation was made for '+madeFor.label+'. Ask again to see what the same results recommend for '+current.label+'.'));
    var ans=el('div','answers');
    [['Who to target',aud(r.priorityAudience),fitTag(r.priorityAudience)],['Channel',CH[r.recommendedChannel]],['Message',angle(r.recommendedAngle)],['Content',ctype(r.recommendedContentType)]].forEach(function(x){
      var d=el('div','answer');d.appendChild(el('span','answer-k',x[0]));d.appendChild(el('b',null,x[1]));if(x[2])d.appendChild(x[2]);ans.appendChild(d);
    });
    panel.appendChild(ans);
    var why=section('Why');why.appendChild(el('p','why-p',r.reasoning));panel.appendChild(why);
    var built=builtOn(r);if(built)panel.appendChild(built);
    var trio=el('div','trio');
    [['Trade-off',r.tradeoff],['Confidence',cap(r.confidence)+'. '+r.confidenceReason],['Still unknown',r.knowledgeGap]].forEach(function(x){
      var d=el('div','trio-c');d.appendChild(el('div','block-k',x[0]));d.appendChild(el('p',null,x[1]));trio.appendChild(d);
    });
    panel.appendChild(trio);
    if(plan.alternatives&&plan.alternatives.length){
      var alts=section('Same results, other goals','alts'),al=el('ul','ins');
      plan.alternatives.forEach(function(x){al.appendChild(el('li',null,x.objectiveLabel+': '+aud(x.priorityAudience)+' × '+CH[x.recommendedChannel]+' × '+angle(x.recommendedAngle)+' ('+ctype(x.recommendedContentType).toLowerCase()+')'))});
      alts.appendChild(al);panel.appendChild(alts);
    }
    var d=el('details','data');d.appendChild(el('summary',null,'Why SignalLoop chose this'));
    kv(d,[['Hypothesis',r.hypothesis],['What past campaigns taught',r.learned],['Why not the alternatives',r.alternatives],['It works if',r.supportIf],['Then',r.ifSupported],['It doesn\'t if',r.rejectIf],['Then',r.ifRejected]],'kv compact');
    d.appendChild(el('div','dlab dsubhead','Evidence it cited'));
    var ul=el('ul','why');
    m.evidence.forEach(function(e){
      var li=el('li');
      li.appendChild(el('span','src '+(e.context?'src-pmm':'src-code'),e.context?'Your strategy':'Measured'));
      li.appendChild(el('div',null,e.statement));
      if(e.metric){
        var parts=[e.metric.label];
        if(e.metric.reach)parts.push(pct(e.metric.rate)+' '+madeFor.metric,num(e.metric.events)+' of '+num(e.metric.reach)+' reached');
        li.appendChild(el('div','dsub',parts.join(' · ')));
      }else if(e.context)li.appendChild(el('div','dsub',e.context.label));
      ul.appendChild(li);
    });
    d.appendChild(ul);d.appendChild(el('p','dsub','It looked at '+looked(m).charAt(0).toLowerCase()+looked(m).slice(1)));
    panel.appendChild(d);
    if(!live)return;
    if(changed)action('Ask again for '+current.label,'strategy','Same results, new goal. This recommendation is kept for comparison.',false,{refresh:true});
    else action('Create this campaign','content','SignalLoop drafts the campaign for this test. You review it before anything runs.');
  }
  // After the first test: what the recommendation kept and what it changed from the last campaign.
  function builtOn(r){
    var last=state.experiments[state.experiments.length-1],t=last&&last.cells.filter(function(c){return c.role==='test'})[0];
    if(!t)return null;
    var res=state.analytics&&state.analytics.latest&&state.analytics.latest.testVsControl;
    var box=section('Built on campaign '+last.experimentNumber,'builton');
    if(res)box.appendChild(el('p','dsub',res.decision==='keep_control'&&!res.significant?'No clear difference, so the control stayed.':RESULT_LINE[res.decision]));
    var same=[],diff=[];
    [['Audience',t.audienceId,r.priorityAudience,aud],['Channel',t.channel,r.recommendedChannel,function(x){return CH[x]}],['Message',t.messagingAngle,r.recommendedAngle,angle],['Content',t.contentType,r.recommendedContentType,ctype]].forEach(function(x){
      if(x[1]===x[2])same.push(x[0]+': '+x[3](x[1]));else diff.push(x[0]+': '+x[3](x[1])+' → '+x[3](x[2]));
    });
    kv(box,[['Kept',same.join(' · ')||'Nothing'],['Changed',diff.join(' · ')||'Nothing']],'kv compact');
    return box;
  }

  function renderContent(live){
    var plan=state.pendingPlan,c=plan.content,cp=c.contentPlan,r=plan.marketing.recommendation;
    head('content','Create the campaign',[['AI-written','ai'],[CH[r.recommendedChannel]+' · '+ctype(r.recommendedContentType)],['You approve before it runs']]);
    var grid=el('div','content-grid'),side=el('div','content-side');
    grid.appendChild(preview(r.recommendedChannel,c.generatedContent,c.sampleContact,cp.cta));
    side.appendChild(el('div','block-k','The experiment'));
    plan.spec.cells.forEach(function(x){
      var card=el('div','vs-card'+(x.role==='test'?' test':''));
      card.appendChild(el('div','vs-l',variantLabel(x)));
      card.appendChild(el('div','vs-h','“'+x.variant.headline+'”'));
      card.appendChild(el('div','dsub',angle(x.messagingAngle)+' · '+ctype(x.contentType)));
      card.appendChild(el('div','dsub',Math.round(x.share*100)+'% of '+aud(x.audienceId)+' on '+CH[x.channel]));
      side.appendChild(card);
    });
    side.appendChild(el('div','dsum','One thing changes against the current control, so the result shows whether it worked.'));
    var d=el('details','data');d.appendChild(el('summary',null,'Why this content'));
    kv(d,[['Audience insight',cp.audienceInsight],['Angle',cp.contentAngle],['Hook',cp.hook],['Key message',cp.keyMessage],['Supporting points',cp.supportingPoints],['Tone',cp.tone],['Brief',cp.contentBrief]]);
    side.appendChild(d);
    grid.appendChild(side);panel.appendChild(grid);
    if(live)action('Approve and run the experiment','run','Runs the new version against the current control, 50/50 on '+aud(r.priorityAudience)+' via '+CH[r.recommendedChannel]+'. Results are simulated.');
  }

  // Compare: the same product on two markets, side by side.
  function renderCompare(){
    panel.textContent='';actionbar.textContent='';actionbar.hidden=true;historyEl.hidden=true;
    panel.appendChild(el('div','stage-k','Compare scenarios'));
    panel.appendChild(el('h3','stage-h','Same SignalLoop, different markets'));
    panel.appendChild(el('p','stage-intro','The decision loop stays the same. The segments, buyers and messages change with the market.'));
    var keys=['ramp','square'],wrap=el('div','dtable-wrap'),t=el('table','cmp');
    var hr=el('tr');hr.appendChild(el('th'));
    keys.forEach(function(k){var th=el('th');th.scope='col';th.appendChild(el('b',null,STATIC.companies[k].name));th.appendChild(el('span',null,STATIC.companies[k].context.market));hr.appendChild(th)});
    var thead=el('thead');thead.appendChild(hr);t.appendChild(thead);var tb=el('tbody');
    function row(label,cell){
      var tr=el('tr'),th=el('th',null,label);th.scope='row';tr.appendChild(th);
      keys.forEach(function(k){var td=el('td');td.setAttribute('data-co',STATIC.companies[k].name);var v=cell(STATIC.companies[k]);if(typeof v==='string')td.textContent=v;else td.appendChild(v);tr.appendChild(td)});
      tb.appendChild(tr);
    }
    row('Segmented',function(info){return info.context.segmentation});
    row('Segments',function(info){
      var ul=el('ul','cmp-list');
      info.context.audiences.forEach(function(a){var li=el('li');li.appendChild(el('b',null,find(info.audiences,a.id).name));li.appendChild(el('span','fit fit-'+a.fit,FIT[a.fit]));li.appendChild(el('div','dsub',a.role));ul.appendChild(li)});
      return ul;
    });
    row('Channels',function(info){var cs=[];info.audiences.forEach(function(a){a.channels.forEach(function(c){if(cs.indexOf(CH[c])<0)cs.push(CH[c])})});return cs.join(', ')});
    row('Lead message',function(info){var m=info.context.messages.filter(function(x){return /^lead/.test(x.role||'')})[0];return m?m.label:'—'});
    row('Other messages',function(info){return info.context.messages.filter(function(x){return !/^lead/.test(x.role||'')}).map(function(x){return x.label}).join(', ')});
    t.appendChild(tb);wrap.appendChild(t);panel.appendChild(wrap);
    var same=el('div','cmp-same');same.appendChild(el('b',null,'The same in both'));
    same.appendChild(el('span',null,'Past results → next test → campaign → learning. The same analytics, evidence bar and approval steps.'));
    panel.appendChild(same);
    var tries=el('div','cmp-try');
    keys.forEach(function(k){var b=el('button','btn run','Try '+STATIC.companies[k].name);b.type='button';b.addEventListener('click',function(){switchTo(k)});tries.appendChild(b)});
    panel.appendChild(tries);
    scroller.scrollTop=0;lastShown='compare';
  }

  // --- channel previews ---
  function preview(channel,g,contact,planCta){
    g=g||{};
    var paras=g.paragraphs&&g.paragraphs.length?g.paragraphs:String(g.body||'').split(/\n\s*\n/).filter(Boolean);
    var brand=state.company,cta=g.ctaText||planCta||'';
    if(channel==='email')return emailPreview(brand,g,paras,cta,contact);
    if(channel==='instagram')return instagramPreview(brand,g,paras,cta);
    if(channel==='blog')return blogPreview(brand,g,paras,cta);
    return postPreview(brand,channel,g,paras,cta);
  }
  // Shows {first_name} as the sample contact's name, highlighted because it is filled in per contact.
  function withMerge(parent,text,contact){
    String(text||'').split('{first_name}').forEach(function(part,i){
      if(i){var mk=el('mark','merge',contact?contact.firstName:'first name');mk.title='Filled in for each contact';parent.appendChild(mk)}
      if(part)parent.appendChild(document.createTextNode(part));
    });
    return parent;
  }
  function sender(cls,brand,sub){
    var h=el('div',cls),w=el('div');h.appendChild(el('span','avatar',brand.charAt(0)));
    w.appendChild(el('b',null,brand));w.appendChild(el('div','mut',sub));h.appendChild(w);return h;
  }
  function emailPreview(brand,g,paras,cta,contact){
    var m=el('div','mail'),h=el('div','mail-head'),b=el('div','mail-body');
    h.appendChild(sender('mail-from',brand,'To: '+(contact?contact.firstName+' '+contact.lastName+(contact.company?', '+contact.company:''):'each contact in the audience list')));
    h.appendChild(withMerge(el('div','mail-subject'),g.title,contact));
    if(g.previewText)h.appendChild(withMerge(el('div','mail-pre'),g.previewText,contact));
    m.appendChild(h);
    paras.forEach(function(t){b.appendChild(withMerge(el('p'),t,contact))});
    if(cta)b.appendChild(el('span','mail-cta',cta));
    m.appendChild(b);
    m.appendChild(el('div','mail-foot',contact
      ?'Preview for '+contact.firstName+' '+contact.lastName+', a sample contact in this audience. Highlighted text is filled in for each contact. Not sent.'
      :'Preview only. Not sent.'));
    return m;
  }
  function postPreview(brand,channel,g,paras,cta){
    var m=el('div','post'),t=el('div','post-text'),link=el('div','post-link'),meta=el('div','post-meta');
    m.appendChild(sender('post-head',brand,CH[channel]+' post · preview'));
    paras.forEach(function(x){t.appendChild(el('p',null,x))});m.appendChild(t);
    link.appendChild(el('div','post-img',brand));
    meta.appendChild(el('div','post-title',g.title));if(g.previewText)meta.appendChild(el('div','mut',g.previewText));link.appendChild(meta);
    if(cta)link.appendChild(el('span','post-cta',cta));
    m.appendChild(link);m.appendChild(el('div','mail-foot','Preview only. Not posted.'));
    return m;
  }
  function instagramPreview(brand,g,paras,cta){
    var m=el('div','post'),img=el('div','insta-img'),t=el('div','post-text');
    m.appendChild(sender('post-head',brand,'Instagram post · preview'));
    img.appendChild(el('span',null,g.title));m.appendChild(img);
    paras.forEach(function(x,i){var p=el('p');if(!i)p.appendChild(el('b',null,brand.toLowerCase().replace(/\s+/g,'')+' '));p.appendChild(document.createTextNode(x));t.appendChild(p)});
    if(cta)t.appendChild(el('p','insta-cta',cta));
    m.appendChild(t);m.appendChild(el('div','mail-foot','Preview only. Not posted.'));
    return m;
  }
  function blogPreview(brand,g,paras,cta){
    var m=el('article','blogp');
    m.appendChild(el('div','blog-k',brand+' blog'));m.appendChild(el('h4','blog-t',g.title));
    if(g.previewText)m.appendChild(el('p','blog-sf',g.previewText));
    paras.forEach(function(x){m.appendChild(el('p',null,x))});
    if(cta)m.appendChild(el('span','blog-more',cta+' →'));
    m.appendChild(el('div','mail-foot','Preview only. Not published.'));
    return m;
  }

  function renderHistory(){
    historyEl.textContent='';
    if(!state||!state.experimentCount){historyEl.hidden=true;return}
    historyEl.hidden=false;
    var d=el('details','hist');d.open=historyOpen;d.addEventListener('toggle',function(){historyOpen=d.open});
    d.appendChild(el('summary',null,'Campaign history ('+state.experimentCount+')'));
    var ol=el('ol','timeline'),sig=state.analytics&&state.analytics.signal,rt=function(c){return c.reach&&sig?c[sig.id]/c.reach:0};
    state.experiments.forEach(function(e){
      var li=el('li');
      if(e.kind==='baseline'){
        li.appendChild(el('b',null,'Campaign '+e.experimentNumber+': past campaign'));
        li.appendChild(document.createTextNode(' · every audience on each of its channels, with its current message'));
      }else{
        var t=e.cells.filter(function(c){return c.role==='test'})[0],k=e.cells.filter(function(c){return c.role==='control'})[0];
        li.appendChild(el('b',null,'Campaign '+e.experimentNumber+': '+aud(t.audienceId)+' on '+CH[t.channel]));
        li.appendChild(document.createTextNode(' · new ('+angle(t.messagingAngle)+', '+ctype(t.contentType).toLowerCase()+') '+pct(rt(t))+' vs control ('+angle(k.messagingAngle)+', '+ctype(k.contentType).toLowerCase()+') '+pct(rt(k))+(sig?' '+sig.label:'')));
      }
      ol.appendChild(li);
    });
    d.appendChild(ol);historyEl.appendChild(d);
  }

  // --- actions ---
  async function act(route,extra){
    if(busy)return;busy=true;syncControls();bringIntoView();
    [].slice.call(demo.querySelectorAll('.derr,.dnote')).forEach(function(e){e.remove()});
    var progress=el('div','dprogress'),msg=el('div','dsub',WORKING[route]);msg.setAttribute('role','status');
    progress.appendChild(el('div','bar'));progress.appendChild(msg);actionbar.appendChild(progress);
    var res=await api('POST',route,Object.assign({objective:objSel.value||undefined},extra||{}));
    busy=false;
    if(!res.network&&res.status===409&&await refreshFromServer()){
      viewing=null;renderAll();
      note('The copy of this demo saved in your browser was out of date, so it has been refreshed. Continue from here.');
    }else if(res.network||!res.ok){
      progress.remove();syncControls();
      var err=el('div','derr',res.network?'Could not reach SignalLoop. Please check your connection and try again.':(res.body.error||'Something went wrong.'));
      if(res.body&&res.body.attempts&&res.body.attempts.length){
        err.appendChild(el('div','dsub',res.body.attempts.length+(res.body.attempts.length===1?' attempt':' attempts')+'. Output that fails a check is never shown.'));
      }
      actionbar.appendChild(err);
    }else{
      state=res.body;saveState();viewing=null;renderAll();bringIntoView();
    }
  }
  // Keep the whole demo frame on screen while it is in use: on laptops it lines up under the navigation; on phones it
  // brings the top of the new step into view.
  function bringIntoView(force){
    var nav=document.querySelector('.nav'),top=(nav?nav.getBoundingClientRect().height:0)+12,r=demo.getBoundingClientRect();
    if(force||r.top<top-1||r.bottom>innerHeight+1){
      // Layout position, not the on-screen one, so the section's fade-in offset does not throw off the alignment.
      var y=0;for(var n=demo;n;n=n.offsetParent)y+=n.offsetTop;
      scrollTo({top:y-top,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    }
  }

  function load(){
    if(!objSel.options.length){
      var none=el('option',null,'Choose a goal');none.value='';none.disabled=true;objSel.appendChild(none);
      STATIC.objectives.forEach(function(o){var op=el('option',null,o.label+' · '+o.metric);op.value=o.id;objSel.appendChild(op)});
      objSel.value='';
    }
    if(company==='compare'){state=null;viewing=null;renderAll();return}
    // A session this browser already started for the company is picked up again.
    var saved=savedState();
    state=saved||emptyState();viewing=null;renderAll();
    if(saved&&saved.experimentCount)note('Picked up your saved '+saved.company+' session. Use Start over to begin again.');
  }
  function switchTo(key){if(busy)return;company=key;load()}
  resetBtn.addEventListener('click',async function(){
    if(busy||company==='compare')return;busy=true;syncControls();
    var res=await api('POST','reset',{objective:objSel.value||undefined});busy=false;
    if(res.ok){state=res.body;saveState();viewing=null;renderAll();note('Session cleared. Start again from the goal.')}
    else{renderAll();note((res.body&&res.body.error)||'Could not start over. Please try again.','derr')}
  });
  objSel.addEventListener('change',function(){
    if(state)state.objective=find(STATIC.objectives,objSel.value);
    renderAll();
    if(state&&state.pendingPlan&&state.pendingPlan.spec)note('The new goal applies to the next recommendation.');
  });
  tabs.forEach(function(b){b.addEventListener('click',function(){switchTo(b.getAttribute('data-company'))})});
  load();

  // Links to the live demo land with the whole demo frame in view, not just the section heading above it.
  [].slice.call(document.querySelectorAll('a[href="#try"],a[href="/#try"]')).forEach(function(a){
    a.addEventListener('click',function(e){e.preventDefault();if(history.replaceState)history.replaceState(null,'','#try');bringIntoView(true)});
  });
  function alignOnArrival(){if(location.hash==='#try')setTimeout(function(){bringIntoView(true)},50)}
  if(document.readyState==='complete')alignOnArrival();else addEventListener('load',alignOnArrival);
  addEventListener('hashchange',alignOnArrival);

  // The frame's glow starts when the demo comes into view, so visitors notice where to click.
  if('IntersectionObserver' in window){
    var watcher=new IntersectionObserver(function(entries){
      entries.forEach(function(e){if(e.isIntersecting){demo.classList.add('in-view');watcher.disconnect()}});
    },{threshold:.2});
    watcher.observe(demo);
  }else demo.classList.add('in-view');
})();
