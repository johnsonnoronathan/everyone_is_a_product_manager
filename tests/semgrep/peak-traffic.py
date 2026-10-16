import requests

def checkout(product, orders, Order, cursor):
    # ruleid: stock-lost-update-orm-python
    product.stock -= 1
    product.save()
    for o in orders:
        # ruleid: db-query-in-loop-python
        customer = Order.objects.get(pk=o.id)
    # ruleid: requests-without-timeout
    requests.post("https://payments.example/charge", json={})
    # ok: requests-without-timeout
    requests.post("https://payments.example/charge", json={}, timeout=(3, 10))
