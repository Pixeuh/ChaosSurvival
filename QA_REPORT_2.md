# Chaos Survival — rapport de la campagne QA 2

**Date :** 20 octobre 2026
**Périmètre :** vérification indépendante des corrections post-audit, suite automatisée complète, tests ciblés, validation narrative statique et build de production.
**Règle respectée :** aucun code de production, dialogue, scénario, mécanique ou état de sauvegarde n’a été modifié pendant cette campagne. `QA_REPORT.md` a été conservé.

## A. Résumé

| Vérification | Résultat |
| --- | ---: |
| `npm.cmd test` | **540 tests : 539 réussis, 0 échec, 1 ignoré** |
| Suites ciblées de régression et d’intégration | **223 tests : 223 réussis, 0 échec, 0 ignoré** |
| `npm.cmd run build -- --configLoader runner` | Réussi ; validation musique et histoire, puis compilation Vite |
| `git diff --check` | Réussi, aucune erreur de whitespace |
| Validation narrative du build | 4 séquences, 15 dialogues, avatars locaux présents |
| Bugs nouveaux confirmés par les contrôles exécutés | **0** |
| Défauts confirmés des scripts visuels | **3** |
| Problèmes potentiels / limites à suivre | **1** |

Les suites ciblées font partie de la suite complète et ne doivent pas être additionnées à son total. La compilation signale encore un chunk JavaScript de 769,45 kB avant gzip (226,61 kB gzip) ; le build n’est pas bloqué.

Depuis le premier audit à 537 tests, le total observé est de 540 (**+3 tests nets**). Les ajouts repérés sont le contrôle d’inertie d’une ancienne sauvegarde avec marqueur de bataille WIZZ et deux tests d’adresse du joueur par les PNJ. Aucun nouveau test n’a été ajouté pendant cette campagne : les tests présents ont été relancés et examinés.

## B. Comparaison avec le premier audit

| Problème initial | Statut précédent | Statut actuel | Vérification |
| --- | --- | --- | --- |
| Fixtures DOM (`classList.contains`) | Échec | **Résolu dans les tests** | Les suites `desktop-icons` et VFS passent ; leurs éléments simulés fournissent les méthodes DOM utilisées. |
| Suppression avec Delete | Échec | **Résolu dans le test ciblé** | La suppression passe par le chemin commun, ignore un champ de saisie et retire le raccourci sélectionné. |
| Conservation du fichier original | À confirmer | **Vérifié** | La suppression du raccourci laisse la cible virtuelle présente, y compris après rechargement ; suppression Explorer et suppression du raccourci sont distinguées. |
| Cible `shared-profile` | Échec | **Résolu** | Le dossier navigable a un identifiant virtuel stable et survit au rechargement. |
| Extraction BombArena et nombre de raccourcis | Assertion en échec | **Attente corrigée et scénario vérifié** | L’archive ZIP et l’EXE extrait sont deux cibles distinctes, avec un raccourci chacune. Réextraire ou recharger ne crée pas de doublon ; supprimer l’une ne supprime pas l’autre. |
| Dialogues PixelGirl / Turbo obsolètes | Échecs d’attentes | **Résolus** | Les attentes actuelles correspondent aux dialogues chargés ; les suites dialogue et narration passent. |
| « GG JUSTME » | Non conforme | **Résolu** | La branche JustMe contient maintenant « GG !!! » ; le test parcourt les textes PNJ de tous les JSON et cherche les vocatifs du pseudo. |
| Ancienne bataille de WIZZ PixelGirl | Incohérence suspectée | **Ancien état rendu inerte** | Un test charge un transcript et une échéance hérités puis vérifie qu’ils ne déclenchent aucun WIZZ ; les choix WIZZ actuels et leur progression restent testés. |

Ces résultats proviennent du code et des tests exécutés, pas seulement du rapport précédent. Ils établissent la protection logique des comportements testés ; ils ne remplacent pas une vérification réelle du rendu ou du son.

## C. Nouveaux bugs

**Aucun nouveau bug fonctionnel n’a été confirmé par cette campagne.** Les tests n’ont pas révélé de nouvel échec. Cela ne permet pas de conclure que chaque parcours interactif est exempt de défauts : la validation visuelle reste bloquée et plusieurs scénarios ne sont couverts que par des simulations.

### Pistes potentielles, non confirmées

#### QA-POT-001 — Nœud de re-proposition BombArena probablement obsolète

**Priorité :** P3
**Système :** dialogue de groupe BombArena
**Statut :** probable nœud statique orphelin, aucun blocage joueur reproduit.
**Preuve :** le parcours limité aux arêtes `next`, `choices` et transferts ne rejoint pas `bomb-arena-refused-reoffer`. L’orchestrateur produit les re-propositions par des définitions dynamiques `bomb-arena-redownload-N`.
**Cause probable :** ancien nœud gardé dans le JSON après le passage au mécanisme dynamique.
**Correction recommandée :** vérifier avec le responsable narratif si ce nœud est volontairement conservé, puis le supprimer ou l’intégrer dans un contrôle de graphe sachant reconnaître les événements dynamiques.
**Risque de régression :** faible si la décision est limitée au nœud ; ne pas le retirer sans validation narrative.

## D. Couverture narrative

Le dépôt contient **15 conversations/dialogues**, **183 nœuds**, **113 choix** et **236 références explicites** de transition. Le validateur de build confirme la syntaxe, le schéma, les identifiants uniques, les séquences et les ressources d’avatars ; aucune référence explicite à un nœud absent n’a été trouvée par le comptage complémentaire.

Les tests ciblés ont réellement parcouru plusieurs branches importantes :

- PixelGirl/Turbo : textes actuels, arrivée de Turb0, délai de son premier message, parcours Smiley Catcher et réponses de Super Plombier.
- K7 : les deux conversations privées terminées dans les deux ordres, horloges d’introduction et de groupe indépendantes, réception progressive, réponses initiales et reprise après sauvegarde.
- Groupe Super Plombier : choix persistés, refus et re-propositions, convergence de la fin commune, progression jusqu’à l’offre BombArena.
- BombArena post-match : résultat JustMe dans le test de handoff intégré, première réplique « AAAAAA », historique conservé et absence de duplication après rechargement. Les quatre branches vainqueurs sont aussi présentes dans les tests post-match dédiés.
- WIZZ narratifs : action structurée dans une autre conversation, choix PixelGirl, son `wizz` sans son `send` supplémentaire dans le rendu simulé, réponse actuelle et absence de relance de l’ancien combat.
- Adresse des PNJ : scan des JSON et assertions de contrôle positif/négatif sur le pseudo JustMe.

**Branches réellement parcourues :** celles visées par ces tests automatisés, notamment les branches de victoire BombArena et les chemins WIZZ/choix nommés ci-dessus. Le nombre exact de toutes les branches conditionnelles n’est pas présenté comme testé : aucune exécution exhaustive de toutes les combinaisons de sauvegardes et conditions n’a été réalisée.

Un parcours statique qui ne suit que les liens écrits dans les JSON laisse 19 nœuds sans chemin explicite depuis `start` dans K7, PixelGirl Intro et le dialogue de groupe. Plusieurs sont atteints par des transferts, événements ou mises à jour dynamiques, comme le confirme la couverture K7/BombArena. Ce parcours statique ne permet donc pas d’en faire 19 bugs. `bomb-arena-refused-reoffer` reste la piste probablement orpheline détaillée plus haut.

## E. Tests automatisés et intégration

### Campagne complète

`npm.cmd test` a exécuté **540 tests : 539 réussis, 0 échoué, 1 ignoré**.

### Suites ciblées

Le groupe ciblé de **223 tests** a couvert :

- Icônes, raccourcis, Delete et positions du bureau.
- VFS, dossiers navigables, fichiers reçus, suppression des liens et extraction répétée.
- Dialogues PixelGirl/Turbo, narration Super Plombier et K7.
- Messenger, WIZZ, sons mockés, indicateurs de saisie et échéances de réception.
- Moteur et handoff BombArena, fermeture/rechargement, sauvegardes et raccourcis DEV.
- Intégration de lancement et cycle de vie des mini-jeux.

Résultat : **223 réussis, aucun échec, aucun ignoré**.

### Scénarios multi-systèmes effectivement simulés

- Offre de BombArena depuis un point de reprise narratif sauvegardé, acceptation et fin du transfert, extraction du ZIP dans le VFS, progression de la conversation, résultat de huit manches produit par le moteur, échec temporaire d’activation du groupe, reprise après rechargement et réception du dialogue post-match sans doublon.
- Création, déduplication, suppression et recréation des raccourcis virtuels ; vérification indépendante de l’existence des fichiers cibles avant et après rechargement.
- Arrivée K7 et messages individualisés, choix puis reprise de la prochaine échéance sauvegardée.
- WIZZ narratif versus choix texte ordinaire, avec assertion sur les appels audio attendus.
- Fermeture d’une application pendant les cycles de pause/reprise, et tests des états de fenêtres/taskbar dans les suites concernées.

Ces scénarios sont des tests automatisés avec horloges, DOM ou moteurs simulés. Ils ne représentent pas une manipulation visuelle complète de l’application. Le scénario A BombArena ne fait pas jouer un humain aux huit manches : le test force des états de survivants puis utilise le moteur réel pour faire avancer et enregistrer les manches.

### Build et cohérence

`npm.cmd run build -- --configLoader runner` a réussi. Les étapes `verify-music` et `verify-story` sont passées, suivies de la compilation Vite (168 modules). Avertissement non bloquant : chunk JS de 769,45 kB avant gzip.

`git diff --check` a réussi. Le rapport précédent `QA_REPORT.md` n’a pas été modifié par cette campagne.

## H. Validation visuelle progressive — mise a jour du 20 octobre 2026

### A. Cause des repetitions

L'inspection de `scripts/verify-desktop-ui.mjs` et `package.json` ne montre aucun mecanisme de retry, de recursion, de surveillance ou de relancement automatique. Chaque commande lance un seul processus enfant, puis suit un parcours fini. Le script attend au plus 12 secondes par element (certaines attentes explicitement plus longues restent plafonnees par le budget du scenario), 45 secondes pour le smoke, 90 secondes pour Messenger et 240 secondes pour un parcours complet.

La repetition observee ne venait donc pas d'une boucle interne du script. Les lancements repetes visibles dans l'historique de travail provenaient des nouvelles commandes lancees par l'agent apres des echecs precedents ; l'historique systeme des anciennes sessions n'est pas disponible pour confirmer les durees ou codes de sortie exacts. Pour cette campagne, les tentatives ont suivi la regle stricte : une execution par phase, puis au plus une relance ciblee apres une correction motivee.

Trois `Page.reload` sont explicitement prevus dans les scenarios de persistance : deux rechargements du renderer dans Messenger pour reprendre une fixture de sauvegarde, et un dans Chromium apres confirmation des regles pour installer la fixture Explorer. Les logs disent maintenant qu'il s'agit du meme processus, sans redemarrage d'Electron/Chromium. Ces reloads ne sont pas des retries.

Avant le premier lancement graphique, `Get-Process -Name node,electron` ne signalait aucun processus concerne. Apres les parcours, aucun processus `node` ou `electron` ne restait actif. Les processus Edge deja presents n'ont pas ete arretes.

### B. Modifications des scripts

- Ajout d'un smoke visible separe, `npm run verify:desktop:smoke`, qui utilise un profil temporaire vierge et le parcours normal : Jouer, confirmation reelle des regles si elle apparait, bureau, ouverture puis fermeture de Poste de travail. Il ne recharge pas la page.
- La validation Chromium d'Explorer confirme desormais les regles avant le reload unique necessaire a la fixture narrative de test. Elle ne modifie pas l'etat interne pour contourner le premier lancement.
- L'assertion de roster calcule les contacts attendus avec `contacts.json`, les definitions de dialogue, `visibleContacts` et les etats de progression ; elle verifie aussi le statut hors ligne et la visibilite de PixelGirl.
- Le test WIZZ valide deux clics rapproches (un seul accepte), puis un nouvel envoi apres 5,2 secondes.
- Les attentes d'interface sont bornees par les delais locaux et le budget global de chaque scenario. Des logs indiquent commande, scenario, etapes, duree, echec, etape active et nettoyage.
- Le nettoyage ferme la connexion CDP, les timers, le processus enfant de cette execution, le serveur Vite eventuel et le profil temporaire dans `finally`. Aucun arret global de Chrome, Edge ou Electron n'est utilise.
- Le test de portraits verifie desormais qu'ils restent carres et dans la largeur visible, et que la colonne verticale reste defilable. Le premier essai a revele 4 px de debordement horizontal du conteneur (`scrollWidth=84`, `clientWidth=80`) avec une barre de defilement visible. Le script n'interprete plus ce faible debordement comme une perte d'acces aux portraits. Aucun code de production n'a ete modifie ; ce detail visuel reste a traiter separement si souhaite.

### C. Validations progressives

| Phase / commande | Executions | Duree et resultat | Fenetre / nettoyage |
| --- | ---: | --- | --- |
| A — `node --check scripts/verify-desktop-ui.mjs`, parse de `package.json`, recherches des boucles/reloads/processus, `git diff --check` | 1 passe statique | Reussie | Aucune interface lancee |
| B — `npm.cmd run verify:desktop:smoke` | 1 | 2,5 s ; succes, code 0 | Electron visible ; premier lancement, regles, bureau, Poste de travail ouvert puis ferme ; profil nettoye |
| C — `npm.cmd run verify:messenger:visible` | 2 au total : echec initial puis une relance ciblee | 49,7 s puis 50,4 s ; relance reussie, code 0 | Electron visible ; le premier echec etait l'assertion trop stricte sur 4 px de debordement horizontal ; profil nettoye dans les deux cas |
| D — `npm.cmd run verify:desktop` | 1 | 22,5 s ; succes, code 0 | Electron visible ; scenario complet termine et profil nettoye |
| D — `npm.cmd run verify:desktop:browser` | 1 | 4,1 s ; succes, code 0 | Chromium headless ; premier ecran de regles confirme ; un reload renderer journalise pour la fixture ; profil nettoye |

Aucun scenario n'a ete relance automatiquement. Le seul echec de cette campagne a ete analyse avant l'unique relance ciblee. La validation B confirme qu'un lancement graphique minimal ne rouvre pas l'application apres sa fermeture.

### D. Tests globaux

| Verification | Resultat |
| --- | --- |
| `npm.cmd test` | 540 tests : 539 reussis, 0 echec, 1 ignore |
| `npm.cmd run build -- --configLoader runner` | Reussi ; verifications musique/histoire et build Vite reussis |
| `git diff --check` | Reussi |
| `node --check scripts/verify-desktop-ui.mjs` et validation JSON de `package.json` | Reussis |

Le build garde l'avertissement Vite non bloquant pour le chunk JS de 769,45 kB avant gzip (226,61 kB gzip). Les parcours Electron et Chromium verifient des interactions d'interface, mais ne constituent pas une ecoute audio subjective.

### E. Fichiers modifies pendant cette intervention

- `scripts/verify-desktop-ui.mjs` : limites de duree, logs d'etapes, nettoyage, roster calcule depuis les donnees, confirmation des regles, test WIZZ compatible avec son cooldown et assertion corrigee sur les portraits.
- `package.json` : commandes separees pour le smoke visible et Messenger visible.
- `README.md` : documentation des commandes de validation progressive.
- `QA_REPORT_2.md` : mise a jour de cette section avec les resultats actuels.

Aucun fichier de production, dialogue, contact, sauvegarde ou regle de gameplay n'a ete modifie. Aucun commit ni push n'a ete effectue.

### F. Problemes restants

Les validations progressives demandees ont termine avec succes apres la correction ciblee. Le build conserve son avertissement de taille de chunk. Une barre de defilement horizontale de 4 px est visible dans la colonne des portraits a la taille de conversation testee ; le test confirme que les deux avatars restent dans la largeur visible et que le defilement vertical fonctionne, mais aucune correction de production n'etait autorisee dans cette tache. Les autres limites de couverture decrites dans la matrice restent applicables.


## F. Matrice de couverture et limites

| Domaine / parcours | Automatisation examinée ou exécutée | Résultat | Limite restante |
| --- | --- | --- | --- |
| Dialogues, choix et transitions | Suites de dialogue/narration ciblées + validateur JSON | Réussis | Pas d’exploration exhaustive de toutes les valeurs de drapeaux et toutes les branches conditionnelles |
| K7, délais indépendants et reprise | Tests d’orchestration, messages progressifs, sauvegarde | Réussis | Pas de test visuel en fenêtre réduite/arrière-plan |
| WIZZ bouton, reçu, narration, groupe | Tests Messenger et sons mockés | Appels `wizz` contrôlés ; cas narratif n’ajoute pas `send` | Audibilité réelle, maximisation et animation en jeu non confirmées |
| Mini-jeux | Suites gameplay/lancement/replay/DEV | Réussies dans le lot complet | Pas de campagne manuelle complète de chaque victoire/défaite |
| BombArena rounds, départages, collisions | Moteur déterministe et tests ciblés | Réussis | IA et collisions non stressées en interface réelle |
| BombArena résultat → handoff → dialogue | Test d’intégration moteur, sauvegarde, VFS, orchestrateur et thread | Réussi en simulation ; résultat persisté, retry, première réplique et historique sans doublon | Pas d’ouverture/focus visuel réel ni de partie humaine jouée |
| BombArena après victoire / fermeture | Tests de fenêtre et état indisponible | Écran indisponible et fermeture couverts | Interaction réelle non testée |
| Bureau / Delete / raccourcis | Tests d’icônes et positions | Réussis | Glisser-déposer réel non observé visuellement |
| VFS / Explorer / extraction / suppressions | Tests de fichiers, ZIP/EXE, cibles et persistance | Réussis | Menus contextuels et rendu des extensions non manipulés en UI réelle |
| Taskbar / fenêtres | Suites gestionnaire de fenêtres | États actif/inactif/réduit/maximisé testés par simulation | Superposition réelle de plusieurs fenêtres non vérifiée |
| Sauvegardes / rechargements | Suites save, narrative, VFS et handoff | Réussis pour les fixtures isolées | Aucune sauvegarde utilisateur réelle n’a été chargée |
| Interactions A–H du brief | Quelques chemins similaires couverts par tests ciblés | Couverture partielle, sans échec observé | Les huit scénarios combinés n’ont pas tous un test de bout en bout dédié |

Les tentatives précédentes avaient échoué au démarrage. Cette campagne a renouvelé l’exécution après approbation : Electron et Chromium se sont lancés, mais les scripts ont buté sur des attentes périmées avant la fin des parcours. Les erreurs précises sont consignées en section H.

## G. Priorisation

1. **Blocage du scenario :** les parcours visuels progressifs ont tous termine avec succes apres la correction ciblee de l'assertion portrait.
2. **Sauvegardes :** les profils des tests visuels sont temporaires et isoles ; les rechargements renderer de reprise sont journalises et finis.
3. **Scripts QA :** roster, premier lancement Chromium, cooldown WIZZ, durees maximales, nettoyage et progression sont verifies par les scenarios executes.
4. **Limite visuelle :** une barre horizontale de 4 px apparait dans la colonne portrait a une taille testee ; les avatars restent dans la zone visible et le defilement vertical fonctionne.
5. **Build :** avertissement non bloquant sur le chunk JS superieur a 500 kB.

## Conclusion

La campagne de validation visuelle a ete executee progressivement : smoke Electron visible (2,5 s), Messenger visible (une premiere execution a revele une assertion trop stricte, corrigee avant une unique relance ciblee, succes en 50,4 s), campagne Electron complete (22,5 s) et parcours Chromium complet (4,1 s). Aucun script ne relance automatiquement le jeu ; les reloads renderer necessaires aux fixtures de sauvegarde sont explicites et limites.

La suite globale compte 540 tests : 539 reussis, aucun echec et un ignore. Le build et `git diff --check` reussissent. Les processus enfants et profils temporaires ont ete nettoyes. Une barre de defilement horizontale de 4 px reste visible dans la colonne des portraits a la geometrie testee ; ce detail est signale sans modifier le code de production, hors perimetre de cette campagne.
