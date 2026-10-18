# Windows Media Play

La bibliothèque virtuelle de `Ma musique` contient les pistes configurées dans
`src/config/media-library.json`. Les associations vers les fichiers locaux sont
dans `src/config/media-library-assets.js`, sous forme de références `new URL`
traitées par Vite pour le développement et le build Electron.

| Fichier virtuel | Artiste | Ressource du projet |
| --- | --- | --- |
| `Sport Dubstep.mp3` | Kulakovka | `assets/kulakovka-sport-dubstep-283969.mp3` |
| `I Love Chiptune Punk.mp3` | Brutaldesign | `assets/brutaldesign-i-love-chiptune-punk-506083.mp3` |
| `Lost In Time-Nightcore.mp3` | NightcoreFreeMusic4u | `assets/nightcorefreemusic4u-lost-in-time-nightcore-310196.mp3` |

Les tailles des fichiers virtuels correspondent aux ressources présentes dans
`assets/`. Les durées sont lues depuis les métadonnées audio par le lecteur ;
elles ne sont pas codées dans le catalogue. Les anciennes entrées fictives
`Pixel Dreams.mp3`, `CyberLove.mp3`, `Midnight.exe.mp3` et `Summer 2009.mp3`
sont retirées lors de la normalisation ciblée des anciennes sauvegardes.
