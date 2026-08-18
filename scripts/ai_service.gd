extends Node

signal connection_changed(connected: bool, message: String)
signal state_received(game_state: Dictionary)
signal advice_received(analysis: Dictionary)
signal decision_received(decision: Dictionary)
signal action_recorded(record: Dictionary)
signal request_failed(message: String)
signal game_state_invalidated(message: String)
signal _http_request_available

const SESSION_RUNTIME_PORT_BASE := 49152
const SESSION_RUNTIME_PORT_SPAN := 1536
const SESSION_RUNTIME_PORT_ATTEMPTS := 12
const RUNTIME_HTTP_TIMEOUT_SECONDS := 3.0
const TESTING_DISABLE_RESPONSE_TIMEOUT := true
const PROTOCOL_VERSION := "daer-godot-v2"
const RUNTIME_VERSION := "daer-bridge-session-v6"
const BRIDGE_COMMAND_ENV := "DAER_GODOT_BRIDGE_COMMAND"
const LEGACY_CORE_WORKSPACE_ENV := "DAER_CORE_WORKSPACE"
const CORE_PACKAGE_RELATIVE_PATH := "packages/core"
const BUNDLED_BRIDGE_RELATIVE_PATH := "bridge/daer-ai-server.cmd"
const BUNDLED_BRIDGE_VERSION_FILE := "runtime-version.txt"
const RULE_HEURISTIC_DEFAULT := true

var http: HTTPRequest
var connected := false
var latest_state: Dictionary = {}
var latest_advice: Dictionary = {}
var latest_decision: Dictionary = {}
var replay_steps: Array[Dictionary] = []
var recent_actions: Array[Dictionary] = []
var replay_id := ""
var game_generation := 0
var _starting_runtime := false
var _recovering_runtime := false
var _runtime_endpoint_occupied := false
var _runtime_port := 0
var _runtime_session_id := ""
var _runtime_auth_token := ""
var _runtime_parent_pid := 0
var _legacy_workspace_warning_emitted := false
var _startup_restore_checked := false
var _startup_restore_cancelled := false
var _new_game_in_progress := false
var _http_request_busy := false
var _last_http_status_code := 0
var use_rule_heuristic := RULE_HEURISTIC_DEFAULT

func _ready() -> void:
    _ensure_runtime_session()
    http = HTTPRequest.new()
    http.timeout = RUNTIME_HTTP_TIMEOUT_SECONDS
    add_child(http)
    if "--test" not in OS.get_cmdline_user_args():
        use_rule_heuristic = str(AppState.settings.get("opponent_ai_mode", "heuristic")) != "learned"
        call_deferred("_warm_runtime")

func _ensure_runtime_session() -> void:
    if not _runtime_session_id.is_empty():
        return
    _runtime_parent_pid = OS.get_process_id()
    _runtime_session_id = debug_runtime_session_id_for(_runtime_parent_pid, Time.get_ticks_usec())
    _runtime_port = debug_runtime_port_for_session(_runtime_parent_pid, 0)
    var crypto := Crypto.new()
    _runtime_auth_token = crypto.generate_random_bytes(32).hex_encode()

func _warm_runtime() -> void:
    if not await ensure_runtime() or _startup_restore_checked:
        return
    if _startup_restore_cancelled or _new_game_in_progress:
        return
    _startup_restore_checked = true
    var health := await _request("/health", HTTPClient.METHOD_GET)
    if _startup_restore_cancelled or _new_game_in_progress:
        return
    if health.get("activeGame", false) != true:
        return
    var response := await _request("/api/game/state", HTTPClient.METHOD_GET)
    if _startup_restore_cancelled or _new_game_in_progress:
        return
    var restored_state: Dictionary = response.get("state", {})
    if restored_state.is_empty():
        return
    game_generation += 1
    latest_state = restored_state
    await _restore_replay_steps()
    state_received.emit(latest_state)
    connection_changed.emit(true, "已恢复本机保存的牌局。")

func recover_runtime_state() -> void:
    if _recovering_runtime or latest_state.is_empty():
        return
    _recovering_runtime = true
    if await ensure_runtime():
        var response := await _request("/api/game/state", HTTPClient.METHOD_GET)
        var next_state: Dictionary = response.get("state", {})
        if not next_state.is_empty():
            latest_state = next_state
            await _restore_replay_steps()
            state_received.emit(latest_state)
        elif not latest_state.is_empty():
            latest_state.clear()
            latest_advice.clear()
            latest_decision.clear()
            game_state_invalidated.emit("规则服务已恢复，但此前牌局不在服务内存中。请开始新局。")
    _recovering_runtime = false

func _restore_replay_steps() -> void:
    var response := await _request("/api/game/replay", HTTPClient.METHOD_GET)
    var steps: Array = response.get("steps", [])
    if steps.is_empty():
        return
    replay_steps.clear()
    for raw_step in steps:
        var step: Dictionary = raw_step
        if step.has("state") and step.has("action"):
            replay_steps.append(step.duplicate(true))
    if replay_id.is_empty():
        replay_id = "bridge-restored"

func debug_validate_replay_restore_payload(response: Dictionary) -> bool:
    var steps: Array = response.get("steps", [])
    return not steps.is_empty() and Dictionary(steps[0]).get("action", {}).get("type", "") == "start"

func ensure_runtime() -> bool:
    _ensure_runtime_session()
    if await _health_check():
        return true
    if _starting_runtime:
        for _attempt in 32:
            await get_tree().create_timer(0.25).timeout
            if await _health_check():
                return true
        return false
    var command := _runtime_start_command()
    if command.is_empty():
        _fail("未找到 K 工作区的 daer 规则服务。请安装 packages/core 依赖，或确认 K 工作区的 bridge 完整。")
        return false
    _starting_runtime = true
    for port_attempt in SESSION_RUNTIME_PORT_ATTEMPTS:
        _runtime_port = debug_runtime_port_for_session(_runtime_parent_pid, port_attempt)
        _runtime_endpoint_occupied = false
        if await _health_check():
            _starting_runtime = false
            return true
        # Another local service owns this candidate port. Move to a fresh
        # per-session port instead of ever reusing its state.
        if _runtime_endpoint_occupied:
            continue
        var pid := OS.create_process("cmd.exe", PackedStringArray(["/c", command]), false)
        if pid <= 0:
            _starting_runtime = false
            _fail("无法启动本地 daer 规则服务。请检查随包 Bridge 或开发环境配置。")
            return false
        # pnpm/tsx 首次启动可能需要数秒，给桌面环境留出稳定的启动窗口。
        for _attempt in 32:
            await get_tree().create_timer(0.25).timeout
            if await _health_check():
                _starting_runtime = false
                return true
            if _runtime_endpoint_occupied:
                break
        # A Bridge that we just launched must identify this same Godot run.
        # Trying more ports cannot repair a stale package or launch command.
        break
    _starting_runtime = false
    _fail("本次 Godot 会话的规则服务未就绪。请更新随包 Bridge 后重试。")
    return false

func _runtime_start_command() -> String:
    var configured_command := OS.get_environment(BRIDGE_COMMAND_ENV).strip_edges()
    var legacy_core_workspace := OS.get_environment(LEGACY_CORE_WORKSPACE_ENV).strip_edges()
    if not legacy_core_workspace.is_empty() and not _legacy_workspace_warning_emitted:
        _legacy_workspace_warning_emitted = true
        push_warning("[daer] 已忽略 DAER_CORE_WORKSPACE；当前 Godot 只使用 K 工作区本地 Core 或随包 Bridge。")
    if _is_release_build():
        if not configured_command.is_empty() or not legacy_core_workspace.is_empty():
            push_warning("[daer] Release 构建忽略开发运行时覆盖，使用 K 工作区随包 Bridge。")
        var bundled_release_bridge := _bundled_bridge_path()
        if not bundled_release_bridge.is_empty():
            return _runtime_environment_prefix() + "call \"%s\"" % bundled_release_bridge
        return ""
    if not configured_command.is_empty():
        return _runtime_environment_prefix() + configured_command
    var project_root := ProjectSettings.globalize_path("res://")
    var core_root := project_root.path_join(CORE_PACKAGE_RELATIVE_PATH)
    var dev_entry := core_root.path_join("scripts/godot-ai-server.ts")
    var tsx_command := core_root.path_join("node_modules/.bin/tsx.cmd")
    if not FileAccess.file_exists(tsx_command):
        tsx_command = core_root.path_join("node_modules/.bin/tsx")
    if FileAccess.file_exists(dev_entry) and FileAccess.file_exists(tsx_command):
        return _runtime_environment_prefix() + "cd /d \"%s\" && pnpm --dir %s exec tsx scripts/godot-ai-server.ts" % [project_root, CORE_PACKAGE_RELATIVE_PATH]
    var bundled_bridge := _bundled_bridge_path()
    if not bundled_bridge.is_empty():
        return _runtime_environment_prefix() + "call \"%s\"" % bundled_bridge
    return ""

func _is_release_build() -> bool:
    return not OS.has_feature("editor") and not OS.is_debug_build()

func _runtime_environment_prefix() -> String:
    _ensure_runtime_session()
    return debug_runtime_environment_prefix_for_session(_runtime_port, _runtime_session_id, _runtime_parent_pid)

func _bundled_bridge_path() -> String:
    var project_bridge := ProjectSettings.globalize_path("res://" + BUNDLED_BRIDGE_RELATIVE_PATH)
    if _is_complete_bundled_bridge(project_bridge):
        return project_bridge
    var executable_dir := OS.get_executable_path().get_base_dir()
    var executable_bridge := executable_dir.path_join(BUNDLED_BRIDGE_RELATIVE_PATH)
    if _is_complete_bundled_bridge(executable_bridge):
        return executable_bridge
    return ""

func _is_complete_bundled_bridge(script_path: String) -> bool:
    if script_path.is_empty() or not FileAccess.file_exists(script_path):
        return false
    var bridge_root := script_path.get_base_dir()
    return FileAccess.file_exists(bridge_root.path_join("runtime/node.exe")) \
        and FileAccess.file_exists(bridge_root.path_join("bridge-server.mjs")) \
        and debug_bundled_bridge_version_matches(script_path)

func debug_bundled_bridge_version_matches(script_path: String) -> bool:
    if script_path.is_empty():
        return false
    var version_path := script_path.get_base_dir().path_join(BUNDLED_BRIDGE_VERSION_FILE)
    var version_file := FileAccess.open(version_path, FileAccess.READ)
    if version_file == null:
        return false
    return version_file.get_as_text().strip_edges() == RUNTIME_VERSION

func debug_runtime_launch_kind(environment_command: String = "", local_core_workspace: String = "", bundled_bridge_exists: bool = false) -> String:
    if not environment_command.strip_edges().is_empty():
        return "command"
    if not local_core_workspace.strip_edges().is_empty():
        return "development"
    if bundled_bridge_exists:
        return "bundled"
    return "missing"

func debug_runtime_session_id() -> String:
    _ensure_runtime_session()
    return _runtime_session_id

func debug_runtime_http_timeout_seconds() -> float:
    return RUNTIME_HTTP_TIMEOUT_SECONDS

func debug_runtime_session_id_for(parent_process_id: int, startup_ticks_usec: int) -> String:
    return "godot-%d-%d" % [maxi(parent_process_id, 0), maxi(startup_ticks_usec, 0)]

func debug_runtime_port_for_session(parent_process_id: int, attempt: int = 0) -> int:
    return SESSION_RUNTIME_PORT_BASE + (abs(parent_process_id) + maxi(attempt, 0)) % SESSION_RUNTIME_PORT_SPAN

func debug_runtime_environment_prefix_for_session(port: int, session_id: String, parent_process_id: int) -> String:
    var timeout_flag := "set \"DAER_DISABLE_RESPONSE_TIMEOUT=1\" && " if TESTING_DISABLE_RESPONSE_TIMEOUT and (OS.has_feature("editor") or OS.is_debug_build()) else ""
    return timeout_flag + "set \"DAER_GODOT_AI_PORT=%d\" && set \"DAER_GODOT_SESSION_ID=%s\" && set \"DAER_GODOT_PARENT_PID=%d\" && set \"DAER_BRIDGE_TOKEN=%s\" && set \"DAER_GODOT_STATE_FILE=%%LOCALAPPDATA%%\\DaerTraining\\bridge\\godot-game-state.json\" && " % [port, session_id, parent_process_id, _runtime_auth_token]

func debug_runtime_response_matches_session(response: Dictionary, session_id: String) -> bool:
    return _is_runtime_version_compatible(response) and str(response.get("sessionId", "")) == session_id

func debug_should_advance_session_port(http_status_code: int, response: Dictionary) -> bool:
    return http_status_code > 0 and response.is_empty()

func new_game(bottom_card_count: int = 2) -> void:
    if _new_game_in_progress:
        return
    _startup_restore_cancelled = true
    _new_game_in_progress = true
    game_generation += 1
    var request_generation := game_generation
    # Do not leave the previous snapshot interactive while the Bridge creates
    # the replacement game. The next state_received signal is authoritative.
    latest_state.clear()
    latest_advice.clear()
    latest_decision.clear()
    state_received.emit(latest_state)
    if await ensure_runtime():
        replay_steps.clear()
        recent_actions.clear()
        replay_id = str(Time.get_ticks_msec())
        var created_state: Dictionary = await _post("/api/game/new", {"bottomCardCount": bottom_card_count}, request_generation)
        # The Bridge can commit a new game before an interrupted POST response
        # reaches Godot. Re-read the authoritative snapshot once; never POST /new again.
        if _should_reconcile_new_game_state(request_generation, created_state):
            await _recover_new_game_state(request_generation)
    _new_game_in_progress = false

func is_new_game_in_progress() -> bool:
    return _new_game_in_progress

func debug_runtime_policy_mode() -> String:
    return "heuristic" if use_rule_heuristic else "learned"

func debug_http_request_is_busy() -> bool:
    return _http_request_busy

func refresh_state() -> void:
    if not await _ensure_request_runtime():
        return
    var response := await _request("/api/game/state", HTTPClient.METHOD_GET)
    var next_state: Dictionary = response.get("state", {})
    if not next_state.is_empty():
        latest_state = next_state
        state_received.emit(latest_state)

func submit_action(action: Dictionary) -> void:
    var request_generation := game_generation
    if not latest_state.is_empty() and await _ensure_request_runtime():
        var payload := action.duplicate(true)
        var response_window: Dictionary = latest_state.get("responseWindow", {})
        if not response_window.is_empty():
            payload["responseWindowId"] = str(response_window.get("id", ""))
        await _post("/api/game/action", payload, request_generation)

func run_ai_step(mode: String = "learned") -> bool:
    var request_generation := game_generation
    if not latest_state.is_empty() and await _ensure_request_runtime():
        # AI decisions always run in the Bridge. `fast` is the core's
        # rule-conditioned heuristic; learned remains the optional policy.
        var response := await _post("/api/game/ai-step", {"mode": "fast" if use_rule_heuristic else mode}, request_generation)
        return not response.is_empty()
    return false

func run_original_ai_step(mode: String = "learned") -> void:
    var request_generation := game_generation
    if latest_state.is_empty() or not await _ensure_request_runtime():
        return
    await _post("/api/game/ai-step", {"mode": mode}, request_generation)

func debug_validate_replay_start_step() -> bool:
    var step := {"state": {"turnCount": 0}, "action": {"type": "start", "cards": []}}
    var action: Dictionary = step.get("action", {})
    return str(action.get("type", "")) == "start" and Dictionary(step.get("state", {})).has("turnCount")

func debug_validate_protocol_version() -> bool:
    return _is_runtime_version_compatible({"ok": true, "protocolVersion": PROTOCOL_VERSION, "runtimeVersion": RUNTIME_VERSION}) and not _is_runtime_version_compatible({"ok": true, "protocolVersion": "daer-godot-v0", "runtimeVersion": RUNTIME_VERSION}) and not _is_runtime_version_compatible({"ok": true, "protocolVersion": PROTOCOL_VERSION, "runtimeVersion": "old-bridge"}) and not _is_runtime_version_compatible({"ok": true})

func debug_should_restore_startup_game(health: Dictionary) -> bool:
    return _is_runtime_compatible(health) and health.get("activeGame", false) == true

func debug_should_reconcile_new_game_state(request_generation: int, current_generation: int, response_state: Dictionary, current_state: Dictionary) -> bool:
    return request_generation == current_generation and response_state.is_empty() and current_state.is_empty()

func debug_should_reconcile_error_state(response: Dictionary, current_state: Dictionary) -> bool:
    var response_state_variant = response.get("state", {})
    if typeof(response_state_variant) != TYPE_DICTIONARY:
        return false
    var response_state: Dictionary = response_state_variant
    return response.get("ok", true) != true and not response_state.is_empty() and response_state != current_state

func request_advice(player_index: int = 0, mode: String = "learned") -> void:
    if latest_state.is_empty() or not await _ensure_request_runtime():
        return
    var response := await _request("/api/game/advice", HTTPClient.METHOD_POST, {"playerIndex": player_index, "mode": mode})
    if response.is_empty():
        return
    latest_advice = response.get("analysis", {})
    advice_received.emit(latest_advice)

func _health_check() -> bool:
    var response := await _request("/health", HTTPClient.METHOD_GET, {}, false, false)
    if response.is_empty():
        _runtime_endpoint_occupied = debug_should_advance_session_port(_last_http_status_code, response)
        _set_connection_state(false)
        return false
    if not _is_runtime_version_compatible(response):
        _runtime_endpoint_occupied = true
        _set_connection_state(false)
        return false
    if not _is_runtime_compatible(response):
        _runtime_endpoint_occupied = true
        _set_connection_state(false)
        return false
    _runtime_endpoint_occupied = false
    _set_connection_state(true)
    return true

func _is_runtime_compatible(response: Dictionary) -> bool:
    _ensure_runtime_session()
    return debug_runtime_response_matches_session(response, _runtime_session_id)

func _is_runtime_version_compatible(response: Dictionary) -> bool:
    return response.get("ok", false) == true and str(response.get("protocolVersion", "")) == PROTOCOL_VERSION and str(response.get("runtimeVersion", "")) == RUNTIME_VERSION

func _ensure_request_runtime() -> bool:
    # Avoid a health round-trip before every action during AI self-play.
    # Failed requests still flip `connected` false and trigger full recovery
    # on the next user action.
    if connected:
        return true
    return await ensure_runtime()

func _post(path: String, payload: Dictionary, request_generation: int = -1) -> Dictionary:
    var response := await _request(path, HTTPClient.METHOD_POST, payload)
    if response.is_empty():
        return {}
    if request_generation >= 0 and request_generation != game_generation:
        return {}
    var next_state: Dictionary = response.get("state", {})
    if not next_state.is_empty():
        latest_state = next_state
        state_received.emit(latest_state)
    if path == "/api/game/new" and not latest_state.is_empty():
        _record_new_game_replay()
    if response.has("action"):
        var action: Dictionary = Dictionary(response.get("action", {})).duplicate(true)
        var record := {
            "action": action,
            "playerId": str(action.get("playerId", "")),
            "ts": Time.get_unix_time_from_system(),
        }
        recent_actions.append(record)
        if recent_actions.size() > 3:
            recent_actions.pop_front()
        action_recorded.emit(record)
        var step: Dictionary = {"state": latest_state.duplicate(true), "action": action, "ts": Time.get_unix_time_from_system()}
        if response.has("decision"):
            var decision: Dictionary = response.get("decision", {})
            latest_decision = decision.duplicate(true)
            step["decision"] = decision.duplicate(true)
            decision_received.emit(decision)
        replay_steps.append(step)
        _save_current_replay()
    return next_state

func _should_reconcile_new_game_state(request_generation: int, response_state: Dictionary) -> bool:
    return debug_should_reconcile_new_game_state(request_generation, game_generation, response_state, latest_state)

func _recover_new_game_state(request_generation: int) -> bool:
    var response := await _request("/api/game/state", HTTPClient.METHOD_GET)
    var next_state: Dictionary = response.get("state", {})
    if request_generation != game_generation or next_state.is_empty():
        return false
    latest_state = next_state
    state_received.emit(latest_state)
    _record_new_game_replay()
    return true

func _record_new_game_replay() -> void:
    if not replay_steps.is_empty():
        return
    replay_steps.append({
        "state": latest_state.duplicate(true),
        "action": {"type": "start", "cards": []},
        "ts": Time.get_unix_time_from_system(),
    })
    _save_current_replay()

func _save_current_replay() -> void:
    if replay_id.is_empty() or replay_steps.is_empty():
        return
    PersistenceService.save_replay({"game": "daer", "replayId": replay_id, "updatedAt": Time.get_unix_time_from_system(), "steps": replay_steps}, replay_id)

func _request(path: String, method: HTTPClient.Method, payload: Dictionary = {}, update_connection: bool = true, report_failure: bool = true) -> Dictionary:
    await _acquire_http_request()
    _last_http_status_code = 0
    var headers := PackedStringArray(["Content-Type: application/json", "Authorization: Bearer %s" % _runtime_auth_token])
    var body := "" if method == HTTPClient.METHOD_GET else JSON.stringify(payload)
    var result := http.request(_runtime_base_url() + path, headers, method, body)
    if result != OK:
        _release_http_request()
        _set_connection_state(false)
        if report_failure:
            _fail("AI 服务请求无法发出：%s" % error_string(result))
        return {}
    var completed: Array = await http.request_completed
    _release_http_request()
    var status_code: int = completed[1]
    _last_http_status_code = status_code
    var raw := PackedByteArray(completed[3]).get_string_from_utf8()
    var json := JSON.new()
    var parse_result := json.parse(raw)
    var parsed = json.data if parse_result == OK else null
    if typeof(parsed) != TYPE_DICTIONARY:
        _set_connection_state(false)
        if report_failure:
            _fail("AI 服务返回了无效数据。")
        return {}
    var response: Dictionary = parsed
    var reconciled_error_state := false
    if status_code < 200 or status_code >= 300 or response.get("ok", false) != true:
        if debug_should_reconcile_error_state(response, latest_state):
            reconciled_error_state = true
            latest_state = Dictionary(response.get("state", {})).duplicate(true)
            state_received.emit(latest_state)
        if status_code <= 0 or status_code >= 500:
            _set_connection_state(false)
        if report_failure:
            _fail("响应局面已更新，已按最新牌局刷新。" if reconciled_error_state else str(response.get("error", "AI 服务请求失败。")))
        return {}
    if update_connection:
        _set_connection_state(true)
    return response

func _set_connection_state(is_connected: bool) -> void:
    if connected == is_connected:
        return
    connected = is_connected
    connection_changed.emit(connected, "本地 daer 规则与 AI 服务已连接" if connected else "本地 daer 规则与 AI 服务已断开，正在尝试恢复。")

func _runtime_base_url() -> String:
    return "http://127.0.0.1:%d" % _runtime_port

func _fail(message: String) -> void:
    request_failed.emit(message)

func _acquire_http_request() -> void:
    while _http_request_busy:
        await _http_request_available
    _http_request_busy = true

func _release_http_request() -> void:
    if not _http_request_busy:
        return
    _http_request_busy = false
    _http_request_available.emit()
