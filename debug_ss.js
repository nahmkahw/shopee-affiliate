const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--window-size=1280,900']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    locale: 'th-TH',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  await page.goto('https://shopee.co.th/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  await page.goto('https://shopee.co.th/product/457973807/3991346022', { waitUntil: 'domcontentloaded' });

  try {
    await page.waitForFunction(
      () => document.title.includes('หนังสือ') || document.querySelector('h1')?.innerText?.length > 5,
      { timeout: 20000 }
    );
    console.log('Page loaded!');
  } catch(e) {
    console.log('Timeout waiting for content');
  }

  await page.waitForTimeout(3000);

  // Take screenshot
  await page.screenshot({ path: 'debug_screenshot.png', fullPage: false });
  console.log('Screenshot saved: debug_screenshot.png');

  // Check DOM state
  const info = await page.evaluate(() => ({
    title: document.title,
    h1: document.querySelector('h1')?.innerText?.trim(),
    url: window.location.href,
    bodyText: document.body?.innerText?.substring(0, 300),
    iframes: document.querySelectorAll('iframe').length,
    scripts: document.querySelectorAll('script').length,
  }));

  console.log('title:', info.title);
  console.log('h1:', info.h1);
  console.log('url:', info.url.substring(0, 80));
  console.log('iframes:', info.iframes);
  console.log('body text preview:', info.bodyText?.substring(0, 150));

  await browser.close();
})();
