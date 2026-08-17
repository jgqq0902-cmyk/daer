extends SceneTree

const SOURCE_DIR := "res://docs/svg/chars_svg"
const OUTPUT_DIR := "res://docs/svg/glyph_calibration"
const ANGLES := [-6, -3, 0, 3, 6]
const GLYPHS := {
	"一": "lower_row2_00_一.svg", "二": "lower_row2_01_二.svg", "三": "lower_row2_02_三.svg", "四": "lower_row2_03_四.svg", "五": "lower_row2_04_五.svg",
	"六": "lower_row1_00_六.svg", "七": "lower_row1_01_七.svg", "八": "lower_row1_02_八.svg", "九": "lower_row1_03_九.svg", "十": "lower_row1_04_十.svg",
	"壹": "upper_row2_04_壹.svg", "贰": "upper_row2_03_贰.svg", "叁": "upper_row2_02_叁.svg", "肆": "upper_row2_01_肆.svg", "伍": "upper_row2_00_伍.svg",
	"陆": "upper_row1_04_陆.svg", "柒": "upper_row1_03_柒.svg", "捌": "upper_row1_02_捌.svg", "玖": "upper_row1_01_玖.svg", "拾": "upper_row1_00_拾.svg",
}

func _init() -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUTPUT_DIR))
	for glyph in GLYPHS:
		_write_candidates(glyph, GLYPHS[glyph])
	quit()

func _write_candidates(glyph: String, file_name: String) -> void:
	var source := FileAccess.get_file_as_string(SOURCE_DIR.path_join(file_name))
	var view_box := _attribute(source, "viewBox")
	var parts := view_box.split(" ", false)
	if parts.size() != 4:
		push_error("Missing viewBox: " + file_name)
		return
	var view_width := float(parts[2])
	var view_height := float(parts[3])
	var path_start := source.find("<path")
	var path_end := source.rfind("</svg>")
	var paths := source.substr(path_start, path_end - path_start)
	var cells := ""
	for index in ANGLES.size():
		var angle: int = ANGLES[index]
		var cell_x := index * 220
		cells += '<rect x="%d" y="0" width="220" height="260" fill="#f7f2de" stroke="#c6b48f" stroke-width="2"/>' % cell_x
		cells += '<text x="%d" y="24" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#3a3024">%s %d°</text>' % [cell_x + 110, glyph, angle]
		var scale := minf(180.0 / view_width, 180.0 / view_height)
		var tx := cell_x + 110.0 - view_width * scale * 0.5
		var ty := 145.0 - view_height * scale * 0.5
		cells += '<g transform="translate(%f %f) scale(%f) rotate(%d %f %f)">%s</g>' % [tx, ty + 38.0, scale, angle, view_width * 0.5, view_height * 0.5, paths]
	var document := '<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="260" viewBox="0 0 1100 260">%s</svg>' % cells
	var image := Image.new()
	var error := image.load_svg_from_string(document, 1.0)
	if error != OK:
		push_error("Could not rasterize: " + file_name)
		return
	image.save_png(OUTPUT_DIR.path_join(glyph + "_candidates.png"))

func _attribute(svg: String, name: String) -> String:
	var pattern := RegEx.new()
	pattern.compile(name + '="([^"]+)"')
	var match := pattern.search(svg)
	return match.get_string(1) if match else ""
