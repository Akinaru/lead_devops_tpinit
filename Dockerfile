# On utilise une image de base très légère ("alpine") basée sur Node.js 20.
# Cela réduit considérablement la taille finale de l'image Docker, ce qui la rend plus rapide à télécharger et plus sécurisée.
FROM node:20-alpine

# On définit le dossier de travail à l'intérieur du conteneur.
# Toutes les commandes (COPY, RUN, CMD) s'exécuteront dans ce dossier.
WORKDIR /usr/src/app

# === OPTIMISATION DU CACHE DOCKER ===
# On copie uniquement les fichiers de dépendances en premier (package.json et package-lock.json).
# Docker utilise un système de cache par couche : si ces fichiers ne changent pas, 
# Docker ne relancera pas l'étape "npm ci" suivante et gagnera énormément de temps.
COPY package*.json ./

# On installe les dépendances. On utilise 'npm ci' au lieu de 'npm install' car :
# - C'est plus rapide
# - Cela garantit l'installation des versions exactes listées dans package-lock.json
RUN npm ci

# Une fois les dépendances installées, on copie le reste du code de notre projet.
COPY . .

# === SOLUTION DE L'ERREUR DE PERMISSION (StackOverflow) ===
# Cette ligne est cruciale : elle lie cette image Docker au repository GitHub.
# Sans ça, le token (GITHUB_TOKEN) n'a pas les droits pour publier l'image dans l'organisation.
LABEL org.opencontainers.image.source="https://github.com/deselikem/express-app-testing-demo"

# On indique à Docker que l'application écoute sur le port 3000. 
# C'est informatif, ça aide les développeurs à savoir quel port mapper.
EXPOSE 3000

# === BONNE PRATIQUE DE SÉCURITÉ ===
# Par défaut, Docker exécute les processus en tant qu'utilisateur "root".
# C'est dangereux en production. L'image de base Node.js fournit un utilisateur "node" avec moins de droits.
USER node

# La commande finale qui sera exécutée au lancement du conteneur.
CMD ["npm", "start"]
