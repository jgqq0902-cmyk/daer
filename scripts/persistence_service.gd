extends Node

func save_json(file_name: String, value: Variant) -> bool:
    var file := FileAccess.open("user://" + file_name, FileAccess.WRITE)
    if file == null:
        push_error("无法写入用户数据: " + file_name)
        return false
    file.store_string(JSON.stringify(value, "  "))
    return true

func load_json(file_name: String, fallback: Variant) -> Variant:
    if not FileAccess.file_exists("user://" + file_name):
        return fallback
    var file := FileAccess.open("user://" + file_name, FileAccess.READ)
    if file == null:
        return fallback
    var parsed = JSON.parse_string(file.get_as_text())
    return parsed if parsed != null and typeof(parsed) == typeof(fallback) else fallback

func debug_validate_replay_id(replay_id: String) -> bool:
    if replay_id.is_empty() or replay_id.length() > 64:
        return false
    var pattern := RegEx.new()
    pattern.compile("^[A-Za-z0-9_-]{1,64}$")
    return pattern.search(replay_id) != null

func debug_validate_replay_file_name(file_name: String) -> bool:
    if not file_name.begins_with("replay_") or not file_name.ends_with(".json"):
        return false
    var replay_id := file_name.substr(7, file_name.length() - 12)
    return debug_validate_replay_id(replay_id)

func _safe_replay_path(file_name: String) -> String:
    if not debug_validate_replay_file_name(file_name):
        return ""
    var root := ProjectSettings.globalize_path("user://replays").simplify_path()
    var candidate := ProjectSettings.globalize_path("user://replays/" + file_name).simplify_path()
    if candidate.get_base_dir() != root:
        return ""
    return "replays/" + file_name

func save_replay(replay: Dictionary, replay_id: String = "") -> String:
    DirAccess.make_dir_recursive_absolute("user://replays")
    var id := replay_id if not replay_id.is_empty() else str(Time.get_ticks_msec())
    if not debug_validate_replay_id(id):
        return ""
    var file_name := "replay_%s.json" % id
    var safe_path := _safe_replay_path(file_name)
    if safe_path.is_empty() or not save_json(safe_path, replay):
        return ""
    return file_name

func list_replays(limit: int = 8) -> Array[Dictionary]:
    var directory := DirAccess.open("user://replays")
    if directory == null:
        return []
    var items: Array[Dictionary] = []
    for file_name in directory.get_files():
        if not file_name.begins_with("replay_") or not file_name.ends_with(".json"):
            continue
        if not debug_validate_replay_file_name(file_name):
            continue
        var path := "user://replays/" + file_name
        items.append({"file_name": file_name, "modified": FileAccess.get_modified_time(path)})
    items.sort_custom(func(left: Dictionary, right: Dictionary) -> bool: return int(left.modified) > int(right.modified))
    return items.slice(0, limit)

func load_replay(file_name: String) -> Dictionary:
    var safe_path := _safe_replay_path(file_name)
    if safe_path.is_empty() or not FileAccess.file_exists("user://" + safe_path):
        return {}
    var replay = load_json(safe_path, {})
    return replay if typeof(replay) == TYPE_DICTIONARY else {}
