/* Version history, newest first. Add a new entry at the top for every update. */
const RELEASES = [
  { version: "2.8", title: "Economy, sides, opening duels and version history", items: [
    "Economy: round win rate for pistol, eco, force-buy and full-buy rounds, and your team's average spending.",
    "Attack and defence: rounds won and K/D on each side, for all maps and per map.",
    "Opening duels and trades: first bloods and first deaths, how often you win the round after each, and how often deaths are avenged within 5 seconds.",
    "Version history, here.",
  ] },
  { version: "2.7", title: "Weapons", items: [
    "A Weapons card in Stats: most used, most kills, most kills per round and deadliest against you.",
    "Per weapon: rounds, kills, kills per round, damage per round, headshot percentage and how often it killed you.",
    "Multi-kill rounds: 2K, 3K, 4K and aces.",
  ] },
  { version: "2.6", title: "Clearer charts", items: [
    "Smooth trend curves with a dot for every match, coloured by win or loss.",
    "A clean tooltip with a pointer, a guide line and a highlighted dot when you hover or tap.",
    "Softer dot colours in light mode.",
  ] },
  { version: "2.5", title: "Smarter rank goal", items: [
    "Estimates now replay the climb 1,500 times using the RR you really gained and lost, instead of one fixed average.",
    "Shows your chance to rank up next game, a dot plot of your recent wins and how many games it takes at different win rates.",
    "The Compare tab uses the same calculation.",
  ] },
  { version: "2.4", title: "Player profiles from matches", items: [
    "Select a player in a match to open their profile or save them as a favorite.",
    "A \"Back to\" link takes you home again.",
  ] },
  { version: "2.3", title: "Valtrack", items: [
    "New name and subtitle: Valtrack, analyse your games and see your progress. Credit line added.",
    "How to use and FAQ, with a tip about swiping between tabs on phones.",
    "Tied games now show as draws instead of losses.",
    "The refresh icon spins while loading, and gives feedback even when the data is fresh.",
    "A small, non-blocking notice about where your data is saved.",
  ] },
  { version: "2.2", title: "New navigation", items: [
    "A calm top bar with tabs. On phones, a floating Menu opened with the three bars.",
    "Star, refresh and light/dark buttons are plain icons, also in the phone top bar.",
    "Dark mode with three calm layers, and an account menu that is translucent without a glow.",
  ] },
  { version: "2.1", title: "Your history is kept and the API is spared", items: [
    "Every match you fetch is kept; storage trims only old player details when the browser is full.",
    "Automatic refreshes at most every 10 minutes, the button at most every minute, and a pause when the data source asks us to slow down.",
    "Rank and region lookups are remembered, backup reminders added, and export includes rank history.",
  ] },
  { version: "2.0", title: "Progress and insights", items: [
    "A Progress tab with trend charts, rank history and a rank goal.",
    "Today's session on Overview, with a gentle warning after three losses in a row.",
    "Highlights (best and weakest map and agent) and a teammates list.",
    "Dark mode, install as an app with offline support, and loading placeholders.",
  ] },
  { version: "1.7", title: "Match details", items: [
    "Every player in a match: rank, agent, K/D/A, ACS, damage per round, headshot percentage and first bloods.",
    "Who dominated who: kills and deaths against each opponent.",
  ] },
  { version: "1.6", title: "Tabs and clean-up", items: [
    "Overview, Matches, Stats and Compare as tabs, with swipe left or right to change tab on phones.",
    "One tidy stylesheet and shared code, and a comparison layout where nothing can overlap.",
  ] },
  { version: "1.5", title: "Compare, ranks and mobile", items: [
    "Rank badges, K/D in the match log and per map, Competitive as the default game mode and the last 20 matches with Show all.",
    "Compare ranks with another player, also from your favorites, with a rough games-to-catch-up estimate.",
    "A layout that resizes for phones.",
  ] },
  { version: "1.4", title: "Plain and humble", items: [
    "Login removed: everything is saved in your browser, and a notice says so.",
    "Simpler look, with no logo seal or decorative taglines.",
  ] },
  { version: "1.3", title: "New look and optional login", items: [
    "A look inspired by The Knife Codex, and an optional Google sign-in with Supabase. The sign-in was removed again in 1.4.",
  ] },
  { version: "1.2", title: "Your Claude Code update", items: [
    "Favorites, rank panel (current, peak, RR), game mode filter, import and export, newest-first match order and a 20-match form chart.",
  ] },
  { version: "1.1", title: "Lookup by Riot ID", items: [
    "Opens straight from a file without a server, with a Japandi look.",
    "Enter your username and tag, in separate fields, to load your matches from HenrikDev.",
  ] },
  { version: "1.0", title: "First version", items: [
    "An index page, a JSON file and a JavaScript file: log matches by hand, see stats per agent and map, saved in your browser.",
  ] },
];
