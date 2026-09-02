import urllib.request
import urllib.error
import threading
import time

URL = "http://localhost:3005/zip?tags=maxime"

def spam_request(thread_id):
    try:
        # Envoi d'une requête POST à notre serveur
        req = urllib.request.Request(URL, method="POST")
        response = urllib.request.urlopen(req)
        print(f"[Requête {thread_id}] ✅ SUCCÈS (Code {response.status}) : Requête acceptée par le serveur.")
    except urllib.error.HTTPError as e:
        if e.code == 429:
            print(f"[Requête {thread_id}] 🛑 BLOQUÉ (Code 429) : Le Rate Limiter a fait son travail !")
        else:
            print(f"[Requête {thread_id}] ⚠️ ERREUR {e.code}")
    except Exception as e:
        print(f"[Requête {thread_id}] ❌ ÉCHEC : {e}")

print("=====================================================")
print(f"🚀 Lancement du Stress-Test sur {URL}")
print("=====================================================")

# On lance 40 requêtes de suite de manière asynchrone (threads)
threads = []
for i in range(40):
    t = threading.Thread(target=spam_request, args=(i+1,))
    threads.append(t)
    t.start()
    time.sleep(0.15) # 150ms pour laisser le temps à Redis de sauvegarder l'état (Évite la Race Condition)

for t in threads:
    t.join()

print("=====================================================")
print("🏁 Test de charge terminé !")
