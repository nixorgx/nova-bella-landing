/** Tiny stdout logger for CLI scripts (no console.* in the codebase). */
export function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function warn(message: string): void {
  process.stderr.write(`${message}\n`);
}
