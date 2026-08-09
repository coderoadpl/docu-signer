class JsdomPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pressure: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pressure = init.pressure ?? 0.5;
  }
}

Object.defineProperty(globalThis, 'PointerEvent', {
  configurable: true,
  value: JsdomPointerEvent,
});
