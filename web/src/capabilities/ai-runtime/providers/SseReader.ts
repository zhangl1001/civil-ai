export async function readServerSentEvents(
  stream: ReadableStream<Uint8Array>,
  onData: (data: string) => void | Promise<void>
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? '';
    for (const event of events) await emitEventData(event, onData);
  }
  buffer += decoder.decode();
  if (buffer.trim()) await emitEventData(buffer, onData);
}

async function emitEventData(event: string, onData: (data: string) => void | Promise<void>): Promise<void> {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (data) await onData(data);
}
