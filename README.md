# Chaos Survival

Jeu Windows autonome avec Electron. Le gameplay, l'interface et le moteur audio
du projet Vite sont conservés.

## Développement

Avec Node.js 22.12+ (ou 24 LTS) et npm :

```powershell
npm install
npm run dev
```

Le jeu s'ouvre dans sa propre fenêtre Electron. Vite tourne uniquement pendant
le développement et recharge les modifications automatiquement. Fermer la fenêtre
arrête aussi Vite. F12 ouvre les outils de développement.

Le projet possède aussi un lanceur pour le Node local dans `.tools` :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev.ps1 -Task dev
```

`START-GAME.cmd` utilise ce même lanceur pour ouvrir le jeu en développement.

## Exécutable Windows portable

Sur Windows :

```powershell
npm run dist
```

Ou avec le Node local :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev.ps1 -Task dist
```

Le fichier à distribuer est **`release/ChaosSurvival.exe`** (Windows x64).
Il contient Electron, le jeu, `musiclvl1.mp3` et toutes les ressources. Le joueur
double-clique sur cet unique fichier ; aucune installation de Node.js, aucun
navigateur externe et aucun serveur ne sont nécessaires. Le lanceur portable
extrait son contenu dans le dossier temporaire Windows au démarrage.

Envoie uniquement `release/ChaosSurvival.exe` à ton ami. Il peut le placer dans
n'importe quel dossier de son ordinateur Windows 64 bits et le lancer directement.
Le dossier du projet, `assets/`, `dist/` et `node_modules/` ne sont pas nécessaires.

Les fichiers intermédiaires sont générés dans `.tools/msn-portable-build/`, puis toutes
les ressources sont vérifiées avant de copier le portable final dans `release/`.
Un ancien dossier `release/win-unpacked/` n'est pas nécessaire pour jouer avec le
portable et ne doit pas être envoyé. Les premiers builds nécessitent Internet
pour télécharger Electron et les outils d'electron-builder ; jouer est hors ligne.

Pour tester le chargement de production avant de générer l'exécutable :

```powershell
npm run build
npm start
```

Vite utilise des chemins relatifs. Electron charge `dist/` dans l'archive ASAR via
le protocole local `chaos://game/`, y compris le chargement Web Audio de la musique.
Aucun serveur HTTP n'est lancé en production. Les records sont conservés dans
les données utilisateur de l'application Windows. Les accès HTTP, HTTPS et
WebSocket sont bloqués dans la version empaquetée. Chaque lancement utilise une
extraction temporaire distincte, nettoyée à la fermeture, sans installation ni
demande de droits administrateur.

## Commandes du jeu

Le menu principal affiche **PLAY** au premier lancement, puis **CONTINUE** et
**NEW GAME** lorsqu'une partie a commencé. CONTINUE reprend le dernier point de
sauvegarde ; un niveau ou mini-jeu inachevé recommence au début de cette séquence.
NEW GAME demande confirmation et efface intégralement la partie précédente,
ses archives, ses modifications, ses records et ses personnalisations.
**OPTIONS** conserve les volumes musique/bruitages et le plein écran entre les
sessions. **Démarrer → Menu principal** permet de revenir au menu depuis le jeu ou le bureau.
Voir [le fonctionnement des sauvegardes](docs/saves-and-menu.md).

Sur le bureau XP, double-clique sur **ChaosSurvival.exe** (ou appuie sur Entrée après
l'avoir sélectionné) pour jouer ou rejouer le niveau 1. La musique, le score,
les fenêtres et le chaos repartent de zéro. La progression narrative reste
intacte ; une victoire en replay ne déclenche pas une nouvelle rencontre MSN.

**Démarrer → Windows Love Messenger** ouvre l'application ou remet sa fenêtre au
premier plan. **Réduire** conserve son bouton dans la barre des tâches ; **Fermer**
retire la fenêtre et son bouton, sans effacer la conversation. Avant la première
rencontre, Messenger affiche une liste de contacts vide. Pendant un niveau,
l'ouverture de Messenger met le jeu en pause ; sa fermeture ou sa réduction
permet de retrouver la boîte de reprise du niveau.

- F11 ou Alt+Entrée : entrer / sortir du plein écran.
- Échap : pause / reprise.
- F3 ou bouton ♫ du bandeau : afficher le debug musical et régler le décalage.
- Croix rouge : fermer une fenêtre du jeu.
- Croix en haut à droite du menu principal : masquer le menu. « Démarrer → Chaos Survival » le rouvre.
- Alt+F4 : quitter l'application.

Les conversations MSN, erreurs, publicités, alertes antivirus et faux téléchargements
varient à chaque partie. Leur contenu se modifie dans `src/config/popups.js` ;
leurs introductions et leur cadence sont réglées dans `src/config/chart.json` avec les types `msn`,
`error`, `ad`, `virus` et `download`. Fermer une alerte ou annuler un transfert
rapporte les mêmes points que fermer une fenêtre avec sa croix.

## Conversations MSN et mini-jeu

Les messages de Messenger arrivent automatiquement, sans bouton de pause.
Les réponses narratives attendent la fin de la séquence et s'affichent uniquement
en bas, une question à la fois. Les replays du niveau 1 ne proposent aucune réponse.
« Mes contacts » affiche une liste MSN avec des
groupes repliables et des amis décoratifs hors ligne. PixelGirl apparaît seulement
après son déblocage narratif.

Double-cliquez sur **Poste de travail**, **Mes documents** ou **Corbeille** pour
ouvrir leur fenêtre. Le menu Démarrer propose aussi ces applications. Réduire
conserve leur bouton dans la barre des tâches ; fermer le retire. La corbeille
est vide. Les contenus fictifs se configurent dans `src/config/desktop-apps.json`.
`npm run verify:desktop` effectue une vérification ciblée de ces interfaces dans
Electron avec un profil isolé, après `npm run build`, sans produire de portable.

Pour le parcours réel du bureau et de Poste de travail dans Chromium, lancer
`npm run verify:desktop:browser` après le build. Chrome est cherché avant Edge ;
`CHAOS_CHROMIUM_PATH` permet d'indiquer un autre exécutable Chromium. Le profil
isolé est créé dans le dossier temporaire Windows puis supprimé. Le parcours
vérifie les icônes système, la réduction/restauration par la barre des tâches,
le menu contextuel et la fermeture propre de l'explorateur. Si le navigateur
headless est bloqué par une politique GPU/sandbox de l'environnement, exécuter
la même commande depuis une session Windows autorisée avec Chrome ou Edge ; les
scripts ne changent ni les ACL ni les paramètres de sécurité.

Les disques du Poste de travail utilisent l'arborescence fictive de
`src/config/filesystem.json`. Les boutons **Précédente**, **Remonter** et
**Poste de travail** naviguent entre les dossiers ; le chemin courant reste
affiché. Les `.txt` s'ouvrent dans un Bloc-notes en lecture seule et les `.jpg`
dans une visionneuse avec image ajustée sans déformation. Chaque fichier a sa
fenêtre et son bouton dans la barre des tâches ; l'explorateur reste ouvert.
Le lecteur CD vide demande un disque.
Cette navigation n'accède jamais aux fichiers réels de l'ordinateur.

Après une victoire, les résultats restent affichés jusqu'au clic sur
**Retour au bureau** ou sur leur croix. Ils sont sauvegardés en attente et
réapparaissent avec CONTINUE après un redémarrage. La première connexion de
PixelGirl attend ce retour au bureau ; les victoires en replay ne la rejouent pas.

Le scénario de PixelGirl, ses quatre choix, l'anomalie de 500 ms et le transfert
de SUPER_MEGA_GAME.exe sont intégrés. Les choix attendent une action du joueur
et toutes les alternatives sont sauvegardées. Le fichier fictif ouvre Smiley
Catcher 2009, un mini-jeu de 30 secondes dans une fenêtre XP.

Voir [le guide des dialogues MSN](docs/MSN-dialogues.md) pour écrire des
conversations JSON, des transferts, des conditions sur les réponses non choisies
et remplacer le mini-jeu. Le premier niveau musical est conservé.

## Synchronisation musicale du niveau 1

Le MP3 a été analysé directement avec librosa : durée **86,49 s**, **256 pulsations**,
tempo estimé **185,75 BPM** (environ 186 ; une lecture à moitié vitesse est aussi
possible). La première attaque retenue se situe à **0,02993 s**. Le fichier
`src/config/music-lvl1.analysis.json` contient les timestamps individuels, les
tempos locaux, l'intensité, les candidats de kicks, les accents et les sections
estimées. La résolution de l'analyse est d'environ 10 ms. Les noms intro / montée /
drop / break sont des estimations acoustiques, ajustables dans ce JSON.

L'analyse compare plusieurs tempos candidats avant le suivi des pulsations avec
un tempo local variable, puis aligne les détections sur les attaques du signal.
Cela évite de retenir automatiquement le candidat à 125 BPM, moins cohérent sur
ce morceau. Le BPM affiché sert d'information ; les événements ne sont jamais
programmés à partir d'une grille constante. Le suivi utilise les possibilités de
[tempo variable de librosa](https://librosa.org/doc/0.11.0/generated/librosa.beat.beat_track.html).

Le niveau 1, de difficulté **Medium**, commence avec une conversation MSN toutes les 4 pulsations. Erreurs,
publicités, téléchargements et antivirus arrivent progressivement. La cadence
passe à 2 pulsations selon l'énergie réelle du morceau et revient à 4
pendant les breaks. Les attaques détectées sur les contretemps déclenchent des
effets décoratifs, sans ajouter de fenêtres. Les fins de montée et les courtes
rafales des drops proposent une fenêtre par pulsation, sous réserve de la charge du joueur.

Quatre fenêtres au maximum restent ouvertes. Le directeur adapte l'espacement
au temps de fermeture du joueur, à l'encombrement et au chaos. Une occasion
supprimée n'est jamais remise en file ni pénalisée. Les croix restent accessibles
grâce au placement décalé des barres de titre, y compris après redimensionnement.
Les fenêtres n'ont pas de délai individuel de fermeture ; la jauge conserve sa
pression. L'adaptation reste bornée : elle ne transforme pas une accumulation
de fenêtres en niveau facile. Les simulations montrent qu'un clic toutes les
0,8 à 1 seconde permet de réussir, tandis qu'un clic toutes les 1,5 seconde
entraîne une défaite. La musique et son analyse conservent leur vitesse et leurs timestamps.

La lecture Web Audio fournit l'unique horloge musicale. `requestAnimationFrame`
consulte cette horloge ; les apparitions et les durées de notifications / wizz
ne dépendent pas de minuteurs accumulés. Après un blocage du rendu, les événements
anciens sont consommés sans rafale de rattrapage. Pause, reprise et redémarrage
suspendent ou réinitialisent la lecture, les événements et le directeur.

Le panneau F3 affiche le BPM global/local, le temps audio/musical, les pulsations
avec leurs timestamps, l'intensité, la section, les prochaines fenêtres possibles,
les suppressions adaptatives et le retard de rendu mesuré. Le décalage manuel va
de −500 à +500 ms, se mémorise pour ce MP3 et peut être réinitialisé. Une valeur
positive retarde les apparitions ; la recalibration ne rejoue aucun événement
déjà consommé. Ce panneau est disponible aussi dans l'EXE.

Pour analyser un nouveau MP3 (outil de développement facultatif, Python 3.14) :

```powershell
python -m venv .tools/audio-analysis
.\.tools\audio-analysis\Scripts\python.exe -m pip install -r scripts/audio-analysis-requirements.txt
.\.tools\audio-analysis\Scripts\python.exe scripts/analyze-music.py
```

Le script produit le JSON et une figure `.qa/music-lvl1-analysis.png`. Mettre à
jour la durée du niveau dans `chart.json` si le morceau change. `npm run build`
vérifie le SHA-256 du MP3 et refuse une analyse périmée. Python et librosa ne
sont **jamais requis par le joueur** : le JSON est intégré au JavaScript de
production et le MP3 à l'archive portable.

## Vérification

```powershell
npm test
npm run format:check
npm run verify:package
npm run verify:portable
npm run verify:portable -- --music
npm run verify:portable -- --story
```

`npm run format` remet en forme les sources avec Prettier. Le HTML du bureau et
les références aux éléments de l'interface sont regroupés dans `src/ui/desktop.js` ;
`src/main.js` orchestre la partie, le son et les interactions.

`verify:package` compare par SHA-256 chaque fichier de `dist/` et d'Electron avec
l'archive du build, ainsi que le MP3 original et les images de `public/`.

`verify:portable` est un test Windows : il copie **uniquement l'EXE** dans un
dossier temporaire extérieur au projet, contenant des espaces et des accents.
Il retire Node.js du PATH du jeu, utilise un profil isolé et vérifie le contenu
de l'archive réellement extraite par le portable, le chargement local de chaque
ressource, le blocage réseau, la musique, la pause/reprise et le score. Le test
ferme ensuite sa propre fenêtre et supprime ses fichiers temporaires.

L'option `--music` teste aussi le panneau F3, le décalage, le redémarrage, les
trois croix à 800 × 600 et une partie complète à un clic toutes les 0,8 seconde,
avec un blocage volontaire du rendu de 1,2 seconde. Compter environ deux minutes.
Le diagnostic maintient sa page de test visible pour éviter qu'un changement
de fenêtre sur le bureau ne déclenche la pause automatique pendant les mesures.

L'option `--story` inclut le test musical complet, puis vérifie la victoire, la
notification, les messages automatiques, les quatre choix, les propositions sauvegardées,
l'anomalie de 500 ms, la reprise, le refus puis l'acceptation du fichier et le
mini-jeu de 30 secondes. Compter environ quatre minutes. Les captures sont
enregistrées dans `.qa/victory.png`, `.qa/pixelgirl-conversation.png`,
`.qa/pixelgirl-small.png` et `.qa/smiley-catcher.png`.

Le rapport est enregistré dans `.qa/portable-verification.json` et une capture
dans `.qa/portable-verification.png`. Node.js est utilisé uniquement par l'outil
de vérification, jamais requis par le joueur.

Les noms et logos des logiciels fictifs sont centralisés dans `src/config/identity.json`. Voir [l’identité visuelle](docs/visual-identity.md).
