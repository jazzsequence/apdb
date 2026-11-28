/**
 * Record that something could not be read or written, without stopping.
 *
 * The run carries on and keeps what succeeded. The exit code is how the weekly
 * job learns the result is partial: a source that fails completely must not
 * look like a week with nothing new.
 */
export function failed(message: string): void {
  console.error(message);
  process.exitCode = 1;
}
