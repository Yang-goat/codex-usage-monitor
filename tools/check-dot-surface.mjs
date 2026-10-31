// Run in an isolated Playwright page with preview.html and renderer sources.
// previousRenderer is optional and reproduces the pre-fix Dot behavior.
export default async function checkDotSurface(page,{html,renderer,previousRenderer,mainPreviousRenderer}) {
  const checks=[];
  const errors=[];
  const onError=error=>errors.push(error.message);
  page.on('pageerror',onError);
  const expect=(condition,message)=>{if(!condition)throw new Error(message);checks.push(message);};
  let activeRenderer=renderer;
  await page.route('http://meter.test/**',route=>route.fulfill({
    contentType:'text/html; charset=utf-8',
    body:html.replace('<script src="/renderer.js"></script>',`<script>${activeRenderer}</script>`)
      .replace('setTimeout(()=>window.__codexComposerMeter.update(previewSample),100);',
        'window.__codexComposerMeter.update(previewSample);')
  }));
  const state=()=>page.evaluate(()=>window.__codexComposerMeter.state());
  try {
    await page.setViewportSize({width:1200,height:900});
    await page.goto('http://meter.test/index.html');
    expect((await state()).visible,'Codex composer remains visible');
    await page.evaluate(()=>setPreviewMode('work'));
    expect((await state()).visible,'Work composer remains visible');
    await page.evaluate(()=>setPreviewMode('chat'));
    expect(!(await state()).visible,'Plain ChatGPT chat remains hidden');
    await page.evaluate(()=>setPreviewMode('dot'));
    expect(!(await state()).visible,'Dot preview switch hides the bar');
    await page.evaluate(()=>setPreviewMode('codex'));

    const showMainDot=()=>page.evaluate(()=>{
      const composer=document.querySelector('.composer');
      const messaging=document.createElement('div');messaging.className='messaging-root messaging-embedded';
      const container=document.createElement('div');container.dataset.role='composer';
      composer.before(messaging);messaging.append(container);container.append(composer);
    });
    if(mainPreviousRenderer){
      activeRenderer=mainPreviousRenderer;
      await page.goto('http://meter.test/index.html');
      await showMainDot();
      expect((await state()).visible,'Previous renderer reproduces the main-window Dot bug');
      await page.evaluate(source=>(0,eval)(source),renderer);
      const upgraded=await state();
      expect(!upgraded.visible&&upgraded.threadId===null,'Hot upgrade hides main-window Dot and clears its thread binding');
    }
    activeRenderer=renderer;
    await page.goto('http://meter.test/index.html');
    await showMainDot();
    let dot=await state();
    expect(!dot.visible&&dot.threadId===null,'Main-window Dot stays hidden at the normal index URL');
    await page.evaluate(()=>document.querySelector('.messaging-root').className='');
    expect(!(await state()).visible,'Dot composer role alone excludes the shared agent root');
    await page.evaluate(()=>{
      document.querySelector('[data-role="composer"]').removeAttribute('data-role');
      document.querySelector('.composer').parentElement.parentElement.className='messaging-root';
    });
    expect(!(await state()).visible,'Dot messaging container alone excludes the shared agent root');
    await page.evaluate(()=>document.body.append(document.querySelector('.composer')));
    expect((await state()).visible,'Returning from Dot to a normal composer restores the bar');

    if(previousRenderer){
      activeRenderer=previousRenderer;
      await page.goto('http://meter.test/index.html?initialRoute=%2Fspotlight');
      expect((await state()).visible,'Old renderer reproduces the Dot bug');
      await page.evaluate(()=>{
        window.previousMeterRoot=document.getElementById('codex-composer-meter');
        previousMeterRoot.shadowRoot.querySelector('button.total').click();
      });
      await page.evaluate(source=>(0,eval)(source),renderer);
      const upgraded=await state();
      expect(!upgraded.visible&&!upgraded.mounted&&upgraded.hiddenReason==='dot-surface',
        'Hot upgrade removes the existing Dot bar and open panel');
      expect(await page.evaluate(()=>!previousMeterRoot.isConnected),
        'Old renderer root is disconnected after upgrade');
    }

    activeRenderer=renderer;
    for(const url of ['http://meter.test/index.html?initialRoute=%2Fspotlight','http://meter.test/spotlight']){
      await page.goto(url);
      await page.evaluate(()=>window.__codexComposerMeter.update(previewSample));
      const s=await state();
      expect(!s.visible&&!s.mounted&&s.threadId===null&&s.scope===null&&s.hiddenReason==='dot-surface',
        `Dot stays hidden with an agent composer and thread ID: ${new URL(url).pathname}${new URL(url).search}`);
    }

    await page.goto('http://meter.test/index.html');
    await page.evaluate(()=>{
      document.querySelector('.composer [data-above-composer-conversation-id]').remove();
      window.__codexComposerMeter.state();
    });
    const fresh=await state();
    expect(fresh.visible&&fresh.threadId===null,'New desktop chat without an ID remains supported');
    await page.evaluate(source=>(0,eval)(source),renderer);
    expect(await page.locator('#codex-composer-meter').count()===1,'Repeated injection creates only one bar');
    expect(errors.length===0,`No renderer errors (${errors.length})`);
    return {passed:checks.length,checks};
  } finally {
    await page.evaluate(()=>window.__codexComposerMeter?.destroy()).catch(()=>{});
    await page.unroute('http://meter.test/**');
    page.off('pageerror',onError);
  }
}
