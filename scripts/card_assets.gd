class_name CardAssets
extends RefCounted

const SMALL := ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]
const BIG := ["壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖", "拾"]

static func texture_path(card: Dictionary) -> String:
	var value := clampi(int(card.get("value", 1)), 1, 10)
	var prefix := "big" if str(card.get("size", "small")) == "big" else "small"
	return "res://assets/cards/%s_%02d.svg" % [prefix, value]

static func back_texture_path() -> String:
	return "res://assets/cards/card_back.svg"

static func label(card: Dictionary) -> String:
	var value := clampi(int(card.get("value", 1)), 1, 10)
	return (BIG if str(card.get("size", "small")) == "big" else SMALL)[value - 1]
