# Envoi des demandes de rendez-vous par email

Le formulaire du site envoie chaque demande à ce petit service. Le service :
1. vérifie la demande (date valide, pas de dimanche, heure en :00 ou :30 entre 8h et 20h) ;
1. vérifie la demande ;
2. écarte les robots (champ piège, durée de saisie, 5 demandes maximum par adresse IP toutes les 10 minutes, 60 emails maximum par heure) ;
3. réserve une place sur le créneau : **3 clients maximum par créneau de 30 minutes**. Au-delà, le créneau apparaît grisé (« complet ») sur le site ;
4. envoie un email à l'accueil (`contact@motoscool.fr`), au format du garage, avec un bouton **« Libérer la place de ce créneau »** à utiliser si le client annule ou déplace son rendez-vous.

Le service garde seulement le jour et l'heure des créneaux pris (aucune donnée personnelle).

Tant que `SITE.bookingEndpoint` est vide dans `index.html`, le site est en **mode démo**. Rien n'est envoyé. L'écran de confirmation montre l'email que l'accueil recevrait.

## Mise en place (environ 15 minutes, gratuit)

### 1. Créer le compte Brevo
- Créer un compte gratuit sur [brevo.com](https://www.brevo.com) : 300 emails par jour, société française, serveurs dans l'UE.
- Valider le domaine `motoscool.fr` dans **Expéditeurs et domaines**. Il faut ajouter les enregistrements DNS chez OVH.
- Créer une clé API dans **SMTP & API › Clés API**.

### 2. Déployer le service sur Cloudflare
- Créer un compte gratuit sur [dash.cloudflare.com](https://dash.cloudflare.com).
- Aller dans **Workers & Pages › Create › Worker**.
- Coller le contenu de `worker.js`, puis cliquer sur **Deploy**.

### 3. Créer la base des créneaux (gratuit)
- Dans **Workers & Pages › D1**, créer une base, par exemple `rdv-creneaux`.
- Dans le Worker, **Settings › Bindings › Add › D1 database** : nom de la liaison **`DB`**, base `rdv-creneaux`.
- La table se crée toute seule à la première demande.

### 4. Renseigner les variables du Worker
Elles se trouvent dans **Settings › Variables** :

| Variable | Exemple |
|---|---|
| `BREVO_API_KEY` | la clé API Brevo (type *Secret*) |
| `TO_EMAIL` | `contact@motoscool.fr` |
| `FROM_EMAIL` | `rdv@motoscool.fr` (adresse du domaine validé) |
| `SITE_URL` | `https://motoscool.fr/` (avec le `/` final) |
| `ALLOWED_ORIGINS` | `https://motoscool.fr,https://said-94.github.io` |
| `SIGN_KEY` | une longue chaîne aléatoire (type *Secret*) : signe chaque lien « Libérer la place » |
| `CAPACITE` | `3` (clients maximum par créneau) |

Ne pas renseigner `TURNSTILE_SECRET` tant que le widget Turnstile n'est pas ajouté au formulaire, sinon toutes les demandes seront refusées.

### 5. Brancher le site
- Dans `index.html`, mettre l'adresse du Worker dans `SITE.bookingEndpoint`, par exemple `https://rdv-motoscool.xxx.workers.dev`.
- Changer `VERSION` dans `sw.js`.

## Annulation ou déplacement

Si un client annule ou déplace son rendez-vous, l'accueil clique sur **« Libérer la place de ce créneau »** dans l'email de la demande, puis confirme. La place redevient disponible sur le site.
