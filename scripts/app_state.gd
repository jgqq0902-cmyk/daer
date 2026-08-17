extends Node

signal settings_changed
signal stats_changed

var settings := {
    "player_count": 3, "bottom_card_count": 2, "initial_score": 100,
    "auto_sort_hand": true, "hand_arrangement_mode": "group", "hand_layouts": {}, "show_ai_advice": true, "theme": "dark", "ai_mode": "medium", "opponent_ai_mode": "heuristic",
    "ming_tang": {"qia": true, "luan": true, "hong": true, "hei": true, "tian_hu": true, "zi_mo": true}
}
var stats := {"total_games": 0, "wins": 0, "losses": 0, "total_score": 0, "best_score": 0, "total_turns": 0, "streak": 0}
var review_count := 2

func _ready() -> void:
    settings = PersistenceService.load_json("settings.json", settings)
    # 兼容旧设置文件：Godot 版固定使用三人局。
    settings["player_count"] = 3
    if not ["fast", "medium", "learned"].has(str(settings.get("ai_mode", "medium"))):
        settings["ai_mode"] = "medium"
    if not ["heuristic", "learned"].has(str(settings.get("opponent_ai_mode", "heuristic"))):
        settings["opponent_ai_mode"] = "heuristic"
    # Historical flat layout modes migrate to grouped columns. hand_layouts
    # accepts legacy ID arrays and version-2 column layouts for free stacking.
    settings["hand_arrangement_mode"] = "group"
    settings["auto_sort_hand"] = true
    if typeof(settings.get("hand_layouts", {})) != TYPE_DICTIONARY:
        settings["hand_layouts"] = {}
    stats = PersistenceService.load_json("stats.json", stats)

func save_settings() -> void:
    PersistenceService.save_json("settings.json", settings)
    settings_changed.emit()

func save_stats() -> void:
    PersistenceService.save_json("stats.json", stats)
    stats_changed.emit()
