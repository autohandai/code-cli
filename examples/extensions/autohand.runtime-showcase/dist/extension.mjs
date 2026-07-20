export async function activate(api) {
  const { React, Ink } = api.ui;

  function DeploymentView({ close, workspaceRoot, environment }) {
    const choices = ['Plan deployment', 'Validate release', 'Cancel'];
    const [selected, setSelected] = React.useState(0);

    Ink.useInput((_input, key) => {
      if (key.upArrow) {
        setSelected((current) => (current - 1 + choices.length) % choices.length);
      } else if (key.downArrow) {
        setSelected((current) => (current + 1) % choices.length);
      } else if (key.return) {
        const choice = choices[selected];
        close(choice === 'Cancel'
          ? 'Deployment cancelled.'
          : `${choice} selected for ${environment}.`);
      }
    });

    return React.createElement(
      Ink.Box,
      { flexDirection: 'column', marginTop: 1 },
      React.createElement(Ink.Text, { color: 'green' }, 'Trusted runtime extension active'),
      React.createElement(Ink.Text, null, `Target: ${environment}`),
      React.createElement(Ink.Text, { dimColor: true }, `Workspace: ${workspaceRoot}`),
      React.createElement(Ink.Text, { dimColor: true }, 'Use arrows and Enter. Escape closes.'),
      ...choices.map((choice, index) => React.createElement(
        Ink.Text,
        { key: choice, color: selected === index ? 'cyan' : undefined },
        `${selected === index ? '❯' : ' '} ${choice}`,
      )),
    );
  }

  api.ui.registerView({
    id: 'autohand.runtime-showcase.deploy',
    title: 'Deployment console',
    component: DeploymentView,
  });

  api.commands.register({
    command: '/deploy',
    description: 'Open the extension deployment console',
    execute(context) {
      const environment = context.args[0]
        || context.cli.getOption('deployEnvironment')
        || 'staging';
      return context.ui.open('autohand.runtime-showcase.deploy', { environment });
    },
  });

  api.ui.setStatusLine({
    segments: [
      { id: 'runtime-showcase-status', text: 'extensions:ready', color: 'success' },
    ],
  });
  api.ui.setHelpLine({
    segments: [
      { id: 'runtime-showcase-help', text: 'ctrl+k deploy', color: 'accent' },
    ],
  });
  api.keybindings.register({
    key: 'ctrl+k',
    command: '/deploy',
    when: 'input-empty',
  });
  api.cli.registerFlag({
    flags: '--deploy-environment <name>',
    description: 'Default environment for the runtime showcase deployment console',
    defaultValue: 'staging',
  });

  api.hooks.on('session-start', () => ({
    additionalContext: 'The runtime showcase extension is active. Use /deploy for its deployment console.',
  }));

  api.providers.register({
    name: 'extension:showcase',
    displayName: 'Showcase Provider',
    create(config) {
      let model = config.model;
      return {
        getName: () => 'extension:showcase',
        async complete(request) {
          const lastMessage = request.messages.at(-1);
          const content = typeof lastMessage?.content === 'string'
            ? lastMessage.content
            : 'an Autohand request';
          return {
            id: `showcase-${Date.now()}`,
            created: Math.floor(Date.now() / 1000),
            content: `Showcase provider (${model}) received: ${content}`,
            finishReason: 'stop',
            raw: { provider: 'extension:showcase', model },
          };
        },
        listModels: async () => ['showcase-local'],
        isAvailable: async () => true,
        setModel: (nextModel) => { model = nextModel; },
        getModel: () => model,
      };
    },
  });

  api.permissions.registerPolicy({
    allowList: ['run_command:git status --short'],
    denyList: ['run_command:npm publish'],
  });
}
