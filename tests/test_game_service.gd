extends SceneTree

const GameServiceFixture = preload("res://scripts/game_service.gd")

func _init() -> void:
    var service := GameServiceFixture.new()
    get_root().add_child(service)
    service.new_game(3, 2, 12345)
    assert(service.state.players.size() == 3)
    assert(service.state.players[0].cards.size() == 20)
    assert(service.state.deck.size() == 18)
    assert(service.select_discard(0))
    assert(service.state.turn >= 1)
    service.new_game(4, 0, 12345)
    assert(service.state.players.size() == 3)
    assert(service.state.players[2].cards.size() == 20)
    var results: Array = service.run_batch(2)
    assert(results.size() == 2)
    quit()
