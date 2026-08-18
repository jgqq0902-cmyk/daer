extends Control

const INK := Color("17130d")
const PAPER := Color("f4ead4")
const PAPER_DIM := Color("e4d5b7")
const TABLE := Color("1c5a3a")
const TABLE_DARK := Color("113c29")
const GOLD := Color("e7b95a")
const RED := Color("9d382b")
const JADE := Color("73c19a")
const CARD_BRUSH_FONT_PATH := "res://assets/fonts/MaShanZheng-Regular.ttf"
const AI_ACTION_DELAY_SECONDS := 1.15
const ANIMATION_CHAIN_BUFFER_SECONDS := 0.15
const HUMAN_AUTO_PROGRESS_RETRY_SECONDS := 0.35
const AUTO_PROGRESS_POLL_SECONDS := 0.25
const ANIMATION_DURATION_SECONDS := 1.0
const ACTION_ANIMATION_SECONDS := ANIMATION_DURATION_SECONDS
const CARD_FACE_HEIGHT_RATIO := 4.0
const ACTION_ANIMATION_CARD_SIZE := Vector2(34, 136)
const ACTION_TEXT_ANIMATION_SECONDS := ANIMATION_DURATION_SECONDS
const CARD_STACK_VISIBLE_HEIGHT_RATIO := 1.0
const CARD_STACK_STEP_RATIO := 0.82
const PUBLIC_MELD_CARD_WIDTH := 31.0
const PUBLIC_MELD_CARD_VISIBLE_HEIGHT := PUBLIC_MELD_CARD_WIDTH * CARD_STACK_VISIBLE_HEIGHT_RATIO
const PUBLIC_MELD_CARD_STEP := PUBLIC_MELD_CARD_VISIBLE_HEIGHT * CARD_STACK_STEP_RATIO
const PUBLIC_MELD_GROUP_WIDTH := 37.0
const DECK_STACK_CARD_SIZE := Vector2(70, 42)
const DECK_STACK_CARD_STEP := Vector2(12, 0)
const DISCARD_PENDING_CARD_SIZE := Vector2(54, 54)
const DISCARD_ARCHIVE_CARD_WIDTH := 31.0
const DISCARD_ARCHIVE_CARD_HEIGHT := 30.0
const DISCARD_LOCKED_MODULATE := Color(0.52, 0.56, 0.52, 0.78)
const DISCARD_PENDING_MODULATE := Color(1.0, 0.92, 0.56, 1.0)
const DISCARD_ZONE_WIDTH := 118.0
const DISCARD_ZONE_HEIGHT := 190.0
const DISCARD_DROP_HIT_MARGIN := 26.0
const DISCARD_DRAG_Y_THRESHOLD := 300.0
const RESPONSE_ANIMATION_HOLD_SECONDS := ANIMATION_DURATION_SECONDS
const COORDINATE_RULER_LEFT := 28.0
const COORDINATE_RULER_STEP := 100
const PICKER_CARD_WIDTH := 34.0
const PICKER_CARD_VISIBLE_HEIGHT := PICKER_CARD_WIDTH * CARD_STACK_VISIBLE_HEIGHT_RATIO
const REPLAY_HAND_CARD_WIDTH := 34.0
const REPLAY_HAND_CARD_VISIBLE_HEIGHT := REPLAY_HAND_CARD_WIDTH * CARD_STACK_VISIBLE_HEIGHT_RATIO
const REPLAY_HAND_GROUP_GAP := 8.0
const TABLE_SURFACE_SCENE := preload("res://scenes/table/table_surface.tscn")
const OPPONENT_SEAT_SCENE := preload("res://scenes/table/opponent_seat.tscn")
const MELD_GROUP_VIEW_SCENE := preload("res://scenes/table/meld_group_view.tscn")
const CENTER_AREA_SCENE := preload("res://scenes/table/center_area.tscn")
const PLAYER_HAND_AREA_SCENE := preload("res://scenes/table/player_hand_area.tscn")

var root_box: VBoxContainer
var content: Control
var _shell_header: Control
var _shell_divider: Control
var selected_card_id := ""
var page := "home"
var toast: Label
var option_popup: PopupPanel
var decision_popup: PopupPanel
var advice_popup: PopupPanel
var settlement_popup: PopupPanel
var _ai_advancing := false
var _auto_advance_queued := false
var _human_auto_action_in_flight := false
var _human_auto_watchdog_queued := false
var _advice_loading := false
var _ai_demo_running := false
var _ai_demo_generation := 0
var settled_replay_id := ""
var replay_catalog: Array[Dictionary] = []
var replay_steps: Array = []
var replay_cursor := -1
var replay_name := ""
var card_brush_font: FontFile
var _last_live_turn := -1
var _last_live_discard_id := ""
var _free_hand_order: Array[String] = []
var _free_hand_columns: Array = []
var _rendered_free_hand_order: Array[String] = []
var _free_hand_replay_id := ""
var _free_hand_game_generation := -1
var _force_auto_hand_layout := false
var _drag_card_id := ""
var _drag_source_index := -1
var _drag_insert_index := -1
var _drag_drop_target := {}
var _drag_pointer_offset := Vector2.ZERO
var _drag_preview: Control
var _free_hand_track: Control
var _discard_drop_zone: Control
var _discard_drop_surface: Control
var _drag_card_size := Vector2(38, 152)
var _drag_card_positions := {}
var _free_hand_card_nodes := {}
var _rendered_free_hand_cards: Array = []
var _rendered_source_free_cards: Array = []
var _rendered_hand_groups: Array[Dictionary] = []
var _rendered_locked_card_ids := {}
var _drag_track_global_rect := Rect2()
var _discard_drop_global_rect := Rect2()
var _pointer_down_card_id := ""
var _pointer_down_position := Vector2.ZERO
var _dragging := false
var _drag_settling := false
var _drag_click_suppressed_until := 0
var _hand_layout_revision := 0
var _manual_hand_layout := false
var _hand_slot_tween: Tween
var _automatic_progress_poll_deadline_msec := 0
var _automatic_progress_blocked_signature := ""
var _last_live_state: Dictionary = {}
var _previous_live_state: Dictionary = {}
var _previous_live_animation_positions: Dictionary = {}
var _current_live_animation_positions: Dictionary = {}
var _action_animation_layer: Control
var _action_animation_generation := 0
var _action_animation_ready_at_msec := 0
var _response_animation_hold_generation := 0
var _response_animation_hold: Dictionary = {}

func _state_active_player(state: Dictionary) -> int:
	return int(state.get("activePlayerIndex", state.get("currentPlayerIndex", -1)))

func _state_awaiting_human(state: Dictionary) -> bool:
	return bool(state.get("awaitingHumanInput", _state_active_player(state) == 0 and not bool(state.get("isGameOver", false))))

func _ready() -> void:
	_load_card_brush_font()
	_build_shell()
	_mount_headless_test_runner()
	_free_hand_game_generation = AIService.game_generation
	AIService.state_received.connect(_on_state_received)
	AIService.advice_received.connect(_on_advice_received)
	AIService.decision_received.connect(_on_decision_received)
	AIService.action_recorded.connect(_on_action_recorded)
	AIService.connection_changed.connect(_on_connection_changed)
	AIService.request_failed.connect(_on_request_failed)
	AIService.game_state_invalidated.connect(_on_game_state_invalidated)
	if AIService.latest_state.is_empty():
		show_home()
	else:
		_on_state_received(AIService.latest_state)

func _mount_headless_test_runner() -> void:
	if "--test" not in OS.get_cmdline_user_args():
		return
	# Keep the test-only script out of exported scenes while preserving the
	# existing headless test entry point for development builds.
	var runner_script_path := "res://" + "scripts/" + "test_" + "runner.gd"
	var runner_script = load(runner_script_path)
	if runner_script == null:
		push_error("Headless test runner is unavailable: " + runner_script_path)
		return
	var runner := Node.new()
	runner.name = "TestRunner"
	runner.set_script(runner_script)
	add_child(runner)

func _process(_delta: float) -> void:
	if page != "game" or AIService.latest_state.is_empty():
		return
	var now_msec := Time.get_ticks_msec()
	if now_msec < _automatic_progress_poll_deadline_msec:
		return
	_automatic_progress_poll_deadline_msec = now_msec + int(AUTO_PROGRESS_POLL_SECONDS * 1000.0)
	_reconcile_automatic_progress()

func _load_card_brush_font() -> void:
	var brush_font := FontFile.new()
	if brush_font.load_dynamic_font(CARD_BRUSH_FONT_PATH) == OK:
		card_brush_font = brush_font
	else:
		push_warning("牌面书写字体加载失败，将使用系统默认字体。")

func _build_shell() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var background := ColorRect.new()
	background.color = PAPER
	background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(background)
	root_box = VBoxContainer.new()
	root_box.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT, Control.PRESET_MODE_MINSIZE, 12)
	root_box.add_theme_constant_override("separation", 6)
	add_child(root_box)
	var header := HBoxContainer.new()
	_shell_header = header
	header.custom_minimum_size.y = 36
	var mark := Label.new()
	mark.text = "大"
	mark.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	mark.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	mark.custom_minimum_size = Vector2(28, 28)
	mark.add_theme_font_size_override("font_size", 19)
	mark.add_theme_color_override("font_color", PAPER)
	mark.add_theme_stylebox_override("normal", _box(GOLD, 4, 0))
	header.add_child(mark)
	var title := Label.new()
	title.text = "泸州大贰"
	title.add_theme_font_size_override("font_size", 22)
	title.add_theme_color_override("font_color", INK)
	header.add_child(title)
	var subtitle := Label.new()
	subtitle.text = "  单机研习局"
	subtitle.add_theme_font_size_override("font_size", 12)
	subtitle.add_theme_color_override("font_color", Color("776b57"))
	header.add_child(subtitle)
	header.add_child(_spacer())
	for item in [["牌局", "home"], ["回放", "replay"], ["设置", "settings"]]:
		header.add_child(_nav_button(item[0], item[1]))
	root_box.add_child(header)
	var line := HSeparator.new()
	_shell_divider = line
	line.modulate = Color("9d896b")
	root_box.add_child(line)
	content = VBoxContainer.new()
	content.size_flags_vertical = Control.SIZE_EXPAND_FILL
	root_box.add_child(content)
	_action_animation_layer = Control.new()
	_action_animation_layer.name = "ActionAnimationLayer"
	_action_animation_layer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_action_animation_layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_action_animation_layer.z_index = 20
	add_child(_action_animation_layer)
	toast = Label.new()
	toast.visible = false
	toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast.add_theme_font_size_override("font_size", 15)
	toast.add_theme_color_override("font_color", PAPER)
	toast.add_theme_stylebox_override("normal", _box(TABLE_DARK, 4, 10))
	toast.set_anchors_preset(Control.PRESET_CENTER_TOP)
	toast.position.y = 62
	toast.z_index = 10
	add_child(toast)
	option_popup = PopupPanel.new()
	option_popup.size = Vector2i(0, 0)
	option_popup.add_theme_stylebox_override("panel", StyleBoxEmpty.new())
	add_child(option_popup)
	decision_popup = PopupPanel.new()
	decision_popup.size = Vector2i(500, 0)
	decision_popup.add_theme_stylebox_override("panel", _box(PAPER, 6, 16, TABLE_DARK, 2))
	add_child(decision_popup)
	advice_popup = PopupPanel.new()
	advice_popup.size = Vector2i(560, 0)
	advice_popup.add_theme_stylebox_override("panel", _box(PAPER, 6, 18, JADE, 2))
	add_child(advice_popup)
	settlement_popup = PopupPanel.new()
	settlement_popup.size = Vector2i(460, 0)
	settlement_popup.add_theme_stylebox_override("panel", _box(PAPER, 6, 18, GOLD, 3))
	add_child(settlement_popup)

func _navigate(target: String) -> void:
	_clear_action_animations()
	option_popup.hide()
	decision_popup.hide()
	advice_popup.hide()
	settlement_popup.hide()
	page = target
	selected_card_id = ""
	if target == "home": show_home()
	elif target == "game": show_game()
	elif target == "settings": show_settings()
	elif target == "replay": show_replay()

func _set_shell_header_visible(is_visible: bool) -> void:
	if is_instance_valid(_shell_header):
		_shell_header.visible = is_visible
	if is_instance_valid(_shell_divider):
		_shell_divider.visible = is_visible

func _leave_game() -> void:
	if _ai_demo_running:
		_ai_demo_generation += 1
		_ai_demo_running = false
	_navigate("home")

func _unhandled_key_input(event: InputEvent) -> void:
	if not event is InputEventKey or not event.pressed or event.echo:
		return
	var key_event: InputEventKey = event
	if key_event.keycode == KEY_ESCAPE:
		if option_popup.visible or decision_popup.visible or advice_popup.visible or settlement_popup.visible:
			option_popup.hide()
			decision_popup.hide()
			advice_popup.hide()
			settlement_popup.hide()
		elif not selected_card_id.is_empty():
			selected_card_id = ""
			show_game()
		get_viewport().set_input_as_handled()
		return
	if page != "game" or _ai_advancing or _advice_loading or _ai_demo_running or AIService.latest_state.is_empty():
		return
	var state := AIService.latest_state
	if bool(state.get("isGameOver", false)) or not _state_awaiting_human(state):
		return
	if key_event.keycode in [KEY_ENTER, KEY_KP_ENTER] and _can_submit_selected_discard(state):
		_submit_discard()
		get_viewport().set_input_as_handled()
	elif key_event.keycode == KEY_SPACE:
		var pass_action := _available_action(state, "pass")
		if not pass_action.is_empty():
			_submit_available_action(pass_action)
			get_viewport().set_input_as_handled()

func _input(event: InputEvent) -> void:
	if page != "game":
		return
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_pointer_down_position = event.position
			return
		if _dragging:
			_finish_hand_drag(event.position)
			get_viewport().set_input_as_handled()
		_pointer_down_card_id = ""
		return
	if event is InputEventMouseMotion:
		if not _pointer_down_card_id.is_empty() and not _dragging and event.position.distance_to(_pointer_down_position) >= 8.0:
			_start_hand_drag(_pointer_down_card_id, event.position)
		if _dragging:
			_update_hand_drag(event.position)
			get_viewport().set_input_as_handled()

func _available_action(state: Dictionary, action_type: String) -> Dictionary:
	for raw_action in Array(state.get("availableActions", [])):
		var action: Dictionary = raw_action
		if str(action.get("type", "")) == action_type:
			return action
	return {}

func _authoritative_available_action(available: Dictionary, chi_option: Dictionary = {}, hu_option: Dictionary = {}) -> Dictionary:
	var action_type := str(available.get("type", ""))
	var current: Dictionary = {}
	var requested_cards: Array = Array(available.get("cards", []))
	var requested_card_id := str(Dictionary(requested_cards[0]).get("id", "")) if not requested_cards.is_empty() else ""
	for raw_action in Array(AIService.latest_state.get("availableActions", [])):
		var candidate: Dictionary = raw_action
		if str(candidate.get("type", "")) != action_type:
			continue
		if action_type == "bao":
			var candidate_cards: Array = Array(candidate.get("cards", []))
			var candidate_card_id := str(Dictionary(candidate_cards[0]).get("id", "")) if not candidate_cards.is_empty() else ""
			if requested_card_id != candidate_card_id:
				continue
		current = candidate
		break
	if current.is_empty() and action_type != "bao":
		current = _available_action(AIService.latest_state, action_type)
	if current.is_empty():
		return {}
	if not chi_option.is_empty():
		var current_chi_options: Array = current.get("chiOptions", [])
		if not current_chi_options.any(func(raw_option: Dictionary) -> bool:
			return str(raw_option.get("id", "")) == str(chi_option.get("id", ""))
		):
			return {}
	if not hu_option.is_empty():
		var current_hu_options: Array = current.get("huOptions", [])
		if not current_hu_options.any(func(raw_option: Dictionary) -> bool:
			return str(raw_option.get("id", "")) == str(hu_option.get("id", ""))
		):
			return {}
	return current

func _can_submit_selected_discard(state: Dictionary) -> bool:
	if selected_card_id.is_empty():
		return false
	for raw_action in Array(state.get("availableActions", [])):
		var action: Dictionary = raw_action
		if str(action.get("type", "")) != "discard":
			continue
		for raw_card in Array(action.get("cards", [])):
			if str(Dictionary(raw_card).get("id", "")) == selected_card_id:
				return true
	return false

func debug_validate_keyboard_guards() -> bool:
	var state := {"availableActions": [{"type": "discard", "cards": [{"id": "s1"}]}, {"type": "pass", "cards": []}], "players": [{"cards": [{"id": "s1"}]}], "currentPlayerIndex": 0}
	selected_card_id = "s1"
	var can_discard := _can_submit_selected_discard(state)
	selected_card_id = "missing"
	var cannot_discard := not _can_submit_selected_discard(state)
	selected_card_id = ""
	return can_discard and cannot_discard

func debug_validate_game_popup_dismissal() -> bool:
	selected_card_id = "selected-card"
	_dismiss_game_popups()
	return selected_card_id.is_empty()

func debug_validate_state_change_modal_dismissal() -> bool:
	_last_live_turn = 0
	_last_live_discard_id = "discard-old"
	_on_state_received({
		"currentPlayerIndex": 1,
		"discardPile": {"lastDiscard": {"id": "discard-new"}},
		"isGameOver": false,
	})
	return selected_card_id.is_empty()

func _clear() -> void:
	if _hand_slot_tween != null and _hand_slot_tween.is_valid():
		_hand_slot_tween.kill()
	for child in content.get_children():
		child.queue_free()

func _clear_container(container: Node) -> void:
	for child in container.get_children():
		child.queue_free()

func show_home() -> void:
	_set_shell_header_visible(true)
	_clear()
	var hero := VBoxContainer.new()
	hero.size_flags_vertical = Control.SIZE_EXPAND_FILL
	hero.alignment = BoxContainer.ALIGNMENT_CENTER
	hero.add_theme_constant_override("separation", 16)
	content.add_child(hero)
	var eyebrow := Label.new()
	eyebrow.text = "LOCAL TABLE / AI TRAINING"
	eyebrow.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	eyebrow.add_theme_font_size_override("font_size", 13)
	eyebrow.add_theme_color_override("font_color", RED)
	hero.add_child(eyebrow)
	var headline := Label.new()
	headline.text = "一桌好牌，慢慢打明白。"
	headline.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	headline.add_theme_font_size_override("font_size", 38)
	headline.add_theme_color_override("font_color", INK)
	hero.add_child(headline)
	var description := Label.new()
	description.text = "固定三人局。牌局规则由本机规则服务计算，对手当前使用%s。" % _opponent_ai_label()
	description.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	description.add_theme_font_size_override("font_size", 16)
	description.add_theme_color_override("font_color", Color("675d4f"))
	hero.add_child(description)
	var actions := HBoxContainer.new()
	actions.alignment = BoxContainer.ALIGNMENT_CENTER
	actions.add_theme_constant_override("separation", 12)
	hero.add_child(actions)
	actions.add_child(_command_button("开始一局", func(): AIService.new_game(int(AppState.settings.bottom_card_count))))
	actions.add_child(_quiet_button("AI 演示", func(): _start_battle()))
	var status := Label.new()
	status.text = "对手：%s  ·  规则服务" % _opponent_ai_label() + ("已连接" if AIService.connected else "启动时自动连接")
	status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	status.add_theme_font_size_override("font_size", 14)
	status.add_theme_color_override("font_color", JADE if AIService.connected else Color("8d7e67"))
	hero.add_child(status)

func _start_battle() -> void:
	_ai_demo_generation += 1
	_ai_demo_running = true
	_dismiss_game_popups()
	await AIService.new_game(int(AppState.settings.bottom_card_count))
	await _run_full_ai_demo(_ai_demo_generation, AIService.game_generation)

func _dismiss_game_popups() -> void:
	for popup in [option_popup, decision_popup, advice_popup, settlement_popup]:
		if is_instance_valid(popup):
			popup.hide()
	selected_card_id = ""

func _run_full_ai_demo(demo_generation: int, game_generation: int) -> void:
	if not _ai_demo_running:
		return
	_show_toast("%s正在完成整局。" % _opponent_ai_label(), 2.0)
	var guard := 0
	while demo_generation == _ai_demo_generation and game_generation == AIService.game_generation and not AIService.latest_state.is_empty() and not bool(AIService.latest_state.get("isGameOver", false)) and guard < 360:
		guard += 1
		await AIService.run_ai_step(_selected_ai_mode())
		await get_tree().create_timer(_action_animation_wait_seconds()).timeout
	if demo_generation == _ai_demo_generation:
		_ai_demo_running = false
	if demo_generation == _ai_demo_generation and game_generation == AIService.game_generation and guard >= 360:
		_show_toast("AI 演示达到安全步数上限，已暂停。", 4.0)

func _stop_ai_demo() -> void:
	if not _ai_demo_running:
		return
	_ai_demo_generation += 1
	_ai_demo_running = false
	_show_toast("AI 演示已停止，可继续当前牌局。", 3.0)
	show_game()

func show_game() -> void:
	_set_shell_header_visible(false)
	_discard_drop_global_rect = Rect2()
	_discard_drop_surface = null
	_drag_track_global_rect = Rect2()
	_clear()
	var state := AIService.latest_state
	if state.is_empty():
		if AIService.is_new_game_in_progress():
			_show_toast("正在创建新牌局。", 2.0)
		show_home()
		return
	var frame := PanelContainer.new()
	frame.size_flags_vertical = Control.SIZE_EXPAND_FILL
	frame.add_theme_stylebox_override("panel", _box(TABLE, 8, 12, TABLE_DARK, 2))
	content.add_child(frame)
	frame.add_child(_build_table_surface(state))
	if bool(state.get("isGameOver", false)) and settled_replay_id != AIService.replay_id:
		settled_replay_id = AIService.replay_id
		call_deferred("_show_settlement", state.duplicate(true))

func _build_table_surface(state: Dictionary, include_actions: bool = true, replay_view: bool = false) -> Control:
	var surface := TABLE_SURFACE_SCENE.instantiate() as Control
	surface.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	surface.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var response_layout := str(state.get("phase", "")) == "response_collecting" and _state_awaiting_human(state)
	var player_top := 0.55 if response_layout else 0.58
	var navigation := surface.get_node("GameNavigation") as Control
	navigation.visible = include_actions
	var back := surface.get_node("GameNavigation/BackButton") as Button
	back.pressed.connect(func(): _leave_game())
	var settings_button := surface.get_node("GameNavigation/SettingsButton") as Button
	settings_button.pressed.connect(func(): _navigate("settings"))

	var left_opponent := _build_opponent_seat(state, 1, include_actions, replay_view)
	var left_slot := surface.get_node("OpponentLeftSlot") as Control
	if not include_actions:
		left_slot.offset_top = 12
		left_slot.offset_bottom = 184
	left_slot.add_child(left_opponent)
	var right_opponent := _build_opponent_seat(state, 2, include_actions, replay_view)
	var right_slot := surface.get_node("OpponentRightSlot") as Control
	if not include_actions:
		right_slot.offset_top = 12
		right_slot.offset_bottom = 184
	right_slot.add_child(right_opponent)

	var center := _build_center(state, include_actions)
	var center_slot := surface.get_node("CenterSlot") as Control
	center_slot.anchor_bottom = player_top - 0.01
	center_slot.add_child(center)
	var discard_zones := center.get_node_or_null("DiscardZones") as Control
	if discard_zones != null:
		discard_zones.reparent(surface)
		discard_zones.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		_layout_discard_zones(discard_zones)

	var player_area := _build_player_area(state, include_actions, replay_view)
	var player_area_slot := surface.get_node("PlayerAreaSlot") as Control
	player_area_slot.anchor_top = player_top
	player_area_slot.add_child(player_area)
	surface.add_child(_build_coordinate_ruler())

	return surface

func _build_coordinate_ruler() -> Control:
	var ruler := Control.new()
	ruler.name = "CoordinateRuler"
	ruler.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	ruler.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ruler.z_index = 30
	ruler.set_meta("coordinate_space", "table_surface")
	var ruler_color := Color("d9c79f", 0.74)
	var horizontal := Control.new()
	horizontal.name = "HorizontalTicks"
	horizontal.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	horizontal.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ruler.add_child(horizontal)
	var vertical := Control.new()
	vertical.name = "VerticalTicks"
	vertical.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	vertical.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ruler.add_child(vertical)
	var top_line := ColorRect.new()
	top_line.position = Vector2(COORDINATE_RULER_LEFT, 0)
	top_line.anchor_right = 1.0
	top_line.offset_left = COORDINATE_RULER_LEFT
	top_line.offset_right = -4.0
	top_line.offset_bottom = 1.0
	top_line.color = ruler_color
	top_line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	horizontal.add_child(top_line)
	var left_line := ColorRect.new()
	left_line.position = Vector2(0, 22)
	left_line.anchor_bottom = 1.0
	left_line.offset_top = 22.0
	left_line.offset_right = 1.0
	left_line.offset_bottom = -4.0
	left_line.color = ruler_color
	left_line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	vertical.add_child(left_line)
	var origin := Label.new()
	origin.name = "Origin"
	origin.text = "x/y"
	origin.position = Vector2(2, 2)
	origin.add_theme_font_size_override("font_size", 9)
	origin.add_theme_color_override("font_color", ruler_color)
	origin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ruler.add_child(origin)
	for x in range(0, 1300, COORDINATE_RULER_STEP):
		var tick := ColorRect.new()
		tick.position = Vector2(COORDINATE_RULER_LEFT + float(x), 0)
		tick.size = Vector2(1, 6)
		tick.color = ruler_color
		tick.mouse_filter = Control.MOUSE_FILTER_IGNORE
		horizontal.add_child(tick)
		var label := Label.new()
		label.name = "X_%d" % x
		label.text = str(x)
		label.position = Vector2(COORDINATE_RULER_LEFT + float(x) + 2.0, 2.0)
		label.add_theme_font_size_override("font_size", 9)
		label.add_theme_color_override("font_color", ruler_color)
		label.mouse_filter = Control.MOUSE_FILTER_IGNORE
		horizontal.add_child(label)
	for y in range(0, 800, COORDINATE_RULER_STEP):
		var tick := ColorRect.new()
		tick.position = Vector2(0, 22.0 + float(y))
		tick.size = Vector2(6, 1)
		tick.color = ruler_color
		tick.mouse_filter = Control.MOUSE_FILTER_IGNORE
		vertical.add_child(tick)
		var label := Label.new()
		label.name = "Y_%d" % y
		label.text = str(y)
		label.position = Vector2(3.0, 24.0 + float(y))
		label.add_theme_font_size_override("font_size", 9)
		label.add_theme_color_override("font_color", ruler_color)
		label.mouse_filter = Control.MOUSE_FILTER_IGNORE
		vertical.add_child(label)
	return ruler

func _build_status_bar(state: Dictionary) -> Control:
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 10)
	var phase := Label.new()
	phase.text = _phase_text(str(state.get("phase", "")))
	phase.add_theme_font_size_override("font_size", 13)
	phase.add_theme_color_override("font_color", INK)
	phase.add_theme_stylebox_override("normal", _box(GOLD, 4, 6))
	bar.add_child(phase)
	var turn := Label.new()
	turn.text = "第 %d 回合" % int(state.get("turnCount", 0))
	turn.add_theme_color_override("font_color", Color("655b4d"))
	bar.add_child(turn)
	var rules := Label.new()
	rules.text = "底牌 %d 张" % int(AppState.settings.get("bottom_card_count", 2))
	rules.add_theme_font_size_override("font_size", 13)
	rules.add_theme_color_override("font_color", Color("675d4f"))
	bar.add_child(rules)
	bar.add_child(_spacer())
	var runtime := Label.new()
	runtime.text = "规则服务 · %s" % ("ONLINE" if AIService.connected else "CONNECTING")
	runtime.tooltip_text = "对手策略：%s · %s" % [_opponent_ai_label(), _decision_policy_label(_latest_decision_trace())]
	runtime.add_theme_font_size_override("font_size", 12)
	runtime.add_theme_color_override("font_color", JADE if AIService.connected else RED)
	bar.add_child(runtime)
	if not AIService.latest_decision.is_empty():
		bar.add_child(_quiet_button("AI 决策", func(): _show_decision_panel(AIService.latest_decision)))
	return bar

func _build_opponents(state: Dictionary) -> Control:
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 14)
	for index in [1, 2]:
		row.add_child(_build_opponent_seat(state, index))
	return row

func _build_opponent_seat(state: Dictionary, index: int, interactive: bool = true, replay_view: bool = false) -> Control:
	var players: Array = state.get("players", [])
	var player: Dictionary = Dictionary(players[index]) if index >= 0 and index < players.size() else {}
	var game_over := bool(state.get("isGameOver", false))
	var is_current := not game_over and _state_active_player(state) == index
	var seat := OPPONENT_SEAT_SCENE.instantiate() as PanelContainer
	seat.add_to_group("live_turn_seat_%d" % index)
	seat.add_theme_stylebox_override("panel", StyleBoxEmpty.new())
	var badge := seat.get_node("Badge") as VBoxContainer
	badge.alignment = BoxContainer.ALIGNMENT_BEGIN
	badge.add_theme_constant_override("separation", 2)
	var name := seat.get_node("Badge/Name") as Label
	name.text = "玩家%d  ·  %d 张" % [index, Array(player.get("cards", [])).size()]
	name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT if index == 1 else HORIZONTAL_ALIGNMENT_RIGHT
	name.add_theme_font_size_override("font_size", 22)
	name.add_theme_color_override("font_color", GOLD if is_current else PAPER)
	var state_label := seat.get_node("Badge/State") as Label
	state_label.text = ""
	state_label.visible = false
	var table_row := seat.get_node("Badge/TableRow") as HBoxContainer
	table_row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	table_row.alignment = BoxContainer.ALIGNMENT_BEGIN
	var private_fan := seat.get_node("Badge/TableRow/PrivateFan") as HBoxContainer
	private_fan.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	private_fan.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	private_fan.alignment = BoxContainer.ALIGNMENT_END if index == 2 else BoxContainer.ALIGNMENT_BEGIN
	private_fan.add_to_group("live_hand_source_%d" % index)
	var action_banner := _build_player_action_banner(state, interactive, index, true)
	action_banner.add_to_group("live_action_anchor_%d" % index)
	if not action_banner.text.is_empty():
		badge.add_child(action_banner)
		badge.move_child(action_banner, badge.get_child_count() - 1)
	if replay_view:
		private_fan.add_theme_constant_override("separation", 0)
		private_fan.add_child(_build_replay_hand_groups(Array(player.get("cards", [])), BoxContainer.ALIGNMENT_BEGIN if index == 1 else BoxContainer.ALIGNMENT_END))
	else:
		private_fan.add_theme_constant_override("separation", -16)
		for _card_index in clampi(ceili(float(Array(player.get("cards", [])).size()) / 4.0), 3, 5):
			private_fan.add_child(_card_back(Vector2(28, 42)))
	var public_melds := seat.get_node("Badge/TableRow/PublicMelds") as HBoxContainer
	public_melds.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	public_melds.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	public_melds.alignment = BoxContainer.ALIGNMENT_BEGIN if index == 2 else BoxContainer.ALIGNMENT_END
	if index == 2:
		table_row.move_child(public_melds, 0)
	public_melds.add_to_group("live_meld_target_%d" % index)
	var melds: Array = player.get("melds", [])
	if not melds.is_empty():
		public_melds.add_child(_opponent_public_melds(melds))
	return seat

func _opponent_public_melds(melds: Array) -> Control:
	var row := GridContainer.new()
	row.name = "PublicMeldGrid"
	row.columns = 4
	row.add_theme_constant_override("h_separation", 7)
	row.add_theme_constant_override("v_separation", 6)
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for raw_meld in melds:
		var meld: Dictionary = raw_meld
		var group := MELD_GROUP_VIEW_SCENE.instantiate() as PanelContainer
		group.add_to_group("live_meld_group")
		group.set_meta("animation_card_ids", Array(meld.get("cards", [])).map(func(raw_card: Dictionary) -> String:
			return str(raw_card.get("id", ""))
		))
		group.tooltip_text = _meld_text(str(meld.get("type", "")))
		group.add_theme_stylebox_override("panel", _box(Color("0b3222", 0.5), 4, 4, Color("73c19a", 0.55), 1))
		var margin := group.get_node("Margin") as MarginContainer
		margin.add_theme_constant_override("margin_left", 3)
		margin.add_theme_constant_override("margin_top", 3)
		margin.add_theme_constant_override("margin_right", 3)
		margin.add_theme_constant_override("margin_bottom", 3)
		var cards_row := group.get_node("Margin/Cards") as VBoxContainer
		var stack_metrics := _card_stack_metrics(PUBLIC_MELD_CARD_WIDTH)
		var visible_height := float(stack_metrics.get("visible_height", PUBLIC_MELD_CARD_VISIBLE_HEIGHT))
		var stack_step := float(stack_metrics.get("step", PUBLIC_MELD_CARD_STEP))
		cards_row.alignment = BoxContainer.ALIGNMENT_END
		cards_row.add_theme_constant_override("separation", -int(roundf(visible_height - stack_step)))
		for raw_card in Array(meld.get("cards", [])):
			var card: Dictionary = raw_card
			var face := _cropped_hand_card_art(card, float(stack_metrics.get("width", PUBLIC_MELD_CARD_WIDTH)), visible_height)
			face.name = "PublicCardFace_%s" % str(card.get("id", ""))
			face.set_meta("animation_card_id", str(card.get("id", "")))
			face.add_to_group("live_card_face")
			face.tooltip_text = _card_size_text(card)
			cards_row.add_child(face)
		if cards_row.get_child_count() == 0:
			continue
		var cards_height := visible_height + maxf(float(cards_row.get_child_count() - 1) * stack_step, 0.0)
		cards_row.custom_minimum_size = Vector2(float(stack_metrics.get("width", PUBLIC_MELD_CARD_WIDTH)), cards_height)
		# Keep every group wider than its card art and leave an explicit row gap;
		# adjacent meld columns therefore cannot cover one another.
		group.custom_minimum_size = Vector2(maxf(PUBLIC_MELD_GROUP_WIDTH, float(stack_metrics.get("width", PUBLIC_MELD_CARD_WIDTH)) + 6.0), cards_height + 6.0)
		row.add_child(group)
	return row

func _build_replay_hand_groups(cards: Array, alignment: int = BoxContainer.ALIGNMENT_CENTER) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.name = "ReplayHandGroups"
	row.alignment = alignment
	row.add_theme_constant_override("separation", int(REPLAY_HAND_GROUP_GAP))
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.size_flags_vertical = Control.SIZE_EXPAND_FILL
	row.set_meta("replay_card_count", cards.size())

	var stack_metrics := _card_stack_metrics(REPLAY_HAND_CARD_WIDTH)
	var card_width := float(stack_metrics.get("width", REPLAY_HAND_CARD_WIDTH))
	var visible_height := float(stack_metrics.get("visible_height", REPLAY_HAND_CARD_VISIBLE_HEIGHT))
	var stack_step := float(stack_metrics.get("step", REPLAY_HAND_CARD_VISIBLE_HEIGHT * CARD_STACK_STEP_RATIO))
	var groups := _hand_groups(cards)
	var max_stack_height := visible_height
	for raw_group in groups:
		var group_cards: Array = Array(Dictionary(raw_group).get("cards", []))
		max_stack_height = maxf(max_stack_height, visible_height + maxf(float(group_cards.size() - 1) * stack_step, 0.0))
	row.set_meta("replay_group_count", groups.size())
	row.custom_minimum_size = Vector2(
		card_width * float(groups.size()) + REPLAY_HAND_GROUP_GAP * maxf(float(groups.size() - 1), 0.0),
		max_stack_height,
	)

	for group_index in groups.size():
		var group: Dictionary = groups[group_index]
		var group_cards: Array = Array(group.get("cards", []))
		var stack_height := visible_height + maxf(float(group_cards.size() - 1) * stack_step, 0.0)
		var column := VBoxContainer.new()
		column.name = "ReplayHandGroup_%d" % group_index
		column.alignment = BoxContainer.ALIGNMENT_END
		column.add_theme_constant_override("separation", -int(roundf(visible_height - stack_step)))
		column.size_flags_vertical = Control.SIZE_EXPAND_FILL
		column.custom_minimum_size = Vector2(card_width, stack_height)
		column.mouse_filter = Control.MOUSE_FILTER_IGNORE
		column.set_meta("group_kind", str(group.get("kind", "single")))
		for raw_card in group_cards:
			var card: Dictionary = raw_card
			var face := _cropped_hand_card_art(card, card_width, visible_height)
			face.name = "ReplayCardFace_%s" % str(card.get("id", ""))
			face.set_meta("replay_card_id", str(card.get("id", "")))
			face.add_to_group("replay_hand_card")
			face.tooltip_text = _card_size_text(card)
			column.add_child(face)
		row.add_child(column)
	return row

func _opponent_card_fan(card_count: int, dimensions: Vector2 = Vector2(19, 29)) -> Control:
	var fan := HBoxContainer.new()
	fan.alignment = BoxContainer.ALIGNMENT_CENTER
	fan.add_theme_constant_override("separation", -int(dimensions.x * 0.58))
	var visible_cards := clampi(ceili(float(card_count) / 4.0), 3, 5)
	for _index in visible_cards:
		fan.add_child(_card_back(dimensions))
	return fan

func _card_back(dimensions: Vector2) -> Control:
	var root := Panel.new()
	root.custom_minimum_size = dimensions
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_theme_stylebox_override("panel", _box(Color("d7b95e"), 2, 1, Color("f4ead4"), 1))
	var inset := Panel.new()
	inset.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT, Control.PRESET_MODE_MINSIZE, 3)
	inset.mouse_filter = Control.MOUSE_FILTER_IGNORE
	inset.add_theme_stylebox_override("panel", _box(Color("9d382b"), 1, 0, Color("f4ead4", 0.65), 1))
	root.add_child(inset)
	var mark := Label.new()
	mark.text = "|||"
	mark.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	mark.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	mark.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mark.add_theme_font_size_override("font_size", 8)
	mark.add_theme_color_override("font_color", Color("f4ead4", 0.85))
	mark.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(mark)
	return root

func _build_center(state: Dictionary, interactive: bool = true) -> Control:
	var center := CENTER_AREA_SCENE.instantiate() as Control
	var deck_label := center.get_node("DeckLabel") as Label
	deck_label.remove_from_group("live_deck_anchor")
	deck_label.text = "牌山 %d 张" % int(state.get("remainingDeckCards", 0))
	deck_label.add_theme_font_size_override("font_size", 14)
	deck_label.add_theme_color_override("font_color", GOLD)
	var deck_stack := center.get_node("DeckStack") as Control
	_clear_container(deck_stack)
	deck_stack.add_to_group("live_deck_anchor")
	deck_stack.visible = int(state.get("remainingDeckCards", 0)) > 0
	for card_index in 3:
		var deck_back := _card_back(DECK_STACK_CARD_SIZE)
		deck_back.name = "DeckBack_%d" % card_index
		deck_back.position = DECK_STACK_CARD_STEP * float(card_index)
		deck_back.z_index = card_index
		deck_stack.add_child(deck_back)
	var stack := center.get_node("StackCenter/Stack") as VBoxContainer
	var compact := get_viewport_rect().size.y < 800.0
	stack.custom_minimum_size = Vector2(280 if compact else 340, 96 if compact else 120)
	var target_frame := center.get_node("StackCenter/Stack/TargetFrame") as PanelContainer
	# 牌面不再渲染在中心；中心只保留响应上下文和按钮。
	target_frame.visible = false
	target_frame.custom_minimum_size = Vector2.ZERO
	var target_center := center.get_node("StackCenter/Stack/TargetFrame/TargetCenter") as CenterContainer
	_clear_container(target_center)
	var note := center.get_node("StackCenter/Stack/ContextNote") as Label
	note.text = _center_context_text(state)
	note.add_theme_font_size_override("font_size", 14)
	note.add_theme_color_override("font_color", GOLD if _state_awaiting_human(state) else PAPER_DIM)
	var response_slot := center.get_node("StackCenter/Stack/ResponseActions") as CenterContainer
	_clear_container(response_slot)
	var history_slot := center.get_node("StackCenter/Stack/History") as CenterContainer
	_clear_container(history_slot)
	var discard_area := center.get_node("DiscardArea") as PanelContainer
	discard_area.visible = false
	var discard_zones := _build_discard_zones(state, interactive)
	center.add_child(discard_zones)
	return center

func _build_discard_zones(state: Dictionary, interactive: bool) -> Control:
	var zones := Control.new()
	zones.name = "DiscardZones"
	zones.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	zones.mouse_filter = Control.MOUSE_FILTER_IGNORE
	zones.z_index = 4
	for player_index in 3:
		var zone := _build_discard_zone(state, player_index, interactive)
		zones.add_child(zone)
		var anchor := Control.new()
		anchor.name = "DiscardAnchor_%d" % player_index
		anchor.custom_minimum_size = Vector2.ONE
		anchor.size = Vector2.ONE
		anchor.mouse_filter = Control.MOUSE_FILTER_IGNORE
		anchor.z_index = 1
		anchor.add_to_group("live_discard_zone_%d" % player_index)
		anchor.set_meta("player_index", player_index)
		zones.add_child(anchor)
		if interactive and player_index == 0:
			_discard_drop_zone = zone
			_discard_drop_surface = zone
			call_deferred("_update_drop_zone_rect", zone)
			zone.resized.connect(func(): _update_drop_zone_rect(zone))
	_layout_discard_zones(zones)
	return zones

func _build_discard_zone(state: Dictionary, player_index: int, interactive: bool) -> PanelContainer:
	var pending := _discard_zone_pending_card(state, player_index)
	var pending_active := not pending.is_empty()
	var zone := PanelContainer.new()
	zone.name = "DiscardZone_%d" % player_index
	zone.set_meta("player_index", player_index)
	zone.custom_minimum_size = Vector2(DISCARD_ZONE_WIDTH, DISCARD_ZONE_HEIGHT)
	zone.size = Vector2(DISCARD_ZONE_WIDTH, DISCARD_ZONE_HEIGHT)
	zone.mouse_filter = Control.MOUSE_FILTER_STOP if player_index == 0 and interactive else Control.MOUSE_FILTER_IGNORE
	zone.tooltip_text = "玩家%d当前出牌/翻牌" % player_index
	zone.add_theme_stylebox_override("panel", StyleBoxEmpty.new())

	var body := VBoxContainer.new()
	body.name = "Body"
	body.alignment = BoxContainer.ALIGNMENT_BEGIN
	body.add_theme_constant_override("separation", 3)
	zone.add_child(body)

	var archive_row := HBoxContainer.new()
	archive_row.alignment = BoxContainer.ALIGNMENT_END if player_index == 2 else BoxContainer.ALIGNMENT_BEGIN
	archive_row.add_theme_constant_override("separation", -7)
	archive_row.custom_minimum_size = Vector2(0, DISCARD_PENDING_CARD_SIZE.y)
	archive_row.name = "Archive"
	var archive_entries := _discard_zone_archive_entries(state, player_index, str(pending.get("id", "")))
	for entry in archive_entries:
		var archive_card: Dictionary = entry.get("card", {})
		var archive_art := _cropped_hand_card_art(archive_card, DISCARD_ARCHIVE_CARD_WIDTH, DISCARD_ARCHIVE_CARD_HEIGHT)
		archive_art.name = "ArchivedCard_%s" % str(archive_card.get("id", ""))
		archive_art.add_to_group("live_discard")
		archive_art.add_to_group("live_discard_archived")
		archive_art.add_to_group("live_card_face")
		archive_art.set_meta("animation_card_id", str(archive_card.get("id", "")))
		archive_art.set_meta("discard_player_index", player_index)
		archive_art.modulate = DISCARD_LOCKED_MODULATE
		archive_art.tooltip_text = _card_size_text(archive_card)
		archive_row.add_child(archive_art)
	if pending_active:
		var pending_slot := CenterContainer.new()
		pending_slot.name = "PendingCard"
		pending_slot.custom_minimum_size = DISCARD_PENDING_CARD_SIZE
		var pending_art := _cropped_hand_card_art(pending, DISCARD_PENDING_CARD_SIZE.x, DISCARD_PENDING_CARD_SIZE.y)
		pending_art.name = "PendingCard_%s" % str(pending.get("id", ""))
		pending_art.add_to_group("live_discard")
		pending_art.add_to_group("live_discard_pending")
		pending_art.add_to_group("live_card_face")
		pending_art.set_meta("animation_card_id", str(pending.get("id", "")))
		pending_art.set_meta("discard_player_index", player_index)
		pending_art.set_meta("discard_locked", true)
		pending_art.modulate = DISCARD_PENDING_MODULATE
		pending_slot.add_child(pending_art)
		archive_row.add_child(pending_slot)
	body.add_child(archive_row)
	return zone

func _discard_zone_anchor(player_index: int) -> Vector2:
	return [Vector2(400, 300), Vector2(50, 300), Vector2(1150, 300)][clampi(player_index, 0, 2)]

func _layout_discard_zones(zones: Control) -> void:
	if not is_instance_valid(zones):
		return
	for player_index in 3:
		var zone := zones.get_node_or_null("DiscardZone_%d" % player_index) as Control
		var anchor := zones.get_node_or_null("DiscardAnchor_%d" % player_index) as Control
		if zone == null or anchor == null:
			continue
		zone.anchor_left = 0.0
		zone.anchor_right = 0.0
		zone.anchor_top = 0.0
		zone.anchor_bottom = 0.0
		zone.size = Vector2(DISCARD_ZONE_WIDTH, DISCARD_ZONE_HEIGHT)
		var origin := _discard_zone_anchor(player_index)
		zone.position = origin - Vector2(DISCARD_ZONE_WIDTH, 0.0) if player_index == 2 else origin
		anchor.position = origin
		anchor.size = Vector2.ONE

func _discard_zone_pending_card(state: Dictionary, player_index: int) -> Dictionary:
	var held := _response_animation_hold_card(player_index)
	if not held.is_empty():
		return held
	if str(state.get("phase", "")) != "response_collecting":
		return {}
	var pile: Dictionary = state.get("discardPile", {})
	if int(pile.get("lastDiscardPlayerIndex", -1)) != player_index:
		return {}
	var card: Dictionary = pile.get("lastDiscard", {})
	return card if not card.is_empty() and not str(state.get("pendingCardSource", "")).is_empty() else {}

func _discard_zone_archive_entries(state: Dictionary, player_index: int, pending_id: String) -> Array:
	var pile: Dictionary = state.get("discardPile", {})
	var entries: Array = []
	var seen := {}
	var live_ids := {}
	for raw_card in Array(pile.get("cards", [])):
		var live_card: Dictionary = raw_card
		var live_id := str(live_card.get("id", ""))
		if not live_id.is_empty():
			live_ids[live_id] = true
	if not pending_id.is_empty():
		live_ids[pending_id] = true
	for raw_entry in Array(pile.get("discardHistory", [])):
		var entry: Dictionary = raw_entry
		var card: Dictionary = entry.get("card", {})
		var card_id := str(card.get("id", ""))
		if int(entry.get("playerIndex", -1)) != player_index or card.is_empty() or card_id == pending_id or seen.has(card_id) or not live_ids.has(card_id):
			continue
		seen[card_id] = true
		entries.append(entry)
	# Legacy snapshots may omit discardHistory, but only the current lastDiscard
	# has an owner in that shape. Never assign the whole shared pile to that
	# player; doing so makes old cards appear in the wrong discard zone.
	var fallback_variant: Variant = pile.get("lastDiscard", {})
	var fallback_card: Dictionary = fallback_variant if typeof(fallback_variant) == TYPE_DICTIONARY else {}
	var fallback_id := str(fallback_card.get("id", ""))
	if not fallback_card.is_empty() \
		and pending_id.is_empty() \
		and int(pile.get("lastDiscardPlayerIndex", -1)) == player_index \
		and not seen.has(fallback_id):
		seen[fallback_id] = true
		entries.append({"card": fallback_card, "playerIndex": player_index, "source": "discard"})
	var max_archive_count := 3 if not pending_id.is_empty() else 4
	var start := maxi(0, entries.size() - max_archive_count)
	return entries.slice(start)

func _response_animation_hold_card(player_index: int) -> Dictionary:
	if _response_animation_hold.is_empty():
		return {}
	if int(_response_animation_hold.get("playerIndex", -1)) != player_index:
		return {}
	var held_generation := int(_response_animation_hold.get("generation", -1))
	if held_generation != _response_animation_hold_generation:
		return {}
	var held_card: Dictionary = Dictionary(_response_animation_hold.get("card", {}))
	return held_card.duplicate(true)

func _response_animation_hold_for_action(action: Dictionary, previous_state: Dictionary, _current_state: Dictionary) -> Dictionary:
	var action_type := str(action.get("type", ""))
	if action_type not in ["chi", "peng", "zhao", "hu"]:
		return {}
	var actor_index := _action_animation_player_index(action, previous_state, _current_state)
	if actor_index < 0:
		return {}
	var pending := _pending_response_card(previous_state)
	if pending.is_empty():
		return {}
	var source_player_index := int(Dictionary(previous_state.get("discardPile", {})).get("lastDiscardPlayerIndex", -1))
	if source_player_index < 0:
		return {}
	return {
		"card": pending.duplicate(true),
		"playerIndex": source_player_index,
		"duration": RESPONSE_ANIMATION_HOLD_SECONDS,
	}

func _update_drop_zone_rect(zone: Control) -> void:
	if is_instance_valid(zone):
		_discard_drop_global_rect = _discard_drop_hit_rect(zone.get_global_rect())

func _discard_drop_hit_rect(rect: Rect2) -> Rect2:
	var margin := Vector2(DISCARD_DROP_HIT_MARGIN, DISCARD_DROP_HIT_MARGIN)
	return Rect2(rect.position - margin, rect.size + margin * 2.0)

func _pending_response_card(state: Dictionary) -> Dictionary:
	if str(state.get("phase", "")) != "response_collecting":
		return {}
	var pile: Dictionary = state.get("discardPile", {})
	return pile.get("lastDiscard", {})

func _unresponded_discard_cards(state: Dictionary) -> Array:
	var pile: Dictionary = state.get("discardPile", {})
	return Array(pile.get("cards", []))

func _discard_history_entry(state: Dictionary, card: Dictionary) -> Dictionary:
	var pile: Dictionary = state.get("discardPile", {})
	for raw_entry in Array(pile.get("discardHistory", [])):
		var entry: Dictionary = raw_entry
		var entry_card: Dictionary = entry.get("card", {})
		if str(entry_card.get("id", "")) == str(card.get("id", "")):
			return entry
	return {}

func _discard_source_text(entry: Dictionary) -> String:
	var source := str(entry.get("source", ""))
	if source == "draw":
		return "翻牌"
	if source == "discard":
		var player_index := int(entry.get("playerIndex", -1))
		return "你" if player_index == 0 else ("玩家%d" % player_index if player_index > 0 else "出牌")
	# Old saved records did not carry source metadata. Do not attribute them to
	# player 0 merely because the legacy playerIndex happened to be zero.
	return "历史"

func _unresponded_discard_chip(card: Dictionary, _entry: Dictionary) -> Control:
	var chip := PanelContainer.new()
	chip.name = "UnrespondedDiscardChip"
	chip.custom_minimum_size = Vector2(PUBLIC_MELD_GROUP_WIDTH, PUBLIC_MELD_CARD_VISIBLE_HEIGHT + 6.0)
	chip.add_theme_stylebox_override("panel", _box(Color("0b3222", 0.5), 4, 4, Color("73c19a", 0.55), 1))
	chip.tooltip_text = _card_size_text(card)
	var body := MarginContainer.new()
	body.name = "Body"
	body.add_theme_constant_override("margin_left", 3)
	body.add_theme_constant_override("margin_top", 3)
	body.add_theme_constant_override("margin_right", 3)
	body.add_theme_constant_override("margin_bottom", 3)
	chip.add_child(body)
	var art := _cropped_hand_card_art(card, PUBLIC_MELD_CARD_WIDTH, PUBLIC_MELD_CARD_VISIBLE_HEIGHT)
	art.name = "DiscardCardArt"
	art.tooltip_text = _card_size_text(card)
	body.add_child(art)
	return chip

func debug_validate_center_discard_presentation() -> bool:
	var flipped := {"id": "flip-big9", "rank": "玖", "value": 9, "size": "big"}
	var response := {
		"phase": "response_collecting",
		"pendingCardSource": "draw",
		"discardPile": {
			"lastDiscard": flipped,
			"lastDiscardPlayerIndex": 2,
			"cards": [flipped],
			"discardHistory": [{"card": flipped, "playerIndex": 2, "source": "draw"}],
		},
	}
	var center := _build_center(response, false)
	var zones := center.get_node_or_null("DiscardZones") as Control
	var center_target := center.get_node("StackCenter/Stack/TargetFrame") as Control
	var source_zone := zones.get_node_or_null("DiscardZone_2") as Control if zones != null else null
	var pending_cards := _subtree_group_nodes(center, "live_discard_pending")
	var valid := zones != null \
		and zones.get_child_count() == 6 \
		and not center_target.visible \
		and source_zone != null \
		and pending_cards.size() == 1 \
		and _discard_source_text({"source": "draw"}) == "翻牌"
	center.free()
	return valid

func _subtree_group_nodes(root: Node, group_name: String) -> Array:
	var matches: Array = []
	if root.is_in_group(group_name):
		matches.append(root)
	for child in root.get_children():
		matches.append_array(_subtree_group_nodes(child, group_name))
	return matches

func _subtree_contains_text(root: Node, needle: String) -> bool:
	if root is Label and (root as Label).text.contains(needle):
		return true
	if root is Button and (root as Button).text.contains(needle):
		return true
	for child in root.get_children():
		if _subtree_contains_text(child, needle):
			return true
	return false

func debug_validate_opponent_seat_layout() -> bool:
	var state := {
		"currentPlayerIndex": 0,
		"players": [
			{"cards": [], "melds": []},
			{"cards": [{"id": "p1-card"}], "melds": []},
			{"cards": [{"id": "p2-card"}], "melds": []},
		],
	}
	var left := _build_opponent_seat(state, 1, false)
	var right := _build_opponent_seat(state, 2, false)
	var left_name := left.get_node("Badge/Name") as Label
	var right_name := right.get_node("Badge/Name") as Label
	var left_state := left.get_node("Badge/State") as Label
	var right_state := right.get_node("Badge/State") as Label
	var left_row := left.get_node("Badge/TableRow") as HBoxContainer
	var right_row := right.get_node("Badge/TableRow") as HBoxContainer
	var left_private := left.get_node("Badge/TableRow/PrivateFan") as HBoxContainer
	var right_private := right.get_node("Badge/TableRow/PrivateFan") as HBoxContainer
	var left_public := left.get_node("Badge/TableRow/PublicMelds") as HBoxContainer
	var right_public := right.get_node("Badge/TableRow/PublicMelds") as HBoxContainer
	var valid := left.get_theme_stylebox("panel") is StyleBoxEmpty \
		and right.get_theme_stylebox("panel") is StyleBoxEmpty \
		and left_name.horizontal_alignment == HORIZONTAL_ALIGNMENT_LEFT \
		and right_name.horizontal_alignment == HORIZONTAL_ALIGNMENT_RIGHT \
		and left_row.get_index() > left_name.get_index() \
		and right_row.get_index() > right_name.get_index() \
		and left_private.alignment == BoxContainer.ALIGNMENT_BEGIN \
		and left_private.size_flags_vertical == Control.SIZE_SHRINK_BEGIN \
		and left_public.size_flags_vertical == Control.SIZE_SHRINK_BEGIN \
		and right_private.alignment == BoxContainer.ALIGNMENT_END \
		and right_private.size_flags_vertical == Control.SIZE_SHRINK_BEGIN \
		and right_public.size_flags_vertical == Control.SIZE_SHRINK_BEGIN \
		and left_public.alignment == BoxContainer.ALIGNMENT_END \
		and right_public.alignment == BoxContainer.ALIGNMENT_BEGIN \
		and right_row.get_child(0).name == "PublicMelds" \
		and right_row.get_child(1).name == "PrivateFan" \
		and not left_state.visible and not right_state.visible \
		and left_state.text.is_empty() and right_state.text.is_empty() \
		and not _subtree_contains_text(left, "等待") \
		and not _subtree_contains_text(right, "等待")
	left.free()
	right.free()
	return valid

func debug_validate_action_buttons_top_row() -> bool:
	var state := {
		"currentPlayerIndex": 0,
		"activePlayerIndex": 0,
		"awaitingHumanInput": true,
		"isGameOver": false,
		"phase": "bao_selection",
		"availableActions": [
			{"type": "bao", "cards": [], "isMandatory": false},
			{"type": "pass_bao", "cards": [], "isMandatory": false},
		],
		"players": [
			{"cards": [], "melds": []},
			{"cards": [], "melds": []},
			{"cards": [], "melds": []},
		],
	}
	var area := _build_player_area(state, true)
	var row := area.get_node_or_null("PlayerActionRow") as HBoxContainer
	var banner := row.get_node_or_null("ActionBanner") as Label if row != null else null
	var buttons := row.get_node_or_null("PlayerActionButtons") as HBoxContainer if row != null else null
	var center := _build_center(state, false)
	var center_buttons := center.get_node("StackCenter/Stack/ResponseActions") as CenterContainer
	var valid := row != null \
		and banner != null \
		and buttons != null \
		and banner.text == "可爆" \
		and row.offset_top == 2.0 \
		and row.get_child(0) == banner \
		and row.get_child(1) == buttons \
		and buttons.get_child_count() == 2 \
		and center_buttons.get_child_count() == 0
	area.free()
	center.free()
	return valid

func debug_validate_no_placeholder_text() -> bool:
	var state := {
		"currentPlayerIndex": 0,
		"phase": "discarding",
		"discardPile": {},
		"players": [
			{"cards": [], "melds": []},
			{"cards": [], "melds": []},
			{"cards": [], "melds": []},
		],
	}
	var surface := _build_table_surface(state, false)
	var valid := not _subtree_contains_text(surface, "等待") and not _subtree_contains_text(surface, "无待响应牌")
	surface.free()
	return valid

func debug_validate_deck_stack_presentation() -> bool:
	var state := {
		"remainingDeckCards": 12,
		"phase": "drawing",
		"players": [{"cards": [], "melds": []}, {"cards": [], "melds": []}, {"cards": [], "melds": []}],
	}
	var center := _build_center(state, false)
	var deck_stack := center.get_node_or_null("DeckStack") as Control
	var valid := deck_stack != null and deck_stack.visible and deck_stack.is_in_group("live_deck_anchor") and deck_stack.get_child_count() == 3
	valid = valid and DECK_STACK_CARD_STEP.x > 0.0 and is_zero_approx(DECK_STACK_CARD_STEP.y) \
		and DECK_STACK_CARD_SIZE.x > DECK_STACK_CARD_SIZE.y \
		and is_equal_approx(DECK_STACK_CARD_SIZE.x / DECK_STACK_CARD_SIZE.y, 300.0 / 180.0) \
		and is_equal_approx(ACTION_ANIMATION_CARD_SIZE.y / ACTION_ANIMATION_CARD_SIZE.x, CARD_FACE_HEIGHT_RATIO)
	if deck_stack != null:
		for index in deck_stack.get_child_count():
			var deck_back := deck_stack.get_child(index) as Control
			valid = valid and deck_back != null and deck_back.custom_minimum_size == DECK_STACK_CARD_SIZE and deck_back.position == DECK_STACK_CARD_STEP * float(index)
	center.free()
	return valid

func debug_validate_discard_zone_coordinates() -> bool:
	var state := {
		"phase": "drawing",
		"players": [{"cards": [], "melds": []}, {"cards": [], "melds": []}, {"cards": [], "melds": []}],
		"discardPile": {},
	}
	var root := Control.new()
	root.size = Vector2(1280, 720)
	var zones := _build_discard_zones(state, false)
	root.add_child(zones)
	_layout_discard_zones(zones)
	var p0 := zones.get_node("DiscardZone_0") as Control
	var p1 := zones.get_node("DiscardZone_1") as Control
	var p2 := zones.get_node("DiscardZone_2") as Control
	var a0 := zones.get_node("DiscardAnchor_0") as Control
	var a1 := zones.get_node("DiscardAnchor_1") as Control
	var a2 := zones.get_node("DiscardAnchor_2") as Control
	var valid := p0 != null and p1 != null and p2 != null \
		and a0 != null and a1 != null and a2 != null \
		and p0.position.is_equal_approx(Vector2(400, 300)) \
		and p1.position.is_equal_approx(Vector2(50, 300)) \
		and p2.position.is_equal_approx(Vector2(1032, 300)) \
		and a0.position.is_equal_approx(Vector2(400, 300)) \
		and a1.position.is_equal_approx(Vector2(50, 300)) \
		and a2.position.is_equal_approx(Vector2(1150, 300)) \
		and p0.get_node_or_null("Body/Archive") is HBoxContainer \
		and p1.get_node_or_null("Body/Archive") is HBoxContainer \
		and p2.get_node_or_null("Body/Archive") is HBoxContainer \
		and (p1.get_node("Body/Archive") as HBoxContainer).alignment == BoxContainer.ALIGNMENT_BEGIN \
		and (p2.get_node("Body/Archive") as HBoxContainer).alignment == BoxContainer.ALIGNMENT_END
	root.free()
	return valid

func debug_validate_discard_zone_transparency() -> bool:
	var state := {
		"phase": "drawing",
		"players": [{"cards": [], "melds": []}, {"cards": [], "melds": []}, {"cards": [], "melds": []}],
		"discardPile": {},
	}
	var center := _build_center(state, false)
	var valid := true
	for player_index in 3:
		var zone := center.get_node("DiscardZones/DiscardZone_%d" % player_index) as Control
		valid = valid and zone != null and zone.get_theme_stylebox("panel") is StyleBoxEmpty
	center.free()
	return valid

func debug_validate_player_hand_transparency() -> bool:
	var state := {
		"phase": "drawing",
		"players": [{"cards": [], "melds": []}, {"cards": [], "melds": []}, {"cards": [], "melds": []}],
		"discardPile": {},
	}
	var area := _build_player_area(state, false)
	var valid := area.get_theme_stylebox("panel") is StyleBoxEmpty
	area.free()
	return valid

func debug_validate_drag_y_threshold() -> bool:
	var previous_drag_id := _drag_card_id
	var previous_state := AIService.latest_state.duplicate(true)
	_drag_card_id = "threshold-card"
	var state := {
		"currentPlayerIndex": 0,
		"awaitingHumanInput": true,
		"phase": "discarding",
		"availableActions": [{"type": "discard", "cards": [{"id": "threshold-card"}]}],
	}
	AIService.latest_state = state
	var under_threshold := _can_drop_dragged_card(Vector2(500, 299))
	var at_threshold := _can_drop_dragged_card(Vector2(500, 300))
	_drag_card_id = previous_drag_id
	AIService.latest_state = previous_state
	return under_threshold and not at_threshold

func debug_validate_discard_stack_layout() -> bool:
	var active := {"id": "pending-top", "rank": "陆", "value": 6, "size": "small"}
	var archived := {"id": "archived-bottom", "rank": "玖", "value": 9, "size": "big"}
	var response := {
		"phase": "response_collecting",
		"pendingCardSource": "discard",
		"players": [{"cards": [], "melds": []}, {"cards": [], "melds": []}, {"cards": [], "melds": []}],
		"discardPile": {
			"lastDiscard": active,
			"lastDiscardPlayerIndex": 1,
			"cards": [archived, active],
			"discardHistory": [
				{"card": archived, "playerIndex": 1, "source": "discard"},
				{"card": active, "playerIndex": 1, "source": "discard"},
			],
		},
	}
	var center := _build_center(response, false)
	var left_zone := center.get_node("DiscardZones/DiscardZone_1") as Control
	var right_zone := center.get_node("DiscardZones/DiscardZone_2") as Control
	var pending_slot := left_zone.get_node("Body/Archive/PendingCard") as CenterContainer
	var pending_art := pending_slot.get_child(0) as Control if pending_slot != null and pending_slot.get_child_count() > 0 else null
	var left_archive := left_zone.get_node("Body/Archive")
	var right_archive := right_zone.get_node("Body/Archive")
	var valid: bool = left_archive is HBoxContainer \
		and right_archive is HBoxContainer \
		and pending_art != null \
		and pending_slot.custom_minimum_size == DISCARD_PENDING_CARD_SIZE \
		and left_archive.custom_minimum_size.y == DISCARD_PENDING_CARD_SIZE.y \
		and pending_art.clip_contents
	center.free()
	return valid

func debug_validate_coordinate_ruler() -> bool:
	var ruler := _build_coordinate_ruler()
	var horizontal := ruler.get_node_or_null("HorizontalTicks") as Control
	var vertical := ruler.get_node_or_null("VerticalTicks") as Control
	var valid := ruler.name == "CoordinateRuler" \
		and str(ruler.get_meta("coordinate_space", "")) == "table_surface" \
		and horizontal != null \
		and vertical != null \
		and horizontal.get_child_count() >= 26 \
		and vertical.get_child_count() >= 17
	ruler.free()
	return valid

func debug_validate_discard_zone_orientation() -> bool:
	var cards := [
		{"id": "discard-p0", "value": 1, "size": "small"},
		{"id": "discard-p1", "value": 2, "size": "small"},
		{"id": "discard-p2", "value": 3, "size": "small"},
	]
	var state := {
		"phase": "drawing",
		"players": [{"cards": [], "melds": []}, {"cards": [], "melds": []}, {"cards": [], "melds": []}],
		"discardPile": {
			"cards": cards,
			"discardHistory": [
				{"card": cards[0], "playerIndex": 0},
				{"card": cards[1], "playerIndex": 1},
				{"card": cards[2], "playerIndex": 2},
			],
		},
	}
	var center := _build_center(state, false)
	var valid := true
	for player_index in 3:
		var zone := center.get_node("DiscardZones/DiscardZone_%d" % player_index) as Control
		var archive := zone.get_node_or_null("Body/Archive") if zone != null else null
		valid = valid and archive != null \
			and archive is HBoxContainer \
			and zone.get_node_or_null("Body/Title") == null
	center.free()
	return valid

func debug_validate_table_mirror_layout() -> bool:
	var state := {
		"currentPlayerIndex": 0,
		"players": [
			{"cards": [], "melds": []},
			{"cards": [{"id": "p1-card"}], "melds": []},
			{"cards": [{"id": "p2-card"}], "melds": []},
		],
	}
	var left := _build_opponent_seat(state, 1, false)
	var right := _build_opponent_seat(state, 2, false)
	var left_row := left.get_node("Badge/TableRow") as HBoxContainer
	var right_row := right.get_node("Badge/TableRow") as HBoxContainer
	var left_private := left.get_node("Badge/TableRow/PrivateFan") as HBoxContainer
	var left_public := left.get_node("Badge/TableRow/PublicMelds") as HBoxContainer
	var right_private := right.get_node("Badge/TableRow/PrivateFan") as HBoxContainer
	var right_public := right.get_node("Badge/TableRow/PublicMelds") as HBoxContainer
	var surface := _build_table_surface(state, false)
	var left_slot := surface.get_node("OpponentLeftSlot") as Control
	var right_slot := surface.get_node("OpponentRightSlot") as Control
	var valid := left_row.get_child(0).name == "PrivateFan" \
		and right_row.get_child(0).name == "PublicMelds" \
		and left_private.alignment == BoxContainer.ALIGNMENT_BEGIN \
		and left_public.alignment == BoxContainer.ALIGNMENT_END \
		and right_public.alignment == BoxContainer.ALIGNMENT_BEGIN \
		and right_private.alignment == BoxContainer.ALIGNMENT_END \
		and is_equal_approx(left_slot.offset_top, right_slot.offset_top) \
		and is_equal_approx(left_slot.offset_bottom, right_slot.offset_bottom)
	left.free()
	right.free()
	surface.free()
	return valid

func debug_validate_three_discard_zones() -> bool:
	var state := {
		"phase": "discarding",
		"discardPile": {},
		"players": [{"cards": [], "melds": []}, {"cards": [], "melds": []}, {"cards": [], "melds": []}],
	}
	var center := _build_center(state, false)
	var zones := center.get_node_or_null("DiscardZones") as Control
	var valid := zones != null and zones.get_child_count() == 6
	for player_index in 3:
		var anchor := zones.get_node_or_null("DiscardAnchor_%d" % player_index) as Control if zones != null else null
		valid = valid and anchor != null and anchor.is_in_group("live_discard_zone_%d" % player_index)
	center.free()
	return valid

func debug_validate_discard_zone_states() -> bool:
	var active := {"id": "zone-active", "rank": "陆", "value": 6, "size": "small"}
	var archived := {"id": "zone-archived", "rank": "玖", "value": 9, "size": "big"}
	var response := {
		"phase": "response_collecting",
		"pendingCardSource": "discard",
		"discardPile": {
			"lastDiscard": active,
			"lastDiscardPlayerIndex": 1,
			"cards": [archived, active],
			"discardHistory": [
				{"card": archived, "playerIndex": 1, "source": "discard"},
				{"card": active, "playerIndex": 1, "source": "discard"},
			],
		},
	}
	var center := _build_center(response, false)
	var zones := center.get_node("DiscardZones") as Control
	var active_zone := zones.get_node("DiscardZone_1") as Control
	var other_zone := zones.get_node("DiscardZone_2") as Control
	var pending := _subtree_group_nodes(center, "live_discard_pending")
	var archived_nodes := _subtree_group_nodes(center, "live_discard_archived")
	var active_ok: bool = str(_discard_zone_pending_card(response, 1).get("id", "")) == "zone-active" and pending.size() == 1 and archived_nodes.size() == 1
	var no_response := response.duplicate(true)
	no_response["phase"] = "drawing"
	no_response.erase("pendingCardSource")
	var archive_center := _build_center(no_response, false)
	var archive_zone := archive_center.get_node("DiscardZones/DiscardZone_1") as Control
	var archived_mode := _subtree_group_nodes(archive_center, "live_discard_pending").is_empty()
	var valid := active_ok and other_zone != null and archived_mode
	center.free()
	archive_center.free()
	return valid

func debug_validate_discard_chip_real_art() -> bool:
	var card := {"id": "real-chip", "rank": "玖", "value": 9, "size": "big"}
	var chip := _unresponded_discard_chip(card, {"card": card, "source": "draw"})
	var art := chip.get_node_or_null("Body/DiscardCardArt") as Control
	var texture_loaded := false
	if art != null and art.get_child_count() == 1:
		var full_art := art.get_child(0) as Control
		if full_art != null and full_art.get_child_count() == 1:
			var texture := full_art.get_child(0) as TextureRect
			texture_loaded = texture != null and texture.texture != null
	var valid := chip.custom_minimum_size == Vector2(PUBLIC_MELD_GROUP_WIDTH, PUBLIC_MELD_CARD_VISIBLE_HEIGHT + 6.0) \
		and art != null \
		and art.custom_minimum_size == Vector2(PUBLIC_MELD_CARD_WIDTH, PUBLIC_MELD_CARD_VISIBLE_HEIGHT) \
		and chip.get_node_or_null("Body/Source") == null \
		and texture_loaded
	chip.free()
	return valid

func _center_context_text(state: Dictionary) -> String:
	var response := _response_context_text(state)
	if not response.is_empty():
		return response
	if str(state.get("phase", "")) == "bao_selection":
		var bao := _available_action(state, "bao")
		return str(bao.get("description", "爆牌选择")) if not bao.is_empty() else "爆牌选择"
	if str(state.get("phase", "")) == "discarding" and not _available_action(state, "bao").is_empty():
		return "可选爆牌，也可拖动手牌出牌"
	return ""

func _build_center_actions(state: Dictionary) -> Control:
	var phase := str(state.get("phase", ""))
	if phase not in ["response_collecting", "bao_selection", "discarding"] or not _state_awaiting_human(state) or bool(state.get("isGameOver", false)):
		return null
	var actions: Array = state.get("availableActions", [])
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 6)
	var allowed_types: Array[String] = ["hu", "zhao", "peng", "chi", "pass"]
	var seen_bao_faces := {}
	if phase == "bao_selection":
		allowed_types = ["bao", "pass_bao"]
	elif phase == "discarding":
		allowed_types = ["bao"]
	for action_index in actions.size():
		var raw_action = actions[action_index]
		var action: Dictionary = raw_action
		var action_type := str(action.get("type", ""))
		if not allowed_types.has(action_type):
			continue
		var button: Button
		var action_cards: Array = Array(action.get("cards", []))
		if action_type == "bao" and not action_cards.is_empty():
			var candidate_card: Dictionary = action_cards[0]
			var bao_face_key := _card_size_text(candidate_card)
			if seen_bao_faces.has(bao_face_key):
				continue
			seen_bao_faces[bao_face_key] = true
			var submit_callback := _make_action_snapshot_callback(action, func(payload: Dictionary): _submit_available_action(payload))
			button = _option_picker_card_button("爆", action_index + 1, [candidate_card], action_cards, submit_callback)
			button.tooltip_text = str(action.get("description", _card_size_text(candidate_card)))
		else:
			button = _response_button(action)
		button.disabled = _advice_loading or _ai_advancing or _ai_demo_running
		row.add_child(button)
	return row if not row.get_children().is_empty() else null

func _response_button(action: Dictionary) -> Button:
	var action_type := str(action.get("type", ""))
	var button := Button.new()
	button.text = _action_label(action)
	if action_type == "bao" and not Array(action.get("cards", [])).is_empty():
		button.text = "%s %s" % [_action_text(action_type), _card_text(Dictionary(Array(action.get("cards", []))[0]))]
	button.custom_minimum_size = Vector2(68 if action_type == "bao" else 52, 32)
	button.add_theme_font_size_override("font_size", 14)
	button.add_theme_color_override("font_color", PAPER if action_type in ["hu", "pass", "pass_bao"] else INK)
	var normal := GOLD
	var hover := Color("f6d27b")
	if action_type == "hu":
		normal = Color("247250")
		hover = Color("319464")
	elif action_type in ["pass", "pass_bao"]:
		normal = Color("78402f")
		hover = Color("98513b")
	button.add_theme_stylebox_override("normal", _box(normal, 4, 5, PAPER_DIM if action_type == "hu" else Color("7f5638"), 1))
	button.add_theme_stylebox_override("hover", _box(hover, 4, 5, GOLD, 1))
	button.pressed.connect(func(): _submit_available_action(action))
	return button

func _discard_history_strip(state: Dictionary) -> Control:
	var pile: Dictionary = state.get("discardPile", {})
	var history: Array = pile.get("discardHistory", [])
	if history.is_empty():
		return null
	var strip := HBoxContainer.new()
	strip.alignment = BoxContainer.ALIGNMENT_CENTER
	strip.add_theme_constant_override("separation", 3)
	var start := maxi(0, history.size() - 8)
	for index in range(start, history.size()):
		var entry: Dictionary = history[index]
		var card: Dictionary = entry.get("card", {})
		var item := VBoxContainer.new()
		item.alignment = BoxContainer.ALIGNMENT_CENTER
		item.tooltip_text = _discard_source_text(entry)
		item.add_child(_card_art(card, Vector2(10, 40)))
		strip.add_child(item)
	return strip

func _build_player_area(state: Dictionary, interactive: bool = true, replay_view: bool = false) -> Control:
	var frame := PLAYER_HAND_AREA_SCENE.instantiate() as Panel
	frame.add_to_group("live_turn_seat_0")
	frame.add_theme_stylebox_override("panel", StyleBoxEmpty.new())
	var action_banner := _build_player_action_banner(state, interactive, 0, true)
	action_banner.add_to_group("live_action_anchor_0")
	var action_buttons := _build_center_actions(state) if interactive else null
	var action_row := HBoxContainer.new()
	action_row.name = "PlayerActionRow"
	action_row.set_anchors_preset(Control.PRESET_CENTER_TOP)
	action_row.offset_left = -230.0
	action_row.offset_top = 2.0
	action_row.offset_right = 230.0
	action_row.offset_bottom = 58.0
	action_row.alignment = BoxContainer.ALIGNMENT_CENTER
	action_row.add_theme_constant_override("separation", 8)
	action_row.z_index = 20
	action_row.mouse_filter = Control.MOUSE_FILTER_STOP if action_buttons != null else Control.MOUSE_FILTER_IGNORE
	action_row.add_child(action_banner)
	if action_buttons != null:
		action_buttons.name = "PlayerActionButtons"
		action_row.add_child(action_buttons)
	frame.add_child(action_row)
	var players: Array = state.get("players", [])
	var arrangement := frame.get_node("Panel/Header/ArrangeButton") as Button
	arrangement.tooltip_text = "恢复自动组合"
	arrangement.add_theme_font_size_override("font_size", 11)
	arrangement.visible = not replay_view
	arrangement.pressed.connect(func(): _toggle_hand_arrangement())
	var player_melds: Array = Dictionary(players[0]).get("melds", []) if not players.is_empty() else []
	var free_hand_slot := frame.get_node("Panel/Body/FreeHandSlot") as Control
	free_hand_slot.add_to_group("live_hand_source_0")
	var human_cards: Array = Array(Dictionary(players[0]).get("cards", [])) if not players.is_empty() else []
	var locked_melds := _locked_hand_melds(state)
	var free_hand: Control
	if replay_view:
		_free_hand_track = null
		_free_hand_card_nodes.clear()
		_rendered_free_hand_cards.clear()
		_rendered_hand_groups.clear()
		free_hand = _build_replay_hand_groups(human_cards)
	else:
		free_hand = _build_free_hand_area(human_cards, locked_melds, state, interactive)
	free_hand.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	free_hand_slot.add_child(free_hand)
	var exposed := frame.get_node("Panel/Body/ExposedMelds") as VBoxContainer
	exposed.add_to_group("live_meld_target_0")
	_clear_container(exposed)
	exposed.visible = not player_melds.is_empty()
	if not player_melds.is_empty():
		var meld_label := Label.new()
		meld_label.text = "已亮"
		meld_label.add_theme_font_size_override("font_size", 11)
		meld_label.add_theme_color_override("font_color", PAPER_DIM)
		exposed.add_child(meld_label)
		exposed.add_child(_opponent_public_melds(player_melds))
	return frame

func _build_player_action_banner(state: Dictionary, interactive: bool = true, player_index: int = 0, flow_layout: bool = false) -> Label:
	var banner := Label.new()
	banner.name = "ActionBanner"
	banner.text = _player_action_banner_text(state, player_index) if interactive else ""
	banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	banner.mouse_filter = Control.MOUSE_FILTER_IGNORE
	banner.z_index = 10
	if flow_layout:
		banner.custom_minimum_size = Vector2(0, 42)
		banner.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	else:
		banner.set_anchors_preset(Control.PRESET_CENTER_TOP)
		banner.offset_left = -180.0
		banner.offset_top = 4.0
		banner.offset_right = 180.0
		banner.offset_bottom = 54.0
	banner.add_theme_font_size_override("font_size", clampi(int(_hand_card_dimensions().y * 0.58), 32, 42))
	banner.add_theme_color_override("font_color", GOLD)
	banner.add_theme_color_override("font_outline_color", Color("0b2418", 0.95))
	banner.add_theme_constant_override("outline_size", 5)
	banner.visible = not banner.text.is_empty()
	return banner

func _player_action_banner_text(state: Dictionary, player_index: int = 0) -> String:
	if bool(state.get("isGameOver", false)) or _state_active_player(state) != player_index:
		return ""
	if player_index == 0 and not _state_awaiting_human(state):
		return ""

	var actions: Array = state.get("availableActions", [])
	var phase := str(state.get("phase", ""))
	if phase == "response_collecting":
		for raw_action in actions:
			var action: Dictionary = raw_action
			if bool(action.get("isMandatory", false)) and str(action.get("type", "")) != "pass":
				return _action_label(action)
		for action_type in ["hu", "zhao", "peng", "chi", "pass"]:
			if not _available_action(state, action_type).is_empty():
				return "可" + _action_text(action_type)
		return "响应"
	if phase == "bao_selection":
		if not _available_action(state, "bao").is_empty():
			return "可爆"
		return "爆牌选择"
	if phase == "drawing" and not _available_action(state, "draw").is_empty():
		return "摸牌"
	if phase == "discarding":
		var can_bao := not _available_action(state, "bao").is_empty()
		var can_discard := not _available_action(state, "discard").is_empty()
		if can_bao and can_discard:
			return "可爆 · 出牌"
		if can_bao:
			return "可爆"
		if can_discard:
			return "出牌"
	return ""

func _build_locked_hand_area(human_cards: Array, locked_melds: Array) -> Control:
	var area := PanelContainer.new()
	area.custom_minimum_size.x = 86
	area.tooltip_text = "规则锁定搭子，不可拆散、不可拖动、不可出牌"
	area.add_theme_stylebox_override("panel", _box(Color("0c251a", 0.86), 4, 5, Color("5f7968"), 1))
	var panel := VBoxContainer.new()
	panel.alignment = BoxContainer.ALIGNMENT_END
	panel.add_theme_constant_override("separation", 4)
	area.add_child(panel)
	var title := Label.new()
	title.text = "暗搭子"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 11)
	title.add_theme_color_override("font_color", Color("a8b4ab"))
	panel.add_child(title)
	for raw_meld in locked_melds:
		var meld: Dictionary = raw_meld
		var column := VBoxContainer.new()
		column.alignment = BoxContainer.ALIGNMENT_END
		var stack_metrics := _card_stack_metrics(26.0)
		column.add_theme_constant_override("separation", -int(roundf(float(stack_metrics.get("visible_height", 26.0)) - float(stack_metrics.get("step", 16.0)))))
		for raw_id in Array(meld.get("cardIds", [])):
			var card := _find_card_in_array(human_cards, str(raw_id))
			if card.is_empty():
				continue
			var art := _cropped_hand_card_art(card, float(stack_metrics.get("width", 26.0)), float(stack_metrics.get("visible_height", 26.0)))
			art.add_to_group("live_card_face")
			art.set_meta("animation_card_id", str(card.get("id", "")))
			art.modulate = Color(0.37, 0.40, 0.38, 0.96)
			column.add_child(art)
		panel.add_child(column)
	return area

func _build_free_hand_area(human_cards: Array, locked_melds: Array, state: Dictionary, interactive: bool = true) -> Control:
	var area := Control.new()
	area.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	area.size_flags_vertical = Control.SIZE_EXPAND_FILL
	area.clip_contents = false
	area.resized.connect(_layout_free_hand_cards)
	_free_hand_track = area
	_free_hand_card_nodes.clear()
	_drag_card_positions.clear()
	_rendered_locked_card_ids = _locked_hand_ids(locked_melds)
	var free_cards: Array = []
	for raw_card in human_cards:
		var hand_card: Dictionary = raw_card
		if not _rendered_locked_card_ids.has(str(hand_card.get("id", ""))):
			free_cards.append(hand_card)
	_sync_free_hand_order(free_cards)
	_rendered_source_free_cards = free_cards.duplicate(true)
	_rendered_hand_groups = _hand_display_groups(human_cards, locked_melds)
	var ordered_cards: Array = []
	for group in _rendered_hand_groups:
		for raw_card in Array(group.get("cards", [])):
			ordered_cards.append(raw_card)
	_rendered_free_hand_cards = ordered_cards.duplicate(true)
	var card_dimensions := _hand_card_dimensions()
	var card_width := card_dimensions.x
	var card_height := card_dimensions.y
	_drag_card_size = Vector2(card_width, card_height)
	_rendered_free_hand_order.clear()
	for raw_card in ordered_cards:
		var rendered_id := str(Dictionary(raw_card).get("id", ""))
		if not _rendered_locked_card_ids.has(rendered_id):
			_rendered_free_hand_order.append(rendered_id)
	var positions := _hand_group_positions_by_id(_rendered_hand_groups, area, card_width, card_height)
	for index in ordered_cards.size():
		var card: Dictionary = ordered_cards[index]
		var card_id := str(card.get("id", ""))
		var position: Vector2 = positions.get(card_id, Vector2.ZERO)
		_drag_card_positions[card_id] = position
		var locked := _rendered_locked_card_ids.has(card_id)
		var button := _build_draggable_card(card, card_width, card_height, interactive and not locked and _can_submit_card_id(state, card_id), interactive and not locked, locked)
		button.position = position
		button.z_index = index + 2
		area.add_child(button)
		_free_hand_card_nodes[card_id] = button
	call_deferred("_update_current_free_hand_track_rect")
	return area

func _card_stack_metrics(card_width: float) -> Dictionary:
	var width := maxf(card_width, 1.0)
	var visible_height := width * CARD_STACK_VISIBLE_HEIGHT_RATIO
	var step := maxf(visible_height * CARD_STACK_STEP_RATIO, 1.0)
	return {
		"width": width,
		"visible_height": visible_height,
		"step": step,
		"full_height": width * CARD_FACE_HEIGHT_RATIO,
	}

func _hand_card_dimensions() -> Vector2:
	var viewport_scale := clampf(get_viewport_rect().size.y / 720.0, 0.90, 1.0)
	var metrics := _card_stack_metrics(57.0 * viewport_scale)
	return Vector2(metrics.get("width", 57.0), metrics.get("visible_height", 57.0))

func _update_free_hand_track_rect(track: Control) -> void:
	if is_instance_valid(track):
		_drag_track_global_rect = track.get_global_rect()
		_layout_free_hand_cards()

func _update_current_free_hand_track_rect() -> void:
	if is_instance_valid(_free_hand_track):
		_update_free_hand_track_rect(_free_hand_track)

func _layout_free_hand_cards() -> void:
	if not is_instance_valid(_free_hand_track) or _rendered_free_hand_cards.is_empty():
		return
	var positions := _hand_group_positions_by_id(_rendered_hand_groups, _free_hand_track, _drag_card_size.x, _drag_card_size.y)
	for raw_card in _rendered_free_hand_cards:
		var card: Dictionary = raw_card
		var card_id := str(card.get("id", ""))
		if not _free_hand_card_nodes.has(card_id):
			continue
		var node: Control = _free_hand_card_nodes[card_id]
		var target: Vector2 = positions.get(card_id, node.position)
		node.position = target
		_drag_card_positions[card_id] = target
	_drag_track_global_rect = _free_hand_track.get_global_rect()

func _free_hand_positions(cards: Array, area: Control, card_width: float, card_height: float) -> Array[Vector2]:
	var positions: Array[Vector2] = []
	var count := cards.size()
	if count == 0:
		return positions
	var available := maxf(area.size.x - 16.0, card_width)
	var gap := minf(card_width * 0.82, maxf(4.0, (available - card_width) / maxf(float(count - 1), 1.0)))
	var total_width := card_width + gap * maxf(float(count - 1), 0.0)
	var start_x := maxf(8.0, (area.size.x - total_width) * 0.5)
	var base_y := maxf(18.0, area.size.y - card_height - 2.0)
	for index in count:
		positions.append(Vector2(start_x + gap * index, base_y))
	return positions

func _hand_group_positions_by_id(groups: Array, area: Control, card_width: float, card_height: float) -> Dictionary:
	var positions := {}
	if groups.is_empty():
		return positions
	var group_count := groups.size()
	var available := maxf(area.size.x - 16.0, card_width)
	var group_gap := minf(card_width * 1.18, maxf(5.0, (available - card_width) / maxf(float(group_count - 1), 1.0)))
	var total_width := card_width + group_gap * maxf(float(group_count - 1), 0.0)
	var start_x := maxf(8.0, (area.size.x - total_width) * 0.5)
	var vertical_step := float(_card_stack_metrics(card_width).get("step", card_height))
	for group_index in group_count:
		var group: Dictionary = groups[group_index]
		var group_cards: Array = group.get("cards", [])
		# Keep the lowest card fixed at the bottom edge. Extra cards extend upward
		# instead of pushing the visible bottom of the column out of the hand area.
		var base_y := area.size.y - card_height - 2.0
		var start_y := base_y - vertical_step * maxf(float(group_cards.size() - 1), 0.0)
		for card_index in group_cards.size():
			var card: Dictionary = group_cards[card_index]
			positions[str(card.get("id", ""))] = Vector2(start_x + group_gap * group_index, start_y + vertical_step * card_index)
	return positions

func _cropped_hand_card_art(card: Dictionary, card_width: float, visible_height: float) -> Control:
	var crop := Control.new()
	crop.custom_minimum_size = Vector2(card_width, visible_height)
	crop.size = Vector2(card_width, visible_height)
	crop.clip_contents = true
	crop.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var full_art := _card_art(card, Vector2(card_width, card_width * CARD_FACE_HEIGHT_RATIO))
	full_art.position = Vector2.ZERO
	crop.add_child(full_art)
	return crop

func _build_draggable_card(card: Dictionary, card_width: float, card_height: float, can_discard: bool, interactive: bool, locked: bool = false) -> Button:
	var button := Button.new()
	var card_id := str(card.get("id", ""))
	button.name = "FreeCard_" + card_id
	button.add_to_group("live_card_face")
	button.set_meta("animation_card_id", card_id)
	button.text = ""
	button.custom_minimum_size = Vector2(card_width, card_height)
	button.size = Vector2(card_width, card_height)
	button.clip_contents = true
	button.tooltip_text = _card_text(card) + (" · 已锁定" if locked else "")
	button.disabled = locked or not interactive or _advice_loading or _ai_advancing or _ai_demo_running
	button.add_theme_stylebox_override("normal", _box(Color("ffffff", 0), 4, 0))
	button.add_theme_stylebox_override("hover", _box(Color("fff7e8", 0.15), 4, 1, GOLD, 2))
	if card_id == selected_card_id:
		button.add_theme_stylebox_override("normal", _box(Color("fff7e8", 0.18), 4, 1, GOLD, 3))
	var art := _cropped_hand_card_art(card, card_width, card_height)
	if locked:
		art.modulate = Color(0.37, 0.40, 0.38, 0.96)
	button.add_child(art)
	if interactive:
		button.gui_input.connect(func(event: InputEvent): _on_free_card_gui_input(event, card_id))
		button.pressed.connect(func(): _on_free_card_pressed(card_id))
	return button

func _on_free_card_gui_input(event: InputEvent, card_id: String) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		if _can_begin_hand_drag(card_id):
			_pointer_down_card_id = card_id
			_pointer_down_position = event.global_position
			_drag_pointer_offset = event.position
			get_viewport().set_input_as_handled()

func _on_free_card_pressed(card_id: String) -> void:
	if Time.get_ticks_msec() < _drag_click_suppressed_until:
		return
	_select_human_card(card_id)

func _locked_hand_melds(state: Dictionary) -> Array:
	var presentation: Dictionary = state.get("handPresentation", {})
	var raw_melds: Array = presentation.get("lockedHandMelds", [])
	var legal_ids := _discard_card_ids(state)
	var result: Array = []
	for raw_meld in raw_melds:
		var meld: Dictionary = raw_meld
		if bool(meld.get("draggable", true)) or not bool(meld.get("isConcealed", false)):
			continue
		var ids: Array = meld.get("cardIds", [])
		if ids.is_empty() or ids.any(func(raw_id: Variant) -> bool: return legal_ids.has(str(raw_id))):
			continue
		result.append(meld)
	return result

func _locked_hand_ids(locked_melds: Array) -> Dictionary:
	var ids := {}
	for raw_meld in locked_melds:
		for raw_id in Array(Dictionary(raw_meld).get("cardIds", [])):
			ids[str(raw_id)] = true
	return ids

func _hand_display_groups(human_cards: Array, locked_melds: Array) -> Array[Dictionary]:
	var groups: Array[Dictionary] = []
	var locked_ids := _locked_hand_ids(locked_melds)
	for raw_meld in locked_melds:
		var meld: Dictionary = raw_meld
		var cards: Array = []
		for raw_id in Array(meld.get("cardIds", [])):
			var card := _find_card_in_array(human_cards, str(raw_id))
			if not card.is_empty():
				cards.append(card)
		if not cards.is_empty():
			groups.append({"kind": "locked", "label": "锁·" + str(meld.get("label", "坎")), "cards": cards})
	var free_cards: Array = []
	for raw_card in human_cards:
		var card: Dictionary = raw_card
		if not locked_ids.has(str(card.get("id", ""))):
			free_cards.append(card)
	var free_groups := _manual_hand_groups(free_cards, _free_hand_columns) if _manual_hand_layout else _hand_groups(free_cards)
	for group in free_groups:
		groups.append(group)
	return groups

func _discard_card_ids(state: Dictionary) -> Dictionary:
	var ids := {}
	for raw_action in Array(state.get("availableActions", [])):
		var action: Dictionary = raw_action
		if str(action.get("type", "")) != "discard":
			continue
		for raw_card in Array(action.get("cards", [])):
			ids[str(Dictionary(raw_card).get("id", ""))] = true
	return ids

func _find_card_in_array(cards: Array, card_id: String) -> Dictionary:
	for raw_card in cards:
		var card: Dictionary = raw_card
		if str(card.get("id", "")) == card_id:
			return card
	return {}

func _hand_arrangement_mode() -> String:
	return "manual" if _manual_hand_layout else "group"

func _hand_arrangement_short_label() -> String:
	return "手" if _manual_hand_layout else "组"

func _sync_free_hand_order(free_cards: Array) -> void:
	var current_replay_id := AIService.replay_id
	if _free_hand_replay_id != current_replay_id:
		_free_hand_replay_id = current_replay_id
		_free_hand_order.clear()
		_free_hand_columns.clear()
		if _force_auto_hand_layout:
			_manual_hand_layout = false
		else:
			var saved_layouts: Dictionary = AppState.settings.get("hand_layouts", {})
			var saved_layout: Variant = saved_layouts.get(_free_hand_replay_id, [])
			if typeof(saved_layout) == TYPE_DICTIONARY:
				_free_hand_columns = Array(Dictionary(saved_layout).get("columns", [])).duplicate(true)
				_manual_hand_layout = not _free_hand_columns.is_empty()
			elif typeof(saved_layout) == TYPE_ARRAY:
				for raw_id in Array(saved_layout):
					_free_hand_order.append(str(raw_id))
				_manual_hand_layout = not _free_hand_order.is_empty()
			else:
				_manual_hand_layout = false
	var current_ids: Array[String] = []
	for raw_card in free_cards:
		current_ids.append(str(Dictionary(raw_card).get("id", "")))
	if _manual_hand_layout:
		if _free_hand_columns.is_empty() and not _free_hand_order.is_empty():
			_free_hand_columns = _columns_from_groups(_legacy_manual_hand_groups(free_cards, _free_hand_order))
		_free_hand_columns = _sanitize_hand_columns(_free_hand_columns, current_ids)
		_free_hand_order = _flatten_hand_columns(_free_hand_columns)
	else:
		_free_hand_order = current_ids
	if not current_ids.is_empty():
		_force_auto_hand_layout = false

func _save_free_hand_order(persist: bool = true) -> void:
	if _free_hand_replay_id.is_empty():
		return
	var layouts: Dictionary = Dictionary(AppState.settings.get("hand_layouts", {})).duplicate(true)
	layouts[_free_hand_replay_id] = {"version": 2, "columns": _free_hand_columns.duplicate(true)}
	AppState.settings["hand_layouts"] = layouts
	if persist:
		AppState.save_settings()

func _flatten_hand_columns(columns: Array) -> Array[String]:
	var result: Array[String] = []
	for raw_column in columns:
		for raw_id in Array(raw_column):
			var card_id := str(raw_id)
			if not card_id.is_empty() and not result.has(card_id):
				result.append(card_id)
	return result

func _sanitize_hand_columns(raw_columns: Array, current_ids: Array[String]) -> Array:
	var result: Array = []
	var seen := {}
	for raw_column in raw_columns:
		if typeof(raw_column) != TYPE_ARRAY:
			continue
		var column: Array[String] = []
		for raw_id in Array(raw_column):
			var card_id := str(raw_id)
			if current_ids.has(card_id) and not seen.has(card_id):
				column.append(card_id)
				seen[card_id] = true
		if not column.is_empty():
			result.append(column)
	for card_id in current_ids:
		if not seen.has(card_id):
			result.append([card_id])
	return result

func _columns_from_groups(groups: Array) -> Array:
	var result: Array = []
	for raw_group in groups:
		var column: Array[String] = []
		for raw_card in Array(Dictionary(raw_group).get("cards", [])):
			var card_id := str(Dictionary(raw_card).get("id", ""))
			if not card_id.is_empty():
				column.append(card_id)
		if not column.is_empty():
			result.append(column)
	return result

func _automatic_hand_columns(free_cards: Array) -> Array:
	return _columns_from_groups(_hand_groups(free_cards))

func _ensure_manual_hand_columns() -> void:
	if _free_hand_columns.is_empty():
		_free_hand_columns = _automatic_hand_columns(_rendered_source_free_cards)
	_free_hand_order = _flatten_hand_columns(_free_hand_columns)

func _ordered_free_hand_cards(free_cards: Array) -> Array:
	var by_id := {}
	for raw_card in free_cards:
		var card: Dictionary = raw_card
		by_id[str(card.get("id", ""))] = card
	var result: Array = []
	for card_id in _free_hand_order:
		if by_id.has(card_id):
			result.append(by_id[card_id])
	for raw_card in free_cards:
		var card: Dictionary = raw_card
		if not result.has(card):
			result.append(card)
	return result

func _manual_hand_groups(free_cards: Array, columns: Array) -> Array[Dictionary]:
	var by_id := {}
	for raw_card in free_cards:
		var card: Dictionary = raw_card
		by_id[str(card.get("id", ""))] = card
	var result: Array[Dictionary] = []
	for raw_column in columns:
		var cards: Array = []
		for raw_id in Array(raw_column):
			var card_id := str(raw_id)
			if by_id.has(card_id):
				cards.append(by_id[card_id])
		if not cards.is_empty():
			result.append({"kind": "manual", "label": "自组", "cards": cards})
	return result

func _legacy_manual_hand_groups(free_cards: Array, ordered_ids: Array) -> Array[Dictionary]:
	var automatic := _hand_groups(free_cards)
	var group_by_card := {}
	for group_index in automatic.size():
		var group: Dictionary = automatic[group_index]
		for raw_card in Array(group.get("cards", [])):
			group_by_card[str(Dictionary(raw_card).get("id", ""))] = {
				"key": group_index,
				"kind": str(group.get("kind", "single")),
				"label": str(group.get("label", "")),
				"count": Array(group.get("cards", [])).size(),
			}
	var by_id := {}
	for raw_card in free_cards:
		var card: Dictionary = raw_card
		by_id[str(card.get("id", ""))] = card
	var ordered_cards: Array = []
	for raw_id in ordered_ids:
		var card_id := str(raw_id)
		if by_id.has(card_id):
			ordered_cards.append(by_id[card_id])
	for raw_card in free_cards:
		if not ordered_cards.has(raw_card):
			ordered_cards.append(raw_card)
	var result: Array[Dictionary] = []
	var current_key := -1
	for raw_card in ordered_cards:
		var card: Dictionary = raw_card
		var metadata: Dictionary = group_by_card.get(str(card.get("id", "")), {"key": -1, "kind": "single", "label": ""})
		var key := int(metadata.get("key", -1))
		if result.is_empty() or key != current_key:
			result.append({"kind": str(metadata.get("kind", "single")), "label": str(metadata.get("label", "")), "source_count": int(metadata.get("count", 1)), "cards": [card]})
			current_key = key
		else:
			var group_cards: Array = result[-1].get("cards", [])
			group_cards.append(card)
			result[-1]["cards"] = group_cards
	for group in result:
		var card_count := Array(group.get("cards", [])).size()
		if card_count == 1:
			group["kind"] = "single"
			group["label"] = ""
		elif card_count < int(group.get("source_count", card_count)):
			group["kind"] = "near"
			group["label"] = "近" + str(group.get("label", "搭"))
		group.erase("source_count")
	return result

func _can_begin_hand_drag(card_id: String) -> bool:
	if _dragging or _drag_settling or _advice_loading or _ai_advancing or _ai_demo_running:
		return false
	if _rendered_locked_card_ids.has(card_id):
		return false
	if not _free_hand_card_nodes.has(card_id):
		return false
	return not _find_human_card(card_id).is_empty()

func _hand_drop_reorders_cards() -> bool:
	return true

func _start_hand_drag(card_id: String, pointer_position: Vector2) -> void:
	if not _can_begin_hand_drag(card_id):
		return
	var source: Control = _free_hand_card_nodes.get(card_id)
	if not is_instance_valid(source):
		return
	_ensure_manual_hand_columns()
	_drag_card_id = card_id
	_drag_source_index = _free_hand_order.find(card_id)
	_drag_insert_index = -1
	_drag_drop_target = {}
	_dragging = true
	_drag_preview = source.duplicate()
	_drag_preview.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_drag_preview.top_level = true
	_drag_preview.position = pointer_position - _drag_pointer_offset
	_drag_preview.z_index = 120
	_drag_preview.pivot_offset = _drag_card_size * 0.5
	_drag_preview.scale = Vector2(1.08, 1.08)
	add_child(_drag_preview)
	source.modulate.a = 0.22
	_hand_layout_revision += 1
	_update_hand_drag(pointer_position)

func _update_hand_drag(pointer_position: Vector2) -> void:
	if not _dragging:
		return
	if is_instance_valid(_drag_preview):
		_drag_preview.position = pointer_position - _drag_pointer_offset
	if is_instance_valid(_discard_drop_zone):
		_discard_drop_zone.add_theme_stylebox_override("panel", StyleBoxEmpty.new())
	if _drag_track_global_rect.has_point(pointer_position):
		_drag_drop_target = _hand_drop_target(pointer_position)
		_drag_insert_index = 0 if not _drag_drop_target.is_empty() else -1
		_animate_hand_slots(_drag_drop_target)
	else:
		_drag_insert_index = -1
		_drag_drop_target = {}
		_animate_hand_slots({})

func _columns_without_card(columns: Array, card_id: String) -> Array:
	var result: Array = []
	for raw_column in columns:
		var column: Array = Array(raw_column).duplicate()
		column.erase(card_id)
		if not column.is_empty():
			result.append(column)
	return result

func _columns_after_drop(columns: Array, card_id: String, target: Dictionary) -> Array:
	var result := _columns_without_card(columns, card_id)
	if target.is_empty():
		return result
	var column_index := int(target.get("column", result.size()))
	if str(target.get("mode", "new")) == "stack" and not result.is_empty():
		column_index = clampi(column_index, 0, result.size() - 1)
		var column: Array = Array(result[column_index]).duplicate()
		column.insert(clampi(int(target.get("row", column.size())), 0, column.size()), card_id)
		result[column_index] = column
	else:
		result.insert(clampi(column_index, 0, result.size()), [card_id])
	return result

func _hand_drop_target(pointer_position: Vector2) -> Dictionary:
	var columns := _columns_without_card(_free_hand_columns, _drag_card_id)
	if columns.is_empty():
		return {"mode": "new", "column": 0, "row": 0}
	var local_x := pointer_position.x - _drag_track_global_rect.position.x
	var local_y := pointer_position.y - _drag_track_global_rect.position.y
	var column_centers: Array = []
	var closest_column := -1
	var closest_distance := INF
	for column_index in columns.size():
		var x_total := 0.0
		var positioned_cards := 0
		for raw_id in Array(columns[column_index]):
			var card_id := str(raw_id)
			if _drag_card_positions.has(card_id):
				x_total += Vector2(_drag_card_positions[card_id]).x + _drag_card_size.x * 0.5
				positioned_cards += 1
		var center_x := x_total / positioned_cards if positioned_cards > 0 else local_x
		column_centers.append(center_x)
		var distance := absf(local_x - center_x)
		if distance < closest_distance:
			closest_distance = distance
			closest_column = column_index
	# Snap only when the pointer is actually over a column. The compact 1.18x
	# column spacing intentionally leaves a narrow but usable gap for splitting.
	if closest_column >= 0 and closest_distance <= _drag_card_size.x * 0.52:
		var row := 0
		for raw_id in Array(columns[closest_column]):
			var card_id := str(raw_id)
			if _drag_card_positions.has(card_id):
				var position: Vector2 = _drag_card_positions[card_id]
				if local_y < position.y + _drag_card_size.y * 0.5:
					break
			row += 1
		return {"mode": "stack", "column": closest_column, "row": row}
	var insertion_column := columns.size()
	for column_index in column_centers.size():
		if local_x < float(column_centers[column_index]):
			insertion_column = column_index
			break
	return {"mode": "new", "column": insertion_column, "row": 0}

func _animate_hand_slots(drop_target: Dictionary) -> void:
	if not is_instance_valid(_free_hand_track):
		return
	var groups := _rendered_hand_groups
	if not drop_target.is_empty():
		var preview_columns := _columns_after_drop(_free_hand_columns, _drag_card_id, drop_target)
		groups = []
		for group in _rendered_hand_groups:
			if str(group.get("kind", "")) == "locked":
				groups.append(group)
		for group in _manual_hand_groups(_rendered_source_free_cards, preview_columns):
			groups.append(group)
	var targets := _hand_group_positions_by_id(groups, _free_hand_track, _drag_card_size.x, _drag_card_size.y)
	if str(drop_target.get("mode", "")) == "stack" and is_instance_valid(_drag_preview) and targets.has(_drag_card_id):
		_drag_preview.position = _drag_track_global_rect.position + Vector2(targets[_drag_card_id])
	if _hand_slot_tween != null and _hand_slot_tween.is_valid():
		_hand_slot_tween.kill()
	_hand_slot_tween = create_tween().set_parallel(true)
	for raw_id in _free_hand_card_nodes.keys():
		var card_id := str(raw_id)
		if card_id == _drag_card_id:
			continue
		var node: Control = _free_hand_card_nodes[card_id]
		if is_instance_valid(node) and targets.has(card_id):
			_hand_slot_tween.tween_property(node, "position", Vector2(targets[card_id]), ANIMATION_DURATION_SECONDS).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)

func _finish_hand_drag(pointer_position: Vector2) -> void:
	if not _dragging:
		return
	var card_id := _drag_card_id
	var drop_to_discard := _can_drop_dragged_card(pointer_position)
	var reorder_in_track := _drag_track_global_rect.has_point(pointer_position) and not _drag_drop_target.is_empty()
	var drop_target: Dictionary = _drag_drop_target.duplicate()
	_dragging = false
	_pointer_down_card_id = ""
	_drag_click_suppressed_until = Time.get_ticks_msec() + 120
	if is_instance_valid(_discard_drop_zone):
		_discard_drop_zone.add_theme_stylebox_override("panel", StyleBoxEmpty.new())
	if drop_to_discard:
		_clear_hand_drag_preview()
		selected_card_id = card_id
		_submit_discard()
		return
	if reorder_in_track:
		_free_hand_columns = _columns_after_drop(_free_hand_columns, card_id, drop_target)
		_free_hand_order = _flatten_hand_columns(_free_hand_columns)
		_manual_hand_layout = true
		_save_free_hand_order()
	_hand_layout_revision += 1
	_drag_settling = true
	_clear_hand_drag_preview()
	show_game()
	_drag_settling = false

func _clear_hand_drag_preview() -> void:
	if is_instance_valid(_drag_preview):
		_drag_preview.queue_free()
	_drag_preview = null
	if _free_hand_card_nodes.has(_drag_card_id):
		var source: Control = _free_hand_card_nodes[_drag_card_id]
		if is_instance_valid(source):
			source.modulate.a = 1.0
	_drag_card_id = ""
	_drag_source_index = -1
	_drag_insert_index = -1
	_drag_drop_target = {}

func _can_drop_discard(state: Dictionary) -> bool:
	return not state.is_empty() and _state_awaiting_human(state) and str(state.get("phase", "")) == "discarding" and not bool(state.get("isGameOver", false)) and not _ai_advancing and not _advice_loading and not _ai_demo_running and not _game_popup_visible()

func _game_popup_visible() -> bool:
	for popup in [option_popup, decision_popup, advice_popup, settlement_popup]:
		if is_instance_valid(popup) and popup.visible:
			return true
	return false

func _can_drop_dragged_card(pointer_position: Vector2) -> bool:
	if is_instance_valid(_discard_drop_surface):
		_discard_drop_global_rect = _discard_drop_hit_rect(_discard_drop_surface.get_global_rect())
	return _can_drop_discard(AIService.latest_state) and not _drag_card_id.is_empty() and _can_submit_card_id(AIService.latest_state, _drag_card_id) and pointer_position.y < DISCARD_DRAG_Y_THRESHOLD

func _can_submit_card_id(state: Dictionary, card_id: String) -> bool:
	if card_id.is_empty():
		return false
	return _discard_card_ids(state).has(card_id)

func debug_validate_locked_hand_presentation() -> bool:
	var state := {
		"availableActions": [{"type": "discard", "cards": [{"id": "single"}]}],
		"handPresentation": {"lockedHandMelds": [{"cardIds": ["k1", "k2", "k3"], "isConcealed": true, "draggable": false}]},
	}
	var locked := _locked_hand_melds(state)
	return locked.size() == 1 and _locked_hand_ids(locked).has("k2") and not _locked_hand_ids(locked).has("single")

func debug_validate_drag_discard_guard() -> bool:
	var legal := {"currentPlayerIndex": 0, "phase": "discarding", "availableActions": [{"type": "discard", "cards": [{"id": "s1"}]}]}
	var response := {"currentPlayerIndex": 0, "phase": "response_collecting", "availableActions": [{"type": "discard", "cards": [{"id": "s1"}]}]}
	return _can_drop_discard(legal) and _can_submit_card_id(legal, "s1") and not _can_submit_card_id(legal, "missing") and not _can_drop_discard(response)

func debug_validate_drag_discard_hit_rect() -> bool:
	var base := Rect2(100, 200, 118, 190)
	var expanded := _discard_drop_hit_rect(base)
	var near_edge := Vector2(base.position.x - DISCARD_DROP_HIT_MARGIN + 1.0, base.get_center().y)
	var outside := Vector2(base.position.x - DISCARD_DROP_HIT_MARGIN - 1.0, base.get_center().y)
	return expanded.size.is_equal_approx(base.size + Vector2(DISCARD_DROP_HIT_MARGIN, DISCARD_DROP_HIT_MARGIN) * 2.0) \
		and expanded.has_point(near_edge) \
		and not expanded.has_point(outside)

func debug_validate_free_hand_order() -> bool:
	var previous_order := _free_hand_order.duplicate()
	var previous_columns := _free_hand_columns.duplicate(true)
	var previous_manual := _manual_hand_layout
	var previous_replay := _free_hand_replay_id
	var previous_service_replay := AIService.replay_id
	var previous_layouts: Dictionary = Dictionary(AppState.settings.get("hand_layouts", {})).duplicate(true)
	_free_hand_replay_id = ""
	_free_hand_order = []
	_free_hand_columns = []
	var layouts: Dictionary = Dictionary(AppState.settings.get("hand_layouts", {})).duplicate(true)
	layouts["debug-layout"] = ["b", "a", "stale"]
	AppState.settings["hand_layouts"] = layouts
	AIService.replay_id = "debug-layout"
	_sync_free_hand_order([{"id": "a"}, {"id": "b"}, {"id": "c"}])
	var retained_ok := _free_hand_order == ["b", "a", "c"]
	_save_free_hand_order(false)
	var saved: Dictionary = Dictionary(AppState.settings.get("hand_layouts", {})).get("debug-layout", {})
	var saved_ok := int(saved.get("version", 0)) == 2 and _flatten_hand_columns(Array(saved.get("columns", []))) == ["b", "a", "c"]
	_free_hand_order = previous_order
	_free_hand_columns = previous_columns
	_manual_hand_layout = previous_manual
	_free_hand_replay_id = previous_replay
	AIService.replay_id = previous_service_replay
	AppState.settings["hand_layouts"] = previous_layouts
	return retained_ok and saved_ok

func debug_validate_new_game_auto_hand_layout() -> bool:
	var previous_order := _free_hand_order.duplicate()
	var previous_columns := _free_hand_columns.duplicate(true)
	var previous_manual := _manual_hand_layout
	var previous_replay := _free_hand_replay_id
	var previous_force_auto := _force_auto_hand_layout
	var previous_service_replay := AIService.replay_id
	var previous_layouts: Dictionary = Dictionary(AppState.settings.get("hand_layouts", {})).duplicate(true)
	var layouts: Dictionary = previous_layouts.duplicate(true)
	layouts["debug-new-game"] = {"version": 2, "columns": [["s3"], ["s2", "s1"]]}
	AppState.settings["hand_layouts"] = layouts
	_free_hand_replay_id = ""
	_free_hand_order = ["stale"]
	_free_hand_columns = [["stale"]]
	_manual_hand_layout = true
	_force_auto_hand_layout = true
	AIService.replay_id = "debug-new-game"
	var cards: Array = [{"id": "s3", "value": 3, "size": "small"}, {"id": "s2", "value": 2, "size": "small"}, {"id": "s1", "value": 1, "size": "small"}]
	_sync_free_hand_order(cards)
	var groups := _hand_display_groups(cards, [])
	var auto_sorted := not _manual_hand_layout and _free_hand_columns.is_empty() and not groups.is_empty() and str(groups[0].get("kind", "")) == "sequence"
	_free_hand_order = previous_order
	_free_hand_columns = previous_columns
	_manual_hand_layout = previous_manual
	_free_hand_replay_id = previous_replay
	_force_auto_hand_layout = previous_force_auto
	AIService.replay_id = previous_service_replay
	AppState.settings["hand_layouts"] = previous_layouts
	return auto_sorted

func debug_validate_table_layout_scenes() -> bool:
	var table := TABLE_SURFACE_SCENE.instantiate()
	var seat := OPPONENT_SEAT_SCENE.instantiate()
	var center := CENTER_AREA_SCENE.instantiate()
	var hand_area := PLAYER_HAND_AREA_SCENE.instantiate()
	var table_ok := table.has_node("GameNavigation/BackButton") and table.has_node("OpponentLeftSlot") and table.has_node("OpponentRightSlot") and table.has_node("CenterSlot") and table.has_node("PlayerAreaSlot")
	var seat_ok := seat.has_node("Badge/Name") and seat.has_node("Badge/TableRow/PrivateFan") and seat.has_node("Badge/TableRow/PublicMelds")
	var center_ok := center.has_node("DeckLabel") and center.has_node("StackCenter/Stack/TargetFrame/TargetCenter") and center.has_node("StackCenter/Stack/ResponseActions") and center.has_node("DiscardArea/Body/Cards")
	var hand_ok := hand_area.has_node("Panel/Header/ArrangeButton") and hand_area.has_node("Panel/Body/FreeHandSlot") and hand_area.has_node("Panel/Body/ExposedMelds")
	table.free()
	seat.free()
	center.free()
	hand_area.free()
	return table_ok and seat_ok and center_ok and hand_ok

func debug_validate_table_layout_runtime_injection() -> bool:
	var state := {
		"currentPlayerIndex": 0,
		"phase": "discarding",
		"remainingDeckCards": 18,
		"discardPile": {},
		"players": [
			{"cards": [{"id": "s1", "value": 1, "size": "small"}], "melds": []},
			{"cards": [], "melds": []},
			{"cards": [], "melds": []},
		],
	}
	var surface := _build_table_surface(state, false)
	var left_slot := surface.get_node("OpponentLeftSlot") as Control
	var right_slot := surface.get_node("OpponentRightSlot") as Control
	var center_slot := surface.get_node("CenterSlot") as Control
	var hand_slot := surface.get_node("PlayerAreaSlot") as Control
	var injected_ok: bool = not surface.get_node("GameNavigation").visible and left_slot.get_child_count() == 1 and right_slot.get_child_count() == 1 and center_slot.get_child_count() == 1 and hand_slot.get_child_count() == 1
	surface.free()
	return injected_ok

func debug_validate_opponent_public_meld_columns() -> bool:
	var cards := [
		{"id": "public-1", "value": 6, "size": "big"},
		{"id": "public-2", "value": 6, "size": "big"},
		{"id": "public-3", "value": 6, "size": "big"},
	]
	var row := _opponent_public_melds([{"type": "peng", "cards": cards}])
	var group: PanelContainer = null
	if row.get_child_count() == 1:
		group = row.get_child(0) as PanelContainer
	var column: Node = group.get_node("Margin/Cards") if group != null else null
	var valid := column is VBoxContainer and column.get_child_count() == 3
	row.free()
	return valid

func debug_validate_opponent_public_card_text() -> bool:
	var cards := [
		{"id": "public-face-1", "value": 8, "size": "big"},
		{"id": "public-face-2", "value": 8, "size": "big"},
	]
	var row := _opponent_public_melds([{"type": "peng", "cards": cards}])
	var face: Control = null
	if row.get_child_count() == 1:
		var column: Node = row.get_child(0).get_node("Margin/Cards")
		if column.get_child_count() == 2:
			face = column.get_child(0) as Control
	var valid := face != null and face.name.begins_with("PublicCardFace") and face.custom_minimum_size == Vector2(PUBLIC_MELD_CARD_WIDTH, PUBLIC_MELD_CARD_VISIBLE_HEIGHT)
	row.free()
	return valid

func debug_validate_public_meld_layout_consistency() -> bool:
	var cards := [
		{"id": "public-layout-1", "value": 8, "size": "big"},
		{"id": "public-layout-2", "value": 8, "size": "big"},
		{"id": "public-layout-3", "value": 8, "size": "big"},
	]
	var melds := [
		{"type": "peng", "cards": cards},
		{"type": "chi", "cards": cards.slice(0, 2)},
	]
	var opponent_row := _opponent_public_melds(melds)
	var opponent_group := opponent_row.get_child(0) as PanelContainer if opponent_row.get_child_count() > 0 else null
	var opponent_face: Control = null
	var opponent_inner_gap := -999
	if opponent_group != null:
		var opponent_column := opponent_group.get_node("Margin/Cards") as VBoxContainer
		opponent_inner_gap = opponent_column.get_theme_constant("separation")
		if opponent_column.get_child_count() > 0:
			opponent_face = opponent_column.get_child(0) as Control
	var opponent_grid := opponent_row as GridContainer
	var row_gap := opponent_grid.get_theme_constant("h_separation") if opponent_grid != null else -999
	var column_gap := opponent_grid.get_theme_constant("v_separation") if opponent_grid != null else -999
	var public_metrics := _card_stack_metrics(PUBLIC_MELD_CARD_WIDTH)
	var expected_public_width := maxf(PUBLIC_MELD_GROUP_WIDTH, float(public_metrics.get("width", PUBLIC_MELD_CARD_WIDTH)) + 6.0)
	var expected_public_height := float(public_metrics.get("visible_height", PUBLIC_MELD_CARD_VISIBLE_HEIGHT)) + 2.0 * float(public_metrics.get("step", PUBLIC_MELD_CARD_STEP)) + 6.0
	var opponent_layout_ok := opponent_row.get_child_count() == 2 \
		and opponent_grid != null \
		and opponent_grid.columns == 4 \
		and opponent_group != null \
		and is_equal_approx(opponent_group.custom_minimum_size.x, expected_public_width) \
		and is_equal_approx(opponent_group.custom_minimum_size.y, expected_public_height) \
		and opponent_face != null \
		and opponent_face.custom_minimum_size == Vector2(PUBLIC_MELD_CARD_WIDTH, PUBLIC_MELD_CARD_VISIBLE_HEIGHT) \
		and opponent_inner_gap == -int(roundf(float(public_metrics.get("visible_height", PUBLIC_MELD_CARD_VISIBLE_HEIGHT)) - float(public_metrics.get("step", PUBLIC_MELD_CARD_STEP)))) \
		and row_gap == 7 \
		and column_gap == 6

	var state := {"players": [{"cards": [], "melds": melds}]}
	var player_area := _build_player_area(state, false)
	var exposed := player_area.get_node("Panel/Body/ExposedMelds") as VBoxContainer
	var player_row := exposed.get_child(1) as GridContainer if exposed.get_child_count() > 1 else null
	var player_group := player_row.get_child(0) as PanelContainer if player_row != null and player_row.get_child_count() > 0 else null
	var player_layout_ok := player_row != null \
		and player_row.get_child_count() == opponent_row.get_child_count() \
		and player_group != null \
		and player_group.custom_minimum_size == opponent_group.custom_minimum_size
	opponent_row.free()
	player_area.free()
	return opponent_layout_ok and player_layout_ok

func debug_validate_public_meld_wrap() -> bool:
	var melds: Array = []
	for index in 5:
		melds.append({
			"type": "peng",
			"cards": [
				{"id": "wrap-%d-a" % index, "value": 6, "size": "small"},
				{"id": "wrap-%d-b" % index, "value": 6, "size": "small"},
				{"id": "wrap-%d-c" % index, "value": 6, "size": "small"},
			],
		})
	var grid := _opponent_public_melds(melds) as GridContainer
	var valid := grid != null \
		and grid.columns == 4 \
		and grid.get_child_count() == 5 \
		and grid.get_theme_constant("h_separation") == 7 \
		and grid.get_theme_constant("v_separation") == 6
	grid.free()
	return valid

func debug_validate_player_action_banner() -> bool:
	var mandatory := {
		"currentPlayerIndex": 0,
		"activePlayerIndex": 0,
		"awaitingHumanInput": true,
		"phase": "response_collecting",
		"availableActions": [{"type": "peng", "cards": [], "isMandatory": true}],
	}
	var optional := {
		"currentPlayerIndex": 0,
		"activePlayerIndex": 0,
		"awaitingHumanInput": true,
		"phase": "response_collecting",
		"availableActions": [{"type": "chi", "cards": [], "isMandatory": false}],
	}
	var opponent_mandatory := mandatory.duplicate(true)
	opponent_mandatory["currentPlayerIndex"] = 2
	opponent_mandatory["activePlayerIndex"] = 2
	opponent_mandatory["awaitingHumanInput"] = false
	return _player_action_banner_text(mandatory).contains("碰") \
		and _player_action_banner_text(mandatory).contains("必须") \
		and _player_action_banner_text(optional) == "可吃" \
		and _player_action_banner_text(opponent_mandatory, 2).contains("碰")

func debug_validate_bao_action_presentation() -> bool:
	var state := {
		"activePlayerIndex": 0,
		"awaitingHumanInput": true,
		"currentPlayerIndex": 0,
		"isGameOver": false,
		"phase": "bao_selection",
		"availableActions": [
			{"type": "bao", "cards": [], "isMandatory": false},
			{"type": "pass_bao", "cards": [], "isMandatory": false},
		],
	}
	var row := _build_center_actions(state)
	if row == null:
		return false
	var available_actions: Array = state.get("availableActions", [])
	var bao_payload := _build_available_option_payload(Dictionary(available_actions[0]))
	var pass_bao_payload := _build_available_option_payload(Dictionary(available_actions[1]))
	var children := row.get_children()
	var first := children[0] as Button if children.size() > 0 else null
	var second := children[1] as Button if children.size() > 1 else null
	var valid := children.size() == 2 \
		and first != null \
		and second != null \
		and first.text == "爆" \
		and second.text == "不爆" \
		and _center_context_text(state).contains("爆") \
		and _player_action_banner_text(state) == "可爆" \
		and str(bao_payload.get("type", "")) == "bao" \
		and str(pass_bao_payload.get("type", "")) == "pass_bao"
	row.free()
	return valid

func debug_validate_human_draw_auto_advance() -> bool:
	var drawing := {
		"currentPlayerIndex": 0,
		"activePlayerIndex": 0,
		"awaitingHumanInput": true,
		"phase": "drawing",
		"isGameOver": false,
		"availableActions": [{"type": "draw", "cards": [], "isMandatory": false}],
	}
	var discarding := drawing.duplicate(true)
	discarding["phase"] = "discarding"
	discarding["availableActions"] = [{"type": "discard", "cards": [], "isMandatory": false}]
	return _should_auto_draw_human(drawing) and not _should_auto_draw_human(discarding)

func debug_validate_ai_action_delay() -> bool:
	return AI_ACTION_DELAY_SECONDS >= 1.0

func debug_validate_action_animation_duration() -> bool:
	return is_equal_approx(ANIMATION_DURATION_SECONDS, 1.0) \
		and is_equal_approx(ACTION_ANIMATION_SECONDS, 1.0) \
		and is_equal_approx(ACTION_TEXT_ANIMATION_SECONDS, 1.0) \
		and is_equal_approx(RESPONSE_ANIMATION_HOLD_SECONDS, 1.0)

func _action_animation_timeline(action_type: String) -> Dictionary:
	var is_response_action := action_type in ["chi", "peng", "zhao", "hu"]
	return {
		"pending_hold": RESPONSE_ANIMATION_HOLD_SECONDS if is_response_action else 0.0,
		"action_text_delay": 0.0,
		"action_text_duration": ACTION_TEXT_ANIMATION_SECONDS,
		"card_flight_delay": ACTION_TEXT_ANIMATION_SECONDS if is_response_action else 0.0,
		"card_flight_duration": ACTION_ANIMATION_SECONDS,
		"total": RESPONSE_ANIMATION_HOLD_SECONDS + ACTION_TEXT_ANIMATION_SECONDS + ACTION_ANIMATION_SECONDS if is_response_action else ACTION_ANIMATION_SECONDS,
	}

func debug_validate_response_animation_timeline() -> bool:
	var response := _action_animation_timeline("chi")
	var ordinary := _action_animation_timeline("discard")
	return is_equal_approx(float(response.get("pending_hold", 0.0)), 1.0) \
		and is_equal_approx(float(response.get("action_text_delay", -1.0)), 0.0) \
		and is_equal_approx(float(response.get("action_text_duration", 0.0)), 1.0) \
		and is_equal_approx(float(response.get("card_flight_delay", 0.0)), 1.0) \
		and is_equal_approx(float(response.get("card_flight_duration", 0.0)), 1.0) \
		and is_equal_approx(float(response.get("total", 0.0)), 3.0) \
		and is_equal_approx(float(ordinary.get("pending_hold", -1.0)), 0.0) \
		and is_equal_approx(float(ordinary.get("card_flight_delay", -1.0)), 0.0) \
		and is_equal_approx(float(ordinary.get("total", 0.0)), 1.0)

func _action_animation_minimum_wait_seconds(action_type: String) -> float:
	return maxf(AI_ACTION_DELAY_SECONDS, float(_action_animation_timeline(action_type).get("total", ANIMATION_DURATION_SECONDS)) + ANIMATION_CHAIN_BUFFER_SECONDS)

func debug_validate_animation_chain_delay() -> bool:
	return is_equal_approx(_action_animation_minimum_wait_seconds("discard"), AI_ACTION_DELAY_SECONDS) \
		and is_equal_approx(_action_animation_minimum_wait_seconds("chi"), 3.15)

func debug_validate_discard_zone_lock_snapshot() -> bool:
	var active := {"id": "discard-active", "rank": "陆", "value": 6, "size": "small"}
	var archived := {"id": "discard-archived", "rank": "玖", "value": 9, "size": "big"}
	var already_claimed := {"id": "discard-claimed", "rank": "伍", "value": 5, "size": "small"}
	var response := {
		"phase": "response_collecting",
		"pendingCardSource": "discard",
		"players": [{"cards": [], "melds": []}, {"cards": [], "melds": []}, {"cards": [], "melds": []}],
		"discardPile": {
			"lastDiscard": active,
			"lastDiscardPlayerIndex": 1,
			"cards": [archived, active],
			"discardHistory": [
				{"card": already_claimed, "playerIndex": 1},
				{"card": archived, "playerIndex": 1},
				{"card": active, "playerIndex": 1},
			],
		},
	}
	var entries := _discard_zone_archive_entries(response, 1, "discard-active")
	var center := _build_center(response, false)
	var pending_nodes := _subtree_group_nodes(center, "live_discard_pending")
	var pending_art := pending_nodes[0] as Control if not pending_nodes.is_empty() else null
	var after_response := response.duplicate(true)
	after_response["phase"] = "drawing"
	after_response.erase("pendingCardSource")
	after_response["discardPile"]["lastDiscard"] = null
	after_response["discardPile"]["lastDiscardPlayerIndex"] = -1
	after_response["discardPile"]["cards"] = [archived]
	var after_entries := _discard_zone_archive_entries(after_response, 1, "")
	var valid := entries.size() == 1 \
		and str(Dictionary(entries[0]).get("card", {}).get("id", "")) == "discard-archived" \
		and pending_art != null \
		and pending_art.modulate.is_equal_approx(DISCARD_PENDING_MODULATE) \
		and after_entries.size() == 1 \
		and str(Dictionary(after_entries[0]).get("card", {}).get("id", "")) == "discard-archived"
	center.free()
	return valid

func debug_validate_response_animation_hold() -> bool:
	var target := {"id": "response-target", "rank": "陆", "value": 6, "size": "small"}
	var previous := {
		"phase": "response_collecting",
		"pendingCardSource": "discard",
		"players": [{"playerId": "player_0"}, {"playerId": "player_1"}, {"playerId": "player_2"}],
		"discardPile": {"lastDiscard": target, "lastDiscardPlayerIndex": 2},
	}
	var current := {"phase": "discarding", "players": previous["players"], "discardPile": {}}
	var hold := _response_animation_hold_for_action({"type": "chi", "playerId": "player_1"}, previous, current)
	return str(Dictionary(hold.get("card", {})).get("id", "")) == "response-target" \
		and int(hold.get("playerIndex", -1)) == 2 \
		and is_equal_approx(float(hold.get("duration", 0.0)), 1.0)

func debug_validate_animation_generation_guard() -> bool:
	var previous := _action_animation_generation
	var first := _next_action_animation_generation()
	var second := _next_action_animation_generation()
	_action_animation_generation = previous
	return second == first + 1

func debug_validate_response_without_actions() -> bool:
	var pass_only := {
		"currentPlayerIndex": 0,
		"activePlayerIndex": 0,
		"awaitingHumanInput": true,
		"phase": "response_collecting",
		"isGameOver": false,
		"availableActions": [{"type": "pass", "cards": []}],
	}
	var actionable := pass_only.duplicate(true)
	actionable["availableActions"] = [{"type": "peng", "cards": [{"id": "p1"}]}, {"type": "pass", "cards": []}]
	return _should_auto_pass_empty_response(pass_only) and not _should_auto_pass_empty_response(actionable)

func debug_validate_response_snapshot_change() -> bool:
	var previous := {
		"phase": "response_collecting",
		"currentPlayerIndex": 1,
		"activePlayerIndex": 0,
		"awaitingHumanInput": true,
		"discardPile": {"lastDiscard": {"id": "big-6"}, "lastDiscardPlayerIndex": 1},
		"responseWindow": {"id": "response-big-6", "currentResponderIndex": 0, "responses": []},
		"availableActions": [
			{"type": "chi", "cards": [{"id": "big-4"}, {"id": "big-5"}]},
			{"type": "pass", "cards": []},
		],
	}
	var after_hu := previous.duplicate(true)
	after_hu["responseWindow"]["responses"] = [{"playerIndex": 2, "responseType": "hu"}]
	after_hu["availableActions"] = [{"type": "pass", "cards": []}]
	return _response_snapshot_key(previous) != _response_snapshot_key(after_hu) \
		and _response_snapshot_key(after_hu) == _response_snapshot_key(after_hu.duplicate(true))

func debug_validate_ai_completion_auto_reconcile() -> bool:
	var drawing := {
		"currentPlayerIndex": 0,
		"activePlayerIndex": 0,
		"awaitingHumanInput": true,
		"phase": "drawing",
		"isGameOver": false,
		"availableActions": [{"type": "draw", "cards": []}],
	}
	var previous_advancing := _ai_advancing
	_ai_advancing = true
	var blocked_while_ai_advancing := not _should_reconcile_human_auto_action(drawing)
	_ai_advancing = false
	var ready_after_ai_completion := _should_reconcile_human_auto_action(drawing)
	_ai_advancing = previous_advancing
	return blocked_while_ai_advancing and ready_after_ai_completion

func debug_validate_human_auto_retry_guard() -> bool:
	var drawing := {
		"currentPlayerIndex": 0,
		"activePlayerIndex": 0,
		"awaitingHumanInput": true,
		"phase": "drawing",
		"isGameOver": false,
		"availableActions": [{"type": "draw", "cards": []}],
	}
	var pass_only := {
		"currentPlayerIndex": 0,
		"activePlayerIndex": 0,
		"awaitingHumanInput": true,
		"phase": "response_collecting",
		"isGameOver": false,
		"availableActions": [{"type": "pass", "cards": []}],
	}
	var actionable := pass_only.duplicate(true)
	actionable["availableActions"] = [{"type": "chi", "cards": [{"id": "c1"}]}, {"type": "pass", "cards": []}]
	return _human_auto_progress_needed(drawing) and _human_auto_progress_needed(pass_only) and not _human_auto_progress_needed(actionable)

func debug_validate_automatic_progress_poll_guard() -> bool:
	var ai_owned_state := {
		"currentPlayerIndex": 0,
		"activePlayerIndex": 2,
		"awaitingHumanInput": false,
		"phase": "response_collecting",
		"isGameOver": false,
		"availableActions": [{"type": "chi", "cards": [{"id": "c1"}]}, {"type": "pass", "cards": []}],
	}
	var human_drawing_state := {
		"currentPlayerIndex": 0,
		"activePlayerIndex": 0,
		"awaitingHumanInput": true,
		"phase": "drawing",
		"isGameOver": false,
		"availableActions": [{"type": "draw", "cards": []}],
	}
	var human_actionable_state := human_drawing_state.duplicate(true)
	human_actionable_state["phase"] = "response_collecting"
	human_actionable_state["availableActions"] = [{"type": "chi", "cards": [{"id": "c1"}]}, {"type": "pass", "cards": []}]
	return _automatic_progress_kind(ai_owned_state) == "ai" \
		and _automatic_progress_kind(human_drawing_state) == "human" \
		and _automatic_progress_kind(human_actionable_state).is_empty()

func debug_validate_ai_step_failure_guard() -> bool:
	var state := {
		"currentPlayerIndex": 0,
		"activePlayerIndex": 2,
		"turnCount": 3,
		"phase": "response_collecting",
		"isGameOver": false,
	}
	var previous_signature := _automatic_progress_blocked_signature
	_automatic_progress_blocked_signature = _automatic_progress_state_key(state)
	var blocked := _automatic_progress_is_blocked(state)
	_automatic_progress_blocked_signature = previous_signature
	return blocked

func _hand_group_column(group: Dictionary, card_width: float, card_height: float) -> Control:
	var column := VBoxContainer.new()
	column.alignment = BoxContainer.ALIGNMENT_END
	column.size_flags_vertical = Control.SIZE_EXPAND_FILL
	column.add_theme_constant_override("separation", 2)

	var cards_box := VBoxContainer.new()
	cards_box.alignment = BoxContainer.ALIGNMENT_END
	cards_box.add_theme_constant_override("separation", -int(card_height * 0.80))
	cards_box.custom_minimum_size = Vector2(card_width + 8, card_height + max(0, Array(group.get("cards", [])).size() - 1) * card_height * 0.34)

	for raw_card in Array(group.get("cards", [])):
		var card: Dictionary = raw_card
		var card_id := str(card.get("id", ""))
		var card_slot := Control.new()
		card_slot.custom_minimum_size = Vector2(card_width, card_height)
		card_slot.mouse_filter = Control.MOUSE_FILTER_PASS
		var button := Button.new()
		button.text = ""
		button.size_flags_vertical = Control.SIZE_SHRINK_END
		button.custom_minimum_size = Vector2(card_width, card_height)
		button.position.y = -12.0 if card_id == selected_card_id else 0.0
		button.z_index = 2 if card_id == selected_card_id else 0
		button.tooltip_text = _card_text(card) + " · " + str(group.get("label", "散牌"))
		button.disabled = _advice_loading or _ai_advancing or _ai_demo_running
		button.add_theme_stylebox_override("normal", _box(Color("ffffff", 0), 4, 0))
		button.add_theme_stylebox_override("hover", _box(Color("fff7e8", 0.15), 4, 1, GOLD, 2))
		if card_id == selected_card_id:
			button.add_theme_stylebox_override("normal", _box(Color("fff7e8", 0.18), 4, 1, GOLD, 3))
			var selected_frame := Panel.new()
			selected_frame.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
			selected_frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
			selected_frame.add_theme_stylebox_override("panel", _box(Color("ffffff", 0), 4, 0, GOLD, 2))
			selected_frame.z_index = 3
			button.add_child(selected_frame)
		button.add_child(_card_art(card, Vector2(card_width, card_height)))
		button.pressed.connect(func(): _select_human_card(card_id))
		card_slot.add_child(button)
		cards_box.add_child(card_slot)
	column.add_child(cards_box)

	if str(group.get("kind", "")) != "single":
		var group_label := Label.new()
		group_label.text = str(group.get("label", ""))
		group_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		group_label.add_theme_font_size_override("font_size", 10)
		group_label.add_theme_color_override("font_color", GOLD)
		column.add_child(group_label)

	return column

func _select_human_card(card_id: String) -> void:
	if _advice_loading or _ai_advancing or _ai_demo_running:
		return
	if not _can_submit_card_id(AIService.latest_state, card_id):
		_show_toast("这张牌当前不能出。")
		return
	selected_card_id = card_id
	show_game()

func debug_select_first_human_card() -> void:
	var players: Array = AIService.latest_state.get("players", [])
	if players.is_empty():
		return
	var cards: Array = Dictionary(players[0]).get("cards", [])
	if cards.is_empty():
		return
	_select_human_card(str(Dictionary(cards[0]).get("id", "")))

func _meld_strip(melds: Array, dimensions: Vector2, label_color: Color) -> Control:
	var strip := HBoxContainer.new()
	strip.alignment = BoxContainer.ALIGNMENT_CENTER
	strip.add_theme_constant_override("separation", 6)
	for raw_meld in melds:
		var meld: Dictionary = raw_meld
		var group := HBoxContainer.new()
		group.add_theme_constant_override("separation", -4)
		var cards: Array = meld.get("cards", [])
		for raw_card in cards:
			group.add_child(_card_art(Dictionary(raw_card), dimensions))
		strip.add_child(group)
		var type_label := Label.new()
		type_label.text = _meld_text(str(meld.get("type", "")))
		type_label.add_theme_font_size_override("font_size", 11)
		type_label.add_theme_color_override("font_color", label_color)
		strip.add_child(type_label)
	return strip

func _action_station_text(state: Dictionary) -> String:
	if bool(state.get("isGameOver", false)):
		return "行动台  ·  本局已结束"
	var actions: Array = state.get("availableActions", [])
	var current := _state_awaiting_human(state)
	if not current:
		return "行动台  ·  等待 AI 决策  ·  %d 个合法动作" % actions.size()
	var response := _response_context_text(state)
	if not response.is_empty():
		return "行动台  ·  %s  ·  %d 个合法响应" % [response, actions.size()]
	var selected_card := _selected_human_card(state)
	if selected_card.is_empty():
		return "你的回合  ·  %d 个合法动作" % actions.size()
	return "已选 %s" % _card_text(selected_card)

func debug_action_station_text(state: Dictionary, card_id: String = "") -> String:
	var previous := selected_card_id
	selected_card_id = card_id
	var result := _action_station_text(state)
	selected_card_id = previous
	return result

func _selected_human_card(state: Dictionary) -> Dictionary:
	if selected_card_id.is_empty():
		return {}
	var players: Array = state.get("players", [])
	if players.is_empty():
		return {}
	for raw_card in Array(Dictionary(players[0]).get("cards", [])):
		var card: Dictionary = raw_card
		if str(card.get("id", "")) == selected_card_id:
			return card
	return {}

func _player_action_hint(state: Dictionary) -> String:
	var response := _response_context_text(state)
	if not response.is_empty():
		return response
	var selected_card := _selected_human_card(state)
	if selected_card.is_empty():
		return "轮到你"
	return "已选 %s" % _card_text(selected_card)

func debug_player_action_hint(state: Dictionary, card_id: String = "") -> String:
	var previous := selected_card_id
	selected_card_id = card_id
	var result := _player_action_hint(state)
	selected_card_id = previous
	return result

func _response_context_text(state: Dictionary) -> String:
	if str(state.get("phase", "")) != "response_collecting":
		return ""
	var pile: Dictionary = state.get("discardPile", {})
	var card: Dictionary = pile.get("lastDiscard", {})
	if card.is_empty():
		return ""
	var source_index := int(pile.get("lastDiscardPlayerIndex", -1))
	var source := "你" if source_index == 0 else ("玩家%d" % source_index if source_index > 0 else "对手")
	var source_text := "翻牌" if str(state.get("pendingCardSource", "")) == "draw" else "打出"
	return "响应 %s %s %s" % [source, source_text, _card_size_text(card)]

func debug_response_context_text(state: Dictionary) -> String:
	return _response_context_text(state)

func _submit_discard() -> void:
	if _advice_loading or _ai_advancing or _ai_demo_running:
		return
	if selected_card_id.is_empty():
		_show_toast("请先选择一张牌。")
		return
	var card := _find_human_card(selected_card_id)
	if card.is_empty():
		_show_toast("选中的手牌已失效。")
		return
	if not _can_submit_card_id(AIService.latest_state, selected_card_id):
		_show_toast("该牌不在当前可出列表中。")
		selected_card_id = ""
		show_game()
		return
	selected_card_id = ""
	AIService.submit_action({"type": "discard", "cards": [card]})

func _submit_available_action(available: Dictionary) -> void:
	if _advice_loading or _ai_advancing or _ai_demo_running:
		return
	var chi_options: Array = available.get("chiOptions", [])
	var hu_options: Array = available.get("huOptions", [])
	if chi_options.size() > 1:
		_show_option_picker("选择吃牌方式", available, chi_options, "chi")
		return
	if hu_options.size() > 1:
		_show_option_picker("选择胡牌方式", available, hu_options, "hu")
		return
	_submit_available_option(available, chi_options[0] if not chi_options.is_empty() else {}, hu_options[0] if not hu_options.is_empty() else {})

func _submit_available_option(available: Dictionary, chi_option: Dictionary = {}, hu_option: Dictionary = {}) -> void:
	if _advice_loading or _ai_advancing or _ai_demo_running:
		return
	var authoritative := _authoritative_available_action(available, chi_option, hu_option)
	if authoritative.is_empty():
		_show_game_after_stale_action()
		return
	var action := _build_available_option_payload(authoritative, chi_option, hu_option)
	if action.is_empty():
		_show_game_after_stale_action()
		return
	AIService.submit_action(action)

func _show_game_after_stale_action() -> void:
	option_popup.hide()
	_show_toast("响应局面已更新，已按最新牌局刷新。", 2.5)
	if page == "game":
		show_game()

# Only payloads backed by the displayed core action may cross the UI boundary.
func _build_available_option_payload(available: Dictionary, chi_option: Dictionary = {}, hu_option: Dictionary = {}) -> Dictionary:
	var action: Dictionary = {"type": str(available.get("type", "pass"))}
	var selected_cards: Array = available.get("cards", [])
	if selected_cards.size() > 0:
		action["cards"] = selected_cards
	if not chi_option.is_empty():
		var valid_chi := Array(available.get("chiOptions", [])).any(func(raw: Dictionary) -> bool:
			return str(raw.get("id", "")) == str(chi_option.get("id", ""))
		)
		if not valid_chi:
			return {}
		action["cards"] = chi_option.get("selectedCards", selected_cards)
		action["chiOptionId"] = chi_option.get("id", "")
	if not hu_option.is_empty():
		var valid_hu := Array(available.get("huOptions", [])).any(func(raw: Dictionary) -> bool:
			return str(raw.get("id", "")) == str(hu_option.get("id", ""))
		)
		if not valid_hu:
			return {}
		action["huOptionId"] = hu_option.get("id", "")
		if action.get("cards", []).is_empty():
			action["cards"] = hu_option.get("selectedCards", [])
	return action

func debug_validate_option_payloads() -> bool:
	var chi_a := {"id": "chi-a", "selectedCards": [{"id": "c1"}, {"id": "c2"}]}
	var chi_b := {"id": "chi-b", "selectedCards": [{"id": "c3"}, {"id": "c4"}]}
	var chi_available := {"type": "chi", "cards": [], "chiOptions": [chi_a, chi_b]}
	var selected_chi := _build_available_option_payload(chi_available, chi_b)
	if str(selected_chi.get("chiOptionId", "")) != "chi-b" or Array(selected_chi.get("cards", [])).size() != 2:
		return false
	if not _build_available_option_payload(chi_available, {"id": "stale", "selectedCards": []}).is_empty():
		return false
	var hu_a := {"id": "hu-a", "selectedCards": [{"id": "h1"}]}
	var hu_b := {"id": "hu-b", "selectedCards": [{"id": "h2"}]}
	var hu_available := {"type": "hu", "cards": [], "huOptions": [hu_a, hu_b]}
	var selected_hu := _build_available_option_payload(hu_available, {}, hu_b)
	return str(selected_hu.get("huOptionId", "")) == "hu-b" and Array(selected_hu.get("cards", []))[0].get("id", "") == "h2"

func debug_validate_authoritative_action_rebind() -> bool:
	var previous_state := AIService.latest_state.duplicate(true)
	AIService.latest_state = {
		"availableActions": [{
			"type": "chi",
			"cards": [],
			"chiOptions": [{"id": "current-option", "selectedCards": []}],
		}],
	}
	var stale := {"type": "chi", "chiOptions": [{"id": "stale-option"}]}
	var current := _authoritative_available_action(stale, {"id": "current-option"}, {})
	var rejected := _authoritative_available_action(stale, {"id": "stale-option"}, {})
	AIService.latest_state = previous_state
	return str(current.get("type", "")) == "chi" and rejected.is_empty()

func _run_ai_until_human() -> void:
	if _ai_advancing:
		return
	_ai_advancing = true
	_show_toast("AI 正在推进牌局。", 2.0)
	show_game()
	var guard := 0
	while not AIService.latest_state.is_empty() and not bool(AIService.latest_state.get("isGameOver", false)) and not _state_awaiting_human(AIService.latest_state) and guard < 24:
		guard += 1
		var step_completed := await AIService.run_ai_step(_selected_ai_mode())
		if not step_completed:
			_ai_advancing = false
			_automatic_progress_blocked_signature = _automatic_progress_state_key(AIService.latest_state)
			_show_toast("AI 动作未通过当前规则，自动推进已暂停，请检查局内报错。", 4.0)
			show_game()
			return
		if not AIService.latest_state.is_empty() and not bool(AIService.latest_state.get("isGameOver", false)):
			await get_tree().create_timer(_action_animation_wait_seconds()).timeout
	_ai_advancing = false
	if guard >= 24:
		_show_toast("AI 推进已暂停，请检查当前牌局。", 4.0)
	show_game()
	_queue_human_automatic_progress(AIService.latest_state)

func _should_auto_draw_human(state: Dictionary) -> bool:
	return not bool(state.get("isGameOver", false)) \
		and _state_awaiting_human(state) \
		and _state_active_player(state) == 0 \
		and str(state.get("phase", "")) == "drawing" \
		and not _available_action(state, "draw").is_empty()

func _has_non_pass_response_action(state: Dictionary) -> bool:
	for raw_action in Array(state.get("availableActions", [])):
		var action: Dictionary = raw_action
		if str(action.get("type", "")) != "pass":
			return true
	return false

func _should_auto_pass_empty_response(state: Dictionary) -> bool:
	return not bool(state.get("isGameOver", false)) \
		and _state_awaiting_human(state) \
		and _state_active_player(state) == 0 \
		and str(state.get("phase", "")) == "response_collecting" \
		and not _has_non_pass_response_action(state) \
		and not _available_action(state, "pass").is_empty()

func _human_auto_progress_needed(state: Dictionary) -> bool:
	return _should_auto_draw_human(state) or _should_auto_pass_empty_response(state)

func _should_reconcile_human_auto_action(state: Dictionary) -> bool:
	return not _ai_advancing and not _advice_loading and not _ai_demo_running and _human_auto_progress_needed(state)

func _automatic_progress_kind(state: Dictionary) -> String:
	if _should_reconcile_human_auto_action(state):
		return "human"
	if debug_should_auto_advance(state):
		return "ai"
	return ""

func _automatic_progress_state_key(state: Dictionary) -> String:
	var discard_pile: Dictionary = state.get("discardPile", {})
	var last_discard: Dictionary = discard_pile.get("lastDiscard", {})
	var response_window: Dictionary = state.get("responseWindow", {})
	return "%s|%d|%d|%d|%s|%s" % [
		str(state.get("phase", "")),
		int(state.get("currentPlayerIndex", -1)),
		int(state.get("activePlayerIndex", -1)),
		int(state.get("turnCount", -1)),
		str(response_window.get("id", "")),
		str(last_discard.get("id", "")),
	]

func _response_snapshot_key(state: Dictionary) -> String:
	var response_window: Dictionary = state.get("responseWindow", {})
	var response_items := PackedStringArray()
	for raw_response in Array(response_window.get("responses", [])):
		var response: Dictionary = raw_response
		response_items.append("%d:%s" % [int(response.get("playerIndex", -1)), str(response.get("responseType", ""))])
	var action_items := PackedStringArray()
	for raw_action in Array(state.get("availableActions", [])):
		var action: Dictionary = raw_action
		var card_ids := PackedStringArray()
		for raw_card in Array(action.get("cards", [])):
			card_ids.append(str(Dictionary(raw_card).get("id", "")))
		var option_ids := PackedStringArray()
		for raw_option in Array(action.get("chiOptions", [])):
			option_ids.append("chi:" + str(Dictionary(raw_option).get("id", "")))
		for raw_option in Array(action.get("huOptions", [])):
			option_ids.append("hu:" + str(Dictionary(raw_option).get("id", "")))
		action_items.append("%s:%s:%s:%s" % [
			str(action.get("type", "")),
			",".join(card_ids),
			",".join(option_ids),
			str(action.get("isMandatory", false)),
		])
	return "%s|%d|%d|%s|%s|%s" % [
		str(state.get("phase", "")),
		int(state.get("currentPlayerIndex", -1)),
		int(state.get("activePlayerIndex", -1)),
		str(response_window.get("id", "")),
		str(response_window.get("currentResponderIndex", "")),
		",".join(response_items) + "|" + ",".join(action_items),
	]

func _automatic_progress_is_blocked(state: Dictionary) -> bool:
	return not _automatic_progress_blocked_signature.is_empty() and _automatic_progress_state_key(state) == _automatic_progress_blocked_signature

func _reconcile_automatic_progress() -> void:
	if _ai_demo_running or _advice_loading or AIService.latest_state.is_empty():
		return
	var state := AIService.latest_state
	if _automatic_progress_is_blocked(state):
		return
	match _automatic_progress_kind(state):
		"human":
			_queue_human_automatic_progress(state)
		"ai":
			_queue_auto_advance(state)

func _queue_human_automatic_progress(state: Dictionary) -> void:
	if not _should_reconcile_human_auto_action(state):
		return
	_queue_human_pass_if_needed(state)
	_queue_human_draw(state)
	_queue_human_auto_watchdog(state)

func _queue_human_auto_watchdog(state: Dictionary) -> void:
	if _human_auto_watchdog_queued or _ai_advancing or _advice_loading or _ai_demo_running:
		return
	if not _human_auto_progress_needed(state):
		return
	_human_auto_watchdog_queued = true
	call_deferred("_run_human_auto_watchdog")

func _run_human_auto_watchdog() -> void:
	_human_auto_watchdog_queued = false
	if not is_inside_tree():
		return
	await get_tree().create_timer(HUMAN_AUTO_PROGRESS_RETRY_SECONDS).timeout
	if not is_inside_tree() or AIService.latest_state.is_empty():
		return
	var state := AIService.latest_state
	if not _human_auto_progress_needed(state):
		return
	# A missed deferred callback can leave the UI guard set without a request;
	# only clear that stale guard when the HTTP service is actually idle.
	if AIService.debug_http_request_is_busy():
		_queue_human_auto_watchdog(state)
		return
	_human_auto_action_in_flight = false
	_queue_human_pass_if_needed(state)
	_queue_human_draw(state)

func _queue_human_draw(state: Dictionary) -> void:
	if _human_auto_action_in_flight or _ai_advancing or _advice_loading or _ai_demo_running:
		return
	if not _should_auto_draw_human(state):
		return
	_human_auto_action_in_flight = true
	call_deferred("_auto_draw_human_if_needed")

func _auto_draw_human_if_needed() -> void:
	_human_auto_action_in_flight = false
	if AIService.latest_state.is_empty() or not _should_auto_draw_human(AIService.latest_state):
		return
	_human_auto_action_in_flight = true
	AIService.submit_action({"type": "draw", "cards": []})

func _queue_human_pass_if_needed(state: Dictionary) -> void:
	if _human_auto_action_in_flight or _ai_advancing or _advice_loading or _ai_demo_running:
		return
	if not _should_auto_pass_empty_response(state):
		return
	_human_auto_action_in_flight = true
	call_deferred("_auto_pass_empty_response_if_needed")

func _auto_pass_empty_response_if_needed() -> void:
	_human_auto_action_in_flight = false
	if AIService.latest_state.is_empty() or not _should_auto_pass_empty_response(AIService.latest_state):
		return
	_human_auto_action_in_flight = true
	AIService.submit_action({"type": "pass", "cards": []})

func _queue_auto_advance(state: Dictionary) -> void:
	if _auto_advance_queued or _ai_advancing or _advice_loading or _ai_demo_running:
		return
	if _automatic_progress_is_blocked(state):
		return
	if bool(state.get("isGameOver", false)) or _state_awaiting_human(state):
		return
	_auto_advance_queued = true
	call_deferred("_auto_advance_if_needed")

func _auto_advance_if_needed() -> void:
	_auto_advance_queued = false
	if _ai_advancing or _advice_loading or _ai_demo_running or AIService.latest_state.is_empty():
		return
	var state := AIService.latest_state
	if bool(state.get("isGameOver", false)) or _state_awaiting_human(state):
		return
	# 保留上一动作的牌面结果，避免收到状态后立即被下一次 AI 请求覆盖。
	await get_tree().create_timer(_action_animation_wait_seconds()).timeout
	if not debug_should_auto_advance(AIService.latest_state):
		return
	await _run_ai_until_human()

func debug_should_auto_advance(state: Dictionary) -> bool:
	return not _ai_advancing and not _advice_loading and not _ai_demo_running and not bool(state.get("isGameOver", false)) and not _state_awaiting_human(state)

func _run_original_ai_step() -> void:
	if _ai_advancing or _ai_demo_running or AIService.latest_state.is_empty():
		return
	if bool(AIService.latest_state.get("isGameOver", false)) or _state_awaiting_human(AIService.latest_state):
		return
	_ai_advancing = true
	show_game()
	await AIService.run_original_ai_step("learned")
	_ai_advancing = false
	show_game()

func _request_ai_advice() -> void:
	if _advice_loading or AIService.latest_state.is_empty() or not _state_awaiting_human(AIService.latest_state):
		return
	_advice_loading = true
	_show_toast("AI 正在分析当前合法动作。", 3.0)
	show_game()
	await AIService.request_advice(0, _selected_ai_mode())
	_advice_loading = false
	if page == "game":
		show_game()

func show_settings() -> void:
	_set_shell_header_visible(true)
	_clear()
	var panel := VBoxContainer.new()
	panel.add_theme_constant_override("separation", 14)
	content.add_child(panel)
	var title := Label.new()
	title.text = "牌局设置"
	title.add_theme_font_size_override("font_size", 28)
	title.add_theme_color_override("font_color", INK)
	panel.add_child(title)
	panel.add_child(_setting_text("玩家人数", "固定三人局"))
	panel.add_child(_setting_text("手牌展示", "支持自动组合与本局自定义牌列布局。"))
	var hand_arrangement := HBoxContainer.new()
	hand_arrangement.add_theme_constant_override("separation", 8)
	var grouped_button := _quiet_button("重新组合理牌", func(): _set_hand_arrangement_mode("group"))
	grouped_button.tooltip_text = "清除本局手动顺序，按当前权威手牌恢复自动组合列"
	hand_arrangement.add_child(grouped_button)
	panel.add_child(hand_arrangement)
	panel.add_child(_setting_text("对手默认策略", _opponent_ai_label() + "；影响 AI 自动推进"))
	var opponent_choices := HBoxContainer.new()
	opponent_choices.add_theme_constant_override("separation", 8)
	var selected_opponent := _selected_opponent_ai_mode()
	for mode in ["heuristic", "learned"]:
		var choice := _quiet_button(_opponent_ai_name(mode), func(): _set_opponent_ai_mode(mode))
		choice.disabled = mode == selected_opponent
		choice.tooltip_text = "自动推进使用%s" % _opponent_ai_name(mode)
		opponent_choices.add_child(choice)
	panel.add_child(opponent_choices)
	panel.add_child(_setting_text("兼容策略", "原版强化策略通过本地 Bridge 调用；动作仍由当前规则服务校验"))
	var analysis_title := Label.new()
	analysis_title.text = "AI 建议分析"
	analysis_title.add_theme_font_size_override("font_size", 18)
	analysis_title.add_theme_color_override("font_color", INK)
	panel.add_child(analysis_title)
	panel.add_child(_setting_text("当前模式", _ai_mode_label() + "；仅用于“AI 建议”分析请求。"))
	var mode_choices := HBoxContainer.new()
	mode_choices.add_theme_constant_override("separation", 8)
	var selected_mode := _selected_ai_mode()
	for mode in ["fast", "medium", "learned"]:
		var choice := _quiet_button(_ai_mode_name(mode), func(): _set_ai_mode(mode))
		choice.disabled = mode == selected_mode
		choice.tooltip_text = "使用%s生成 AI 建议" % _ai_mode_name(mode)
		mode_choices.add_child(choice)
	panel.add_child(mode_choices)
	var rules_title := Label.new()
	rules_title.text = "规则设置（新局生效）"
	rules_title.add_theme_font_size_override("font_size", 18)
	rules_title.add_theme_color_override("font_color", INK)
	panel.add_child(rules_title)
	panel.add_child(_setting_text("底牌", "当前 %d 张；该参数将传入本机规则服务。" % int(AppState.settings.get("bottom_card_count", 2))))
	var bottom_choices := HBoxContainer.new()
	bottom_choices.add_theme_constant_override("separation", 8)
	var selected_bottom := int(AppState.settings.get("bottom_card_count", 2))
	for bottom in [0, 1, 2]:
		var choice := _quiet_button("%d 张" % bottom, func(): _set_bottom_card_count(bottom))
		choice.disabled = bottom == selected_bottom
		choice.tooltip_text = "下次开始新局时使用 %d 张底牌" % bottom
		bottom_choices.add_child(choice)
	panel.add_child(bottom_choices)

func _set_bottom_card_count(bottom: int) -> void:
	AppState.settings["bottom_card_count"] = clampi(bottom, 0, 2)
	AppState.save_settings()
	_show_toast("底牌已设为 %d 张，新局生效。" % int(AppState.settings.bottom_card_count))
	show_settings()

func _hand_arrangement_label() -> String:
	return "手动布局" if _manual_hand_layout else "组合理牌"

func _set_hand_arrangement(grouped: bool) -> void:
	_set_hand_arrangement_mode("group" if grouped else "order")

func _set_hand_arrangement_mode(mode: String, persist: bool = true) -> void:
	_manual_hand_layout = mode == "manual"
	AppState.settings["hand_arrangement_mode"] = "group"
	AppState.settings["auto_sort_hand"] = true
	if not _manual_hand_layout and not _free_hand_replay_id.is_empty():
		var layouts: Dictionary = Dictionary(AppState.settings.get("hand_layouts", {})).duplicate(true)
		layouts.erase(_free_hand_replay_id)
		AppState.settings["hand_layouts"] = layouts
		_free_hand_order.clear()
		_free_hand_columns.clear()
		_sync_free_hand_order(_rendered_source_free_cards)
	if not persist:
		return
	AppState.save_settings()
	_show_toast("手牌已恢复自动组合。")
	if not is_instance_valid(content):
		return
	if page == "game":
		show_game()
	else:
		show_settings()

func _toggle_hand_arrangement() -> void:
	_set_hand_arrangement_mode("group")

func debug_validate_hand_arrangement_toggle() -> bool:
	var previous := _manual_hand_layout
	var previous_order := _free_hand_order.duplicate()
	var previous_columns := _free_hand_columns.duplicate(true)
	var previous_layouts: Dictionary = Dictionary(AppState.settings.get("hand_layouts", {})).duplicate(true)
	_manual_hand_layout = true
	_set_hand_arrangement_mode("group", false)
	var grouped_after_manual := _hand_arrangement_mode() == "group"
	_set_hand_arrangement_mode("group", false)
	var grouped_after_repeat := _hand_arrangement_mode() == "group"
	_manual_hand_layout = previous
	_free_hand_order = previous_order
	_free_hand_columns = previous_columns
	AppState.settings["hand_layouts"] = previous_layouts
	AppState.settings["auto_sort_hand"] = true
	return grouped_after_manual and grouped_after_repeat

func _show_option_picker(_title_text: String, available: Dictionary, options: Array, option_kind: String) -> void:
	for child in option_popup.get_children():
		child.queue_free()
	var body := HBoxContainer.new()
	body.name = "OptionPickerGroups"
	body.alignment = BoxContainer.ALIGNMENT_CENTER
	body.add_theme_constant_override("separation", 8)
	option_popup.add_child(body)
	var picker_entries: Array = _merge_chi_picker_options(options) if option_kind == "chi" else options.map(func(raw_option: Dictionary) -> Dictionary:
		return {"option": Dictionary(raw_option).duplicate(true), "count": 1}
	)
	for index in picker_entries.size():
		var entry: Dictionary = picker_entries[index]
		var option: Dictionary = Dictionary(entry.get("option", {})).duplicate(true)
		var selected_cards: Array = Array(option.get("selectedCards", []))
		var display_cards: Array = _sorted_human_cards(Array(option.get("mainMeldCards", selected_cards)))
		var action_name := _action_text(str(available.get("type", option_kind)))
		var picker_payload := {"available": available, "option": option, "optionKind": option_kind}
		var option_callback := _make_action_snapshot_callback(picker_payload, func(payload: Dictionary):
			option_popup.hide()
			var available_snapshot: Dictionary = Dictionary(payload.get("available", {}))
			var option_snapshot: Dictionary = Dictionary(payload.get("option", {}))
			if str(payload.get("optionKind", "")) == "chi": _submit_available_option(available_snapshot, option_snapshot, {})
			else: _submit_available_option(available_snapshot, {}, option_snapshot)
		)
		var option_button := _option_picker_card_button(action_name, index + 1, display_cards, selected_cards, option_callback, int(entry.get("count", 1)))
		body.add_child(option_button)
	option_popup.reset_size()
	option_popup.popup_centered()

func _chi_option_display_key(option: Dictionary) -> String:
	var display_cards := _sorted_human_cards(Array(option.get("mainMeldCards", option.get("selectedCards", []))))
	var parts: Array[String] = []
	for raw_card in display_cards:
		var card: Dictionary = raw_card
		parts.append("%d:%s" % [int(card.get("value", 0)), str(card.get("size", "small"))])
	return "|".join(parts)

func _merge_chi_picker_options(options: Array) -> Array:
	var entries: Array = []
	var entry_index_by_key := {}
	for raw_option in options:
		var option: Dictionary = Dictionary(raw_option).duplicate(true)
		var key := _chi_option_display_key(option)
		if key.is_empty():
			key = "id:%s" % str(option.get("id", entries.size()))
		if entry_index_by_key.has(key):
			var existing_index := int(entry_index_by_key[key])
			var existing: Dictionary = entries[existing_index]
			existing["count"] = int(existing.get("count", 1)) + 1
			entries[existing_index] = existing
		else:
			entry_index_by_key[key] = entries.size()
			entries.append({"option": option, "count": 1, "displayKey": key})
	return entries

func _make_action_snapshot_callback(action: Dictionary, receiver: Callable) -> Callable:
	var snapshot: Dictionary = action.duplicate(true)
	return func(): receiver.call(snapshot)

func _option_picker_card_button(_action_name: String, option_index: int, display_cards: Array, _selected_cards: Array, callback: Callable, _same_count: int = 1) -> Button:
	var button := Button.new()
	button.name = "OptionCardButton_%d" % option_index
	button.text = ""
	var stack_metrics := _card_stack_metrics(PICKER_CARD_WIDTH)
	var group_width := float(stack_metrics.get("width", PICKER_CARD_WIDTH))
	var visible_height := float(stack_metrics.get("visible_height", PICKER_CARD_VISIBLE_HEIGHT))
	var stack_step := float(stack_metrics.get("step", visible_height))
	var group_height := visible_height + maxf(float(display_cards.size() - 1) * stack_step, 0.0)
	button.custom_minimum_size = Vector2(group_width, group_height)
	button.size = button.custom_minimum_size
	button.flat = true
	button.mouse_filter = Control.MOUSE_FILTER_STOP
	button.focus_mode = Control.FOCUS_ALL
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_stylebox_override("normal", StyleBoxEmpty.new())
	button.add_theme_stylebox_override("hover", StyleBoxEmpty.new())
	button.add_theme_stylebox_override("pressed", StyleBoxEmpty.new())
	var margin := MarginContainer.new()
	margin.name = "OptionCardMargin"
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT, Control.PRESET_MODE_MINSIZE, 0)
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	button.add_child(margin)
	var row := HBoxContainer.new()
	row.name = "OptionCardRow"
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 0)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	margin.add_child(row)
	var faces := VBoxContainer.new()
	faces.name = "OptionCardFaces"
	faces.alignment = BoxContainer.ALIGNMENT_END
	faces.add_theme_constant_override("separation", -int(roundf(visible_height - stack_step)))
	faces.custom_minimum_size = Vector2(group_width, group_height)
	faces.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for raw_card in display_cards:
		var card: Dictionary = raw_card
		var face := _cropped_hand_card_art(card, group_width, visible_height)
		face.name = "OptionCardFace"
		face.tooltip_text = _card_size_text(card)
		faces.add_child(face)
	row.add_child(faces)
	# Keep the whole stacked group clickable. The cropped card controls are
	# intentionally mouse-transparent, but the explicit pointer path prevents a
	# visible top card from swallowing the Button release and timing out to pass.
	var pointer_down: bool = false
	var pointer_callback_fired: bool = false
	button.gui_input.connect(func(event: InputEvent):
		if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
			if event.pressed:
				pointer_down = true
				pointer_callback_fired = false
			elif pointer_down:
				pointer_down = false
				pointer_callback_fired = true
				callback.call()
				get_viewport().set_input_as_handled()
	)
	button.pressed.connect(func():
		if pointer_down:
			return
		if pointer_callback_fired:
			pointer_callback_fired = false
			return
		callback.call()
	)
	return button

func debug_validate_option_picker_grouping() -> bool:
	var first := {
		"id": "chi-representative",
		"mainMeldCards": [
			{"id": "small-3-a", "value": 3, "size": "small"},
			{"id": "small-4-a", "value": 4, "size": "small"},
			{"id": "small-5", "value": 5, "size": "small"},
		],
		"selectedCards": [
			{"id": "small-3-a", "value": 3, "size": "small"},
			{"id": "small-4-a", "value": 4, "size": "small"},
		],
	}
	var duplicate := {
		"id": "chi-duplicate-visible",
		"mainMeldCards": [
			{"id": "small-3-b", "value": 3, "size": "small"},
			{"id": "small-4-b", "value": 4, "size": "small"},
			{"id": "small-5", "value": 5, "size": "small"},
		],
		"selectedCards": [
			{"id": "small-3-b", "value": 3, "size": "small"},
			{"id": "small-4-b", "value": 4, "size": "small"},
		],
	}
	var other := {
		"id": "chi-other",
		"mainMeldCards": [
			{"id": "small-4-c", "value": 4, "size": "small"},
			{"id": "small-5", "value": 5, "size": "small"},
			{"id": "small-6", "value": 6, "size": "small"},
		],
		"selectedCards": [
			{"id": "small-4-c", "value": 4, "size": "small"},
			{"id": "small-6", "value": 6, "size": "small"},
		],
	}
	var entries := _merge_chi_picker_options([first, duplicate, other])
	if entries.size() != 2 or int(Dictionary(entries[0]).get("count", 0)) != 2:
		return false
	var representative: Dictionary = Dictionary(entries[0]).get("option", {})
	var display_cards: Array = _sorted_human_cards(Array(representative.get("mainMeldCards", [])))
	var button := _option_picker_card_button("��", 1, display_cards, representative.get("selectedCards", []), func(): return, 2)
	var faces := button.get_node_or_null("OptionCardMargin/OptionCardRow/OptionCardFaces") as VBoxContainer
	var payload := _build_available_option_payload({"type": "chi", "cards": [], "chiOptions": [first, duplicate]}, representative)
	var row := button.get_node_or_null("OptionCardMargin/OptionCardRow") as HBoxContainer
	var valid := faces != null and row != null and row.get_child_count() == 1 and faces.get_child_count() == 3 and faces.get_theme_constant("separation") < 0 and button.get_theme_stylebox("normal") is StyleBoxEmpty and str(payload.get("chiOptionId", "")) == "chi-representative"
	button.free()
	return valid

func debug_validate_option_picker_card_art() -> bool:
	var selected_cards: Array = [
		{"id": "picker-small-5", "value": 5, "size": "small"},
		{"id": "picker-small-7", "value": 7, "size": "small"},
	]
	var display_cards: Array = [
		{"id": "picker-small-5", "value": 5, "size": "small"},
		{"id": "picker-small-6", "value": 6, "size": "small"},
		{"id": "picker-small-7", "value": 7, "size": "small"},
	]
	var button := _option_picker_card_button("吃", 1, display_cards, selected_cards, func(): return)
	var faces := button.get_node_or_null("OptionCardMargin/OptionCardRow/OptionCardFaces") as VBoxContainer
	var valid := faces != null and faces.get_child_count() == 3
	if valid:
		for child in faces.get_children():
			var face := child as Control
			if face == null or face.get_child_count() != 1:
				valid = false
				break
			var art_root := face.get_child(0) as Control
			var texture := art_root.get_child(0) as TextureRect if art_root != null and art_root.get_child_count() > 0 else null
			if texture == null or texture.texture == null:
				valid = false
				break
	button.free()
	return valid

func debug_validate_bao_picker_card_face() -> bool:
	var state := {
		"phase": "discarding",
		"currentPlayerIndex": 0,
		"activePlayerIndex": 0,
		"awaitingHumanInput": true,
		"isGameOver": false,
		"availableActions": [
			{"type": "bao", "cards": [{"id": "bao-small-1", "value": 1, "size": "small"}]},
			{"type": "bao", "cards": [{"id": "bao-big-1", "value": 1, "size": "big"}]},
		],
	}
	var row := _build_center_actions(state)
	if row == null:
		return false
	var buttons := row.get_children()
	var first := buttons[0] as Button if buttons.size() > 0 else null
	var second := buttons[1] as Button if buttons.size() > 1 else null
	var first_faces := first.get_node_or_null("OptionCardMargin/OptionCardRow/OptionCardFaces") as VBoxContainer if first != null else null
	var second_faces := second.get_node_or_null("OptionCardMargin/OptionCardRow/OptionCardFaces") as VBoxContainer if second != null else null
	var first_art := first_faces.get_child(0) as Control if first_faces != null and first_faces.get_child_count() == 1 else null
	var second_art := second_faces.get_child(0) as Control if second_faces != null and second_faces.get_child_count() == 1 else null
	var first_root := first_art.get_child(0) as Control if first_art != null and first_art.get_child_count() > 0 else null
	var second_root := second_art.get_child(0) as Control if second_art != null and second_art.get_child_count() > 0 else null
	var first_texture := first_root.get_child(0) as TextureRect if first_root != null and first_root.get_child_count() > 0 else null
	var second_texture := second_root.get_child(0) as TextureRect if second_root != null and second_root.get_child_count() > 0 else null
	var valid := first != null \
		and second != null \
		and first.text.is_empty() \
		and second.text.is_empty() \
		and first.get_theme_stylebox("normal") is StyleBoxEmpty \
		and second.get_theme_stylebox("normal") is StyleBoxEmpty \
		and first.tooltip_text == "小1" \
		and second.tooltip_text == "大1" \
		and first_texture != null \
		and second_texture != null \
		and first_texture.texture != null \
		and second_texture.texture != null \
		and first_texture.texture != second_texture.texture
	row.free()
	return valid

func debug_validate_pending_discard_highlight() -> bool:
	var pending := {"id": "pending-highlight", "rank": "二", "value": 2, "size": "small"}
	var state := {
		"phase": "response_collecting",
		"pendingCardSource": "discard",
		"players": [{"cards": [], "melds": []}, {"cards": [], "melds": []}, {"cards": [], "melds": []}],
		"discardPile": {
			"lastDiscard": pending,
			"lastDiscardPlayerIndex": 1,
			"cards": [pending],
			"discardHistory": [],
		},
	}
	var center := _build_center(state, false)
	var pending_nodes := _subtree_group_nodes(center, "live_discard_pending")
	var pending_art := pending_nodes[0] as Control if not pending_nodes.is_empty() else null
	var valid := pending_art != null \
		and pending_art.size == DISCARD_PENDING_CARD_SIZE \
		and pending_art.modulate.is_equal_approx(DISCARD_PENDING_MODULATE)
	center.free()
	return valid

func debug_validate_bao_action_binding() -> bool:
	var actions: Array = [
		{"type": "bao", "cards": [{"id": "bao-small-2-a", "value": 2, "size": "big"}]},
		{"type": "bao", "cards": [{"id": "bao-small-2-b", "value": 2, "size": "big"}]},
		{"type": "bao", "cards": [{"id": "bao-big-5", "value": 5, "size": "big"}]},
		{"type": "bao", "cards": [{"id": "bao-big-8", "value": 8, "size": "big"}]},
	]
	var chosen: Array[String] = []
	var buttons: Array[Button] = []
	for raw_action in actions:
		var action: Dictionary = raw_action
		var button := Button.new()
		var callback := _make_action_snapshot_callback(action, func(payload: Dictionary):
			var cards: Array = payload.get("cards", [])
			if not cards.is_empty():
				chosen.append(str(Dictionary(cards[0]).get("id", "")))
		)
		button.pressed.connect(callback)
		buttons.append(button)
	for button in buttons:
		button.pressed.emit()
		button.free()
	var previous_state := AIService.latest_state.duplicate(true)
	AIService.latest_state = {"availableActions": actions}
	var selected_authoritative := _authoritative_available_action(actions[2])
	var selected_payload := _build_available_option_payload(selected_authoritative)
	AIService.latest_state = previous_state
	var selected_card_id := str(Array(selected_payload.get("cards", [])).front().get("id", "")) if not Array(selected_payload.get("cards", [])).is_empty() else ""
	var selected_correctly := selected_card_id == "bao-big-5"
	var state := {
		"phase": "discarding",
		"currentPlayerIndex": 0,
		"activePlayerIndex": 0,
		"awaitingHumanInput": true,
		"isGameOver": false,
		"availableActions": actions,
	}
	var row := _build_center_actions(state)
	var rendered := row != null and row.get_child_count() == 3
	if rendered:
		var visible_cards: Array[String] = []
		for child in row.get_children():
			var option_button := child as Button
			visible_cards.append(option_button.tooltip_text if option_button != null else "")
		rendered = visible_cards == ["大2", "大5", "大8"]
	if row != null:
		row.free()
	return chosen == ["bao-small-2-a", "bao-small-2-b", "bao-big-5", "bao-big-8"] and selected_correctly and rendered

func debug_validate_discard_entry_scoping() -> bool:
	var old_card := {"id": "old-card", "rank": "陆", "value": 6, "size": "big"}
	var latest_card := {"id": "latest-card", "rank": "捌", "value": 8, "size": "big"}
	var state := {
		"phase": "drawing",
		"discardPile": {
			"lastDiscard": latest_card,
			"lastDiscardPlayerIndex": 1,
			"cards": [old_card, latest_card],
			"discardHistory": [],
		},
	}
	var player_zero_entries := _discard_zone_archive_entries(state, 0, "")
	var player_one_entries := _discard_zone_archive_entries(state, 1, "")
	return player_zero_entries.is_empty() \
		and player_one_entries.size() == 1 \
		and str(Dictionary(player_one_entries[0]).get("card", {}).get("id", "")) == "latest-card"

func debug_validate_stack_visibility() -> bool:
	return CARD_STACK_STEP_RATIO >= 0.80 \
		and is_equal_approx(PUBLIC_MELD_CARD_VISIBLE_HEIGHT, PUBLIC_MELD_CARD_WIDTH * CARD_STACK_VISIBLE_HEIGHT_RATIO) \
		and is_equal_approx(PICKER_CARD_VISIBLE_HEIGHT, PICKER_CARD_WIDTH * CARD_STACK_VISIBLE_HEIGHT_RATIO)

func debug_validate_no_lock_label() -> bool:
	var button := _build_draggable_card({"id": "locked-card", "value": 5, "size": "big"}, 26.0, 26.0, false, false, true)
	var has_lock_label := false
	for child in button.get_children():
		if child is Label and str((child as Label).text) == "锁":
			has_lock_label = true
	button.free()
	return not has_lock_label

func debug_validate_discard_archive_height() -> bool:
	var active := {"id": "archive-active", "rank": "陆", "value": 6, "size": "big"}
	var previous := {
		"phase": "response_collecting",
		"pendingCardSource": "discard",
		"discardPile": {"lastDiscard": active, "lastDiscardPlayerIndex": 1},
	}
	var current := {
		"phase": "drawing",
		"discardPile": {
			"lastDiscard": {},
			"lastDiscardPlayerIndex": -1,
			"cards": [active],
			"discardHistory": [{"card": active, "playerIndex": 1, "source": "discard"}],
		},
	}
	var center := _build_center(current, false)
	add_child(center)
	_animate_live_table_update(0, true, previous, current)
	var archived_nodes := _subtree_group_nodes(center, "live_discard_archived")
	var archived := archived_nodes[0] as Control if not archived_nodes.is_empty() else null
	var valid := archived != null \
		and archived.size == Vector2(DISCARD_ARCHIVE_CARD_WIDTH, DISCARD_ARCHIVE_CARD_HEIGHT) \
		and archived.scale.is_equal_approx(Vector2.ONE)
	center.free()
	return valid

func _show_decision_panel(decision: Dictionary) -> void:
	if decision.is_empty():
		_show_toast("当前还没有 AI 决策记录。")
		return
	for child in decision_popup.get_children():
		child.queue_free()
	var body := VBoxContainer.new()
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 10)
	decision_popup.add_child(body)
	var trace: Dictionary = decision.get("trace", {})
	var title := Label.new()
	title.text = "AI 决策"
	title.add_theme_font_size_override("font_size", 23)
	title.add_theme_color_override("font_color", INK)
	body.add_child(title)
	body.add_child(_decision_text("动作", _action_text(str(trace.get("chosenAction", ""))) + "  ·  " + _trace_cards_text(Array(trace.get("chosenCards", [])))))
	var policy_detail := _decision_policy_label(trace)
	var policy_version := str(trace.get("policyVersion", ""))
	if not policy_version.is_empty():
		policy_detail += "  ·  " + policy_version
	body.add_child(_decision_text("策略", policy_detail))
	var legal: Dictionary = trace.get("legal", {})
	if bool(legal.get("fallbackApplied", false)):
		body.add_child(_decision_text("降级", _decision_fallback_text(str(legal.get("fallbackReason", "")))))
	body.add_child(_decision_text("判断", str(trace.get("summary", "无摘要"))))
	var tutor: Dictionary = trace.get("tutor", {})
	var tutor_dimensions: Array = tutor.get("dimensions", [])
	if not tutor_dimensions.is_empty():
		var tutor_heading := Label.new()
		tutor_heading.text = "学习要点"
		tutor_heading.add_theme_font_size_override("font_size", 16)
		tutor_heading.add_theme_color_override("font_color", RED)
		body.add_child(tutor_heading)
		for raw_dimension in tutor_dimensions.slice(0, 3):
			var dimension: Dictionary = raw_dimension
			body.add_child(_decision_text(str(dimension.get("title", "要点")), _tutor_dimension_text(dimension)))
	var top_options: Array = trace.get("topOptions", [])
	if not top_options.is_empty():
		var heading := Label.new()
		heading.text = "候选方案"
		heading.add_theme_font_size_override("font_size", 16)
		heading.add_theme_color_override("font_color", RED)
		body.add_child(heading)
		for index in min(3, top_options.size()):
			var option: Dictionary = top_options[index]
			var cards := _trace_cards_text(Array(option.get("cards", [])))
			var text := "%d. %s%s  ·  %s\n%s" % [index + 1, _action_text(str(option.get("action", ""))), (" " + cards) if not cards.is_empty() else "", _decision_option_metric(option), str(option.get("reasoning", ""))]
			body.add_child(_decision_text("", text))
	body.add_child(_quiet_button("关闭", func(): decision_popup.hide()))
	decision_popup.reset_size()
	decision_popup.size = Vector2i(500, clampi(int(body.get_combined_minimum_size().y) + 32, 180, 600))
	decision_popup.popup_centered()

func show_latest_ai_decision() -> void:
	_show_decision_panel(AIService.latest_decision)

func _decision_text(label_text: String, value: String) -> Control:
	var row := VBoxContainer.new()
	row.add_theme_constant_override("separation", 2)
	if not label_text.is_empty():
		var label := Label.new()
		label.text = label_text
		label.add_theme_font_size_override("font_size", 13)
		label.add_theme_color_override("font_color", Color("776b57"))
		row.add_child(label)
	var detail := Label.new()
	detail.text = value
	detail.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	detail.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	detail.add_theme_color_override("font_color", INK)
	row.add_child(detail)
	return row

func _show_settlement(state: Dictionary) -> void:
	# A terminal result must be the only game modal, never obscured by stale advice.
	option_popup.hide()
	decision_popup.hide()
	advice_popup.hide()
	for child in settlement_popup.get_children():
		child.queue_free()
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 12)
	settlement_popup.add_child(body)
	var winner_index := int(state.get("winnerIndex", -1))
	var headline := Label.new()
	headline.text = "本局结束"
	if winner_index == 0:
		headline.text = "本局结束  ·  你赢了"
	elif winner_index > 0:
		headline.text = "本局结束  ·  玩家%d 胡牌" % winner_index
	else:
		headline.text = "本局结束  ·  流局"
	headline.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	headline.add_theme_font_size_override("font_size", 26)
	headline.add_theme_color_override("font_color", RED if winner_index != 0 else TABLE_DARK)
	body.add_child(headline)
	var win_type := str(state.get("winType", ""))
	if not win_type.is_empty():
		var type_label := Label.new()
		type_label.text = "胡牌方式：" + _win_type_text(win_type)
		type_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		type_label.add_theme_color_override("font_color", Color("675d4f"))
		body.add_child(type_label)
	var players: Array = state.get("players", [])
	for index in players.size():
		var player: Dictionary = players[index]
		var score := Label.new()
		score.text = "%s%s     %d 分" % ["你" if index == 0 else "玩家%d" % index, "  ·  庄" if bool(player.get("isDealer", false)) else "", int(player.get("totalScore", 0))]
		score.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		score.add_theme_font_size_override("font_size", 18 if index == winner_index else 16)
		score.add_theme_color_override("font_color", RED if index == winner_index else INK)
		score.add_theme_stylebox_override("normal", _box(Color("eadfc9"), 4, 7, Color("cbb99a"), 1))
		body.add_child(score)
	var actions := HBoxContainer.new()
	actions.alignment = BoxContainer.ALIGNMENT_CENTER
	actions.add_theme_constant_override("separation", 8)
	actions.add_child(_command_button("再来一局", func(): settlement_popup.hide(); AIService.new_game(int(AppState.settings.bottom_card_count))))
	actions.add_child(_quiet_button("查看复盘", func(): settlement_popup.hide(); _navigate("replay")))
	body.add_child(actions)
	settlement_popup.reset_size()
	settlement_popup.popup_centered()

func show_replay() -> void:
	_set_shell_header_visible(true)
	option_popup.hide()
	decision_popup.hide()
	advice_popup.hide()
	settlement_popup.hide()
	_clear()
	replay_catalog = PersistenceService.list_replays()
	if replay_steps.is_empty() and not AIService.replay_steps.is_empty():
		replay_steps = AIService.replay_steps.duplicate(true)
		replay_cursor = replay_steps.size() - 1
		replay_name = "当前牌局（未关闭）"
	if replay_steps.is_empty() and not replay_catalog.is_empty():
		_load_replay(str(replay_catalog[0].get("file_name", "")))
		return
	var title_bar := HBoxContainer.new()
	var title := Label.new()
	title.text = "复盘"
	title.add_theme_font_size_override("font_size", 28)
	title.add_theme_color_override("font_color", INK)
	title_bar.add_child(title)
	title_bar.add_child(_spacer())
	title_bar.add_child(_quiet_button("刷新记录", func(): replay_steps.clear(); replay_cursor = -1; show_replay()))
	content.add_child(title_bar)
	if replay_steps.is_empty():
		var empty := Label.new()
		empty.text = "暂无已保存对局。开始一局后会立即创建复盘记录。"
		empty.add_theme_font_size_override("font_size", 16)
		empty.add_theme_color_override("font_color", Color("675d4f"))
		content.add_child(empty)
		return

	var source := Label.new()
	source.text = "%s  ·  %s  ·  %d 个步骤  ·  %d 条 AI 决策" % [replay_name, _replay_status_text(replay_steps), replay_steps.size(), _replay_trace_count(replay_steps)]
	source.add_theme_color_override("font_color", Color("675d4f"))
	content.add_child(source)

	var current_step: Dictionary = replay_steps[replay_cursor]
	var controls := HBoxContainer.new()
	controls.add_theme_constant_override("separation", 8)
	var previous := _quiet_button("上一步", func(): _previous_replay_step())
	previous.disabled = replay_cursor <= 0
	controls.add_child(previous)
	var progress := Label.new()
	progress.text = "第 %d / %d 步" % [replay_cursor + 1, replay_steps.size()]
	progress.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	progress.add_theme_color_override("font_color", INK)
	controls.add_child(progress)
	var next := _quiet_button("下一步", func(): _next_replay_step())
	next.disabled = replay_cursor >= replay_steps.size() - 1
	controls.add_child(next)
	var step_decision := _quiet_button("本步 AI 决策", func(): _show_replay_step_decision(current_step))
	step_decision.tooltip_text = "查看此回放步骤保存的策略、候选与降级说明"
	step_decision.disabled = _replay_step_decision(current_step).is_empty()
	controls.add_child(step_decision)
	for index in min(4, replay_catalog.size()):
		var replay_info: Dictionary = replay_catalog[index]
		var file_name := str(replay_info.get("file_name", ""))
		var history := _quiet_button("最近记录 %d" % (index + 1), func(): _load_replay(file_name))
		history.tooltip_text = file_name.trim_suffix(".json").trim_prefix("replay_")
		controls.add_child(history)
	content.add_child(controls)

	var state: Dictionary = current_step.get("state", {})
	var frame := Panel.new()
	frame.size_flags_vertical = Control.SIZE_EXPAND_FILL
	frame.add_theme_stylebox_override("panel", _box(TABLE, 8, 12, TABLE_DARK, 2))
	content.add_child(frame)
	var summary := _build_replay_summary(current_step)
	summary.set_anchors_preset(Control.PRESET_TOP_WIDE)
	summary.offset_left = 14
	summary.offset_top = 12
	summary.offset_right = -14
	summary.offset_bottom = 64
	frame.add_child(summary)
	var surface := _build_table_surface(state, false, true)
	surface.set_anchors_preset(Control.PRESET_FULL_RECT)
	surface.offset_top = 60
	surface.offset_bottom = 0
	frame.add_child(surface)

func _load_replay(file_name: String) -> void:
	var replay := PersistenceService.load_replay(file_name)
	var loaded_steps: Array = replay.get("steps", [])
	if loaded_steps.is_empty():
		_show_toast("该回放没有可用步骤。")
		return
	replay_steps = loaded_steps
	replay_cursor = replay_steps.size() - 1
	replay_name = file_name.trim_suffix(".json").trim_prefix("replay_")
	show_replay()

func _set_replay_cursor(index: int) -> void:
	replay_cursor = clampi(index, 0, replay_steps.size() - 1)
	show_replay()

func _previous_replay_step() -> void:
	_set_replay_cursor(replay_cursor - 1)

func _next_replay_step() -> void:
	_set_replay_cursor(replay_cursor + 1)

func _replay_step_decision(step: Dictionary) -> Dictionary:
	var decision: Dictionary = step.get("decision", {})
	return decision if not Dictionary(decision.get("trace", {})).is_empty() else {}

func _show_replay_step_decision(step: Dictionary) -> void:
	var decision := _replay_step_decision(step)
	if decision.is_empty():
		_show_toast("该步骤没有保存 AI 决策。")
		return
	_show_decision_panel(decision)

func _build_replay_summary(step: Dictionary) -> Control:
	var bar := HBoxContainer.new()
	var action: Dictionary = step.get("action", {})
	var trace: Dictionary = Dictionary(step.get("decision", {})).get("trace", {})
	var action_label := Label.new()
	var action_type := str(action.get("type", ""))
	action_label.text = "开局" if action_type == "start" else "本步：%s" % _action_text(action_type)
	action_label.add_theme_font_size_override("font_size", 17)
	action_label.add_theme_color_override("font_color", GOLD)
	bar.add_child(action_label)
	var detail := Label.new()
	var summary_text := "权威初始手牌与牌山快照" if action_type == "start" else str(trace.get("summary", "玩家动作"))
	if not trace.is_empty():
		summary_text = "[%s] %s" % [_decision_policy_label(trace), summary_text]
	detail.text = "  " + summary_text
	detail.add_theme_color_override("font_color", PAPER_DIM)
	bar.add_child(detail)
	return bar

func _replay_trace_count(steps: Array) -> int:
	var count := 0
	for raw_step in steps:
		var step: Dictionary = raw_step
		if not Dictionary(step.get("decision", {})).get("trace", {}).is_empty():
			count += 1
	return count

func _replay_status_text(steps: Array) -> String:
	if steps.is_empty():
		return "无步骤"
	var last_state: Dictionary = Dictionary(steps[-1]).get("state", {})
	return "已结束" if bool(last_state.get("isGameOver", false)) or str(last_state.get("phase", "")) == "ended" else "进行中"

func debug_validate_replay_status() -> bool:
	var finished := [{"state": {"phase": "ended", "isGameOver": true}, "decision": {"trace": {}}}]
	var active := [{"state": {"phase": "discarding", "isGameOver": false}, "decision": {"trace": {"policySource": "learned"}}}]
	return _replay_status_text(finished) == "已结束" and _replay_status_text(active) == "进行中" and _replay_trace_count(active) == 1

func debug_validate_replay_decision_access() -> bool:
	var ai_step := {"decision": {"trace": {"policySource": "learned", "chosenAction": "discard"}}}
	return _replay_step_decision(ai_step).get("trace", {}).get("chosenAction", "") == "discard" and _replay_step_decision({}).is_empty()

func debug_validate_replay_opponent_hands() -> bool:
	var cards: Array = [
		{"id": "replay-p1-s1", "value": 1, "size": "small"},
		{"id": "replay-p1-s2", "value": 2, "size": "small"},
		{"id": "replay-p1-s3", "value": 3, "size": "small"},
	]
	var state := {
		"currentPlayerIndex": 0,
		"players": [
			{"cards": [], "melds": []},
			{"cards": cards, "melds": []},
			{"cards": cards.duplicate(true), "melds": []},
		],
	}
	var left := _build_opponent_seat(state, 1, false, true)
	var right := _build_opponent_seat(state, 2, false, true)
	var left_hand := left.get_node_or_null("Badge/TableRow/PrivateFan/ReplayHandGroups") as HBoxContainer
	var right_hand := right.get_node_or_null("Badge/TableRow/PrivateFan/ReplayHandGroups") as HBoxContainer
	var left_faces := _subtree_group_nodes(left_hand, "replay_hand_card") if left_hand != null else []
	var right_faces := _subtree_group_nodes(right_hand, "replay_hand_card") if right_hand != null else []
	var expected_size := Vector2(REPLAY_HAND_CARD_WIDTH, REPLAY_HAND_CARD_VISIBLE_HEIGHT)
	var valid := left_hand != null \
		and right_hand != null \
		and left_hand.get_child_count() == 1 \
		and right_hand.get_child_count() == 1 \
		and left_faces.size() == cards.size() \
		and right_faces.size() == cards.size() \
		and (left_faces[0] as Control).custom_minimum_size == expected_size \
		and (right_faces[0] as Control).custom_minimum_size == expected_size \
		and not _subtree_contains_text(left, "|||") \
		and not _subtree_contains_text(right, "|||")
	left.free()
	right.free()
	return valid

func debug_validate_replay_hand_group_layout() -> bool:
	var cards: Array = [
		{"id": "replay-s1", "value": 1, "size": "small"},
		{"id": "replay-s2", "value": 2, "size": "small"},
		{"id": "replay-s3", "value": 3, "size": "small"},
		{"id": "replay-b5-a", "value": 5, "size": "big"},
		{"id": "replay-b5-b", "value": 5, "size": "big"},
		{"id": "replay-b5-c", "value": 5, "size": "big"},
		{"id": "replay-s9", "value": 9, "size": "small"},
	]
	var row := _build_replay_hand_groups(cards)
	var groups := _hand_groups(cards)
	var metrics := _card_stack_metrics(REPLAY_HAND_CARD_WIDTH)
	var visible_height := float(metrics.get("visible_height", REPLAY_HAND_CARD_VISIBLE_HEIGHT))
	var stack_step := float(metrics.get("step", REPLAY_HAND_CARD_VISIBLE_HEIGHT * CARD_STACK_STEP_RATIO))
	var valid := row.get_child_count() == groups.size() \
		and row.get_child_count() < cards.size() \
		and row.get_theme_constant("separation") == int(REPLAY_HAND_GROUP_GAP)
	for group_index in row.get_child_count():
		var column := row.get_child(group_index) as VBoxContainer
		var group_cards: Array = Array(Dictionary(groups[group_index]).get("cards", []))
		var expected_height := visible_height + maxf(float(group_cards.size() - 1) * stack_step, 0.0)
		valid = valid \
			and column != null \
			and column.get_child_count() == group_cards.size() \
			and column.get_theme_constant("separation") < 0 \
			and column.custom_minimum_size.y >= expected_height
		for card_index in column.get_child_count():
			var face := column.get_child(card_index) as Control
			valid = valid \
				and face != null \
				and face.is_in_group("replay_hand_card") \
				and face.custom_minimum_size == Vector2(REPLAY_HAND_CARD_WIDTH, REPLAY_HAND_CARD_VISIBLE_HEIGHT)
	var state := {"players": [{"cards": cards, "melds": []}, {"cards": [], "melds": []}, {"cards": [], "melds": []}]}
	var player_area := _build_player_area(state, false, true)
	var slot := player_area.get_node("Panel/Body/FreeHandSlot") as Control
	var player_row := slot.get_child(0) as HBoxContainer if slot.get_child_count() > 0 else null
	valid = valid and player_row != null and player_row.name == "ReplayHandGroups"
	var surface := _build_table_surface(state, false, true)
	var surface_left_hand := surface.get_node_or_null("OpponentLeftSlot/OpponentSeat/Badge/TableRow/PrivateFan/ReplayHandGroups") as HBoxContainer
	var surface_right_hand := surface.get_node_or_null("OpponentRightSlot/OpponentSeat/Badge/TableRow/PrivateFan/ReplayHandGroups") as HBoxContainer
	valid = valid and surface_left_hand != null and surface_right_hand != null
	row.free()
	player_area.free()
	surface.free()
	return valid

func _on_state_received(next_state: Dictionary) -> void:
	_previous_live_animation_positions = _capture_live_animation_positions()
	_previous_live_state = _last_live_state.duplicate(true)
	_last_live_state = next_state.duplicate(true)
	_human_auto_action_in_flight = false
	if _dragging:
		_dragging = false
		_clear_hand_drag_preview()
	_sync_hand_layout_snapshot(next_state)
	var next_turn := int(next_state.get("currentPlayerIndex", -1))
	var next_discard: Dictionary = Dictionary(next_state.get("discardPile", {})).get("lastDiscard", {})
	var next_discard_id := str(next_discard.get("id", ""))
	var turn_changed := _last_live_turn >= 0 and _last_live_turn != next_turn
	var discard_changed := not _last_live_discard_id.is_empty() and _last_live_discard_id != next_discard_id
	var response_changed := _response_snapshot_key(_previous_live_state) != _response_snapshot_key(next_state)
	var state_changed := turn_changed or discard_changed or response_changed
	_last_live_turn = next_turn
	_last_live_discard_id = next_discard_id
	if not _automatic_progress_blocked_signature.is_empty() and _automatic_progress_state_key(next_state) != _automatic_progress_blocked_signature:
		_automatic_progress_blocked_signature = ""
	if state_changed:
		# Advice, decision, and option choices belong to the previous snapshot.
		for popup in [option_popup, decision_popup, advice_popup]:
			if is_instance_valid(popup):
				popup.hide()
	if not bool(next_state.get("isGameOver", false)):
		settled_replay_id = ""
		if is_instance_valid(settlement_popup):
			settlement_popup.hide()
	if not is_instance_valid(content):
		return
	page = "game"
	show_game()
	_current_live_animation_positions = _capture_live_animation_positions()
	if turn_changed or discard_changed:
		call_deferred("_animate_live_table_update", next_turn, discard_changed, _previous_live_state.duplicate(true), next_state.duplicate(true))
	if not _ai_demo_running:
		_queue_auto_advance(next_state)
		_queue_human_automatic_progress(next_state)

func _sync_hand_layout_snapshot(next_state: Dictionary) -> void:
	if _free_hand_game_generation != AIService.game_generation:
		_free_hand_game_generation = AIService.game_generation
		_force_auto_hand_layout = true
		_free_hand_replay_id = ""
		_free_hand_order.clear()
		_free_hand_columns.clear()
		_manual_hand_layout = false
	var players: Array = next_state.get("players", [])
	if players.is_empty():
		_free_hand_order.clear()
		_free_hand_columns.clear()
		return
	var all_cards: Array = Dictionary(players[0]).get("cards", [])
	var locked_ids := _locked_hand_ids(_locked_hand_melds(next_state))
	var free_cards: Array = []
	for raw_card in all_cards:
		var card: Dictionary = raw_card
		if not locked_ids.has(str(card.get("id", ""))):
			free_cards.append(card)
	_sync_free_hand_order(free_cards)
	if not selected_card_id.is_empty() and _find_card_in_array(free_cards, selected_card_id).is_empty():
		selected_card_id = ""

# Presentation-only feedback for a new service snapshot. It never changes game data.
func _capture_live_animation_positions() -> Dictionary:
	var snapshot := {"cards": {}, "anchors": {}}
	var anchors: Dictionary = snapshot["anchors"]
	for player_index in 3:
		var hand_point := _capture_animation_group_center("live_hand_source_%d" % player_index)
		if hand_point != Vector2.ZERO:
			anchors["hand_%d" % player_index] = hand_point
		var meld_point := _capture_animation_group_center("live_meld_target_%d" % player_index)
		if meld_point != Vector2.ZERO:
			anchors["meld_%d" % player_index] = meld_point
		var discard_point := _capture_animation_group_center("live_discard_zone_%d" % player_index)
		if discard_point != Vector2.ZERO:
			anchors["discard_%d" % player_index] = discard_point
		var action_point := _capture_animation_group_center("live_action_anchor_%d" % player_index)
		if action_point != Vector2.ZERO:
			anchors["action_%d" % player_index] = action_point
	var deck_point := _capture_animation_group_center("live_deck_anchor")
	if deck_point != Vector2.ZERO:
		anchors["deck"] = deck_point
	var cards: Dictionary = snapshot["cards"]
	for raw_node in get_tree().get_nodes_in_group("live_card_face"):
		var node := raw_node as Control
		if node == null or not node.is_inside_tree() or node.is_queued_for_deletion() or not node.is_visible_in_tree():
			continue
		var card_id := str(node.get_meta("animation_card_id", ""))
		if card_id.is_empty():
			continue
		var rect := node.get_global_rect()
		if rect.size.x > 0.0 and rect.size.y > 0.0:
			cards[card_id] = rect.get_center()
	return snapshot

func _capture_animation_group_center(group_name: String) -> Vector2:
	for raw_node in get_tree().get_nodes_in_group(group_name):
		var node := raw_node as Control
		if node == null or not node.is_inside_tree() or node.is_queued_for_deletion() or not node.is_visible_in_tree():
			continue
		var rect := node.get_global_rect()
		if rect.size.x > 0.0 and rect.size.y > 0.0:
			return rect.get_center()
	return Vector2.ZERO

func _refresh_current_live_animation_positions() -> void:
	_current_live_animation_positions = _capture_live_animation_positions()

func _animation_snapshot_point(snapshot: Dictionary, card_id: String, anchor_key: String, fallback: Vector2) -> Vector2:
	var anchors: Dictionary = snapshot.get("anchors", {})
	if not anchor_key.is_empty() and anchors.has(anchor_key):
		return anchors[anchor_key]
	var cards: Dictionary = snapshot.get("cards", {})
	if not card_id.is_empty() and cards.has(card_id):
		return cards[card_id]
	return fallback

func _animation_card_or_anchor_point(snapshot: Dictionary, card_id: String, anchor_key: String, fallback: Vector2) -> Vector2:
	var cards: Dictionary = snapshot.get("cards", {})
	if not card_id.is_empty() and cards.has(card_id):
		return cards[card_id]
	return _animation_snapshot_point(snapshot, card_id, anchor_key, fallback)

func _animation_flight_points(card: Dictionary, start_anchor: String, end_anchor: String, previous_points: Dictionary, current_points: Dictionary, start_fallback: Vector2, end_fallback: Vector2) -> Dictionary:
	var card_id := str(card.get("id", ""))
	return {
		"start": _animation_card_or_anchor_point(previous_points, card_id, start_anchor, start_fallback),
		"end": _animation_card_or_anchor_point(current_points, card_id, end_anchor, end_fallback),
	}

func _action_animation_route(action_type: String) -> String:
	return {
		"draw": "deck_to_discard",
		"discard": "hand_to_discard",
		"bao": "hand_to_discard",
		"chi": "discard_to_meld",
		"peng": "discard_to_meld",
		"zhao": "discard_to_meld",
		"hu": "discard_to_meld",
	}.get(action_type, "")

func _action_animation_source_player_index(action: Dictionary, previous_state: Dictionary, current_state: Dictionary, target_card: Dictionary = {}) -> int:
	var target_id := str(target_card.get("id", ""))
	var explicit_source_index := int(action.get("sourcePlayerIndex", -1))
	if explicit_source_index >= 0 and explicit_source_index < 3:
		return explicit_source_index
	for raw_state in [previous_state, current_state]:
		var state: Dictionary = raw_state
		var pile: Dictionary = state.get("discardPile", {})
		var last_card: Dictionary = pile.get("lastDiscard", {})
		var source_index := int(pile.get("lastDiscardPlayerIndex", -1))
		if source_index >= 0 and (target_id.is_empty() or str(last_card.get("id", "")) == target_id):
			return source_index
		var window: Dictionary = state.get("responseWindow", {})
		if source_index < 0 and not window.is_empty():
			source_index = int(window.get("sourcePlayerIndex", -1))
			if source_index >= 0 and (target_id.is_empty() or str(Dictionary(window.get("activeCard", {})).get("id", "")) == target_id):
				return source_index
	return _action_animation_player_index(action, previous_state, current_state)

func debug_validate_animation_position_routes() -> bool:
	var previous := {
		"cards": {"route-card": Vector2(12, 24), "target-card": Vector2(30, 40), "selected-card": Vector2(14, 26)},
		"anchors": {"deck": Vector2(5, 6), "discard_2": Vector2(30, 40), "hand_1": Vector2(12, 24)},
	}
	var current := {
		"cards": {"route-card": Vector2(120, 240), "target-card": Vector2(180, 260), "selected-card": Vector2(184, 264)},
		"anchors": {"discard_1": Vector2(120, 240), "discard_2": Vector2(160, 240), "meld_1": Vector2(180, 260)},
	}
	var discard_points := _animation_flight_points({"id": "route-card"}, "hand_1", "discard_1", previous, current, Vector2.ZERO, Vector2.ZERO)
	var meld_points := _animation_flight_points({"id": "target-card"}, "discard_2", "meld_1", previous, current, Vector2.ZERO, Vector2.ZERO)
	var draw_points := _animation_flight_points({"id": "draw-card"}, "deck", "discard_2", previous, {"cards": {"draw-card": Vector2(88, 99)}, "anchors": {"discard_2": Vector2(88, 99)}}, Vector2.ZERO, Vector2.ZERO)
	var draw_target := _action_animation_target_card({"type": "draw"}, {}, {"players": [{"melds": [{"cards": [{"id": "target-card"}, {"id": "hand-card"}]}]}]})
	var source_index := _action_animation_source_player_index({"type": "chi", "playerId": "player_1"}, {"discardPile": {"lastDiscard": {"id": "target-card"}, "lastDiscardPlayerIndex": 2}}, {}, {"id": "target-card"})
	return _action_animation_route("draw") == "deck_to_discard" \
		and _action_animation_route("discard") == "hand_to_discard" \
		and _action_animation_route("chi") == "discard_to_meld" \
		and discard_points.get("start", Vector2.ZERO) == Vector2(12, 24) \
		and discard_points.get("end", Vector2.ZERO) == Vector2(120, 240) \
		and meld_points.get("start", Vector2.ZERO) == Vector2(30, 40) \
		and meld_points.get("end", Vector2.ZERO) == Vector2(180, 260) \
		and draw_points.get("start", Vector2.ZERO) == Vector2(5, 6) \
		and draw_points.get("end", Vector2.ZERO) == Vector2(88, 99) \
				and str(draw_target.get("id", "")) == "target-card" \
				and source_index == 2

func debug_validate_animation_anchor_priority() -> bool:
	var previous := {
		"cards": {},
		"anchors": {"discard_2": Vector2(40, 40)},
	}
	var current := {
		"cards": {},
		"anchors": {"meld_1": Vector2(240, 120)},
	}
	var points := _animation_flight_points({"id": "target-card"}, "discard_2", "meld_1", previous, current, Vector2.ZERO, Vector2.ZERO)
	return points.get("start", Vector2.ZERO) == Vector2(40, 40) \
			and points.get("end", Vector2.ZERO) == Vector2(240, 120)

func debug_validate_animation_card_endpoint_contract() -> bool:
	var previous := {
		"cards": {"target-card": Vector2(12, 12)},
		"anchors": {"discard_2": Vector2(40, 40)},
	}
	var current := {
		"cards": {"target-card": Vector2(13, 13)},
		"anchors": {"meld_1": Vector2(240, 120)},
	}
	var points := _animation_flight_points({"id": "target-card"}, "discard_2", "meld_1", previous, current, Vector2.ZERO, Vector2.ZERO)
	return points.get("start", Vector2.ZERO) == Vector2(12, 12) \
			and points.get("end", Vector2.ZERO) == Vector2(13, 13)

func debug_validate_animation_target_routes() -> bool:
	var target := {"id": "target-card", "value": 6, "size": "small"}
	var previous := {
		"players": [{"playerId": "player_0"}, {"playerId": "player_1"}, {"playerId": "player_2"}],
		"discardPile": {"lastDiscard": target, "lastDiscardPlayerIndex": 2},
	}
	var current := previous.duplicate(true)
	var p1_action := {"type": "chi", "playerId": "player_1"}
	var p2_action := {"type": "peng", "playerIndex": 2}
	var p1_index := _action_animation_player_index(p1_action, previous, current)
	var p2_index := _action_animation_player_index(p2_action, previous, current)
	var source_index := _action_animation_source_player_index(p1_action, previous, current, target)
	var previous_points := {"anchors": {"discard_2": Vector2(20, 20)}}
	var current_points := {"anchors": {
		"meld_0": Vector2(100, 100),
		"meld_1": Vector2(240, 120),
		"meld_2": Vector2(420, 120),
	}}
	var p1_points := _animation_flight_points(target, "discard_2", "meld_1", previous_points, current_points, Vector2.ZERO, Vector2.ZERO)
	var p2_points := _animation_flight_points(target, "discard_2", "meld_2", previous_points, current_points, Vector2.ZERO, Vector2.ZERO)
	return p1_index == 1 \
		and p2_index == 2 \
		and source_index == 2 \
		and p1_points.get("end", Vector2.ZERO) == Vector2(240, 120) \
		and p2_points.get("end", Vector2.ZERO) == Vector2(420, 120)

func debug_validate_action_animation_routes() -> bool:
	var expected := {
		"draw": "deck_to_discard",
		"discard": "hand_to_discard",
		"bao": "hand_to_discard",
		"chi": "discard_to_meld",
		"peng": "discard_to_meld",
		"zhao": "discard_to_meld",
		"hu": "discard_to_meld",
	}
	for action_type in expected.keys():
		if _action_animation_route(str(action_type)) != str(expected[action_type]):
			return false
	if not _action_animation_route("pass").is_empty():
		return false
	var discard_card := {"id": "animation-discard", "value": 6, "size": "small"}
	var previous := {"players": [{"playerId": "player_0", "cards": [discard_card]}], "discardPile": {"lastDiscard": {"id": "old-card", "value": 3, "size": "small"}}}
	var current := {"players": [{"playerId": "player_0", "cards": []}], "discardPile": {"lastDiscard": discard_card}}
	var discard_cards := _action_animation_cards({"type": "discard", "playerId": "player_0", "cards": [discard_card]}, previous, current, 0)
	return not discard_cards.is_empty() and str(Dictionary(discard_cards[0]).get("id", "")) == "animation-discard"

func _action_animation_player_index(action: Dictionary, previous_state: Dictionary, current_state: Dictionary) -> int:
	var explicit_index := int(action.get("playerIndex", action.get("actorPlayerIndex", -1)))
	if explicit_index >= 0 and explicit_index < Array(current_state.get("players", [])).size():
		return explicit_index
	var player_id := str(action.get("playerId", ""))
	for raw_state in [previous_state, current_state]:
		var state: Dictionary = raw_state
		var players: Array = state.get("players", [])
		for index in players.size():
			var player: Dictionary = players[index]
			if str(player.get("playerId", "")) == player_id:
				return index
	return int(current_state.get("activePlayerIndex", current_state.get("currentPlayerIndex", 0)))

func _action_animation_target_card(action: Dictionary, previous_state: Dictionary, current_state: Dictionary) -> Dictionary:
	var action_type := str(action.get("type", ""))
	if action_type in ["discard", "bao"]:
		var direct_cards: Array = action.get("cards", [])
		if not direct_cards.is_empty():
			return direct_cards[0]
	if action_type == "draw":
		var previous_meld_card_ids := {}
		for raw_player in Array(previous_state.get("players", [])):
			for raw_meld in Array(Dictionary(raw_player).get("melds", [])):
				for raw_card in Array(Dictionary(raw_meld).get("cards", [])):
					previous_meld_card_ids[str(Dictionary(raw_card).get("id", ""))] = true
		for raw_player in Array(current_state.get("players", [])):
			for raw_meld in Array(Dictionary(raw_player).get("melds", [])):
				var meld_cards: Array = Array(Dictionary(raw_meld).get("cards", []))
				if meld_cards.is_empty():
					continue
				var has_new_card := false
				for raw_card in meld_cards:
					if not previous_meld_card_ids.has(str(Dictionary(raw_card).get("id", ""))):
						has_new_card = true
						break
				if has_new_card:
					return meld_cards[0]
	var state_order: Array = [current_state, previous_state] if action_type == "draw" else [previous_state, current_state]
	for raw_state in state_order:
		var state: Dictionary = raw_state
		var pile: Dictionary = state.get("discardPile", {})
		var card: Dictionary = pile.get("lastDiscard", {})
		if not card.is_empty():
			return card
	var action_cards: Array = action.get("cards", [])
	return action_cards[0] if not action_cards.is_empty() else {}

func _append_unique_animation_card(cards: Array, card: Dictionary) -> void:
	if card.is_empty():
		return
	var card_id := str(card.get("id", ""))
	for raw_card in cards:
		if str(Dictionary(raw_card).get("id", "")) == card_id:
			return
	cards.append(card)

func _removed_hand_cards(previous_state: Dictionary, current_state: Dictionary, player_index: int) -> Array:
	var previous_players: Array = previous_state.get("players", [])
	var current_players: Array = current_state.get("players", [])
	if player_index < 0 or player_index >= previous_players.size() or player_index >= current_players.size():
		return []
	var current_ids := {}
	for raw_card in Array(Dictionary(current_players[player_index]).get("cards", [])):
		current_ids[str(Dictionary(raw_card).get("id", ""))] = true
	var removed: Array = []
	for raw_card in Array(Dictionary(previous_players[player_index]).get("cards", [])):
		var card: Dictionary = raw_card
		if not current_ids.has(str(card.get("id", ""))):
			removed.append(card)
	return removed

func _action_animation_cards(action: Dictionary, previous_state: Dictionary, current_state: Dictionary, player_index: int) -> Array:
	var action_type := str(action.get("type", ""))
	var cards: Array = []
	var target := _action_animation_target_card(action, previous_state, current_state)
	if action_type == "draw":
		_append_unique_animation_card(cards, target)
		return cards
	if action_type in ["discard", "bao"]:
		for raw_card in Array(action.get("cards", [])):
			_append_unique_animation_card(cards, Dictionary(raw_card))
		_append_unique_animation_card(cards, target)
		return cards
	if action_type in ["chi", "peng", "zhao", "hu"]:
		_append_unique_animation_card(cards, target)
		for raw_card in Array(action.get("cards", [])):
			_append_unique_animation_card(cards, Dictionary(raw_card))
		for raw_card in _removed_hand_cards(previous_state, current_state, player_index):
			_append_unique_animation_card(cards, Dictionary(raw_card))
	return cards

func _animation_group_point(group_name: String, fallback: Vector2) -> Vector2:
	var nodes := get_tree().get_nodes_in_group(group_name)
	for raw_node in nodes:
		var node := raw_node as Control
		if node != null and node.is_inside_tree() and not node.is_queued_for_deletion() and node.is_visible_in_tree():
			var rect := node.get_global_rect()
			if rect.size.x > 0.0 and rect.size.y > 0.0:
				return rect.get_center()
	return fallback

func _animation_snapshot_or_group_point(snapshot: Dictionary, anchor_key: String, group_name: String, fallback: Vector2) -> Vector2:
	return _animation_snapshot_point(snapshot, "", anchor_key, _animation_group_point(group_name, fallback))

func _action_animation_anchor_keys(route: String, player_index: int, source_player_index: int, card: Dictionary, target_id: String) -> Dictionary:
	var discard_anchor := "discard_%d" % source_player_index
	var anchors := {"start": discard_anchor, "end": discard_anchor}
	if route == "deck_to_discard":
		anchors["start"] = "deck"
	elif route == "hand_to_discard":
		anchors["start"] = "hand_%d" % player_index
	elif route == "discard_to_meld":
		if str(card.get("id", "")) != target_id:
			anchors["start"] = "hand_%d" % player_index
		anchors["end"] = "meld_%d" % player_index
	return anchors

func debug_validate_animation_endpoint_contract() -> bool:
	var target := {"id": "endpoint-target", "value": 6, "size": "small"}
	var p1 := _action_animation_anchor_keys("discard_to_meld", 1, 2, target, "endpoint-target")
	var p1_hand := _action_animation_anchor_keys("discard_to_meld", 1, 2, {"id": "endpoint-hand"}, "endpoint-target")
	var p2 := _action_animation_anchor_keys("discard_to_meld", 2, 1, target, "endpoint-target")
	var p2_discard := _action_animation_anchor_keys("hand_to_discard", 2, 2, target, "endpoint-target")
	var draw := _action_animation_anchor_keys("deck_to_discard", 1, 2, target, "endpoint-target")
	return p1.get("start", "") == "discard_2" \
		and p1.get("end", "") == "meld_1" \
		and p1_hand.get("start", "") == "hand_1" \
		and p1_hand.get("end", "") == "meld_1" \
		and p2.get("end", "") == "meld_2" \
		and p2_discard.get("start", "") == "hand_2" \
		and p2_discard.get("end", "") == "discard_2" \
		and draw.get("start", "") == "deck" \
		and draw.get("end", "") == "discard_2"

func _new_transition_meld(previous_state: Dictionary, current_state: Dictionary) -> Dictionary:
	var previous_meld_card_ids := {}
	for raw_player in Array(previous_state.get("players", [])):
		for raw_meld in Array(Dictionary(raw_player).get("melds", [])):
			for raw_card in Array(Dictionary(raw_meld).get("cards", [])):
				previous_meld_card_ids[str(Dictionary(raw_card).get("id", ""))] = true
	for player_index in Array(current_state.get("players", [])).size():
		var player: Dictionary = current_state.get("players", [])[player_index]
		for raw_meld in Array(player.get("melds", [])):
			var meld: Dictionary = raw_meld
			var meld_cards: Array = meld.get("cards", [])
			if meld_cards.is_empty():
				continue
			for raw_card in meld_cards:
				if not previous_meld_card_ids.has(str(Dictionary(raw_card).get("id", ""))):
					return {"playerIndex": player_index, "cards": meld_cards}
	return {}

func _spawn_action_card_flight(card: Dictionary, start_point: Vector2, end_point: Vector2, delay: float = 0.0) -> void:
	if not is_instance_valid(_action_animation_layer) or card.is_empty():
		return
	var art := _card_art(card, ACTION_ANIMATION_CARD_SIZE)
	art.name = "ActionCardFlight"
	art.z_index = 2
	art.pivot_offset = ACTION_ANIMATION_CARD_SIZE * 0.5
	art.scale = Vector2(0.82, 0.82)
	art.modulate = Color(1.0, 1.0, 1.0, 0.18)
	_action_animation_layer.add_child(art)
	art.global_position = start_point - ACTION_ANIMATION_CARD_SIZE * 0.5
	var tween := create_tween()
	if delay > 0.0:
		tween.tween_interval(delay)
	tween.tween_property(art, "global_position", end_point - ACTION_ANIMATION_CARD_SIZE * 0.5, ACTION_ANIMATION_SECONDS).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tween.parallel().tween_property(art, "scale", Vector2.ONE, ACTION_ANIMATION_SECONDS).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tween.parallel().tween_property(art, "modulate:a", 1.0, ACTION_ANIMATION_SECONDS)
	tween.tween_callback(func():
		if is_instance_valid(art):
			art.queue_free()
	)

func _animation_card_id_set(cards: Array) -> Dictionary:
	var ids := {}
	for raw_card in cards:
		var card: Dictionary = raw_card
		var card_id := str(card.get("id", ""))
		if not card_id.is_empty():
			ids[card_id] = true
	return ids

func _set_live_animation_card_visibility(card_ids: Dictionary, visible: bool, keep_pending: bool = false) -> void:
	if card_ids.is_empty():
		return
	for raw_node in get_tree().get_nodes_in_group("live_card_face"):
		var node := raw_node as Control
		if node == null or not node.is_inside_tree() or node.is_queued_for_deletion():
			continue
		var card_id := str(node.get_meta("animation_card_id", ""))
		if card_id.is_empty() or not card_ids.has(card_id) or (keep_pending and node.is_in_group("live_discard_pending")):
			continue
		if visible:
			var restore_variant: Variant = node.get_meta("animation_restore_modulate", null)
			if restore_variant != null and typeof(restore_variant) == TYPE_COLOR:
				node.modulate = restore_variant
				node.remove_meta("animation_restore_modulate")
			else:
				var restored := node.modulate
				restored.a = 1.0
				node.modulate = restored
		else:
			node.set_meta("animation_restore_modulate", node.modulate)
			var hidden := node.modulate
			hidden.a = 0.0
			node.modulate = hidden

func _spawn_action_text(action_type: String, player_index: int, point: Vector2, delay: float = 0.0) -> void:
	if not is_instance_valid(_action_animation_layer):
		return
	var text := _action_text(action_type)
	if text.is_empty() or action_type == "pass":
		return
	var label := Label.new()
	label.name = "ActionText_%d" % player_index
	label.text = text
	label.custom_minimum_size = Vector2(112, 62)
	label.size = Vector2(112, 62)
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.add_theme_font_size_override("font_size", 40)
	label.add_theme_color_override("font_color", GOLD)
	label.add_theme_color_override("font_outline_color", Color("0b2418", 0.98))
	label.add_theme_constant_override("outline_size", 6)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.z_index = 3
	label.pivot_offset = label.size * 0.5
	label.scale = Vector2(0.62, 0.62)
	label.modulate = Color(1.0, 1.0, 1.0, 0.0)
	_action_animation_layer.add_child(label)
	label.global_position = point - label.size * 0.5
	var tween := create_tween()
	if delay > 0.0:
		tween.tween_interval(delay)
	tween.tween_property(label, "scale", Vector2.ONE, ACTION_TEXT_ANIMATION_SECONDS * 0.28).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tween.parallel().tween_property(label, "modulate:a", 1.0, ACTION_TEXT_ANIMATION_SECONDS * 0.16)
	tween.tween_interval(ACTION_TEXT_ANIMATION_SECONDS * 0.44)
	tween.tween_property(label, "modulate:a", 0.0, ACTION_TEXT_ANIMATION_SECONDS * 0.28)
	tween.tween_callback(func():
		if is_instance_valid(label):
			label.queue_free()
	)

func _next_action_animation_generation() -> int:
	_action_animation_generation += 1
	return _action_animation_generation

func _action_animation_wait_seconds() -> float:
	var remaining := maxf(0.0, float(_action_animation_ready_at_msec - Time.get_ticks_msec()) / 1000.0)
	return maxf(AI_ACTION_DELAY_SECONDS, remaining)

func _animate_recorded_action(record: Dictionary, previous_state: Dictionary, current_state: Dictionary) -> void:
	if page != "game" or previous_state.is_empty() or current_state.is_empty():
		return
	var action: Dictionary = record.get("action", {})
	var action_type := str(action.get("type", ""))
	var route := _action_animation_route(action_type)
	if route.is_empty():
		return
	var player_index := _action_animation_player_index(action, previous_state, current_state)
	var previous_points := _previous_live_animation_positions
	var current_points := _current_live_animation_positions
	var timeline := _action_animation_timeline(action_type)
	var action_text_delay := float(timeline.get("action_text_delay", 0.0))
	var card_flight_delay := float(timeline.get("card_flight_delay", 0.0))
	var fallback := get_viewport_rect().size * 0.5
	var deck_point := _animation_snapshot_or_group_point(previous_points, "deck", "live_deck_anchor", fallback)
	var hand_point := _animation_snapshot_or_group_point(previous_points, "hand_%d" % player_index, "live_hand_source_%d" % player_index, fallback)
	var meld_point := _animation_snapshot_or_group_point(current_points, "meld_%d" % player_index, "live_meld_target_%d" % player_index, fallback)
	var target_card := _action_animation_target_card(action, previous_state, current_state)
	var target_id := str(target_card.get("id", ""))
	var source_player_index := _action_animation_source_player_index(action, previous_state, current_state, target_card)
	var discard_start_point := _animation_snapshot_or_group_point(previous_points, "discard_%d" % source_player_index, "live_discard_zone_%d" % source_player_index, fallback)
	var discard_end_point := _animation_snapshot_or_group_point(current_points, "discard_%d" % source_player_index, "live_discard_zone_%d" % source_player_index, discard_start_point)
	var cards := _action_animation_cards(action, previous_state, current_state, player_index)
	if cards.is_empty():
		return
	var transition_meld := _new_transition_meld(previous_state, current_state) if action_type in ["draw", "discard", "bao"] else {}
	var animated_card_ids := _animation_card_id_set(cards)
	for raw_transition_card in Array(transition_meld.get("cards", [])):
		var transition_card: Dictionary = raw_transition_card
		var transition_id := str(transition_card.get("id", ""))
		if not transition_id.is_empty():
			animated_card_ids[transition_id] = true
	_set_live_animation_card_visibility(animated_card_ids, false)
	for index in cards.size():
		var card: Dictionary = cards[index]
		var anchor_keys := _action_animation_anchor_keys(route, player_index, source_player_index, card, target_id)
		var start_anchor := str(anchor_keys.get("start", "discard_%d" % source_player_index))
		var end_anchor := str(anchor_keys.get("end", "discard_%d" % source_player_index))
		var start_fallback := discard_start_point
		var end_fallback := discard_end_point
		if start_anchor == "deck":
			start_fallback = deck_point
		elif start_anchor == "hand_%d" % player_index:
			start_fallback = hand_point
		if end_anchor == "meld_%d" % player_index:
			end_fallback = meld_point
		var flight_points := _animation_flight_points(card, start_anchor, end_anchor, previous_points, current_points, start_fallback, end_fallback)
		_spawn_action_card_flight(Dictionary(card), flight_points.get("start", start_fallback), flight_points.get("end", end_fallback), card_flight_delay)
	var action_point := _animation_snapshot_point(current_points, "", "action_%d" % player_index, meld_point if route == "discard_to_meld" else discard_end_point)
	_spawn_action_text(action_type, player_index, action_point, action_text_delay)
	var restore_delay := card_flight_delay + ACTION_ANIMATION_SECONDS
	if action_type in ["draw", "discard", "bao"]:
		if not transition_meld.is_empty():
			var transition_player := int(transition_meld.get("playerIndex", player_index))
			var transition_hand_point := _animation_snapshot_or_group_point(previous_points, "hand_%d" % transition_player, "live_hand_source_%d" % transition_player, fallback)
			var transition_meld_point := _animation_snapshot_or_group_point(current_points, "meld_%d" % transition_player, "live_meld_target_%d" % transition_player, fallback)
			for index in Array(transition_meld.get("cards", [])).size():
				var transition_card: Dictionary = transition_meld.get("cards", [])[index]
				var transition_target := str(transition_card.get("id", "")) == target_id
				if transition_target:
					continue
				var transition_points := _animation_flight_points(transition_card, "hand_%d" % transition_player, "meld_%d" % transition_player, previous_points, current_points, transition_hand_point, transition_meld_point)
				_spawn_action_card_flight(transition_card, transition_points.get("start", transition_hand_point), transition_points.get("end", transition_meld_point), ACTION_ANIMATION_SECONDS)
			restore_delay = maxf(restore_delay, ACTION_ANIMATION_SECONDS * 2.0)
	var animation_generation := _action_animation_generation
	var restore_tween := create_tween()
	restore_tween.tween_interval(restore_delay)
	restore_tween.tween_callback(func():
		if animation_generation == _action_animation_generation:
			_set_live_animation_card_visibility(animated_card_ids, true)
	)

func _clear_action_animations() -> void:
	if not is_instance_valid(_action_animation_layer):
		return
	for child in _action_animation_layer.get_children():
		child.free()

func _animate_live_table_update(current_turn: int, discard_changed: bool, previous_state: Dictionary = {}, current_state: Dictionary = {}) -> void:
	var seats := get_tree().get_nodes_in_group("live_turn_seat_%d" % current_turn)
	if not seats.is_empty():
		var seat: Control = seats[0]
		seat.modulate = Color(1.0, 1.0, 1.0, 0.45)
		var seat_tween := create_tween()
		seat_tween.tween_property(seat, "modulate:a", 1.0, ANIMATION_DURATION_SECONDS / 3.0)
		seat_tween.tween_property(seat, "modulate:a", 0.72, ANIMATION_DURATION_SECONDS / 3.0)
		seat_tween.tween_property(seat, "modulate:a", 1.0, ANIMATION_DURATION_SECONDS / 3.0)
	if discard_changed:
		var current_pile: Dictionary = current_state.get("discardPile", {})
		var current_pending_id := str(Dictionary(current_pile.get("lastDiscard", {})).get("id", ""))
		var current_pending_player := int(current_pile.get("lastDiscardPlayerIndex", -1))
		for raw_node in get_tree().get_nodes_in_group("live_discard_pending"):
			var discard := raw_node as Control
			if discard == null or not discard.is_inside_tree() or discard.is_queued_for_deletion() or not discard.is_visible_in_tree():
				continue
			if not current_pending_id.is_empty() and str(discard.get_meta("animation_card_id", "")) != current_pending_id:
				continue
			if current_pending_player >= 0 and int(discard.get_meta("discard_player_index", -1)) != current_pending_player:
				continue
			discard.pivot_offset = discard.size * 0.5
			discard.scale = Vector2(0.78, 0.78)
			discard.modulate = Color(DISCARD_PENDING_MODULATE, 0.2)
			var card_tween := create_tween().set_parallel(true)
			card_tween.tween_property(discard, "scale", Vector2.ONE, ANIMATION_DURATION_SECONDS).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
			card_tween.tween_property(discard, "modulate", DISCARD_PENDING_MODULATE, ANIMATION_DURATION_SECONDS)
			break
	var previous_pending := _pending_response_card(previous_state)
	if not previous_pending.is_empty() and not current_state.is_empty():
		var previous_pending_id := str(previous_pending.get("id", ""))
		var previous_pending_player := int(Dictionary(previous_state.get("discardPile", {})).get("lastDiscardPlayerIndex", -1))
		for raw_node in get_tree().get_nodes_in_group("live_discard_archived"):
			var archived := raw_node as Control
			if archived == null or not archived.is_inside_tree() or archived.is_queued_for_deletion() or not archived.is_visible_in_tree() or str(archived.get_meta("animation_card_id", "")) != previous_pending_id:
				continue
			if previous_pending_player >= 0 and int(archived.get_meta("discard_player_index", -1)) != previous_pending_player:
				continue
			# Archived cards remain the fixed top-text crop. Only their color
			# settles to the muted state; never enlarge the gray face vertically.
			archived.scale = Vector2.ONE
			archived.modulate = Color(DISCARD_LOCKED_MODULATE, 0.72)
			var archive_tween := create_tween().set_parallel(true)
			archive_tween.tween_property(archived, "modulate", DISCARD_LOCKED_MODULATE, ANIMATION_DURATION_SECONDS)

func _on_action_recorded(record: Dictionary) -> void:
	if page == "game" and not AIService.latest_state.is_empty():
		var previous_state := _previous_live_state.duplicate(true)
		var current_state := AIService.latest_state.duplicate(true)
		var action: Dictionary = record.get("action", {})
		var action_type := str(action.get("type", ""))
		var animation_wait := _action_animation_minimum_wait_seconds(action_type)
		_action_animation_ready_at_msec = maxi(_action_animation_ready_at_msec, Time.get_ticks_msec() + int(roundf(animation_wait * 1000.0)))
		var animation_generation := _next_action_animation_generation()
		_clear_action_animations()
		_response_animation_hold_generation += 1
		_response_animation_hold = {}
		var hold := _response_animation_hold_for_action(action, previous_state, current_state)
		var hold_generation := 0
		if not hold.is_empty():
			hold_generation = _response_animation_hold_generation
			hold["generation"] = hold_generation
			_response_animation_hold = hold
			show_game()
			var response_player_index := _action_animation_player_index(action, previous_state, current_state)
			var response_cards := _action_animation_cards(action, previous_state, current_state, response_player_index)
			_set_live_animation_card_visibility(_animation_card_id_set(response_cards), false, true)
		# Wait for the rebuilt table to finish one layout pass before sampling the
		# destination anchors. Sampling during show_game() can capture a zero-sized
		# meld container at the table's lower-left fallback position.
		call_deferred("_animate_recorded_action_after_layout", record.duplicate(true), previous_state, current_state, animation_generation, hold_generation)

func _animate_recorded_action_after_layout(record: Dictionary, previous_state: Dictionary, current_state: Dictionary, animation_generation: int, hold_generation: int) -> void:
		await get_tree().process_frame
		await get_tree().process_frame
		if animation_generation != _action_animation_generation:
			return
		if hold_generation > 0:
			await get_tree().create_timer(RESPONSE_ANIMATION_HOLD_SECONDS).timeout
			if animation_generation != _action_animation_generation or hold_generation != _response_animation_hold_generation:
				return
			_response_animation_hold = {}
			show_game()
			await get_tree().process_frame
			await get_tree().process_frame
			if animation_generation != _action_animation_generation:
				return
		_clear_action_animations()
		_current_live_animation_positions = _capture_live_animation_positions()
		_animate_recorded_action(record, previous_state, current_state)

func _on_advice_received(analysis: Dictionary) -> void:
	var recommendations: Array = analysis.get("recommendations", [])
	if recommendations.is_empty():
		if str(AIService.latest_state.get("phase", "")) == "drawing":
			_show_toast("当前应先摸牌；摸牌后可获取出牌建议。")
		else:
			_show_toast("当前没有可展示的 AI 建议。")
		return
	_show_advice_panel(analysis)

func _show_advice_panel(analysis: Dictionary) -> void:
	for child in advice_popup.get_children():
		child.queue_free()
	var body := VBoxContainer.new()
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 10)
	advice_popup.add_child(body)
	var recommendations: Array = analysis.get("recommendations", [])
	var title := Label.new()
	title.text = "AI 建议"
	title.add_theme_font_size_override("font_size", 23)
	title.add_theme_color_override("font_color", INK)
	body.add_child(title)
	var strategy: Dictionary = analysis.get("strategy", {})
	var win_rate: Dictionary = analysis.get("winRate", {})
	var overview := Label.new()
	overview.text = "牌力 %s  ·  估计胜率 %.0f%%  ·  风险 %.0f" % [_hand_strength_text(str(strategy.get("handStrength", "unknown"))), float(win_rate.get("currentWinRate", 0.0)) * 100.0, float(strategy.get("riskLevel", 0.0))]
	overview.add_theme_color_override("font_color", Color("675d4f"))
	body.add_child(overview)
	var policy := Label.new()
	var policy_metadata := _analysis_policy_metadata(analysis)
	var policy_source := str(policy_metadata.get("source", "heuristic"))
	var policy_version := str(policy_metadata.get("version", ""))
	policy.text = "策略来源：" + ("原版强化策略" if policy_source == "learned" else "规则分析")
	if not policy_version.is_empty():
		policy.text += "  ·  " + policy_version
	policy.add_theme_color_override("font_color", JADE if policy_source == "learned" else Color("675d4f"))
	body.add_child(policy)
	var suggestions: Array = strategy.get("suggestions", [])
	if not suggestions.is_empty():
		var suggestion := Label.new()
		suggestion.text = "· " + str(suggestions[0])
		suggestion.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		suggestion.add_theme_color_override("font_color", INK)
		suggestion.add_theme_font_size_override("font_size", 14)
		body.add_child(suggestion)
	var heading := Label.new()
	heading.text = "推荐动作"
	heading.add_theme_font_size_override("font_size", 16)
	heading.add_theme_color_override("font_color", RED)
	body.add_child(heading)
	for index in min(3, recommendations.size()):
		var item: Dictionary = recommendations[index]
		var card_value: Variant = item.get("card", item.get("meldCards", []))
		var cards_text := _card_text(card_value) if typeof(card_value) == TYPE_DICTIONARY else _cards_text(Array(card_value))
		var summary := str(item.get("summary", item.get("reasoning", "")))
		var row := VBoxContainer.new()
		row.add_theme_constant_override("separation", 2)
		var label := Label.new()
		label.text = "%d. %s  %s" % [index + 1, _action_text(str(item.get("action", ""))), cards_text]
		label.add_theme_font_size_override("font_size", 17)
		label.add_theme_color_override("font_color", INK)
		row.add_child(label)
		var reason := Label.new()
		reason.text = summary
		reason.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		reason.max_lines_visible = 2
		reason.custom_minimum_size.y = 34
		reason.add_theme_color_override("font_color", Color("675d4f"))
		row.add_child(reason)
		var recommended_card := _recommended_legal_discard(AIService.latest_state, item)
		if not recommended_card.is_empty():
			var apply := _quiet_button("选中此牌", func(): _apply_recommended_discard(recommended_card))
			apply.tooltip_text = "仅选中 AI 建议且仍被当前规则允许的弃牌；出牌仍需你确认"
			row.add_child(apply)
		body.add_child(row)
	body.add_child(_quiet_button("关闭", func(): advice_popup.hide()))
	advice_popup.reset_size()
	advice_popup.size = Vector2i(520, clampi(int(body.get_combined_minimum_size().y) + 28, 220, 360))
	advice_popup.popup_centered()

func _recommended_legal_discard(state: Dictionary, recommendation: Dictionary) -> Dictionary:
	if str(recommendation.get("action", "")) != "discard":
		return {}
	var suggested: Dictionary = recommendation.get("card", {})
	var suggested_id := str(suggested.get("id", ""))
	if suggested_id.is_empty():
		return {}
	for raw_action in Array(state.get("availableActions", [])):
		var action: Dictionary = raw_action
		if str(action.get("type", "")) != "discard":
			continue
		for raw_card in Array(action.get("cards", [])):
			var card: Dictionary = raw_card
			if str(card.get("id", "")) == suggested_id:
				return card
	return {}

func _apply_recommended_discard(card: Dictionary) -> void:
	var legal_card := _recommended_legal_discard(AIService.latest_state, {"action": "discard", "card": card})
	if legal_card.is_empty():
		_show_toast("建议已不适用于当前局面，请重新获取 AI 建议。")
		advice_popup.hide()
		return
	selected_card_id = str(legal_card.get("id", ""))
	advice_popup.hide()
	show_game()
	_show_toast("已选中建议牌 %s；确认后可按 Enter 出牌。" % _card_text(legal_card))

func debug_recommended_legal_discard(state: Dictionary, recommendation: Dictionary) -> Dictionary:
	return _recommended_legal_discard(state, recommendation)

func _hand_strength_text(value: String) -> String:
	return {"strong": "较强", "medium": "均衡", "weak": "偏弱", "unknown": "未知"}.get(value, value)

func _analysis_policy_metadata(analysis: Dictionary) -> Dictionary:
	for raw in Array(analysis.get("recommendations", [])):
		var recommendation: Dictionary = raw
		if recommendation.has("policySource"):
			return {"source": str(recommendation.get("policySource", "heuristic")), "version": str(recommendation.get("policyVersion", ""))}
	for raw in Array(analysis.get("rankedActions", [])):
		var ranked: Dictionary = raw
		var recommendation: Dictionary = ranked.get("recommendation", {})
		if recommendation.has("policySource"):
			return {"source": str(recommendation.get("policySource", "heuristic")), "version": str(recommendation.get("policyVersion", ""))}
	return {"source": "heuristic", "version": ""}

func debug_validate_advice_policy_metadata() -> bool:
	var learned := {"recommendations": [{"policySource": "learned", "policyVersion": "learned-v1"}]}
	var ranked := {"rankedActions": [{"recommendation": {"policySource": "learned", "policyVersion": "learned-v2"}}]}
	return _analysis_policy_metadata(learned).get("source", "") == "learned" and _analysis_policy_metadata(ranked).get("version", "") == "learned-v2"

func _on_decision_received(decision: Dictionary) -> void:
	var trace: Dictionary = decision.get("trace", {})
	var summary := str(trace.get("summary", "AI 已完成决策"))
	if page == "game" and not summary.is_empty():
		_show_toast(summary, 2.2)

func _on_connection_changed(is_connected: bool, message: String) -> void:
	_show_toast(message, 2.0)
	if is_connected and not AIService.latest_state.is_empty():
		_automatic_progress_blocked_signature = ""
		AIService.refresh_state()
	elif not is_connected and not AIService.latest_state.is_empty():
		call_deferred("_schedule_runtime_recovery")
	if page == "home": show_home()

func _schedule_runtime_recovery() -> void:
	await get_tree().create_timer(0.6).timeout
	if not AIService.connected and not AIService.latest_state.is_empty():
		AIService.recover_runtime_state()

func _on_request_failed(message: String) -> void:
	_human_auto_action_in_flight = false
	if _advice_loading:
		_advice_loading = false
		if page == "game":
			show_game()
	_show_toast(message, 4.0)

func _on_game_state_invalidated(message: String) -> void:
	selected_card_id = ""
	page = "home"
	show_home()
	_show_toast(message, 4.0)

func _find_human_card(card_id: String) -> Dictionary:
	var players: Array = AIService.latest_state.get("players", [])
	if players.is_empty(): return {}
	for raw_card in Array(Dictionary(players[0]).get("cards", [])):
		var card: Dictionary = raw_card
		if str(card.get("id", "")) == card_id: return card
	return {}

func _sorted_human_cards(raw_cards: Array) -> Array:
	var cards := raw_cards.duplicate()
	cards.sort_custom(func(left: Dictionary, right: Dictionary) -> bool:
		var left_size := 1 if str(left.get("size", "small")) == "big" else 0
		var right_size := 1 if str(right.get("size", "small")) == "big" else 0
		if left_size != right_size:
			return left_size < right_size
		var left_value := int(left.get("value", left.get("rank", 0)))
		var right_value := int(right.get("value", right.get("rank", 0)))
		return left_value < right_value
	)
	return cards

func _display_hand_groups(raw_cards: Array) -> Array[Dictionary]:
	return _hand_groups(raw_cards)

func _hand_groups(raw_cards: Array) -> Array[Dictionary]:
	var remaining: Array = _sorted_human_cards(raw_cards)
	var groups: Array[Dictionary] = []
	var used := {}
	var by_code := {}
	for raw_card in remaining:
		var card: Dictionary = raw_card
		var code := "%s_%d" % [str(card.get("size", "small")), int(card.get("value", 0))]
		if not by_code.has(code): by_code[code] = []
		by_code[code].append(card)
	for code in by_code.keys():
		var same: Array = by_code[code]
		if same.size() >= 3:
			var take: Array = same.slice(0, mini(same.size(), 4))
			groups.append({"kind": "quad" if take.size() == 4 else "triple", "label": "提" if take.size() == 4 else "坎", "cards": take})
			for card in take: used[str(card.get("id", ""))] = true
	for size in ["small", "big"]:
		var special: Array = []
		for value in [2, 7, 10]:
			var candidates: Array = by_code.get("%s_%d" % [size, value], [])
			for candidate in candidates:
				if not used.has(str(candidate.get("id", ""))): special.append(candidate); break
		if special.size() == 3:
			groups.append({"kind": "special", "label": "二七十", "cards": special})
			for card in special: used[str(card.get("id", ""))] = true
	for size in ["small", "big"]:
		for start in range(1, 9):
			var run: Array = []
			for value in [start, start + 1, start + 2]:
				var candidates: Array = by_code.get("%s_%d" % [size, value], [])
				var found: Dictionary = {}
				for candidate in candidates:
					if not used.has(str(candidate.get("id", ""))): found = candidate; break
				if not found.is_empty(): run.append(found)
			if run.size() == 3:
				groups.append({"kind": "sequence", "label": "顺", "cards": run})
				for card in run: used[str(card.get("id", ""))] = true
	for value in range(1, 11):
		var small_cards: Array = by_code.get("small_%d" % value, [])
		var big_cards: Array = by_code.get("big_%d" % value, [])
		var mixed: Array = []
		for card in small_cards:
			if not used.has(str(card.get("id", ""))): mixed.append(card)
			if mixed.size() == 2: break
		for card in big_cards:
			if not used.has(str(card.get("id", ""))): mixed.append(card)
			if mixed.size() == 3: break
		if mixed.size() < 3:
			mixed.clear()
			for card in big_cards:
				if not used.has(str(card.get("id", ""))): mixed.append(card)
				if mixed.size() == 2: break
			for card in small_cards:
				if not used.has(str(card.get("id", ""))): mixed.append(card)
				if mixed.size() == 3: break
		var sizes := {}
		for card in mixed: sizes[str(card.get("size", ""))] = true
		if mixed.size() == 3 and sizes.size() == 2:
			groups.append({"kind": "mixed", "label": "同值大小", "cards": mixed})
			for card in mixed: used[str(card.get("id", ""))] = true
	for code in by_code.keys():
		var same: Array = by_code[code]
		var pair: Array = []
		for card in same:
			if not used.has(str(card.get("id", ""))): pair.append(card)
		if pair.size() >= 2:
			groups.append({"kind": "pair", "label": "对子", "cards": pair.slice(0, 2)})
			for card in pair.slice(0, 2): used[str(card.get("id", ""))] = true
	for value in range(1, 11):
		var small_card: Dictionary = {}
		var big_card: Dictionary = {}
		for card in Array(by_code.get("small_%d" % value, [])):
			if not used.has(str(card.get("id", ""))):
				small_card = card
				break
		for card in Array(by_code.get("big_%d" % value, [])):
			if not used.has(str(card.get("id", ""))):
				big_card = card
				break
		if not small_card.is_empty() and not big_card.is_empty():
			groups.append({"kind": "near", "label": "大小搭", "cards": [small_card, big_card]})
			used[str(small_card.get("id", ""))] = true
			used[str(big_card.get("id", ""))] = true
	for card in remaining:
		if not used.has(str(card.get("id", ""))):
			groups.append({"kind": "single", "label": "", "cards": [card]})
	return groups

func debug_validate_hand_groups() -> bool:
	var cards: Array = []
	for value in [1, 2, 3, 4]: cards.append({"id": "s%d" % value, "value": value, "size": "small"})
	cards.append({"id": "b7", "value": 7, "size": "big"})
	cards.append({"id": "s10", "value": 10, "size": "small"})
	var groups := _hand_groups(cards)
	var sequence_count := 0
	var sequence_cards := 0
	var special_count := 0
	var singles := 0
	for group in groups:
		if str(group.get("kind", "")) == "sequence":
			sequence_count += 1
			sequence_cards = Array(group.get("cards", [])).size()
		if str(group.get("kind", "")) == "special": special_count += 1
		if str(group.get("kind", "")) == "single": singles += Array(group.get("cards", [])).size()
	return sequence_count == 1 and sequence_cards == 3 and special_count == 0 and singles == 3

func debug_validate_near_hand_groups() -> bool:
	var cards: Array = [
		{"id": "s3", "value": 3, "size": "small"},
		{"id": "s5", "value": 5, "size": "small"},
		{"id": "s8", "value": 8, "size": "small"},
		{"id": "b5", "value": 5, "size": "big"},
		{"id": "b9", "value": 9, "size": "big"},
	]
	var groups := _hand_groups(cards)
	var near_cards: Array = []
	var single_count := 0
	for group in groups:
		if str(group.get("kind", "")) == "near":
			near_cards = Array(group.get("cards", []))
		elif str(group.get("kind", "")) == "single":
			single_count += Array(group.get("cards", [])).size()
	var near_ids := near_cards.map(func(card: Dictionary) -> String: return str(card.get("id", "")))
	return near_ids.has("s5") and near_ids.has("b5") and near_cards.size() == 2 and single_count == 3

func debug_validate_manual_hand_group_split() -> bool:
	var cards: Array = [
		{"id": "s1", "value": 1, "size": "small"},
		{"id": "s2", "value": 2, "size": "small"},
		{"id": "s3", "value": 3, "size": "small"},
		{"id": "b5", "value": 5, "size": "big"},
	]
	var groups := _manual_hand_groups(cards, [["s1", "b5"], ["s2", "s3"]])
	return groups.size() == 2 and Array(groups[0].get("cards", [])).size() == 2 and str(Dictionary(Array(groups[0].get("cards", []))[1]).get("id", "")) == "b5" and Array(groups[1].get("cards", [])).size() == 2

func debug_validate_free_hand_column_drop() -> bool:
	var columns: Array = [["a"], ["b", "c"], ["d"]]
	var stacked := _columns_after_drop(columns, "a", {"mode": "stack", "column": 0, "row": 1})
	var stack_ok := stacked.size() == 2 and Array(stacked[0]) == ["b", "a", "c"] and Array(stacked[1]) == ["d"]
	var detached := _columns_after_drop(stacked, "a", {"mode": "new", "column": 1, "row": 0})
	return stack_ok and detached.size() == 3 and Array(detached[0]) == ["b", "c"] and Array(detached[1]) == ["a"] and Array(detached[2]) == ["d"]

func debug_validate_free_hand_column_anchor() -> bool:
	var area := Control.new()
	area.size = Vector2(300, 180)
	var groups: Array = [{
		"kind": "free",
		"cards": [
			{"id": "anchor-a"},
			{"id": "anchor-b"},
			{"id": "anchor-c"},
			{"id": "anchor-d"},
		],
	}]
	var positions := _hand_group_positions_by_id(groups, area, 50.0, 54.0)
	var bottom := Vector2(positions["anchor-d"]).y
	var expected_bottom := area.size.y - 54.0 - 2.0
	var top := Vector2(positions["anchor-a"]).y
	area.free()
	return is_equal_approx(bottom, expected_bottom) and top < bottom

func debug_validate_hand_arrangement_mode() -> bool:
	var previous_mode := str(AppState.settings.get("hand_arrangement_mode", "group"))
	var previous_sort := bool(AppState.settings.get("auto_sort_hand", true))
	var cards: Array = [
		{"id": "s3", "value": 3, "size": "small"},
		{"id": "s2", "value": 2, "size": "small"},
		{"id": "s1", "value": 1, "size": "small"},
		{"id": "b2", "value": 2, "size": "big"},
	]
	AppState.settings["hand_arrangement_mode"] = "free"
	AppState.settings["auto_sort_hand"] = false
	var grouped := _display_hand_groups(cards)
	AppState.settings["hand_arrangement_mode"] = previous_mode
	AppState.settings["auto_sort_hand"] = previous_sort
	return _hand_arrangement_mode() == "group" and not grouped.is_empty() and grouped[0].get("kind", "") == "sequence"

func debug_validate_response_context() -> bool:
	var response_state := {
		"phase": "response_collecting",
		"discardPile": {"lastDiscard": {"rank": "叁", "size": "big"}, "lastDiscardPlayerIndex": 2},
	}
	var draw_response := response_state.duplicate(true)
	draw_response["pendingCardSource"] = "draw"
	return _response_context_text(response_state) == "响应 玩家2 打出 大3" \
		and _response_context_text(draw_response) == "响应 玩家2 翻牌 大3" \
		and _response_context_text({"phase": "drawing"}).is_empty()

func _latest_decision_trace() -> Dictionary:
	return Dictionary(AIService.latest_decision.get("trace", {})) if not AIService.latest_decision.is_empty() else {}

func _decision_policy_label(trace: Dictionary) -> String:
	var source := str(trace.get("policySource", ""))
	if source == "learned":
		return "原版强化策略"
	if source == "local-rule-conditioned-heuristic" or source == "heuristic":
		return "规则条件化"
	if source == "fallback" or bool(Dictionary(trace.get("legal", {})).get("fallbackApplied", false)):
		return "安全降级"
	return "等待 AI 决策" if trace.is_empty() else "规则分析"

func _decision_fallback_text(reason: String) -> String:
	return {
		"learned_runtime_failed": "原版强化策略不可用，已使用规则分析继续对局。",
		"learned_illegal_action": "原版强化策略结果与当前规则不匹配，已使用规则分析继续对局。",
		"learned_policy_fallback": "当前局面由规则分析接管，已选择当前合法动作。",
		"illegal_analysis_candidate": "候选与当前规则不匹配，已改用合法动作。",
	}.get(reason, "策略已回退到当前规则允许的动作。")

func debug_validate_decision_policy_labels() -> bool:
	return _decision_policy_label({"policySource": "learned"}) == "原版强化策略" \
		and _decision_policy_label({"policySource": "local-rule-conditioned-heuristic"}) == "规则条件化" \
		and _decision_policy_label({"policySource": "fallback", "legal": {"fallbackApplied": true}}) == "安全降级" \
		and _decision_fallback_text("learned_runtime_failed").contains("规则分析") \
		and _decision_fallback_text("learned_illegal_action").contains("不匹配") \
		and _decision_fallback_text("learned_policy_fallback").contains("规则分析")

func _decision_option_metric(option: Dictionary) -> String:
	if option.has("predictedWinRate") or option.has("winRate"):
		var win_rate := float(option.get("predictedWinRate", option.get("winRate", 0.0)))
		var expected: Variant = option.get("predictedExpectedScore", option.get("expectedScore", null))
		var text := "胜率 %.0f%%" % (win_rate * 100.0)
		if expected != null:
			text += " · 期望分 %.1f" % float(expected)
		return text
	if option.has("priority"):
		return "优先级 %.1f" % float(option.get("priority", 0.0))
	if option.has("score"):
		return "启发式 %.1f" % float(option.get("score", 0.0))
	return "规则优先"

func _tutor_dimension_text(dimension: Dictionary) -> String:
	var parts: Array[String] = []
	var diagnosis := str(dimension.get("diagnosis", ""))
	if not diagnosis.is_empty():
		parts.append(diagnosis)
	var bullets: Array = dimension.get("bullets", [])
	for raw_bullet in bullets.slice(0, 2):
		var bullet := str(raw_bullet)
		if not bullet.is_empty():
			parts.append("· " + bullet)
	return "\n".join(parts)

func debug_validate_decision_option_metrics() -> bool:
	return _decision_option_metric({"predictedWinRate": 0.42, "predictedExpectedScore": 8.5}) == "胜率 42% · 期望分 8.5" \
		and _decision_option_metric({"priority": 7.25}) == "优先级 7.3" \
		and _decision_option_metric({"score": 3.0}) == "启发式 3.0"

func debug_validate_tutor_dimension_formatting() -> bool:
	return _tutor_dimension_text({"diagnosis": "保持结构稳定。", "bullets": ["有效进张 4 张", "保留对子", "忽略此条"]}) == "保持结构稳定。\n· 有效进张 4 张\n· 保留对子" \
		and _tutor_dimension_text({}).is_empty()

func debug_validate_trace_card_formatting() -> bool:
	return _trace_cards_text(["S6", "B10"]) == "小6 大10" \
		and _trace_cards_text([{ "rank": "叁", "size": "big", "value": 3 }]) == "3" \
		and _trace_cards_text(["unknown"]) == "unknown"

func _phase_text(phase: String) -> String:
	return {"bao_selection": "爆牌选择", "drawing": "摸牌", "discarding": "出牌", "response_collecting": "响应", "ended": "本局结束"}.get(phase, phase)

func _action_text(action: String) -> String:
	return {"start": "开局", "draw": "摸牌", "discard": "出牌", "chi": "吃", "peng": "碰", "zhao": "招", "hu": "胡", "pass": "过", "bao": "爆", "pass_bao": "不爆"}.get(action, action)

func _win_type_text(win_type: String) -> String:
	return {
		"self_draw": "自摸",
		"discard": "点胡",
		"draw": "摸牌胡",
		"response": "响应胡",
		"bao": "爆牌",
	}.get(win_type, win_type)

func _action_label(action: Dictionary) -> String:
	var label := _action_text(str(action.get("type", "")))
	if action.get("isMandatory", false):
		return label + " · 必须"
	return label

func _meld_text(meld_type: String) -> String:
	return {
		"pair": "对", "sequence": "顺", "mixed_sequence": "二七十", "special_2710": "二七十",
		"triple": "坎", "quadruple": "提", "draw_quadruple": "招",
		"mixed_size": "同值大小",
		"peng": "碰", "chi": "吃", "zhao": "招", "wei": "偎"
	}.get(meld_type, meld_type)

func _cards_text(cards: Array) -> String:
	var labels: Array[String] = []
	for raw_card in cards:
		labels.append(_card_text(raw_card))
	return " ".join(labels)

# Core policy traces use compact card codes (for example S6/B10), while the
# local heuristic stores full card objects. Keep trace rendering compatible
# without changing the regular table-card display path.
func _trace_cards_text(cards: Array) -> String:
	var labels: Array[String] = []
	for raw_card in cards:
		var label := _trace_card_text(raw_card)
		if not label.is_empty():
			labels.append(label)
	return " ".join(labels)

func _trace_card_text(raw_card: Variant) -> String:
	if typeof(raw_card) == TYPE_DICTIONARY:
		return _card_text(raw_card)
	if typeof(raw_card) != TYPE_STRING:
		return ""
	var code := str(raw_card).strip_edges()
	if code.length() >= 2 and code.substr(0, 1) in ["S", "B"] and code.substr(1).is_valid_int():
		return ("小" if code.begins_with("S") else "大") + code.substr(1)
	return code

func _recent_action_text(state: Dictionary) -> String:
	if AIService.recent_actions.is_empty():
		return "等待第一步动作"
	var players: Array = state.get("players", [])
	var names := {}
	for index in players.size():
		names[str(Dictionary(players[index]).get("playerId", ""))] = "你" if index == 0 else "玩家%d" % index
	var lines: Array[String] = []
	for raw in AIService.recent_actions:
		var record: Dictionary = raw
		var action: Dictionary = record.get("action", {})
		var cards: Array = action.get("cards", [])
		var actor := str(names.get(str(record.get("playerId", "")), "玩家"))
		var detail := _cards_text(cards)
		lines.append("%s %s%s" % [actor, _action_text(str(action.get("type", ""))), (" " + detail) if not detail.is_empty() else ""])
	return "  ·  ".join(lines)

func _card_art(card: Dictionary, dimensions: Vector2, _clear_center_face: bool = false) -> Control:
	var root := Control.new()
	root.custom_minimum_size = dimensions
	root.size = dimensions
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var texture := TextureRect.new()
	texture.texture = load(CardAssets.texture_path(card))
	texture.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	texture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	texture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	texture.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(texture)
	return root

func _card_face_text(card: Dictionary) -> String:
	var value := int(card.get("value", 0))
	if value > 0:
		return str(value)
	return str(card.get("rank", ""))

func _apply_card_font(label: Label) -> void:
	if card_brush_font != null:
		label.add_theme_font_override("font", card_brush_font)

func _selected_ai_mode() -> String:
	return str(AppState.settings.get("ai_mode", "medium"))

func _selected_opponent_ai_mode() -> String:
	return str(AppState.settings.get("opponent_ai_mode", "heuristic"))

func _opponent_ai_name(mode: String) -> String:
	return {"heuristic": "规则条件化", "learned": "原版强化"}.get(mode, mode)

func _opponent_ai_label() -> String:
	return _opponent_ai_name(_selected_opponent_ai_mode())

func _set_opponent_ai_mode(mode: String) -> void:
	if not ["heuristic", "learned"].has(mode):
		return
	AppState.settings["opponent_ai_mode"] = mode
	AppState.save_settings()
	AIService.use_rule_heuristic = mode == "heuristic"
	if is_instance_valid(toast):
		_show_toast("对手策略已切换为“%s”。" % _opponent_ai_name(mode))
	if is_instance_valid(content):
		show_settings()

func debug_validate_opponent_ai_mode() -> bool:
	var previous := str(AppState.settings.get("opponent_ai_mode", "heuristic"))
	AppState.settings["opponent_ai_mode"] = "heuristic"
	var heuristic_ok := _opponent_ai_label() == "规则条件化" and AIService.use_rule_heuristic
	AppState.settings["opponent_ai_mode"] = "learned"
	AIService.use_rule_heuristic = false
	var learned_ok := _opponent_ai_label() == "原版强化" and not AIService.use_rule_heuristic
	AppState.settings["opponent_ai_mode"] = previous
	AIService.use_rule_heuristic = previous != "learned"
	return heuristic_ok and learned_ok

func debug_validate_runtime_policy_mode() -> bool:
	var previous := str(AppState.settings.get("opponent_ai_mode", "heuristic"))
	_set_opponent_ai_mode("learned")
	var learned_ok := AIService.debug_runtime_policy_mode() == "learned"
	_set_opponent_ai_mode("heuristic")
	var heuristic_ok := AIService.debug_runtime_policy_mode() == "heuristic"
	AppState.settings["opponent_ai_mode"] = previous
	AIService.use_rule_heuristic = previous != "learned"
	return learned_ok and heuristic_ok

func _ai_mode_name(mode: String) -> String:
	return {"fast": "稳定通用", "medium": "平衡分析", "learned": "原版强化"}.get(mode, mode)

func _ai_mode_label() -> String:
	return _ai_mode_name(_selected_ai_mode())

func _set_ai_mode(mode: String) -> void:
	AppState.settings["ai_mode"] = mode
	AppState.save_settings()
	_show_toast("AI 策略已切换为“%s”。" % _ai_mode_name(mode))
	show_settings()

func _card_text(raw: Variant) -> String:
	if typeof(raw) != TYPE_DICTIONARY: return ""
	var card: Dictionary = raw
	if card.is_empty(): return ""
	# The card face uses the numeric value only. Size remains a rule/data field,
	# while red/black color and the grouped layout provide visual distinction.
	var value := int(card.get("value", 0))
	if value > 0:
		return str(value)
	var rank := str(card.get("rank", ""))
	return {"一": "1", "壹": "1", "二": "2", "贰": "2", "三": "3", "叁": "3", "四": "4", "肆": "4", "五": "5", "伍": "5", "六": "6", "陆": "6", "七": "7", "柒": "7", "八": "8", "捌": "8", "九": "9", "玖": "9", "十": "10", "拾": "10"}.get(rank, rank)

func _card_size_text(raw: Variant) -> String:
	var value := _card_text(raw)
	if value.is_empty() or typeof(raw) != TYPE_DICTIONARY:
		return value
	var card: Dictionary = raw
	return ("大" if str(card.get("size", "")) == "big" else "小") + value

func _is_red(raw: Variant) -> bool:
	return typeof(raw) == TYPE_DICTIONARY and Dictionary(raw).get("isRed", Dictionary(raw).get("is_red", false)) == true

func _nav_button(text: String, target: String) -> Button:
	var button := Button.new()
	button.text = text
	button.flat = true
	button.add_theme_font_size_override("font_size", 15)
	button.add_theme_color_override("font_color", INK)
	button.pressed.connect(func(): _navigate(target))
	return button

func _command_button(text: String, callback: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size = Vector2(108, 38)
	button.add_theme_font_size_override("font_size", 16)
	button.add_theme_color_override("font_color", INK)
	button.add_theme_stylebox_override("normal", _box(GOLD, 4, 6))
	button.add_theme_stylebox_override("hover", _box(Color("f5cd77"), 4, 6))
	button.pressed.connect(callback)
	return button

func _quiet_button(text: String, callback: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size = Vector2(92, 36)
	button.add_theme_font_size_override("font_size", 15)
	button.add_theme_color_override("font_color", INK)
	button.add_theme_stylebox_override("normal", _box(PAPER_DIM, 4, 5, Color("b7a27d"), 1))
	button.add_theme_stylebox_override("hover", _box(PAPER, 4, 5, GOLD, 1))
	button.pressed.connect(callback)
	return button

func _setting_text(label_text: String, value: String) -> Control:
	var row := HBoxContainer.new()
	var label := Label.new()
	label.text = label_text
	label.custom_minimum_size.x = 140
	label.add_theme_color_override("font_color", INK)
	row.add_child(label)
	var detail := Label.new()
	detail.text = value
	detail.add_theme_color_override("font_color", Color("675d4f"))
	row.add_child(detail)
	return row

func _spacer() -> Control:
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return spacer

func _box(color: Color, radius: int, padding: int, border: Color = Color.TRANSPARENT, width: int = 0) -> StyleBoxFlat:
	var box := StyleBoxFlat.new()
	box.bg_color = color
	box.corner_radius_top_left = radius
	box.corner_radius_top_right = radius
	box.corner_radius_bottom_left = radius
	box.corner_radius_bottom_right = radius
	box.border_color = border
	box.border_width_left = width
	box.border_width_right = width
	box.border_width_top = width
	box.border_width_bottom = width
	box.content_margin_left = padding
	box.content_margin_right = padding
	box.content_margin_top = padding
	box.content_margin_bottom = padding
	return box

func _show_toast(message: String, seconds: float = 2.5) -> void:
	if not is_instance_valid(toast):
		return
	toast.text = message
	toast.visible = true
	await get_tree().create_timer(seconds).timeout
	toast.visible = false
