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
| Problèmes potentiels / limites à suivre | **2** |

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

#### QA-POT-002 — La validation interactive reste indisponible dans cet environnement

**Priorité :** P2 pour l’assurance qualité, pas un défaut produit confirmé.
**Système :** rendu Electron/Chromium.
**Statut :** bloqué par les restrictions déjà reproduites pendant l’audit précédent.
**Preuve :** Electron échoue avant l’ouverture de l’interface sur les ACL de `node_modules/electron/dist`; Chrome et Edge ne parviennent pas à initialiser leur processus GPU / canal CDP. Playwright et Puppeteer ne sont pas installés.
**Correction recommandée :** exécuter les scripts existants dans un poste de test autorisé où le moteur graphique démarre. Aucun changement d’ACL, de sandbox ou d’installation n’a été tenté ici.

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

La tentative visuelle de la campagne précédente n’est pas répétée : elle s’est arrêtée avant le parcours UI pour les mêmes restrictions d’ACL Electron et de processus GPU/CDP Chromium. Les scripts `verify:desktop` et `verify:desktop:browser` n’ont donc pas produit de validation visuelle exploitable dans cette campagne.

## G. Priorisation

1. **Blocage du scénario :** aucun blocage narratif nouveau observé dans les scénarios automatisés. Le handoff BombArena est couvert par une simulation intégrée avec persistance et tentative suivante après échec transitoire.
2. **Sauvegardes :** pas de perte ni doublon observé dans les tests ciblés ; les essais couvrent des stores isolés, pas les sauvegardes utilisateur réelles.
3. **Régressions fonctionnelles :** les anciennes erreurs Delete, `shared-profile`, extraction/compte de raccourcis, attentes de dialogues et adresse « GG JUSTME » sont corrigées ou leurs tests adaptés au comportement voulu et passent.
4. **Synchronisation :** K7 livre un message à la fois et conserve les délais ; les séquences WIZZ utilisent le chemin Messenger commun. Les tests audio ne prouvent pas que le son est audible dans Electron.
5. **Défauts visuels :** aucun défaut nouveau confirmé ; vérification graphique toujours bloquée par l’environnement.
6. **Dette technique :** clarifier le statut du nœud `bomb-arena-refused-reoffer`; surveiller le chunk JS supérieur à 500 kB sans en déduire un ralentissement non mesuré.

## Conclusion

L’état actuel est nettement meilleur que celui du premier audit : **les 540 tests passent sauf un test explicitement ignoré**, et les corrections répertoriées dans le tableau sont protégées par des assertions ciblées. Aucun nouveau bug n’a été confirmé par la campagne automatisée. La chaîne BombArena est testée en intégration logique jusqu’à la première réplique MSN et au rechargement sans duplication.

La validation ne justifie toutefois pas de dire que tous les parcours sont testés : aucun parcours visuel Electron/Chromium, aucune écoute audio réelle et aucune partie humaine complète n’ont pu être réalisés ici. Les priorités de suivi sont la validation dans un environnement graphique fonctionnel et la clarification du nœud statique BombArena potentiellement orphelin.
