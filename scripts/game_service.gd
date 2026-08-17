extends Node

signal state_changed(state)
signal game_finished(state)

const PHASE_DRAW := "drawing"
const PHASE_DISCARD := "discarding"
const PHASE_RESPONSE := "response_collecting"
const PHASE_ENDED := "ended"
var state: Dictionary = {}
var rng := RandomNumberGenerator.new()
var history: Array[Dictionary] = []
var ai_mode := "medium"

func new_game(_player_count: int = 3, bottom_cards: int = 2, seed_value: int = 0) -> Dictionary:
    rng.seed = seed_value if seed_value != 0 else Time.get_ticks_msec()
    var deck: Array[Dictionary] = []
    for size in ["small", "big"]:
        for value in range(1, 11):
            for copy in 4:
                deck.append({"id": "%s_%d_%d" % [size, value, copy], "value": value, "size": size, "is_red": value in [2, 7, 10]})
    deck.shuffle()
    var players: Array[Dictionary] = []
    for index in 3:
        players.append({"id": "player_%d" % index, "name": "玩家" if index == 0 else "AI %d" % index, "cards": [], "melds": [], "score": int(AppState.settings.initial_score), "dealer": index == 0})
    for card_index in 60:
        players[card_index % 3].cards.append(deck[card_index])
    deck = deck.slice(60)
    if bottom_cards > 0:
        deck = deck.slice(min(bottom_cards, deck.size()))
    state = {"players": players, "deck": deck, "current_player": 0, "phase": PHASE_DISCARD, "turn": 0, "discard": [], "last_discard": {}, "winner": -1, "game_over": false, "available_actions": ["discard"]}
    history.clear()
    state_changed.emit(state)
    return state

func current_player_cards() -> Array:
    return state.get("players", [])[0].cards if not state.is_empty() else []

func select_discard(card_index: int) -> bool:
    if state.is_empty() or state.game_over or state.current_player != 0 or state.phase != PHASE_DISCARD:
        return false
    if card_index < 0 or card_index >= state.players[0].cards.size():
        return false
    var card: Dictionary = state.players[0].cards.pop_at(card_index)
    _apply_discard(0, card)
    _advance_after_discard()
    return true

func process_action(action: String, card_index: int = -1) -> bool:
    if action == "discard": return select_discard(card_index)
    if action == "pass":
        _advance_turn()
        return true
    return false

func run_batch(count: int) -> Array[Dictionary]:
    var results: Array[Dictionary] = []
    for _i in count:
        new_game(int(AppState.settings.player_count), int(AppState.settings.bottom_card_count))
        var guard := 0
        while not state.game_over and guard < 240:
            guard += 1
            _ai_step()
        results.append({"turns": state.turn, "winner": state.winner, "history": history.duplicate(true)})
    return results

func _ai_step() -> void:
    if state.phase == PHASE_RESPONSE:
        _advance_turn()
        return
    var player: Dictionary = state.players[state.current_player]
    if player.cards.is_empty():
        _advance_turn()
        return
    if state.phase == PHASE_DRAW:
        if state.deck.is_empty():
            state.game_over = true; state.phase = PHASE_ENDED; game_finished.emit(state); return
        player.cards.append(state.deck.pop_back())
        state.phase = PHASE_DISCARD
    var index := _choose_ai_card(player.cards)
    var card: Dictionary = player.cards.pop_at(index)
    _apply_discard(state.current_player, card)
    _advance_after_discard()

func _choose_ai_card(cards: Array) -> int:
    var selected := 0
    var best := 999
    for i in cards.size():
        var value := int(cards[i].value) + (3 if cards[i].is_red else 0)
        if value < best: best = value; selected = i
    return selected

func _apply_discard(player_index: int, card: Dictionary) -> void:
    state.discard.append({"player": player_index, "card": card})
    state.last_discard = card
    history.append({"turn": state.turn, "player": player_index, "action": "discard", "card": card})

func _advance_after_discard() -> void:
    if state.players[state.current_player].cards.size() <= 1:
        state.winner = state.current_player; state.game_over = true; state.phase = PHASE_ENDED
        AppState.stats.total_games += 1
        if state.winner == 0: AppState.stats.wins += 1; AppState.stats.streak += 1
        else: AppState.stats.losses += 1; AppState.stats.streak = 0
        AppState.stats.total_turns += state.turn; AppState.save_stats(); PersistenceService.save_replay({"state": state, "history": history})
        game_finished.emit(state)
        state_changed.emit(state)
        return
    _advance_turn()

func _advance_turn() -> void:
    state.current_player = (state.current_player + 1) % state.players.size()
    while state.players[state.current_player].cards.is_empty():
        state.current_player = (state.current_player + 1) % state.players.size()
    state.turn += 1
    state.phase = PHASE_DRAW
    state.available_actions = ["draw"]
    state_changed.emit(state)
