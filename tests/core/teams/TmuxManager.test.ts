import { describe, it, expect, afterEach } from 'vitest';
import { TmuxManager } from '../../../src/core/teams/TmuxManager.js';

describe('TmuxManager', () => {
  const originalEnv = process.env.TMUX;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.TMUX = originalEnv;
    } else {
      delete process.env.TMUX;
    }
  });

  describe('isInTmux', () => {
    it('should return true when TMUX env var is set', () => {
      process.env.TMUX = '/tmp/tmux-1000/default,12345,0';
      expect(TmuxManager.isInTmux()).toBe(true);
    });

    it('should return false when TMUX env var is not set', () => {
      delete process.env.TMUX;
      expect(TmuxManager.isInTmux()).toBe(false);
    });
  });

  describe('detectDisplayMode', () => {
    it('should return tmux when preference is tmux', () => {
      expect(TmuxManager.detectDisplayMode('tmux')).toBe('tmux');
    });

    it('should return in-process when preference is in-process', () => {
      expect(TmuxManager.detectDisplayMode('in-process')).toBe('in-process');
    });

    it('should auto-detect tmux when TMUX is set and preference is auto', () => {
      process.env.TMUX = '/tmp/tmux-1000/default,12345,0';
      expect(TmuxManager.detectDisplayMode('auto')).toBe('tmux');
    });

    it('should auto-detect in-process when TMUX is not set', () => {
      delete process.env.TMUX;
      expect(TmuxManager.detectDisplayMode('auto')).toBe('in-process');
    });

    it('should auto-detect when no preference given', () => {
      delete process.env.TMUX;
      expect(TmuxManager.detectDisplayMode()).toBe('in-process');
    });
  });

  describe('pane management', () => {
    it('should track managed panes', () => {
      const manager = new TmuxManager();
      expect(manager.getManagedPanes()).toEqual([]);
      expect(manager.getPaneId('hunter')).toBeUndefined();
    });
  });
});
