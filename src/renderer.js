// Runs only in the local Codex renderer; no remote scripts or network requests.
(() => {
  const version='0.1.4';
  const revision=4;
  const installed=window.__codexComposerMeter?.state();
  if (installed?.version===version && installed.revision===revision) return;
  window.__codexComposerMeter?.destroy();
  const messages={
    'zh-CN':{
      product:'Codex 用量监控', settings:'Codex 用量监控设置', language:'界面语言',
      cache:'命中', context:'上下文', quota:'额度', reset:'重置', stale:'快照',
      tokenDetails:'当前聊天 · Token 明细', cacheTip:'累计缓存输入 ÷ 累计输入', contextDetails:'上下文实际数值',
      total:'累计 token', input:'输入 token', output:'输出 token', reasoning:'推理 token', cached:'缓存输入 token',
      used:'已用 token', remaining:'剩余 token', window:'窗口上限',
      check:'检查更新', checkFull:'检查更新', download:'前往 GitHub 下载',
      helper:'辅助进程', pid:'进程 PID', port:'调试端口', clientPid:'客户端 PID', connection:'连接状态', uptime:'运行时间',
      connected:'已连接', waiting:'等待连接', stop:'立即关闭', restart:'重启',
      stopping:'正在关闭状态条…', restarting:'正在重启状态条…', sendFailed:'操作未发送，请稍后重试。',
      restartFailed:'重启进程创建失败，请稍后重试。', previewControl:'预览已收到操作。',
      languageFailed:'语言设置保存失败，请重试。', current:'未发现更新', error:'检查失败，请重试',
      checking:'正在检查更新…', disconnected:'连接中断，请重试', available:'发现新版本',
      pendingReset:'待刷新', day:'天', hour:'时', minute:'分', second:'秒', unknown:'未知',
      accountQuota:'账号共享额度', live:'接口查询', snapshot:'日志快照', checked:'更新', resetsAt:'重置时间',
      quotaUnknown:'尚未取得账号额度，等待本地用量事件或接口查询。',
      recentContext:'最近模型调用占用', contextUnknown:'尚无上下文数据',
    },
    'en-US':{
      product:'Codex Usage Monitor', settings:'Codex Usage Monitor settings', language:'Language',
      cache:'Cache', context:'Ctx', quota:'Quota', reset:'Reset', stale:'Stale',
      tokenDetails:'Chat token usage', cacheTip:'Cached input ÷ total input', contextDetails:'Context usage',
      total:'Total tokens', input:'Input tokens', output:'Output tokens', reasoning:'Reasoning tokens', cached:'Cached input',
      used:'Tokens used', remaining:'Tokens left', window:'Window size',
      check:'Check for updates', checkFull:'Check for updates', download:'Download on GitHub',
      helper:'Helper', pid:'Helper PID', port:'Debug port', clientPid:'Client PID', connection:'Connection', uptime:'Uptime',
      connected:'Connected', waiting:'Connecting', stop:'Stop now', restart:'Restart',
      stopping:'Stopping the monitor…', restarting:'Restarting the monitor…', sendFailed:'Could not send command. Try again.',
      restartFailed:'Could not start the monitor. Try again.', previewControl:'Preview received the command.',
      languageFailed:'Could not save language. Try again.', current:'Up to date', error:'Check failed. Retry.',
      checking:'Checking…', disconnected:'Disconnected. Retry.', available:'New version',
      pendingReset:'Pending', day:'d', hour:'h', minute:'m', second:'s', unknown:'Unknown',
      accountQuota:'Shared account quota', live:'Live', snapshot:'Log snapshot', checked:'Checked', resetsAt:'Resets',
      quotaUnknown:'Waiting for quota data from the CLI or local logs.',
      recentContext:'Last model call', contextUnknown:'No context data yet',
    },
  };
  let locale;
  const t=key=>messages[locale][key];
  const supported=value=>value==='zh-CN'||value==='en-US';
  const id = 'codex-composer-meter';
  const root = document.createElement('div'); root.id = id;
  const shadow = root.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host { position:fixed; z-index:100; display:block; color:var(--text-secondary,#6b7280); font:11px/1.45 system-ui,"Microsoft YaHei",sans-serif; }
    * { box-sizing:border-box; } button,select { font:inherit; color:inherit; cursor:pointer; }
    .bar { display:flex; align-items:center; justify-content:center; height:100%; gap:7px; white-space:nowrap; font-size:10.5px; }
    .total,.context,.settings { border:0; background:transparent; padding:0 2px; border-radius:4px; }
    .total,.context { display:inline-flex; align-items:center; justify-content:center; height:100%; gap:2px; }
    .total:hover,.total:focus-visible,.context:hover,.context:focus-visible,.settings:hover,.settings:focus-visible { background:rgba(128,128,128,.12); outline:1px solid rgba(128,128,128,.3); }
    .settings { display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; flex-shrink:0; }
    .settings svg { width:13px; height:13px; }
    .panel.settings-panel { left:auto; right:0; transform:none; width:220px; max-width:calc(100vw - 24px); padding-bottom:8px; }
    .settings-header { margin-bottom:8px; }
    .settings-header .heading { margin:0 0 8px; display:flex; align-items:baseline; gap:5px; }
    .settings-version { font-size:10px; font-weight:400; opacity:.72; }
    .settings-tools { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; font-size:10px; }
    .language-control { display:grid; justify-items:start; gap:3px; }
    .update-control { min-width:0; text-align:right; font-size:10px; overflow-wrap:anywhere; }
    .process-actions { display:flex; justify-content:space-between; gap:8px; margin-top:8px; }
    .process-actions button,.update-control button,.language-control select { border:1px solid rgba(128,128,128,.28); background:transparent; }
    .process-actions button { flex:0 1 80px; padding:3px 8px; border-radius:6px; }
    .update-control button,.language-control select { padding:2px 6px; border-radius:4px; white-space:nowrap; }
    .language-control option { background:var(--surface-primary,#fff); }
    .settings-panel dl { border-top:1px solid rgba(128,128,128,.17); padding-top:4px; }
    .process-actions button:hover:enabled,.update-control button:hover:enabled { background:rgba(128,128,128,.12); }
    .process-actions button:disabled,.update-control button:disabled { opacity:.45; cursor:default; }
    .process-actions [data-action="stop"] { color:#c54747; }
    .process-feedback { margin-top:8px; font-size:11px; }
    .process-feedback:empty,.update-feedback:empty { display:none; }
    .update-feedback,.update-link { margin-top:3px; }
    .update-link { display:block; color:inherit; text-decoration:underline; }
    .update-link[hidden] { display:none; }
    strong { font-weight:600; font-variant-numeric:tabular-nums; color:var(--text-primary,#31363d); }
    .dim { opacity:.75; } .warn { color:#b7791f; } .high { color:#c54747; }
    .panel { position:absolute; bottom:calc(100% + 12px); left:50%; transform:translateX(-50%); width:210px; padding:13px 12px; border:1px solid rgba(128,128,128,.23); border-radius:12px; background:var(--surface-primary,#fff); color:var(--text-primary,#31363d); box-shadow:0 8px 30px #0002; font-size:12px; }
    .panel[hidden] { display:none; } .heading { font-weight:600; margin-bottom:8px; }
    dl { margin:0; } .item { display:flex; justify-content:space-between; gap:12px; padding:4px 0; }
    dt { color:var(--text-secondary,#6b7280); } dd { margin:0; font-variant-numeric:tabular-nums; }
    @media(prefers-color-scheme:dark) { :host { color:var(--text-secondary,#aaa); } strong,.panel { color:var(--text-primary,#ddd); } .panel { background:var(--surface-primary,#252525); } }
  </style><div class="bar"><button class="total" aria-expanded="false" aria-controls="details" data-tooltip="tokenDetails"><strong data-k="total">—</strong> tok</button><span data-tooltip="cacheTip"><span data-text="cache"></span> <strong data-k="cache">—</strong></span><button class="context" aria-expanded="false" aria-controls="context-details" data-tooltip="contextDetails"><span data-text="context"></span> <strong data-k="context">—</strong></button><span class="dim" data-k="quota">—</span><span class="dim" data-k="reset">—</span><button class="settings" data-label="settings" aria-expanded="false" aria-controls="process-details" data-tooltip="settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.2 3-.6 2.2-1.9 1.1-2.2-.5-2 3.4 1.6 1.7v2.2l-1.6 1.7 2 3.4 2.2-.5 1.9 1.1.6 2.2h4l.6-2.2 1.9-1.1 2.2.5 2-3.4-1.6-1.7v-2.2l1.6-1.7-2-3.4-2.2.5-1.9-1.1-.6-2.2z"/><circle cx="11.2" cy="12" r="3"/></svg></button></div>
  <section class="panel" id="details" hidden data-label="tokenDetails"><div class="heading" data-text="tokenDetails"></div><dl>
  <div class="item"><dt data-text="total"></dt><dd data-detail="total">—</dd></div>
  <div class="item"><dt data-text="input"></dt><dd data-detail="input">—</dd></div>
  <div class="item"><dt data-text="output"></dt><dd data-detail="output">—</dd></div>
  <div class="item"><dt data-text="reasoning"></dt><dd data-detail="reasoning">—</dd></div>
  <div class="item"><dt data-text="cached"></dt><dd data-detail="cached">—</dd></div>
  </dl></section>
  <section class="panel" id="context-details" hidden data-label="contextDetails"><div class="heading" data-text="contextDetails"></div><dl>
  <div class="item"><dt data-text="used"></dt><dd data-context-detail="used">—</dd></div>
  <div class="item"><dt data-text="remaining"></dt><dd data-context-detail="remaining">—</dd></div>
  <div class="item"><dt data-text="window"></dt><dd data-context-detail="window">—</dd></div>
  </dl></section>
  <section class="panel settings-panel" id="process-details" hidden data-label="settings">
  <div class="settings-header">
    <div class="heading"><span data-text="product"></span><span class="settings-version">v${version}</span></div>
    <div class="settings-tools">
      <label class="language-control">
        <span data-text="language"></span>
        <select disabled><option value="zh-CN" lang="zh-CN">简体中文</option><option value="en-US" lang="en-US">English</option></select>
      </label>
      <div class="update-control">
        <button type="button" data-action="check-update" data-text="check" data-label="checkFull" data-tooltip="checkFull" disabled></button>
        <div class="update-feedback" role="status" aria-live="polite"></div>
        <a class="update-link" target="_blank" rel="noopener noreferrer" data-text="download" hidden></a>
      </div>
    </div>
  </div><dl>
  <div class="item"><dt data-text="helper"></dt><dd data-process="name">—</dd></div>
  <div class="item"><dt data-text="pid"></dt><dd data-process="pid">—</dd></div>
  <div class="item"><dt data-text="port"></dt><dd data-process="endpoint">—</dd></div>
  <div class="item"><dt data-text="clientPid"></dt><dd data-process="clientPid">—</dd></div>
  <div class="item"><dt data-text="connection"></dt><dd data-process="connection">—</dd></div>
  <div class="item"><dt data-text="uptime"></dt><dd data-process="uptime">—</dd></div>
  </dl>
  <div class="process-actions"><button type="button" data-action="stop" data-text="stop" disabled></button><button type="button" data-action="restart" data-text="restart" disabled></button></div>
  <div class="process-feedback" role="status" aria-live="polite"></div></section>`;
  const toggles = [...shadow.querySelectorAll('button[aria-controls]')];
  function close() { for(const button of toggles){shadow.getElementById(button.getAttribute('aria-controls')).hidden=true;button.setAttribute('aria-expanded','false');} }
  for(const button of toggles) button.addEventListener('click',()=>{
    const panel=shadow.getElementById(button.getAttribute('aria-controls')),open=panel.hidden;
    close();panel.hidden=!open;button.setAttribute('aria-expanded',String(open));
  });
  function outside(e) { if (!e.composedPath().includes(root)) close(); }
  function key(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key);
  let data = null, lastThread = null, binding = null, hiddenReason='no-agent-composer',lastUpdate=0,controlPending=false;
  const feedback=shadow.querySelector('.process-feedback');
  const updateFeedback=shadow.querySelector('.update-feedback');
  const updateLink=shadow.querySelector('.update-link');
  const updateButton=shadow.querySelector('[data-action="check-update"]');
  const language=shadow.querySelector('.language-control select');
  let pendingLocale=null, localeDeadline=0, controlMessage='';
  function applyLocale(next) {
    if(!supported(next)||next===locale)return;
    locale=next;
    root.lang=locale;
    for(const el of shadow.querySelectorAll('[data-text]'))el.textContent=t(el.dataset.text);
    for(const el of shadow.querySelectorAll('[data-label]'))el.setAttribute('aria-label',t(el.dataset.label));
    for(const el of shadow.querySelectorAll('[data-tooltip]'))el.title=t(el.dataset.tooltip);
  }
  function canSend() {
    return !controlPending&&data?.process?.controlToken&&Date.now()-lastUpdate<=8000&&typeof window.__codexMeterControl==='function';
  }
  function send(command) {
    window.__codexMeterControl(JSON.stringify({...command,token:data.process.controlToken}));
  }
  language.addEventListener('change',()=>{
    if(canSend()&&supported(data?.locale)&&supported(language.value)&&language.value!==locale) {
      pendingLocale=language.value;
      localeDeadline=Date.now()+8000;
      if(controlMessage==='languageFailed')controlMessage='';
      try{send({action:'set-locale',locale:pendingLocale});}
      catch{pendingLocale=null;controlMessage='languageFailed';}
    }
    paint();
  });
  for(const button of shadow.querySelectorAll('[data-action]'))button.addEventListener('click',()=>{
    if(!canSend())return;
    const action=button.dataset.action;
    if(action==='check-update')data.release={state:'checking'};
    else {
      controlPending=true;
      controlMessage=action==='restart'?'restarting':'stopping';
    }
    try{send({action});}
    catch{
      if(action==='check-update')data.release={state:'error'};
      else{controlPending=false;controlMessage='sendFailed';}
    }
    paint();
  });
  const norm = x => typeof x === 'string' ? x.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]?.toLowerCase() ?? null : null;
  function isDotSurface() {
    const url=new URL(window.location.href);
    return [url.pathname,url.searchParams.get('initialRoute')].includes('/spotlight');
  }
  function resolveComposer() {
    // Dot reuses the agent composer in its dedicated Spotlight window.
    if(isDotSurface())return null;
    // ChatGPT Work and Codex share the agent composer; plain ChatGPT Chat uses
    // data-chatgpt-composer. Cached, hidden tabs must never supply the active ID.
    // Dot and side panels share this marker. Bind only the main chat, regardless of focus.
    const candidates=[...document.querySelectorAll('[data-codex-composer-root] [data-composer-footer-responsive]')]
      .filter(visible).filter(footer=>!footer.closest('[data-chatgpt-composer],.messaging-root,[data-role="composer"],[data-tab-id^="sidechat:"],[data-app-shell-focus-area="right-panel"]'))
      .map(footer=>({footer,composer:footer.closest('[data-codex-composer-root]')}));
    candidates.sort((a,b)=>b.footer.getBoundingClientRect().bottom-a.footer.getBoundingClientRect().bottom);
    const selected=candidates[0];
    if(!selected)return null;
    const direct=selected.composer.querySelector('[data-above-composer-conversation-id]');
    return {...selected,threadId:norm(direct?.getAttribute('data-above-composer-conversation-id'))};
  }
  function visible(el) {
    if(!el||el.closest('[hidden],[inert],[aria-hidden="true"]'))return false;
    const rect=el.getBoundingClientRect(),style=getComputedStyle(el);
    return rect.width>0&&rect.height>0&&style.visibility!=='hidden'&&style.display!=='none';
  }
  function controlGap(footer) {
    // The agent footer is a two-row grid. Its first child is the editor, and
    // its right column stretches across the free area. Measure actual controls.
    const f=footer.getBoundingClientRect();
    const selector='button,[role="button"],[role="combobox"],input:not([type="hidden"]),select';
    const controls=[...footer.querySelectorAll(selector)].filter(visible)
      .filter(el=>!el.closest('[data-composer-input],[data-composer-input-layout],[contenteditable="true"]'))
      .filter(el=>!el.parentElement?.closest(selector))
      .map(el=>el.getBoundingClientRect());
    if(controls.length<2)return null;
    const lowest=controls.reduce((a,b)=>a.bottom>b.bottom?a:b);
    const row=controls.filter(r=>Math.abs((r.top+r.bottom-lowest.top-lowest.bottom)/2)<Math.min(r.height,lowest.height)/2).sort((a,b)=>a.left-b.left);
    const gaps=[];
    for(let i=1,right=row[0]?.right;i<row.length;i++){
      const r=row[i];
      if(r.left>right)gaps.push({start:right+8,end:r.left-8});
      right=Math.max(right,r.right);
    }
    const gap=gaps.sort((a,b)=>(b.end-b.start)-(a.end-a.start))[0];
    if(!gap)return null;
    return {...gap,top:Math.max(f.top,Math.min(...row.map(r=>r.top))),height:Math.min(f.bottom,Math.max(...row.map(r=>r.bottom)))-Math.max(f.top,Math.min(...row.map(r=>r.top)))};
  }
  function place() {
    binding=resolveComposer();
    const current=binding?.threadId??null;
    if (current !== lastThread) { data = null; close(); lastThread = current; paint(); }
    if (!binding) { hiddenReason=isDotSurface()?'dot-surface':'no-agent-composer';root.style.display = 'none';close();return; }
    const {footer}=binding;
    if (!root.isConnected) document.body.append(root);
    const gap=controlGap(footer);
    if(!gap){hiddenReason='no-control-gap';root.style.display='none';return;}
    const {start,end,top,height}=gap;
    let width=end-start;
    // Never cover native actions. Hide when there is no genuine free space.
    if (width < 220 || height < 20) { hiddenReason='insufficient-space';root.style.display = 'none'; return; }
    width = Math.min(430,width);
    hiddenReason=null;
    root.style.cssText = `position:fixed;z-index:100;display:block;left:${start+(end-start-width)/2}px;top:${top}px;width:${width}px;height:${height}px;`;
    const foreground = getComputedStyle(footer).color;
    root.style.setProperty('--text-primary',foreground);
    root.style.setProperty('--text-secondary',foreground);
    let surface=footer;
    while(surface){const bg=getComputedStyle(surface).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent'){root.style.setProperty('--surface-primary',bg);break;}surface=surface.parentElement;}
  }
  const fmt = n => n == null ? '—' : n >= 1e9 ? (n/1e9).toFixed(2)+'B' : n >= 1e6 ? (n/1e6).toFixed(2)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n);
  const detailFormatter=new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2});
  function setDetail(el,value){el.textContent=value==null?'—':detailFormatter.format(value);el.title=value==null?'':value.toLocaleString(locale);}
  function remaining(resetsAt) {
    if (!resetsAt) return '—'; let s = Math.ceil(resetsAt - Date.now()/1000); if (s <= 0) return t('pendingReset');
    const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);
    return d ? `${d}d${h}h` : h ? `${h}h${m}m` : `${m}m${s%60}s`;
  }
  function paint() {
    const u = data?.threadId === lastThread ? data?.usage : null;
    const put = (key,text) => { shadow.querySelector(`[data-k="${key}"]`).textContent = text; };
    put('total',fmt(u?.total)); put('cache',u?.cacheRate == null ? '—' : u.cacheRate.toFixed(1)+'%');
    put('context',u?.contextPercent == null ? '—' : u.contextPercent.toFixed(0)+'%');
    shadow.querySelector('[data-k="context"]').className = u?.contextPercent >= 85 ? 'high' : u?.contextPercent >= 70 ? 'warn' : '';
    for(const el of shadow.querySelectorAll('[data-detail]')) setDetail(el,u?.[el.dataset.detail]);
    const contextDetails={used:u?.context,window:u?.window,remaining:u?.context!=null&&u?.window!=null?Math.max(0,u.window-u.context):null};
    for(const el of shadow.querySelectorAll('[data-context-detail]'))setDetail(el,contextDetails[el.dataset.contextDetail]);
    const q=data?.quota, stale=q && Date.now()-q.observedAt > 120000;
    const wins=q?.windows ?? [];
    const shownWins=root.getBoundingClientRect().width<340&&wins.length>1?[wins.reduce((a,b)=>a.remaining<b.remaining?a:b)]:wins;
    const label=w=>w.minutes>=10080?`7${t('day')}`:w.minutes>=1440?`${Math.round(w.minutes/1440)}${t('day')}`:w.minutes?`${w.minutes/60}${t('hour')}`:'';
    const quotaText=shownWins.map(w=>`${shownWins.length>1?label(w)+' ':''}${w.remaining.toFixed(0)}%`).join(' / ');
    put('quota',`${t('quota')} ${quotaText||'—'}${quotaText&&stale?' · '+t('stale'):''}`);
    put('reset',`${t('reset')} ${shownWins.map(w=>remaining(w.resetsAt)).join(' / ')||'—'}`);
    const tip = q ? [
      t('accountQuota'), t(q.source==='live'?'live':'snapshot'),
      `${t('checked')} ${new Date(q.observedAt).toLocaleTimeString(locale)}`,
      ...wins.map(w=>`${label(w)} ${w.remaining.toFixed(1)}% · ${t('resetsAt')} ${w.resetsAt?new Date(w.resetsAt*1000).toLocaleString(locale):t('unknown')}`),
    ].join(' · ') : t('quotaUnknown');
    shadow.querySelector('[data-k="quota"]').title=tip;
    shadow.querySelector('[data-k="reset"]').title=tip;
    shadow.querySelector('.context').title=u?`${fmt(u.context)} / ${fmt(u.window)} · ${t('recentContext')}`:t('contextUnknown');
    const process=data?.process,fresh=process&&Date.now()-lastUpdate<=8000;
    const elapsed=process?.startedAt?Math.max(0,Math.floor((Date.now()-Date.parse(process.startedAt))/1000)):null;
    const uptime=elapsed==null?null:elapsed>=3600?`${Math.floor(elapsed/3600)}${t('hour')} ${Math.floor(elapsed%3600/60)}${t('minute')}`:`${Math.floor(elapsed/60)}${t('minute')} ${elapsed%60}${t('second')}`;
    const processFields={name:process?.name,pid:process?.pid,endpoint:process?.port?`127.0.0.1:${process.port}`:null,clientPid:process?.clientPid,connection:t(fresh?'connected':'waiting'),uptime};
    for(const el of shadow.querySelectorAll('[data-process]'))el.textContent=processFields[el.dataset.process]??'—';
    const canControl=canSend();
    if(pendingLocale&&Date.now()>=localeDeadline){pendingLocale=null;controlMessage='languageFailed';}
    const selectedLocale=pendingLocale??locale;
    if(language.value!==selectedLocale)language.value=selectedLocale;
    language.disabled=!canControl||!supported(data?.locale)||pendingLocale!==null;
    const feedbackText=t(controlMessage)??controlMessage;
    if(feedback.textContent!==feedbackText)feedback.textContent=feedbackText;
    for(const button of shadow.querySelectorAll('.process-actions button'))button.disabled=!canControl;
    const release=data?.release;
    const checking=release?.state==='checking';
    const updateAvailable=release?.state==='available';
    let message=t(release?.state)??'';
    if(checking)message=t(fresh?'checking':'disconnected');
    if(updateAvailable)message=`${t('available')} ${release.tag}`;
    if(updateFeedback.textContent!==message)updateFeedback.textContent=message;
    updateButton.disabled=!canControl||checking;
    updateLink.hidden=!updateAvailable;
    if(updateAvailable)updateLink.href=`https://github.com/Yang-goat/codex-usage-monitor/releases/tag/${encodeURIComponent(release.tag)}`;
    const bar=shadow.querySelector('.bar'), available=root.getBoundingClientRect().width;
    bar.style.fontSize='10.5px';bar.style.gap='7px';
    if(available>0&&bar.scrollWidth>available+1){bar.style.fontSize='9px';bar.style.gap='4px';}
    root.style.visibility=available>0&&bar.scrollWidth>available+1?'hidden':'visible';
  }
  const timer=setInterval(()=>{place();paint();},1000);
  window.__codexComposerMeter = {
    state:()=>{place();return {threadId:binding?.threadId??null,scope:binding?'agent':null,mounted:root.isConnected,visible:root.isConnected&&root.style.display!=='none'&&root.style.visibility!=='hidden',hiddenReason,version,revision};},
    update:payload=>{place();data=payload;lastUpdate=Date.now();applyLocale(payload.locale);paint();},
    controlError:message=>{controlPending=false;controlMessage=message;paint();},
    localeResult:({locale:next,saved})=>{
      pendingLocale=null;
      if(!saved)controlMessage='languageFailed';
      applyLocale(next);
      paint();
    },
    destroy:()=>{clearInterval(timer);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);root.remove();delete window.__codexComposerMeter;}
  };
  applyLocale('zh-CN');place();paint();
})();
