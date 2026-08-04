export interface RoutedSessionHost<TView> {
  attachWebview(view: TView, surfaceToken: string): void;
  detachWebview(view?: TView): void;
  handleWebviewMessage(raw: unknown): Promise<void>;
  focus(): void;
}

export class SelectedSessionRouter<
  TView,
  THost extends RoutedSessionHost<TView>,
> {
  #selected: { id: string; host: THost } | undefined;

  get selected(): { id: string; host: THost } | undefined {
    return this.#selected;
  }

  isSelected(id: string, host: THost): boolean {
    return this.#selected?.id === id && this.#selected.host === host;
  }

  select(id: string, host: THost, view?: TView, surfaceToken = ""): void {
    if (this.isSelected(id, host)) {
      if (view) host.attachWebview(view, surfaceToken);
      return;
    }
    this.clear(view);
    this.#selected = { id, host };
    if (view) host.attachWebview(view, surfaceToken);
  }

  attach(view: TView, surfaceToken: string): void {
    this.#selected?.host.attachWebview(view, surfaceToken);
  }

  clear(view?: TView): void {
    this.#selected?.host.detachWebview(view);
    this.#selected = undefined;
  }

  dispatch(raw: unknown): Promise<void> {
    return this.#selected?.host.handleWebviewMessage(raw) ?? Promise.resolve();
  }
}
