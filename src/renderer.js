// Runs only in the local Codex renderer; no remote scripts or network requests.
(() => {
  const version='0.1.2';
  if (window.__codexComposerMeter?.state().version===version) return;
  window.__codexComposerMeter?.destroy();
  const id = 'codex-composer-meter';
  const root = document.createElement('div'); root.id = id;
  const shadow = root.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host { position:fixed; z-index:100; display:block; color:var(--text-secondary,#6b7280); font:11px/1.45 system-ui,"Microsoft YaHei",sans-serif; }
    * { box-sizing:border-box; } button { font:inherit; color:inherit; cursor:pointer; }
    .bar { display:flex; align-items:center; justify-content:center; height:100%; gap:7px; white-space:nowrap; font-size:10.5px; }
    .total,.context { border:0; background:transparent; padding:0 2px; border-radius:4px; }
    .total:hover,.total:focus-visible,.context:hover,.context:focus-visible { background:rgba(128,128,128,.12); outline:1px solid rgba(128,128,128,.3); }
    strong { font-weight:600; font-variant-numeric:tabular-nums; color:var(--text-primary,#31363d); }
    .dim { opacity:.75; } .warn { color:#b7791f; } .high { color:#c54747; }
    .panel { position:absolute; bottom:calc(100% + 12px); left:50%; transform:translateX(-50%); width:210px; padding:13px 12px; border:1px solid rgba(128,128,128,.23); border-radius:12px; background:var(--surface-primary,#fff); color:var(--text-primary,#31363d); box-shadow:0 8px 30px #0002; font-size:12px; }
    .panel[hidden] { display:none; } .heading { font-weight:600; margin-bottom:8px; }
    dl { margin:0; } .item { display:flex; justify-content:space-between; gap:12px; padding:4px 0; }
    dt { color:var(--text-secondary,#6b7280); } dd { margin:0; font-variant-numeric:tabular-nums; }
    @media(prefers-color-scheme:dark) { :host { color:var(--text-secondary,#aaa); } strong,.panel { color:var(--text-primary,#ddd); } .panel { background:var(--surface-primary,#252525); } }
  </style><div class="bar"><button class="total" aria-expanded="false" aria-controls="details" title="展开当前聊天 token 明细"><strong data-k="total">—</strong> tok</button><span title="累计缓存输入 ÷ 累计输入">命中 <strong data-k="cache">—</strong></span><button class="context" aria-expanded="false" aria-controls="context-details" title="展开上下文实际数值">上下文 <strong data-k="context">—</strong></button><span class="dim" data-k="quota">额度 —</span><span class="dim" data-k="reset">重置 —</span></div>
  <section class="panel" id="details" hidden aria-label="当前聊天 token 明细"><div class="heading">当前聊天 · Token 明细</div><dl>
  <div class="item"><dt>累计 token</dt><dd data-detail="total">—</dd></div>
  <div class="item"><dt>输入 token</dt><dd data-detail="input">—</dd></div>
  <div class="item"><dt>输出 token</dt><dd data-detail="output">—</dd></div>
  <div class="item"><dt>推理 token</dt><dd data-detail="reasoning">—</dd></div>
  <div class="item"><dt>缓存输入 token</dt><dd data-detail="cached">—</dd></div>
  </dl></section>
  <section class="panel" id="context-details" hidden aria-label="上下文实际数值"><div class="heading">上下文</div><dl>
  <div class="item"><dt>已用 token</dt><dd data-context-detail="used">—</dd></div>
  <div class="item"><dt>剩余 token</dt><dd data-context-detail="remaining">—</dd></div>
  <div class="item"><dt>窗口上限</dt><dd data-context-detail="window">—</dd></div>
  </dl></section>`;
  const toggles = [...shadow.querySelectorAll('button[aria-controls]')];
  function close() { for(const button of toggles){shadow.getElementById(button.getAttribute('aria-controls')).hidden=true;button.setAttribute('aria-expanded','false');} }
  for(const button of toggles) button.addEventListener('click',()=>{
    const panel=shadow.getElementById(button.getAttribute('aria-controls')),open=panel.hidden;
    close();panel.hidden=!open;button.setAttribute('aria-expanded',String(open));
  });
  function outside(e) { if (!e.composedPath().includes(root)) close(); }
  function key(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key);
  let data = null, lastThread = null, binding = null, hiddenReason='no-agent-composer';
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
  function setDetail(el,value){el.textContent=value==null?'—':detailFormatter.format(value);el.title=value==null?'':value.toLocaleString('zh-CN');}
  function remaining(t) {
    if (!t) return '—'; let s = Math.ceil(t - Date.now()/1000); if (s <= 0) return '待刷新';
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
    const label=w=>w.minutes>=10080?'7天':w.minutes>=1440?`${Math.round(w.minutes/1440)}天`:w.minutes?`${w.minutes/60}时`:'';
    put('quota',shownWins.length ? '额度 '+shownWins.map(w=>`${shownWins.length>1?label(w)+' ':''}${w.remaining.toFixed(0)}%`).join(' / ')+(stale?' · 快照':'') : '额度 —');
    put('reset',shownWins.length ? '重置 '+shownWins.map(w=>remaining(w.resetsAt)).join(' / ') : '重置 —');
    const tip = q ? `账号共享额度；${q.source==='live'?'接口查询':'日志快照'}；更新 ${new Date(q.observedAt).toLocaleTimeString('zh-CN')}。${wins.map(w=>`${label(w)}剩余${w.remaining.toFixed(1)}%，重置于${w.resetsAt?new Date(w.resetsAt*1000).toLocaleString('zh-CN'):'未知'}`).join('；')}` : '尚未取得账号额度，等待本地用量事件或接口查询。';
    shadow.querySelector('[data-k="quota"]').title=tip;
    shadow.querySelector('[data-k="reset"]').title=tip;
    shadow.querySelector('[data-k="context"]').title=u?`${fmt(u.context)} / ${fmt(u.window)}；最近模型调用占用`:'尚无上下文数据';
    const bar=shadow.querySelector('.bar'), available=root.getBoundingClientRect().width;
    bar.style.fontSize='10.5px';bar.style.gap='7px';
    if(available>0&&bar.scrollWidth>available+1){bar.style.fontSize='9px';bar.style.gap='4px';}
    root.style.visibility=available>0&&bar.scrollWidth>available+1?'hidden':'visible';
  }
  const timer=setInterval(()=>{place();paint();},1000);
  window.__codexComposerMeter = {
    state:()=>{place();return {threadId:binding?.threadId??null,scope:binding?'agent':null,mounted:root.isConnected,visible:root.isConnected&&root.style.display!=='none'&&root.style.visibility!=='hidden',hiddenReason,version};},
    update:payload=>{place();data=payload;paint();},
    destroy:()=>{clearInterval(timer);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);root.remove();delete window.__codexComposerMeter;}
  };
  place();paint();
})();
