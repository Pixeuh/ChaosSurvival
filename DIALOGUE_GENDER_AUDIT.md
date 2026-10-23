# Chaos Survival — audit des dialogues et du genre grammatical

**Date : 23 octobre 2026.** État audité : arbre de travail existant au début de cette intervention, incluant la personnalisation intégrée à PixelGirl. Aucun commit ni push.

## 1. Résultat et méthode

Les **15 dialogues JSON Messenger**, leurs **739 messages, choix et propositions de fichier**, les conversations de Hopla Hotel, les relances générées, les échanges de BombArena, Buddy, les popups, les forums, blogs et documents locaux ont été relus dans leur contexte.

Le comptage reproductible couvre **30 sources et 1 746 unités**, plus **3 libellés d'interface**, soit **33 sources et 1 749 unités comptées**. Une unité est un emplacement de message, choix, paragraphe, commentaire ou libellé identifié. Les occurrences répétées des modèles de relance sont comptées comme des emplacements. Ce total ne représente ni 1 749 conversations, ni autant de chemins narratifs joués. Les titres/descriptions complémentaires ont été examinés sans être ajoutés au nombre de répliques.

Décomposition : **1 078 répliques/choix** (739 Messenger, 186 Hopla Hotel, 6 Buddy, 61 relances, 2 propositions dynamiques de fichier, 84 réactions/messages rapides BombArena), **109 textes de popups**, **422 paragraphes/commentaires de sites**, **116 paragraphes/faits encyclopédiques**, **21 documents virtuels**, puis 3 libellés d'interface.

**26 textes reçoivent une nouvelle paire masculin/féminin**, soit 52 formulations explicites. Avec les 4 paires déjà présentes et conservées, **30 textes possèdent des variantes grammaticales**. Cinq autres emplacements utilisent maintenant une variable explicite de pseudo. **Une ambiguïté narrative reste inchangée. Aucune source locale de dialogue identifiée n'a été omise.** Les contenus externes et scènes non implémentées sont distingués plus bas.

Méthode : inventaire des imports/catalogues réellement utilisés, lecture de chaque nœud avec auteur, contexte et choix, lecture des échanges des sites et données secondaires, puis contrôle du rendu et de la persistance. Les recherches lexicales ont aidé à repérer des candidats; elles n'ont pas décidé des modifications.

## 2. Architecture et sauvegardes

Le format existant est conservé : {player.grammaticalGender:masculin|féminin}, avec compatibilité de {player.gender:masculin|féminin}. Le pseudo utilise {player.nickname}. Les variantes sont explicitement écrites : aucune féminisation automatique, déduction à partir du pseudo ou modification de texte dans le DOM.

Le profil conserve séparément nickname, identityGender (boy/girl/neither), grammaticalGender (male/female) et completed. « Aucun des deux + elle » reste identityGender=neither, grammaticalGender=female. La normalisation respecte maintenant un completed=false explicite : interrompre la conversation avant le pronom ne termine plus artificiellement la personnalisation. Le format hérité gender et le profil masculin de compatibilité des anciennes sauvegardes sont conservés. Aucun historique ni aucune progression n'est réinitialisé.

DialogueSession résout les messages à leur réception et les choix avant leur affichage. Le message envoyé reprend la formulation proposée, avec les mêmes identifiants, effets et transitions. Transcriptions et historiques sauvegardent des chaînes résolues et ne sont pas réécrits au chargement. Les relances de groupe utilisent leur fabrique puis ce même moteur. Popups et résultats sont résolus avant la génération du rendu. L'insertion reste textuelle; les fenêtres à contenu HTML échappent les textes après résolution.

isValidPlayerText rejette les branches vides/manquantes, séparateurs supplémentaires, variables mal orthographiées et objets à la place des chaînes. La validation est intégrée à validateDialogue et à scripts/verify-player-text.mjs, appelé par le validateur d'histoire du build. Elle vérifie les textes JSON, les données JS importées et les variables inline des interfaces.

Le chat BombArena ne remplace plus globalement le mot « JustMe ». Quatre mentions explicites du participant humain utilisent une variable. Les pools auparavant inline sont regroupés avec les autres répliques sans modifier probabilités, délais, identifiants d'auteur ou événements. L'identifiant moteur justme reste stable et ne détermine pas les textes d'une conscience alternative.

## 3. Inventaire de couverture

Chaque source ci-dessous a été analysée. « Inchangées » inclut les paires préexistantes. « Ambiguës » est un sous-ensemble des textes inchangés. Les articles et documents ne sont pas présentés comme des conversations MSN.

| Source | Unités | Nouvelles paires | Paires conservées | Pseudo seul | Inchangées | Ambiguës |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| src/dialogues/bomb-arena-postmatch.json | 47 | 0 | 0 | 0 | 47 | 0 |
| src/dialogues/k7-intro.json | 149 | 0 | 0 | 0 | 149 | 0 |
| src/dialogues/pixelgirl-intro.json | 80 | 1 | 0 | 0 | 79 | 0 |
| src/dialogues/pixelgirl-replay-encore.json | 1 | 0 | 0 | 0 | 1 | 0 |
| src/dialogues/pixelgirl-replay-love.json | 1 | 1 | 0 | 0 | 0 | 0 |
| src/dialogues/pixelgirl-replay-screen.json | 1 | 0 | 0 | 0 | 1 | 0 |
| src/dialogues/pixelgirl-replay-second.json | 3 | 0 | 1 | 0 | 3 | 0 |
| src/dialogues/pixelgirl-replay-sleep.json | 1 | 0 | 0 | 0 | 1 | 0 |
| src/dialogues/pixelgirl-replay-windows.json | 1 | 0 | 0 | 0 | 1 | 0 |
| src/dialogues/pixelgirl-smiley-victory.json | 185 | 4 | 2 | 0 | 181 | 1 |
| src/dialogues/pixelgirl-super-plombier-group.json | 128 | 0 | 0 | 0 | 128 | 0 |
| src/dialogues/pixelgirl-super-plombier-wizz.json | 18 | 0 | 0 | 0 | 18 | 0 |
| src/dialogues/turbo-flashzone-invitation.json | 5 | 0 | 0 | 0 | 5 | 0 |
| src/dialogues/turbo-smiley-catcher.json | 45 | 2 | 0 | 0 | 43 | 0 |
| src/dialogues/turbo-super-plombier.json | 74 | 3 | 1 | 0 | 71 | 0 |
| src/browser/sites/hopla-hotel/conversations.json | 125 | 0 | 0 | 0 | 125 | 0 |
| src/browser/sites/hopla-hotel/data.json | 61 | 0 | 0 | 0 | 61 | 0 |
| src/config/buddy.json | 6 | 0 | 0 | 0 | 6 | 0 |
| src/story/narrative-orchestrator.js | 61 | 9 | 0 | 1 | 51 | 0 |
| src/story/bomb-arena.js | 2 | 0 | 0 | 0 | 2 | 0 |
| src/minigames/bomb-arena/chat-lines.js | 84 | 0 | 0 | 4 | 80 | 0 |
| src/config/popups.js | 109 | 3 | 0 | 0 | 106 | 0 |
| src/browser/sites/forumjeu/data.json | 102 | 0 | 0 | 0 | 102 | 0 |
| src/browser/sites/skypage/data.json | 37 | 0 | 0 | 0 | 37 | 0 |
| src/browser/sites/skypage/secondary-blogs.json | 205 | 0 | 0 | 0 | 205 | 0 |
| src/browser/sites/skypage/forum-blogs.json | 50 | 0 | 0 | 0 | 50 | 0 |
| electron/videotube-catalog.json | 28 | 0 | 0 | 0 | 28 | 0 |
| src/browser/sites/wiki/data.json | 116 | 0 | 0 | 0 | 116 | 0 |
| src/config/filesystem.json | 18 | 0 | 0 | 0 | 18 | 0 |
| src/config/desktop-apps.json | 3 | 0 | 0 | 0 | 3 | 0 |
| src/ui/main-menu.js — statut du joueur | 1 | 1 | 0 | 0 | 0 | 0 |
| src/minigames/smiley-catcher.js — résultat du joueur | 1 | 1 | 0 | 0 | 0 | 0 |
| src/minigames/bomb-arena/view.js — vainqueur humain | 1 | 1 | 0 | 0 | 0 | 0 |

Reproduire le comptage : node scripts/verify-player-text.mjs --inventory. Le script inventorie les données courantes; il ne remplace pas cette relecture contextuelle.

### Sources annexes examinées

Le parcours des textes a suivi src/story/catalog.js, replays.js, optional-conversations.js, connection-messages.js, dialogue-events.js, dialogue.js, conversation-thread.js et progression.js. Leurs adaptateurs ne sont pas comptés une deuxième fois comme des dialogues.

Les textes d'interface ont aussi été examinés dans src/main.js; src/ui/conversation.js, messenger.js, messenger-contacts.js, notifications.js, popup-content.js, buddy.js, desktop.js, main-menu.js, victory.js, game-rules.js, desktop-apps.js, notepad.js, smiley-pack-installer.js et toolbar-installer.js; src/minigames/smiley-catcher.js et bomb-arena/view.js; les interfaces FlashZone index.js, bubble-pop.js, avoid-the-squares.js, pixel-runner.js et super-plombier-flash.js; les rendus Hopla Hotel, SkyPage, ForumJeu, Wiki et VideoTube; les pages d'erreur/recherche et le registre du navigateur. Règles et descriptions de src/config/chart.json, menu.json, contacts.json, connection-messages.json, credits.json, src/minigames/smiley-catcher.json et src/browser/sites/flashzone/catalog.json ont été vérifiées. Les notifications musicales de src/game/music.js sont neutres.

L'ancien fragment de lanceur de src/ui/desktop.js contient « VOUS ÊTES CONNECTÉ » et « Prêt à faire planter l’année 2009 ? ». Le parcours actuel le masque dans les entrées menu/jeu; il n'est pas un écran accessible. Ce fragment dormant n'a pas été réactivé. « Prêt » dans le directeur décrit son état technique; « BombArena.exe · prêt » l'exécutable; « Connecté · Windows Love Messenger » la connexion du client. Le pied du menu « CONNECTÉ À LA BONNE HUMEUR », qui s'adresse au joueur, possède en revanche une variante.

## 4. Formulations grammaticales

Les paires antérieures sont incluses pour vérifier leur cohérence. Chaque localisation représente un seul message/choix, commun aux deux parcours. Les formulations masculines restent identiques à leur résolution avant intervention.

| Source / localisation | Masculin | Féminin |
| --- | --- | --- |
| src/dialogues/pixelgirl-intro.json : nodes.refused.messages.0 | ptdrrr ok monsieur l'antivirus :') | ptdrrr ok madame l'antivirus :') |
| src/dialogues/pixelgirl-replay-love.json : nodes.hello.messages.0 | bon jvais finir par croire que t'es amoureux de ce jeu :') | bon jvais finir par croire que t'es amoureuse de ce jeu :') |
| src/dialogues/pixelgirl-replay-second.json : nodes.hello.messages.2 | t'as décidé de devenir champion du monde de fermeture de fenêtres ou quoi xD | t'as décidé de devenir championne du monde de fermeture de fenêtres ou quoi xD |
| src/dialogues/pixelgirl-smiley-victory.json : nodes.s1-q1-a.messages.1 | monsieur est un professionnel apparemment | madame est une professionnelle apparemment |
| src/dialogues/pixelgirl-smiley-victory.json : nodes.s4.choices.smiley-s4-q1-c | je suis sûr que t'as du Evanescence là-dedans | je suis sûre que t'as du Evanescence là-dedans |
| src/dialogues/pixelgirl-smiley-victory.json : nodes.s5.choices.smiley-s5-q1-b | non je suis nul | non je suis nulle |
| src/dialogues/pixelgirl-smiley-victory.json : nodes.s5-common-1.choices.smiley-s5-q2-a | bah montre quand même, je suis curieux | bah montre quand même, je suis curieuse |
| src/dialogues/pixelgirl-smiley-victory.json : nodes.s6-q1-c.messages.1 | donc t'es un VILAIN | donc t'es une VILAINE |
| src/dialogues/pixelgirl-smiley-victory.json : nodes.s7-common-1.choices.smiley-s7-q2-b | moi aussi je suis content de t'avoir rencontrée | moi aussi je suis contente de t'avoir rencontrée |
| src/dialogues/turbo-smiley-catcher.json : nodes.hobbies-anything-reply.messages.0 | ah ouais le mec il a pas de vie xD | ah ouais la meuf elle a pas de vie xD |
| src/dialogues/turbo-smiley-catcher.json : nodes.pc-parents-right-reply.messages.0 | TRAITRE | TRAITRESSE |
| src/dialogues/turbo-super-plombier.json : nodes.record-reply.messages.0 | ptdrrrr mauvais perdant | ptdrrrr mauvaise perdante |
| src/dialogues/turbo-super-plombier.json : nodes.record-reply.messages.1 | fallait juste etre bon | fallait juste etre bonne |
| src/dialogues/turbo-super-plombier.json : nodes.bad-game-reply.messages.0 | rage pas parce que t'es nul mdr | rage pas parce que t'es nulle mdr |
| src/dialogues/turbo-super-plombier.json : nodes.bug-fraud-reply.messages.0 | jaloux de mon talent | jalouse de mon talent |
| src/story/narrative-orchestrator.js : sequences.0.1.text | t'es nul | t'es nulle |
| src/story/narrative-orchestrator.js : sequences.2.2.text | mais nooon il va revenir :3 | mais nooon elle va revenir :3 |
| src/story/narrative-orchestrator.js : sequences.3.2.text | il est parti se cacher mdr | elle est partie se cacher mdr |
| src/story/narrative-orchestrator.js : sequences.3.3.text | mais arrête de le faire fuir toi xD | mais arrête de la faire fuir toi xD |
| src/story/narrative-orchestrator.js : variants.0.3.text | laisse le tranquille | laisse la tranquille |
| src/story/narrative-orchestrator.js : variants.0.4.text | bah qu'il revienne alors mdr | bah qu'elle revienne alors mdr |
| src/story/narrative-orchestrator.js : variants.2.0.text | il est encore parti ?? | elle est encore partie ?? |
| src/story/narrative-orchestrator.js : variants.2.3.text | il est peut-être occupé | elle est peut-être occupée |
| src/story/narrative-orchestrator.js : variants.4.3.text | tu vas le faire revenir en lui criant dessus ??? | tu vas la faire revenir en lui criant dessus ??? |
| src/config/popups.js : msn.3.messages.1 | j’te vois connecté hein -_- | j’te vois connectée hein -_- |
| src/config/popups.js : msn.6.messages.2 | le téléphone ne marche plus depuis que tu es connecté | le téléphone ne marche plus depuis que tu es connectée |
| src/config/popups.js : ad.0.eyebrow | ★ VOUS ÊTES LE 999 999ᵉ VISITEUR ★ | ★ VOUS ÊTES LA 999 999ᵉ VISITEUSE ★ |
| src/ui/main-menu.js : menu-player-status | ✉ CONNECTÉ À LA BONNE HUMEUR | ✉ CONNECTÉE À LA BONNE HUMEUR |
| src/minigames/smiley-catcher.js : flash-result p | ★★★★★ MEGA CHAMPION ★★★★★ | ★★★★★ MEGA CHAMPIONNE ★★★★★ |
| src/minigames/bomb-arena/view.js : finalOverlayMarkup, vainqueur id justme | PSEUDO CHAMPION ! | PSEUDO CHAMPIONNE ! |

Cinq substitutions de pseudo seul : « QUAND {player.nickname} REVIENT » dans les relances; « rip {player.nickname} », « ça va {player.nickname} ? », « gg {player.nickname} », « GG {player.nickname} :DDD » dans le chat BombArena. Le contexte désigne le participant humain de la partie.

## 5. Référents préservés et ambiguïté

- PixelGirl : « jme suis même pas présentée », « je suis tombée sur un dossier », « jsuis contente que t'aies répondu tout à l'heure :3 ». Ces accords concernent PixelGirl.
- Choix du joueur : « moi aussi je suis content/contente de t'avoir rencontrée ». Seul content/contente concerne le joueur; rencontrée s'accorde avec PixelGirl.
- Groupe : « toi t'es méchant » concerne Turbo; « elle a commencé » PixelGirl; « elle dit rien et elle gagne tranquille » Luna; « turbo il est dégouté » Turbo. Aucun ne varie avec le joueur.
- Les pluriels tous, réunis, OBSEDES, méchants, gentils, couchés et « on est foutus » concernent des groupes mixtes comprenant Turbo et gardent le masculin.
- K7 : « enfin quelqu'un de cultivé » s'accorde avec quelqu'un. Les pronoms de sa scène musicale concernent ensuite Turbo ou le remix.
- « le pain au chocolat des smileys », « une valeur sûre », « une artiste incomprise » (à PixelGirl), « les jeux nuls », « comme un porc » (comparaison idiomatique) et chef (appellatif épicène) ne sont pas féminisés mécaniquement.
- Hopla Hotel : les échanges sont attribués à leurs PNJ. « elle discutait » désigne Cerise. ForumJeu et SkyPage présentent des auteurs qui se répondent; tu/il/elle ne désignent pas implicitement le lecteur humain.
- Le test de blog « QUELLE PRINCESSE ES-TU ? » propose un rôle thématique, sans déclarer l'identité du personnage humain. Les récits de M0RBID (« je suis tombée », « marquée ») restent écrits par M0RBID.
- « j’étais pas prêt » de Turbo et « désolée » de Luna restent fixes. Les anciens badges des vainqueurs PNJ de BombArena sont conservés; la légende de victoire adaptée ne concerne que le vainqueur humain id justme.

**A-001 — ambiguïté éditoriale non modifiée.** Fichier src/dialogues/pixelgirl-smiley-victory.json, dialogue pixelgirl-smiley-victory, nœud s3-q1-b, message 0 : **« oui maman :') »**. Le joueur conseille de ranger les dossiers. Cela peut être une imitation volontaire de la mère de PixelGirl, indépendante du genre du joueur, ou un surnom parental qui appellerait papa/maman. Le contexte ne tranche pas. La réplique est conservée et demande une décision narrative avant toute adaptation. Elle est comptée parmi les textes inchangés.

## 6. Couverture et limites

Aucune source locale identifiée de dialogue scripté n'est restée sans lecture. Le catalogue charge les 15 JSON répertoriés. Buddy, Hopla Hotel, relances JavaScript et chat des mini-jeux sont inventoriés séparément.

Le dépôt ne contient pas de dialogue privé déployé pour Luna ou 0FFLINE : les contacts référencent luna-intro et offline-intro, dont les fichiers sont absents. Luna parle dans le groupe, le jeu et les sites, tous examinés. Aucun dialogue de Raph, aucune scène jouable de la conscience alternative JustMe et aucun texte des deux fins annoncées n'ont été trouvés dans le corpus/graphe actuel. story.json contient quatre séquences du premier acte. Ces contenus futurs ne peuvent être relus avant leur implémentation; aucun remplacement n'a été inventé.

Deux catégories ne peuvent pas être auditées comme des dialogues écrits : les contenus libres créés par le joueur (pseudo, Bloc-notes, chat éventuel) et l'audio/vidéo externe ouvert par VideoTube. Le catalogue local, ses descriptions et commentaires ont été relus; les vidéos externes ne sont pas transcrites ni présentées comme couvertes.

La relecture ne constitue pas une partie humaine exhaustive de toutes les branches. Les tests graphiques utilisent des checkpoints de sauvegarde dans un profil temporaire. Aucune fin inexistante n'est présentée comme jouée.

## 7. Validation et preuves

| Vérification | Résultat |
| --- | --- |
| Tests ciblés identité/dialogues/Messenger/choix/groupe/sauvegardes/réactions/menus | 158 réussis, aucun échec |
| Tests complémentaires chat BombArena et rendu/cycle SmileyCatcher | 13 réussis, aucun échec; recoupent la suite ciblée |
| npm.cmd test | **562 tests : 561 réussis, 0 échec, 1 ignoré** |
| node scripts/verify-player-text.mjs --inventory | 30 sources comptées, variantes complètes; textes JSON et tokens UI contrôlés |
| node scripts/verify-story.mjs | 4 séquences, 15 dialogues, schémas et ressources valides |
| npm.cmd run build -- --configLoader runner | Réussi; avertissement non bloquant de chunk JS de 780,41 kB (229,47 kB gzip) |
| node --check scripts/verify-desktop-ui.mjs | Réussi |
| git diff --check | Réussi |

Le test ignoré concerne les installateurs Electron dans le contexte sandboxé habituel (ACL), et non le test grammatical. Celui-ci a été lancé avec l'autorisation ciblée de processus local et a abouti.

La comparaison avec l'instantané de départ confirme pour les 15 dialogues : mêmes identifiants, révisions, nœuds, transitions, conditions, effets, actions et délais. Les **737 textes explicites** ont une résolution masculine identique; les **deux propositions de fichier sans champ text** sont inchangées. Onze de ces textes ont une nouvelle variante féminine; les quatre paires antérieures sont conservées.

### Electron ciblé

Commande : npm.cmd run verify:player-grammar:visible. Profils : **Alex2009/boy/male**, **Pixe/girl/female**, **PixelFan/neither/female**. Les quatre parcours d'identité, dont neither/male, sont aussi couverts automatiquement, avec reprise avant/après le pronom.

La dernière exécution a **réussi en 15,2 s**, nettoyage terminé à 15,6 s. Pour chaque profil : réplique monsieur/professionnel ou madame/professionnelle, choix curieux/curieuse, message effectivement envoyé, unicité après rechargement, conservation d'identityGender, groupe et « il est parti »/« elle est partie », réplique inchangée concernant Turbo. Aucune exception renderer. Les captures Pixe/choix et PixelFan/groupe ont été ouvertes et inspectées. Aucune dimension de fenêtre n'a été changée.

Deux exécutions ciblées antérieures ont échoué sur le script et ont été analysées avant correction : attente d'un espace artificiel entre deux éléments HTML (15,7 s), puis installation de fixture dans un ancien renderer encore susceptible de sauvegarder (16,9 s). Le script lit maintenant séparément auteur/message et installe les fixtures avec Page.addScriptToEvaluateOnNewDocument avant le démarrage du jeu. Le drapeau sauvegardé du groupe est contrôlé avant ouverture. Aucun retry automatique ni campagne graphique générale. La dernière exécution emploie un seul processus Electron et neuf rechargements renderer explicites; chaque tentative a fermé son processus et supprimé son profil temporaire. Aucune sauvegarde utilisateur utilisée.

Captures conservées dans .qa (private, choices, restored et group pour chaque profil) :

- [Choix masculin Alex2009](.qa/player-grammar-Alex2009-choices.png)
- [Choix féminin Pixe](.qa/player-grammar-Pixe-choices.png)
- [Historique féminin après rechargement](.qa/player-grammar-Pixe-restored.png)
- [Groupe PixelFan, identité neither et grammaire féminine](.qa/player-grammar-PixelFan-group.png)

La validation graphique ne comprend pas une partie manuelle complète des mini-jeux ni une écoute audio. Les libellés de résultats sont contrôlés statiquement et, pour SmileyCatcher, dans le rendu réellement généré par son test de cycle de jeu.

## 8. Fichiers modifiés pendant cette intervention

- Données : src/dialogues/pixelgirl-intro.json, pixelgirl-smiley-victory.json, pixelgirl-replay-love.json, turbo-smiley-catcher.json, turbo-super-plombier.json; src/config/popups.js; src/minigames/bomb-arena/chat-lines.js; relances de src/story/narrative-orchestrator.js.
- Résolution/validation/persistance : src/story/player-identity.js, src/story/dialogue.js; adaptateurs src/ui/popup-content.js et src/minigames/bomb-arena/chat-system.js.
- Libellés/transmission du profil : src/ui/main-menu.js, src/minigames/smiley-catcher.js, src/minigames/bomb-arena/view.js, src/ui/desktop-apps.js, src/main.js.
- Vérifications : scripts/verify-player-text.mjs (nouveau), scripts/verify-story.mjs, scripts/verify-desktop-ui.mjs, package.json; tests/dialogue-gender.test.js (nouveau), tests/main-menu.test.js, tests/super-plombier-narrative.test.js, tests/minigame-replay.test.js, tests/bomb-arena-chat.test.js.
- Documentation : DIALOGUE_GENDER_AUDIT.md.

L'arbre de travail contenait déjà d'autres modifications, notamment la personnalisation précédente et des fichiers BombArena. Elles ont été préservées; la liste ci-dessus décrit le travail de cet audit. Aucun gameplay, dimension de fenêtre, embranchement, scène ou style d'écriture n'a été modifié. A-001 reste la seule décision éditoriale demandée parmi les sources présentes.
