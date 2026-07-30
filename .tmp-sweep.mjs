import { chromium } from 'playwright'
const VP={'desktop-wide':[1440,900],'laptop-half':[720,900],'tablet-landscape':[1180,820],'tablet-portrait':[820,1180],'short':[1521,784]}
const S=['b1-bidding','b1-cardplay','b1-review','b1-review-bidding-only','b2-bidding','b2-cardplay','b2-review','b3-bidding','b3-cardplay','b3-review','c1-overview','c1-drilldown']
const b=await chromium.launch(); let bad=0
for (const arr of ['grid','beta']) {
  console.log('\n### channel: %s', arr)
  for (const s of S) {
    const notes=[]
    for (const [vn,[w,h]] of Object.entries(VP)) {
      const p=await b.newPage({viewport:{width:w,height:h}}); const errs=[]
      p.on('pageerror',e=>errs.push(e.message))
      await p.goto(`http://localhost:4207/${arr==='beta'?'?arrangement=beta':''}#/harness/scene/${s}`,{waitUntil:'networkidle'})
      await p.waitForTimeout(600)
      if (await p.locator('.scene-miss').count()) notes.push(vn+':MISSING')
      if (errs.length) notes.push(vn+':ERR')
      await p.close()
    }
    if (notes.length){bad++;console.log('  %s %s',s.padEnd(24),notes.join(' '))}
  }
}
console.log(bad?`\n${bad} problems`:'\nall scenes render on both channels')
await b.close()
