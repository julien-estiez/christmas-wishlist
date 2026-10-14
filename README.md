# 🎄 Noël en famille

Site de gestion des cadeaux de Noël : chacun écrit sa liste, les proches la consultent, réservent un cadeau ou suggèrent des idées. **Le propriétaire d'une liste ne voit jamais les réservations ni les suggestions.**

- Front : HTML + CSS + JavaScript (aucun outil de build)
- Hébergement : GitHub Pages (gratuit)
- Base de données + comptes : Supabase (gratuit)
- Seul coût : le nom de domaine (optionnel, ~10 €/an)

## Comment ça marche

| Fonction | Détail |
|---|---|
| Inscription / connexion | Nom, prénom, mot de passe (+ avatar choisi à l'inscription) |
| Ma liste au Père Noël | Idées avec titre et description, modifiables et supprimables |
| Familles | Créer une famille (code d'invitation généré) ou en rejoindre une avec un code |
| Liste d'un membre | Souhaits + suggestions, bouton de réservation (marque « Déjà pris par … ») |
| Suggestions | Ajoutées par un autre membre, invisibles du propriétaire de la liste |
| Mini-jeu « Attrape-cadeaux » | Onglet manette : attrape les cadeaux avec le traîneau du Père Noël, évite le charbon |
| Classement | Meilleur score de chacun, parmi tous les membres de toutes tes familles (filtrable par famille) |

**Secret garanti côté serveur** : les règles de sécurité (RLS) de `supabase/schema.sql` empêchent la base de renvoyer réservations et suggestions au propriétaire de la liste, même s'il ouvre les outils du navigateur.

---

## Mise en ligne, pas à pas

### 1. Créer le projet Supabase (5 min)

1. Crée un compte sur <https://supabase.com> puis **New project** (choisis une région européenne, ex. Frankfurt ou Paris).
2. Ouvre **SQL Editor → New query**, colle tout le contenu de `supabase/schema.sql` et clique **Run**.
3. Va dans **Authentication → Sign In / Providers → Email** et **désactive « Confirm email »** (indispensable : les comptes n'ont pas de vraie adresse email).
4. Va dans **Project Settings → API** et note :
   - **Project URL**
   - la clé **anon / publishable** (elle est publique par conception, la sécurité repose sur les règles RLS)

### 2. Configurer le site

Ouvre `js/config.js` et remplace :

```js
export const SUPABASE_URL = "https://VOTRE-PROJET.supabase.co";
export const SUPABASE_ANON_KEY = "VOTRE-CLE-ANON-PUBLIQUE";
```

### 3. Mettre tes images

- **Avatars d'elfes** : mets tes images dans `assets/avatars/` (png, jpg, svg, webp…) puis liste leurs noms dans `AVATARS` (`js/config.js`). Les 12 `.svg` fournis sont des exemples à remplacer.
- **Fond étoilé** : dépose ton image (celle de l'année dernière) sous le nom `assets/bg.png`. Sans ce fichier, un ciel étoilé généré en CSS s'affiche.
- **Police** : *Macondo* (Google Fonts) ressemble à celle de tes captures ; change `--font` dans `css/style.css` si tu veux une autre.

### 4. Publier sur GitHub Pages

1. Crée un dépôt GitHub (public, pour que Pages soit gratuit) et envoie-y tous les fichiers de ce dossier.
2. **Settings → Pages → Build and deployment → Source : Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. Après une minute, le site est en ligne sur `https://TON-PSEUDO.github.io/NOM-DU-DEPOT/`.

### 5. Brancher ton nom de domaine

1. **Settings → Pages → Custom domain** : saisis ton domaine (ex. `noel.mondomaine.fr`) puis coche **Enforce HTTPS** une fois la vérification terminée.
2. Chez ton registrar, crée un enregistrement **CNAME** : `noel` → `TON-PSEUDO.github.io`.
   (Pour un domaine nu, utilise les enregistrements A de GitHub Pages indiqués dans leur documentation.)

### 6. Éviter la mise en pause de Supabase

Le plan gratuit met le projet en pause après 7 jours sans activité. Le workflow `.github/workflows/keep-alive.yml` envoie une requête tous les 3 jours. Pour l'activer :

**Settings → Secrets and variables → Actions → New repository secret**, deux fois :

- `SUPABASE_URL` : l'URL du projet
- `SUPABASE_ANON_KEY` : la clé anon

(Si le projet est quand même mis en pause, un clic sur **Restore** dans le tableau de bord Supabase le relance.)

---

## Le mini-jeu « Attrape-cadeaux »

- **Contrôles** : glisser le doigt (mobile), souris, ou flèches ← → du clavier (touches A/Q et D aussi). Espace ou clic pour démarrer.
- **Règles** : cadeau attrapé = +1 point, cadeau doré = +3 points. Un cadeau qui touche le sol ou un morceau de charbon attrapé = une vie en moins (3 vies). La vitesse augmente avec le score.
- **Classement** : chacun a un meilleur score. Le classement regroupe les membres de toutes tes familles ; le menu déroulant permet de se limiter à une famille.
- **Triche** : le jeu tourne dans le navigateur, donc un joueur déterminé pourrait envoyer un faux score. La base refuse les scores impossibles par rapport à la durée de la partie (plus de 3 points par seconde), ce qui suffit pour un jeu de famille. Une protection complète demanderait de rejouer chaque partie côté serveur.
- **Remettre les scores à zéro** (par exemple après Noël) : dans Supabase → SQL Editor, `delete from public.scores;`

### Si tu avais déjà installé la première version

Relance **tout** le fichier `supabase/schema.sql` dans le SQL Editor de Supabase : il est conçu pour être relancé sans danger et ne touche pas aux données existantes. Il ajoute la table `scores` et les fonctions du classement. Ensuite, remplace les fichiers du site sur GitHub par les nouveaux (le dossier `js/`, `css/` et `index.html`) ; garde ton `js/config.js` renseigné.

## Gérer les mots de passe oubliés (tu es l'administrateur)

Il n'y a pas d'email, donc c'est toi qui réinitialises :

1. Ouvre `supabase/reset_password.sql`, colle-le dans **Supabase → SQL Editor**.
2. Remplace l'identifiant (`nom.prenom@noel-famille.app`) et le mot de passe temporaire, puis **Run**.
   La requête commentée en bas du fichier liste tous les comptes si tu as un doute sur l'identifiant exact.
3. Communique le mot de passe temporaire à la personne : elle le change ensuite dans l'onglet **Profil**.

## Limites à connaître

- L'identifiant est « nom + prénom » : deux personnes ayant exactement le même nom et prénom ne peuvent pas avoir chacune un compte. Les accents, majuscules et espaces ne comptent pas (`Estiez` = `estiez`).
- Le mot de passe fait au moins 6 caractères.
- Supabase limite le nombre d'inscriptions et connexions par heure sur le plan gratuit : largement suffisant pour une famille.
- Les réservations sont **globales par cadeau** : si une personne appartient à deux familles, sa réservation est visible de toutes les personnes qui partagent une famille avec le propriétaire de la liste.

## Structure du projet

```
index.html              page unique (navigation par #/...)
css/style.css           thème nuit étoilée
js/config.js            URL Supabase, clé publique, avatars
js/app.js               toute la logique du site
js/game.js              le mini-jeu Attrape-cadeaux (canvas)
assets/avatars/         images d'avatars
supabase/schema.sql     tables + sécurité + fonctions
supabase/reset_password.sql   réinitialiser un mot de passe
.github/workflows/      garde Supabase actif
```
