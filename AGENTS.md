# Instructions pour Chaos Survival

## Vérifications proportionnées aux changements

La qualité et la stabilité du jeu restent prioritaires. Adapter les vérifications
à la nature, à la portée et aux risques des modifications, en réutilisant les
tests et les outils existants.

- **Textes, dialogues, noms et paramètres** : privilégier les vérifications
  rapides de syntaxe, de schéma, de références et les tests concernés, sans
  lancer systématiquement le jeu. Si un paramètre influence le gameplay,
  vérifier aussi son effet avec les simulations ou tests ciblés disponibles.
- **Logique de sauvegarde, événements narratifs et gameplay** : privilégier
  les tests automatisés ciblés couvrant le comportement modifié et les risques
  de régression. Vérifier notamment la persistance, les transitions et les
  interactions concernées lorsque c'est pertinent.
- **Interface et interactions importantes** : effectuer des vérifications
  visuelles ou interactives lorsqu'elles apportent une assurance nécessaire,
  notamment pour les fenêtres, Messenger, le bureau, les placements et les
  interactions. Ne pas éviter une vérification visuelle importante au risque
  de laisser une régression.
- **Compilation** : privilégier une compilation rapide lorsqu'elle suffit à
  vérifier les imports, les ressources ou l'intégration des modifications.
- **Electron et portable Windows** : ne pas lancer systématiquement le jeu ni
  générer systématiquement un exécutable. Réserver ces vérifications aux
  changements qui affectent réellement Electron, le packaging, le chargement
  des ressources en production ou un comportement nécessitant l'application
  réelle, ainsi qu'aux demandes explicites de validation ou de génération.
- **Éviter les répétitions** : après des vérifications réussies, ne pas les
  répéter sans changement pertinent, échec ou doute non résolu. Élargir la
  couverture uniquement lorsque la portée ou les résultats le justifient.
- **Documentation seule** : vérifier le contenu et le diff ; ne pas lancer le
  jeu, compiler ou produire un portable pour une modification purement
  documentaire.

Choisir les vérifications suffisantes les plus rapides. Dans le compte rendu,
indiquer les vérifications réellement effectuées et les limites importantes,
sans présenter comme testé un comportement qui ne l'a pas été.

## Interfaces des raccourcis de développement

- Un mini-jeu peut exposer `finishForDevelopment()` sur son instance ou sa vue
  lorsqu'une fin valide exige une simulation spécifique. Cette méthode doit
  utiliser le parcours normal des résultats, émettre les événements habituels,
  être idempotente et retourner `false` si le jeu n'est pas actif.
- Si aucune simulation particulière n'est nécessaire, un `finish()` idempotent
  peut servir d'interface commune. Enregistrer le contenu auprès du gestionnaire
  de fenêtres afin que Ctrl+Maj+D ne cible que la fenêtre active.
- Les pages de mini-jeu du navigateur exposent cette capacité sur la racine de
  la page active. Ne pas ajouter de liste de noms de jeux dans le raccourci.
- Les conversations utilisent `ConversationWindow.finishImmediately()` et le
  moteur de dialogues partagé pour enregistrer messages, choix, transferts et
  événements. Ne pas ajouter de logique propre à un personnage.
- Ces interfaces et leur enregistrement doivent être réservés à
  `import.meta.env.DEV` et ne doivent pas modifier la progression normale.
