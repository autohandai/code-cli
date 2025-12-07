# Building a To-Do List App with Autohand Agents

This tutorial guides you through building a simple, persistent To-Do List application using React and Autohand's sub-agent system.

## Prerequisites

- Autohand CLI installed (`npm install -g autohand-cli` or via binary)
- An LLM provider configured (run `/model` to configure)
- Node.js and npm/bun installed

## Step 1: Setup Your Project

First, create a new directory for your project and initialize it.

```bash
mkdir my-todo-app
cd my-todo-app
# Initialize a basic Vite React app (or let Autohand do it!)
npm create vite@latest . -- --template react-ts
npm install
```

## Step 2: Define Your Sub-Agent

Autohand uses "Agents" - specialized personas defined in markdown files. Let's create a frontend expert.

1.  Create the agents directory if it doesn't exist:
    ```bash
    mkdir -p ~/.autohand-cli/agents
    ```

2.  Create a file named `frontend-dev.md` in that directory with the following content:

    ```markdown
    # Frontend Developer Agent

    You are an expert Frontend Developer specializing in React, TypeScript, and modern UI libraries like Tailwind CSS.

    ## Capabilities
    - Create and modify React components
    - Manage state with Hooks and Context
    - Style applications using Tailwind CSS
    - Ensure accessibility and responsiveness
    ```

    *Tip: You can copy the example file provided in this repo: `cp examples/agents/frontend-dev.md ~/.autohand-cli/agents/`*

## Step 3: Start Autohand

Run the CLI in your project folder:

```bash
autohand
```

Verify your agent is available by typing `/agents`. You should see `frontend-dev` in the list.

## Step 4: Build the App

Now, instruct Autohand to build the app using your new agent.

**Prompt:**
> @frontend-dev Create a simple To-Do list component in `src/components/TodoList.tsx`. It should allow adding items, toggling completion, and deleting items. Use standard CSS for now.

Autohand will:
1.  Delegate the task to the `frontend-dev` agent.
2.  Plan the component.
3.  Write the code to `src/components/TodoList.tsx`.

## Step 5: Integrate and Refine

Now ask it to use the component in your main app.

**Prompt:**
> @frontend-dev Update `src/App.tsx` to use the new TodoList component. Remove the default Vite boilerplate.

**Prompt:**
> @frontend-dev Add localStorage persistence so my todos are saved when I refresh the page.

## Conclusion

You've just built a functional React app using a specialized AI agent! You can create agents for backend work (`backend-dev.md`), testing (`qa-engineer.md`), or any other role you need.
