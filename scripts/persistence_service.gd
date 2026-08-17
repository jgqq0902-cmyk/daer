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

func save_replay(replay: Dictionary, replay_id: String = "") -> String:
    DirAccess.make_dir_recursive_absolute("user://replays")
    var id := replay_id if not replay_id.is_empty() else str(Time.get_ticks_msec())
    save_json("replays/replay_%s.json" % id, replay)
    return "replay_%s.json" % id

func list_replays(limit: int = 8) -> Array[Dictionary]:
    var directory := DirAccess.open("user://replays")
    if directory == null:
        return []
    var items: Array[Dictionary] = []
    for file_name in directory.get_files():
        if not file_name.begins_with("replay_") or not file_name.ends_with(".json"):
            continue
        var path := "user://replays/" + file_name
        items.append({"file_name": file_name, "modified": FileAccess.get_modified_time(path)})
    items.sort_custom(func(left: Dictionary, right: Dictionary) -> bool: return int(left.modified) > int(right.modified))
    return items.slice(0, limit)

func load_replay(file_name: String) -> Dictionary:
    var replay = load_json("replays/" + file_name, {})
    return replay if typeof(replay) == TYPE_DICTIONARY else {}
