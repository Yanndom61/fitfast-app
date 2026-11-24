# FitFast — Jeûne 17:7

Application web (PWA) pour suivre un jeûne intermittent **17:7**, avec un créneau de **11h30 à 18h30** tous les jours, un journal quotidien et un suivi de la progression.

Toutes les données restent sur le téléphone (rien n’est envoyé sur un serveur).

## Utiliser l’appli

Adresse de l’appli : **https://yanndom61.github.io/fitfast-app/**

Ouvre cette adresse dans **Chrome** sur Android, puis ajoute-la à l’écran d’accueil (voir les étapes ci-dessous).

## Installer sur un Samsung (Chrome)

1. Ouvre l’URL de FitFast dans **Chrome** (pas dans le navigateur Samsung, de préférence).
2. Attends que la page se charge.
3. Appuie sur le menu **⋮** en haut à droite.
4. Choisis **Ajouter à l’écran d’accueil** (ou **Installer l’application**).
5. Confirme. L’icône FitFast apparaît alors parmi tes applis.

## Notifications

Chrome sur Android **n’envoie pas de façon fiable** des notifications programmées quand une appli web est fermée. C’est une limite des PWA, pas un oubli de FitFast.

Ce que l’appli fait :

- Si tu actives les notifications et que **FitFast est ouvert**, les rappels partent à l’heure (début de créneau, fin bientôt, début du jeûne, eau, bilan du soir).
- Pour des rappels **fiables même l’appli fermée**, va dans **Réglages** puis :
  - **Télécharger le calendrier des rappels** et ouvre le fichier avec **Google Agenda**, ou
  - suis les étapes pour créer des alarmes dans l’**Horloge Samsung**.

Les horaires sont modifiables dans les réglages. Les valeurs par défaut sont : 11h30, 18h00, 19h00, bilan à 00h30, et un verre d’eau toutes les 2 heures de 11h à 23h.

## Données

- Journal : jeûne respecté, poids, eau, écarts (bière, grignotage, autre), cigarettes.
- Progression : historique, courbe de poids, série de jeûnes respectés, tendances.
- Une sauvegarde JSON peut être exportée et réimportée depuis les réglages.
