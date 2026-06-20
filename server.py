from enum import IntEnum
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pythonosc.udp_client import SimpleUDPClient

import json
import os
import random
import socketio
import uvicorn

#==================================================
# PRIVATE MEMORY (Server Authority Only)
#==================================================
# Load questions from JSON into an array in memory on boot
try:
  with open("questions.json", "r", encoding="utf-8") as f:
    QUESTION_DB = json.load(f)
    print(f"[SYSTEM] Loaded {len(QUESTION_DB)} questions into memory.")
except FileNotFoundError:
  print(f"[SYSTEM] ERROR - questions.json not found. Exiting...")
  exit(1)

class GameStage(IntEnum):
  IDLE = 0
  QUESTION_ACTIVE = 1
  REVEAL = 2
  LEADERBOARD = 3

# Pre-allocate the list of dictionaries for 6 players
INITIAL_PLAYERS = [
  {
    "id": f"player{i}",
    "is_online": False,
    "is_playing": False,
    "selected_option": -1,
    "is_confirmed": False,
    "score": 0
  }
  for i in range(1, 7)
]


#==================================================
# PUBLIC MEMORY (Broadcasted to Clients)
#==================================================
game_state = {
  "stage": GameStage.IDLE.value, # Store the raw integer
  "curr_question_idx": -1,       # Traversal index (0, 1, 2, ...)
  "question_db_id": -1,          # Maps to QUESTION_DB ID
  "question_text": "",           # The string the tablets will render
  "options": [],                 # The array of strings for the buttons
  "correct_idx": -1,             # -1 when hidden, updated on REVEAL
  "players": INITIAL_PLAYERS
}


#==================================================
# HARDWARE INTEGRATION (OSC)
#==================================================
# Resolume Arena runs locally on the server PC
try:
  resolume_client = SimpleUDPClient("127.0.0.1", 7000)
  print("[SYSTEM] OSC UDP Client allocated targeting Resolume on 127.0.0.1:7000")
except Exception as e:
  print(f"[ERROR] Failed to allocate OSC client: {e}")

# An OSC message will be sent to Resolume Arena to activate a specific column, being one
# for the waiting screen, one for each question, and one at the end of the session showing
# a leaderboard.
# The column number int value of the first question on the resolume composition will be
# added to the server current question index value.
# For example: `resolume_first_question_col + 1` should be equal to the column number for
# the second question, and so on.
resolume_first_question_col = 2

def trigger_resolume_column():
  # Activate the column based on the game_state["question_db_id"]
  # waiting screen == -1
  # leaderboard == len(QUESTION_DB)

  offset = 0
  if game_state["stage"] == GameStage.IDLE.value:
    offset = -1
  elif game_state["stage"] == GameStage.LEADERBOARD.value:
    offset = len(QUESTION_DB)
  else:
    offset = game_state["question_db_id"]

  col_value = resolume_first_question_col + offset
  osc_address = f"/composition/columns/{col_value}/connect"

  try:
    resolume_client.send_message(osc_address, 1)
    print(f"[OSC] Send int 1 to: \"{osc_address}\"")
  except Exception as e:
    print(f"[OSC] Error: Failed to send UDP packet \"{osc_address}\"")


#==================================================
# SERVER INITIALIZATION
#==================================================
# Allocate the WebSocket State Machine:
# async_mode='asgi' tells Socket.IO to integrate with Python's native async event loop.
# cors_allowed_origins='*' is for local network hardware. It bypasses the browser's security
# mechanism that normally prevents a web page from opening a socket to a different IP.
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins='*')

# Allocate the HTTP Server:
# This is the basic router. Serves the static HTML/JS files to the tablets when they first
# type in the IP address.
app = FastAPI()

# Mount the static directory
app.mount("/static", StaticFiles(directory="static"), name="static")


#==================================================
# HTTP ROUTES (File Dispatcher)
#==================================================
# "http://123.123.X.X:8080/admin"
# "http://123.123.X.X:8080/debug"
# "http://123.123.X.X:8080/leaderboard"
# "http://123.123.X.X:8080/player{N}"
@app.get("/admin", response_class=HTMLResponse)
async def serve_admin():
  # Open file from disk, read it into memory, and send it
  try:
    with open("admin.html", "r", encoding="utf-8") as f:
      return f.read()
  except FileNotFoundError:
    return "<h1>Error: admin.html not found on server.</h1>"


@app.get("/debug", response_class=HTMLResponse)
async def serve_debug():
  try:
    with open("debug.html", "r", encoding="utf-8") as f:
      return f.read()
  except FileNotFoundError:
    return "<h1>Error: debug.html not found on server.</h1>"


@app.get("/leaderboard", response_class=HTMLResponse)
async def serve_leaderboard():
  try:
    with open("leaderboard.html", "r", encoding="utf-8") as f:
      return f.read()
  except FileNotFoundError:
    return "<h1>Error: leaderboard.html not found on server.</h1>"


# FastAPI parses the string and passes it as a variable {player}
@app.get("/{player}", response_class=HTMLResponse)
async def serve_player(player: str):
  try:
    player_id = int(player.replace("player", ""))
    if not (0 <= player_id <= 6):
      return f"<h1>Error: {player} is not a valid player slot.</h1>"

    with open("player.html", "r", encoding="utf-8") as f:
      return f.read()
  except ValueError:
    return f"<h1>Error: {player} is not a valid format.</h1>"
  except FileNotFoundError:
    return "<h1>Error: player.html not found on server.</h1>"

# Mount the WebSocket server onto the HTTP App:
# Any standard web traffic goes to FastAPI
# Any traffic requesting an "Upgrade" to a persistent TCP pipe goes to Socket.IO
socket_app = socketio.ASGIApp(sio, other_asgi_app=app)


#==================================================
# NETWORK EVENT HANDLERS
#==================================================
# Simple hash map acting as our pointer table
# Maps a WebSocket Session ID (sid) to an array index (0-5)
sid_to_player_idx = {}
# A set to hold the session IDs of authorized admin connections
admin_sids = set()
debug_sids = set()

@sio.on("connect")
async def on_connect(sid, environ, auth):
  # 'auth' is a dictionary the client sends during the WebSocket handshake.
  # The tablet will send something like: {"client_id": "player3"}
  # The admin will send: {"client_id": "admin"}

  if not auth or "client_id" not in auth:
    print(f"[{sid}] Connection Rejected: No client_id provided.")
    return False  # Returning False immediately terminates the socket

  client_id = auth["client_id"]

  # Handle Admin/Debug Controller connecting
  if client_id == "admin":
    print(f"[{sid}] Admin Controller Connected.")
    admin_sids.add(sid);
    await sio.emit("state_update", game_state, to=sid)
    return True

  if client_id == "debug":
    print(f"[{sid}] Debug Controller Connected.")
    admin_sids.add(sid);
    debug_sids.add(sid);
    await sio.emit("state_update", game_state, to=sid)
    await sio.emit("private_state_update", QUESTION_DB, to=sid)
    return True;

  # Handle the Leaderboard Screen connecting
  if client_id == "leaderboard":
    print(f"[{sid}] Leaderboard Screen Connected.")
    await sio.emit("state_update", game_state, to=sid)
    return True

  # Handle the Hardware Tablets connecting
  player_idx = -1
  # Find which slot in memory this tablet belongs to
  for i in range(6):
    if game_state["players"][i]["id"] == client_id:
      player_idx = i
      break
  if player_idx == -1:
    print(f"[{sid}] Connection Rejected: Unknown ID '{client_id}'.")
    return False

  # Map the socket to the memory slot
  sid_to_player_idx[sid] = player_idx

  # Mutate the world state
  game_state["players"][player_idx]["is_online"] = True
  print(f"[{sid}] {client_id} Online. Mapped to idx {player_idx}.")

  # Broadcast the new world state
  await sio.emit("state_update", game_state)


@sio.on("disconnect")
async def on_disconnect(sid):
  # When a socket drops (Wi-Fi loss, closed browser), this fires automatically

  if sid in sid_to_player_idx:
    player_idx = sid_to_player_idx[sid]

    # Mutate the world state
    game_state["players"][player_idx]["is_online"] = False
    print(f"[{sid}] {game_state['players'][player_idx]['id']} Offline.")

    # Free the memory in our pointer table to prevent a memory leak
    del sid_to_player_idx[sid]

    # Broadcast the dropped connection to the Admin
    await sio.emit("state_update", game_state)
  elif sid in admin_sids:
    admin_sids.remove(sid)
    if sid in debug_sids:
      debug_sids.remove(sid)
  else:
    # If it wasn't in our dictionary, it was either the Admin or a rejected connection
    print(f"[{sid}] Disconnected (Unmapped).")


@sio.on("select_option")
async def on_select_option(sid, option_idx):
  if sid not in sid_to_player_idx:
    return

  player_idx = sid_to_player_idx[sid]
  player = game_state["players"][player_idx]

  # Guard checks
  if game_state["stage"] != GameStage.QUESTION_ACTIVE.value:
    print(f"Ignored player {player['id']} selection: No question active.")
    return

  if player["is_confirmed"]:
    print(f"Ignored player {player['id']} selection: Player already confirmed his answer.")
    return

  if not (0 <= option_idx < len(game_state["options"])):
    print(f"Ignored player {player['id']} selection: Invalid question index.")
    return

  # Mutate State & Broadcast
  player["is_playing"] = True
  player["selected_option"] = option_idx
  print(f"[{player['id']}] Selected option {option_idx}")
  await sio.emit("state_update", game_state)


@sio.on("confirm_option")
async def on_confirm_option(sid):
  if sid not in sid_to_player_idx:
    return

  player_idx = sid_to_player_idx[sid]
  player = game_state["players"][player_idx]

  # Guard checks
  if game_state["stage"] != GameStage.QUESTION_ACTIVE.value:
    print(f"Ignored player {player['id']} confirmation: No question active.")
    return

  if player["is_confirmed"]:
    print(f"Ignored player {player['id']} confirmation: Player already confirmed his answer.")
    return

  if player["selected_option"] == -1:
    print(f"Ignored player {player['id']} confirmation: No option selected.")
    return

  # Mutate State & Broadcast
  player["is_confirmed"] = True
  print(f"[{player['id']}] LOCKED IN option {player['selected_option']}")
  await sio.emit("state_update", game_state)

#------------------------------
# Audio (emmited on each admin_command)
#
class AudioCommand(IntEnum):
  PLAY = 1
  PAUSE = 2

curr_audio_cmd = 0

@sio.on("admin_command")
async def on_admin_command(sid, data):
  # Hardware-Level Authentication
  if sid not in admin_sids:
    print(f"[{sid}] REJECTED: Unauthorized admin command.")
    return

  # Extract Action
  action = data.get("action")

  # The State Machine Routing
  if action == "START_QUESTION":
    process_cmd_start()
  elif action == "REPLAY":
    process_cmd_replay()
  elif action == "REVEAL":
    process_cmd_reveal()
  elif action == "RESULTS":
    process_cmd_results()
  elif action == "RESET":
    process_cmd_reset()
    for d_sid in debug_sids:
      await sio.emit("private_state_update", QUESTION_DB, to=d_sid)
  else:
    print(f"Unknown admin action: {action}")
    return

  # Broadcast the world state to all connected clients
  await sio.emit("state_update", game_state)

  if curr_audio_cmd > 0:
    await sio.emit("audio_command", curr_audio_cmd)
    print(f"[Audio] Send command: {curr_audio_cmd}")


#==================================================
# COMMAND HELPERS
#==================================================
def process_cmd_start():
  global curr_audio_cmd
  curr_audio_cmd = 1

  # STATE GUARD: Only advance if in IDLE or REVEAL state
  if game_state["stage"] == GameStage.QUESTION_ACTIVE.value:
    print("Ignored START_QUESTION: A question is already active.")
    curr_audio_cmd = 0
    return

  # Advance question index
  next_question_idx = game_state["curr_question_idx"] + 1

  # Auto-trigger leaderboard if out of questions
  if next_question_idx >= len(QUESTION_DB):
    process_cmd_results()
    return

  # Mutate the state
  game_state["stage"] = GameStage.QUESTION_ACTIVE.value
  game_state["curr_question_idx"] = next_question_idx

  # Copy text and options into public state
  active_question = QUESTION_DB[next_question_idx]
  game_state["question_db_id"] = active_question["id"]
  game_state["question_text"] = active_question["text"]
  game_state["options"] = active_question["options"]
  game_state["correct_idx"] = -1

  # Reset players memory for new round
  for player in game_state["players"]:
    player["selected_option"] = -1
    player["is_confirmed"] = False

  print(f"--- QUESTION {game_state['curr_question_idx']} (ID: {game_state['question_db_id']}) STARTED ---")
  trigger_resolume_column()

def process_cmd_replay():
  global curr_audio_cmd
  curr_audio_cmd = 1
  trigger_resolume_column()

def process_cmd_reveal():
  global curr_audio_cmd
  curr_audio_cmd = 2

  # STATE GUARD: Only reveal if on QUESTION_ACTIVE state
  if game_state["stage"] != GameStage.QUESTION_ACTIVE.value:
    return

  game_state["stage"] = GameStage.REVEAL.value
  correct_answer_idx = QUESTION_DB[game_state["curr_question_idx"]]["correct_idx"]
  game_state["correct_idx"] = correct_answer_idx

  for player in game_state["players"]:
    if player["is_confirmed"] and player["selected_option"] == correct_answer_idx:
      player["score"] += 1

  print(f"--- REVEALED QUESTION {game_state['curr_question_idx']} ---")

def process_cmd_reset():
  global curr_audio_cmd
  curr_audio_cmd = 2

  # Reset the entire memory
  game_state["stage"] = GameStage.IDLE.value
  game_state["curr_question_idx"] = -1
  game_state["question_db_id"] = -1
  game_state["correct_idx"] = -1

  for player in game_state["players"]:
    player["is_playing"] = False
    player["selected_option"] = -1
    player["is_confirmed"] = False
    player["score"] = 0

  # Randomize questions order
  random.shuffle(QUESTION_DB)

  print("--- GAME RESET (QUESTIONS SHUFFLED) ---")
  trigger_resolume_column()

def process_cmd_results():
  global curr_audio_cmd
  curr_audio_cmd = 2

  # Forces the game to end and displays the leaderboard
  game_state["stage"] = GameStage.LEADERBOARD.value
  game_state["curr_question_idx"] = len(QUESTION_DB)
  print("--- FORCED LEADERBOARD ---")
  trigger_resolume_column()

# --- ENTRY POINT ---
if __name__ == "__main__":
  # uvicorn is the actual socket listener.
  # Under the hood, it uses 'uvloop', which is a Python wrapper around 'libuv' 
  # (a high-performance, cross-platform asynchronous I/O library written in C).
  # host="0.0.0.0" tells the OS to listen on ALL network interfaces (Wi-Fi, Ethernet),
  # not just localhost, so your Fire Tablets can actually reach it.
  uvicorn.run("server:socket_app", host="0.0.0.0", port=8080, reload=True)
