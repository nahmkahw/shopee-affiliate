import os, sqlite3, shutil, tempfile, json, requests, sys
import base64, struct

PROFILE = r'C:\Users\MissT\AppData\Local\Google\Chrome\User Data\Profile 16'
LOCAL_STATE = r'C:\Users\MissT\AppData\Local\Google\Chrome\User Data\Local State'

def get_encryption_key():
    with open(LOCAL_STATE, 'r', encoding='utf-8') as f:
        local_state = json.load(f)
    encrypted_key = base64.b64decode(local_state['os_crypt']['encrypted_key'])
    encrypted_key = encrypted_key[5:]  # remove 'DPAPI' prefix
    import win32crypt
    key = win32crypt.CryptUnprotectData(encrypted_key, None, None, None, 0)[1]
    return key

def decrypt_cookie(key, encrypted_value):
    try:
        from Crypto.Cipher import AES
        # Chrome v80+ uses AES-256-GCM
        # Format: b'v10' + nonce(12) + ciphertext + tag(16)
        if encrypted_value[:3] == b'v10' or encrypted_value[:3] == b'v11':
            nonce = encrypted_value[3:15]
            ciphertext = encrypted_value[15:]
            cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
            try:
                return cipher.decrypt_and_verify(ciphertext[:-16], ciphertext[-16:]).decode('utf-8')
            except:
                return cipher.decrypt(ciphertext[:-16]).decode('utf-8', errors='ignore')
        else:
            import win32crypt
            return win32crypt.CryptUnprotectData(encrypted_value, None, None, None, 0)[1].decode('utf-8')
    except Exception as e:
        return ''

def get_shopee_cookies():
    key = get_encryption_key()
    cookie_db = os.path.join(PROFILE, 'Network', 'Cookies')
    tmp = tempfile.mktemp(suffix='.db')
    shutil.copy2(cookie_db, tmp)

    conn = sqlite3.connect(tmp)
    c = conn.cursor()
    c.execute("SELECT name, value, encrypted_value, host_key FROM cookies WHERE host_key LIKE '%shopee%'")
    rows = c.fetchall()
    conn.close()
    os.unlink(tmp)

    cookies = {}
    for name, value, enc_val, host in rows:
        if value:
            cookies[name] = value
        elif enc_val:
            decrypted = decrypt_cookie(key, enc_val)
            if decrypted:
                cookies[name] = decrypted
    return cookies

def main():
    print('Reading Shopee cookies from Profile 16...')
    try:
        cookies = get_shopee_cookies()
        print(f'Got {len(cookies)} cookies: {list(cookies.keys())[:10]}')
    except Exception as e:
        print(f'Error getting cookies: {e}')
        import traceback; traceback.print_exc()
        return

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        'Referer': 'https://shopee.co.th/',
        'Accept': 'application/json',
        'x-api-source': 'pc',
    }

    products = [
        ('3991346022',  '457973807',  'https://s.shopee.co.th/2LVCeqiBMq'),
        ('19283435771', '1057506471', 'https://s.shopee.co.th/5q54pIJ2gf'),
        ('24240277068', '1118936514', 'https://s.shopee.co.th/4LGH2Ye1TW'),
        ('28813756155', '4062349',    'https://s.shopee.co.th/3LNjqlBkd4'),
    ]

    for item_id, shop_id, short in products:
        print(f'\n--- Item {item_id} ---')
        url = f'https://shopee.co.th/api/v4/pdp/get_pc?item_id={item_id}&shop_id={shop_id}&tz_offset_in_minutes=420'
        try:
            r = requests.get(url, headers=headers, cookies=cookies, timeout=15)
            print(f'Status: {r.status_code}')
            if r.status_code == 200:
                d = r.json()
                if d.get('data'):
                    data = d['data']
                    print(f'Title: {data.get("name","")[:60]}')
                    print(f'Price: {data.get("price")} | Orig: {data.get("price_before_discount")}')
                    print(f'Rating: {data.get("item_rating",{}).get("rating_star")}')
                    print(f'Shop: {data.get("shop_name")}')
                    print(f'Images: {len(data.get("images",[]))}')

                    # Save
                    out = {
                        'item_id': item_id, 'shop_id': shop_id,
                        'affiliate_short_link': short,
                        'title': data.get('name'),
                        'price': f'฿{int(data["price"]/100000)}' if data.get('price') else None,
                        'original_price': f'฿{int(data["price_before_discount"]/100000)}' if data.get('price_before_discount') else None,
                        'discount': f'{data.get("discount")}%' if data.get('discount') else None,
                        'rating': str(round(data.get('item_rating',{}).get('rating_star',0),1)),
                        'review_count': sum(data.get('item_rating',{}).get('rating_count',[0])),
                        'sold': data.get('historical_sold') or data.get('sold'),
                        'shop_name': data.get('shop_name'),
                        'shop_id': data.get('shopid') or shop_id,
                        'description': (data.get('description') or '')[:1200],
                        'images': [f'https://down-th.img.susercontent.com/file/{img}' for img in data.get('images',[])[:6]],
                        'status': 'scraped'
                    }
                    os.makedirs(f'products/{item_id}/images', exist_ok=True)
                    os.makedirs(f'products/{item_id}/content', exist_ok=True)
                    with open(f'products/{item_id}/data.json', 'w', encoding='utf-8') as f:
                        json.dump(out, f, ensure_ascii=False, indent=2)
                    print(f'✓ Saved products/{item_id}/data.json')
                else:
                    print(f'Error in response: {d.get("error")} | {r.text[:100]}')
            else:
                print(r.text[:150])
        except Exception as e:
            print(f'Request error: {e}')

    # Also get ratings
    print('\n--- Getting reviews ---')
    for item_id, shop_id, _ in products:
        url = f'https://shopee.co.th/api/v4/item/get_ratings?itemid={item_id}&shopid={shop_id}&limit=3&offset=0&type=0'
        try:
            r = requests.get(url, headers=headers, cookies=cookies, timeout=10)
            if r.status_code == 200:
                d = r.json()
                ratings = d.get('data',{}).get('ratings',[])
                reviews = [{'rating': rv.get('rating_star'), 'comment': rv.get('comment','')[:200], 'author': rv.get('author_username','')} for rv in ratings[:3]]

                data_path = f'products/{item_id}/data.json'
                if os.path.exists(data_path):
                    with open(data_path, encoding='utf-8') as f:
                        saved = json.load(f)
                    saved['reviews'] = reviews
                    with open(data_path, 'w', encoding='utf-8') as f:
                        json.dump(saved, f, ensure_ascii=False, indent=2)
                    print(f'  {item_id}: {len(reviews)} reviews added')
        except Exception as e:
            print(f'  {item_id} reviews error: {e}')

    print('\nDone!')

if __name__ == '__main__':
    main()
