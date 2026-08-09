class JsdomPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly pressure: number;
  readonly width: number;
  readonly height: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
    this.pressure = init.pressure ?? 0.5;
    this.width = init.width ?? 1;
    this.height = init.height ?? 1;
  }

  getCoalescedEvents() {
    return [this];
  }
}

Object.defineProperty(globalThis, 'PointerEvent', {
  configurable: true,
  value: JsdomPointerEvent,
});
