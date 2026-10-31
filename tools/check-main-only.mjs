// Isolated Playwright fixture. No real client or conversation data is used.
export default async function checkMainOnly(page,{html,renderer,previousRenderer}) {
  const checks=[],errors=[];
  const onError=e=>errors.push(e.message);
  const expect=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const mainId='00000000-0000-0000-0000-000000000001';
  const sideId='00000000-0000-0000-0000-000000000002';
  let source=previousRenderer??renderer;
  page.on('pageerror',onError);
  await page.route('http://meter.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',
    body:html.replace('<script src="/renderer.js"></script>',`<script>${source}</script>`)
      .replace('setTimeout(()=>window.__codexComposerMeter.update(previewSample),100);','window.__codexComposerMeter.update(previewSample);')
  }));
  const state=()=>page.evaluate(()=>window.__codexComposerMeter.state());
  try {
    await page.setViewportSize({width:1700,height:1000});
    await page.goto('http://meter.test/index.html');
    await page.evaluate(sideId=>{
      const main=document.querySelector('.composer');
      const panel=document.createElement('div');panel.dataset.appShellFocusArea='main';main.before(panel);panel.append(main);
      main.style.left='20px';main.style.transform='none';main.style.width='740px';
      const right=document.createElement('div');right.dataset.appShellFocusArea='right-panel';
      const tab=document.createElement('div');tab.dataset.tabId=`sidechat:${sideId}`;right.append(tab);document.body.append(right);
      const side=main.cloneNode(true);side.classList.add('side-composer');side.style.left='900px';tab.append(side);
      side.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',sideId);
      side.querySelector('[contenteditable]').focus();
    },sideId);
    if(previousRenderer){
      expect((await state()).threadId===sideId,'Previous renderer follows the focused side chat');
      await page.evaluate(code=>(0,eval)(code),renderer);
    }
    expect((await state()).threadId===mainId,'New renderer stays bound to the main thread while side chat is focused');
    await page.evaluate(()=>window.__codexComposerMeter.update(previewSample));
    expect(await page.evaluate(()=>document.getElementById('codex-composer-meter').shadowRoot.querySelector('[data-k=total]').textContent)==='2.35M',
      'Token total comes from the main thread');
    expect(await page.evaluate(()=>{
      const r=document.getElementById('codex-composer-meter').getBoundingClientRect();
      const main=document.querySelector('[data-app-shell-focus-area=main] .composer').getBoundingClientRect();
      return r.left>=main.left&&r.right<=main.right;
    }),'Bar stays within the main composer');
    await page.evaluate(()=>document.querySelector('[data-app-shell-focus-area=main] [contenteditable]').focus());
    expect((await state()).threadId===mainId,'Focusing the main editor keeps the same binding');
    await page.evaluate(()=>document.querySelector('.side-composer [contenteditable]').focus());
    expect((await state()).threadId===mainId,'Refocusing the side editor does not move the bar');
    await page.evaluate(()=>document.querySelector('[data-app-shell-focus-area=main] .composer').style.display='none');
    const hidden=await state();
    expect(!hidden.visible&&hidden.threadId===null,'Side chat alone never receives the bar');
    await page.evaluate(()=>document.querySelector('[data-tab-id]').removeAttribute('data-tab-id'));
    expect(!(await state()).visible,'Right-panel marker alone excludes the side composer');
    await page.evaluate(sideId=>{
      const right=document.querySelector('[data-app-shell-focus-area=right-panel]');
      right.removeAttribute('data-app-shell-focus-area');right.firstElementChild.dataset.tabId=`sidechat:${sideId}`;
    },sideId);
    expect(!(await state()).visible,'Sidechat tab marker alone excludes the side composer');
    await page.evaluate(()=>{
      const main=document.querySelector('[data-app-shell-focus-area=main] .composer');main.style.display='';
      main.querySelector('[data-above-composer-conversation-id]').remove();
    });
    const fresh=await state();
    expect(fresh.visible&&fresh.threadId===null,'New main chat does not borrow the side thread ID');
    expect(errors.length===0,'No renderer errors');
    return {passed:checks.length,checks};
  } finally {
    await page.evaluate(()=>window.__codexComposerMeter?.destroy()).catch(()=>{});
    await page.unroute('http://meter.test/**');page.off('pageerror',onError);
  }
}
