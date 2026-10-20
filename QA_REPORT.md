# Chaos Survival — rapport d’audit qualité

**Date de l’audit :** 20 octobre 2026  
**Périmètre :** état du dépôt au début de l’audit, tests automatisés existants, validation de build, parcours narratif statique et tentative de vérification visuelle.  
**Règle respectée :** aucun code de production, dialogue ou état de sauvegarde n’a été modifié pendant cet audit. Seul ce rapport a été créé.

## 1. Résumé exécutif

Le dépôt comporte des tests unitaires et d’intégration étendus : **537 tests exécutés, 528 réussis, 8 échoués et 1 ignoré**. Le build de production réussit. Les suites BombArena et sauvegarde/raccourcis développeur exécutées séparément passent. L’audit a toutefois trouvé des échecs persistants dans les tests du bureau et de l’explorateur, ainsi que deux attentes de dialogue qui ne correspondent plus aux dialogues actuels.

L’exécution de `npm run verify:desktop` n’a pas atteint le scénario Chromium : Electron a échoué au démarrage à cause des ACL Windows de `node_modules/electron/dist` dans cet environnement. Les dépendances Playwright et Puppeteer ne sont pas installées. Aucun parcours interactif visuel n’est donc déclaré comme testé.

**Bilan des constats :**

- **1 violation de contenu confirmée** de la règle d’adresse du joueur : PixelGirl envoie « GG JUSTME » dans la branche où JustMe gagne.
- **1 nœud narratif probablement orphelin** dans le JSON du groupe ; la logique de re-proposition actuelle utilise des définitions générées dynamiquement.
- **8 échecs automatisés** reproduits. Ils sont détaillés ci-dessous ; les échecs seuls ne prouvent pas tous un défaut visible en jeu.
- **Aucun défaut de progression P0/P1 confirmé** par les vérifications exécutées.
- **1 scénario d’interface bloqué par l’environnement** et plusieurs interactions manuelles de stress non exercées.

## 2. Méthode et limites

J’ai lu `AGENTS.md`, examiné l’organisation de `src`, `tests` et `scripts`, exécuté la suite complète, les suites ciblées par système, le build et `verify:desktop`. Un parcours statique a chargé et validé les dialogues JSON puis suivi leurs arêtes `next`, `choices`, `transfer.accept` et `transfer.refuse`, sans tenir compte des valeurs d’état nécessaires aux conditions. Une recherche a aussi recensé les mentions possibles de JustMe dans les répliques des PNJ.

Ce parcours statique ne simule pas les sauvegardes, l’orchestrateur, les délais ni les conditions combinatoires. Les tests automatisés ne remplacent pas la manipulation réelle du jeu. Aucun état de sauvegarde utilisateur n’a été chargé ou modifié volontairement.

Les tests ont été exécutés sur la version du dépôt disponible durant l’audit. Le statut final de Git montre uniquement ce nouveau rapport comme non suivi ; aucun changement de code n’a été produit par la campagne.

## 3. Résultats des commandes

| Vérification | Résultat |
| --- | --- |
| `node --test --test-reporter=spec` | 537 tests : 528 réussis, 8 échoués, 1 ignoré |
| Suites Messenger/K7 ciblées | 103 tests : 102 réussis, 1 échoué |
| Suites BombArena ciblées | 42 tests : 42 réussis |
| Suites bureau/VFS ciblées | 69 tests : 63 réussis, 6 échoués |
| Suites sauvegarde/DEV/mini-jeux ciblées | 52 tests : 52 réussis |
| Suites Messenger/audio ciblées | 39 tests : 39 réussis |
| `npm.cmd run build -- --configLoader runner` | Réussi ; vérifications musique/histoire et build Vite réussis |
| `npm.cmd run verify:desktop` | Échec avant le parcours UI : Electron bloqué par les ACL Windows du sandbox |
| Parcours des dialogues JSON | 15 dialogues, 183 nœuds, 113 choix ; un nœud non atteint par le graphe statique |

Les suites ciblées se recoupent et ne s’additionnent pas au total global. Le build affiche un avertissement Vite pour un chunk JavaScript de 770,40 kB avant gzip (226,84 kB gzip) ; il n’empêche pas la compilation.

### Échecs de la suite complète

1. `tests/desktop-icons.test.js` : quatre échecs. Trois fixtures DOM lèvent `button.classList?.contains is not a function`; un test du raccourci Delete obtient `false` alors qu’il attend `true`.
2. `tests/virtual-filesystem.test.js` : le test des cibles de dossiers ne trouve pas `shared-profile`; le test d’extraction BombArena observe deux raccourcis alors qu’il en attend un.
3. `tests/smiley-dialogue.test.js` : l’attente contient « elle a l’air grave marrante la vidéo », tandis que le dialogue actuel contient « elle a l’air marrante la vidéo ».
4. `tests/super-plombier-narrative.test.js` : l’attente cherche `AHAHAHAHA` dans la branche du WIZZ, alors que le dialogue actuel enchaîne sur « quoi, tu veux encore des wizz :p ?? ».

Les deux derniers sont des divergences d’attentes de tests par rapport aux données actuelles. Les tests du bureau/explorateur révèlent au minimum des fixtures ou attentes désynchronisées ; l’échec de comptage des raccourcis mérite une vérification visuelle après résolution de l’accès Electron.

## 4. Couverture observée

| Système | Scénarios identifiés dans le brief | Tests automatisés exécutés | Résultat automatisé | Non vérifié dans l’interface réelle |
| --- | --- | --- | --- | --- |
| Conversations MSN | choix, réception, temporisations, fenêtres et historique | 103 tests dans les suites Messenger/K7, plus tests globaux | 102 réussis, 1 échec d’attente de dialogue | Parcours manuel de toutes les conversations et interruptions |
| K7 | ordre de fin PixelGirl/Turbo, délai de connexion, groupe parallèle, fermeture et reprise | inclus dans les suites de narration, planification et conversations | Couverture partielle ; incluse dans les 103 tests ci-dessus | Les huit scénarios temporels et de réouverture en UI |
| Conversation de groupe | participants, transferts, choix, BombArena et reprise | suites narration/BombArena | couverte par tests de simulation ; pas de validation visuelle | fenêtres réduites, arrière-plan et interactions rapides |
| BombArena | manches, départages, collisions, résultats et handoff | 42 tests ciblés, plus tests globaux | 42 réussis | Partie jouée en Electron, fermeture réelle et retour visuel à MSN |
| Autres mini-jeux | démarrage, victoire, reprise, réactions | suites mini-jeux/DEV ciblées | inclus dans 52 tests réussis | Stress multi-fenêtres et parcours réels prolongés |
| WIZZ | bouton, choix narratif, réception, groupe, sons et animation | 39 tests Messenger/audio ciblés | 39 réussis | Son audible dans Electron, fenêtre réduite et interruptions pendant animation |
| Bureau Windows XD | raccourcis, sélection, déplacements, tâches et fenêtres | 69 tests bureau/VFS ciblés | 63 réussis, 6 échoués | Vérification Chromium/Electron bloquée par ACL |
| Poste de travail / VFS | navigation, fichiers, suppressions, extraction, raccourcis | compris dans les 69 tests précédents | Deux échecs liés aux dossiers/raccourcis | Parcours visuel et glisser-déposer réel |
| Sauvegardes | restauration, progression, transferts, réinitialisation | suites sauvegarde/réinitialisation dans le groupe ciblé | incluses dans 52 tests réussis | Rechargement interactif à chaque étape narrative |
| Raccourcis DEV | finalisation de mini-jeu/conversation et isolation DEV | suite DEV incluse dans le groupe ciblé | inclus dans 52 tests réussis | Build distribué lancé et raccourcis testés manuellement |

### Couverture narrative statique

Les **15 fichiers JSON** de dialogue sont acceptés par le validateur. Le graphe statique contient **183 nœuds et 113 choix**. Tous les nœuds sont joignables depuis leur départ, sauf `bomb-arena-refused-reoffer` dans `pixelgirl-super-plombier-group.json`. Les conditions des choix n’ont pas été explorées exhaustivement par ce parcours ; les tests de narration couvrent des branches précises, mais pas toutes les combinaisons possibles de drapeaux et d’historiques.

Le seul texte de réplique de PNJ correspondant à une mention du pseudo est « GG JUSTME », conditionné par `bombArenaWinner === "justme"`. Les autres mentions trouvées sont des identifiants ou des messages de relance, pas des répliques adressées au joueur dans les dialogues JSON.

## 5. Constats classés

### BUG-001 — Une réplique de PNJ emploie le pseudo du joueur

**Priorité :** P2  
**Statut :** Confirmé  
**Système concerné :** dialogue de groupe post-BombArena  
**Conditions initiales :** JustMe gagne BombArena et le dialogue post-match est actif.  
**Étapes de reproduction :**

1. Charger la branche `bomb-arena-postmatch` avec `bombArenaWinner = "justme"`.
2. Faire recevoir les messages de la branche gagnante.
3. Observer la deuxième réplique de PixelGirl.

**Résultat attendu :** conformément à la règle d’audit, un PNJ n’adresse pas le joueur par « JustMe » ou une variante.  
**Résultat observé :** PixelGirl écrit « GG JUSTME ».  
**Fréquence :** systématique sur cette branche.  
**Preuve :** `src/dialogues/bomb-arena-postmatch.json:21`.  
**Cause technique :** texte littéral de la réplique, confirmé.  
**Correction recommandée :** décider d’un remplacement de texte dans une phase ultérieure ; le dialogue n’a pas été modifié pendant l’audit.  
**Risque de régression :** faible, localisé au texte.  
**Tests à ajouter après correction :** assertion que les textes prononcés par un PNJ ne contiennent pas le pseudo joueur, sans filtrer les messages du joueur ni les noms d’interface.

### BUG-002 — Nœud de re-proposition BombArena orphelin

**Priorité :** P3  
**Statut :** Probable code narratif mort, pas de blocage joueur reproduit  
**Système concerné :** fichier de dialogue du groupe  
**Preuve :** le nœud `bomb-arena-refused-reoffer` est déclaré mais aucune arête de dialogue ne le référence. `NarrativeOrchestrator.onBombArenaTransferDeclined()` crée plutôt des dialogues `bomb-arena-redownload-N` à partir de `bombArenaRedownloadDialogue()`.  
**Risque :** une personne qui modifie le dialogue peut croire que ce nœud est le chemin de re-proposition alors qu’il n’est pas choisi par le moteur actuel.  
**Correction recommandée :** vérifier son statut avec le propriétaire narratif, puis le supprimer ou le raccorder dans une tâche séparée. Aucun changement n’a été fait.

### BUG-003 — Les attentes de deux tests ne correspondent plus aux dialogues

**Priorité :** P2 pour la fiabilité de la suite, aucun défaut de dialogue confirmé par ces seuls échecs  
**Statut :** Confirmé comme divergence test/données  
**Preuves :** `tests/smiley-dialogue.test.js:220` attend `grave marrante`, mais `turbo-smiley-catcher.json` contient `marrante`; `tests/super-plombier-narrative.test.js:875` attend `AHAHAHAHA`, absent de la branche actuelle du WIZZ.  
**Correction recommandée :** réexaminer l’intention des dialogues puis adapter les assertions dans une tâche autorisée ; l’audit n’a modifié aucun test.

### BUG-004 — Vérifications bureau/explorateur instables dans l’environnement courant

**Priorité :** P2 à investiguer  
**Statut :** Échecs de test confirmés, défaut visible non confirmé  
**Conditions de reproduction :** lancer les tests complets dans l’état de travail observé.  
**Résultat observé :** trois tests `DesktopIcons` échouent car les objets DOM simulés ne possèdent pas `classList.contains`; un quatrième échoue sur le chemin Delete. Le test de dossier ne trouve pas sa cible attendue et le test d’extraction compte deux raccourcis au lieu d’un.  
**Cause technique :** la cause des trois erreurs `contains` est la fixture DOM incomplète. La cause du chemin Delete et des deux assertions VFS n’a pas été établie par un test navigateur.  
**Risque :** la suite ne protège pas de façon fiable les récents changements du bureau ; le comptage peut également signaler un doublon réel.  
**Correction recommandée :** mettre les fixtures à niveau puis vérifier les scénarios de suppression/extraction en Chromium avant de conclure sur le produit. Aucun code ni test n’a été modifié pendant l’audit.

## 6. Dette technique et systèmes les plus fragiles

1. **Bureau/VFS :** plusieurs tests divergent avec les implémentations ou les attentes, et les interactions clés (drag/drop, suppression réelle, raccourci seulement) n’ont pas été confirmées visuellement. C’est la zone de risque prioritaire.
2. **Contrat tests-dialogues :** des textes attendus ont dérivé des dialogues validés. Cela rend les échecs difficiles à distinguer d’une vraie régression narrative.
3. **Graphe BombArena :** le nœud de re-proposition non référencé coexiste avec un mécanisme dynamique similaire. Ce n’est pas un blocage observé, mais cela rend le modèle moins évident à maintenir.
4. **Taille du bundle :** Vite signale un chunk JS de 770,40 kB. Aucun ralentissement n’a été mesuré ; c’est un risque potentiel de chargement/performance, pas un bug confirmé.

Les tests de gameplay BombArena, ses départages et le handoff narratif sont les parties les mieux couvertes par les suites ciblées exécutées. Les tests simulés d’horloge et de sauvegarde apportent une bonne couverture logique, sans valider les effets visuels ou le son réel.

## 7. Scénarios non testés ou bloqués

- Parcours complet de l’UI dans Electron/Chromium : `verify:desktop` échoue avant l’inspection de la page. Le message Electron indique que les processus sandboxés ne peuvent pas lire `node_modules/electron/dist` en raison des ACL Windows. Aucun changement ACL n’a été effectué.
- Aucun Playwright ou Puppeteer n’est présent dans `node_modules`.
- Aucun test manuel du son WIZZ audible, du focus des fenêtres ou de l’animation sous réduction/restauration.
- Pas de stress interactif prolongé avec plusieurs fenêtres et conversations simultanées ; les tests restent des scénarios automatisés ciblés.
- Toutes les combinaisons de conditions narratives n’ont pas été explorées. Le comptage de graphe traite les arêtes de façon statique et ne garantit pas que chaque combinaison de drapeaux soit atteignable.
- Aucun test sur une sauvegarde utilisateur réelle ; les tests automatisés emploient leurs propres fixtures.

## 8. Plan de correction recommandé

1. Résoudre le blocage de l’environnement Chromium/Electron ou exécuter les vérifications dans un environnement autorisé, sans modifier les ACL à l’aveugle.
2. Réconcilier les six échecs bureau/VFS avec le comportement voulu et confirmer en navigateur les doublons/suppressions avant toute correction de production.
3. Actualiser les assertions des dialogues après confirmation narrative des textes attendus.
4. Décider du sort du nœud `bomb-arena-refused-reoffer` et ajouter un contrôle de graphe de dialogues qui distingue les nœuds volontairement dynamiques des nœuds oubliés.
5. Modifier « GG JUSTME » selon la règle d’adresse du joueur et ajouter une vérification ciblée.
6. Mesurer le chargement/performance du bundle avant d’envisager une séparation de chunks.

## 9. Conclusion

Le build et les suites ciblées de BombArena, sauvegardes/DEV/mini-jeux et WIZZ réussissent. **La campagne n’est pas entièrement verte : 8 des 537 tests échouent**, dont six dans le périmètre bureau/VFS et deux assertions narratives obsolètes. Une violation de contenu est confirmée ; l’existence d’un défaut visuel de doublon reste à vérifier dans une vraie interface. En raison du blocage ACL, l’audit ne valide pas la séquence complète au clic dans l’application.
