import React from 'react';
import { Box, Text } from 'ink';
import type { PeerComposerView } from './usePeerComposer.js';
import { safePeerLabel } from '../../session/peers/PeerScope.js';
import { useTheme } from '../theme/ThemeContext.js';

export function PeerMentionDropdown({ suggestions, activeIndex, status, open, scope, canCycleScope }: PeerComposerView) {
  const { theme } = useTheme();
  if (!open && !status) return null;
  return <Box flexDirection="column" marginTop={1}>
    {status && <Text wrap="wrap">{theme.fg('muted', status)}</Text>}
    {open && <Text>{theme.fg('muted', `Peers · ${scope}${canCycleScope ? ' · Shift+Tab to change scope' : ''}`)}</Text>}
    {open && !suggestions.length && <Text>{theme.fg('dim', 'No matching peers · Esc to close')}</Text>}
    {suggestions.map((peer, index) => <Box key={peer.peerId}>
      <Text>{theme.fg(index === activeIndex ? 'accent' : 'text', `${index === activeIndex ? '▸' : ' '} :${safePeerLabel(peer.alias)}`)}</Text>
      <Text>{theme.fg('muted', `  ${safePeerLabel(peer.project)} · ${peer.kind} · ${safePeerLabel(peer.activity)}${peer.availability === 'available' ? '' : ` · ${peer.availability}`}`)}</Text>
    </Box>)}
    {suggestions.length > 0 && <Text>{theme.fg('dim', '  Tab or Enter to select · ↑↓ to navigate · Esc to close')}</Text>}
  </Box>;
}
