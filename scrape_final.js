const { chromium } = require('playwright');
const fs = require('fs');

const PRODUCTS = [
  { url: 'https://shopee.co.th/product/457973807/3991346022',  item_id: '3991346022',  shop_id: '457973807',  short: 'https://s.shopee.co.th/2LVCeqiBMq' },
  { url: 'https://shopee.co.th/product/1057506471/19283435771', item_id: '19283435771', shop_id: '1057506471', short: 'https://s.shopee.co.th/5q54pIJ2gf' },
  { url: 'https://shopee.co.th/product/1118936514/24240277068', item_id: '24240277068', shop_id: '1118936514', short: 'https://s.shopee.co.th/4LGH2Ye1TW' },
  { url: 'https://shopee.co.th/product/4062349/28813756155',   item_id: '28813756155', shop_id: '4062349',    short: 'https://s.shopee.co.th/3LNjqlBkd4' },
];

function extractJS() {
  const all = [...document.querySelectorAll('*')];
  const title = (document.querySelector('h1') || {}).innerText || null;
  if (title) title.trim();

  // Price: handles both "฿390" and "฿390 - ฿1,164"
  const priceEls = all
    .filter(function(e) {
      if (e.children.length > 0) return false;
      if (['SCRIPT','STYLE','NOSCRIPT'].includes(e.tagName)) return false;
      var t = (e.innerText || '').trim();
      return /^฿[\d,]+(\s*-\s*฿[\d,]+)?$/.test(t);
    })
    .map(function(e) {
      var cs = window.getComputedStyle(e);
      var txt = (e.innerText || '').trim();
      var match = txt.match(/฿([\d,]+)/);
      var num = match ? parseInt(match[1].replace(/,/g, '')) : 0;
      return {
        txt: txt,
        num: num,
        size: parseFloat(cs.fontSize) || 0,
        strike: (cs.textDecoration || '').indexOf('line-through') >= 0,
      };
    })
    .filter(function(p) { return p.size >= 12 && p.num > 0; });

  priceEls.sort(function(a, b) { return b.size - a.size; });

  var priceEl = priceEls.filter(function(p) { return !p.strike; })[0];
  var origEl  = priceEls.filter(function(p) { return p.strike; })[0];
  var price = priceEl ? ('฿' + priceEl.num.toLocaleString()) : null;
  var original_price = origEl ? ('฿' + origEl.num.toLocaleString()) : null;

  // Discount
  var discEl = all.filter(function(e) {
    if (e.children.length > 0) return false;
    var t = (e.innerText || '').trim();
    return /^-?\d{1,2}%/.test(t) && t.length < 15;
  })[0];
  var discount = discEl ? discEl.innerText.trim() : null;
  if (!discount && price && original_price) {
    var c = parseInt(price.replace(/[฿,]/g, ''));
    var o = parseInt(original_price.replace(/[฿,]/g, ''));
    if (o > c) discount = Math.round((1 - c / o) * 100) + '%';
  }

  // Rating
  var ratingEl = all.filter(function(e) {
    return e.children.length === 0 && /^\d\.\d$/.test((e.innerText || '').trim());
  })[0];
  var rating = ratingEl ? ratingEl.innerText.trim() : null;

  // Review count
  var rvEl = all.filter(function(e) {
    if (e.children.length > 0 || e.tagName === 'SCRIPT') return false;
    var t = (e.innerText || '').trim();
    return /[\d,.k]+\s*(รีวิว|Ratings?)/.test(t) && t.length < 40;
  })[0];
  var review_count = rvEl ? rvEl.innerText.trim() : null;

  // Sold
  var soldEl = all.filter(function(e) {
    if (e.children.length > 0 || e.tagName === 'SCRIPT') return false;
    var t = (e.innerText || '').trim();
    return /(ขายแล้ว|Sold)/.test(t) && t.length < 60 && /[\d,.k]/.test(t);
  })[0];
  var sold = soldEl ? soldEl.innerText.trim() : null;

  // Shop name — exclude nav bar (top 100px)
  var shopLinks = [...document.querySelectorAll('a[href*="/shop/"]')].filter(function(a) {
    var txt = (a.innerText || '').trim();
    var rect = a.getBoundingClientRect();
    return txt.length > 1 && txt.length < 60 && txt.indexOf('฿') < 0 && !/^\d+$/.test(txt) && rect.top > 100;
  });
  var shop_name = shopLinks[0] ? shopLinks[0].innerText.trim() : null;

  // Description — longest clean text block
  var descCands = all.filter(function(e) {
    if (e.tagName === 'SCRIPT' || e.tagName === 'STYLE' || e.children.length > 0) return false;
    var t = e.innerText || '';
    return t.length > 150 && t.indexOf('window.__') < 0 && t.indexOf('function(') < 0 && !/^[{\["']/.test(t.trim());
  });
  descCands.sort(function(a, b) { return (b.innerText || '').length - (a.innerText || '').length; });
  var description = descCands[0] ? descCands[0].innerText.trim().slice(0, 1200) : null;

  // Images
  var images = [...document.querySelectorAll('img')]
    .map(function(e) { return e.src || (e.dataset || {}).src || ''; })
    .filter(function(s) {
      return s && s.indexOf('http') === 0 &&
        (s.indexOf('isekai.sea.com') >= 0 || s.indexOf('down-th') >= 0 || s.indexOf('susercontent') >= 0 || s.indexOf('cf.shopee') >= 0);
    })
    .filter(function(v, i, a) { return a.indexOf(v) === i; })
    .filter(function(s) { return s.indexOf('icon') < 0 && s.indexOf('avatar') < 0 && s.indexOf('logo') < 0; })
    .slice(0, 6);

  // Reviews
  var reviews = [];
  var selectors = ['[class*="shopee-product-comment"] [class*="content"]', '[class*="review"] p', '[class*="comment"] [class*="text"]'];
  for (var si = 0; si < selectors.length; si++) {
    var els = [...document.querySelectorAll(selectors[si])].filter(function(e) { return (e.innerText || '').trim().length > 10; });
    if (els.length > 0) {
      reviews = els.slice(0, 3).map(function(e) { return e.innerText.trim().slice(0, 250); });
      break;
    }
  }

  return { title: (title || '').trim(), price, original_price, discount, rating, review_count, sold, shop_name, description, images, reviews };
}

(async function() {
  console.log('Connecting to Chrome...');
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const [ctx] = browser.contexts();
  const page = ctx.pages()[0];

  for (var i = 0; i < PRODUCTS.length; i++) {
    const p = PRODUCTS[i];
    console.log('\n[' + (i+1) + '/4] ' + p.item_id);
    try {
      await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(function() {
        var h1 = document.querySelector('h1');
        return h1 && h1.innerText.trim().length > 5;
      }, { timeout: 15000 }).catch(function() {});
      await page.waitForTimeout(3000);
      await page.evaluate(function() { window.scrollBy(0, 700); });
      await page.waitForTimeout(1500);
      await page.evaluate(function() { window.scrollBy(0, 700); });
      await page.waitForTimeout(1000);
      await page.evaluate(function() { window.scrollTo(0, 0); });
      await page.waitForTimeout(500);

      const data = await page.evaluate(extractJS);

      const result = Object.assign({ item_id: p.item_id, shop_id: p.shop_id, affiliate_short_link: p.short, product_url: p.url }, data, { status: data.title ? 'scraped' : 'partial' });

      fs.mkdirSync('products/' + p.item_id + '/images', { recursive: true });
      fs.mkdirSync('products/' + p.item_id + '/content', { recursive: true });
      fs.writeFileSync('products/' + p.item_id + '/data.json', JSON.stringify(result, null, 2), 'utf8');

      console.log('  Title:   ' + String(data.title || '').substring(0, 55));
      console.log('  Price:   ' + data.price + ' | Orig: ' + data.original_price + ' | Disc: ' + data.discount);
      console.log('  Rating:  ' + data.rating + ' | Sold: ' + data.sold + ' | Reviews: ' + data.review_count);
      console.log('  Shop:    ' + data.shop_name);
      console.log('  Images:  ' + (data.images || []).length + ' | Reviews cap: ' + (data.reviews || []).length);
      console.log('  Saved!');
    } catch(e) {
      console.log('  ERROR: ' + e.message.split('\n')[0]);
    }
    if (i < PRODUCTS.length - 1) await page.waitForTimeout(2000);
  }

  await browser.close();
  console.log('\n✓ All done!');
})();
