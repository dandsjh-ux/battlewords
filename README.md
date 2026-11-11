# ⚓ Word Fleet

A multiplayer, battleship-style **word game** for 2–6 players, built with three.js.
Every ship hides a secret word. Captains take turns firing **letters** at an enemy fleet — every ship containing that letter takes damage, so smart captains avoid repeating letters across their ships!

## How to play

1. The host creates a room and shares the 4-letter code (players can also open `your-site/?room=CODE`).
2. Everyone builds a secret fleet: one word per ship, matching the ship's length (🎲 gives a random word).
3. On your turn, pick an enemy fleet and fire a letter (click or type it, then press **Enter**).
   - Every copy of that letter in that fleet is hit and revealed in flames.
   - Or fire a **torpedo**: guess a whole word. Correct = instant sink + bonus.
4. Earn coins for hits (+10 per letter), sinks (+25) and torpedoes (+30). Spend them in the shop **at any time**.
5. The battle continues until every fleet but one is sunk — the last fleet afloat wins.

### Shop

| Item | Type | Cost | Effect |
|---|---|---|---|
| 🛡️ Shield | Defence | 40 | Blocks the next attack that uses a chosen letter (max 3) |
| 🧯 Extinguisher | Defence | 25 | Puts out one burning letter — it is hidden from enemies again |
| 🌫️ Smoke Screen | Defence | 50 | The next attack on you (letter or torpedo) misses |
| ↩️ Counter-Battery | Defence | 55 | The next letter fired at you is fired straight back |
| ✈️ Recon Plane | Attack | 20 | Shows how many vowels are in each of a player's ships (private) |
| 📡 Sonar Ping | Attack | 35 | Secretly reveals one hidden letter in a player's fleet |
| 🎯 Double Shot | Attack | 45 | One extra shot this turn (your turn only) |
| 💣 Barrage | Attack | 70 | Your next letter hits every opponent at once (your turn only) |

### Host options

Turn timer (off–120 s) · fleet size (3–6 ships) · word lengths (short / standard / long) · starting coins · coins per turn · shop on/off (all, defences only, attacks only) · dictionary check (offline word list, real words only) · torpedo on/off.

**Teacher mode:** tick "Teacher mode" when creating a room to host without playing. The teacher sees every fleet's words during setup, can send a fleet back with "Ask to change", can force-start with random words for anyone not ready, and can reveal all words during the battle (don't project that screen!).

## Run locally

Needs Node.js 18 or newer. There are **no npm dependencies** (the WebSocket server is built in).

```bash
npm start
# open http://localhost:3000 in several browser tabs
```

Tests: `npm test` runs a bot-played game against the server.

## Deploy: GitHub → Render

1. Create a new GitHub repository (e.g. `wordfleet`) and upload all files in this folder:
   ```bash
   git init
   git add .
   git commit -m "Word Fleet"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/wordfleet.git
   git push -u origin main
   ```
2. On [render.com](https://render.com): **New → Web Service** → connect the repo.
3. Settings: Runtime **Node**, Build command `npm install`, Start command `npm start`, Instance type **Free**.
   (Or choose **New → Blueprint** and Render will read `render.yaml` automatically.)
4. Open the `.onrender.com` URL and share it with your class.

Notes: Render's free tier sleeps after ~15 minutes of no visitors — open the site a minute before class so it wakes up. Games live in memory, so a redeploy or restart ends any game in progress.

## Files

```
server.js         HTTP static server + WebSocket rooms
lib/game.js       Game rules, turns, shop, scoring (server-authoritative)
lib/ws.js         Minimal WebSocket implementation
lib/words.js      Built-in kid-friendly word bank (2–9 letters)
lib/dictionary.js Offline dictionary check (lib/dictionary.txt, ~72k words from SCOWL)
public/index.html Screens and HUD
public/style.css  Styles
public/js/main.js UI + networking
public/js/scene.js three.js ocean, islands, fleets and effects
public/js/audio.js Synthesised sound effects
```
