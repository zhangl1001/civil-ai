export type StructuredOutputMode = 'tool' | 'prompt';

/** Remembers a gateway instance's observed structured-output capability. */
export class StructuredOutputCapability {
  private preferredMode: StructuredOutputMode = 'tool';

  current(): StructuredOutputMode {
    return this.preferredMode;
  }

  markToolModeUnsupported(): void {
    this.preferredMode = 'prompt';
  }
}
