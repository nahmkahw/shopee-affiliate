import os, sqlite3, shutil, tempfile

base = r'C:\Users\MissT\AppData\Local\Google\Chrome\User Data'
profiles = ['Default'] + [f'Profile {i}' for i in range(1, 50)]

for prof in profiles:
    cookie_path = os.path.join(base, prof, 'Network', 'Cookies')
    if not os.path.exists(cookie_path):
        continue
    try:
        tmp = tempfile.mktemp(suffix='.db')
        shutil.copy2(cookie_path, tmp)
        conn = sqlite3.connect(tmp)
        c = conn.cursor()
        c.execute("SELECT COUNT(*) FROM cookies WHERE host_key LIKE '%shopee%'")
        count = c.fetchone()[0]
        conn.close()
        os.unlink(tmp)
        if count > 0:
            print(f'{prof}: {count} Shopee cookies')
    except Exception as e:
        print(f'{prof}: error - {e}')
