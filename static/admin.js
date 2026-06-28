const SERVER_URL = window.location.protocol + "//" + window.location.host;

let latest_game_state = null;

const socket = io(SERVER_URL, {
  auth: { client_id: "admin" }
});

// DOM Elements
const online_stats = document.getElementById("online-stats");

const btn_start = document.getElementById("btn-op-start");
const btn_replay = document.getElementById("btn-op-replay");
const btn_reveal = document.getElementById("btn-op-reveal");
const btn_results = document.getElementById("btn-op-results");
const btn_reset = document.getElementById("btn-op-reset");
const btn_trans_rev = document.getElementById("btn-trans-rev");
const btn_trans_pause= document.getElementById("btn-trans-pause");
const btn_trans_fwd = document.getElementById("btn-trans-fwd");
const btn_trans_speed = document.getElementById("btn-trans-speed");
const btn_video_1 = document.getElementById("btn-video-1");
const btn_video_2 = document.getElementById("btn-video-2");
const btn_video_3 = document.getElementById("btn-video-3");
const btn_video_4 = document.getElementById("btn-video-4");
const btn_video_all = document.getElementById("btn-video-all");

const preview_stage = document.getElementById("preview-stage");
const preview_text = document.getElementById("preview-text");
const matrix_body = document.getElementById("matrix-body");

const confirm_dialog = document.getElementById("confirm-dialog");
const dialog_message = document.getElementById("dialog-message");
const btn_cancel = document.getElementById("dialog-btn-cancel");
const btn_confirm = document.getElementById("dialog-btn-confirm");

let pending_command = null; // Stores destructive commands for confirmation

// Dialog Handlers
btn_cancel.onclick = () => {
  pending_command = null;
  confirm_dialog.close(); // Hides the dialog
};

btn_confirm.onclick = () => {
  if (pending_command) {
    socket.emit("admin_command", { action: pending_command });
    pending_command = null;
  }
  confirm_dialog.close();
};

// Network Event Listeners
socket.on("connect", () => {
  console.log("Operator Console ONLINE");
});

socket.on("disconnect", () => {
  console.log("Operator Console OFFLINE");
  online_stats.innerText = "Network: OFFLINE (Server Disconnected)";
  online_stats.style.color = "red";
});

// Command Emitter
window.send_command = function(action_string) {
  // Show dialog to confirm destructive commands
  if (action_string === "RESULTS" && latest_game_state.stage !== 3) {
    if (latest_game_state.stage != 0) {
      pending_command = action_string;
      dialog_message.innerText = "End the game and show the final leaderboard?";
      confirm_dialog.showModal();
    }
    return;
  }
  else if (action_string === "RESET") {
    pending_command = action_string;
    dialog_message.innerText = "Reset scores and shuffle questions for new session?";
    confirm_dialog.showModal();
    return;
  }

  // Send non-destructive commands right away
  socket.emit("admin_command", { action: action_string });
};

// Helper array to convert 0,1,2,3 into A,B,C,D
const LETTERS = ["A", "B", "C", "D", "E", "F"];
const SPEED_AMT = ["1.0x", "0.5x", "0.25x", "2.0x"];

// Render
socket.on("state_update", (game_state) => {
  latest_game_state = game_state;
  renderFrame(game_state);
});

function renderFrame(game_state) {
  const curr_stage = game_state.stage;

  // Calculate Network Health
  const online_count = game_state.players.filter(p => p.is_online).length;
  online_stats.innerText = `Network: ${online_count}/6 Online`;
  online_stats.style.color = online_count === 6 ? "green" : "orange";

  //------------------------------
  // Update buttons and preview fields based on the stage
  //
  const selected_videos = game_state.selected_videos || [1, 2, 3, 4];
  const video_select_buttons_disabled = (curr_stage === 0 || curr_stage === 3)
  const trans_buttons_disabled = (curr_stage === 0 || curr_stage === 3 || selected_videos.length < 1);
  const play_direction = game_state.trans_playdirection;

  // START, REPLAY, REVEAL, RESULST, and RESET buttons
  btn_start.disabled = (curr_stage === 1 || curr_stage === 3);
  btn_replay.disabled = (curr_stage === 0 || curr_stage === 3);
  btn_reveal.disabled = (curr_stage !== 1);
  btn_results.disabled = (curr_stage === 0 || curr_stage === 3);
  btn_reset.disabled = false;

  // Video transport buttons
  btn_trans_rev.disabled = trans_buttons_disabled;
  btn_trans_pause.disabled = trans_buttons_disabled;
  btn_trans_fwd.disabled = trans_buttons_disabled;
  btn_trans_speed.disabled = trans_buttons_disabled;

  // Transport buttons down/pressed updates
  // Directions: 0 = Reverse, 1 = Pause, 2 = Forward
  // Speed: SPEED_AMT array
  btn_trans_rev.classList.toggle("is-down", play_direction === 0);
  btn_trans_pause.classList.toggle("is-down", play_direction === 1);
  btn_trans_fwd.classList.toggle("is-down", play_direction === 2);
  btn_trans_speed.innerHTML = `<span class="glow-text">${SPEED_AMT[game_state.trans_speed_idx]}</span>`;

  // Video select buttons
  btn_video_1.disabled = video_select_buttons_disabled;
  btn_video_2.disabled = video_select_buttons_disabled;
  btn_video_3.disabled = video_select_buttons_disabled;
  btn_video_4.disabled = video_select_buttons_disabled;
  btn_video_all.disabled = video_select_buttons_disabled;
  btn_video_1.classList.toggle("is-down", selected_videos.includes(1));
  btn_video_2.classList.toggle("is-down", selected_videos.includes(2));
  btn_video_3.classList.toggle("is-down", selected_videos.includes(3));
  btn_video_4.classList.toggle("is-down", selected_videos.includes(4));

  //------------------------------
  // Update preview fields based on the stage
  //
  // Update Question Preview
  const stages = ["IDLE", "QUESTION ACTIVE", "REVEAL", "LEADERBOARD"];
  preview_stage.innerText = `STAGE: ${stages[curr_stage]}`;

  if (curr_stage === 0) {
    preview_text.innerText = "Awaiting game start...";
  } else if (curr_stage === 2) {
    preview_text.innerText = `${LETTERS[game_state.correct_idx]}: ${game_state.options["pt"][game_state.correct_idx]}`;
  } else if (curr_stage === 3) {
    preview_text.innerText = "Displaying Final Leaderboard";
  } else {
    preview_text.innerText = `Q${game_state.curr_question_idx + 1}: ${game_state.question_text["pt"]}`;
  }

  //------------------------------
  // Render the Player Matrix
  //
  matrix_body.innerHTML = ""; // Clear old frame

  game_state.players.forEach(player => {
    const tr = document.createElement("tr");

    // Dimm player slots that are "not playing"
    if (!player.is_playing || !player.is_online) {
      tr.style.opacity = "0.4";
    }

    // Col 1: Name
    const td_name = document.createElement("td");
    td_name.innerText = player.id.toUpperCase();

    // Col 2: Network
    const td_net = document.createElement("td");
    td_net.innerText = player.is_online ? "Connected" : "Offline";

    // Col 3: Score
    const td_score = document.createElement("td");
    td_score.innerText = player.score;

    // Col 4: Selection
    const td_sel = document.createElement("td");
    if (player.selected_option === -1) {
      td_sel.innerText = "-";
      td_sel.style.color = "#555";
    } else {
      td_sel.innerText = `Option ${LETTERS[player.selected_option]}`;
    }

    // Col 5: Lock Status
    const td_lock = document.createElement("td");
    if (curr_stage === 1) {
      if (player.is_confirmed) {
        td_lock.innerText = "LOCKED IN";
        td_lock.className = "status-locked";
      } else {
        td_lock.innerText = "Thinking...";
        td_lock.className = "status-waiting";
      }
    } else {
      td_lock.innerText = "-";
      td_lock.style.color = "#555";
    }

    // Append cells to row, row to table
    tr.appendChild(td_name);
    tr.appendChild(td_net);
    tr.appendChild(td_score);
    tr.appendChild(td_sel);
    tr.appendChild(td_lock);

    matrix_body.appendChild(tr);
  });
}
