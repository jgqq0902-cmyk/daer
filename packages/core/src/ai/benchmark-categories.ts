import type { PolicyEvaluationReport } from '../shared/types/ai';

export interface BenchmarkStateSnapshot {
  turnCount: number;
  remainingDeckCards: number;
}

export interface BenchmarkEvaluationEntry {
  sampleId: string;
  category: string;
  learnedTop: string;
  heuristicTop?: string;
  oracleTop?: string;
  learnedWinRate: number;
  heuristicWinRate: number;
  learnedExpectedScore: number;
  heuristicExpectedScore: number;
  learnedMatchesOracle: boolean;
  heuristicMatchesOracle: boolean;
}

export function categorizeBenchmarkSample(snapshot: BenchmarkStateSnapshot): string {
  if (snapshot.turnCount <= 4) {
    return 'opening';
  }
  if (snapshot.remainingDeckCards <= 10 || snapshot.turnCount >= 12) {
    return 'endgame';
  }
  return 'midgame';
}

export function buildBenchmarkSummary(entries: BenchmarkEvaluationEntry[]): PolicyEvaluationReport['benchmarkSummary'] {
  const grouped = new Map<string, BenchmarkEvaluationEntry[]>();
  for (const entry of entries) {
    const group = grouped.get(entry.category) || [];
    group.push(entry);
    grouped.set(entry.category, group);
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, items]) => ({
      name,
      sampleCount: items.length,
      learnedTop: items[0]?.learnedTop || '',
      heuristicTop: items[0]?.heuristicTop,
      oracleTop: items[0]?.oracleTop,
      winRateDelta: items.length > 0
        ? items.reduce((sum, item) => sum + (item.learnedWinRate - item.heuristicWinRate), 0) / items.length
        : 0,
      expectedScoreDelta: items.length > 0
        ? items.reduce((sum, item) => sum + (item.learnedExpectedScore - item.heuristicExpectedScore), 0) / items.length
        : 0,
      learnedOracleMatchRate: items.length > 0
        ? items.filter((item) => item.learnedMatchesOracle).length / items.length
        : 0,
      heuristicOracleMatchRate: items.length > 0
        ? items.filter((item) => item.heuristicMatchesOracle).length / items.length
        : 0,
    }));
}
