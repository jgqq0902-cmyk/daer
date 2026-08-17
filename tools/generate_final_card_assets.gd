extends SceneTree

const SOURCE_DIR := "res://docs/svg/chars_svg"
const OUTPUT_DIR := "res://assets/cards"
const SMALL := [["一", "lower_row2_00_一.svg"], ["二", "lower_row2_01_二.svg"], ["三", "lower_row2_02_三.svg"], ["四", "lower_row2_03_四.svg"], ["五", "lower_row2_04_五.svg"], ["六", "lower_row1_00_六.svg"], ["七", "lower_row1_01_七.svg"], ["八", "lower_row1_02_八.svg"], ["九", "lower_row1_03_九.svg"], ["十", "lower_row1_04_十.svg"]]
const BIG := [["壹", "upper_row2_04_壹.svg"], ["贰", "upper_row2_03_贰.svg"], ["叁", "upper_row2_02_叁.svg"], ["肆", "upper_row2_01_肆.svg"], ["伍", "upper_row2_00_伍.svg"], ["陆", "upper_row1_04_陆.svg"], ["柒", "upper_row1_03_柒.svg"], ["捌", "upper_row1_02_捌.svg"], ["玖", "upper_row1_01_玖.svg"], ["拾", "upper_row1_00_拾.svg"]]
const ROTATIONS := {"壹": -22, "贰": -7, "叁": 15, "肆": 20, "伍": 28, "陆": -22, "柒": -27, "捌": 10, "玖": 5, "拾": 25, "一": 0, "二": 0, "三": 10, "四": -22, "五": -37, "六": 7, "七": 42, "八": 7, "九": 0, "十": -42}
const W := 180
const H := 720
const CENTER_X := 90.0
const TOP_CENTER_Y := 88.0
const BOTTOM_CENTER_Y := 632.0

func _init() -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUTPUT_DIR))
	for entry in SMALL.size():
		_make_card("small", entry, SMALL[entry][0], SMALL[entry][1])
		_make_card("big", entry, BIG[entry][0], BIG[entry][1])
	quit()

func _make_card(prefix: String, index: int, label: String, file_name: String) -> void:
	var source := FileAccess.get_file_as_string(SOURCE_DIR.path_join(file_name))
	var view_box := _attribute(source, "viewBox").split(" ", false)
	var vw := float(view_box[2])
	var vh := float(view_box[3])
	var start := source.find("<path")
	var end := source.rfind("</svg>")
	var paths := source.substr(start, end - start)
	if label == "柒":
		var next_subpath := paths.find(" M122")
		var style_start := paths.find('" fill')
		if next_subpath > 0 and style_start > next_subpath:
			paths = '<path d="' + paths.substr(next_subpath + 1, style_start - next_subpath - 1) + '" fill="black" fill-rule="evenodd" stroke="none"/>'
	var scale := minf(150.0 / vw, 150.0 / vh)
	var transform := "translate(%f %f) scale(%f) rotate(%d %f %f)" % [CENTER_X - vw * scale * 0.5, TOP_CENTER_Y - vh * scale * 0.5, scale, ROTATIONS[label], vw * 0.5, vh * 0.5]
	var bottom_transform := "translate(%f %f) scale(%f) rotate(%d %f %f)" % [CENTER_X - vw * scale * 0.5, BOTTOM_CENTER_Y - vh * scale * 0.5, scale, 180 + ROTATIONS[label], vw * 0.5, vh * 0.5]
	var ink := "#b3261e" if int(index + 1) in [2, 7, 10] else "#14110d"
	paths = paths.replace('fill="black"', 'fill="%s"' % ink)
	var svg := '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="720" viewBox="0 0 180 720"><rect width="180" height="720" rx="9" fill="#f7f2de"/><rect x="3" y="3" width="174" height="714" rx="7" fill="none" stroke="#c6b48f" stroke-width="2"/><rect x="10" y="10" width="160" height="700" rx="5" fill="none" stroke="#e4d6b5"/><g fill="%s" transform="%s">%s</g><g fill="%s" transform="%s">%s</g></svg>' % [ink, transform, paths, ink, bottom_transform, paths]
	var file_base := "%s_%02d" % [prefix, index + 1]
	FileAccess.open(OUTPUT_DIR.path_join(file_base + ".svg"), FileAccess.WRITE).store_string(svg)
	var image := Image.new()
	if image.load_svg_from_string(svg, 1.0) == OK:
		image.save_png(OUTPUT_DIR.path_join(file_base + ".png"))

func _attribute(svg: String, name: String) -> String:
	var pattern := RegEx.new()
	pattern.compile(name + '="([^"]+)"')
	var match := pattern.search(svg)
	return match.get_string(1) if match else ""
