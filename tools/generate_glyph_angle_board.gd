extends SceneTree

const SOURCE_DIR := "res://docs/svg/chars_svg"
const OUTPUT_DIR := "res://docs/svg/glyph_calibration"
const GLYPHS := [
	["一", "lower_row2_00_一.svg"], ["二", "lower_row2_01_二.svg"], ["三", "lower_row2_02_三.svg"], ["四", "lower_row2_03_四.svg"], ["五", "lower_row2_04_五.svg"],
	["六", "lower_row1_00_六.svg"], ["七", "lower_row1_01_七.svg"], ["八", "lower_row1_02_八.svg"], ["九", "lower_row1_03_九.svg"], ["十", "lower_row1_04_十.svg"],
	["壹", "upper_row2_04_壹.svg"], ["贰", "upper_row2_03_贰.svg"], ["叁", "upper_row2_02_叁.svg"], ["肆", "upper_row2_01_肆.svg"], ["伍", "upper_row2_00_伍.svg"],
	["陆", "upper_row1_04_陆.svg"], ["柒", "upper_row1_03_柒.svg"], ["捌", "upper_row1_02_捌.svg"], ["玖", "upper_row1_01_玖.svg"], ["拾", "upper_row1_00_拾.svg"],
]
# Positive angles rotate clockwise on this y-down SVG canvas.
const ROTATIONS := {
	"壹": -22, "贰": -7, "叁": 15, "肆": 20, "伍": 28, "陆": -22, "柒": -27, "捌": 10, "玖": 5, "拾": 25,
	"一": 0, "二": 0, "三": 10, "四": -22, "五": -37, "六": 7, "七": 42, "八": 7, "九": 0, "十": -42,
}
const BOARD_WIDTH := 1200
const CELL_WIDTH := 240
const CELL_HEIGHT := 250
const BOARD_HEIGHT := 1080

func _init() -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUTPUT_DIR))
	var cells := ""
	for index in GLYPHS.size():
		var row := index / 5
		var column := index % 5
		cells += _cell(GLYPHS[index][0], GLYPHS[index][1], column * CELL_WIDTH, row * CELL_HEIGHT, ROTATIONS[GLYPHS[index][0]])
	var svg := '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d"><rect width="100%%" height="100%%" fill="#173d2a"/>%s</svg>' % [BOARD_WIDTH, BOARD_HEIGHT, BOARD_WIDTH, BOARD_HEIGHT, cells]
	var image := Image.new()
	var error := image.load_svg_from_string(svg, 1.0)
	if error != OK:
		push_error("Could not render angle board: " + str(error))
		quit(1)
		return
	image.save_png(OUTPUT_DIR.path_join("glyph_angle_board.png"))
	FileAccess.open(OUTPUT_DIR.path_join("glyph_angle_board.svg"), FileAccess.WRITE).store_string(svg)
	quit()

func _cell(label: String, file_name: String, x: int, y: int, rotation: int) -> String:
	var source := FileAccess.get_file_as_string(SOURCE_DIR.path_join(file_name))
	var view_box := _attribute(source, "viewBox")
	var parts := view_box.split(" ", false)
	var view_width := float(parts[2])
	var view_height := float(parts[3])
	var path_start := source.find("<path")
	var path_end := source.rfind("</svg>")
	var paths := source.substr(path_start, path_end - path_start)
	if label == "柒":
		# The extracted source has an isolated lower-left dot as its first
		# subpath. Drop only that subpath and retain the connected character.
		var next_subpath := paths.find(" M122")
		var style_start := paths.find('" fill')
		if next_subpath > 0 and style_start > next_subpath:
			var body := paths.substr(next_subpath + 1, style_start - next_subpath - 1)
			paths = '<path d="' + body + '" fill="black" fill-rule="evenodd" stroke="none"/>'
	var cx := x + CELL_WIDTH * 0.5
	var cy := y + 135.0
	var scale := minf(150.0 / view_width, 150.0 / view_height)
	var tx := cx - view_width * scale * 0.5
	var ty := cy - view_height * scale * 0.5
	var marks := '<circle cx="%f" cy="%f" r="102" fill="none" stroke="#c6b48f" stroke-width="2"/><circle cx="%f" cy="%f" r="92" fill="none" stroke="#d6b55b" stroke-width="1" opacity="0.8"/>' % [cx, cy, cx, cy]
	for angle in range(-45, 46, 5):
		# 0 degrees is straight up; positive is clockwise.
		var radians := deg_to_rad(float(angle))
		var inner_radius := 92.0 if angle % 15 == 0 else 96.0
		var outer_radius := 106.0 if angle % 15 == 0 else 102.0
		var x1 := cx + sin(radians) * inner_radius
		var y1 := cy - cos(radians) * inner_radius
		var x2 := cx + sin(radians) * outer_radius
		var y2 := cy - cos(radians) * outer_radius
		var color := "#b3261e" if angle == 0 else "#d6b55b"
		var width := 2 if angle == 0 else 1
		marks += '<line x1="%f" y1="%f" x2="%f" y2="%f" stroke="%s" stroke-width="%d"/>' % [x1, y1, x2, y2, color, width]
		if angle % 15 == 0:
			marks += '<text x="%f" y="%f" fill="#342b20" font-family="sans-serif" font-size="10" text-anchor="middle">%d</text>' % [cx + sin(radians) * 116.0, cy - cos(radians) * 116.0 + 3.0, angle]
	return '<rect x="%d" y="%d" width="%d" height="%d" rx="8" fill="#f7f2de" stroke="#c6b48f" stroke-width="2"/><text x="%f" y="%d" fill="#342b20" font-family="sans-serif" font-size="20" text-anchor="middle">%s  %s°</text><line x1="%f" y1="%f" x2="%f" y2="%f" stroke="#6da78b" stroke-width="1"/>%s<g transform="translate(%f %f) scale(%f) rotate(%d %f %f)">%s</g>' % [x, y, CELL_WIDTH, CELL_HEIGHT, cx, y + 25, label, "+" + str(rotation) if rotation > 0 else str(rotation), cx - 105.0, cy, cx + 105.0, cy, marks, tx, ty, scale, rotation, view_width * 0.5, view_height * 0.5, paths]

func _attribute(svg: String, name: String) -> String:
	var pattern := RegEx.new()
	pattern.compile(name + '="([^"]+)"')
	var match := pattern.search(svg)
	return match.get_string(1) if match else ""
