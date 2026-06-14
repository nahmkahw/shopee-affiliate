const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PRODUCTS = [
  { short: 'https://s.shopee.co.th/2LVCeqiBMq', item_id: '3991346022',  shop_id: '457973807'  },
  { short: 'https://s.shopee.co.th/5q54pIJ2gf', item_id: '19283435771', shop_id: '1057506471' },
  { short: 'https://s.shopee.co.th/4LGH2Ye1TW', item_id: '24240277068', shop_id: '1118936514' },
  { short: 'https://s.shopee.co.th/3LNjqlBkd4', item_id: '28813756155', shop_id: '4062349'    },
];

async function waitForProduct(page) {
  // Wait until either the product renders or we time out
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    const info = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      h1: document.querySelector('h1')?.innerText?.trim() || '',
      hasPrice: !!([...document.querySelectorAll('*')].find(e =>
        e.children.length === 0 && /^฿[\d,]+$/.test(e.innerText?.trim())
      )),
    }));
    if (info.h1.length > 5 || (info.hasPrice && !info.url.includes('verify'))) {
      console.log(`  Loaded after ${i+1}s: ${info.h1.substring(0,40)}`);
      return true;
    }
    if (info.url.includes('verify/traffic') || info.url.includes('login')) {
      console.log(`  Bot check page at ${i+1}s`);
      if (i === 10) return false; // give up after 10s on bot check
    }
  }
  return false;
}

async function extractData(page) {
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  return await page.evaluate(() => {
    const allEls = [...document.querySelectorAll('*')];

    // Title
    const title = document.querySelector('h1')?.innerText?.trim()
      || document.title.replace(' | Shopee Thailand', '').trim();

    // Prices — by font size
    const priceEls = allEls.filter(e => {
      if (e.children.length > 0 || ['SCRIPT','STYLE','NOSCRIPT'].includes(e.tagName)) return false;
      return /^฿\s?[\d,]+$/.test(e.innerText?.trim());
    }).map(e => {
      const s = window.getComputedStyle(e);
      return {
        txt: e.innerText.trim().replace(/\s/g,''),
        size: parseFloat(s.fontSize) || 0,
        strike: (s.textDecoration || '').includes('line-through'),
      };
    }).filter(p => p.size >= 12 && p.size <= 50);
    priceEls.sort((a,b) => b.size - a.size);

    const price = priceEls.find(p => !p.strike)?.txt || null;
    const original_price = priceEls.find(p => p.strike)?.txt || null;

    // Discount
    const discEl = allEls.find(e =>
      e.children.length === 0 && /^\d{1,2}%$/.test(e.innerText?.trim())
    );
    let discount = discEl?.innerText?.trim() || null;
    if (!discount && price && original_price) {
      const c = parseInt(price.replace(/[฿,]/g,''));
      const o = parseInt(original_price.replace(/[฿,]/g,''));
      if (o > c) discount = Math.round((1-c/o)*100)+'%';
    }

    // Rating
    const ratingEl = allEls.find(e =>
      e.children.length === 0 && /^\d\.\d$/.test(e.innerText?.trim())
    );
    const rating = ratingEl?.innerText?.trim() || null;

    // Review count
    const rvEl = allEls.find(e =>
      e.children.length === 0 &&
      /[\d,]+\s*(รีวิว|Ratings?|reviews?)/i.test(e.innerText?.trim()) &&
      e.innerText.length < 50
    );
    const review_count = rvEl?.innerText?.trim() || null;

    // Sold
    const soldEl = allEls.find(e =>
      e.children.length === 0 &&
      e.tagName !== 'SCRIPT' &&
      /(ขายแล้ว|Sold)/i.test(e.innerText?.trim()) &&
      e.innerText.length < 60 &&
      /[\d,k.]+/.test(e.innerText)
    );
    const sold = soldEl?.innerText?.trim() || null;

    // Shop name — look for link to shop page
    const shopLink = [...document.querySelectorAll('a')].find(a => {
      const href = a.href || '';
      const txt = a.innerText?.trim() || '';
      return (href.includes('/shop/') || href.includes('shopid=')) &&
        txt.length > 1 && txt.length < 60 &&
        !txt.includes('฿') && !/^\d+$/.test(txt);
    });
    let shop_name = shopLink?.innerText?.trim() || null;

    // Fallback shop: near "เยี่ยมชมร้าน" button
    if (!shop_name) {
      const visitBtn = allEls.find(e => /เยี่ยมชมร้าน|Visit Shop|ดูร้านค้า/i.test(e.innerText));
      if (visitBtn) {
        const siblings = [...(visitBtn.parentElement?.parentElement?.querySelectorAll('*') || [])];
        const nameEl = siblings.find(e =>
          e.children.length === 0 && e.innerText?.trim().length > 1 &&
          e.innerText?.trim().length < 60 && !e.innerText.includes('฿')
        );
        shop_name = nameEl?.innerText?.trim() || null;
      }
    }

    // Description — longest clean text block
    const descCandidates = allEls.filter(e =>
      e.tagName !== 'SCRIPT' && e.tagName !== 'STYLE' &&
      e.children.length === 0 &&
      (e.innerText?.length || 0) > 150 &&
      !(e.innerText || '').includes('window.__') &&
      !(e.innerText || '').includes('function(') &&
      !/^[{\["]/.test((e.innerText || '').trim())
    );
    descCandidates.sort((a,b) => (b.innerText?.length||0) - (a.innerText?.length||0));
    const description = descCandidates[0]?.innerText?.trim()?.slice(0,1200) || null;

    // Images
    const images = [...document.querySelectorAll('img')]
      .map(e => e.src || e.dataset?.src || '')
      .filter(s => s?.startsWith('http') && (
        s.includes('isekai.sea.com') || s.includes('down-th') ||
        s.includes('susercontent') || s.includes('cf.shopee')
      ))
      .filter((v,i,a) => a.indexOf(v) === i)
      .filter(s => !s.includes('icon') && !s.includes('avatar') && !s.includes('logo'))
      .slice(0, 6);

    // Reviews
    let reviews = [];
    const rvSelectors = [
      '[class*="shopee-product-comment"] [class*="content"]',
      '[class*="comment-list"] [class*="content"]',
      '[class*="review"] p',
    ];
    for (const sel of rvSelectors) {
      const els = [...document.querySelectorAll(sel)]
        .filter(e => (e.innerText?.trim().length||0) > 10);
      if (els.length > 0) {
        reviews = els.slice(0,3).map(e => e.innerText.trim().slice(0,250));
        break;
      }
    }

    return { title, price, original_price, discount, rating,
             review_count, sold, shop_name, description, images, reviews,
             _priceDebug: priceEls.slice(0,5) };
  });
}

(async () => {
  // Connect to existing Chrome via CDP
  console.log('Connecting to Chrome on port 9222...');
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  console.log('Connected!');

  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();
  let page = pages[0];

  // Navigate to homepage to establish session
  console.log('Loading Shopee homepage...');
  await page.goto('https://shopee.co.th/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  console.log('Homepage loaded. Title:', await page.title());

  for (let i = 0; i < PRODUCTS.length; i++) {
    const p = PRODUCTS[i];
    console.log(`\n[${i+1}/4] ${p.short}`);
    try {
      await page.goto(p.short, { waitUntil: 'networkidle', timeout: 40000 }).catch(() => {});
      // Extra wait for SPA render
      await page.waitForTimeout(5000);
      const loaded = await waitForProduct(page);

      const finalUrl = page.url();
      console.log(`  URL: ${finalUrl.substring(0,70)}`);

      if (!loaded || finalUrl.includes('verify/traffic')) {
        console.log('  ⚠ Could not load product page');
      }

      const { _priceDebug, ...data } = await extractData(page);
      console.log(`  Price elements: ${JSON.stringify(_priceDebug.map(x => x.txt + '(' + x.size + 'px' + (x.strike?',strike':'') + ')'))}`);

      const result = {
        item_id: p.item_id,
        shop_id: p.shop_id,
        affiliate_short_link: p.short,
        product_url: finalUrl,
        ...data,
        status: (data.title && !data.title.includes('Shopee Thailand')) ? 'scraped' : 'partial',
      };

      const dir = path.join('products', p.item_id);
      fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'content'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(result, null, 2), 'utf8');

      console.log(`  ✓ Title: ${String(data.title||'').substring(0,55)}`);
      console.log(`  Price: ${data.price} | Original: ${data.original_price} | Discount: ${data.discount}`);
      console.log(`  Rating: ${data.rating} | Sold: ${data.sold} | Reviews: ${data.review_count}`);
      console.log(`  Shop: ${data.shop_name}`);
      console.log(`  Images: ${data.images?.length||0} | Reviews: ${data.reviews?.length||0}`);

    } catch(e) {
      console.log(`  ERROR: ${e.message.split('\n')[0]}`);
    }

    if (i < PRODUCTS.length - 1) await page.waitForTimeout(3000);
  }

  await browser.close();
  console.log('\n✓ All done!');
})();
