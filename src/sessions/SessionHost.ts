export interface SessionHost {
  send(data: string): void;
  restart(): Promise<void>;
  search(): void;
  focus(): void;
  setLabel(label: string): void;
  dispose(): Promise<void>;
}
