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

  await page.goto('https://shopee.co.th/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.goto('https://s.shopee.co.th/2LVCeqiBMq', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);

  const result = await page.evaluate(() => {
    // Try all common global data stores
    const sources = {
      __NEXT_DATA__: window.__NEXT_DATA__,
      __INITIAL_STATE__: window.__INITIAL_STATE__,
      __redux_state__: window.__redux_state__,
    };

    // Also try script tags with JSON
    const scripts = [...document.querySelectorAll('script')];
    const pdpScript = scripts.find(s => s.text && s.text.includes('"name"') && s.text.includes('"price"') && s.text.includes('"images"'));
    if (pdpScript) sources.pdpScript = pdpScript.text.substring(0, 500);

    // Try window keys that contain product data
    const windowKeys = Object.keys(window).filter(k =>
      typeof window[k] === 'object' && window[k] !== null &&
      (window[k].name || window[k].item_id || window[k].price)
    ).slice(0, 10);
    sources.relevantWindowKeys = windowKeys;

    return sources;
  });

  fs.writeFileSync('debug_window.json', JSON.stringify(result, null, 2), 'utf8');
  console.log('Keys found:', Object.keys(result));
  console.log('__NEXT_DATA__ exists:', !!result.__NEXT_DATA__);
  if (result.__NEXT_DATA__) {
    console.log('NEXT_DATA keys:', Object.keys(result.__NEXT_DATA__));
  }
  console.log('window keys with data:', result.relevantWindowKeys);
  console.log('Current URL:', page.url().substring(0, 80));

  await browser.close();
})();
