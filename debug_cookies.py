import os, sqlite3, shutil, tempfile, json, base64

PROFILE = r'C:\Users\MissT\AppData\Local\Google\Chrome\User Data\Profile 16'
LOCAL_STATE = r'C:\Users\MissT\AppData\Local\Google\Chrome\User Data\Local State'

# Check key
with open(LOCAL_STATE, 'r', encoding='utf-8') as f:
    ls = json.load(f)
enc_key_b64 = ls.get('os_crypt', {}).get('encrypted_key', '')
print('Encrypted key present:', bool(enc_key_b64))

# Raw cookies (without decryption)
cookie_db = os.path.join(PROFILE, 'Network', 'Cookies')
tmp = tempfile.mktemp(suffix='.db')
shutil.copy2(cookie_db, tmp)
conn = sqlite3.connect(tmp)
c = conn.cursor()
c.execute("SELECT name, value, encrypted_value, host_key FROM cookies WHERE host_key LIKE '%shopee%' LIMIT 10")
rows = c.fetchall()
conn.close()
os.unlink(tmp)

print(f'\nFound {len(rows)} Shopee cookie rows:')
for name, value, enc_val, host in rows:
    print(f'  host={host} name={name} value_len={len(value)} enc_len={len(enc_val)} enc_prefix={enc_val[:3] if enc_val else "none"}')
