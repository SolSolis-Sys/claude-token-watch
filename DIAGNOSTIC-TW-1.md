# DIAGNOSTIC-TW-1 — claude-token-watch : état cassé (contre-épreuve G1)

Document de diagnostic du lot TW-1. Il **fige l'état cassé** (contre-épreuve G1) avant toute
réparation. L'**état réparé — contre-épreuves** est en **§8**, la liste de ce qui reste à valider
hors dépôt en **§9**, et les réserves du lot en **§10**.

> **Portée et date des mesures.** Ce document a été rédigé sur `HEAD = 6c866e95…` (v0.3.6), l'état
> **cassé**. Tout ce qui est mesuré en §0 à §7 est daté de cette session, sur cet arbre. Les
> contre-épreuves de §8 ont été **rejouées le 2026-09-24 à partir de 16:08Z sur l'arbre de travail
> corrigé** (HEAD inchangé + les modifications non commitées du lot), et non sur HEAD : c'est
> l'arbre qui part en PR. Les empreintes des fichiers mesurés sont en §8.0.

Aucune modification n'a été faite dans `~/.claude/` (lecture seule, cf. §7). Seuls
`DIAGNOSTIC-TW-1.md` et les journaux bruts sous `.agent-teams/TW-1/` ont été écrits.

> **Clôture (t10, puis t28).** L'arbre corrigé est publié sur la branche `fix/tw-1-hooks-statusline`
> (commits dont l'oid distant est identique à l'oid local, §10.5), avec une **PR draft** vers `main` :
> <https://github.com/SolSolis-Sys/claude-token-watch/pull/11>. La PR n'est **pas** fusionnée et le
> plugin n'est ni installé ni réinstallé.
>
> **Verdicts des revues adverses du lot.** Tour 3 (**t25**, bornée aux deux corrections BOM) :
> `needs_revision` (**failed**) — le finding **F1 (high)** établit que la perte silencieuse de
> réglages subsistait : le CLI réécrivait un `config.json` qu'il n'avait pas su lire (§4.5). Tour 4
> (**t27**, bornée à la réparation t26) : **`pass`**. La correction n'est donc arrivée sur la branche
> qu'**après** ce refus, dans un commit de suivi. Deux qualifications documentaires du CLI demandées
> par la revue `pass` (findings F1/F2/F3 : `get` refuse un fichier illisible, `reset` le supprime
> sans le lire) portent sur `README.md` et le CHANGELOG, hors périmètre de ce commit.

> **Correction de sincérité (t11, 3 points).** (1) Les preuves P1/P2/P3 étaient présentées comme
> la démonstration de la cause de la mutité : ce sont des **rejeux manuels** de la chaîne de
> commande ; leur provenance exacte est maintenant donnée (§2.2.1). (2) La cause (2) est
> **requalifiée** de « cause confirmée » en « fragilité prouvée, dépendante du shell », et la
> mutité résiduelle est portée par **H9** comme hypothèse principale (§2.9) : la documentation
> officielle dit que Claude Code substitue lui-même le placeholder dans les commandes de hook
> (citations verbatim §2.2.2). (3) L'affirmation « PowerShell expanse `${VAR}` donc la commande
> fonctionne » est **réfutée par la mesure** (§2.2.1, S1/S2). Tout le reste du diagnostic est
> inchangé, y compris ce qui est prouvé : preuve temporelle (§2.3), H8 réfutée (§2.7), H3/H7
> écartées (§2.5/§2.8), H4 aggravante (§2.4), H6 réfutée et seuil 5h dédié manquant (§3).

---

## 0. État figé, environnement, méthode

| Élément | Valeur |
|---|---|
| Référence figée | `git rev-parse HEAD` = `6c866e9506ba4c9fa8f01a6388e059f5a42e74b4` (« fix: rafraichir le cache usage avant lecture au Stop (v0.3.6) ») |
| Version | `.claude-plugin/plugin.json:3` = `0.3.6`, `package.json:3` = `0.3.6` |
| Node | `node --version` → `v22.23.2` |
| Claude Code | `claude --version` → `2.1.281 (Claude Code)` ; binaire `C:\Users\carma\.local\bin\claude.exe` (240 767 648 o, mtime 2026-09-23T17:58:40Z) |
| Plugin installé | `token-watch@token-watch` scope `user`, `installPath` = `~/.claude/plugins/cache/token-watch/token-watch/0.3.6`, `gitCommitSha` = `6c866e9506ba4c9fa8f01a6388e059f5a42e74b4` (donc **l'installé == HEAD cassé**) |
| Marketplace | clone `~/.claude/plugins/marketplaces/token-watch`, `git log -1` = `6c866e9` |
| Session CC en cours | démarrée à `2026-09-24T13:05:31Z` (nom des journaux MCP `mcp-logs-*.jsonl` sous `%LOCALAPPDATA%\claude-cli-nodejs\Cache\D--SolSolis-zether\`), toujours active à `2026-09-24T15:00:38Z` (transcript `bdc6f139-…` , 4 529 852 o) |

Preuve que le code installé est bien l'état cassé (aucun résidu de version antérieure) :

```
PS> (Get-Content "$cp\hooks\hooks.json") | Select-String -Pattern 'command'
9:  "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/loop-advisor.js\""
20: "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/metrics-writer.js\""
31: "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/context-guard.js\""
40: "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/metrics-writer.js\""
49: "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/loop-advisor.js\""
60: "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-logger.js\""
PS> (Get-Content "$cp\.claude-plugin\plugin.json") | Select-String -Pattern 'statusLine'
13: "statusLine": {
15: "command": "node \"${CLAUDE_PLUGIN_ROOT}/statusline/statusline.js\""
```

Les mêmes chaînes sont présentes dans le clone marketplace (lignes 9 et 13-15) et dans le
HEAD du dépôt (`git show HEAD:hooks/hooks.json`, `git show HEAD:.claude-plugin/plugin.json`).
**Les trois copies (dépôt HEAD / clone marketplace / cache installé) sont identiques** —
le symptôme n'est donc pas une divergence de copie.

> Écart à noter : pendant ce diagnostic, une autre tâche du lot a modifié l'arbre de travail
> (`git status --short` → `M .claude-plugin/plugin.json`, `M hooks/hooks.json`, `M package.json`,
> `M test/hooks-config.test.js`). Le présent document décrit **HEAD = 6c866e9**, pas l'arbre
> modifié. T-wrap devra rejouer la contre-épreuve sur l'état réparé.

Journaux bruts : `.agent-teams/TW-1/probes.log` (P1/P2/P3, rejeux manuels — provenance §2.2.1),
`.agent-teams/TW-1/provenance-shell.log` (S1-S3, passe t11 : ce que chaque shell fait du
placeholder), `.agent-teams/TW-1/scan-claude-bundle.js`, `.agent-teams/TW-1/payload-statusline.json`,
`.agent-teams/TW-1/fakehome/`.

---

## 1. Symptôme 1 — statusline non affichée

### 1.1 Constat

`~/.claude/settings.json` contient (extrait verbatim) :

```json
"statusLine": {
  "type": "command",
  "command": "node \"C:\\Users\\carma\\.claude\\plugins\\marketplaces\\token-watch\\statusline\\statusline.js\""
}
```

Ce chemin existe et est identique au HEAD :

```
PS> Test-Path "$mp\statusline\statusline.js"      → True
PS> (Get-FileHash repo\statusline\statusline.js).Hash = BC486097435D...   (== clone == cache)
```

### 1.2 Cause A (confirmée) — `statusLine` n'est pas un composant de plugin

`.claude-plugin/plugin.json:13-16` (HEAD) déclare `statusLine` **dans le manifeste du plugin**.
Ce champ n'est pas un composant supporté :

```
$ claude plugin details token-watch@token-watch
token-watch 0.3.6
  ...
Component inventory
  Skills (1)  token-report
  Agents (0)
  Hooks (4)  UserPromptSubmit, PostToolUse, Stop, SessionEnd  (harness-only — no model context cost)
  MCP servers (0)
  LSP servers (0)
```

Aucun `statusLine` dans l'inventaire, alors que les hooks du même manifeste sont bien listés :
le champ est purement ignoré. Confirmation interne dans le binaire 2.1.281 (chaîne de
validation « …is not a shipped file, a declared binaries entry… », et messages du validateur
plugin listés sur `hooks` mais jamais sur `statusLine`).

**Conséquence :** un utilisateur qui installe le plugin n'obtient **aucune** statusline ; la
seule raison pour laquelle une statusline existe ici est l'ajout manuel dans
`~/.claude/settings.json` (hors dépôt, donc non versionné, non reproductible).

### 1.3 Cause B (retenue, côté Claude Code) — la commande ne rend pas

L'artefact n'est pas en cause : la commande exacte de `settings.json`, sur un payload réel,
fonctionne et rend une ligne complète :

```
PS> '{"model":{"id":"claude-opus-5-5"},"cost":{"total_cost_usd":0.42}}' | cmd.exe /c 'node "C:\Users\carma\.claude\plugins\marketplaces\token-watch\statusline\statusline.js"'
◈ opus 5 5 · 1M  ·  $0.42  ·  5h ▕░░░░░▏ 1%  ·  7d ▕██░░░▏ 39%
exit=0
```

Et sur un `HOME` isolé avec le cache réel (0,98) + transcript factice :

```
PS> $env:USERPROFILE="....agent-teams\TW-1\fakehome"; '{"session_id":"probe-tw-1",...}' | node statusline/statusline.js
◈ Opus 5.5 · 1M  ·  ▕█░░░░░░░░░▏ 13% ctx 132k/1.0M  ·  $0.42  ·  cache ▕██████▏ 4:55  ·  5h ▕█████▏ 98%  ·  7d ▕██░░░▏ 38%
exit=0   (elapsed 0.29 s)
```

Donc : script sain, chemin valide, mais rien à l'écran. Le défaut est dans le couple
Claude Code 2.1.281 / Windows :

- [anthropics/claude-code#52997](https://github.com/anthropics/claude-code/issues/52997) — statusLine regression v2.1.119, commande non exécutée sous Windows ;
- [anthropics/claude-code#57940](https://github.com/anthropics/claude-code/issues/57940) — statusLine « runs but line never renders in UI » sous Windows ;
- [jarrodwatts/claude-hud#521](https://github.com/jarrodwatts/claude-hud/issues/521) — statusLine cassée après le passage du shell par défaut à PowerShell 7 en 2.1.x ;
- [docs Claude Code — Hooks reference](https://code.claude.com/docs/en/hooks) — « exec form » quand `args` est fourni, « shell form » sinon.

**Hypothèse H2 : retenue**, corroborée en externe, non reproduite localement (aucun accès à
l'UI TUI de Claude Code depuis cette session ; cf. §6 limites).

### 1.4 Hypothèse H7 — écartée

- Un seul manifeste de plugin installé déclare `statusLine` :
  `~/.claude/plugins/cache/token-watch/token-watch/0.3.6/.claude-plugin/plugin.json`
  (balayage de tous les `plugin.json` sous `~/.claude/plugins/cache`) → aucun autre plugin
  branché sur la même fonctionnalité.
- Aucun `settings.json` / `settings.local.json` de projet ou local ne redéfinit `statusLine` :
  `D:\SolSolis\.claude\settings.json`, `D:\SolSolis\.claude\settings.local.json`,
  `D:\SolSolis\claude-token-watch\.claude\settings.json`,
  `D:\SolSolis\claude-token-watch\.claude\settings.local.json` → tous `False`.
- Pas de `disableAllHooks` ni d'équivalent dans `~/.claude/settings.json`.

---

## 2. Symptôme 2 — hooks muets (`metrics.json` figé)

### 2.1 Les hooks sont bien enregistrés

`claude plugin details token-watch@token-watch` → `Hooks (4) UserPromptSubmit, PostToolUse, Stop, SessionEnd`.
Le problème est donc le **déclenchement**, pas l'enregistrement.

### 2.2 Ce qui est prouvé : la forme `${CLAUDE_PLUGIN_ROOT}` est **fragile et dépendante du shell**, avec un échec totalement silencieux — ce n'est **pas** la cause démontrée de la mutité

> **Requalification (correction de sincérité, t11).** Cette section s'intitulait « Cause
> (confirmée par le mécanisme) ». C'est faux au sens strict : les preuves P1/P2/P3 sont des
> **rejeux manuels** de la chaîne de commande (§2.2.1), pas des observations de Claude Code
> lançant ses hooks. Elles démontrent la **fragilité** de la forme et le **caractère totalement
> silencieux** de son échec — pas que cette forme est la cause de la mutité observée. La
> documentation officielle indique que Claude Code substitue lui-même le placeholder dans les
> commandes de hook (§2.2.2). La mutité résiduelle est donc portée par **H9** (§2.9) comme
> hypothèse principale. Le reste de t1 (H8 réfutée, H3/H7 écartées, H4 aggravante, H6 réfutée,
> seuil 5h dédié manquant) n'est pas affaibli.

Les 6 commandes de hook de HEAD reposent sur la substitution textuelle du placeholder
(`git show HEAD:hooks/hooks.json`) :

```
9:  "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/loop-advisor.js\""
20: "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/metrics-writer.js\""
31: "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/context-guard.js\""
40: "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/metrics-writer.js\""
49: "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/loop-advisor.js\""
60: "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-logger.js\""
```

Ces 6 chaînes sont **textuelles** : elles ne référencent aucune variable d'environnement du
processus, seulement le placeholder. La mesure locale montre que **tout dépend de qui expanse ce
placeholder avant que `node` ne le reçoive**, et qu'en cas d'échec le symptôme est **totalement
silencieux** depuis Claude Code : stdout vide, exit 1, aucune erreur remontée (stderr seulement).
Journaux bruts : `.agent-teams/TW-1/probes.log` (P1/P2/P3, t1) et
`.agent-teams/TW-1/provenance-shell.log` (S1-S3, passe t11) :

```
### P1 (forme HEAD, rejeu manuel, cmd.exe, placeholder laissé littéral)
cmd: cmd.exe /c 'node "${CLAUDE_PLUGIN_ROOT}/hooks/metrics-writer.js"'   (cwd=D:\SolSolis\claude-token-watch)
Error: Cannot find module 'D:\SolSolis\claude-token-watch\${CLAUDE_PLUGIN_ROOT}\hooks\metrics-writer.js'
code: 'MODULE_NOT_FOUND'     stdout vide     exit=1

### P2 (racine mutilée à la main, antislashs perdus)
cmd: cmd.exe /c 'node "C:Userscarmaclaudepluginsmarketplacesstatusline/statusline.js"'
Error: Cannot find module 'C:\Userscarmaclaudepluginsmarketplacesstatusline\statusline.js'
code: 'MODULE_NOT_FOUND'     stdout vide     exit=1
```

### 2.2.1 Provenance exacte de P1, P2, P3 — **rejeux manuels**, pas des observations de Claude Code

**Les trois preuves sont des rejeux manuels.** Aucune n'a été observée telle qu'émise par Claude
Code : il n'existe aucun journal de hooks dans cette installation (§2.9 : aucun `debug`, aucun
`hookErrors` dans les transcripts). Commandes exactes, telles qu'exécutées (PowerShell 5.1 →
`cmd.exe`, verbatim dans `probes.log`) :

| Preuve | Commande réellement lancée | Provenance de la chaîne | Sortie citée |
|---|---|---|---|
| **P1** | `cmd.exe /c 'node "${CLAUDE_PLUGIN_ROOT}/hooks/metrics-writer.js"'` (cwd = dépôt) | **relevée verbatim dans `hooks/hooks.json`** (forme HEAD, ligne 20) puis rejouée telle quelle ; `CLAUDE_PLUGIN_ROOT` n'était pas posé dans le processus de rejeu — et le rejeu S3 (t11) montre que le résultat est **identique avec** la variable posée, `cmd.exe` ne connaissant pas la syntaxe `${VAR}` (il utilise `%VAR%`) | `Cannot find module '…\${CLAUDE_PLUGIN_ROOT}\hooks\metrics-writer.js'`, stdout vide, exit 1 |
| **P2** | `cmd.exe /c 'node "C:Userscarmaclaudepluginsmarketplacesstatusline/statusline.js"'` | racine **mutilée à la main** (antislashs retirés) pour simuler le bug #24007 ; chaîne jamais observée en vrai | `Cannot find module 'C:\Userscarmaclaudepluginsmarketplacesstatusline\statusline.js'`, stdout vide, exit 1 |
| **P3** | `cmd.exe /c 'node "C:\Users\carma\.claude\plugins\marketplaces\token-watch\statusline\statusline.js"'` | **relevée verbatim dans `~/.claude/settings.json`** (commande `statusLine`, chemin absolu littéral) puis rejouée | `◈ opus 5 5 · 1M · $0.42 · 5h ▕░░░░░▏ 1% · 7d ▕██░░░▏ 39%`, exit 0 |

Ce que le rejeu **S1-S3** de t11 (`.agent-teams/TW-1/provenance-shell.log`, PowerShell
`5.1.26100.9444`) ajoute, sur la **même** chaîne P1 :

```
S1  PowerShell : "${CLAUDE_PLUGIN_ROOT}/hooks/metrics-writer.js"  ->  /hooks/metrics-writer.js
    (${CLAUDE_PLUGIN_ROOT} n'est PAS la syntaxe d'une variable d'environnement en PowerShell :
     il faut $env:CLAUDE_PLUGIN_ROOT ; le placeholder s'expanse donc à VIDE)
S2  & node "${CLAUDE_PLUGIN_ROOT}/hooks/metrics-writer.js"  ->  Cannot find module 'D:\hooks\metrics-writer.js'  exit=1
S3  cmd.exe /c 'node "${CLAUDE_PLUGIN_ROOT}/hooks/metrics-writer.js"'  ->  Cannot find module
    'D:\SolSolis\claude-token-watch\${CLAUDE_PLUGIN_ROOT}\hooks\metrics-writer.js'  exit=1
```

**Conséquence de provenance :** ni `cmd.exe`, ni PowerShell 5.1 n'expanse `${CLAUDE_PLUGIN_ROOT}`.
P1/P2/P3 prouvent donc le **comportement d'un shell qui n'expanse pas** (fragilité + silence), et
**pas** ce que fait Claude Code, qui substitue lui-même le chemin avant d'invoquer la commande
(§2.2.2). L'énoncé inverse — « PowerShell 7 expanse `${VAR}` donc la même commande fonctionne » —
qui figurait en §2.6 est **réfuté par la mesure S1/S2** ci-dessus (testé sous PowerShell 5.1
Desktop, la version réellement présente ici) : il ne reste aucune exécution où la forme textuelle
fonctionne sans que Claude Code fasse lui-même la substitution.

### 2.2.2 Documentation officielle : Claude Code **substitue lui-même** le placeholder

[Plugins reference](https://code.claude.com/docs/en/plugins-reference) — § *Environment variables*
(verbatim) :

> All three [`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}`] are
> exported as environment variables to hook processes and to MCP and LSP server subprocesses.
> They aren't present in the environment of commands Claude runs through the Bash tool, in the
> main session or in a subagent. In plugin content, write the placeholder instead, and Claude Code
> substitutes the path inline when it loads the content.

La même page donne le tableau des champs où la substitution a lieu inline — et **les hooks y sont
explicitement couverts** :

> | Plugin component | Fields where placeholders resolve |
> | Hook and monitor commands | Anywhere the placeholder appears |

et, § *Monitors* (verbatim) :

> The `command` value supports the [path substitutions](#environment-variables)
> `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, and `${CLAUDE_PROJECT_DIR}`, plus any
> `${ENV_VAR}` from the environment.

Autrement dit, dans la version installée (2.1.281), `"node \"${CLAUDE_PLUGIN_ROOT}/hooks/x.js\""`
devrait partir vers le shell **déjà substitué en chemin absolu** et *devrait fonctionner* : P1
n'est pas reproductible par Claude Code tel quel. C'est précisément pourquoi la cause (2) est
**requalifiée** en fragilité et non en cause démontrée (§2.2.1).

Un `node` qui ne charge pas le module n'écrit **rien sur stdout** : côté Claude Code, aucun
`additionalContext`, aucun `systemMessage`, aucune alerte → si la commande échoue, le résultat est
« hooks muets », `metrics.json` non réécrit, sans message d'erreur visible. Cette conséquence
reste valable **si** la commande échoue ; elle ne prouve pas qu'elle échoue chez Claude Code (§2.2.2).

Corroboration externe (issues upstream, données externes non vérifiées ici) :
[anthropics/claude-code#24007](https://github.com/anthropics/claude-code/issues/24007) —
« Windows: ${CLAUDE_PLUGIN_ROOT} expansion strips backslashes in hook commands » ;
[anthropics/claude-code#26389](https://github.com/anthropics/claude-code/issues/26389) —
« Plugin hooks fail on Windows: CLAUDE_PLUGIN_ROOT expands with backslashes » ;
[anthropics/claude-code#68699](https://github.com/anthropics/claude-code/pull/68699) — correctif
tiers qui normalise la racine de plugin sous Windows. Ces issues ne sont pas des preuves
reproduites ici ; aucune n'a été vérifiée sur cette installation.

**Hypothèse H1 : recadrée, non « confirmée » comme cause.** Est prouvée localement (rejeux P1-P3,
§2.2.1) : la forme textuelle dépend d'une expansion que le shell ne fait pas, et son échec est
totalement silencieux. N'est **pas** prouvé : que Claude Code ait échoué à l'exécuter — la
documentation (§2.2.2) dit qu'il substitue le chemin lui-même dans les commandes de hook. La
mutité observée (§2.3 : ~2 h 10 d'activité sans écriture) reste donc à expliquer : **H9 (§2.9)
devient l'hypothèse principale**, et sa contre-épreuve (`claude --debug` → ligne
`Loading hooks from plugin: token-watch`) est la seule qui la tranche.

**Le différentiel utile :** la seule commande qui, dans cet environnement, n'utilise **pas**
le placeholder est la statusline de `settings.json` (chemin absolu littéral, §1.1) — et c'est
la seule dont le script a été exécuté avec succès hors session (P3, §2.2.1). Cela établit une
asymétrie de **lisibilité** (une forme est déchiffrable par tout shell, l'autre non), pas une
cause.

### 2.3 Preuve temporelle (le silence est daté)

| Fichier | Preuve |
|---|---|
| `~/.claude/token-watch/metrics.json` | `ts` = `1790254305081` → `2026-09-24T12:51:45.081Z`, mtime `2026-09-24T12:51:48.696Z`. Contenu : `{"ts":1790254305081,"context_pct":0.6599,...,"quota_5h_pct":0.57,"cost_usd":695.736253,"alert":false}` |
| `~/.claude/token-watch/loop-advisor-last.json` | mtime `2026-09-23T21:12:48.270Z` (dernière alerte émise il y a > 1 jour) |
| `~/.claude/history.jsonl` | mtime `2026-09-24T14:59:43.952Z` — activité Claude Code il y a ~3 min |
| `~/.claude/projects/.../bdc6f139-…jsonl` | transcript actif, mtime `2026-09-24T15:00:38.622Z` (4 529 852 o) |
| `~/.claude/shell-snapshots` | mtime `2026-09-24T14:11:19.555Z` (outil Bash utilisé) |
| `~/.claude/gh-pr-status-cache.json` | mtime `2026-09-24T14:12:37.688Z` |

Conclusion : **une session Claude Code est active et travaille en continu, mais aucune écriture
de hook depuis 12:51:45Z** (~2 h 10 au moment du relevé). Un harnais qui exécute ses hooks
réécrirait `metrics.json` à chaque `PostToolUse` et à chaque `Stop`.

Distribution : le dernier `metrics.json` a été écrit à `12:51:48Z`, seconde exacte du mtime de
`~/.claude/conductor-memory` (`2026-09-24T12:51:48.366Z`) → un `Stop` de session a bien
déclenché des hooks ce jour-là à 12:51:48 ; plus rien après.

### 2.4 Défaut latent confirmé — écriture atomique interrompue, erreurs avalées (H4)

8 fichiers orphelins, **entièrement écrits** (227-228 o = taille du fichier final) :

```
usage-cache.json.tmp-5620-1789975606156     2026-09-21T07:26:46.155Z  227
usage-cache.json.tmp-12008-1790004775573    2026-09-21T15:32:55.574Z  227
usage-cache.json.tmp-17600-1790005905394    2026-09-21T15:51:45.395Z  228
usage-cache.json.tmp-34240-1790072950756    2026-09-22T10:29:10.757Z  228
usage-cache.json.tmp-18096-1790148165397    2026-09-23T07:22:45.388Z  228
usage-cache.json.tmp-32384-1790234111286    2026-09-24T07:15:11.286Z  227
usage-cache.json.tmp-38140-1790245628473    2026-09-24T10:27:08.472Z  228
usage-cache.json.tmp-27936-1790248731147    2026-09-24T11:18:51.148Z  227
```

Ils prouvent que des invocations ont été **tuées entre `writeFileSync` et `renameSync`**
(timeout de hook / de statusline) — ou que `renameSync` a échoué (sous Windows, remplacer un
fichier ouvert par un antivirus/indexeur peut renvoyer `EPERM`).

Les deux fonctions d'écriture avalent l'erreur et ne nettoient pas le temporaire :

- `lib/usage-api.js:142-151` — `_writeDiskCache()` : `catch {}` vide, le `tmpFile` n'est
  jamais supprimé ;
- `hooks/metrics-writer.js:111-121` — `writeMetrics()` : `const tmp` est déclaré **dans** le
  bloc `try`, donc `fs.unlinkSync(tmp)` du `catch` lève une `ReferenceError` aussitôt rattrapée
  par le `catch {}` interne → le temporaire reste, l'échec est invisible.

C'est une **cause d'aggravation** (aucun signal d'erreur remonté), pas la cause première du
silence — aucun `.tmp-*` de `metrics.json` n'existe, donc aucune écriture de métriques n'a
échoué sur disque : elle n'a simplement jamais été tentée.

**Hypothèse H4 : partiellement confirmée** (défaut réel, non causal pour le silence).

### 2.5 Hypothèse H3 — duplication confirmée, non causale

HEAD déclare les hooks **deux fois**, avec un contenu identique :

- `.claude-plugin/plugin.json:17-80` (`hooks` inline) ;
- `hooks/hooks.json:1-66` (fichier séparé, même objet).

`claude plugin details` ne remonte que 4 événements (pas 8 groupes) ; la double déclaration
est un défaut d'hygiène (risque de double exécution selon la version, source de vérité
ambiguë) mais **n'explique pas** le silence : les hooks sont bien comptés comme enregistrés.

### 2.6 Hypothèse H5 — écartée ; H1 recadrée (substitution documentée)

La documentation officielle ([Plugins reference](https://code.claude.com/docs/en/plugins-reference),
§ Environment variables et § Monitors, citations verbatim en §2.2.2) indique que
`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` et `${CLAUDE_PROJECT_DIR}` **sont exportés en
variables d'environnement aux processus de hooks**, que la valeur de `command` supporte aussi ces
substitutions textuelles, et que les **commandes de hook** font partie des champs où le
placeholder est résolu *inline*. Trois conséquences :

1. H1 ne peut plus être formulée comme « perte des antislashs à la substitution » sur
   [anthropics/claude-code#24007](https://github.com/anthropics/claude-code/issues/24007)
   (fermée comme doublon) : ce mécanisme seul n'explique pas tout.
2. Ce qui **est** démontré localement (P1/P2, §2.2.1) c'est que la forme **textuelle** échoue de
   façon **totalement silencieuse** dès lors que l'expansion `${…}` n'a pas lieu dans le shell
   qui reçoit la commande : `cmd.exe` ne connaît pas la syntaxe `${VAR}` (P1 : placeholder laissé
   littéral, joint au cwd), et une racine dont les antislashs ont disparu ne résout aucun module
   (P2). **Correction (t11) :** l'affirmation contraire qui figurait ici — « sous PowerShell 7,
   `${VAR}` est une syntaxe valide → la même commande fonctionne » — est **réfutée par la mesure**.
   Sous PowerShell (mesure S1/S2 sous `5.1.26100.9444`, la version présente ici),
   `${CLAUDE_PLUGIN_ROOT}` est une variable *PowerShell* non définie (les variables
   d'environnement s'écrivent `$env:…`) : elle s'expanse à **vide** et `node` cherche
   `D:\hooks\metrics-writer.js` → même `MODULE_NOT_FOUND`, exit 1
   (`.agent-teams/TW-1/provenance-shell.log`). Aucun shell de cette machine n'expanse donc le
   placeholder : **la forme textuelle n'est utilisable telle quelle que si c'est Claude Code qui
   substitue**, ce que la documentation décrit pour les commandes de hook. Elle reste donc
   fragile et dépendante de l'écosystème, mais elle n'est **pas** la cause démontrée de la mutité.
3. H9 (§2.9) devient l'hypothèse principale pour la mutité : ni P1/P2/P3 (rejeux manuels) ni
   l'analyse statique ne montrent un échec d'exécution côté Claude Code ; il reste à établir, avec
   `claude --debug`, si les hooks du plugin sont seulement **chargés** au démarrage de session.

Le placeholder est toujours géré par le binaire 2.1.281 (chaînes `${CLAUDE_PLUGIN_ROOT}`,
`\$\{?CLAUDE_PLUGIN_ROOT\b`, `\$(\{?)CLAUDE_PLUGIN_ROOT\b` trouvées par balayage du binaire,
`.agent-teams/TW-1/scan-claude-bundle.js`), et l'installé est bien `0.3.6`/`6c866e9` : il n'y a
pas d'incompatibilité de version à invoquer.

**Conséquence pour la réparation (corrigée en t10 — finding F4 de la revue adverse).** Le besoin de
changer de forme était réel, mais **pas pour la raison annoncée ici à l'origine**. La forme retenue
par t3
(`node -e "require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT,'hooks','x.js'))"`)
n'utilise **aucune** substitution textuelle : le shell reçoit une chaîne statique, identique sous
`cmd.exe` et sous PowerShell, et la racine arrive par l'environnement du processus — export
documenté. Elle est donc justifiée **par robustesse** face à la classe de bugs du placeholder, pas
parce que H1 aurait été démontrée causale.

Ce qui manquait à cette justification, et qui était faux dans la version précédente de ce passage :
cette forme a rendu **les entrées du manifeste muettes**, en silence, exactement comme l'état
qu'elle remplaçait. Mesure de la revue adverse (t21, copie jetable de l'arbre pré-t18 dispatché par
la forme du tour 1) : **6 entrées sur 6 muettes** — `exit 0`, `stdout 0 o`, aucun fichier écrit
(`t21-pre-t18.log`, §8.2).

- Sous `node -e` il n'y a pas de module d'entrée : `require.main` vaut `undefined`, donc la garde
  `if (require.main === module) main();` que porte chaque hook est **fausse** et un `require(…)` nu
  **charge le module sans jamais l'exécuter** → `exit 0`, stdout vide, aucun effet. Mesuré : sonde
  `requireMainIsUndefined: true` avec `main` exporté (§8.2), et contre-épreuve de la chaîne pré-t18
  sur les octets livrés aujourd'hui → `exit=0`, `stdout[0 o]=""`, `metrics.json` inchangé
  (`hash` et `mtime` identiques, §8.2).
- Le défaut a été **détecté seulement parce que la revue exigeait un effet observable** (t18/t21) :
  toutes les preuves antérieures, y compris celles de G2 en t5, étaient vertes sur un état devenu
  faux ensuite. Elles ne valaient donc pas comme preuve de dispatch — un `exit 0` sans effet est
  précisément la signature du hook mort (§8.5, mutation F2).
- Nuance à porter pour `hooks/metrics-writer.js` : c'est le seul des quatre hooks où l'entrée
  exportée est appelée **au niveau module** à HEAD, donc **le dispatch y restait vivant au moment de
  t5** — mesuré en §8.2 sur l'arbre HEAD reconstitué, où la forme `-e require` produit encore un
  effet. Les preuves G2 de t5 étaient vertes pour cette raison mécanique, et non parce que la
  commande du manifeste fonctionnait comme elle le prétendait. L'attribution de cette garde à un
  tour précis du lot **n'est pas démontrée** : ce qui est mesuré est `git grep -n "require.main"
  HEAD -- hooks/` = **0 résultat** (aucun hook de 0.3.6 n'en porte) contre 4 fichiers qui en portent
  dans l'arbre réparé. Le brief de clôture **attribue** cette garde à t13 (le lot est resté non
  commité jusqu'à cette branche, donc aucun commit intermédiaire ne permet de le vérifier ; ce qui
  est établi est qu'elle précède le correctif de dispatch de t18, sinon `hooks/metrics-writer.js`
  aurait été muet lui aussi et un `exit 0` de la forme `-e require` n'aurait pas écrit de fichier).

**Forme finale (t18) et règle générale.** La forme livrée est l'**appel explicite de l'entrée
exportée du module** : `…')).main()` (et `.main().catch(() => process.exit(0))` pour
`metrics-writer.js`, dont `main()` est asynchrone). Aucune entrée de hook ne doit dépendre de
`require.main`.

### 2.7 Hypothèse H8 — pollution par le hook Orca : réfutée (contre-épreuve)

`~/.claude/settings.json` câble `C:/Users/carma/.orca/agent-hooks/claude-hook.cmd`
(`timeout: 10`) sur `Stop`, `UserPromptSubmit`, `StopFailure`, `PreToolUse`, `PostToolUse`,
`PostToolUseFailure`, `PermissionRequest`. Le script existe (883 o, mtime 2026-07-06T15:08:32Z)
et il est **intégralement fail-open** :

```bat
@echo off
setlocal
if not "%DEVIN_PROJECT_DIR%"=="" exit /b 0
if defined ORCA_AGENT_HOOK_ENDPOINT if exist "%ORCA_AGENT_HOOK_ENDPOINT%" call "%ORCA_AGENT_HOOK_ENDPOINT%" 2>nul
if "%ORCA_AGENT_HOOK_PORT%"=="" exit /b 0
if "%ORCA_AGENT_HOOK_TOKEN%"=="" exit /b 0
if "%ORCA_PANE_KEY%"=="" exit /b 0
"%SystemRoot%\System32\curl.exe" -sS -X POST "http://127.0.0.1:%ORCA_AGENT_HOOK_PORT%/hook/claude" --connect-timeout 0.5 --max-time 1.5 ... >nul 2>&1
exit /b 0
```

Contre-épreuve (payload de hook sur stdin) :

```
PS> $pay | cmd.exe /c "set ORCA_AGENT_HOOK_PORT=& set ORCA_AGENT_HOOK_TOKEN=& set ORCA_PANE_KEY=& set ORCA_AGENT_HOOK_ENDPOINT=& claude-hook.cmd"
raw output: <<<>>>      exit=0
PS> $pay | cmd.exe /c "claude-hook.cmd"
raw output: <<<>>>      exit=0
elapsed_ms=69
```

Aucune sortie (stdout comme stderr), `exit /b 0` inconditionnel, ≤ 1,5 s par `curl`
(`--connect-timeout 0.5 --max-time 1.5`), sortie réseau jetée (`>nul 2>&1`). Les variables
`ORCA_*` sont absentes de l'environnement de cette session (relevé `Get-ChildItem env:` →
aucune) : le script sort en `exit /b 0` dès la ligne 5, sans réseau. Un hook qui ne sort jamais
en code ≠ 0, n'écrit jamais sur stdout et ne bloque jamais ne peut ni empoisonner ni supprimer
l'exécution des autres hooks → **H8 écartée**.

### 2.8 Écartées également : kill-switch global et conflit de manifestes

- **Aucun interrupteur global de hooks.** Clés de premier niveau de `~/.claude/settings.json` :
  `env, permissions, model, hooks, enableWorkflows, statusLine, enabledPlugins,
  extraKnownMarketplaces, language, effortLevel, modelSettings, awaySummaryEnabled,
  autoUpdatesChannel, tui, skipDangerousModePermissionPrompt, skipWorkflowUsageWarning, theme,
  editorMode, remoteControlAtStartup, agentPushNotifEnabled, mcpServers, channels`.
  Ni `disableAllHooks`, ni `allowManagedHooksOnly`, ni `safeMode`. Aucun réglage managé :
  `C:\ProgramData\ClaudeCode\managed-settings.json` → `False`, `C:\ProgramData\ClaudeCode` →
  `False`. Les messages de mode restreint trouvés dans le binaire 2.1.281
  (« Skipping plugin hooks - safe mode disables installed plugins… », « … allowManagedHooksOnly is
  enabled and no managed plugins », « This terminal runs with hooks off (bare mode) ») supposent
  donc un réglage managé ou un mode « bare » qui **n'existent pas ici**.
- **Pas de conflit `plugin.json` ↔ entrée marketplace.** Le chemin d'abandon du chargeur
  (`Plugin … has both plugin.json and marketplace manifest entries for
  commands/agents/skills/hooks/… This is a conflict.` → `return null`, binaire 2.1.281) n'est pas
  déclenché : `.claude-plugin/marketplace.json:11-17` ne déclare **aucun** composant (ni `hooks`,
  ni `skills`). L'entrée ne fait que décrire le plugin.
- **La double déclaration de hooks est gérée en douceur par le chargeur** (renforce §2.5) :
  chaîne trouvée dans le binaire — « …names the standard hooks/hooks.json, which loads on its own;
  loaded once » / « Skipping duplicate hooks file for plugin X: … (resolves to already-loaded
  file: …) », et « Skipping duplicate hook registration for plugin "X" … already registered from
  another source ». La déduplication opérée par t3 (une seule source de vérité
  `hooks/hooks.json`) reste une bonne pratique de manifeste, mais elle n'est pas la cause du
  silence.

### 2.9 H9 — échec de chargement des hooks du plugin au démarrage de session : **hypothèse principale** pour la mutité

**Statut (t11) : c'est désormais l'hypothèse principale**, et non plus une « question ouverte »
secondaire. Raison : la cause (2) a été requalifiée en fragilité non démontrée (§2.2.1/§2.2.2 —
Claude Code substitue lui-même le placeholder dans les commandes de hook), donc **rien** dans les
rejeux P1/P2/P3 n'atteste un échec d'exécution en session réelle. Il reste ce fait, qui n'est
expliqué par aucun autre mécanisme de commande : la session Claude Code en cours
**démarre à `2026-09-24T13:05:31Z`**, soit **après** la dernière écriture de hook
(`12:51:48Z`), et elle est active depuis ~2 h sans une seule écriture du plugin (cf. §2.3), alors
que les mêmes réglages produisaient des écritures jusqu'à 12:51:48Z dans la session précédente.
Autour de ce démarrage, la machine a aussi rafraîchi ses plugins
(`~/.claude/plugins/.trash` 13:05:46Z, `cache` 13:06:03Z, `marketplaces` 13:05:57Z ;
`installed_plugins.json` réécrit à 14:15:11Z) — un chargement de hooks échoué pendant ce
rafraîchissement produirait exactement ce tableau : plugin listé et compté, hooks jamais exécutés,
aucune erreur visible.

Ce chemin **n'est pas observable depuis ce lot** : Claude Code n'écrit pas de journal de hooks par
défaut (`~/.claude/logs` → False, `~/.claude/debug` → False ; aucun fichier « debug » dans
`%LOCALAPPDATA%\claude-cli-nodejs\Cache\D--SolSolis-zether\` — seuls des `mcp-logs-*`), et les
transcripts ne contiennent aucune trace d'exécution de hook (recherche
`hookName|hookInfos|hookErrors|hook_success|hook_error|"hookEvent"` sur `bdc6f139-…jsonl` →
0 correspondance). Le déclencher exigerait une session Claude Code relancée avec `--debug`, c'est-à-dire
une action hors dépôt (G6). **Recommandation** (à l'utilisateur, pas au dépôt) : après la
réparation, relancer une session avec `claude --debug` et vérifier la ligne
`Loading hooks from plugin: token-watch` ; c'est la seule contre-épreuve qui tranche H9
(cf. §6, limite 1). Signe distinctif attendu : **aucun** hook déclenché (pas même un `PostToolUse`
sur une sonde d'écriture) alors que le plugin est listé `Hooks (4)` par `claude plugin details`.

---

## 3. Symptôme 3 — aucune alerte de quota 5h à 96-98 %

### 3.1 Le code d'alerte existe et fonctionne

Sonde avec le cache réel (`session5hPct = 0.98`) et `config.yaml` réel (`loop_pct: 90`),
`HOME` isolé :

```
PS> $env:USERPROFILE="...\TW-1\fakehome"; Get-Content .agent-teams\TW-1\payload-statusline.json -Raw | node hooks/loop-advisor.js
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"[token-watch] 5h quota at 98% — reset at 16:49 · session cost $0.08. Reset imminent — do NOT start a new autonomous loop. Wrap up current work cleanly."},"systemMessage":"⛔ token-watch: 5h at 98% — reset at 16:49 · session cost $0.08 — do not start loops"}
exit=0
```

Sortie non vide, exit 0, bannière + contexte machine : le script est sain (comme
`metrics-writer.js`, cf. recon capitaine). La panne est dans le **déclenchement** = §2.

### 3.2 Cause réelle du « aucune alerte »

`loop-advisor.js` est branché sur `UserPromptSubmit` et `Stop`
(`hooks/hooks.json:3-13` et `:44-52`) — deux hooks qui n'ont pas été exécutés depuis
`2026-09-23T21:12:48Z` (`loop-advisor-last.json`). Le symptôme 3 est donc **une conséquence
directe du symptôme 2**.

### 3.3 Hypothèse H6 — « seuil jamais atteint » : réfutée ; mais écart de besoin réel

- `loop_pct` par défaut = `80` (`lib/config.js:37`), `config.yaml` = `90`. Un seuil de 90 est
  **atteint** par 0,96-0,98 : mécaniquement l'alerte aurait dû se déclencher, et même plus tôt
  avec le défaut 80. Le seuil n'est donc pas la cause.
- En revanche il n'existe **aucun seuil dédié « quota 5h »** avec défaut 90 : le seul levier
  est `loop_pct`, présenté comme « 5h quota % to trigger loop advisor » (`README.md:112`,
  `README.md:97`), et il gouverne aussi l'advisory de boucle.
- `hooks/metrics-writer.js:42` code en dur `const ALERT_THRESHOLD = 0.90` (non configurable) et
  n'écrit le drapeau `alert` que dans `metrics.json` : même si les hooks tournaient, ce drapeau
  **n'est jamais présenté à l'utilisateur** (aucun `systemMessage`).
- Garde-fou supplémentaire à ne pas oublier : `ADVISORY_COOLDOWN_MS = 60 s`
  (`hooks/loop-advisor.js:37`), soit au plus une bannière par minute.

→ Besoin à couvrir par la réparation : seuil « quota 5h » **dédié, configurable, défaut 90 %**,
avec alerte visible — `loop_pct` seul ne satisfait pas la demande.

---

## 4. Autres écarts constatés (hors symptômes, à corriger par le lot)

### 4.1 Divergence de version du marketplace

```
.claude-plugin/marketplace.json:9   "version": "0.3.5"
.claude-plugin/plugin.json:3        "version": "0.3.6"
package.json:3                      "version": "0.3.6"
```

### 4.2 Porte G4 (`node --test test/`) cassée en l'état

```
PS> node --test test/
TAP version 13
# Subtest: test
not ok 1 - test
  ---
  duration_ms: 5.2435
  type: 'test'
  location: 'D:\\SolSolis\\claude-token-watch\\test:1:1'
  failureType: 'testCodeFailure'
  error: 'spawn EPERM'
  code: 'EPERM'
  ...
# tests 1
# pass 0
# fail 1
exit=1
```

Deux défauts cumulés : le positionnel `test/` est traité comme **un fichier** nommé `test`
(`location: ...\test:1:1`), et le runner `node --test` lance chaque fichier dans un processus
enfant, ce que le bac à sable DSH refuse (`spawn EPERM`). `node --test` sans argument →
`# tests 9, # fail 9`.

État réel des épreuves quand on les lance **directement** (sans runner → sans spawn) :

```
node test/smoke.js              → 32 checks passed,  exit=0
node test/hooks-config.test.js  → 20 checks passed,  exit=0   (arbre modifié par la tâche de réparation)
node test/cache-ttl.test.js     → 7 checks passed,   exit=0
node test/config.test.js        → 4 passed, 9 failed (spawnSync … EPERM)
node test/disk-cache.test.js    → EPERM  open  C:\Users\carma\.claude\token-watch\usage-cache.json
node test/loop-advisor.test.js  → ERR_ASSERTION actual:1 expected:0
```

Les échecs `config.test.js` / `disk-cache.test.js` / `loop-advisor.test.js` sont des
**écritures hors espace de travail** ou des `spawnSync` refusés par le bac à sable : ils ne
sont pas des preuves de régression fonctionnelle, mais ils **empêchent la porte G4 de passer**
telle quelle. Deux options pour T-wrap : (a) porte = `npm test` (chaîne de `node <fichier>`
directs, cf. `package.json:12`), (b) `node --test --test-isolation=none <fichiers>`.
À trancher explicitement.

**Mise à jour t6 (G4, `.agent-teams/TW-1/G4.md`)** — la formulation ci-dessus doit être corrigée :

- l'option (b) est **fausse telle quelle** : `--test-isolation=none` → `bad option` ; le nom accepté
  est `--experimental-test-isolation=none` (exécution in-process, sans spawn du runner) ;
- la porte retenue est `node --test "test/*.test.js"` — **la forme déjà utilisée par
  `package.json:12`** — et non le positionnel `test/` ; en bac à sable elle rend
  `# tests 7 / # pass 0 / # fail 7`, les 7 échecs étant le **même** `spawn EPERM` du runner
  (une preuve de refus d'environnement, pas un échec de test) ;
- `node --test` **sans argument** → `# tests 9 / # fail 9` (il ramasse aussi les sondes non-TAP) ;
- `test/disk-cache.test.js` passe **15/15** dès que `USERPROFILE`/`HOME` sont détournés : le fichier
  écrivait dans le **vrai** `~/.claude/token-watch/usage-cache.json` (et
  `test/disk-cache.test.js:45-63` écrit/restaure `~/.claude/.credentials.json` avec un **faux jeton
  OAuth**) — c'est un défaut de test réel, à corriger (finding F2 de t6, transmis à forge) ;
- les compteurs verts de la porte restent à obtenir **hors bac à sable** (finding F1, blocker).

### 4.3 Résidu de désinstallation (à documenter seulement — G6)

`claude-hyperion@claude-hyperion` est encore présent dans `~/.claude/plugins/installed_plugins.json`
(2 entrées `scope: local`), `~/.claude/plugins/known_marketplaces.json` et
`extraKnownMarketplaces` de `~/.claude/settings.json`, alors que `enabledPlugins` ne le liste
plus. **Lecture seule : aucune correction possible dans ce lot** (G6), à signaler à l'utilisateur.

### 4.4 `.agent-teams/` n'est pas ignoré par git

`.gitignore` (HEAD) ne contient pas `.agent-teams/`. Les journaux bruts de ce diagnostic
(`.agent-teams/TW-1/`) apparaissent donc en `??` dans `git status` et risquent d'être
committés avec la branche/PR. Hors périmètre de t1 (`.gitignore` non modifié) → à traiter par
la tâche de réparation/PR (soit une ligne `.agent-teams/`, soit une exclusion explicite).

**Tranché en t10 (clôture).** C'est l'**exclusion explicite** qui a été retenue : staging fichier
par fichier, jamais `git add -A` / `git add .` / `git commit -a`, `.gitignore` **non modifié**.
`.agent-teams/` et `.conductor/` restent en `??` sur la branche. Détail en §10.2.

### 4.5 Le CLI de configuration écrasait un `config.json` qu'il n'avait pas su lire (fermé par t26)

Dernier défaut trouvé et fermé **pendant** le lot, et non dans l'état figé de §0 : c'est la revue
adverse du **tour 3 (t25)** qui l'a établi, en refusant la clôture (`needs_revision`, finding
**F1 high**). Il appartient à la même classe de défaut que le BOM de §8.3 — une perte de réglages
**silencieuse et annoncée comme un succès** — mais par une autre route : le CLI.

Cause : `readConfig()` (`scripts/config.js:41-53`) renvoyait `{}` pour **tout** échec, sans
distinguer « `config.json` absent » de « présent mais illisible » ; `cmdSet` (:86-88) reconstruisait
alors le fichier **entier** à partir de ce vide.

Mesure de la perte (fixtures jetables, `HOME`/`USERPROFILE` détournés, tête `FF FE` produite par la
vraie route PowerShell 5.1 `Out-File -Encoding unicode`), fichier de 164 octets portant trois
réglages valides (`compact-pct 60`, `loop-pct 70`, `quota-alert-pct 40`) :

```
AVANT (HEAD de la branche, avant t26)
  node scripts/config.js set quota-alert-pct 55   -> exit 0, « set to 55% (stored in …) »
  fichier : 164 o -> 28 o ; contenu après = {"quota-alert-pct":55}
  compact-pct et loop-pct DÉTRUITS, sans un mot ; `get` affiche ensuite [source: default]
  (rejoué par la revue : 140->28 o en tête FF FE, 34->28 o tronqué, 54->28 o commenté,
   racine tableau [1,2,3] : exit 0, 10->18 o, succès annoncé, réglage disparu à la sérialisation)

APRÈS (t26)
  node scripts/config.js set quota-alert-pct 55   -> exit 1, stdout VIDE, 3 lignes sur stderr :
    « …\config.json is present but unreadable — it is not UTF-8 but UTF-16LE (BOM FF FE). »
    « … refusing to overwrite it; no modification was made. »
  fichier : 122/140 o, sha256 et mtimeMs STRICTEMENT identiques (aucune écriture)
  même refus nommant le chemin pour : tronqué (invalid JSON, position), commenté, racine tableau
  (« invalid — the root is a JSON array, not an object »), racine null, UTF-16BE, UTF-16 sans BOM
```

Le contrôle positif est dans le même run : un `config.json` **absent** (ou blanc) reste le seul cas
créable (`exit 0`, fichier créé), et sur un fichier **valide** seule la clé visée change. `get`
partage le même refus (`exit 1`, stdout vide) au lieu d'afficher des valeurs par défaut ; `reset`
reste destructif par contrat et **nomme** le chemin supprimé. Les bornes et codes existants sont
inchangés (100 → 1, -1 → 1, clé inconnue → 1, argument manquant → 1, commande inconnue → 1, `get` →
0, `reset` → 0). Six contrôles in-process ajoutés (`taille` + `mtimeMs` + octets comparés
avant/après) ; les mutants de la revue (garde `configOrExit` rendue laxiste, garde `Array.isArray`
retirée) font tomber ces contrôles.

Encadrement par les revues : **tour 3 (t25) = `needs_revision`** (ce finding F1 high, plus F2 basse
sur la racine tableau), **tour 4 (t27) = `pass`** — le refus est jugé par exécution, sur 9 formes
illisibles/invalides et 11 commandes × 6 états de fichier, avec mutants et contrôles positifs dans le
même run. Verdicts rappelés en tête de document ; les deux incidences documentaires du tour 4
(`get` qui refuse, `reset` qui supprime) portent sur `README.md`/`CHANGELOG.md`, hors de ce commit.

---

## 5. Verdict par hypothèse

| # | Hypothèse | Verdict | Preuve |
|---|---|---|---|
| H1 | commandes de hook dépendantes de `${CLAUDE_PLUGIN_ROOT}` (substitution textuelle) | **Requalifiée (t11) : fragilité prouvée, cause de la mutité NON démontrée.** La dépendance au placeholder est réelle, son échec est totalement silencieux, et aucun shell de cette machine ne l'expanse ; mais la doc officielle (§2.2.2) dit que Claude Code le substitue lui-même dans les commandes de hook, donc P1-P3 (rejeux manuels, §2.2.1) ne prouvent pas un échec en session | §2.2 + §2.2.1 + §2.2.2 + §2.6 : 6 commandes à placeholder ; P1/P2 rejoués manuellement → `Cannot find module` + exit 1 + stdout vide ; S1/S2 : PowerShell n'expanse pas le placeholder (→ vide) ; P3 (chemin absolu littéral) exit 0 avec sortie complète ; forme « variable d'environnement » immunisée (justifiée par robustesse) |
| H2 | statusLine non rendue par Claude Code 2.1.x sous Windows | **Retenue** (corroborée en externe, non reproduite localement) | §1.3 : script OK (exit 0, ligne complète) ; issues #52997, #57940, claude-hud#521 |
| H3 | `hooks.json` invalide ou dupliqué | **Confirmée (hygiène), non causale** | §2.5 + §2.8 : `plugin.json:17-80` == `hooks/hooks.json:1-66` ; le chargeur déduplique en le journalisant (« Skipping duplicate hooks file … loaded once »), 4 hooks comptés |
| H4 | exception silencieuse d'un hook / `rename` interrompu, erreurs avalées | **Partiellement confirmée, non causale (aggravante)** | §2.4 : 8 `.tmp-*` complets ; `lib/usage-api.js:142-151` et `hooks/metrics-writer.js:111-121` avalent l'erreur sans nettoyer → aucun signal d'échec |
| H5 | incompatibilité avec Claude Code 2.1.281 | **Écartée** | §2.6 : placeholder toujours géré par le binaire ; installé == HEAD ; aucun réglage restreint (§2.8) |
| H6 | seuil d'alerte jamais atteint | **Réfutée** ; écart de besoin réel (seuil 5h dédié manquant) | §3.3 : défaut 80 < config 90 < 0,98 ; seuil 5h dédié inexistant ; `alert` en dur et invisible |
| H7 | statusLine écrasée par un autre plugin/réglage, ou hooks coupés globalement | **Écartée** | §1.4 (seul token-watch déclare `statusLine` ; aucun override projet/local) + §2.8 (aucun `disableAllHooks` / `allowManagedHooksOnly` / réglage managé) |
| H8 | le hook Orca `claude-hook.cmd` empoisonne le pipeline de hooks | **Réfutée** (contre-épreuve exécutée) | §2.7 : exit 0 inconditionnel, stdout+stderr vides, 69 ms, réseau jeté, sortie anticipée sans `ORCA_*` |
| H9 | échec de chargement des hooks du plugin au démarrage de la session (13:05:31Z) | **Hypothèse principale (t11)** pour la mutité — non observable sans `--debug` (hors dépôt) : plus aucun autre candidat ne subsiste une fois H1 requalifiée | §2.9 : session démarrée après le dernier hook, ~2 h d'activité sans écriture, hooks comptés `Hooks (4)` mais jamais exécutés, aucun journal de hooks disponible |

## 6. Limites de ce diagnostic

1. **Provenance des preuves P1/P2/P3 (corrigée en t11).** Ce sont des **rejeux manuels** de la
   chaîne de commande (§2.2.1), pas des observations de Claude Code : aucun journal de hooks
   n'existe ici. Ils établissent le comportement d'un shell qui n'expanse pas le placeholder
   (fragilité + silence de l'échec), **pas** une substitution ratée par Claude Code. La
   documentation officielle (§2.2.2) dit au contraire que les **commandes de hook** font partie
   des champs où le placeholder est résolu *inline*, et que les trois variables sont exportées aux
   processus de hooks. La **cause de la mutité** n'est donc pas établie : l'hypothèse principale
   restante est **H9** (§2.9), et la contre-épreuve décisive — un `claude --debug` en session
   réelle vérifiant la ligne `Loading hooks from plugin: token-watch` — est **hors périmètre de ce
   lot** (G6) ; à faire après la réparation. Ce qui reste prouvé sans réserve : l'échec silencieux
   de la forme textuelle dans un shell qui ne l'expanse pas, l'absence de tout journal d'erreur
   côté plugin, et l'asymétrie P3/§1.3 (chemin absolu littéral → exit 0).
2. L'affichage de l'UI TUI (statusline) n'est pas visible ici ; le symptôme 1 est établi par
   l'absence de composant plugin (preuve `claude plugin details`) et par le comportement du
   script (exit 0 avec sortie complète), le reste étant imputé à Claude Code côté Windows.
3. Les issues GitHub citées sont des **données externes non vérifiées** dans cet environnement.
4. Les échecs de tests de §4.2 dus au bac à sable sont propres à cette session d'exécution.
5. L'horodatage du dernier rafraîchissement de `usage-cache.json` (`14:11:35Z`) tombe dans la
   fenêtre des commandes de reconnaissance du lot : il ne peut pas être attribué avec certitude à
   une statusline lancée par Claude Code plutôt qu'à une sonde de reconnaissance ; il n'est donc
   utilisé comme preuve nulle part dans ce document.

## 7. Contrainte G6 — rien dans `~/.claude/`

Toutes les lectures ci-dessus sont non destructives. Aucune écriture n'a eu lieu dans
`~/.claude/` : le seul risque était la sonde §1.3 (statusline sur le `HOME` réel, qui rafraîchit
normalement `usage-cache.json`) — l'écriture a été **refusée par le bac à sable** puis avalée par
le `catch {}` du plugin, et le relevé de mtimes après coup le confirme (`usage-cache.json`
toujours à `2026-09-24T14:11:35.524Z`, aucun autre mtime modifié dans
`~/.claude/token-watch/`). Les sondes à écriture ont été exécutées avec `USERPROFILE` redirigé
vers `.agent-teams/TW-1/fakehome`.

La contre-épreuve §2.7 a exécuté `C:\Users\carma\.orca\agent-hooks\claude-hook.cmd`, mais **sans
aucune variable `ORCA_*`** (absentes de la session) : le script est sorti dès la ligne 5, aucun
appel réseau, aucune écriture. `~/.claude/settings.json` et le `.cmd` n'ont **pas** été modifiés
(constat seulement, comme demandé).

---

## 8. État réparé — contre-épreuves

Pour **chaque** symptôme et pour l'écart G4 : la preuve d'avant (déjà dans ce document, rappelée par
sa source) **en regard** de la preuve d'après correctif, commandes verbatim et sorties brutes.
Aucun résumé reformulé : les blocs sont copiés des journaux.

**Arbre mesuré : l'arbre de travail corrigé, pas HEAD.** `git rev-parse HEAD` reste
`6c866e9506ba4c9fa8f01a6388e059f5a42e74b4` (v0.3.6, l'état cassé) ; les contre-épreuves ci-dessous
ont été rejouées sur **HEAD + les modifications non commitées du lot**, le 2026-09-24 à partir de
16:08Z. Les mesures de §0 à §7 restent valables comme description de l'état cassé.

Journaux bruts : `.agent-teams/TW-1/t10-replay.log` (rejeu t10), `g2g3v2-raw.log` (G2/G3 v2, t19
**rejoué** sur l'arbre corrigé ; la version d'origine du 15:42Z est conservée sous
`g2g3v2-raw-t19.log`), `G4.md` + `g4-files*/`, `t21-*.log`, `T21-review.md`, et les rapports
`t18`/`t20`/`t23`/`t24` recopiés dans `t10-team-extract.txt`.

### 8.0 Empreintes des fichiers mesurés (arbre corrigé, 16:08Z)

```
HEAD             = 6c866e9506ba4c9fa8f01a6388e059f5a42e74b4
git status       = 23 entrées (19 modifiées + 4 non suivies)
sha256-12 hooks/hooks.json             = ef258c28699e
sha256-12 hooks/loop-advisor.js        = b1d938d4cb6e
sha256-12 hooks/metrics-writer.js      = ae4f97253c1b
sha256-12 hooks/context-guard.js       = 5c6c4d5a586d
sha256-12 hooks/session-logger.js      = e8f7617defdd
sha256-12 lib/config.js                = 4b7da5b279eb
sha256-12 statusline/statusline.js     = bc486097435d
plugin.json statusLine = ABSENT (retiré par le lot : champ non supporté)
```

### 8.1 Symptôme 1 — « statusline non affichée »

**Avant** (§1.1–§1.3) : `~/.claude/settings.json` déclare `statusLine`, et
`.claude-plugin/plugin.json:13-16` (HEAD) déclarait aussi un `statusLine` **dans le manifeste du
plugin** — champ qui n'est pas un composant supporté, donc purement ignoré :

```
$ claude plugin details token-watch@token-watch          (§1.2, verbatim)
Component inventory
  Skills (1)  token-report
  Agents (0)
  Hooks (4)  UserPromptSubmit, PostToolUse, Stop, SessionEnd
  MCP servers (0)
```

…et la commande, exécutée à la main sur un payload réel, rendait pourtant une ligne complète
(§1.3) : script sain, rien à l'écran. La statusline n'existait donc que par un ajout manuel dans
`settings.json`, non versionné et non reproductible.

**Après (rejeu t10 sur l'arbre corrigé)** — deux contre-épreuves, exécutées avec
`HOME = USERPROFILE = .agent-teams/TW-1/home-t10` :

1. le manifeste ne déclare plus le champ :

```
plugin.json statusLine = ABSENT (retiré par le lot : champ non supporté)
```

2. la commande documentée par le README (`README.md:53-79`) rend bien une ligne, sur le transcript
   de 601 200 tk :

```
commande : node "D:\SolSolis\claude-token-watch\statusline\statusline.js"
charge utile : {"session_id":"t10-statusline","transcript_path":"D:\\SolSolis\\claude-token-watch\\.agent-teams\\TW-1\\home-t10\\transcript.jsonl","cwd":"D:\\SolSolis\\claude-token-watch","hook_event_name":"StatusLine","model":{"id":"claude-sonnet-4-5-20250929","display_name":"Sonnet 4.5"},"cost":{"total_cost_usd":0.42},"workspace":{"current_dir":"D:\\SolSolis\\claude-token-watch"}}
exit=0 error=null duration_ms=257
stdout (100 o) : ◈ Sonnet 4.5 · 1M  ·  ▕██████░░░░▏ 60% ctx 601k/1.0M  ·  $0.42  ·  5h ▕█████▏ 98%  ·  7d ▕██░░░▏ 38%
stderr (0 o) : (vide)
```

Le README porte désormais le mode d'emploi explicite et la limitation (`README.md:49,79`) :
« No `statusLine` component is listed, because a plugin manifest cannot declare one »,
« As of 0.3.7 the manifest no longer declares one, so `settings.json` is the only supported
registration path ».

**Preuve manquante, signalée :** que la ligne **s'affiche dans l'interface** d'une session Claude
Code reste non observable dans le dépôt (H2, côté Claude Code / Windows : issues #52997, #57940).
Le lot ne prouve que ce qui est dans le dépôt : script qui rend une ligne (ci-dessus) et chemin
d'enregistrement corrigé. Voir §9 (G5).

### 8.2 Symptôme 2 — « hooks muets (`metrics.json` figé) »

**Avant** : `metrics.json` figé au dernier passage de l'ancienne version
(`~/.claude/token-watch/metrics.json` = 171 o, `2026-09-24T12:51:48.697Z`, §2.3), et les preuves t5
vertes sur un état qui allait devenir muet (§2.6, finding F4).

**Après (G2 v2, rejeu du 16:08Z sur l'arbre corrigé)** — les deux épreuves utilisent la commande
**extraite de `hooks/hooks.json`** (lue par `JSON.parse`, jamais retapée) et un `metrics.json`
d'abord absent :

```
COMMANDE VERBATIM PostToolUse[0].hooks[0] : node -e "require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT,'hooks','metrics-writer.js')).main().catch(()=>process.exit(0))"
exit=0 error=none signal=none duration_ms=291
stdout[0 o]=""      stderr[0 o]=""
AVANT (absent)  …\home-g2g3\.claude\token-watch\metrics.json -> ABSENT
APRES           …\home-g2g3\.claude\token-watch\metrics.json -> size=178 mtime=2026-09-24T16:08:12.313Z hash=7480b1a228bc

COMMANDE VERBATIM Stop[1].hooks[0] : node -e "require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT,'hooks','metrics-writer.js')).main().catch(()=>process.exit(0))"
exit=0 error=none signal=none duration_ms=285
stdout[0 o]=""      stderr[0 o]=""
APRES metrics.json -> size=178 mtime=2026-09-24T16:08:12.607Z hash=a29b07a3163f

contenu metrics.json (PostToolUse) = {"ts":1790266092287,"context_pct":0.6012,"context_tokens":601200,"context_window":1000000,"model":"claude-sonnet-4-5-20250929","quota_5h_pct":0.95,"cost_usd":0.1956,"alert":true}
contenu metrics.json (Stop[1])      = {"ts":1790266092576,"context_pct":0.6012,"context_tokens":601200,"context_window":1000000,"model":"claude-sonnet-4-5-20250929","quota_5h_pct":0.95,"cost_usd":0.1956,"alert":true}
G2 verdict: PostToolUse exit=0 metrics_ecrit=true ; Stop exit=0 reecrit=true
```

**Contre-épreuve — la chaîne pré-t18, verbatim, sur les mêmes octets** (source de la chaîne :
`gates-raw.log:75`, journal t5) :

```
chaîne : node -e "require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT,'hooks','metrics-writer.js'))"
exit=0 error=none signal=none duration_ms=302
stdout[0 o]=""      stderr[0 o]=""
AVANT (contre-épreuve)  metrics.json -> size=178 mtime=2026-09-24T16:08:12.607Z hash=a29b07a3163f
APRES (contre-épreuve)  metrics.json -> size=178 mtime=2026-09-24T16:08:12.607Z hash=a29b07a3163f
contre-épreuve verdict: exit=0 stdout_vide=true fichier_inchange=true
```

→ **un `exit 0` avec stdout vide et aucun effet : c'est la mutité, reproduite sur la forme livrée
par t3.** La cause est nommée par une sonde (pas une commande du manifeste) :

```
sonde : {"requireMainIsUndefined":true,"exports":["computeMetrics","writeMetrics","quotaAlertThreshold","main","CONTEXT_ALERT_PCT","DEFAULT_QUOTA_ALERT_PCT","CACHE_FILE","METRICS_FILE"],"mainExported":"function"}
```

**Contrôle sur l'arbre HEAD reconstitué** (13 fichiers matérialisés par `git show`, `tar` et
`git archive` étant inutilisables sous ce bac à sable) :

```
commande verbatim de HEAD hooks.json : node "${CLAUDE_PLUGIN_ROOT}/hooks/metrics-writer.js"
note : ${CLAUDE_PLUGIN_ROOT} est substitué par Claude Code, pas par cmd.exe — substitution faite ici, documentée.
HEAD direct-file   exit=0 … metrics.json -> size=179 mtime=2026-09-24T16:08:15.101Z hash=e442d0efddca
HEAD -e-require    exit=0 … metrics.json -> size=179 mtime=2026-09-24T16:08:15.422Z hash=786c3a006e6c
HEAD verdict: direct-file exit=0 effet=true ; -e require exit=0 effet_apres=true
lecture : à HEAD le fichier appelait main() au niveau module (pas de garde require.main), donc même la forme `-e require` y produit un effet.
```

**Lecture honnête de ce contrôle :** à HEAD, `metrics-writer.js` appelait `main()` **au niveau
module** (aucun hook de 0.3.6 ne porte de garde `require.main` : `git grep` sur HEAD = 0 résultat),
donc même la forme `-e require` y produisait un effet. C'est pourquoi les preuves G2 de t5 étaient
vertes : elles ne mesuraient pas le dispatch. Les octets de l'état livré entre t3 et t17 ne sont pas
récupérables (arbre non commité, écrasé) — la contre-épreuve décisive est donc celle des deux blocs
ci-dessus, plus le contrôle HEAD.

**Le test qui certifie le dispatch n'est plus aveugle** (t18, revue t21) : `test/hooks-config.test.js`
porte le marqueur dans la fonction d'entrée du stub, donc il **échoue** si l'entrée n'est pas
appelée, et il lance les 6 commandes réelles du manifeste sur effet observable :

```
ok 5 - test\hooks-config.test.js   [28 checks passed.]      (16:08Z, sans shim)
t21-f2.log  exit 1 « command never calls the exported main() »      (mutation : .main() retiré)
t21-f2b.log exit 1 « wrong script executed »                        (entrée appelée mais sans effet)
t21-f2-control.log contrôle non muté exit 0, 28 checks passed
t21-double.log : bodyRuns=1 pour les 6 entrées, « no hook body runs twice »
t21-pre-t18.log : copie jetable du dispatch require-sans-.main() -> 6/6 muets (exit 0, stdout 0 o, aucun fichier écrit)
```

Verdict de la revue adverse (t21, tour 2) : **PASS**, `.agent-teams/tw-1/T21-review.md`.

### 8.3 Symptôme 3 — « aucune alerte de quota 5h »

**Avant** (§3.2–§3.3) : le seuil d'alerte était **codé en dur à 90 %** (`ALERT_THRESHOLD = 0.90`
dans `hooks/metrics-writer.js`), le champ `alert` n'était jamais rendu visible, et **aucun seuil 5h
dédié n'existait** — un utilisateur à 96-98 % ne voyait rien dans son flux. H6 (« seuil jamais
atteint ») était réfutée ; l'écart réel était l'absence de seuil 5h configurable.

**Après (G3 v2, rejeu du 16:08Z)** — commande verbatim extraite du manifeste, seuil écrit dans
`config.json` du HOME jetable, `0.95` comme taux de fenêtre 5 h :

```
CAS g3-ups-095-t90 : seuil={"quota-alert-pct":90,"loop-pct":80} session5hPct=0.95 attendu=alerte
COMMANDE VERBATIM UserPromptSubmit[0].hooks[0] : node -e "require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT,'hooks','loop-advisor.js')).main()"
exit=0 error=none signal=none duration_ms=407
stdout[462 o]="{\"hookSpecificOutput\":{\"hookEventName\":\"UserPromptSubmit\",\"additionalContext\":\"[token-watch] 5h quota at 95% — above your quota alert threshold (quota_alert_pct 90%) — reset in 112min (20:00) · session cost $0.20. …\"},\"systemMessage\":\"⏱ token-watch: 5h at 95% — reset in 112min (20:00) · session cost $0.20\"}"
stderr[0 o]=""
CAS g3-ups-095-t90 verdict : exit=0 attendu=alerte conforme=true (JSON valide ; hookSpecificOutput.hookEventName=UserPromptSubmit ; additionalContext=oui ; systemMessage=oui)

CAS g3-stop-095-t90 (Stop[2].hooks[0], même chaîne, event Stop) : exit=0 duration_ms=424 stdout[450 o] hookEventName=Stop conforme=true

CAS g3-ups-050-t90 : session5hPct=0.5 attendu=silence -> exit=0 stdout[0 o]="" conforme=true (stdout vide)
CAS g3-ups-055-t50 : seuil={"quota-alert-pct":50,"loop-pct":80} session5hPct=0.55 attendu=alerte (seuil abaissé)
  stdout[462 o] : …"5h quota at 55% — above your quota alert threshold (quota_alert_pct 50%)"… conforme=true
CAS g3-ups-055-t90 : même taux, seuil par défaut 90 -> exit=0 stdout[0 o]="" conforme=true (stdout vide)
seuil nommé dans la sortie : t90=true t50=true
G3 verdict: 0.95/90 -> alerte=true (UPS), true (Stop) ; 0.50/90 -> silence=true ; 0.55/50 -> true ; 0.55/90 -> true
```

Le seuil **configuré** commande donc l'émission, et le nombre **nommé** dans le message est bien
celui du réglage (`quota_alert_pct 90%` / `quota_alert_pct 50%`), pas une constante.

Les deux autres entrées réellement déclenchées par le `Stop` et le `SessionEnd`, verbatim :

```
COMMANDE VERBATIM Stop[0].hooks[0] : node -e "require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT,'hooks','context-guard.js')).main()"
exit=0 error=none signal=none duration_ms=297
stdout[111 o]="{\"systemMessage\":\"⚠ token-watch: context at 60% (601k/1.0M). Consider running /compact to free up the window.\"}"
CAS g3b verdict : exit=0 stdout=JSON conforme=true

COMMANDE VERBATIM SessionEnd[0].hooks[0] : node -e "require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT,'hooks','session-logger.js')).main()"
exit=0 duration_ms=306 stdout[0 o]=""
AVANT usage.jsonl = 500o / 2 ligne(s)
APRES usage.jsonl = 750o / 3 ligne(s)
dernière ligne = {"ts":"2026-09-24T16:08:17.988Z","session":"sess-g3-end","cwd":"D:\\SolSolis\\claude-token-watch","reason":"other","messages":1,"input":1200,"output":800,"cacheRead":600000,"cacheWrite":0,"cost":0.1956,"models":{"claude-sonnet-4-5-20250929":0.1956}}
CAS g3c verdict : exit=0 appendu=true
```

**Configuration — lecture d'un `config.json` portant un BOM UTF-8** (t23 pour `hooks/context-guard.js`
et `lib/config.js` ; t24 pour `scripts/config.js`). Avant : `JSON.parse` brut, la clé est perdue et
le seuil retombe **silencieusement** sur le défaut. Extraits bruts des rapports :

```
AVANT : node test/quota-alert.test.js  exit 1 « AssertionError …: config.json with a BOM was discarded: the threshold silently fell back to 90 / actual: 90, / expected: 40, »
        node test/hooks-config.test.js exit 1 « AssertionError …: config.json with a BOM was silently discarded (hook stayed mute) »
APRÈS : node test/quota-alert.test.js  exit 0, 32 checks passed.
        node test/hooks-config.test.js exit 0, 28 checks passed.
t24 — CLI : `node scripts/config.js set quota-alert-pct 55` sur un config.json BOM {compact-pct 60, loop-pct 70, quota-alert-pct 40}
        APRÈS : exit 0, fichier réécrit = compact-pct 60, loop-pct 70, quota-alert-pct 55 (aucun BOM ajouté) ; `get` affiche 40% [source: config.json]
        AVANT (lecture brute rétablie) : exit 0 silencieux, fichier APRÈS = { "quota-alert-pct": 55 } — compact-pct 60 et loop-pct 70 DÉTRUITS
```

**Revue adverse tour 3 (t25), bornée à ces deux corrections BOM : `needs_revision` (failed).** Les
deux corrections BOM de t23/t24 passent, mais la revue a établi que la **même classe de perte
silencieuse subsistait par une autre route** — le CLI de configuration réécrivant un `config.json`
qu'il n'avait pas su lire (finding F1 high, plus F2 low sur la racine tableau). Ce défaut est
détaillé et mesuré en **§4.5** ; il a été corrigé par t26 et la revue tour 4 (**t27**) a rendu
**`pass`**. Aucune des deux corrections BOM ci-dessus n'a été retouchée.

**Preuve manquante, signalée :** `quota_5h_pct = 0.95` vient d'un **cache d'usage posé par le
harnais** (`usage-cache.json` du HOME jetable), la récupération réseau étant refusée sous ce bac à
sable. Ce qui est prouvé est la comparaison au seuil configuré, pas l'appel API.

### 8.4 Écart §4.2 — porte G4 (`node --test test/` cassée en l'état)

**Avant** (§4.2, verbatim) : `# tests 1` / `# pass 0` / `# fail 1`, location `test:1:1` — la forme
positionnelle est cassée indépendamment du bac à sable (Node 22.23 résout `test/` comme un fichier
unique) ; la forme correcte est le glob, désormais dans `package.json`.

**Après**, rejeu t10 sur l'arbre corrigé, agrégateur fichier par fichier **sans shim `NODE_OPTIONS`**
(chaque fichier dans son processus, stdio par descripteurs de fichier — les tubes sont refusés ici) :

```
TAP version 13
ok 1 - test\smoke.js   [32 checks passed.]
ok 2 - test\cache-ttl.test.js   [7 checks passed.]
ok 3 - test\config.test.js   [28 passed, 0 failed]
ok 4 - test\disk-cache.test.js   [16 checks passed.]
ok 5 - test\hooks-config.test.js   [28 checks passed.]
ok 6 - test\loop-advisor-cost.test.js   [7 tests passed]
ok 7 - test\loop-advisor.test.js   [9 tests passed]
ok 8 - test\quota-alert.test.js   [32 checks passed.]
1..8
# tests 8
# pass 8
# fail 0
exit=0 (= nombre de fichiers rouges)
détail par fichier : .agent-teams/TW-1/g4-files-noshim/
```

**Rejeu t28, après le commit de suivi (t26 en place)** — mêmes 8 cibles, même méthode, la seule
différence est `test/config.test.js` qui passe de 28 à **34** contrôles (les 6 contrôles in-process
ajoutés par t26 pour le refus d'écraser un config illisible) :

```
ok 1 - test\smoke.js   [32 checks passed.]
ok 2 - test\cache-ttl.test.js   [7 checks passed.]
ok 3 - test\config.test.js   [34 passed, 0 failed]
ok 4 - test\disk-cache.test.js   [16 checks passed.]
ok 5 - test\hooks-config.test.js   [28 checks passed.]
ok 6 - test\loop-advisor-cost.test.js   [7 tests passed]
ok 7 - test\loop-advisor.test.js   [9 tests passed]
ok 8 - test\quota-alert.test.js   [32 checks passed.]
1..8 / # tests 8 / # pass 8 / # fail 0 / exit 0
```

`node test/config.test.js` et `node test/smoke.js` lancés directement sortent aussi en 0
(`34 passed, 0 failed` / `32 checks passed.`). **La porte officielle `npm test` reste refusée dans ce
bac à sable** : le runner de Node re-spawn un processus par fichier avec stdio canalisé et intercepte
`spawn` à son démarrage, donc le shim `NODE_OPTIONS` ne le couvre pas → `# tests 7 / # pass 0 /
# fail 7 / spawn EPERM` (journal `.agent-teams/TW-1/t28-npm-test.log`, mesuré aussi en t10 :
`g4-gate.log`). Le rejeu fichier par fichier ci-dessus n'est pas une porte équivalente officielle :
c'est un substitut local, la mesure hors bac à sable restant celle du capitaine (§8.4, haut de
section).

et la contre-épreuve de la forme fautive, conservée :

```
=== 3. contre-épreuve conservée — `node --test test/` (forme fautive) ===
   # Subtest: test
   location: 'D:\\SolSolis\\claude-token-watch\\test:1:1'
   # tests 1
   # pass 0
   # fail 1
   # cancelled 0
exit=1
```

**Porte officielle `npm test`, rejouée hors bac à sable par le capitaine** (t22 — remplace t6, dont
la seule ligne rouge était `spawn EPERM` du runner) :

```
Commande : npm test  (= node test/smoke.js && node --test "test/*.test.js")
32 checks passed.          ← smoke
ok 1 - test\cache-ttl.test.js
ok 2 - test\config.test.js
ok 3 - test\disk-cache.test.js
# 16 checks passed.        ← disk-cache
ok 4 - test\hooks-config.test.js
# 27 checks passed.        ← hooks-config (au moment du run ; 28 depuis t23/t24)
ok 5 - test\loop-advisor-cost.test.js
ok 6 - test\loop-advisor.test.js
ok 7 - test\quota-alert.test.js
# 29 checks passed.        ← quota-alert (32 depuis t23/t24)
# tests 7 / # pass 7 / # fail 0 / # cancelled 0
exit 0
```

Les deux relevés concordent : les compteurs par fichier ont augmenté après t23/t24 (contrôles BOM),
le rejeu t10 en tient compte.

**G4 de référence — arbre final gelé, mesuré hors bac à sable par le capitaine** (même commande
`npm test`, contrôles BOM de t23/t24 en place) :

```
32 checks passed.                      ← smoke
ok 1 test\cache-ttl.test.js            (7 checks)
ok 2 test\config.test.js               (28 passed, 0 failed)
ok 3 test\disk-cache.test.js           (16 checks)
ok 4 test\hooks-config.test.js         (28 checks)
ok 5 test\loop-advisor-cost.test.js
ok 6 test\loop-advisor.test.js
ok 7 test\quota-alert.test.js          (32 checks)
# tests 7 / # pass 7 / # fail 0 / # cancelled 0
exit 0
```

C'est ce relevé qui fait foi pour la porte : `hooks-config` 28 et `quota-alert` 32 (le transcript de
t22, antérieur aux deux correctifs BOM, portait 27 et 29, comme recopié ci-dessus). Le rejeu t10
fichier par fichier, sur le même arbre, donne exactement les mêmes compteurs. Contre-épreuve
conservée : `node --test test/` → `# tests 1` / `# pass 0` / `# fail 1`, location `test:1:1` —
cassé indépendamment du bac à sable ; la forme correcte est le glob de `package.json:12`.

### 8.5 Pourquoi un `exit 0` ne validait rien (ce que la revue a changé)

La règle est désormais écrite dans le dépôt et testée : `README.md:225` — « the only proof a hook
works is an observable effect », `README.md:249` — « The exit code tells you nothing here », et la
forme de commande documentée est identique caractère pour caractère à `hooks/hooks.json`. Les trois
mutations de t21 (F2) échouent, le contrôle non muté passe (§8.2). C'est ce qui manquait au cycle
précédent : un `exit 0` obtenu avec la forme `-e require` muette était alors indiscernable d'un
succès (verbatim en §8.2 : « exit=0 / stdout vide / fichier inchangé »).

### 8.6 G6 sur ces contre-épreuves

Toutes les exécutions de §8 utilisent `HOME = USERPROFILE` dans un répertoire jetable du dépôt
(`.agent-teams/TW-1/home-t10`, `home-g2g3`) ; le vrai `C:\Users\carma\.claude` n'est que **lu** :

```
=== 4. ~/.claude réel (C:\Users\carma\.claude) — mtimes après coup ===
INCHANGÉ   …\token-watch\config.json  2026-06-21T10:54:18.378Z  size=24
INCHANGÉ   …\token-watch\config.yaml  2026-06-22T08:09:03.206Z  size=29
INCHANGÉ   …\token-watch\loop-advisor-last.json  2026-09-23T21:12:48.270Z  size=20
INCHANGÉ   …\token-watch\metrics.json  2026-09-24T12:51:48.697Z  size=171
INCHANGÉ   …\token-watch\plan-cache.json  2026-06-19T09:52:24.960Z  size=54
INCHANGÉ   …\token-watch\precompact-state.json  2026-09-23T07:06:05.092Z  size=179
INCHANGÉ   …\token-watch\usage-cache.json  2026-09-24T14:11:35.524Z  size=228
INCHANGÉ   …\token-watch\usage.jsonl  2026-09-21T06:05:29.002Z  size=41703
INCHANGÉ   …\.credentials.json  2026-09-24T14:10:25.670Z  size=10151
(+ 8 résidus usage-cache.json.tmp-*, tous INCHANGÉS)
fichiers modifiés dans le vrai ~/.claude : 0
=== 5. git status --porcelain = 23 entrées (inchangé) ===
```

La vérification de contrat `node hooks/loop-advisor.js` (dernier bloc de `g2g3v2-raw.log`) est elle
aussi lancée avec le HOME jetable : avec le vrai HOME elle créerait `loop-advisor-last.json`, ce qui
violerait G6.

```
--- verify-loop-advisor
cmd.exe invocation: <cmd> /d /s /c "node hooks/loop-advisor.js" (stdio: fd0=verify-loop-advisor.stdin fd1=…out fd2=…err)
exit=0 error=none signal=none duration_ms=340
stdout[0 o]=""      stderr[0 o]=""
verdict verify : exit=0 (HOME=D:\SolSolis\claude-token-watch\.agent-teams\TW-1\home-g2g3)
```

---

## 9. Reste à valider — hors dépôt (action attendue du Fondateur)

Ces points **ne sont pas observables dans le dépôt** : ni par un test, ni par une commande du lot.
Ils sont listés avec l'action exacte qui les tranche. **L'équipe n'installe ni ne réinstalle le
plugin, ne crée aucune session `claude` et n'écrit rien dans `~/.claude/`** (G6) — c'est le
Fondateur qui exécute ce qui suit.

1. **H9 — les hooks du plugin sont-ils seulement chargés au démarrage de session ?** (§2.9,
   hypothèse principale restante pour la mutité d'origine.) Contre-épreuve :

   ```
   claude --debug
   ```

   puis, dans la sortie, chercher la ligne :

   ```
   Loading hooks from plugin: token-watch
   ```

   - ligne **présente** → les hooks sont chargés ; la mutité observée avant réparation venait du
     dispatch (cause désormais corrigée, prouvée en §8.2/§8.5) ;
   - ligne **absente** → défaut de chargement côté Claude Code, hors périmètre du dépôt : à
     rapporter en amont, le correctif du lot ne peut pas le couvrir.

2. **G5 — session interactive après réinstallation** (`/plugin update`, ou réinstallation du
   plugin). À vérifier, dans cet ordre :
   - **statusline visible** dans le terminal (le champ est déclaré dans `~/.claude/settings.json`,
     voir §8.1 : le manifeste du plugin ne peut plus le porter) ;
   - **`metrics.json` réécrit après un outil** (`PostToolUse`) : `~/.claude/token-watch/metrics.json`
     change de `mtime` après un appel d'outil et son `ts` avance ;
   - **avertissement au-delà du seuil** : poser `quota_alert_pct` (env `TOKEN_WATCH_QUOTA_ALERT_PCT`,
     ou `token-watch-config set quota-alert-pct <n>`) sous le taux de la fenêtre 5 h et vérifier le
     message `⏱ token-watch: 5h at …%` (§8.3 donne le comportement attendu, mesuré hors session).

   La réinstallation est nécessaire parce que le plugin installé est la version **0.3.6** de HEAD
   (§0) : sans elle, la session continue d'exécuter l'état cassé.

3. **Rendu TUI de la statusline (H2)** — §8.1 prouve que la commande rend une ligne ; que l'UI
   l'affiche sous Claude Code / Windows ne peut pas être constaté ici (issues #52997, #57940). Si la
   ligne est vide en session alors que la commande rend bien sa ligne à la main, le défaut est côté
   Claude Code, pas dans le dépôt.

4. **Deux notes de basse sévérité laissées ouvertes, non corrigées par le lot** (revue adverse
   tour 2, findings F7/F8). Elles ne bloquent pas la réparation demandée et ne sont pas des
   défauts de dépôt observables dans le dépôt seul ; elles sont portées ici pour ne pas être perdues :
   - **(a) charges utiles sans `session_id`.** Deux entrées consécutives dépourvues de `session_id`
     partagent la clé de cooldown `''` ; la seconde alerte est alors **étouffée** par le délai de
     réémission (30 min), au lieu d'être rapportée. Le déclencheur réel fournit toujours
     `session_id` ; le cas n'est donc atteignable que par une invocation manuelle du hook.
   - **(b) aucun `timeout` déclaré dans `hooks/hooks.json`.** Les entrées dépendent de `main()`, qui
     lit `fd 0` de façon **bloquante** : si le déclencheur n'écrit pas de charge utile sur l'entrée
     standard, la commande attend indéfiniment. Les entrées de `~/.claude/settings.json` du poste
     déclarent, elles, un `timeout` (10 s pour le hook Orca, §2.7) — le manifeste du plugin, non.

   À trancher plus tard : ajouter `timeout` aux entrées du manifeste, et clé de cooldown par défaut
   dérivée du PID (ou désactivation du cooldown) quand `session_id` est absent.

---

## 10. Réserves portées au lot

1. **Sondes hors `npm test` (constat t16/t17).** `test/guard-probe.js` et
   `test/statusline-probe.js` **écrivaient dans le vrai `~/.claude`** : `precompact-state.json` via
   `hooks/context-guard.js:63,76,77`, et `usage-cache.json` via `statusline/statusline.js:160` →
   `lib/usage-api.js:146`. Elles restent **hors de `npm test`** (ce ne sont pas des `*.test.js`) et
   exigent depuis t17 un opt-in explicite :

   ```
   TOKEN_WATCH_PROBE_ALLOW_REAL_HOME=1
   ```

   Sans lui, elles écrivent un message sur `stderr` (« writes to the real ~/.claude
   (precompact-state.json) » / « reads/writes the real ~/.claude (usage-cache.json,
   .credentials.json) » + « Refusing to run. Set TOKEN_WATCH_PROBE_ALLOW_REAL_HOME=1 to allow it. »)
   et sortent en **1**, stdout vide — donc ni spawn du hook, ni appel à `getUsage()`.

   **Conséquence opérationnelle : aucune commande de ce lot ne doit être lancée sans `HOME` (et
   `USERPROFILE`) détourné.** `node hooks/loop-advisor.js` seul écrit `loop-advisor-last.json` dans
   le vrai `~/.claude/token-watch/`.

2. **`.agent-teams/` et `.conductor/` ne sont pas versionnés** (§4.4 : absents de `.gitignore`).
   Traitement retenu : **staging explicite fichier par fichier**, jamais `git add -A`, `git add .`
   ni `git commit -a` ; `.gitignore` **non modifié** (le dépôt ne gagne aucune ligne d'exclusion).
   Vérification faite avant chaque commit : `git status --porcelain` et
   `git diff --cached --name-only` ne contiennent que des chemins autorisés (voir le rapport de
   clôture).

3. **Limites d'environnement de ce lot.** (a) Le bac à sable refuse le stdio canalisé : toutes les
   commandes de hook sont lancées via `cmd.exe /d /s /c` avec des **descripteurs de fichier**, ce
   qui capture les mêmes octets (sonde `probe-stdio.js`) — mais ce n'est pas le chemin du
   déclencheur de Claude Code. (b) `${CLAUDE_PLUGIN_ROOT}` est substitué par Claude Code, jamais par
   `cmd.exe` : pour la forme HEAD, la substitution a été faite par le harnais et c'est écrit dans le
   journal. (c) Aucun accès réseau : `quota_5h_pct` vient d'un cache posé par le harnais (§8.3).
   (d) `npm test` avec le runner `node --test` est refusé ici (`spawn EPERM`) — d'où le rejeu
   fichier par fichier (§8.4) et la porte officielle hors bac à sable de t22.

4. **F7/F8 portés par la revue t21, non traités par le lot (basse sévérité).** Deux charges utiles
   sans `session_id` partagent la clé `''` et la seconde est étouffée par l'anti-spam ; aucun
   `timeout` n'est déclaré alors que les `main()` lisent `fd 0` en synchrone. Détaillés en **§9.4**,
   signalés et non corrigés (hors périmètre de la réparation demandée).
5. **Publication de la branche par l'API GitHub, pas par `git push`.** Dans ce bac à sable,
   `git push` est impossible : backend `schannel` en échec sur
   `AcquireCredentialsHandle … SEC_E_NO_CREDENTIALS`, backend `openssl` sans la racine du certificat
   d'interception, et binaires MSYS (`openssl`, `tar`) qui meurent sur
   `CreateFileMapping … Win32 error 5`. La branche a donc été créée via l'API Git Data (`gh`, TLS
   propre) : blobs, arbre (`base_tree` = arbre de `main`), puis commit aux métadonnées identiques —
   l'oid distant est **égal** à l'oid local (arbre, parent, auteur/committer et message identiques,
   saut de ligne final compris). Le commit local et le commit distant sont le même objet ; un
   `git fetch` hors de ce bac à sable récupère la branche normalement.
