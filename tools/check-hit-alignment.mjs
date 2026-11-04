// Isolated Playwright check; uses preview data, never the real client.
export default async function checkHitAlignment(page, {html, renderer}) {
  await page.route('http://align.test/**', route => route.fulfill({contentType:'text/html',body:html.replace('<script src="/renderer.js"></script>',`<script>${renderer}</script>`)}));
  const results=[];
  try {
    await page.setViewportSize({width:1280,height:800});
    await page.goto('http://align.test');
    await page.getByRole('button',{name:'2.35M tok'}).waitFor();
    for(const name of ['total','context']) {
      const button=page.locator(`button.${name}`);
      const rect=await button.boundingBox(),text=await button.locator('strong').boundingBox();
      if(Math.abs(rect.y+rect.height/2-text.y-text.height/2)>0.1)throw Error(`${name}: text not centered`);
      for(const y of [2,rect.height/2,rect.height-2]) {
        await page.mouse.click(rect.x+rect.width/2,rect.y+y);
        if(await button.getAttribute('aria-expanded')!=='true')throw Error(`${name}: click missed`);
        await page.keyboard.press('Escape');
      }
      results.push({button:name,centered:true,topMiddleBottomClicks:true});
    }
    return results;
  } finally { await page.unroute('http://align.test/**'); }
}
