const { chromium } = require('playwright');

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

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('shopee.co.th/api') || url.includes('shopee.co.th/graphql')) {
      const status = response.status();
      try {
        const body = await response.text();
        const preview = body.substring(0, 80).replace(/\n/g,' ');
        console.log(`[${status}] ${url.replace('https://shopee.co.th','').substring(0,80)}`);
        if (status === 200 && body.includes('"name"')) console.log(`  >> ${preview}`);
      } catch(_) {
        console.log(`[${status}] ${url.substring(0,80)}`);
      }
    }
  });

  await page.goto('https://shopee.co.th/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(2000);
  await page.goto('https://s.shopee.co.th/2LVCeqiBMq', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(10000);

  console.log('\nFinal URL:', page.url());
  await browser.close();
})();
