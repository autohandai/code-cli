import React from 'react';
import { render } from 'ink';
import { DiscoveryProgress } from '../../discovery/DiscoveryProgress.js';

const instance = render(
  <DiscoveryProgress
    events={[{ stage: 'upload', detail: 'Uploading selected drafts' }]}
    onCancel={() => {
      instance.unmount();
      console.log('Discovery cancelled');
      process.exitCode = 130;
    }}
  />,
  { exitOnCtrlC: false }
);
