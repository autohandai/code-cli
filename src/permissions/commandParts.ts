/**
 * Only literal simple commands have equivalent prefix permission semantics.
 * Other shell syntax must never gain approval from an imported prefix glob.
 */
export function isSimplePermissionCommand(command: string): boolean {
  if (!/^[A-Za-z0-9_./-]+(?: [A-Za-z0-9_./:=,@+ -]*)?$/.test(command)) return false;
  const executable = command.split(' ', 1)[0].split('/').at(-1)!;
  return !/^(?:sh|bash|zsh|dash|fish|ksh|csh|tcsh|eval|exec|env|command|builtin|sudo|doas|nohup|xargs|if|then|else|fi|for|while|until|case|do|done|function|timeout|time|nice|stdbuf|noglob|watch|setsid|ionice|flock|find|cmd|cmd.exe|powershell|powershell.exe|pwsh|pwsh.exe|wsl|wsl.exe|start|call)$/i.test(executable);
}
