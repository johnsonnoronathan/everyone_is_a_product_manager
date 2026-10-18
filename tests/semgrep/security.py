import subprocess, requests

def view(cursor, q, Product):
    # ruleid: sql-built-from-strings-python
    cursor.execute(f"SELECT * FROM products WHERE name = '{q}'")
    # ruleid: sql-built-from-strings-python
    cursor.execute("SELECT * FROM products WHERE id = %s" % q)
    # ok: sql-built-from-strings-python
    cursor.execute("SELECT * FROM products WHERE id = %s", (q,))
    # ruleid: shell-true-python
    subprocess.run("ls " + q, shell=True)
    # ruleid: python-debug-or-tls-off
    requests.get("https://example.com", verify=False, timeout=5)

# ruleid: python-debug-or-tls-off
DEBUG = True
