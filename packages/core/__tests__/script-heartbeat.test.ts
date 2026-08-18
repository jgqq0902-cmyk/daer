import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHeartbeatLogger } from '../scripts/_common';

describe('createHeartbeatLogger', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits periodic heartbeat logs with updated status until stopped', () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const heartbeat = createHeartbeatLogger({
      label: 'offline-train',
      intervalMs: 1_000,
      log,
    });

    heartbeat.update('sampling');
    vi.advanceTimersByTime(1_000);
    heartbeat.update('oracle');
    vi.advanceTimersByTime(1_000);
    heartbeat.stop();
    vi.advanceTimersByTime(5_000);

    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]?.[0]).toContain('[offline-train] heartbeat');
    expect(log.mock.calls[0]?.[0]).toContain('sampling');
    expect(log.mock.calls[1]?.[0]).toContain('oracle');
  });
});