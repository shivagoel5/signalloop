// SignalLoop live demo, one stage at a time: Set up -> Results -> Strategy -> Content, and a run returns to
// Results. Opening the page or switching company makes no request. Only Run, Get a recommendation, Create
// content and Start over call the API; the session is fetched only if this browser's saved copy is out of date.
(function(){
  var demo=document.getElementById('demo');if(!demo)return;
  var CH={email:'Email',linkedin:'LinkedIn',instagram:'Instagram',facebook:'Facebook',blog:'Blog'};
  var SEGMENTS={ramp:'by role',square:'by business stage'};
  // One chip per part of the system; the three agent labels (marketing, content planning, content generation) share one.
  var LABELS=[['crm','HubSpot CRM'],['delivery','Delivery'],['performance','Performance'],['analytics','Analytics'],['marketing','AI agents','Marketing recommendation, content planning and content generation'],['history','History']];
  var TOOL_NAMES={getCampaignObjective:'campaign objective',getAvailableChannels:'available channels',getAvailableMessagingAngles:'messaging angles and content types',getAudiencePerformance:'audience results',getChannelPerformance:'channel results',getMessagingPerformance:'messaging results',getContentPerformance:'content-type results',getExperimentHistory:'experiment history',getAudienceProfile:'audience profile',getPreviousContent:'content already tested',getMessagingHistory:'messaging history',getTopPerformingContent:'best-performing content',getBrandContext:'brand guidelines',getContentConstraints:'channel rules'};
  var DECISIONS={explore:'Trying something new',exploit:'Building on what works',retest:'Re-testing to confirm'};
  var STAGES=[['setup','Set up'],['results','Results'],['strategy','Strategy'],['content','Content']];
  var WORKING={run:'Updating the audience lists in HubSpot and measuring the simulated response…',strategy:'The Marketing Agent is reading the results and choosing what to test…',content:'The Content Agent is planning and writing the variant…'};

  function $(id){return document.getElementById(id)}
  var STATIC=JSON.parse($('demo-static').textContent);
  var panel=$('demo-panel'),scroller=$('demo-scroll'),actionbar=$('demo-actionbar'),stepper=$('demo-stepper'),historyEl=$('demo-history'),resetBtn=$('demo-reset'),objSel=$('demo-objective'),labelsEl=$('demo-labels');
  var picks=[].slice.call(demo.querySelectorAll('.pick'));
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
  function pct(x){return (x*100).toFixed(1)+'%'}
  function pp(x){return (x>0?'+':'')+x+'pp'}
  function cap(s){s=String(s||'');return s.charAt(0).toUpperCase()+s.slice(1)}
  function find(list,id){return (list||[]).filter(function(x){return x.id===id})[0]}
  function aud(id){var a=find(state&&state.audiences,id);return a?a.name:id}
  function angle(id){var a=find(state&&state.angles,id);return a?a.label:id}
  function ctype(id){var a=find(state&&state.contentTypes,id);return a?a.label:id}
  // Describes a row from its own data: which experiment a new variant is for, and where the control's
  // best-so-far variant came from. Works for measured cells and for cells in a pending plan.
  function variantLabel(c){
    var id=c.contentVariantId||(c.variant&&c.variant.contentVariantId)||'',from=/^exp(\d+)-test$/.exec(id);
    if(c.role==='test')return 'New variant'+(from?' · experiment '+from[1]:'');
    if(c.role==='control')return 'Best so far · '+(from?'from experiment '+from[1]:'original message');
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
  function saveState(){
    try{localStorage.setItem(storageKey(),JSON.stringify(state));if(state.labels&&state.labels.crm)localStorage.setItem('signalloop-crm-label',state.labels.crm)}catch(e){}
  }
  function savedState(){
    try{var s=JSON.parse(localStorage.getItem(storageKey())||'null');return s&&s.companyKey===company?s:null}catch(e){return null}
  }
  function emptyState(){
    // The CRM label depends on the server's HubSpot setting, so it appears once the server has reported it.
    var info=STATIC.companies[company],labels=Object.assign({},STATIC.labels),crm=null;
    try{crm=localStorage.getItem('signalloop-crm-label')}catch(e){}
    if(crm)labels.crm=crm;
    return {company:info.name,companyKey:company,objective:find(STATIC.objectives,objSel.value||STATIC.defaultObjective),objectives:STATIC.objectives,
      experimentCount:0,maxExperiments:STATIC.maxExperiments,experiments:[],analytics:null,pendingPlan:null,labels:labels,audiences:info.audiences,angles:[],contentTypes:[]};
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
    if(state.objective)objSel.value=state.objective.id;
    renderLabels();renderStepper();renderPanel();renderHistory();syncControls();
  }
  function syncControls(){
    resetBtn.disabled=busy||!state;objSel.disabled=busy;
    picks.forEach(function(p){p.disabled=busy});
    [stepper,panel,actionbar].forEach(function(root){[].slice.call(root.querySelectorAll('button')).forEach(function(b){b.disabled=busy})});
  }
  function renderLabels(){
    labelsEl.textContent='';
    LABELS.forEach(function(l){
      var v=state.labels[l[0]];if(!v)return;
      var c=el('span','lbl lbl-'+v.toLowerCase());if(l[2])c.title=l[2];
      c.appendChild(el('span',null,l[1]));c.appendChild(el('b',null,v));labelsEl.appendChild(c);
    });
  }
  function renderStepper(){
    var cur=stageIndex(stageOf());stepper.textContent='';
    STAGES.forEach(function(s,i){
      var li=el('li',[i<cur?'done':'',i===cur?'current':'',viewing===s[0]?'shown':''].join(' ').trim()||null);
      // Earlier steps of the current cycle can be opened again; Set up is only the starting point.
      var canView=i<cur&&i>0,b=el(canView?'button':'span','step');
      if(canView){b.type='button';b.addEventListener('click',function(){viewing=s[0];renderAll()})}
      if(i===cur)b.setAttribute('aria-current','step');
      b.appendChild(el('span','step-n',i<cur?'✓':String(i+1)));b.appendChild(el('span','step-t',s[1]));
      li.appendChild(b);stepper.appendChild(li);
    });
  }
  // The stage content goes in the scrolling panel; the next step's button, progress and errors go in the bar
  // pinned under it, so they stay in view on a laptop screen.
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
    var key=shown+':'+state.experimentCount;
    if(key!==lastShown){scroller.scrollTop=0;lastShown=key}
  }
  function head(step,title,intro,tags){
    var i=stageIndex(step);
    panel.appendChild(el('div','stage-k','Step '+(i+1)+' · '+STAGES[i][1]));
    panel.appendChild(el('h3','stage-h',title));
    if(tags&&tags.length){var t=el('div','tags');tags.forEach(function(x){t.appendChild(el('span','chip '+(x[1]||''),x[0]))});panel.appendChild(t)}
    if(intro)panel.appendChild(el('p','stage-intro',intro));
  }
  function note(text,cls){panel.insertBefore(el('div',cls||'dnote',text),panel.firstChild)}
  function action(label,route,hint){
    var btn=el('button','btn run',label);btn.type='button';
    btn.addEventListener('click',function(){act(route)});
    if(hint)actionbar.appendChild(el('span','dsub',hint));
    actionbar.appendChild(btn);actionbar.hidden=false;
  }
  function rich(parent,parts){parts.forEach(function(p){parent.appendChild(typeof p==='string'?document.createTextNode(p):el('b',null,p.b))});return parent}
  function looked(x){return cap((x.toolCalls||[]).map(function(c){return (TOOL_NAMES[c.name]||c.name)+(c.suppliedBySystem?' (added by the system)':'')}).join(', '))+'.'}

  function renderSetup(live){
    head('setup','Start with a baseline',STATIC.companies[company].name+' segments its audiences '+SEGMENTS[company]+'. The baseline sends each audience its original message on every channel it uses, so SignalLoop has something to measure before the agents suggest what to change.');
    var ul=el('ul','aud-list');
    STATIC.companies[company].audiences.forEach(function(a){
      var li=el('li');li.appendChild(el('b',null,a.name));li.appendChild(el('span',null,a.channels.map(function(c){return CH[c]}).join(' · ')));ul.appendChild(li);
    });
    panel.appendChild(ul);
    if(live)action('Run baseline experiment','run','Updates the audience lists in HubSpot, then measures a simulated response.');
  }

  function renderResults(live){
    var a=state.analytics,L=a.latest,t=L.testVsControl;
    head('results','Experiment '+L.experimentNumber+(t?': did the new variant win?':': baseline results'),null,[['Simulated','sim'],['Calculated by code','code']]);
    if(t)panel.appendChild(verdict(L));
    var two=el('div','two');
    two.appendChild(insightCard('What we learned about audiences',a.insights.audience,'Not enough data for audience patterns yet.'));
    two.appendChild(insightCard('What we learned about channels',a.insights.channel,'Not enough data for channel patterns yet.'));
    panel.appendChild(two);

    var d=el('details','data');d.appendChild(el('summary',null,'See the data'));
    d.appendChild(el('div','dlab','Experiment '+L.experimentNumber));
    d.appendChild(table(['Variant','Audience','Channel','Angle','Content type','Reach','Clicks','CTR','vs previous'],L.cells.map(function(c){
      return {cells:[variantLabel(c),aud(c.audienceId),CH[c.channel],angle(c.messagingAngle),ctype(c.contentType),String(c.reach),String(c.clicks),pct(c.ctr),c.changeVsPreviousPp==null?'—':pp(c.changeVsPreviousPp)]}}),5,[0,4,8]));
    d.appendChild(el('div','dlab dsubhead','Channels by audience'));
    var rows=[];
    state.audiences.forEach(function(p){
      var x=a.byAudience[p.id],leaders=x.channelLeaders;
      x.channels.forEach(function(c){
        var tags=[];
        if(leaders.efficiency&&leaders.efficiency.channel===c.channel)tags.push('Efficiency leader');
        if(leaders.volume&&leaders.volume.channel===c.channel)tags.push('Volume leader');
        rows.push({cls:tags.length?'lead':'',cells:[p.name,c.label,c.tested?pct(c.ctr):'—',c.tested?String(c.expectedClicksPerExperiment):'—',tags.join(' · ')]});
      });
    });
    d.appendChild(table(['Audience','Channel','CTR','Clicks per experiment','Leader'],rows,2));
    d.appendChild(el('div','dsub','Efficiency leader = highest CTR. Volume leader = most expected clicks per experiment. The Marketing Agent weighs them against the campaign objective.'));
    d.appendChild(el('div','dlab dsubhead','All experiments so far'));
    d.appendChild(table(['Audience','Reach','Clicks','CTR','vs other audiences'],a.audiences.filter(function(x){return x.reach>0}).map(function(x){
      return {cells:[x.name,String(x.reach),String(x.clicks),pct(x.ctr),x.vsOthers?pp(x.vsOthers.deltaPp)+(x.vsOthers.significant?'':' (not significant)'):'—']}}),1));
    var dims=el('div','two');dims.appendChild(dimTable('Messaging angle',a.angles.tested));dims.appendChild(dimTable('Content type',a.contentTypes.tested));d.appendChild(dims);
    panel.appendChild(d);

    if(!live)return;
    if(state.experimentCount>=state.maxExperiments){actionbar.appendChild(el('span','dsub','This session has reached '+state.maxExperiments+' experiments. Start over to run more.'));actionbar.hidden=false}
    else action('Get a recommendation','strategy','The Marketing Agent reads these results and suggests what to test next. You review it before any content is written.');
  }
  function dimTable(title,rows){var w=el('div');w.appendChild(el('div','dlab dsubhead',title+', all audiences'));w.appendChild(table([title,'Reach','CTR'],rows.map(function(r){return {cells:[r.label,String(r.reach),pct(r.ctr)]}}),1));return w}
  function insightCard(title,items,empty){
    var c=el('div','card');c.appendChild(el('div','card-t',title));
    if(!items||!items.length){c.appendChild(el('p','dsub',empty));return c}
    var ul=el('ul','ins');items.forEach(function(i){ul.appendChild(el('li',null,i.text))});c.appendChild(ul);return c;
  }
  function verdict(L){
    var t=L.testVsControl,test=L.cells.filter(function(c){return c.role==='test'})[0],ctrl=L.cells.filter(function(c){return c.role==='control'})[0];
    var won=t.significant&&t.deltaPp>0,lost=t.significant&&t.deltaPp<0;
    var box=el('div','verdict'+(won?' win':lost?' lose':''));
    box.appendChild(el('div','verdict-h',won?'The new variant won':lost?'The best-so-far variant held on':'Too close to call'));
    box.appendChild(el('div','dsub',t.significant
      ?'The new variant\'s CTR was '+pp(t.deltaPp)+' against the best so far, a difference large enough to trust.'
      :'The new variant\'s CTR was '+pp(t.deltaPp)+' against the best so far; '+t.reason+'.'));
    var g=el('div','versus');
    [test,ctrl].forEach(function(c){
      if(!c)return;
      var v=el('div','vs-card'+(c.role==='test'?' test':''));
      v.appendChild(el('div','vs-l',variantLabel(c)));v.appendChild(el('div','vs-ctr',pct(c.ctr)));
      v.appendChild(el('div','dsub',c.clicks+' clicks of '+c.reach+' reached'));
      if(c.headline)v.appendChild(el('div','vs-h','“'+c.headline+'”'));
      v.appendChild(el('div','dsub',angle(c.messagingAngle)+' · '+ctype(c.contentType)));
      g.appendChild(v);
    });
    box.appendChild(g);
    var any=test||ctrl;box.appendChild(el('div','dsub',aud(any.audienceId)+' on '+CH[any.channel]+', audience split 50/50.'));
    return box;
  }

  function renderStrategy(live){
    var m=state.pendingPlan.marketing,r=m.recommendation,n=state.experimentCount+1;
    head('strategy','What should experiment '+n+' test?',null,[['AI · '+m.provider+' · '+m.model,'ai']]);
    var grid=el('div','strategy-grid'),left=el('div'),right=el('div');
    left.appendChild(rich(el('p','rec'),['Reach ',{b:aud(r.priorityAudience)},' on ',{b:CH[r.recommendedChannel]},' with ',{b:angle(r.recommendedAngle)},' messaging in a ',{b:ctype(r.recommendedContentType).toLowerCase()},' format.']));
    var chips=el('div','tags');chips.appendChild(el('span','chip',DECISIONS[r.decisionType]||r.decisionType));chips.appendChild(el('span','chip',cap(r.confidence)+' confidence'));left.appendChild(chips);
    kv(left,[['Hypothesis',r.hypothesis],['Why',r.reasoning],['Trade-off',r.tradeoff]],'kv compact');
    right.appendChild(el('div','dlab','The numbers behind it'));
    var ul=el('ul','why');
    m.evidence.forEach(function(e){
      var li=el('li');li.appendChild(el('div',null,e.statement));
      if(e.metric){var parts=[e.metric.label];if(e.metric.reach)parts.push(pct(e.metric.ctr)+' CTR','clicks '+e.metric.clicks+' of '+e.metric.reach+' reached');if(e.metric.deltaPp!=null)parts.push(pp(e.metric.deltaPp));li.appendChild(el('div','dsub',parts.join(' · ')))}
      ul.appendChild(li);
    });
    right.appendChild(ul);
    var d=el('details','data');d.appendChild(el('summary',null,'What the agent looked at'));d.appendChild(el('p','dsub',looked(m)));right.appendChild(d);
    grid.appendChild(left);grid.appendChild(right);panel.appendChild(grid);
    if(live)action('Create content for this','content','The Content Agent plans and writes the variant for '+aud(r.priorityAudience)+' on '+CH[r.recommendedChannel]+'.');
  }

  function renderContent(live){
    var plan=state.pendingPlan,c=plan.content,cp=c.contentPlan,r=plan.marketing.recommendation,n=state.experimentCount+1;
    head('content','The variant for experiment '+n,null,[['AI · '+c.provider+' · '+c.model,'ai'],[CH[r.recommendedChannel]+' · '+ctype(r.recommendedContentType)]]);
    var grid=el('div','content-grid'),side=el('div','content-side');
    grid.appendChild(preview(r.recommendedChannel,c.generatedContent,c.sampleContact,cp.cta));
    side.appendChild(el('div','dlab','The experiment'));
    plan.spec.cells.forEach(function(x){
      var card=el('div','vs-card'+(x.role==='test'?' test':''));
      card.appendChild(el('div','vs-l',variantLabel(x)));
      card.appendChild(el('div','vs-h','“'+x.variant.headline+'”'));
      card.appendChild(el('div','dsub',angle(x.messagingAngle)+' · '+ctype(x.contentType)));
      card.appendChild(el('div','dsub',Math.round(x.share*100)+'% of '+aud(x.audienceId)+' on '+CH[x.channel]));
      side.appendChild(card);
    });
    side.appendChild(el('div','dsum','Hypothesis: '+r.hypothesis));
    var d=el('details','data');d.appendChild(el('summary',null,'Why this content'));
    kv(d,[['Audience insight',cp.audienceInsight],['Content angle',cp.contentAngle],['Topic',cp.topic],['Hook',cp.hook],['Key message',cp.keyMessage],['Supporting points',cp.supportingPoints],['Tone',cp.tone],['Format',cp.format],['Content brief',cp.contentBrief]]);
    d.appendChild(el('p','dsub','What the agent looked at: '+looked(c)));
    side.appendChild(d);
    grid.appendChild(side);panel.appendChild(grid);
    if(live)action('Run as experiment '+n,'run','Updates HubSpot, then measures a simulated response: the new variant for half of '+aud(r.priorityAudience)+', the best so far for the other half.');
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
    d.appendChild(el('summary',null,'Experiment history ('+state.experimentCount+')'));
    var ol=el('ol','timeline');
    state.experiments.forEach(function(e){
      var li=el('li');
      if(e.kind==='baseline'){
        li.appendChild(el('b',null,'Experiment '+e.experimentNumber+': baseline'));
        li.appendChild(document.createTextNode(' · '+e.cells.length+' audience and channel combinations with their original messages'));
      }else{
        var t=e.cells.filter(function(c){return c.role==='test'})[0],k=e.cells.filter(function(c){return c.role==='control'})[0];
        li.appendChild(el('b',null,'Experiment '+e.experimentNumber+': '+aud(t.audienceId)+' on '+CH[t.channel]));
        li.appendChild(document.createTextNode(' · new variant ('+angle(t.messagingAngle)+', '+ctype(t.contentType).toLowerCase()+') '+pct(t.ctr)+' vs best so far ('+angle(k.messagingAngle)+', '+ctype(k.contentType).toLowerCase()+') '+pct(k.ctr)));
        if(e.hypothesis)li.appendChild(el('div','dsub','Hypothesis: '+e.hypothesis));
      }
      ol.appendChild(li);
    });
    d.appendChild(ol);historyEl.appendChild(d);
  }

  // --- actions ---
  async function act(route){
    if(busy)return;busy=true;syncControls();bringIntoView();
    [].slice.call(demo.querySelectorAll('.derr,.dnote')).forEach(function(e){e.remove()});
    var progress=el('div','dprogress'),msg=el('div','dsub',WORKING[route]);msg.setAttribute('role','status');
    progress.appendChild(el('div','bar'));progress.appendChild(msg);actionbar.appendChild(progress);
    var res=await api('POST',route,{objective:objSel.value});
    busy=false;
    if(!res.network&&res.status===409&&await refreshFromServer()){
      viewing=null;renderAll();
      note('The copy of this demo saved in your browser was out of date, so it has been refreshed. Continue from here.');
    }else if(res.network||!res.ok){
      progress.remove();syncControls();
      var err=el('div','derr',res.network?'Could not reach the demo API. The live demo runs on signalloop-shiva.netlify.app.':(res.body.error||'Something went wrong.'));
      if(res.body&&res.body.attempts&&res.body.attempts.length){
        err.appendChild(el('div','dsub','Tried: '+res.body.attempts.map(function(a){return a.provider?(a.provider+(a.status?' ('+a.status+')':'')):(a.errors||[]).join('; ')}).join(', ')));
      }
      actionbar.appendChild(err);
    }else{
      state=res.body;saveState();viewing=null;renderAll();bringIntoView();
    }
  }
  // Keep the whole demo frame on screen while it is in use. On laptops the frame is sized to the window, so
  // this lines it up under the site navigation; on phones it brings the top of the new step into view.
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
      STATIC.objectives.forEach(function(o){var op=el('option',null,o.label);op.value=o.id;objSel.appendChild(op)});
      objSel.value=STATIC.defaultObjective;
    }
    state=savedState()||emptyState();viewing=null;renderAll();
  }
  resetBtn.addEventListener('click',async function(){
    if(busy)return;busy=true;syncControls();
    var res=await api('POST','reset',{objective:objSel.value});busy=false;
    if(res.ok){state=res.body;saveState();viewing=null;renderAll();note('Session cleared. Start again with a baseline.')}
    else{renderAll();note((res.body&&res.body.error)||'Could not start over. Please try again.','derr')}
  });
  objSel.addEventListener('change',function(){
    if(!state)return;
    state.objective=find(STATIC.objectives,objSel.value);
    if(state.pendingPlan){renderPanel();syncControls();note('The new objective applies to the next recommendation.')}
  });
  picks.forEach(function(b){b.addEventListener('click',function(){
    if(busy)return;company=b.getAttribute('data-company');
    picks.forEach(function(x){var on=x===b;x.classList.toggle('on',on);x.setAttribute('aria-checked',on?'true':'false')});
    load();
  })});
  load();

  // Links to the live demo land with the whole demo frame in view, not just the section heading above it.
  [].slice.call(document.querySelectorAll('a[href="#live"]')).forEach(function(a){
    a.addEventListener('click',function(e){e.preventDefault();if(history.replaceState)history.replaceState(null,'','#live');bringIntoView(true)});
  });
  function alignOnArrival(){if(location.hash==='#live')setTimeout(function(){bringIntoView(true)},50)}
  if(document.readyState==='complete')alignOnArrival();else addEventListener('load',alignOnArrival);
  addEventListener('hashchange',alignOnArrival);
})();
