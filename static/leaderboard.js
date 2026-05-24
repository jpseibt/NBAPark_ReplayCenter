const SERVER_URL = window.location.protocol + "//" + window.location.host;

const socket = io(SERVER_URL, {
  auth: { client_id: "leaderboard" }
});

const ranking_list = document.getElementById("ranking-list");
const title = document.getElementById("leaderboard-title");

socket.on("connect", () => {
  console.log("Leaderboard Engine Connected.");
});

// The Render Loop
socket.on("state_update", (game_state) => {
  // Always clear the board before drawing the new frame
  ranking_list.innerHTML = "";

  if (game_state.stage === 0) {
    title.innerText = "WAITING FOR NEXT GAME...";
  }
  else if (game_state.stage === 1 || game_state.stage === 2) {
    title.innerText = "MATCH IN PROGRESS...";
  }
  else if (game_state.stage === 3) {
    title.innerHTML = `<span class=glow-text>FINAL STANDINGS</span>`;

    // 1. Filter AFK players, copy the array and sort it
    const active_players = game_state.players.filter(p => p.is_playing).sort((a, b) => b.score - a.score);

    // 2. Loop through the sorted array and push geometry to the DOM
    active_players.forEach((player, index) => {
      const player_num = player.id.replace("player", "");

      const row = document.createElement("div");
      if (index < 3)
        row.className = `player-row rank-${index}`;
      else
        row.className = `player-row rank-other`;

      const name_div = document.createElement("div");
      name_div.className = "player-name";
      name_div.innerHTML = `<span class="glow-text">PLAYER ${player_num}</span>`;

      const score_div = document.createElement("div");
      score_div.innerHTML = `<span class="glow-text">${player.score} PTS</span>`;

      row.appendChild(name_div);
      row.appendChild(score_div);
      ranking_list.appendChild(row);
    });
  }
});
