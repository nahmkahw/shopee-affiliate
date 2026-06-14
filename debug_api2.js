const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    locale: 'th-TH',
  });
  const page = await context.newPage();

  let pdpData = null;
  let ratingsData = null;

  page.on('response', async (response) => {
    const url = response.url();
    try {
      if (url.includes('/api/v4/pdp/get_pc') && url.includes('item_id=3991346022')) {
        const json = await response.json();
        pdpData = json;
        fs.writeFileSync('debug_pdp.json', JSON.stringify(json, null, 2), 'utf8');
        console.log('Captured pdp/get_pc');
      }
      if (url.includes('get_ratings') && url.includes('3991346022')) {
        const json = await response.json();
        ratingsData = json;
        fs.writeFileSync('debug_ratings.json', JSON.stringify(json, null, 2), 'utf8');
        console.log('Captured ratings');
      }
    } catch(_) {}
  });

  await page.goto('https://shopee.co.th/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.goto('https://s.shopee.co.th/2LVCeqiBMq', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000);

  console.log('pdpData captured:', !!pdpData);
  if (pdpData?.data) {
    const d = pdpData.data;
    const keys = Object.keys(d);
    console.log('Top-level keys:', keys.slice(0, 30).join(', '));
    if (d.price) console.log('price:', d.price);
    if (d.name) console.log('name:', d.name);
    if (d.item_rating) console.log('rating:', JSON.stringify(d.item_rating).substring(0, 100));
  }

  await browser.close();
})();
