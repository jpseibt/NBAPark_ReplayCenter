// 1. Establish the TCP/WebSocket connection
const SERVER_URL = window.location.protocol + "//" + window.location.host;

const socket = io(SERVER_URL, {
  auth: { client_id: "debug" }
});

const status_div = document.getElementById("connection-status");
const state_dump = document.getElementById("state-dump");
const private_state_dump = document.getElementById("private-state-dump");

// 2. Network Event Listeners
socket.on("connect", () => {
  status_div.innerHTML = "STATUS: ONLINE (Connected to Engine)";
  status_div.style.color = "lime";
});

socket.on("disconnect", () => {
  status_div.innerHTML = "STATUS: OFFLINE (Connection Lost)";
  status_div.style.color = "red";
});

// 3. The State Sync Receiver
socket.on("state_update", (raw_state) => {
  state_dump.innerHTML = JSON.stringify(raw_state, null, 2);
});

// 4. The Private State Sync Receiver (sync on RESET)
socket.on("private_state_update", (raw_state) => {
  private_state_dump.innerHTML = JSON.stringify(raw_state, null, 2);
});

// 5. The Command Emitter (Attached to Window for global HTML access)
window.send_command = function(action_string) {
  socket.emit("admin_command", { action: action_string });
  console.log("Sent command: " + action_string);
};
