import json, os, time, re
import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

URLS = [
    "https://s.shopee.co.th/2LVCeqiBMq",
    "https://s.shopee.co.th/5q54pIJ2gf",
    "https://s.shopee.co.th/4LGH2Ye1TW",
    "https://s.shopee.co.th/3LNjqlBkd4",
]

CHROMEDRIVER_PATH = r"C:\Users\MissT\shopee-affiliate\chromedriver.exe"

def get_driver():
    opts = uc.ChromeOptions()
    opts.add_argument("--window-size=1280,900")
    opts.add_argument("--lang=th-TH")
    driver = uc.Chrome(driver_executable_path=CHROMEDRIVER_PATH, options=opts, version_main=148)
    return driver

def extract_product(driver, short_url):
    driver.get(short_url)
    time.sleep(5)

    final_url = driver.current_url
    print(f"  Redirected to: {final_url[:80]}")

    # Extract item/shop ID from URL
    match = re.search(r'/product/(\d+)/(\d+)', final_url)
    if not match:
        match = re.search(r'itemid=(\d+).*shopid=(\d+)', final_url)
        if match:
            shop_id, item_id = match.group(2), match.group(1)
        else:
            print("  Could not extract IDs from URL")
            return None
    else:
        shop_id = match.group(1)
        item_id = match.group(2)

    print(f"  shop_id={shop_id}, item_id={item_id}")

    # Wait for product title
    try:
        WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "h1, [class*='product-name'], [class*='_44qnta']"))
        )
    except:
        print("  Timeout waiting for page")

    time.sleep(3)

    # Use JavaScript to extract all data
    data = driver.execute_script("""
        function getText(selectors) {
            for (let sel of selectors) {
                let el = document.querySelector(sel);
                if (el && el.innerText.trim()) return el.innerText.trim();
            }
            return null;
        }
        function getAll(selectors) {
            for (let sel of selectors) {
                let els = document.querySelectorAll(sel);
                if (els.length > 0) return Array.from(els).map(e => e.innerText.trim()).filter(Boolean);
            }
            return [];
        }

        const title = getText([
            'h1',
            '[class*="product-name"]',
            '[class*="_44qnta"]',
            '.pdp-product-title'
        ]);

        // Price selectors
        const priceEl = document.querySelector('[class*="priceSale"], [class*="price-sale"], [class*="_3n5NQx"], .pdp-price_type_normal');
        const price = priceEl ? priceEl.innerText.replace(/[^0-9,.]/g, '').trim() : null;

        const origPriceEl = document.querySelector('[class*="priceOriginal"], [class*="price-original"], [class*="_2Shl1j"], .pdp-price_type_deleted');
        const original_price = origPriceEl ? origPriceEl.innerText.replace(/[^0-9,.]/g, '').trim() : null;

        const discountEl = document.querySelector('[class*="discount"], [class*="Discount"]');
        const discount = discountEl ? discountEl.innerText.trim() : null;

        // Rating
        const ratingEl = document.querySelector('[class*="rating"] span, [class*="shopee-rating"]');
        const rating = ratingEl ? ratingEl.innerText.trim() : null;

        // Review count & sold
        const reviewEl = document.querySelector('[class*="review-count"], [class*="reviewCount"]');
        const review_count = reviewEl ? reviewEl.innerText.trim() : null;

        const soldEl = document.querySelector('[class*="sold"], [class*="Sold"]');
        const sold = soldEl ? soldEl.innerText.trim() : null;

        // Shop name
        const shopEl = document.querySelector('[class*="shop-name"], [class*="shopName"], .seller-name__text');
        const shop_name = shopEl ? shopEl.innerText.trim() : null;

        // Description
        const descEl = document.querySelector('[class*="product-description"], [class*="description"], .pdp-product-desc');
        const description = descEl ? descEl.innerText.trim().substring(0, 1000) : null;

        // Images
        const imgEls = document.querySelectorAll('img[src*="shopee"], [class*="image"] img, [class*="photo"] img');
        const images = Array.from(imgEls)
            .map(img => img.src || img.getAttribute('src'))
            .filter(src => src && src.includes('shopee') && !src.includes('icon') && !src.includes('avatar'))
            .slice(0, 5);

        // Reviews
        const reviewEls = document.querySelectorAll('[class*="shopee-product-comment"], [class*="comment-list"] [class*="comment-item"]');
        const reviews = Array.from(reviewEls).slice(0, 3).map(el => el.innerText.trim().substring(0, 200));

        return { title, price, original_price, discount, rating, review_count, sold, shop_name, description, images, reviews };
    """)

    return {
        "shop_id": shop_id,
        "item_id": item_id,
        "affiliate_short_link": short_url,
        "product_url": final_url,
        **data
    }

def main():
    driver = get_driver()
    try:
        for i, url in enumerate(URLS, 1):
            print(f"\n[{i}/4] Processing: {url}")
            try:
                product = extract_product(driver, url)
                if not product:
                    continue

                item_id = product.get("item_id", f"product_{i}")
                out_dir = os.path.join("products", item_id)
                os.makedirs(out_dir, exist_ok=True)
                os.makedirs(os.path.join(out_dir, "images"), exist_ok=True)
                os.makedirs(os.path.join(out_dir, "content"), exist_ok=True)

                out_path = os.path.join(out_dir, "data.json")
                with open(out_path, "w", encoding="utf-8") as f:
                    json.dump(product, f, ensure_ascii=False, indent=2)

                print(f"  ✓ Saved: {out_path}")
                print(f"  Title: {str(product.get('title',''))[:60]}")
                print(f"  Price: {product.get('price')} | Original: {product.get('original_price')}")
                print(f"  Rating: {product.get('rating')} | Shop: {product.get('shop_name')}")

            except Exception as e:
                print(f"  ERROR: {e}")
                import traceback; traceback.print_exc()

            time.sleep(2)
    finally:
        driver.quit()
    print("\nDone!")

if __name__ == "__main__":
    main()
