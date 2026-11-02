# Envoi des demandes de rendez-vous par email

Le formulaire du site envoie chaque demande à ce petit service. Le service :

1. vérifie la demande ;
2. écarte les robots (champ piège, durée de saisie, 5 demandes maximum par adresse IP toutes les 10 minutes) ;
3. envoie un email à l'accueil (`contact@motoscool.fr`), au format du garage, avec un bouton **« Valider ce rendez-vous »**.

Le service ne stocke rien.

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

### 3. Renseigner les variables du Worker
Elles se trouvent dans **Settings › Variables** :

| Variable | Exemple |
|---|---|
| `BREVO_API_KEY` | la clé API Brevo (type *Secret*) |
| `TO_EMAIL` | `contact@motoscool.fr` |
| `FROM_EMAIL` | `rdv@motoscool.fr` (adresse du domaine validé) |
| `SITE_URL` | `https://motoscool.fr/` (avec le `/` final) |
| `ALLOWED_ORIGINS` | `https://motoscool.fr,https://said-94.github.io` |

### 4. Brancher le site
- Dans `index.html`, mettre l'adresse du Worker dans `SITE.bookingEndpoint`, par exemple `https://rdv-motoscool.xxx.workers.dev`.
- Changer `VERSION` dans `sw.js`.

## Validation par l'accueil, puis G8

1. L'accueil clique sur **« Valider ce rendez-vous »** dans l'email.
2. La page `valider.html` s'ouvre avec la fiche.
3. Depuis cette page, l'accueil peut :
   - appeler le client ;
   - le confirmer par SMS ou par email, avec un texte prérempli ;
   - **valider et envoyer dans G8**.

L'envoi automatique dans G8 demande un accès technique (API) fourni par **Orisha**, l'éditeur de G8. Quand cet accès existe, on renseigne `G8_ENDPOINT` dans `valider.html` (et la route correspondante dans ce service). En attendant, « Valider » copie la fiche pour la coller dans G8.
