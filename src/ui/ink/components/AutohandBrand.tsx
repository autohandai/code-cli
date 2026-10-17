import React, { memo, useEffect, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { getTerminalColumns, renderAutohandLogo } from '../../../utils/asciiArt.js';
import { BRAND_FRAME_INTERVAL_MS, BRAND_FRAME_COUNT, formatBrandLogo, resolveBrandColorMode, shouldAnimateBrand } from '../../brand.js';

export interface AutohandBrandProps {
  version?: string;
  animate?: boolean;
  reservedRows?: number;
  availableRows?: number;
}

export const AutohandBrand = memo(function AutohandBrand({ version, animate = true, reservedRows = 8, availableRows: headerRows }: AutohandBrandProps) {
  const { stdout } = useStdout();
  const [size, setSize] = useState(() => ({ columns: getTerminalColumns(stdout), rows: stdout.rows || 24 }));
  const [frame, setFrame] = useState(0);
  const colorMode = resolveBrandColorMode(Boolean(stdout.isTTY));
  const columns = Math.max(1, size.columns - 2);
  const availableRows = Math.max(0, headerRows ?? size.rows - reservedRows);
  const metadataRows = version && availableRows >= 3 ? 2 : 1;
  const candidate = renderAutohandLogo({ columns, rows: Math.max(0, availableRows - metadataRows - 1), frame: animate ? frame : 0 });
  const art = candidate.includes('\n') ? candidate : '';
  const animated = Boolean(art) && shouldAnimateBrand(Boolean(stdout.isTTY), colorMode, animate);

  useEffect(() => {
    const resize = () => setSize({ columns: getTerminalColumns(stdout), rows: stdout.rows || 24 });
    stdout.on('resize', resize);
    return () => { stdout.off('resize', resize); };
  }, [stdout]);

  useEffect(() => {
    if (!animated) return;
    const interval = setInterval(() => setFrame((value) => (value + 1) % BRAND_FRAME_COUNT), BRAND_FRAME_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [animated]);

  const coloredArt = formatBrandLogo(art, animated ? frame : 0, colorMode);
  if (availableRows === 0) return null;

  return (
    <Box flexDirection="column">
      {art && coloredArt.split('\n').map((line, index) => <Text key={index} wrap="truncate-end">{line}</Text>)}
      {art ? <Text> </Text> : null}
      <Text bold wrap="truncate-end">{'autohand'.slice(0, columns)}</Text>
      {version && availableRows >= 3 ? <Text dimColor wrap="truncate-end">{version}</Text> : null}
    </Box>
  );
});
