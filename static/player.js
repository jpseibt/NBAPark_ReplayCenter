let local_lang = "pt";

const UI_STRINGS = {
  "en": {
    "waiting": "Waiting for Admin to start the game...",
    "confirm": "CONFIRM ANSWER",
    "locked": "Answer Locked! Waiting for others...",
    "correct": "CORRECT!",
    "wrong": "WRONG!",
    "timeout": "Time's up! You didn't confirm an answer.",
    "game_over": "Game Over!",
    "leaderboard": "Look at the main screen for the final results!"
  },
  "pt": {
    "waiting": "Aguardando o Administrador iniciar o jogo...",
    "confirm": "CONFIRMAR RESPOSTA",
    "locked": "Resposta Confirmada! Aguardando os outros...",
    "correct": "CORRETO!",
    "wrong": "ERRADO!",
    "timeout": "Tempo esgotado! Você não confirmou a resposta.",
    "game_over": "Fim de Jogo!",
    "leaderboard": "Veja o resultado final na tela principal!"
  },
  "es": {
    "waiting": "Esperando a que el Administrador inicie el juego...",
    "confirm": "CONFIRMAR RESPUESTA",
    "locked": "¡Respuesta confirmada! Esperando a los demás...",
    "correct": "¡CORRECTO!",
    "wrong": "¡INCORRECTO!",
    "timeout": "¡Se acabó el tiempo! No confirmaste una respuesta.",
    "game_over": "¡Juego terminado!",
    "leaderboard": "Mira la pantalla principal para ver los resultados finales."
  }
};

// Reference to the latest state to re-render if an user switch languages mid-question
let latest_game_state = null;

window.setLanguage = function(lang_code) {
  local_lang = lang_code;
  // If the game is running, immediately re-render the screen with the new language
  if (latest_game_state) {
    renderFrame(latest_game_state);
  }
};

// 1. Hardware Identity
const PLAYER_ID = window.location.pathname.substring(1);
const PLAYER_NUM = PLAYER_ID.replace("player", "");
const SERVER_URL = window.location.protocol + "//" + window.location.host;

document.title = `[${PLAYER_ID}] ${document.title}`;
document.getElementById("player-badge").innerHTML = `<span class="glow-text">PLAYER ${PLAYER_NUM}</span>`;

// --- AUDIO SYSTEM INITIALIZATION ---
const question_audio_src_dir = "/static/question_audio";
const question_audio = new Audio(`${question_audio_src_dir}/0.mp3`);
let last_played_question_db_id = -1;

function lockFullScreen() {
  const doc = window.document.documentElement;
  // Check for vendor prefixes if running an older Chromium build
  const requestFullScreen = doc.requestFullscreen || doc.webkitRequestFullscreen || doc.mozRequestFullScreen || doc.msRequestFullscreen;

  if (requestFullScreen) {
    requestFullScreen.call(doc).catch(err => {
      console.warn("Fullscreen request denied by browser:", err);
    });
  }
}

// THE GESTURE TRAP (force audio context to unlock and activate full-screen mode)
document.getElementById("join-overlay").addEventListener("click", () => {
  question_audio.play().then(() => {
    question_audio.pause();
    question_audio.currentTime = 0;
  }).catch(err => console.error("Audio unlock failed:", err));

  lockFullScreen();

  document.getElementById("join-overlay").style.display = "none";
  document.getElementById("game-container").style.display = "block";
});

// Initialize the WebSocket
const socket = io(SERVER_URL, {
  auth: { client_id: PLAYER_ID }
});

// DOM Elements
const question_text = document.getElementById("question-text");
const options_container = document.getElementById("options-container");
const action_container = document.getElementById("action-container");

// 2. The Render Loop (Reacting to Server Authority)
socket.on("state_update", (game_state) => {
  latest_game_state = game_state;
  renderFrame(game_state);
});

function renderFrame(game_state) {
  const my_player = game_state.players.find(p => p.id === PLAYER_ID);
  if (!my_player) return;

  // Clear the screen for redrawing
  options_container.innerHTML = "";
  action_container.innerHTML = "";

  // --- STATE: IDLE ---
  if (game_state.stage === 0) {
    question_text.innerText = UI_STRINGS[local_lang].waiting;
    last_played_question_db_id = -1;
    return;
  }

  // --- STATE: QUESTION ACTIVE ---
  if (game_state.stage === 1) {
    question_text.innerText = game_state.question_text[local_lang];

    // Edge-triggered audio playback
    if (game_state.question_db_id !== last_played_question_db_id) {
      question_audio.src = `${question_audio_src_dir}/${game_state.question_db_id}.mp3`;
      question_audio.play().catch(e => console.error(`Playback failed:`, e));
      last_played_question_db_id = game_state.question_db_id;
    }

    // Render the alternatives
    game_state.options[local_lang].forEach((option_string, index) => {
      const btn = document.createElement("button");
      btn.className = "btn btn-option";
      btn.innerText = option_string;

      if (my_player.is_confirmed) {
        btn.disabled = true;
      } else {
        btn.onclick = () => socket.emit("select_option", index);
      }

      if (my_player.selected_option === index) {
        btn.classList.add("selected");
      }

      options_container.appendChild(btn);
    });

    // Render the Confirm Button
    if (my_player.selected_option !== -1 && !my_player.is_confirmed) {
      const confirm_btn = document.createElement("button");
      confirm_btn.className = "btn btn-option btn-confirm";
      confirm_btn.innerHTML = `<span class="glow-text">${UI_STRINGS[local_lang].confirm}</span>`;
      confirm_btn.onclick = () => socket.emit("confirm_option");
      action_container.appendChild(confirm_btn);
    }

    // Visual feedback if locked in
    if (my_player.is_confirmed) {
      const locked_text = document.createElement("h3");
      locked_text.style.color = "#00aaff";
      locked_text.innerText = UI_STRINGS[local_lang].locked;
      action_container.appendChild(locked_text);
    }
  }

  // --- STATE: REVEAL ---
  if (game_state.stage === 2) {
    question_text.innerText = game_state.question_text[local_lang];

    const answered_right = my_player.is_confirmed && (my_player.selected_option === game_state.correct_idx);

    game_state.options[local_lang].forEach((option_string, index) => {
      const btn = document.createElement("button");
      btn.className = "btn btn-option";
      btn.innerText = option_string;
      btn.disabled = true;

      if (index === game_state.correct_idx) {
        btn.classList.add("btn-correct");
      }
      else if (index === my_player.selected_option && !answered_right) {
        btn.classList.add("btn-wrong");
      }

      options_container.appendChild(btn);
    });

    // Provide text feedback
    const feedback_text = document.createElement("div");
    feedback_text.className = "feedback-text";

    if (!my_player.is_confirmed) {
      feedback_text.innerText = UI_STRINGS[local_lang].timeout;
      feedback_text.style.color = "#aaaaaa";
    } else if (answered_right) {
      feedback_text.innerText = UI_STRINGS[local_lang].correct;
      feedback_text.style.color = "#28a745";
    } else {
      feedback_text.innerText = UI_STRINGS[local_lang].wrong;
      feedback_text.style.color = "#dc3545";
    }

    action_container.appendChild(feedback_text);
  }

  // --- STATE: LEADERBOARD ---
  if (game_state.stage === 3) {
    question_text.innerText = UI_STRINGS[local_lang].game_over;

    const final_text = document.createElement("div");
    final_text.className = "feedback-text";
    final_text.innerText = UI_STRINGS[local_lang].leaderboard;
    final_text.style.color = "#00aaff";

    action_container.appendChild(final_text);
  }

}
